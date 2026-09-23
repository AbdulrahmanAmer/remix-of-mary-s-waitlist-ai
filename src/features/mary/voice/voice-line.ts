import { judgeAddressee } from "@/lib/addressee";
import {
  audioDiagnostics,
  noteAddresseeVerdict,
  speak,
  startMicSession,
  transcribe,
  type MicSession,
  type SpeakHandle,
  type Utterance,
} from "@/lib/audio-engine";
import { isEchoOfAssistant, spokenPortion, stripAssistantEcho } from "@/lib/voice-logic";

import type { SessionStore } from "../conversation/store";
import { micLostMessage, micMessage, uid } from "../conversation/text";
import type { PresenceState } from "../conversation/types";
import { voiceLevel } from "../signal/signal";

const HOLD_MAX_MS = 5000;
const NOTICE_MS = 9000;

/**
 * The live line: her voice out, the person's voice in, and the rules for who has
 * the floor. The engine underneath (lib/audio-engine) is unchanged; this class
 * only decides what to do with its events.
 */
export class VoiceLine {
  /** Set by the app: where a finished, addressed utterance goes. */
  onSend: (text: string) => void = () => {};
  /** Set by the app: true while a turn is being worked on. */
  isBusy: () => boolean = () => false;

  private speakHandle: SpeakHandle | null = null;
  /** The line being voiced, so a cut-off can keep only what was heard. */
  private current: { id: string; text: string; handle: SpeakHandle } | null = null;
  private session: MicSession | null = null;
  private opening = 0;
  /** A sound over her voice is being checked; she is paused meanwhile. */
  private pendingInterrupt = false;
  /** The cut-in is real: she stays quiet until the person's words are handled. */
  private hold = false;
  private holdSince = 0;
  private falseInterrupts = 0;
  private coupling = 0;
  private echoHintShown = false;
  private timers = new Set<number>();
  private watchdog = 0;

  constructor(private readonly store: SessionStore) {}

  private setPresence(presence: PresenceState) {
    this.store.dispatch({ type: "SET_PRESENCE", presence });
  }

  private listeningIdle() {
    this.store.dispatch({
      type: "SET_LISTENING",
      listening: this.store.get().mic.muted ? "paused" : "listening",
    });
  }

  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private flashNotice(key: "echoHint" | "voiceFailed") {
    this.store.dispatch({ type: "SET_NOTICE", key, value: true });
    this.later(() => this.store.dispatch({ type: "SET_NOTICE", key, value: false }), NOTICE_MS);
  }

  isHeld(): boolean {
    return this.hold;
  }

  /** The person's words are being handled now (typed or spoken): the cut-in is over. */
  clearCutIn(): void {
    this.hold = false;
    this.holdSince = 0;
    this.pendingInterrupt = false;
  }

  isSpeaking(): boolean {
    return this.speakHandle !== null;
  }

  /** Voices a line and records it. Resolves when it has been said or cut off. */
  say(text: string, opts: { record?: boolean } = {}): Promise<void> {
    const { store } = this;
    const words = text.split(/\s+/).filter(Boolean).length;
    const id = uid();
    if (opts.record !== false)
      store.dispatch({ type: "ADD_LINE", line: { id, role: "mary", text } });
    store.dispatch({ type: "SET_REVEAL", id, count: 0 });
    if (store.get().listening === "finishing") this.listeningIdle();
    // Rough spoken length, used only as a floor while the audio stream fills.
    const approx = Math.max(1.4, words * 0.42);

    if (store.get().voiceOff) {
      // Voice off: her words appear at speaking pace, without sound.
      this.setPresence("speaking");
      return new Promise<void>((resolve) => {
        const start = performance.now();
        const duration = approx * 1000;
        const step = () => {
          const progress = Math.min(1, (performance.now() - start) / duration);
          store.dispatch({ type: "SET_REVEAL", id, count: Math.ceil(progress * words) });
          if (progress < 1) {
            this.later(step, 90);
            return;
          }
          if (store.get().presence === "speaking") this.setPresence("idle");
          resolve();
        };
        step();
      });
    }

    this.stopSpeaking();
    this.setPresence("speaking");
    const handle = speak(text, {
      onLevel: (level) => voiceLevel.set(level),
      approxDurationSec: approx,
      // Words land in step with the voice actually being heard; the store only
      // wakes the screen when the word count changes.
      onProgress: (progress) =>
        store.dispatch({ type: "SET_REVEAL", id, count: Math.ceil(progress * words) }),
      onError: () => this.flashNotice("voiceFailed"),
      onEnd: () => {
        store.dispatch({ type: "SET_REVEAL", id, count: words });
        if (this.current?.handle === handle) this.current = null;
        if (this.speakHandle === handle) this.speakHandle = null;
        voiceLevel.set(0);
        if (store.get().presence === "speaking") this.setPresence("idle");
      },
    });
    // If the person is already talking, the line waits its turn.
    if (this.pendingInterrupt || this.hold) handle.pause();
    this.current = { id, text, handle };
    this.speakHandle = handle;
    return handle.done;
  }

