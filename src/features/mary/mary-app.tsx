import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "motion/react";

import { WaitlistVault } from "@/components/waitlist-vault";
import {
  primeMicPermission,
  micPermissionState,
  releaseAudioOutput,
  replayLastLine,
  transcribe,
  unlockAudio,
} from "@/lib/audio-engine";
import { addLessons, lessonsForTurn, type StoredLesson } from "@/lib/experience-store";
import { beaconLead, browserContext, syncLead, type LeadPayload } from "@/lib/lead-sync";
import { maryTurn, WAITLIST_FIELDS, type Collected } from "@/lib/mary.functions";
import { streamMaryTurn } from "@/lib/mary-stream";
import {
  loadProgress,
  newSession,
  positionFor,
  saveProgress,
  sessionId,
} from "@/lib/waitlist-store";

import { LeadLifecycle } from "./conversation/lead-lifecycle";
import { createSessionStore, useSession, type SessionStore } from "./conversation/store";
import { IDLE_NUDGES, micMessage } from "./conversation/text";
import type { TalkMode } from "./conversation/types";
import { voiceLevel } from "./signal/signal";
import { TurnRunner } from "./conversation/turn-runner";
import { BootScreen } from "./ui/boot-screen";
import { CallStage } from "./ui/call-stage";
import { EndScreen } from "./ui/end-screen";
import { Landing } from "./ui/landing";
import { hasFinePointer, useKeyboardViewport, useViewportHeight } from "./ui/use-viewport";
import { warmOrb } from "./ui/orb-renderer";
import { HoldRecorder } from "./voice/hold-recorder";
import { HoldTalk } from "./voice/hold-talk";
import { VoiceLine } from "./voice/voice-line";

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
  focusComposer: { current: () => void };
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
    retryTurn: (request) =>
      maryTurn({
        data: {
          messages: request.messages,
          collected: request.collected as Record<string, string>,
          flags: request.flags,
        },
      }),
    say: (text) => voice.say(text),
    stopSpeaking: () => voice.stopSpeaking(),
    isHeld: () => voice.isHeld(),
    wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    lessons: (industry) => lessonsForTurn(industry),
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

  const recorder = new HoldRecorder();
  recorder.onLevel = (level) => voiceLevel.set(level);
  const waiting = () => {
    store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    if (store.get().presence === "hearing")
      store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
  };
  hold = new HoldTalk({
    recorder,
    // Held audio is the person by definition: straight to transcription, no addressee judge.
    transcribeHeld: transcribe,
    onPress: () => {
      // Same event as the press: her audio stops and the rest of her turn is dropped.
      runner.interrupt();
      voiceLevel.set(0);
      store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: false });
      store.dispatch({ type: "SET_PRESENCE", presence: "hearing" });
      store.dispatch({ type: "SET_LISTENING", listening: "hearing" });
    },
    onRelease: () => {
      store.dispatch({ type: "SET_LISTENING", listening: "finishing" });
      store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
    },
    onCancel: waiting,
    onText: (text) => {
      store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: false });
      void runner.send(text, "voice");
    },
    onMissed: (inARow) => {
      waiting();
      store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: true });
      if (inARow >= 2) store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: true });
    },
    onError: (error) => {
      waiting();
      store.dispatch({ type: "SET_MIC", mic: { live: false, error: micMessage(error) } });
    },
    now: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  return {
    store,
    voice,
    runner,
    lead,
    recorder,
    hold,
    voiceWanted: { current: true },
    focusComposer,
  };
}

