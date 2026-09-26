import type { HoldClip } from "./hold-recorder";

/** Shorter holds are mis-taps, not speech. */
export const MIN_HOLD_MS = 300;
/** A thumb that slips off and comes straight back is still the same sentence. */
export const REPRESS_GRACE_MS = 250;
/** A button held forever (a pocket, a stuck key) lets go by itself. */
export const MAX_HOLD_MS = 30000;
/** −50 dBFS: a clip whose loudest moment is below this holds no speech; it never leaves the device. */
export const SILENT_PEAK = 0.00316;
/** Transcription that takes longer than this is treated as down, not as the person's fault. */
export const TRANSCRIBE_TIMEOUT_MS = 10000;
/** A clip at least this long and this loud held real words, whatever the model made of them. */
export const REAL_SPEECH_MS = 600;
export const REAL_SPEECH_PEAK = 0.02;

/** Well-known phrases speech models invent on near-silent audio. */
const HALLUCINATIONS = [
  /^thank(s| you)( for watching| so much)?[.!]?$/i,
  /^(bye|goodbye)[.!]?$/i,
  /^subtitles? by/i,
  /^you[.!]?$/i,
];

export class TranscribeUnavailableError extends Error {
  constructor(readonly reason: "timeout" | "network" | "server") {
    super(`transcription ${reason}`);
    this.name = "TranscribeUnavailableError";
  }
}

/**
 * Sends a held clip to /api/transcribe. Unlike the engine's own helper it says
 * when the service failed, so the person is not told to speak closer to the
 * phone because a server answered 502.
 */
