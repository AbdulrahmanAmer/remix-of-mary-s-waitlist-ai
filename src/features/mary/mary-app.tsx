import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "motion/react";

import { WaitlistVault } from "@/components/waitlist-vault";
import {
  isAppleMobile,
  isWebKitEngine,
  primeMicPermission,
  primeOutput,
  micPermissionState,
  releasePrimedMic,
  setOutputRoute,
  releaseAudioOutput,
  replayLastLine,
  unlockAudio,
} from "@/lib/audio-engine";
import { addLessons, lessonsForTurn, type StoredLesson } from "@/lib/experience-store";
import {
  beaconLead,
  browserContext,
  syncLead,
  type LeadPayload,
  type LeadSyncResult,
} from "@/lib/lead-sync";
import { WAITLIST_FIELDS, type Collected } from "@/lib/mary.functions";
import { maryTurnBounded, streamMaryTurn } from "@/lib/mary-stream";
import { OPENING_LINES, welcomeBackLine } from "@/lib/retell-shared";
import {
  loadProgress,
  newSession,
  positionFor,
  saveProgress,
  sessionId,
} from "@/lib/waitlist-store";

import { LeadLifecycle } from "./conversation/lead-lifecycle";
import { createSessionStore, useSession, type SessionStore } from "./conversation/store";
import {
  IDLE_NUDGES,
  SILENCE_END_MS,
  SILENCE_NUDGE_MS,
  SILENCE_NUDGES,
  TRANSCRIBE_FAILED_LINE,
  micMessage,
} from "./conversation/text";
import type { TalkMode, VoiceVia } from "./conversation/types";
import { voiceLevel } from "./signal/signal";
import { TurnRunner } from "./conversation/turn-runner";
import { BootScreen } from "./ui/boot-screen";
import { CallStage } from "./ui/call-stage";
import { EndScreen } from "./ui/end-screen";
import { Landing } from "./ui/landing";
import { LeadFallback, type FallbackFields } from "./ui/lead-fallback";
import { hasFinePointer, useKeyboardViewport, useViewportHeight } from "./ui/use-viewport";
import { warmOrb } from "./ui/orb-renderer";
import { HoldRecorder } from "./voice/hold-recorder";
import { HoldTalk, transcribeHeldAudio } from "./voice/hold-talk";
import type { RetellCall, RetellEnd } from "./voice/retell-call";
import { VoiceLine } from "./voice/voice-line";
import { chooseVoiceProvider, fetchVoiceStatus } from "./voice/voice-provider";

/**
 * The screen stays on for the whole call, as ElevenLabs does: a locked iPhone
 * suspends the page, her voice and the microphone with it. WebKit grants the
 * first lock only inside a tap, and later ones after that first grant.
 */
