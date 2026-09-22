import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Headphones, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";

import { AuroraBackground } from "./aurora-background";
import { BrandLockup } from "./brand-lockup";
import { MaryPresence, type PresenceState } from "./mary-presence";
import { ProgressConstellation } from "./progress-constellation";
import { Button } from "@/components/ui/button";
import lockupAsset from "@/assets/omnisuite-lockup.png.asset.json";
import {
  maryTurn,
  WAITLIST_FIELDS,
  type Collected,
  type MaryTurn,
  type TurnFlags,
} from "@/lib/mary.functions";
import { streamMaryTurn } from "@/lib/mary-stream";
import { OWNER_VIEW_EVENT, WaitlistVault } from "./waitlist-vault";
import {
  loadProgress,
  newSession,
  positionFor,
  saveProgress,
  sessionId,
} from "@/lib/waitlist-store";
import { addLessons, lessonsForTurn, type StoredLesson } from "@/lib/experience-store";
import {
  beaconLead,
  browserContext,
  syncLead,
  type LeadOutcome,
  type LeadPayload,
} from "@/lib/lead-sync";
import {
  audioDiagnostics,
  isInAppBrowser,
  micPermissionState,
  noteAddresseeVerdict,
  primeMicPermission,
  replayLastLine,
  MicUnavailableError,
  speak,
  startMicSession,
  transcribe,
  unlockAudio,
  type MicFailure,
  type MicSession,
  type SpeakHandle,
  type Utterance,
} from "@/lib/audio-engine";
import { judgeAddressee } from "@/lib/addressee";

/** Plain words for every way a microphone can fail to open. */
function micMessage(error: unknown): string {
  const reason: MicFailure = error instanceof MicUnavailableError ? error.reason : "unknown";
  // Inside Instagram, LinkedIn or WhatsApp there is no address bar and no
  // setting to change — the only real fix is opening the link properly.
  if (isInAppBrowser() && (reason === "denied" || reason === "unsupported")) {
    return "This is an in-app browser, so it won't hand me the microphone. Tap the ⋯ menu and choose “Open in browser” for voice — or just type here.";
  }
  switch (reason) {
    case "denied":
      return "I couldn't get the microphone. Tap the mic button to ask again, allow it, or just type — I'm reading either way.";
    case "no-device":
      return "I can't find a microphone on this device. Typing works perfectly.";
    case "busy":
      return "Another app is using your microphone. Close it, then tap the mic button to try again — or keep going by typing.";
    case "insecure":
      return "This page needs a secure (https) address to use the microphone. You can still type to me.";
    case "unsupported":
      return "This browser won't let me listen — Safari, Chrome or Edge will. Typing works here.";
    default:
      return "I couldn't open the microphone. Tap the mic button to try again, or keep going by typing.";
  }
}

/** The line dropped mid-call — say what happened and how to get it back. */
function micLostMessage(reason: MicFailure): string {
  if (reason === "busy")
    return "Something else took the microphone. Tap the mic button to pick the line back up, or carry on by typing.";
  return "The microphone disconnected — a headset unplugged, maybe. Tap the mic button to reopen the line, or keep typing.";
}
import {
  CUT_OFF_MARK,
  isEchoOfAssistant,
  spokenPortion,
  stripAssistantEcho,
} from "@/lib/voice-logic";

type Line = {
  id: string;
  role: "user" | "mary";
  text: string;
  /** She was cut off; `text` holds only what was actually heard. */
  interrupted?: boolean;
};
type ListeningPhase = "idle" | "listening" | "hearing" | "finishing" | "paused";
type Point = { x: number; y: number; w: number };
/** Screen-space path the OmniSuite mark travels during the intro. */
type Flight = { from: Point; mid: Point; to: Point };

/** The conversation as the model should see it. */
function toMessages(lines: Line[]) {
  return lines.map((line) => ({
    role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
    content: line.role === "mary" && line.interrupted ? `${line.text} ${CUT_OFF_MARK}` : line.text,
  }));
}

const MotionButton = motion.create(Button);

// Word-overlap check: catches MARY re-saying a line she already delivered.
function isNearRepeat(previous: string, next: string): boolean {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(Boolean),
    );
  const a = words(previous);
  const b = words(next);
  if (!a.size || !b.size) return false;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.min(a.size, b.size) >= 0.8;
}

// One motion vocabulary for the whole experience.
const EASE = [0.22, 1, 0.36, 1] as const;
const STAGE_IN = { duration: 0.6, ease: EASE } as const;
const SOFT = { duration: 0.42, ease: EASE } as const;
const SPRING = { type: "spring", stiffness: 210, damping: 26, mass: 0.9 } as const;

// Measures the stage element itself rather than the window, so browser zoom
// (which changes the CSS-pixel space without changing window.innerHeight)
// scales the composition just like a resize does.
function useStageHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const measured = node.clientHeight || node.getBoundingClientRect().height;
      if (measured > 0) setHeight(measured);
    };
    update();
    // Older browsers without ResizeObserver still get window-driven updates.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [ref]);
  return height;
}

/**
 * On phones the on-screen keyboard shrinks the visual viewport without
 * shrinking the layout — this follows it so the composer sits right above the
 * keys and nothing slides under the bottom edge.
 */
function useVisualViewport(active: boolean): { height: number; keyboard: boolean } | null {
  const [state, setState] = useState<{ height: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined" || !window.visualViewport) {
      setState(null);
      return;
    }
    const viewport = window.visualViewport;
    const update = () => {
      const height = Math.round(viewport.height);
      const keyboard = window.innerHeight - height > 120;
      setState({ height, keyboard });
      // iOS scrolls the page to reveal the focused field; with the shell
      // already sized to the visible area that scroll only hides the header.
      if (keyboard && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);
  return state;
}

// Only when she genuinely cannot hear you (muted mic, nothing typed for a while).
const IDLE_NUDGES = [
  "Whenever you're ready — you can talk to me or type it out.",
  "I'm still here. Say the word, or type it if that's easier.",
  "No rush at all — I'll be right here when you want to pick it back up.",
];

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  business: "Business",
  industry: "Industry",
  operations: "Operations",
};

type ConversationOutcome = "signed_up" | "callback" | "declined";

type ConversationResult = {
  outcome: ConversationOutcome;
  /** Confirmed by the sheet, or worked out locally when no sheet is connected. */
  position: number | null;
  sync: "pending" | "sheet" | "local" | "failed";
};

function uid() {
  return Math.random().toString(36).slice(2);
}

function transcriptOf(lines: Line[]): string {
  return lines
    .map(
      (line) =>
        `${line.role === "mary" ? "MARY" : "Guest"}: ${line.text}${line.interrupted ? " …" : ""}`,
    )
    .join("\n");
}

function fieldsKey(collected: Collected): string {
  return WAITLIST_FIELDS.map((field) => collected[field] ?? "").join("\u0001");
}

/** Copy for the end screen — personal, definite, and honest about what happens next. */
function closingCopy(outcome: ConversationOutcome, firstName: string, phone: string) {
  const who = firstName ? `, ${firstName}` : "";
  switch (outcome) {
    case "callback":
      return {
        eyebrow: "Callback requested",
        title: `We'll call you back${who}.`,
        body: `Your request is with the Omnikom team${phone ? ` — they'll reach you on ${phone}` : ""}. Nothing else to fill in.`,
        steps: [
          "The team receives your request straight away",
          phone ? `A real person calls you on ${phone}` : "A real person gets in touch",
          "Everything you told MARY travels with it, so nobody asks twice",
        ],
      };
    case "declined":
      return {
        eyebrow: "No pressure",
        title: `Thanks for the chat${who}.`,
        body: "No spot reserved, and that's completely fine. If OmniSuite becomes relevant later, MARY will be right here.",
        steps: [],
      };
    default:
      return {
        eyebrow: "Early access confirmed",
        title: `You're on the list${who}.`,
        body: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom.",
        steps: [
          "You hear from us first, the moment early access opens",
          "Invitations go out in order of position",
          "MARY already knows your setup — no forms later",
        ],
      };
  }
}