export async function transcribeHeldAudio(
  blob: Blob,
  timeoutMs = TRANSCRIBE_TIMEOUT_MS,
): Promise<string> {
  if (blob.size < 2048) return "";
  const form = new FormData();
  form.append("file", blob, "recording.wav");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new TranscribeUnavailableError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new TranscribeUnavailableError("server");
  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** A stock phrase on a clip too short or too quiet to have carried it. */
export function isInventedText(text: string, clip: Pick<HoldClip, "durationMs" | "peak">): boolean {
  if (/^\W*$/.test(text)) return true;
  if (!HALLUCINATIONS.some((pattern) => pattern.test(text))) return false;
  return clip.durationMs < REAL_SPEECH_MS || clip.peak < REAL_SPEECH_PEAK;
}

export type HoldTalkDeps = {
  recorder: {
    readonly isOpen: boolean;
    open: () => Promise<void>;
    start: () => void;
    stop: () => HoldClip;
    /** Nothing to record after all (the hold ended while the mic was opening). */
    release: () => void;
  };
  /** Held audio goes straight to transcription: it is the person by definition, so no judge. */
  transcribeHeld: (blob: Blob) => Promise<string>;
  /** Runs synchronously inside the press: MARY goes quiet in the same event, but nothing is decided yet. */
  onPress: () => void;
  /** The hold outlasted a tap: this is their turn, and the rest of hers is dropped. */
  onCommit: () => void;
  /** The clip is on its way to transcription. */
  onRelease: () => void;
  /** Nothing to send: a tap too short to be speech, or a hold that captured no audio. */
  onCancel: (reason: "short" | "empty") => void;
  onText: (text: string) => void;
  /** The hold produced no words; `inARow` counts consecutive misses. */
  onMissed: (inARow: number) => void;
  /** The words could not be transcribed (service down, timeout): not the person's doing. */
  onTranscribeFailed: (error: unknown) => void;
  /** The microphone could not open. */
  onError: (error: unknown) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

type Phase = "idle" | "held" | "grace";

/**
 * Hold-to-talk turn-taking: press is "I have the floor", release is "my turn is
 * over". Nothing heard outside a hold is ever sent, so a loud room cannot start a
 * turn, and there is no silence timer or voice detector deciding when you finished.
 *
 * A press shorter than MIN_HOLD_MS is a tap: MARY pauses for it and then carries
 * on. Only a hold that outlasts it commits, ending her line for good.
 */
export class HoldTalk {
  private phase: Phase = "idle";
  private pressedAt = 0;
  private heldMs = 0;
  private graceTimer = 0;
  private maxTimer = 0;
  private commitTimer = 0;
  private committed = false;
  private misses = 0;

  constructor(private readonly deps: HoldTalkDeps) {}

  get holding(): boolean {
    return this.phase !== "idle";
  }

  press(): void {
    const { deps } = this;
    if (this.phase === "held") return;
    if (this.phase === "grace") {
      deps.clearTimer(this.graceTimer);
      this.phase = "held";
      this.pressedAt = deps.now();
      this.armMax();
      this.armCommit();
      return;
    }
    deps.onPress();
    this.phase = "held";
    this.pressedAt = deps.now();
    this.heldMs = 0;
    this.committed = false;
    this.armMax();
    this.armCommit();
    if (deps.recorder.isOpen) {
      deps.recorder.start();
      return;
    }
    // First press of the call: the microphone opens now and recording starts as
    // soon as it is ready, if they are still holding.
    deps.recorder.open().then(
      () => {
        if (this.phase !== "idle") deps.recorder.start();
        else deps.recorder.release();
      },
      (error: unknown) => {
        this.reset();
        deps.onError(error);
      },
    );
  }

  release(): void {
    const { deps } = this;
    if (this.phase !== "held") return;
    this.heldMs += deps.now() - this.pressedAt;
    deps.clearTimer(this.maxTimer);
    deps.clearTimer(this.commitTimer);
    // A hold that crossed the line in pieces (slip, re-press) still counts.
    if (this.heldMs >= MIN_HOLD_MS) this.commit();
    this.phase = "grace";
    this.graceTimer = deps.setTimer(() => void this.finish(), REPRESS_GRACE_MS);
  }

  /** Call ended or the mode changed: drop whatever is held. */
  cancel(): void {
    if (this.phase === "idle") return;
    this.reset();
    if (this.deps.recorder.isOpen) this.deps.recorder.stop();
  }

  private armMax(): void {
    this.deps.clearTimer(this.maxTimer);
    this.maxTimer = this.deps.setTimer(() => this.release(), MAX_HOLD_MS - this.heldMs);
  }

  private armCommit(): void {
    this.deps.clearTimer(this.commitTimer);
    if (this.committed) return;
    this.commitTimer = this.deps.setTimer(() => this.commit(), MIN_HOLD_MS - this.heldMs);
  }

  private commit(): void {
    if (this.committed) return;
    this.committed = true;
    this.deps.onCommit();
  }

  private reset(): void {
    this.deps.clearTimer(this.graceTimer);
    this.deps.clearTimer(this.maxTimer);
    this.deps.clearTimer(this.commitTimer);
    this.phase = "idle";
  }

  private async finish(): Promise<void> {
    const { deps } = this;
    this.reset();
    const clip = deps.recorder.isOpen ? deps.recorder.stop() : null;
    if (this.heldMs < MIN_HOLD_MS) {
      deps.onCancel("short");
      return;
    }
    if (!clip?.blob) {
      deps.onCancel("empty");
      return;
    }
    if (clip.peak < SILENT_PEAK) {
      this.misses += 1;
      deps.onMissed(this.misses);
      return;
    }
    deps.onRelease();
    let text = "";
    try {
      text = (await deps.transcribeHeld(clip.blob)).trim();
    } catch (error) {
      deps.onTranscribeFailed(error);
      return;
    }
    // The clip runs on through the re-press grace; the hold itself is what they meant to say.
    if (text && isInventedText(text, { durationMs: this.heldMs, peak: clip.peak })) text = "";
    if (!text) {
      this.misses += 1;
      deps.onMissed(this.misses);
      return;
    }
    this.misses = 0;
    deps.onText(text);
  }
}