let wakeLock: WakeLockSentinel | null = null;
let wakeRequest: Promise<void> | null = null;
let wakeWanted = false;
function holdScreenAwake(on: boolean) {
  wakeWanted = on;
  if (!on) {
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if ((wakeLock && !wakeLock.released) || wakeRequest) return;
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  wakeRequest = navigator.wakeLock
    .request("screen")
    .then(
      (lock) => {
        if (wakeWanted) wakeLock = lock;
        else void lock.release().catch(() => {});
      },
      () => {},
    )
    .finally(() => {
      wakeRequest = null;
    });
}

/** The boot screen shows at least this long after first paint, then dissolves. */
const MIN_BOOT_MS = 900;
const BOOT_FADE_MS = 500;

type Controller = {
  store: SessionStore;
  voice: VoiceLine;
  runner: TurnRunner;
  lead: LeadLifecycle;
  recorder: HoldRecorder;
  hold: HoldTalk;
  /** Whether the person wants the microphone (false after "Type instead"). */
  voiceWanted: { current: boolean };
  /** Start was tapped: a second tap while the mic prompt is open must not start it twice. */
  starting: { current: boolean };
  /** The iPhone "Can't hear her?" row: tapped, or dismissed (and on which output). */
  hint: { tapped: boolean; dismissed: boolean; dismissedOnSpeakers: boolean };
  focusComposer: { current: () => void };
  /** The Retell voice line, once the server offers it and its chunk has loaded; else null. */
  retell: { current: RetellCall | null };
  /** Local saves and the end screen for Retell calls; the server writes their sheet row. */
  retellLead: LeadLifecycle;
  finishRetell: (end: RetellEnd) => void;
};

async function reflect(payload: LeadPayload): Promise<StoredLesson[] | null> {
  const response = await fetch("/api/reflect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      transcript: payload.transcript,
      outcome: payload.outcome,
      collected: {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        business: payload.business,
        industry: payload.industry,
        operations: payload.operations,
      },
      mode: payload.mode,
      turns: payload.turns,
      durationSec: payload.durationSec,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { ok: boolean; lessons?: StoredLesson[] };
  return body.ok ? (body.lessons ?? []) : null;
}

function createController(): Controller {
  const store = createSessionStore();
  const voice = new VoiceLine(store);
  const focusComposer = { current: () => {} };
  const lead = new LeadLifecycle({
    store,
    sessionId,
    syncLead,
    beaconLead,
    saveProgress,
    reflect,
    addLessons,
    context: browserContext,
    positionFor,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  // Assigned below; read only at call time.
  let hold: HoldTalk | null = null;
  const runner = new TurnRunner({
    store,
    streamTurn: streamMaryTurn,
    retryTurn: (request, signal) =>
      maryTurnBounded(
        {
          messages: request.messages,
          collected: request.collected as Record<string, string>,
          flags: request.flags,
        },
        signal,
      ),
    say: (text) => voice.say(text),
    aside: (text) => voice.aside(text),
    stopSpeaking: () => voice.stopSpeaking(),
    isHeld: () => voice.isHeld(),
    wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    lessons: (industry) => lessonsForTurn(industry),
    // The same openers Retell would use, spoken the moment the call opens; the
    // model only comes in once the person has answered.
    openingLine: (known) =>
      known.name
        ? welcomeBackLine(known.name)
        : OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)]!,
    online: () => navigator.onLine !== false,
    whenOnline: (signal) =>
      new Promise((resolve) => {
        if (navigator.onLine !== false || signal.aborted) return resolve();
        const done = () => {
          window.removeEventListener("online", done);
          signal.removeEventListener("abort", done);
          resolve();
        };
        window.addEventListener("online", done);
        signal.addEventListener("abort", done);
      }),
    onFinish: (collected, outcome) => void lead.finalize(collected, outcome),
    onSettled: () => {
      // Mid-hold the floor is already theirs; the hold decides what the screen shows.
      if (store.get().stage !== "call" || hold?.holding) return;
      store.dispatch({
        type: "SET_LISTENING",
        listening: store.get().mic.muted ? "paused" : "listening",
      });
      focusComposer.current();
    },
  });
  voice.onSend = (text) => void runner.send(text, "voice");
  voice.isBusy = () => runner.busy;

  // iPhone and iPad keep the microphone track live between holds (ElevenLabs
  // does the same): iOS then stays in its loudspeaker call mode for the whole call.
  const recorder = new HoldRecorder(isAppleMobile());
  recorder.onLevel = (level) => voiceLevel.set(level);
  // The floor is free again. "Thinking" belongs to a turn in progress, never to a
  // hold that came to nothing: that is how the orb used to stay stuck.
  const waiting = () => {
    store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    const presence = store.get().presence;
    if (presence === "hearing" || presence === "thinking")
      store.dispatch({ type: "SET_PRESENCE", presence: runner.busy ? "thinking" : "idle" });
  };
  hold = new HoldTalk({
    recorder,
    // Held audio is the person by definition: straight to transcription, no addressee judge.
    transcribeHeld: transcribeHeldAudio,
    onPress: () => {
      // Same event as the press: she goes quiet. A tap gives her the line back;
      // only a real hold (onCommit) ends it and drops the rest of her turn.
      voice.pauseForPress();
      voiceLevel.set(0);
      store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: false });
      store.dispatch({ type: "SET_PRESENCE", presence: "hearing" });
      store.dispatch({ type: "SET_LISTENING", listening: "hearing" });
    },
    onCommit: () => runner.interrupt(),
    onRelease: () => {
      store.dispatch({ type: "SET_LISTENING", listening: "finishing" });
      store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
    },
    onCancel: (reason) => {
      voice.resumeAfterTap();
      waiting();
      // A tap on the big button is the most common way to learn it wants a hold.
      if (reason === "short")
        store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: true });
    },
    onText: (text) => {
      store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: false });
      // Words came through: whatever the microphone notice said is over.
      if (store.get().mic.error) store.dispatch({ type: "SET_MIC", mic: { error: null } });
      void runner.send(text, "voice");
    },
    onMissed: (inARow) => {
      waiting();
      store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: true });
      if (inARow >= 2) store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: true });
    },
    onTranscribeFailed: () => {
      waiting();
      voice.aside(TRANSCRIBE_FAILED_LINE);
    },
    onError: (error) => {
      waiting();
      store.dispatch({ type: "SET_MIC", mic: { live: false, error: micMessage(error) } });
    },
    now: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });

  // Retell calls reuse the same finalize (local save, end screen, the sheet's answer), but the
  // server already wrote the row (save_lead and the webhook) and runs the debrief itself.
  let retellSynced: LeadSyncResult = { configured: false, saved: false, position: null };
  const retellLead = new LeadLifecycle({
    store,
    sessionId,
    syncLead: async () => retellSynced,
    beaconLead: () => {},
    saveProgress,
    reflect: async () => null,
    addLessons,
    context: browserContext,
    positionFor,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  const finishRetell = (end: RetellEnd) => {
    retellSynced = end.synced;
    void retellLead.finalize(end.collected, end.outcome);
  };
  return {
    store,
    voice,
    runner,
    lead,
    recorder,
    hold,
    voiceWanted: { current: true },
    starting: { current: false },
    hint: { tapped: false, dismissed: false, dismissedOnSpeakers: false },
    focusComposer,
    retell: { current: null },
    retellLead,
    finishRetell,
  };
}

/** Everything that runs only while the call screen is up. */
function useCallEffects(
  c: Controller,
  stage: string,
  micLive: boolean,
  micMuted: boolean,
  micAttempt: number,
  micError: string | null,
  talkMode: TalkMode,
  via: VoiceVia,
) {
  // Hands-free (quiet rooms): the line opens itself and stays open, like a phone call.
  useEffect(() => {
    if (stage !== "call" || talkMode !== "hands-free" || !c.voiceWanted.current) return;
    void c.voice.openMic();
    return () => c.voice.closeMic();
  }, [c, stage, micAttempt, talkMode]);

  // Hold to talk (the default): the microphone is ready, but only held audio counts.
  useEffect(() => {
    if (stage !== "call" || talkMode !== "hold" || !c.voiceWanted.current) return;
    let alive = true;
    c.recorder.open().then(
      () => {
        if (alive)
          c.store.dispatch({ type: "SET_MIC", mic: { live: true, muted: false, error: null } });
      },
      (error: unknown) => {
        if (alive)
          c.store.dispatch({ type: "SET_MIC", mic: { live: false, error: micMessage(error) } });
      },
    );
    c.store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    return () => {
      alive = false;
      c.hold.cancel();
      c.recorder.close();
      c.store.dispatch({ type: "SET_MIC", mic: { live: false } });
    };
  }, [c, stage, micAttempt, talkMode]);

  // Whatever opened the microphone (the hold effect, or a Hold press after "Type
  // instead"), it closes when the call screen goes away.
  useEffect(() => {
    if (stage === "call") return;
    c.hold.cancel();
    c.recorder.close();
  }, [c, stage]);

  // The screen stays on while the call is up, and the lock comes back after a tab switch.
  useEffect(() => {
    if (stage !== "call") return;
    holdScreenAwake(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") holdScreenAwake(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      holdScreenAwake(false);
    };
  }, [stage]);

  // Desktop: hold the space bar to talk. The answer box is focused after every
  // reply, so an empty box still means "talk"; once they start typing, space types.
  useEffect(() => {
    if (stage !== "call" || talkMode !== "hold") return;
    let spaceHeld = false;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        /^(INPUT|SELECT|BUTTON)$/.test(target.tagName) ||
        (target instanceof HTMLTextAreaElement && target.value !== ""));
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || (!spaceHeld && typing(event.target))) return;
      event.preventDefault();
      if (event.repeat || spaceHeld) return;
      spaceHeld = true;
      c.hold.press();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHeld) return;
      event.preventDefault();
      spaceHeld = false;
      c.hold.release();
    };
    const lost = () => {
      spaceHeld = false;
      c.hold.release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", lost);
    };
  }, [c, stage, talkMode]);

  // Allowing the microphone in the browser's settings brings the line back by itself.
  useEffect(() => {
    if (stage !== "call" || micLive || !c.voiceWanted.current) return;
    let stop = () => {};
    void (async () => {
      const state = await micPermissionState();
      if (state !== "denied" && state !== "prompt") return;
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        const onChange = () => {
          if (status.state === "granted")
            c.store.dispatch({
              type: "SET_MIC",
              mic: { error: null, attempt: c.store.get().mic.attempt + 1 },
            });
        };
        status.addEventListener("change", onChange);
        stop = () => status.removeEventListener("change", onChange);
      } catch {
        /* the browser keeps its permissions private; the mic button still works */
      }
    })();
    return () => stop();
  }, [c, stage, micLive]);

  // iPhone only: a "Can't hear her?" way out. Its tap is a fresh gesture iOS lets sound start
  // from, and nothing on the page can tell whether she is actually heard (a MediaStream
  // element's clock runs on wall time), so it stays until they say they hear her, or for the
  // first three answers. It comes back whenever her voice moves to another output.
  useEffect(() => {
    if (stage !== "call" || !isAppleMobile()) return;
    const update = () => {
      const state = c.store.get();
      const answers = state.lines.filter((line) => line.role === "user").length;
      const onSpeakers = c.voice.directOutputUsed();
      const show =
        !state.voiceOff &&
        (c.hint.dismissed
          ? onSpeakers !== c.hint.dismissedOnSpeakers
          : answers < 3 || c.hint.tapped || onSpeakers);
      c.store.dispatch({ type: "SET_NOTICE", key: "silentHint", value: show });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [c, stage]);

  // The call is over: her last line has finished, so the hidden element stops holding the
  // phone's audio (music can come back). Resume rebuilds it inside its own tap.
  useEffect(() => {
    if (stage === "done") releaseAudioOutput();
  }, [stage]);

  // A microphone that will not open leaves a Hold button that does nothing. The call
  // moves to typing instead, where the mic button is the way to ask again and every
  // microphone notice points at a control that exists.
  useEffect(() => {
    if (stage !== "call" || via === "retell" || talkMode !== "hold" || micLive || !micError) return;
    c.voiceWanted.current = false;
    c.store.dispatch({ type: "SET_TALK_MODE", mode: "hands-free" });
  }, [c, stage, talkMode, micLive, micError, via]);

  // Silence. She checks in after a while (sooner when she cannot hear you at all),
  // and a call nobody comes back to lets go: the microphone and the screen are
  // released, and whatever was said is kept. Retell's agent runs its own silence reminders.
  useEffect(() => {
    if (stage !== "call" || via === "retell") return;
    const canHear = micLive && !micMuted;
    const lines: readonly string[] = canHear ? SILENCE_NUDGES[talkMode] : IDLE_NUDGES;
    const nudgeAfter = canHear ? SILENCE_NUDGE_MS.canHear : SILENCE_NUDGE_MS.cannotHear;
    let lastChange = Date.now();
    let lastFromThem = Date.now();
    let answers = c.store.get().lines.filter((line) => line.role === "user").length;
    let nudges = 0;
    const theirs = () => {
      lastFromThem = Date.now();
      lastChange = lastFromThem;
    };
    const off = c.store.subscribe(() => {
      lastChange = Date.now();
      const state = c.store.get();
      const now = state.lines.filter((line) => line.role === "user").length;
      if (now !== answers || state.listening === "hearing" || state.interim) theirs();
      answers = now;
    });
    window.addEventListener("keydown", theirs);
    window.addEventListener("pointerdown", theirs);
    const timer = window.setInterval(() => {
      const state = c.store.get();
      if (
        c.runner.busy ||
        c.voice.isSpeaking() ||
        c.hold.holding ||
        state.listening === "hearing" ||
        state.listening === "finishing"
      )
        return;
      if (Date.now() - lastFromThem >= SILENCE_END_MS) {
        c.lead.flush();
        c.store.dispatch({ type: "FINISH", outcome: "declined" });
        return;
      }
      if (nudges >= lines.length || Date.now() - lastChange < nudgeAfter) return;
      const line = lines[nudges];
      nudges += 1;
      if (line) void c.voice.say(line);
    }, 4000);
    return () => {
      off();
      window.removeEventListener("keydown", theirs);
      window.removeEventListener("pointerdown", theirs);
      window.clearInterval(timer);
    };
  }, [c, stage, micLive, micMuted, talkMode, via]);

  // Tab closed or backgrounded mid-call: whatever was said still reaches the sheet.
  useEffect(() => {
    if (stage !== "call") return;
    // A Retell call is hung up with the tab; its webhook writes the row.
    if (via === "retell") {
      const hangUp = () => void c.retell.current?.end();
      window.addEventListener("pagehide", hangUp);
      return () => window.removeEventListener("pagehide", hangUp);
    }
    const flush = () => c.lead.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [c, stage, via]);
}

export function MaryApp() {
  const [c] = useState(createController);
  const { store } = c;
  const stage = useSession(store, (s) => s.stage);
  const mic = useSession(store, (s) => s.mic);
  const talkMode = useSession(store, (s) => s.talkMode);
  const via = useSession(store, (s) => s.via);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const viewportHeight = useViewportHeight();
  const keyboardHeight = useKeyboardViewport(stage === "call");
  const [boot, setBoot] = useState<"on" | "leaving" | "off">("on");

  // The orb shader compiles in the background while the boot screen is up.
  useEffect(() => warmOrb(), []);

  // The browser's first RTCPeerConnection initialises its whole WebRTC stack
  // synchronously (~1-1.5 s measured). The call's echo-cancelling loopback needs
  // one, so the stack is warmed while the landing is idle instead of on the tap.
  useEffect(() => {
    // Safari, iPhone and iPad never use the call route, so there is nothing to warm.
    if (typeof window.RTCPeerConnection === "undefined" || isWebKitEngine()) return;
    const warm = () => {
      try {
        new window.RTCPeerConnection().close();
      } catch {
        /* the call path reports WebRTC problems itself */
      }
    };
    const idle = window.requestIdleCallback?.(warm, { timeout: 4000 });
    const fallback = idle === undefined ? window.setTimeout(warm, 2500) : 0;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      window.clearTimeout(fallback);
    };
  }, []);

  // Boot: a short, fixed beat after first paint, then fade. The landing is already
  // rendered underneath and starts its entrance as the boot leaves.
  useEffect(() => {
    const paint = performance
      .getEntriesByType?.("paint")
      .find((e) => e.name === "first-contentful-paint");
    const elapsed = paint ? performance.now() - paint.startTime : 0;
    const leave = window.setTimeout(() => setBoot("leaving"), Math.max(0, MIN_BOOT_MS - elapsed));
    return () => window.clearTimeout(leave);
  }, []);
  useEffect(() => {
    if (boot !== "leaving") return;
    const done = window.setTimeout(() => setBoot("off"), BOOT_FADE_MS);
    return () => window.clearTimeout(done);
  }, [boot]);

  // Restore what is already known about this visitor, so MARY never re-asks it.
  useEffect(() => {
    const existing = loadProgress(sessionId());
    if (!existing || existing.complete) return;
    const known: Collected = {};
    for (const field of WAITLIST_FIELDS) if (existing[field]) known[field] = existing[field];
    if (Object.keys(known).length) store.dispatch({ type: "SET_COLLECTED", collected: known });
  }, [store]);

  // Which voice runs the call, asked once here and never inside a tap. Only a Retell answer
  // downloads its chunk; a tap before all this finishes (or any failure) is MARY's call.
  useEffect(() => {
    if (import.meta.env.SSR) return;
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      const status = await fetchVoiceStatus(window.fetch.bind(window), controller.signal);
      if (!alive || chooseVoiceProvider(status, window.location.search) !== "retell") return;
      const { createRetellCall } = await import("./voice/retell-loader");
      if (!alive) return;
      c.retell.current = createRetellCall(
        {
          store,
          level: voiceLevel,
          fetch: window.fetch.bind(window),
          sessionId,
          context: browserContext,
          releasePrimedMic,
          isVisible: () => document.visibilityState === "visible",
          finish: c.finishRetell,
          fallback: (queued) => {
            c.voiceWanted.current = false;
            if (queued.length) for (const text of queued) void c.runner.send(text, "text");
            else void c.runner.welcome();
          },
          now: () => Date.now(),
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (id) => window.clearTimeout(id),
        },
        { transcriptKey: status.transcriptKey },
      );
    })().catch(() => {});
    return () => {
      alive = false;
      controller.abort();
      c.retell.current?.dispose();
      c.retell.current = null;
    };
  }, [c, store]);

  // Every change to the collected details is saved at once and checkpointed to the sheet.
  useEffect(() => {
    let previous = store.get().collected;
    return store.subscribe(() => {
      const next = store.get().collected;
      if (next === previous) return;
      previous = next;
      (store.get().via === "retell" ? c.retellLead : c.lead).onCollectedChanged();
    });
  }, [c, store]);

  // Focus the composer only where a keyboard is already there; never pop one up on a phone.
  c.focusComposer.current = () => {
    const node = inputRef.current;
    if (node && (hasFinePointer() || document.activeElement === node))
      node.focus({ preventScroll: true });
  };

  useCallEffects(c, stage, mic.live, mic.muted, mic.attempt, mic.error, talkMode, via);

  useEffect(
    () => () => {
      c.voice.dispose();
      c.hold.cancel();
      c.recorder.close();
      c.lead.dispose();
      releasePrimedMic();
      releaseAudioOutput();
    },
    [c],
  );

  const start = useCallback(
    async (withVoice: boolean) => {
      if (store.get().stage !== "landing" || c.starting.current) return;
      c.starting.current = true;
      const retell = c.retell.current;
      if (withVoice && retell) {
        c.voiceWanted.current = false; // Retell owns the microphone; MARY's mic effects stay closed
        const micReady = primeMicPermission().then(
          () => true,
          (error: unknown) => {
            store.dispatch({ type: "SET_MIC", mic: { error: micMessage(error) } });
            return false;
          },
        );
        holdScreenAwake(true);
        retell.start(store.get().collected, micReady);
        return;
      }
      c.voiceWanted.current = withVoice;
      // Her voice always plays through an <audio> element. Safari, iPhone and iPad feed it
      // straight from Web Audio; a looped-back call stream can arrive muted there.
      setOutputRoute(isWebKitEngine() ? "element" : "call");
      // iPhone Safari grants the microphone only while the tap is still being
      // handled. The stream is kept: the line that records next takes it over.
      const primed = withVoice
        ? primeMicPermission().then(
            () => true,
            (error: unknown) => {
              store.dispatch({ type: "SET_MIC", mic: { error: micMessage(error) } });
              return false;
            },
          )
        : Promise.resolve(false);
      // The screen stays on for the call: iOS only grants that inside the tap.
      holdScreenAwake(true);
      await unlockAudio();
      const micLive = await primed;
      primeOutput({ micLive });
      store.dispatch({ type: "START_CALL", at: Date.now() });
      if (!withVoice) {
        // "Type instead" is a chat: her words appear at reading pace with no sound,
        // the Hold button stays away, and the mic button is the way to voice.
        store.dispatch({ type: "SET_TALK_MODE", mode: "hands-free" });
        store.dispatch({ type: "SET_VOICE_OFF", off: true });
        store.dispatch({ type: "SET_LISTENING", listening: "paused" });
      }
      void c.runner.welcome();
    },
    [c, store],
  );

  const send = useCallback(
    (text: string) => {
      const r = c.retell.current;
      if (store.get().via === "retell" && r?.active) {
        r.sendText(text);
        return;
      }
      c.voice.clearCutIn();
      void c.runner.send(text, "text");
    },
    [c, store],
  );

  const onMicButton = useCallback(() => {
    const current = store.get().mic;
    const r = c.retell.current;
    if (store.get().via === "retell" && r?.active) {
      if (current.live) r.setMuted(!current.muted);
      return;
    }
    if (!current.live) {
      c.voiceWanted.current = true;
      store.dispatch({
        type: "SET_MIC",
        mic: { muted: false, error: null, attempt: current.attempt + 1 },
      });
      return;
    }
    c.voice.setMicMuted(!current.muted);
  }, [c, store]);

  const onToggleVoice = useCallback(() => {
    const off = !store.get().voiceOff;
    store.dispatch({ type: "SET_VOICE_OFF", off });
    if (off) c.voice.stopSpeaking();
  }, [c, store]);

  const onHoldStart = useCallback(() => c.hold.press(), [c]);
  const onHoldEnd = useCallback(() => c.hold.release(), [c]);
  const onToggleTalkMode = useCallback(() => {
    c.voiceWanted.current = true;
    store.dispatch({
      type: "SET_TALK_MODE",
      mode: store.get().talkMode === "hold" ? "hands-free" : "hold",
    });
  }, [c, store]);

  const onPlaySound = useCallback(() => {
    c.hint.tapped = true;
    c.hint.dismissed = false;
    if (store.get().via === "retell") {
      void c.retell.current?.resumeAudio();
      return;
    }
    void replayLastLine({ otherOutput: true });
  }, [c, store]);
  const onHearHer = useCallback(() => {
    c.hint.dismissed = true;
    c.hint.dismissedOnSpeakers = c.voice.directOutputUsed();
    store.dispatch({ type: "SET_NOTICE", key: "silentHint", value: false });
  }, [c, store]);
  const onResume = useCallback(() => {
    const r = c.retell.current;
    if (store.get().via === "retell" && r) {
      // A new Retell call from this tap: same session, so the same sheet row.
      const micReady = primeMicPermission().then(
        () => true,
        (error: unknown) => {
          store.dispatch({ type: "SET_MIC", mic: { error: micMessage(error) } });
          return false;
        },
      );
      holdScreenAwake(true);
      c.retellLead.resume();
      r.start(store.get().collected, micReady);
      return;
    }
    // Inside the tap: the output element is rebuilt and started where iOS allows it.
    holdScreenAwake(true);
    void unlockAudio();
    c.lead.resume();
  }, [c, store]);
  const onRestart = useCallback(() => {
    c.retell.current?.dispose();
    c.voice.dispose();
    newSession();
    window.location.reload();
  }, [c]);

  const onHangUp = useCallback(() => void c.retell.current?.end(), [c]);

  // The no-AI form: the same pipeline as a finished conversation, so the row
  // lands in the sheet and the end screen tells them where they stand.
  const onFallbackSubmit = useCallback(
    (fields: FallbackFields) => {
      const collected: Collected = {
        ...store.get().collected,
        name: fields.name,
        email: fields.email,
      };
      if (fields.business) collected.business = fields.business;
      void c.lead.finalize(collected, "signed_up");
    },
    [c, store],
  );
  const onFallbackRetry = useCallback(() => {
    // Back to the call; the very next failed turn returns here.
    store.dispatch({ type: "RESUME" });
  }, [store]);

  const tight = viewportHeight < 640;
  const landingOrb = Math.round(
    Math.min(300, Math.max(136, viewportHeight * (tight ? 0.208 : 0.256))),
  );
  const callOrb = Math.round(
    Math.min(280, Math.max(112, (keyboardHeight ?? viewportHeight) * (tight ? 0.192 : 0.24))),
  );

  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <WaitlistVault />
      <LayoutGroup>
        <AnimatePresence initial={false}>
          {stage === "landing" && (
            <Landing key="landing" ready={boot !== "on"} orbSize={landingOrb} onStart={start} />
          )}
          {stage === "call" && (
            <CallStage
              key="call"
              store={store}
              orbSize={callOrb}
              height={keyboardHeight}
              inputRef={inputRef}
              onSend={send}
              onMicButton={onMicButton}
              onPlaySound={onPlaySound}
              onHearHer={onHearHer}
              onToggleVoice={onToggleVoice}
              onHoldStart={onHoldStart}
              onHoldEnd={onHoldEnd}
              onToggleTalkMode={onToggleTalkMode}
              onHangUp={via === "retell" ? onHangUp : undefined}
            />
          )}
          {stage === "fallback" && (
            <LeadFallback
              key="fallback"
              store={store}
              orbSize={landingOrb}
              onSubmit={onFallbackSubmit}
              onRetry={onFallbackRetry}
            />
          )}
          {stage === "done" && (
            <EndScreen
              key="done"
              store={store}
              orbSize={landingOrb}
              onResume={onResume}
              onRestart={onRestart}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>
      {boot !== "off" && <BootScreen leaving={boot === "leaving"} />}
    </main>
  );
}