/** Everything that runs only while the call screen is up. */
function useCallEffects(
  c: Controller,
  stage: string,
  micLive: boolean,
  micMuted: boolean,
  micAttempt: number,
  talkMode: TalkMode,
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

  // Desktop: hold the space bar to talk (not while typing in the answer box).
  useEffect(() => {
    if (stage !== "call" || talkMode !== "hold") return;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return;
      event.preventDefault();
      if (!event.repeat) c.hold.press();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return;
      event.preventDefault();
      c.hold.release();
    };
    const lost = () => c.hold.release();
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

  // iPhone only: if her voice had to go to the speakers, the ring switch is the usual cause.
  useEffect(() => {
    if (stage !== "call") return;
    const apple =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!apple) return;
    const timer = window.setInterval(() => {
      if (c.voice.directOutputUsed())
        c.store.dispatch({ type: "SET_NOTICE", key: "silentHint", value: true });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [c, stage]);

  // She nudges only when she cannot hear you (muted, or no microphone) and nothing is happening.
  useEffect(() => {
    if (stage !== "call" || (micLive && !micMuted)) return;
    let lastActivity = Date.now();
    let nudges = 0;
    const touch = () => (lastActivity = Date.now());
    const off = c.store.subscribe(touch);
    window.addEventListener("keydown", touch);
    const timer = window.setInterval(() => {
      if (c.runner.busy || c.voice.isSpeaking() || nudges >= IDLE_NUDGES.length) return;
      if (Date.now() - lastActivity < 22000) return;
      const line = IDLE_NUDGES[nudges];
      nudges += 1;
      if (line) void c.voice.say(line);
    }, 4000);
    return () => {
      off();
      window.removeEventListener("keydown", touch);
      window.clearInterval(timer);
    };
  }, [c, stage, micLive, micMuted]);

  // Tab closed or backgrounded mid-call: whatever was said still reaches the sheet.
  useEffect(() => {
    if (stage !== "call") return;
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
  }, [c, stage]);
}

export function MaryApp() {
  const [c] = useState(createController);
  const { store } = c;
  const stage = useSession(store, (s) => s.stage);
  const mic = useSession(store, (s) => s.mic);
  const talkMode = useSession(store, (s) => s.talkMode);
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
    if (typeof window.RTCPeerConnection === "undefined") return;
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

  // Every change to the collected details is saved at once and checkpointed to the sheet.
  useEffect(() => {
    let previous = store.get().collected;
    return store.subscribe(() => {
      const next = store.get().collected;
      if (next === previous) return;
      previous = next;
      c.lead.onCollectedChanged();
    });
  }, [c, store]);

  // Focus the composer only where a keyboard is already there; never pop one up on a phone.
  c.focusComposer.current = () => {
    const node = inputRef.current;
    if (node && (hasFinePointer() || document.activeElement === node))
      node.focus({ preventScroll: true });
  };

  useCallEffects(c, stage, mic.live, mic.muted, mic.attempt, talkMode);

  useEffect(
    () => () => {
      c.voice.dispose();
      c.hold.cancel();
      c.recorder.close();
      c.lead.dispose();
      releaseAudioOutput();
    },
    [c],
  );

  const start = useCallback(
    async (withVoice: boolean) => {
      if (store.get().stage !== "landing") return;
      c.voiceWanted.current = withVoice;
      // iPhone Safari grants the microphone only while the tap is still being handled.
      const primed = withVoice
        ? primeMicPermission().catch((error: unknown) => {
            store.dispatch({ type: "SET_MIC", mic: { error: micMessage(error) } });
          })
        : Promise.resolve();
      await unlockAudio();
      await primed;
      store.dispatch({ type: "START_CALL", at: Date.now() });
      if (!withVoice) store.dispatch({ type: "SET_LISTENING", listening: "paused" });
      void c.runner.welcome();
    },
    [c, store],
  );

  const send = useCallback(
    (text: string) => {
      c.voice.clearCutIn();
      void c.runner.send(text, "text");
    },
    [c],
  );

  const onMicButton = useCallback(() => {
    const current = store.get().mic;
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

  const onPlaySound = useCallback(() => void replayLastLine({ viaSpeakers: true }), []);
  const onResume = useCallback(() => c.lead.resume(), [c]);
  const onRestart = useCallback(() => {
    c.voice.dispose();
    newSession();
    window.location.reload();
  }, [c]);

  const tight = viewportHeight < 640;
  const landingOrb = Math.round(
    Math.min(300, Math.max(170, viewportHeight * (tight ? 0.26 : 0.32))),
  );
  const callOrb = Math.round(
    Math.min(280, Math.max(140, (keyboardHeight ?? viewportHeight) * (tight ? 0.24 : 0.3))),
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
              onToggleVoice={onToggleVoice}
              onHoldStart={onHoldStart}
              onHoldEnd={onHoldEnd}
              onToggleTalkMode={onToggleTalkMode}
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