  /** Ends whatever she is saying; the transcript keeps only the words that were heard. */
  stopSpeaking(): void {
    const current = this.current;
    const handle = this.speakHandle;
    if (current && handle) {
      const { spoken, cut } = spokenPortion(current.text, handle.spokenFraction());
      if (cut) this.store.dispatch({ type: "CUT_LINE", id: current.id, spoken });
    }
    handle?.stop();
    this.speakHandle = null;
    this.current = null;
  }

  /** She was held for a sound that turned out to be nothing: she carries on. */
  releaseHold(): void {
    this.hold = false;
    this.holdSince = 0;
    this.pendingInterrupt = false;
    const handle = this.speakHandle;
    if (handle?.isPaused()) {
      handle.resume();
      this.setPresence("speaking");
    }
  }

  private maybeShowEchoHint() {
    if (this.echoHintShown || this.coupling < 0.45 || this.falseInterrupts < 2) return;
    this.echoHintShown = true;
    this.flashNotice("echoHint");
  }

  /** Opens the line for the call. Safe to call again after a failure (retry). */
  async openMic(): Promise<void> {
    const { store } = this;
    const attempt = ++this.opening;
    this.closeMic();
    try {
      const session = await startMicSession({
        onLevel: (level) => {
          if (!this.speakHandle) voiceLevel.set(level);
        },
        onInterim: (text) => store.dispatch({ type: "SET_INTERIM", interim: text }),
        onSpeechStart: () => {
          store.dispatch({ type: "SET_LISTENING", listening: "hearing" });
          this.setPresence("hearing");
        },
        onInterruptCandidate: () => {
          this.pendingInterrupt = true;
          this.speakHandle?.pause();
          store.dispatch({ type: "SET_LISTENING", listening: "hearing" });
          this.setPresence("hearing");
        },
        onInterruptConfirmed: () => {
          this.pendingInterrupt = false;
          this.hold = true;
          this.holdSince = Date.now();
        },
        onInterruptCancelled: (heldFirst) => {
          this.pendingInterrupt = false;
          this.falseInterrupts += 1;
          if (heldFirst) {
            this.releaseHold();
          } else if (!this.hold) {
            const handle = this.speakHandle;
            if (handle?.isPaused()) handle.resume();
            this.setPresence(handle ? "speaking" : "idle");
          }
          store.dispatch({ type: "SET_LISTENING", listening: "listening" });
          this.maybeShowEchoHint();
        },
        onEchoCoupling: (coupling) => {
          this.coupling = coupling;
          this.maybeShowEchoHint();
        },
        onUtterance: (utterance) => void this.handleUtterance(utterance),
        onAmbient: () => {
          noteAddresseeVerdict("ambient");
          this.releaseHold();
          store.dispatch({ type: "SET_INTERIM", interim: "" });
          this.listeningIdle();
        },
        onLost: (reason) => {
          if (attempt !== this.opening) return;
          this.session?.close();
          this.session = null;
          voiceLevel.set(0);
          store.dispatch({ type: "SET_MIC", mic: { live: false, error: micLostMessage(reason) } });
          store.dispatch({ type: "SET_LISTENING", listening: "paused" });
          store.dispatch({ type: "SET_INTERIM", interim: "" });
        },
      });
      if (attempt !== this.opening) {
        session.close();
        return;
      }
      this.session = session;
      session.setMuted(store.get().mic.muted);
      store.dispatch({ type: "SET_MIC", mic: { live: true, error: null } });
      this.listeningIdle();
      this.startWatchdog();
    } catch (error) {
      if (attempt !== this.opening) return;
      store.dispatch({ type: "SET_MIC", mic: { live: false, error: micMessage(error) } });
      store.dispatch({ type: "SET_LISTENING", listening: "paused" });
    }
  }

