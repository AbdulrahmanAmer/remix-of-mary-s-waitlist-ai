import type { HoldClip } from "./hold-recorder";

/** Shorter holds are mis-taps, not speech. */
export const MIN_HOLD_MS = 300;
/** A thumb that slips off and comes straight back is still the same sentence. */
export const REPRESS_GRACE_MS = 250;
/** A button held forever (a pocket, a stuck key) lets go by itself. */
export const MAX_HOLD_MS = 30000;
/** −50 dBFS: a clip whose loudest moment is below this holds no speech; it never leaves the device. */
export const SILENT_PEAK = 0.00316;

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
  /** Runs synchronously inside the press: MARY must stop in the same event. */
  onPress: () => void;
  /** The clip is on its way to transcription. */
  onRelease: () => void;
  /** Too short to be speech: back to waiting. */
  onCancel: () => void;
  onText: (text: string) => void;
  /** The hold produced no words; `inARow` counts consecutive misses. */
  onMissed: (inARow: number) => void;
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
 */
export class HoldTalk {
  private phase: Phase = "idle";
  private pressedAt = 0;
  private heldMs = 0;
  private graceTimer = 0;
  private maxTimer = 0;
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
      return;
    }
    deps.onPress();
    this.phase = "held";
    this.pressedAt = deps.now();
    this.heldMs = 0;
    this.armMax();
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

  private reset(): void {
    this.deps.clearTimer(this.graceTimer);
    this.deps.clearTimer(this.maxTimer);
    this.phase = "idle";
  }

  private async finish(): Promise<void> {
    const { deps } = this;
    this.reset();
    const clip = deps.recorder.isOpen ? deps.recorder.stop() : null;
    if (!clip?.blob || this.heldMs < MIN_HOLD_MS) {
      deps.onCancel();
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
      deps.onError(error);
    }
    if (!text) {
      this.misses += 1;
      deps.onMissed(this.misses);
      return;
    }
    this.misses = 0;
    deps.onText(text);
  }
}