export function MaryExperience({ introDelay = 0 }: { introDelay?: number }) {
  const reduced = useReducedMotion();
  const shellRef = useRef<HTMLElement | null>(null);
  const viewportHeight = useStageHeight(shellRef);
  const trailRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const lockupRef = useRef<HTMLDivElement | null>(null);
  const introRef = useRef(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [stage, setStage] = useState<"landing" | "intro" | "live" | "done">("landing");
  const [lines, setLines] = useState<Line[]>([]);
  const [collected, setCollected] = useState<Collected>({});
  const [presence, setPresenceState] = useState<PresenceState>("idle");
  const [level, setLevel] = useState(0);
  const [reveal, setReveal] = useState<{ id: string; count: number }>({ id: "", count: 0 });
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [listeningPhase, setListeningPhase] = useState<ListeningPhase>("idle");
  const [muted, setMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  /** Bumped to ask the browser for the microphone all over again. */
  const [micAttempt, setMicAttempt] = useState(0);
  const [echoHint, setEchoHint] = useState(false);
  /** Her voice had to be pushed to the speakers — the phone may be on silent. */
  const [silentHint, setSilentHint] = useState(false);
  const [result, setResult] = useState<ConversationResult | null>(null);
  /** This visit's row in the browser store and in the sheet. */
  const entryIdRef = useRef<string>("session");
  const startedAtRef = useRef(0);
  /** Whether they spoke, typed, or both — kept for the record. */
  const sourceRef = useRef<{ voice: boolean; text: boolean }>({ voice: false, text: false });
  /** What the sheet last received, so nothing is re-sent for no reason. */
  const syncedRef = useRef<{ lines: number; fields: string; outcome: string }>({
    lines: 0,
    fields: "",
    outcome: "",
  });
  /** Their turn count at the last debrief — she does not review the same talk twice. */
  const reflectedAtRef = useRef(0);
  const checkpointRef = useRef(0);
  const viewport = useVisualViewport(stage === "live");

  const speakRef = useRef<SpeakHandle | null>(null);
  /** The line currently being voiced, so a cut-off can keep only what was heard. */
  const currentLineRef = useRef<{ id: string; text: string; handle: SpeakHandle } | null>(null);
  const sessionRef = useRef<MicSession | null>(null);
  const nudgeRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const busyRef = useRef(false);
  const interruptRef = useRef(false);
  /** A sound over her voice is being checked — she is paused meanwhile. */
  const pendingInterruptRef = useRef(false);
  /** The cut-in is real — she stays quiet until the person's words are handled. */
  const holdRef = useRef(false);
  /** When the hold started, so it can never last longer than a person would wait. */
  const holdSinceRef = useRef(0);
  const falseInterruptsRef = useRef(0);
  const couplingRef = useRef(0);
  const echoHintShownRef = useRef(false);
  const micMutedRef = useRef(false);
  const sessionFinishedRef = useRef(false);
  const flagsRef = useRef<TurnFlags>({ revealed: false, lanesDone: false, introDone: false });
  /** One queue for the whole call, so utterances are answered in the order they were said. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const turnGenerationRef = useRef(0);
  const handleUtteranceRef = useRef<(u: Utterance) => void>(() => {});

  const mutedRef = useRef(false);
  const collectedRef = useRef<Collected>({});
  const linesRef = useRef<Line[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /** Focus the text box only where a keyboard is already there — never pop one up on a phone. */
  const focusComposer = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    const desktop =
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    if (desktop || document.activeElement === node) node.focus({ preventScroll: true });
  }, []);

  /** The row the sheet receives, built from what is known right now. */
  const leadPayload = useCallback(
    (outcome: LeadOutcome, extra: Partial<LeadPayload> = {}): LeadPayload => {
      const known = collectedRef.current;
      const current = linesRef.current;
      const { voice, text } = sourceRef.current;
      return {
        sessionId: entryIdRef.current,
        outcome,
        name: known.name ?? "",
        email: known.email ?? "",
        phone: known.phone ?? "",
        business: known.business ?? "",
        industry: known.industry ?? "",
        operations: known.operations ?? "",
        callbackRequested: outcome === "callback" || Boolean(flagsRef.current.callback),
        transcript: transcriptOf(current),
        turns: current.filter((line) => line.role === "user").length,
        durationSec: startedAtRef.current
          ? Math.round((Date.now() - startedAtRef.current) / 1000)
          : 0,
        source: voice && text ? "mixed" : voice ? "voice" : text ? "text" : "none",
        mode: flagsRef.current.mode ?? "",
        startedAt: startedAtRef.current ? new Date(startedAtRef.current).toISOString() : "",
        ...browserContext(),
        localPosition: positionFor(known.email || entryIdRef.current),
        reflect: false,
        ...extra,
      };
    },
    [],
  );

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);
  useEffect(() => {
    collectedRef.current = collected;
    if (Object.keys(collected).length === 0) return;
    // Write through on every confirmed detail: a refresh mid-call loses nothing.
    saveProgress(entryIdRef.current, collected);
    // And a checkpoint reaches the sheet shortly after, so someone who leaves
    // mid-conversation still lands as a partial row with what they gave.
    if (stage !== "live" || sessionFinishedRef.current) return;
    window.clearTimeout(checkpointRef.current);
    checkpointRef.current = window.setTimeout(() => {
      if (sessionFinishedRef.current) return;
      syncedRef.current = {
        lines: linesRef.current.length,
        fields: fieldsKey(collectedRef.current),
        outcome: "in_progress",
      };
      void syncLead(leadPayload("in_progress"));
    }, 5000);
    return () => window.clearTimeout(checkpointRef.current);
  }, [collected, leadPayload, stage]);

  // Pick up this visit's row, and anything already known about this person.
  useEffect(() => {
    const id = sessionId();
    entryIdRef.current = id;
    const existing = loadProgress(id);
    if (!existing || existing.complete) return;
    const known: Collected = {};
    for (const field of WAITLIST_FIELDS) {
      const value = existing[field];
      if (value) known[field] = value;
    }
    if (Object.keys(known).length > 0) {
      collectedRef.current = known;
      setCollected(known);
    }
  }, []);

  /** Lines are written to the ref first so the queue never reads a stale list. */
  const commitLines = useCallback((next: Line[]) => {
    linesRef.current = next;
    setLines(next);
  }, []);

  /**
   * Ends whatever she is saying. If she was mid-line, the transcript keeps only
   * the words that were actually heard and marks the line as cut off — so the
   * model never believes she finished a sentence the person talked over.
   */
  const stopSpeaking = useCallback(() => {
    const current = currentLineRef.current;
    const handle = speakRef.current;
    if (current && handle) {
      const { spoken, cut } = spokenPortion(current.text, handle.spokenFraction());
      if (cut) {
        const next = spoken
          ? linesRef.current.map((line) =>
              line.id === current.id ? { ...line, text: spoken, interrupted: true } : line,
            )
          : linesRef.current.filter((line) => line.id !== current.id);
        commitLines(next);
      }
    }
    handle?.stop();
    speakRef.current = null;
    currentLineRef.current = null;
  }, [commitLines]);

  /** She was held for a sound that turned out to be nothing — she carries on. */
  const releaseHold = useCallback(() => {
    holdRef.current = false;
    holdSinceRef.current = 0;
    pendingInterruptRef.current = false;
    const handle = speakRef.current;
    if (handle?.isPaused()) {
      handle.resume();
      setPresenceState("speaking");
    }
  }, []);

  const say = useCallback(
    (text: string, opts: { record?: boolean } = { record: true }) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      const id = uid();
      if (opts.record !== false) commitLines([...linesRef.current, { id, role: "mary", text }]);
      setReveal({ id, count: 0 });
      // Your answer is in; the line is open again while she talks.
      setListeningPhase((phase) =>
        phase === "finishing" ? (micMutedRef.current ? "paused" : "listening") : phase,
      );

      // Rough spoken length, used only as a floor while the audio stream fills.
      const approx = Math.max(1.4, words * 0.42);

      if (mutedRef.current) {
        const duration = approx * 1000;
        const start = performance.now();
        let raf = 0;
        const animateWords = () => {
          const progress = Math.min(1, (performance.now() - start) / duration);
          setReveal({ id, count: Math.ceil(progress * words) });
          if (progress < 1) raf = requestAnimationFrame(animateWords);
        };
        raf = requestAnimationFrame(animateWords);
        setPresenceState("speaking");
        return new Promise<void>((resolve) => {
          window.setTimeout(() => {
            cancelAnimationFrame(raf);
            setReveal({ id, count: words });
            setPresenceState("idle");
            resolve();
          }, duration);
        });
      }

      stopSpeaking();
      setPresenceState("speaking");
      const handle = speak(text, {
        onLevel: setLevel,
        approxDurationSec: approx,
        // Words land in step with the voice the person is actually hearing.
        onProgress: (progress) => setReveal({ id, count: Math.ceil(progress * words) }),
        onEnd: () => {
          setReveal({ id, count: words });
          if (currentLineRef.current?.handle === handle) currentLineRef.current = null;
          if (speakRef.current === handle) speakRef.current = null;
          setPresenceState((current) => (current === "speaking" ? "idle" : current));
        },
      });
      // If the person is already talking, the line waits its turn.
      if (pendingInterruptRef.current || holdRef.current) handle.pause();
      currentLineRef.current = { id, text, handle };
      speakRef.current = handle;
      return handle.done;
    },
    [commitLines, stopSpeaking],
  );

  /**
   * MARY's debrief: what worked, what stalled, what to do differently. The
   * lessons come back here for this browser and are pooled in the sheet.
   */
  const debrief = useCallback(async (payload: LeadPayload) => {
    if (payload.turns < 2 || payload.turns - reflectedAtRef.current < 2) return;
    reflectedAtRef.current = payload.turns;
    try {
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
      if (!response.ok) return;
      const body = (await response.json()) as { ok: boolean; lessons?: StoredLesson[] };
      if (body.ok && body.lessons?.length) addLessons(body.lessons);
    } catch {
      // A missed debrief costs nothing but a lesson.
    }
  }, []);

  const finalize = useCallback(
    (finalCollected: Collected, outcome: ConversationOutcome) => {
      sessionFinishedRef.current = true;
      sessionRef.current?.setMuted(true);
      // A pending checkpoint must never land after the final write.
      window.clearTimeout(checkpointRef.current);
      collectedRef.current = finalCollected;

      // Written straight to this browser first — the end screen never waits.
      const entry = saveProgress(entryIdRef.current, {
        name: finalCollected.name ?? "",
        email: finalCollected.email ?? "",
        phone: finalCollected.phone ?? "",
        business: finalCollected.business ?? "",
        industry: finalCollected.industry ?? "",
        operations: finalCollected.operations ?? "",
        transcript: transcriptOf(linesRef.current),
        complete: outcome === "signed_up",
        callbackRequested: outcome === "callback",
      });
      setResult({ outcome, position: null, sync: "pending" });
      setStage("done");
      setPresenceState("done");

      const payload = leadPayload(outcome);
      syncedRef.current = {
        lines: linesRef.current.length,
        fields: fieldsKey(finalCollected),
        outcome,
      };
      void (async () => {
        const synced = await syncLead(payload);
        setResult((current) => {
          if (!current) return current;
          if (!synced.configured) {
            // No sheet yet: the position is worked out on the spot, as before.
            return { ...current, sync: "local", position: entry.position };
          }
          if (synced.saved) {
            return {
              ...current,
              sync: "sheet",
              position: synced.position ?? (outcome === "signed_up" ? entry.position : null),
            };
          }
          return { ...current, sync: "failed", position: null };
        });
        await debrief(payload);
      })();
    },
    [debrief, leadPayload],
  );

  /** They changed their mind after declining — the call simply picks back up. */
  const resume = useCallback(() => {
    sessionFinishedRef.current = false;
    setResult(null);
    setPresenceState("idle");
    setStage("live");
    lastActivityRef.current = Date.now();
  }, []);

  /** A clean slate: new visit id, fresh conversation. */
  const restart = useCallback(() => {
    speakRef.current?.stop();
    newSession();
    window.location.reload();
  }, []);

  /** Five quick taps on "omnikom" open the owner view where there is no keyboard. */
  const ownerTapsRef = useRef<number[]>([]);
  const ownerTap = useCallback(() => {
    const now = Date.now();
    ownerTapsRef.current = [...ownerTapsRef.current.filter((t) => now - t < 2000), now];
    if (ownerTapsRef.current.length >= 5) {
      ownerTapsRef.current = [];
      window.dispatchEvent(new Event(OWNER_VIEW_EVENT));
    }
  }, []);

  const runTurn = useCallback(
    async (nextLines: Line[]) => {
      busyRef.current = true;
      interruptRef.current = false;
      // Every turn gets its own number; a turn that was overtaken by a newer
      // one stops at its next step instead of speaking over it.
      const generation = ++turnGenerationRef.current;
      const stale = () => turnGenerationRef.current !== generation || interruptRef.current;
      setPresenceState("thinking");
      /** Beats the person heard all the way through this turn. */
      const heard: string[] = [];
      const deliver = async (text: string) => {
        await say(text);
        // A cut-off flips interruptRef before the line resolves, so anything
        // that resolves without it was heard all the way through.
        if (!stale()) heard.push(text);
      };
      try {
        const messages = toMessages(nextLines);
        const previous = nextLines.filter((line) => line.role === "mary").map((line) => line.text);
        const request = {
          messages,
          collected: collectedRef.current,
          flags: flagsRef.current,
          // What she learned from earlier conversations on this device.
          experience: lessonsForTurn(collectedRef.current.industry),
        };

        // Her first beat starts playing the moment it is written, while the
        // rest of the turn is still being generated.
        let firstBeat: Promise<void> | null = null;
        let turn: MaryTurn = await streamMaryTurn(request, (text) => {
          if (stale()) return;
          if (previous.some((prev) => isNearRepeat(prev, text))) return;
          if (!firstBeat) firstBeat = deliver(text);
        });
        if (stale()) return;

        // Safety net: if MARY nearly repeats a line she already said, ask for a fresh take once.
        if (!firstBeat && previous.some((prev) => isNearRepeat(prev, turn.say)) && !turn.complete) {
          try {
            const fresh = await maryTurn({
              data: {
                messages: [
                  ...messages,
                  { role: "assistant" as const, content: turn.say },
                  {
                    role: "user" as const,
                    content:
                      "(You just repeated yourself. Say something completely different that reacts to me and moves us forward.)",
                  },
                ],
                collected: collectedRef.current as Record<string, string>,
                flags: flagsRef.current,
              },
            });
            if (!isNearRepeat(turn.say, fresh.say))
              turn = { ...fresh, collected: { ...turn.collected, ...fresh.collected } };
          } catch {
            // keep the original line if the retry fails
          }
        }

        if (stale()) return;
        setCollected(turn.collected);
        collectedRef.current = turn.collected;

        if (firstBeat) await firstBeat;
        // The streamed beat was suppressed as a repeat, so the final line must
        // not slip the same words through the back door.
        else if (!previous.some((prev) => isNearRepeat(prev, turn.say))) await deliver(turn.say);
        // They cut in while she was thinking or mid-first-beat: their words are
        // already queued as the next turn, so this one ends here.
        if (stale()) return;

        if (turn.followUp && !holdRef.current) {
          // Second beat: a short breath, then the question lands as its own moment.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
          if (!stale() && !holdRef.current) await deliver(turn.followUp);
        }
        if (stale()) return;

        // The reveal and the lanes only count once they were heard in full.
        const heardText = heard.join(" ");
        flagsRef.current = {
          revealed: flagsRef.current.revealed || (turn.revealed && /convert/i.test(heardText)),
          lanesDone:
            flagsRef.current.lanesDone ||
            (turn.lanesDone && /cultivate/i.test(heardText) && /recover/i.test(heardText)),
          // The intro counts once she actually got who she is and what
          // OmniSuite is out loud — a cut-off welcome resumes next turn.
          introDone: flagsRef.current.introDone || (turn.introDone && /omnisuite/i.test(heardText)),
          // Carried forward so the next turn knows where the conversation stands.
          wrapAsked: flagsRef.current.wrapAsked || turn.wrapAsked,
          callback: flagsRef.current.callback || turn.callbackRequested,
          mode: turn.mode,
          rejected: turn.rejected,
        };

        // How this conversation ends, if it ends here. Her last words are left
        // on screen for a breath before the end screen; if they speak in that
        // breath, the conversation simply carries on.
        const ending: ConversationOutcome | null =
          turn.callbackRequested && turn.collected.name && turn.collected.phone
            ? "callback"
            : turn.complete &&
                WAITLIST_FIELDS.filter((field) => field !== "phone").every(
                  (field) => turn.collected[field],
                )
              ? "signed_up"
              : turn.declined
                ? "declined"
                : null;
        if (ending) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1300));
          if (!stale()) finalize(turn.collected, ending);
        }
      } catch {
        if (!stale()) await say("I hit a snag on my side — could you try that once more?");
      } finally {
        // Only the newest turn hands the floor back.
        if (turnGenerationRef.current === generation) {
          busyRef.current = false;
          lastActivityRef.current = Date.now();
          setListeningPhase(micMutedRef.current ? "paused" : "listening");
          focusComposer();
        }
      }
    },
    [finalize, focusComposer, say],
  );

  const sendUser = useCallback(
    (text: string, via: "voice" | "text" = "text") => {
      const clean = text.trim();
      if (!clean) return chainRef.current;
      sourceRef.current[via] = true;
      // Talking (or typing) over her ends her turn immediately — and only the
      // words she actually got out stay in the transcript.
      interruptRef.current = true;
      holdRef.current = false;
      pendingInterruptRef.current = false;
      stopSpeaking();
      busyRef.current = true;
      // One queue: anything said while she is mid-turn is answered next, in order.
      const run = chainRef.current
        .then(async () => {
          if (sessionFinishedRef.current) return;
          stopSpeaking();
          setInterim("");
          setDraft("");
          commitLines([...linesRef.current, { id: uid(), role: "user" as const, text: clean }]);
          await runTurn(linesRef.current);
        })
        .catch(() => {});
      chainRef.current = run;
      return run;
    },
    [commitLines, runTurn, stopSpeaking],
  );

  /** A complete utterance came off the open line. */
  const handleUtterance = useCallback(
    async (utterance: Utterance) => {
      if (sessionFinishedRef.current || micMutedRef.current) {
        releaseHold();
        return;
      }
      const recentMary = linesRef.current
        .filter((line) => line.role === "mary")
        .slice(-6)
        .map((line) => line.text);

      let spoken = utterance.text.trim();
      const worthTranscribing =
        !spoken && utterance.audio && utterance.durationMs >= 350 && utterance.peak >= 0.02;
      if (worthTranscribing && utterance.audio) {
        setListeningPhase("finishing");
        setPresenceState("thinking");
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
      setInterim("");
      if (!spoken) {
        // Nothing real was said. If she was held mid-line, she picks up where she left off.
        const wasHeld = holdRef.current || speakRef.current?.isPaused();
        releaseHold();
        setListeningPhase(micMutedRef.current ? "paused" : "listening");
        setPresenceState((current) =>
          current === "hearing" || current === "thinking"
            ? wasHeld && speakRef.current
              ? "speaking"
              : "idle"
            : current,
        );
        return;
      }
      // Words alone do not make it hers. Before she reacts, a fast background
      // judgement decides whether that was the person talking to her or the
      // room talking among themselves.
      const lastMary = recentMary[recentMary.length - 1] ?? "";
      const verdict = await judgeAddressee({
        heard: spoken,
        lastAssistant: lastMary,
        recent: linesRef.current.slice(-6).map((line) => `${line.role}: ${line.text}`),
      });
      noteAddresseeVerdict(verdict);
      sessionRef.current?.noteVerdict(verdict === "mary" ? "mary" : "ambient", utterance.peak);
      if (verdict !== "mary") {
        // Not for her: she never heard it. If she had gone quiet for it, she
        // carries straight on; nothing is learned from it either.
        const wasHeld = holdRef.current || speakRef.current?.isPaused();
        releaseHold();
        setListeningPhase(micMutedRef.current ? "paused" : "listening");
        setPresenceState((current) =>
          current === "hearing" || current === "thinking"
            ? wasHeld && speakRef.current
              ? "speaking"
              : "idle"
            : current,
        );
        return;
      }
      void sendUser(spoken, "voice");
    },
    [releaseHold, sendUser],
  );

  handleUtteranceRef.current = (utterance) => void handleUtterance(utterance);

  const enterLive = useCallback(async () => {
    setStage("live");
    lastActivityRef.current = Date.now();
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    // Her welcome sits in the same queue as everything said after it.
    const run = chainRef.current.then(() => runTurn([])).catch(() => {});
    chainRef.current = run;
    await run;
  }, [runTurn]);

  // Talk to MARY: the attribution wipes back behind the divider, the page
  // scrolls away under a blur, and the mark flies to centre, blooms, then
  // pops up to its resting place in the corner.
  const begin = useCallback(async () => {
    if (introRef.current) return;
    introRef.current = true;
    // iPhone Safari only grants the microphone while the tap is still being
    // handled, so it is asked for here — before any animation or await.
    const primed = primeMicPermission().catch((error: unknown) => {
      setMicError(micMessage(error));
      return null;
    });
    await unlockAudio();
    await primed;

    if (reduced) {
      await enterLive();
      return;
    }

    setStage("intro");

    window.setTimeout(() => {
      const mark = lockupRef.current?.querySelector("img");
      if (!mark) return;
      const r = mark.getBoundingClientRect();
      // Cap the growth at the mark's native width so it stays razor sharp.
      const grown = Math.min(r.width * 3.1, Math.min(380, window.innerWidth * 0.7));
      const grownH = (grown / r.width) * r.height;
      // Resting place: the header's left edge, at the compact mark height.
      const header = headerRef.current?.getBoundingClientRect();
      const restW = r.width * (28 / r.height);
      setFlight({
        from: { x: r.left, y: r.top, w: r.width },
        mid: {
          x: window.innerWidth / 2 - grown / 2,
          y: window.innerHeight / 2 - grownH / 2,
          w: grown,
        },
        to: {
          x: header?.left ?? r.left,
          y: (header?.top ?? r.top) + Math.max(0, ((header?.height ?? 48) - 28) / 2),
          w: restW,
        },
      });
    }, 520);

    window.setTimeout(() => {
      void enterLive();
    }, 2800);
  }, [enterLive, reduced]);

  const maybeShowEchoHint = useCallback(() => {
    if (echoHintShownRef.current) return;
    if (couplingRef.current < 0.45 || falseInterruptsRef.current < 2) return;
    echoHintShownRef.current = true;
    setEchoHint(true);
    window.setTimeout(() => setEchoHint(false), 9000);
  }, []);

  // The line opens itself the moment the conversation starts and stays open,
  // exactly like a phone call. Nothing is torn down between turns.
  useEffect(() => {
    if (stage !== "live") return;
    let cancelled = false;
    let session: MicSession | null = null;

    void (async () => {
      try {
        session = await startMicSession({
          onLevel: setLevel,
          onInterim: (text) => setInterim(text),
          // You started talking while she was quiet.
          onSpeechStart: () => {
            lastActivityRef.current = Date.now();
            setListeningPhase("hearing");
            setPresenceState("hearing");
          },
          // A sound over her voice: she pauses on the spot while it is checked.
          onInterruptCandidate: () => {
            lastActivityRef.current = Date.now();
            pendingInterruptRef.current = true;
            speakRef.current?.pause();
            setListeningPhase("hearing");
            setPresenceState("hearing");
          },
          // It really is you: she stays quiet until your words have been handled.
          onInterruptConfirmed: () => {
            pendingInterruptRef.current = false;
            holdRef.current = true;
            holdSinceRef.current = Date.now();
          },
          // Her own voice in the room, or a passing noise: she carries on.
          // `heldFirst` means she had already gone quiet for it and nothing
          // usable came of it — that hold has to be lifted here, or she waits
          // for a sentence that will never arrive.
          onInterruptCancelled: (heldFirst) => {
            pendingInterruptRef.current = false;
            falseInterruptsRef.current += 1;
            if (heldFirst) {
              releaseHold();
            } else if (!holdRef.current) {
              const handle = speakRef.current;
              if (handle?.isPaused()) handle.resume();
              setPresenceState(handle ? "speaking" : "idle");
            }
            setListeningPhase("listening");
            maybeShowEchoHint();
          },
          onEchoCoupling: (coupling) => {
            couplingRef.current = coupling;
            maybeShowEchoHint();
          },
          onUtterance: (utterance) => handleUtteranceRef.current(utterance),
          // Voices across the room. She never heard them, and never waits on them.
          onAmbient: () => {
            noteAddresseeVerdict("ambient");
            releaseHold();
            setInterim("");
            setListeningPhase(micMutedRef.current ? "paused" : "listening");
          },
          // Headset unplugged, or another app grabbed the mic mid-call.
          onLost: (reason) => {
            if (cancelled) return;
            sessionRef.current = null;
            setMicLive(false);
            setMicError(micLostMessage(reason));
            setListeningPhase("paused");
            setInterim("");
            setLevel(0);
            session?.close();
          },
        });
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        session.setMuted(micMutedRef.current);
        setMicLive(true);
        setMicError(null);
        setListeningPhase(micMutedRef.current ? "paused" : "listening");
      } catch (error) {
        if (cancelled) return;
        setMicLive(false);
        setMicError(micMessage(error));
        setListeningPhase("paused");
        inputRef.current?.focus();
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current = null;
      setMicLive(false);
      session?.close();
    };
  }, [maybeShowEchoHint, micAttempt, releaseHold, stage]);

  // Last line of defence: whatever went wrong, she never stays frozen waiting
  // for a sentence. Nobody should have to mute themselves to get her back.
  useEffect(() => {
    if (stage !== "live") return;
    const timer = window.setInterval(() => {
      if (!holdRef.current || busyRef.current) return;
      if (Date.now() - holdSinceRef.current < 5000) return;
      releaseHold();
      setListeningPhase("listening");
    }, 1000);
    return () => window.clearInterval(timer);
  }, [releaseHold, stage]);

  // If her voice ever had to be forced to the speakers, the phone's ring
  // switch is the usual culprit — say so plainly, once.
  useEffect(() => {
    if (stage !== "live" || silentHint) return;
    // Only iPhones and iPads have the silent switch this hint is about; on
    // other browsers the plain route is a normal fallback, not a problem.
    const apple =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!apple) return;
    const timer = window.setInterval(() => {
      if (audioDiagnostics().directOutput) setSilentHint(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [silentHint, stage]);

  /** Ask for the microphone again — after a refusal, a swap, or a stolen line. */
  const retryMic = useCallback(() => {
    lastActivityRef.current = Date.now();
    micMutedRef.current = false;
    setMicMuted(false);
    setMicError(null);
    setMicAttempt((n) => n + 1);
  }, []);

  // If they go into browser settings and allow the microphone, the line should
  // come back on its own — nobody should have to reload to be heard.
  useEffect(() => {
    if (stage !== "live" || micLive) return;
    let stop = () => {};
    void (async () => {
      const state = await micPermissionState();
      if (state !== "denied" && state !== "prompt") return;
      try {
        const status = await (
          navigator as unknown as {
            permissions: {
              query: (d: { name: string }) => Promise<{
                state: string;
                addEventListener?: (t: string, fn: () => void) => void;
                removeEventListener?: (t: string, fn: () => void) => void;
              }>;
            };
          }
        ).permissions.query({ name: "microphone" });
        const onChange = () => {
          if (status.state === "granted") retryMic();
        };
        status.addEventListener?.("change", onChange);
        stop = () => status.removeEventListener?.("change", onChange);
      } catch {
        /* the browser keeps its permissions private; the mic button still works */
      }
    })();
    return () => stop();
  }, [micLive, retryMic, stage]);

  /** Mute keeps the call open but stops her hearing you. */
  const toggleMicMute = useCallback(() => {
    lastActivityRef.current = Date.now();
    const next = !micMutedRef.current;
    micMutedRef.current = next;
    setMicMuted(next);
    sessionRef.current?.setMuted(next);
    setInterim("");
    setLevel(0);
    if (next) {
      releaseHold();
      setListeningPhase("paused");
      setPresenceState((current) =>
        current === "hearing" || current === "listening" ? "idle" : current,
      );
    } else {
      setListeningPhase("listening");
    }
  }, [releaseHold]);

  // Typing is quiet time: she waits, exactly like someone watching you write.
  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (stage !== "live") return;
    // She nudges when she cannot hear you: muted, or no microphone at all.
    const deaf = micMuted || !micLive;
    if (!deaf) return;
    const timer = window.setInterval(() => {
      if (busyRef.current || speakRef.current || draft.length > 0) return;
      if (Date.now() - lastActivityRef.current < 22000 || nudgeRef.current >= IDLE_NUDGES.length)
        return;
      lastActivityRef.current = Date.now();
      const line = IDLE_NUDGES[nudgeRef.current];
      nudgeRef.current += 1;
      if (line) void say(line);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [draft.length, micLive, micMuted, say, stage]);

  useEffect(() => {
    return () => {
      speakRef.current?.stop();
      sessionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (stage === "live") focusComposer();
  }, [focusComposer, stage]);

  // Keep the newest turn in view without ever showing a scrollbar.
  useEffect(() => {
    const node = trailRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, interim, stage, viewportHeight, reveal.count]);

  // If the tab closes or goes to the background mid-conversation, whatever was
  // said still reaches the sheet as a partial row — and MARY still debriefs it.
  useEffect(() => {
    if (stage !== "live") return;
    const flush = () => {
      if (sessionFinishedRef.current) return;
      const current = linesRef.current;
      const turns = current.filter((line) => line.role === "user").length;
      if (turns < 1) return;
      const fields = fieldsKey(collectedRef.current);
      const already = syncedRef.current;
      if (
        already.outcome === "abandoned" &&
        already.lines === current.length &&
        already.fields === fields
      )
        return;
      const reflect = turns >= 2 && turns - reflectedAtRef.current >= 2;
      if (reflect) reflectedAtRef.current = turns;
      syncedRef.current = { lines: current.length, fields, outcome: "abandoned" };
      beaconLead(leadPayload("abandoned", { reflect }));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [leadPayload, stage]);

  // The centre holds her latest line; everything before it stays in order above.
  const last = lines[lines.length - 1];
  const lastMary = last?.role === "mary" ? last : undefined;
  const history = (lastMary ? lines.slice(0, -1) : lines).slice(-6);

  // The end screen speaks to the person by name and shows what was kept.
  const firstName = (collected.name ?? "").trim().split(/\s+/)[0] ?? "";
  const closing = result ? closingCopy(result.outcome, firstName, collected.phone ?? "") : null;
  const confirmedFields = WAITLIST_FIELDS.filter(
    (field) => collected[field] || (field === "phone" && result?.outcome === "signed_up"),
  ).map((field) => [field, collected[field] ?? ""] as const);

  // Once she is actually talking, that is the truth of the moment — whatever
  // the microphone was doing a second ago.
  const statusKey =
    presence === "speaking" && !micMuted
      ? "speaking"
      : listeningPhase === "hearing" || listeningPhase === "finishing"
        ? listeningPhase
        : presence === "thinking"
          ? "thinking"
          : micMuted
            ? "muted"
            : "live";
  // With no working microphone every prompt has to point at typing instead.
  const typingOnly = !micLive && !!micError;
  const statusText =
    statusKey === "hearing"
      ? "Go ahead — I'm listening."
      : statusKey === "finishing"
        ? "Got it. MARY is preparing her reply."
        : statusKey === "thinking"
          ? "MARY is thinking…"
          : statusKey === "muted"
            ? "Your microphone is muted. Unmute to keep talking, or type."
            : statusKey === "speaking"
              ? typingOnly
                ? "MARY is speaking."
                : "MARY is speaking. Just talk to cut in."
              : typingOnly
                ? "Type your reply — MARY is reading."
                : "MARY is listening. Just talk — she answers when you pause.";

  const pulseScale = 1 + Math.min(0.12, level * 0.1);
  const compact = viewportHeight < 780;
  const tight = viewportHeight < 620;
  // The presence sizes itself from its box including halo + ground shadow,
  // so it gets a taller stage and still never touches the edges.
  const landingOrb = Math.max(
    tight ? 104 : 140,
    Math.min(260, Math.round(viewportHeight * (tight ? 0.22 : 0.26))),
  );
  const liveOrb = Math.max(
    tight ? 88 : 110,
    Math.min(180, Math.round(viewportHeight * (tight ? 0.16 : 0.19))),
  );

  // The call is one fixed screen: the thread scrolls inside it, and the
  // composer stays put above the keyboard. Every other stage flows as usual.
  const locked = stage === "live";

  return (
    <main
      ref={shellRef}
      className={`no-scrollbar relative ${locked ? "h-dvh overflow-hidden" : "min-h-dvh overflow-y-auto"}`}
      style={locked && viewport ? { height: viewport.height } : undefined}
    >
      <AuroraBackground intensity={stage === "landing" ? 0.18 : Math.min(1, 0.4 + level)} />
      <WaitlistVault />
      <div
        className={`relative z-10 mx-auto flex w-full max-w-5xl flex-col px-5 sm:px-8 ${locked ? "h-full py-3 sm:py-5" : "min-h-dvh py-4 sm:py-5"}`}
      >
        <motion.header
          ref={headerRef}
          layout
          transition={SPRING}
          className={`flex min-h-12 shrink-0 items-center gap-4 ${stage === "landing" || stage === "intro" ? "justify-center" : "justify-between"}`}
        >
          <div ref={lockupRef} className="min-w-0">
            <BrandLockup
              // Remounting on the stage switch replays the reveal, so the mark
              // slides back in from the side once it has popped at centre.
              key={stage === "live" || stage === "done" ? "corner" : "stage"}
              compact={stage === "live" || stage === "done"}
              centered={stage === "landing" || stage === "intro"}
              wiping={stage === "intro"}
              hidden={stage === "intro" && flight !== null}
              revealDelay={stage === "landing" ? introDelay : 0}
              slideIn={false}
            />
          </div>
          <AnimatePresence>
            {stage === "live" && (
              <motion.div
                key="tools"
                initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={SOFT}
                className="flex shrink-0 items-center gap-1.5"
              >
                {/* On narrow screens the progress lives here, out of the text. */}
                <div className="md:hidden">
                  <ProgressConstellation collected={collected} variant="row" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMuted((current) => !current);
                    if (!muted) stopSpeaking();
                  }}
                  aria-label={muted ? "Turn MARY's voice on" : "Turn MARY's voice off"}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-ink"
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  <span className="hidden sm:inline">{muted ? "Voice off" : "Voice on"}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        {/* No section renders during the intro flight — this spacer keeps the
            footer pinned to the bottom instead of collapsing under the header. */}
        {stage === "intro" && <div aria-hidden="true" className="flex-1" />}
        <AnimatePresence mode="wait" initial={false}>
          {stage === "landing" && (
            <motion.section
              key="landing"
              initial={reduced ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                y: -16,
                scale: 0.92,
                filter: "blur(14px)",
                transition: { duration: 0.95, ease: EASE },
              }}
              transition={STAGE_IN}
              className="flex flex-1 flex-col items-center justify-center py-4 text-center"
            >
              <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col items-center">
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: introDelay + 0.05 }}
                  className="eyebrow"
                >
                  Early access · MARY is ready
                </motion.p>
                <motion.h1
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: introDelay + 0.12 }}
                  className={`text-balance font-semibold leading-[0.98] text-ink ${compact ? "mt-3 text-4xl sm:text-5xl" : "mt-5 text-5xl sm:text-6xl lg:text-7xl"}`}
                >
                  Meet <span className="text-muted-foreground">MARY.</span>
                </motion.h1>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: introDelay + 0.2 }}
                  className={`max-w-xl text-pretty leading-relaxed text-muted-foreground ${compact ? "mt-3 text-base" : "mt-5 text-lg sm:text-xl"}`}
                >
                  Your AI Revenue Concierge. She works the revenue you already have and personally
                  welcomes you to the OmniSuite launch waitlist.
                </motion.p>
                <motion.div
                  initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...SPRING, delay: introDelay + 0.24 }}
                  className={compact ? "mt-1" : "mt-3"}
                >
                  <MaryPresence state="idle" level={0} height={landingOrb} />
                </motion.div>
                <MotionButton
                  onClick={begin}
                  size="lg"
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: introDelay + 0.32 }}
                  whileHover={reduced ? {} : { y: -2, scale: 1.015 }}
                  whileTap={reduced ? {} : { scale: 0.98 }}
                  className={`surface-raised h-13 rounded-full bg-primary px-8 text-white ${compact ? "mt-4" : "mt-7"}`}
                >
                  Join The Waitlist <ArrowRight />
                </MotionButton>
                <span className="mt-3 text-sm text-muted-foreground">
                  Voice or text · switch anytime
                </span>
                <motion.div
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SOFT, delay: introDelay + 0.4 }}
                  className={`w-full overflow-hidden text-xs text-muted-foreground sm:text-sm ${compact ? "mt-5" : "mt-10"} marquee-mask`}
                >
                  <div className="marquee-track flex w-max items-center gap-x-8 sm:w-full sm:flex-wrap sm:justify-center sm:gap-y-2">
                    <span>
                      <strong className="text-ink">Convert</strong> fresh demand
                    </span>
                    <span className="text-border-strong">·</span>
                    <span>
                      <strong className="text-ink">Cultivate</strong> your database
                    </span>
                    <span className="text-border-strong">·</span>
                    <span>
                      <strong className="text-ink">Recover</strong> opportunities
                    </span>
                    {/* Duplicate keeps the phone marquee looping seamlessly */}
                    <span aria-hidden="true" className="text-border-strong sm:hidden">
                      ·
                    </span>
                    <span aria-hidden="true" className="sm:hidden">
                      <strong className="text-ink">Convert</strong> fresh demand
                    </span>
                    <span aria-hidden="true" className="text-border-strong sm:hidden">
                      ·
                    </span>
                    <span aria-hidden="true" className="sm:hidden">
                      <strong className="text-ink">Cultivate</strong> your database
                    </span>
                    <span aria-hidden="true" className="text-border-strong sm:hidden">
                      ·
                    </span>
                    <span aria-hidden="true" className="sm:hidden">
                      <strong className="text-ink">Recover</strong> opportunities
                    </span>
                    <span aria-hidden="true" className="text-border-strong sm:hidden">
                      ·
                    </span>
                  </div>
                </motion.div>
              </div>
            </motion.section>
          )}

          {stage === "live" && (
            <motion.section
              key="live"
              initial={reduced ? false : { opacity: 0, y: 16, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
              transition={STAGE_IN}
              className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col pt-1 sm:px-0 lg:py-4"
            >
              <div className="shrink-0">
                <MaryPresence state={presence} level={level} height={liveOrb} />
              </div>

              {/* The only thing that scrolls. The inner column is pushed to the
                  bottom with min-h-full + justify-end (not on the scroller
                  itself), so the top of a long thread is always reachable. */}
              <div
                ref={trailRef}
                className="no-scrollbar trail-fade relative mt-3 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
              >
                <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-end space-y-2.5 px-0.5 pt-6">
                  <AnimatePresence initial={false} mode="popLayout">
                    {history.map((line, index) => {
                      // Their latest words stay fully legible while she thinks.
                      const newest = line.id === last?.id;
                      return (
                        <motion.div
                          key={line.id}
                          layout="position"
                          initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
                          animate={{
                            opacity: newest ? 1 : 0.3 + (index / Math.max(1, history.length)) * 0.5,
                            y: 0,
                            scale: 1,
                          }}
                          exit={{ opacity: 0, y: -8, scale: 0.98 }}
                          transition={SOFT}
                          className={
                            line.role === "user" ? "flex justify-end" : "flex justify-start"
                          }
                        >
                          <div
                            className={
                              line.role === "user"
                                ? "max-w-[85%] whitespace-pre-line break-words rounded-[1.35rem] rounded-br-[0.45rem] bg-ink/85 px-4 py-2 text-left text-[0.86rem] leading-relaxed text-background"
                                : "max-w-[88%] break-words text-[0.84rem] leading-relaxed text-muted-foreground"
                            }
                          >
                            {line.text}
                            {line.interrupted && <span aria-label="cut off">…</span>}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {lastMary && (
                    <div className="mx-auto max-w-xl pt-2 text-center">
                      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-accent-text">
                        MARY
                      </p>
                      <p
                        className={`text-pretty break-words leading-relaxed text-ink ${compact ? "text-lg" : "text-xl sm:text-2xl"}`}
                      >
                        {lastMary.text.split(/\s+/).map((word, index) => (
                          <motion.span
                            key={`${lastMary.id}-${index}`}
                            initial={false}
                            animate={
                              reveal.id !== lastMary.id || index < reveal.count
                                ? { opacity: 1, y: 0, filter: "blur(0px)" }
                                : { opacity: 0.22, y: 3, filter: "blur(1.5px)" }
                            }
                            transition={{ duration: 0.3, ease: EASE }}
                            className="mr-[0.28em] inline-block"
                          >
                            {word}
                          </motion.span>
                        ))}
                        {lastMary.interrupted && (
                          <span aria-label="cut off" className="text-muted-foreground">
                            …
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {/* Live caption: a bubble forming on your side as you speak. */}
                  <AnimatePresence>
                    {interim && (
                      <motion.div
                        key="interim"
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={SOFT}
                        className="flex justify-end"
                      >
                        <p className="max-w-[85%] break-words rounded-[1.35rem] rounded-br-[0.45rem] bg-ink/10 px-4 py-2 text-left text-[0.86rem] leading-relaxed text-ink/70">
                          {interim}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Composer: pinned below the thread, above the keyboard and the home indicator. */}
              <div
                className="shrink-0 pt-3"
                style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
              >
                <AnimatePresence>
                  {micError && (
                    <motion.p
                      initial={reduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={SOFT}
                      className="mb-2 text-center text-xs text-muted-foreground"
                    >
                      {micError}
                    </motion.p>
                  )}
                </AnimatePresence>
                <motion.div
                  animate={
                    reduced
                      ? { scale: 1 }
                      : presence === "hearing"
                        ? { scale: pulseScale }
                        : { scale: 1 }
                  }
                  transition={SPRING}
                  className="surface-floating mx-auto flex w-full max-w-xl items-end gap-1 rounded-[1.6rem] bg-card/80 px-2 py-1.5 backdrop-blur-sm"
                >
                  <MotionButton
                    onClick={micLive ? toggleMicMute : retryMic}
                    whileTap={reduced ? {} : { scale: 0.94 }}
                    whileHover={reduced ? {} : { scale: 1.04 }}
                    transition={SPRING}
                    aria-label={
                      !micLive
                        ? "Try the microphone again"
                        : micMuted
                          ? "Unmute your microphone"
                          : "Mute your microphone"
                    }
                    size="icon"
                    className={`surface-raised relative size-11 shrink-0 rounded-full ${micMuted || !micLive ? "" : "bg-primary text-primary-foreground"}`}
                  >
                    {micLive && !micMuted ? <Mic /> : <MicOff />}
                  </MotionButton>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendUser(draft, "text");
                      }
                    }}
                    rows={1}
                    enterKeyHint="send"
                    placeholder={
                      !micLive
                        ? "Type your answer"
                        : listeningPhase === "hearing"
                          ? "I can hear you…"
                          : listeningPhase === "finishing"
                            ? "Finishing your answer…"
                            : micMuted
                              ? "Muted — type your answer"
                              : "Speak or type your answer"
                    }
                    className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted-foreground sm:text-sm"
                  />
                  <AnimatePresence initial={false}>
                    {draft.trim() && (
                      <motion.div
                        initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={SPRING}
                      >
                        <Button
                          onClick={() => void sendUser(draft, "text")}
                          size="icon"
                          variant="ghost"
                          aria-label="Send"
                          className="surface-raised size-11 shrink-0 rounded-full"
                        >
                          <Send />
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
                <div className="mt-2 text-center text-[0.68rem] text-muted-foreground">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={statusKey}
                      initial={reduced ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.24, ease: EASE }}
                    >
                      {statusText}
                    </motion.p>
                  </AnimatePresence>
                  {silentHint && (
                    <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-accent-text">
                      <span>
                        Can&apos;t hear her? Turn the ring switch on the side of your phone on, or
                        plug in headphones.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          // They cannot hear her: move her voice to the speakers for good.
                          void replayLastLine({ viaSpeakers: true });
                        }}
                        className="rounded-full border border-border px-2.5 py-0.5 text-[0.68rem] transition-colors hover:bg-muted"
                      >
                        Play sound
                      </button>
                    </p>
                  )}
                  <AnimatePresence>
                    {echoHint && micLive && (
                      <motion.p
                        initial={reduced ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={SOFT}
                        className="mt-1.5 inline-flex items-center gap-1.5 text-accent-text"
                      >
                        <Headphones className="size-3" aria-hidden="true" />
                        On speakers? Headphones make cutting in smoother.
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.section>
          )}

          {stage === "done" && result && closing && (
            <motion.section
              key="done"
              initial={reduced ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={STAGE_IN}
              className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-4 text-center"
            >
              <div className="flex flex-col items-center">
                <motion.div
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={SPRING}
                  className="mx-auto"
                >
                  <MaryPresence state="done" level={0} height={compact ? liveOrb : landingOrb} />
                </motion.div>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.14 }}
                  className={`eyebrow ${compact ? "mt-3" : "mt-7"}`}
                >
                  {closing.eyebrow}
                </motion.p>
                <motion.h1
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.2 }}
                  className={`mt-3 text-balance font-semibold leading-tight text-ink ${compact ? "text-4xl" : "text-5xl"}`}
                >
                  {closing.title}
                </motion.h1>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.26 }}
                  className="mx-auto mt-4 max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground"
                >
                  {closing.body}
                </motion.p>

                {result.outcome === "signed_up" && (
                  <motion.div
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ ...SOFT, delay: 0.34 }}
                    className="mt-5 flex min-h-9 items-center justify-center"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {result.sync === "pending" ? (
                        <motion.span
                          key="pending"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, filter: "blur(4px)" }}
                          transition={SOFT}
                          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                          Securing your place…
                        </motion.span>
                      ) : result.position ? (
                        <motion.span
                          key="position"
                          initial={{ opacity: 0, scale: 0.92, filter: "blur(4px)" }}
                          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                          transition={SPRING}
                          className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-4 py-1.5 text-sm font-semibold text-accent-text"
                        >
                          Early access position #{result.position}
                        </motion.span>
                      ) : (
                        <motion.span
                          key="saved"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={SOFT}
                          className="text-sm text-muted-foreground"
                        >
                          Your details are saved — your position comes with the confirmation.
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {result.outcome === "declined" && (
                  <motion.div
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SOFT, delay: 0.34 }}
                    className="mt-7 flex flex-wrap items-center justify-center gap-3"
                  >
                    <MotionButton
                      onClick={resume}
                      size="lg"
                      whileHover={reduced ? {} : { y: -2, scale: 1.015 }}
                      whileTap={reduced ? {} : { scale: 0.98 }}
                      className="surface-raised h-12 rounded-full bg-primary px-6 text-primary-foreground"
                    >
                      Keep talking to MARY <ArrowRight />
                    </MotionButton>
                    <Button
                      onClick={restart}
                      variant="ghost"
                      className="h-12 rounded-full px-5 text-muted-foreground hover:text-ink"
                    >
                      Start over
                    </Button>
                  </motion.div>
                )}
              </div>

              {result.outcome !== "declined" && (
                <div
                  className={`grid w-full gap-x-10 gap-y-8 text-left sm:grid-cols-[1.05fr_1fr] ${compact ? "mt-7" : "mt-11"}`}
                >
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      What happens next
                    </p>
                    <ol className="mt-4 space-y-3.5">
                      {closing.steps.map((step, index) => (
                        <motion.li
                          key={step}
                          initial={reduced ? false : { opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ ...SOFT, delay: 0.4 + index * 0.08 }}
                          className="flex items-start gap-3 text-sm leading-relaxed text-ink"
                        >
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/20 text-[0.65rem] font-semibold text-accent-text">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </motion.li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {result.outcome === "callback"
                        ? "What the team receives"
                        : "Details confirmed"}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                      {confirmedFields.map(([field, value], index) => (
                        <motion.div
                          key={field}
                          initial={reduced ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...SOFT, delay: 0.44 + index * 0.06 }}
                          className={field === "operations" ? "col-span-2" : ""}
                        >
                          <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {FIELD_LABELS[field]}
                          </dt>
                          <dd
                            className={`mt-0.5 break-words text-sm font-medium ${value ? "text-ink" : "text-muted-foreground"}`}
                          >
                            {value || "Skipped"}
                          </dd>
                        </motion.div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}

              {result.outcome !== "declined" && (
                <motion.button
                  type="button"
                  onClick={restart}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SOFT, delay: 0.9 }}
                  className={`text-xs text-muted-foreground transition-colors hover:text-ink ${compact ? "mt-7" : "mt-10"}`}
                >
                  Start another conversation
                </motion.button>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {stage === "live" && <ProgressConstellation collected={collected} variant="rail" />}

        {/* The mark itself, flying: centre stage, a bloom, then a pop into the corner. */}
        <AnimatePresence>
          {stage === "intro" && flight && (
            <motion.img
              key="flight"
              src={lockupAsset.url}
              alt=""
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 z-40 h-auto"
              initial={{
                x: flight.from.x,
                y: flight.from.y,
                width: flight.from.w,
                opacity: 1,
                filter: "blur(0px)",
              }}
              animate={{
                x: [flight.from.x, flight.mid.x, flight.mid.x, flight.to.x],
                y: [flight.from.y, flight.mid.y, flight.mid.y, flight.to.y],
                width: [flight.from.w, flight.mid.w, flight.mid.w, flight.to.w],
                opacity: 1,
                filter: ["blur(0px)", "blur(0px)", "blur(0px)", "blur(0px)"],
              }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              transition={{ duration: 2.3, times: [0, 0.34, 0.6, 1], ease: EASE }}
            />
          )}
        </AnimatePresence>

        {/* During the call on a phone every pixel goes to the conversation. */}
        <footer
          className={`${locked ? "hidden sm:flex" : "flex"} shrink-0 flex-wrap items-center justify-between gap-2 py-4 text-[0.68rem] text-muted-foreground`}
        >
          <span>OmniSuite · AI-native revenue infrastructure</span>
          <span>
            A product by{" "}
            <span
              className="wordmark cursor-default select-none text-ink"
              onClick={ownerTap}
              aria-hidden="true"
            >
              omnikom
            </span>
          </span>
        </footer>
      </div>
    </main>
  );
}