  closeMic(): void {
    this.session?.close();
    this.session = null;
    window.clearInterval(this.watchdog);
    if (this.store.get().mic.live) this.store.dispatch({ type: "SET_MIC", mic: { live: false } });
  }

  /** Mute keeps the call open but stops her hearing you. */
  setMicMuted(muted: boolean): void {
    const { store } = this;
    store.dispatch({ type: "SET_MIC", mic: { muted } });
    this.session?.setMuted(muted);
    store.dispatch({ type: "SET_INTERIM", interim: "" });
    if (!this.speakHandle) voiceLevel.set(0);
    if (muted) {
      this.releaseHold();
      store.dispatch({ type: "SET_LISTENING", listening: "paused" });
      const presence = store.get().presence;
      if (presence === "hearing" || presence === "listening") this.setPresence("idle");
    } else {
      store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    }
  }

  /** Whatever went wrong, she never stays frozen waiting for a sentence. */
  private startWatchdog() {
    window.clearInterval(this.watchdog);
    this.watchdog = window.setInterval(() => {
      if (!this.hold || this.isBusy()) return;
      if (Date.now() - this.holdSince < HOLD_MAX_MS) return;
      this.releaseHold();
      this.store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    }, 1000);
  }

  /** iPhone had to route her voice to the speakers: the ring switch is the usual culprit. */
  directOutputUsed(): boolean {
    return audioDiagnostics().directOutput;
  }

  private async handleUtterance(utterance: Utterance): Promise<void> {
    const { store } = this;
    const state = store.get();
    if (state.stage !== "call" || state.mic.muted) {
      this.releaseHold();
      return;
    }
    const recentMary = state.lines
      .filter((line) => line.role === "mary")
      .slice(-6)
      .map((line) => line.text);

    let spoken = utterance.text.trim();
    const worthTranscribing =
      !spoken && utterance.audio && utterance.durationMs >= 350 && utterance.peak >= 0.02;
    if (worthTranscribing && utterance.audio) {
      store.dispatch({ type: "SET_LISTENING", listening: "finishing" });
      this.setPresence("thinking");
      try {
        spoken = (await transcribe(utterance.audio)).trim();
      } catch {
        spoken = "";
      }
      if (spoken) {
        spoken = stripAssistantEcho(spoken, recentMary);
        if (spoken && isEchoOfAssistant(spoken, recentMary)) spoken = "";
      }
    }
    store.dispatch({ type: "SET_INTERIM", interim: "" });

    const letItGo = () => {
      // Nothing for her: if she had gone quiet for it, she carries straight on.
      const wasHeld = this.hold || this.speakHandle?.isPaused();
      this.releaseHold();
      this.listeningIdle();
      const presence = store.get().presence;
      if (presence === "hearing" || presence === "thinking")
        this.setPresence(wasHeld && this.speakHandle ? "speaking" : "idle");
    };
    if (!spoken) {
      letItGo();
      return;
    }
    // Words alone do not make it hers: was that the person talking to her, or the room?
    const verdict = await judgeAddressee({
      heard: spoken,
      lastAssistant: recentMary[recentMary.length - 1] ?? "",
      recent: store
        .get()
        .lines.slice(-6)
        .map((line) => `${line.role}: ${line.text}`),
    });
    noteAddresseeVerdict(verdict);
    this.session?.noteVerdict(verdict === "mary" ? "mary" : "ambient", utterance.peak);
    if (verdict !== "mary") {
      letItGo();
      return;
    }
    this.hold = false;
    this.pendingInterrupt = false;
    this.onSend(spoken);
  }

  dispose(): void {
    this.opening += 1;
    this.stopSpeaking();
    this.closeMic();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    voiceLevel.set(0);
  }
}
