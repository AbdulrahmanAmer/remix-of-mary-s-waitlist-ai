import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";

import { AuroraBackground } from "./aurora-background";
import { BrandLockup } from "./brand-lockup";
import { MaryPresence, PRESENCE_LABEL, type PresenceState } from "./mary-presence";
import { ProgressConstellation } from "./progress-constellation";
import { Button } from "@/components/ui/button";
import { maryTurn, WAITLIST_FIELDS, type Collected, type MaryTurn } from "@/lib/mary.functions";
import { submitWaitlist } from "@/lib/waitlist.functions";
import {
  speak,
  startRecording,
  transcribe,
  unlockAudio,
  type Recorder,
  type SpeakHandle,
} from "@/lib/audio-engine";

type Line = { id: string; role: "user" | "mary"; text: string };
type ListeningPhase = "idle" | "listening" | "hearing" | "finishing" | "paused";

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

// Tracks the live viewport height so the single-screen layout can shrink
// instead of spilling over on short windows.
function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return height;
}

const TYPING_LINES = [
  "Take your time writing what you have in mind — I'm right here with you.",
  "No rush at all, I'll wait while you type.",
];

const IDLE_NUDGES = [
  "Whenever you're ready — you can talk to me or type it out.",
  "I'm still here. Say the word, or type it if that's easier.",
];

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  business: "Business",
  industry: "Industry",
  operations: "Operations",
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export function MaryExperience() {
  const reduced = useReducedMotion();
  const viewportHeight = useViewportHeight();
  const trailRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<"landing" | "live" | "done">("landing");
  const [lines, setLines] = useState<Line[]>([]);
  const [collected, setCollected] = useState<Collected>({});
  const [presence, setPresenceState] = useState<PresenceState>("idle");
  const [level, setLevel] = useState(0);
  const [reveal, setReveal] = useState(0);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [listeningPhase, setListeningPhase] = useState<ListeningPhase>("idle");
  const [muted, setMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [result, setResult] = useState<{ position: number; message: string } | null>(null);

  const speakRef = useRef<SpeakHandle | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const typingSaidRef = useRef(0);
  const nudgeRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const busyRef = useRef(false);
  const handsFreeRef = useRef(false);
  const completingRef = useRef(false);
  const sessionFinishedRef = useRef(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  const finishListeningRef = useRef<() => Promise<void>>(async () => {});
  const mutedRef = useRef(false);
  const collectedRef = useRef<Collected>({});
  const linesRef = useRef<Line[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const setHandsFreeMode = useCallback((active: boolean) => {
    handsFreeRef.current = active;
    setHandsFree(active);
    if (!active) setListeningPhase("paused");
  }, []);

  const stopSpeaking = useCallback(() => {
    speakRef.current?.stop();
    speakRef.current = null;
  }, []);

  const say = useCallback(
    (text: string, opts: { record?: boolean } = { record: true }) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      if (opts.record !== false) setLines((prev) => [...prev, { id: uid(), role: "mary", text }]);
      setReveal(0);

      const duration = Math.max(1400, words * 300);
      const start = performance.now();
      let raf = 0;
      const animateWords = () => {
        const progress = Math.min(1, (performance.now() - start) / duration);
        setReveal(Math.ceil(progress * words));
        if (progress < 1) raf = requestAnimationFrame(animateWords);
      };
      raf = requestAnimationFrame(animateWords);

      if (mutedRef.current) {
        setPresenceState("speaking");
        return new Promise<void>((resolve) => {
          window.setTimeout(() => {
            cancelAnimationFrame(raf);
            setReveal(words);
            setPresenceState("idle");
            resolve();
          }, duration);
        });
      }

      stopSpeaking();
      setPresenceState("speaking");
      const handle = speak(text, {
        onLevel: setLevel,
        onEnd: () => {
          cancelAnimationFrame(raf);
          setReveal(words);
          setPresenceState((current) => (current === "speaking" ? "idle" : current));
        },
      });
      speakRef.current = handle;
      return handle.done;
    },
    [stopSpeaking],
  );

  const finalize = useCallback(async (finalCollected: Collected) => {
    sessionFinishedRef.current = true;
    handsFreeRef.current = false;
    setHandsFree(false);
    const transcript = linesRef.current
      .map((line) => `${line.role === "mary" ? "MARY" : "Guest"}: ${line.text}`)
      .join("\n");
    try {
      const response = await submitWaitlist({
        data: {
          name: finalCollected.name ?? "",
          email: finalCollected.email ?? "",
          phone: finalCollected.phone ?? "",
          business: finalCollected.business ?? "",
          industry: finalCollected.industry ?? "",
          operations: finalCollected.operations ?? "",
          transcript,
        },
      });
      setResult({ position: response.position, message: response.message });
    } catch {
      setResult({ position: 0, message: "We captured your details." });
    }
    setStage("done");
    setPresenceState("done");
  }, []);

  const runTurn = useCallback(
    async (nextLines: Line[]) => {
      busyRef.current = true;
      setPresenceState("thinking");
      try {
        const messages = nextLines.map((line) => ({
          role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
          content: line.text,
        }));
        let turn: MaryTurn = await maryTurn({
          data: { messages, collected: collectedRef.current as Record<string, string> },
        });

        // Safety net: if MARY nearly repeats a line she already said, ask for a fresh take once.
        const previous = nextLines.filter((line) => line.role === "mary").map((line) => line.text);
        if (previous.some((prev) => isNearRepeat(prev, turn.say)) && !turn.complete) {
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
              },
            });
            if (!isNearRepeat(turn.say, fresh.say))
              turn = { ...fresh, collected: { ...turn.collected, ...fresh.collected } };
          } catch {
            // keep the original line if the retry fails
          }
        }

        setCollected(turn.collected);
        collectedRef.current = turn.collected;
        await say(turn.say);
        if (turn.complete || turn.declined) {
          const allDone = WAITLIST_FIELDS.every((field) => turn.collected[field]);
          if (turn.complete && allDone) await finalize(turn.collected);
        }
      } catch {
        await say("I hit a snag on my side — could you try that once more?");
      } finally {
        busyRef.current = false;
        lastActivityRef.current = Date.now();
        inputRef.current?.focus();
        if (handsFreeRef.current && !sessionFinishedRef.current) {
          window.setTimeout(() => void startListeningRef.current(), 180);
        }
      }
    },
    [finalize, say],
  );

  const sendUser = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || busyRef.current) return;
      stopSpeaking();
      setInterim("");
      setDraft("");
      const next = [...linesRef.current, { id: uid(), role: "user" as const, text: clean }];
      setLines(next);
      linesRef.current = next;
      await runTurn(next);
    },
    [runTurn, stopSpeaking],
  );

  const finishListening = useCallback(async () => {
    if (completingRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    completingRef.current = true;
    recorderRef.current = null;
    setRecording(false);
    setListeningPhase("finishing");
    setPresenceState("thinking");
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    try {
      const spoken = await transcribe(await recorder.stop());
      setInterim("");
      if (spoken) {
        await sendUser(spoken);
      } else if (handsFreeRef.current && !sessionFinishedRef.current) {
        setPresenceState("idle");
        setListeningPhase("listening");
        window.setTimeout(() => void startListeningRef.current(), 350);
      }
    } finally {
      completingRef.current = false;
    }
  }, [sendUser]);

  finishListeningRef.current = finishListening;

  const begin = useCallback(async () => {
    setStage("live");
    await unlockAudio();
    lastActivityRef.current = Date.now();
    await runTurn([]);
  }, [runTurn]);

  const startInterim = useCallback(() => {
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => never }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const recognition = new Ctor() as unknown as {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (event: {
          results: { [key: number]: { 0: { transcript: string } }; length: number };
        }) => void;
        start: () => void;
        stop: () => void;
      };
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i++) text += event.results[i]![0].transcript;
        setInterim(text.trim());
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Interim captions are optional.
    }
  }, []);

  const startListening = useCallback(async () => {
    if (
      !handsFreeRef.current ||
      busyRef.current ||
      sessionFinishedRef.current ||
      recorderRef.current ||
      completingRef.current
    ) {
      return;
    }

    stopSpeaking();
    try {
      const recorder = await startRecording({
        onLevel: setLevel,
        onSpeechStart: () => {
          setListeningPhase("hearing");
          setPresenceState("hearing");
        },
        onSilence: () => void finishListeningRef.current(),
        onMaxDuration: () => void finishListeningRef.current(),
      });
      if (!handsFreeRef.current || sessionFinishedRef.current) {
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      setRecording(true);
      setMicError(null);
      setListeningPhase("listening");
      setPresenceState("listening");
      startInterim();
    } catch {
      setHandsFreeMode(false);
      setMicError("Microphone access is off. You can keep the conversation going by typing.");
      inputRef.current?.focus();
    }
  }, [setHandsFreeMode, startInterim, stopSpeaking]);

  startListeningRef.current = startListening;

  const toggleMic = useCallback(async () => {
    lastActivityRef.current = Date.now();
    if (handsFreeRef.current) {
      setHandsFreeMode(false);
      setRecording(false);
      setPresenceState("idle");
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recorder?.cancel();
      setInterim("");
      return;
    }

    setHandsFreeMode(true);
    await startListening();
  }, [setHandsFreeMode, startListening]);

  const onDraftChange = useCallback(
    (value: string) => {
      const wasEmpty = draft.length === 0;
      setDraft(value);
      lastActivityRef.current = Date.now();
      if (wasEmpty && value && recorderRef.current) {
        recorderRef.current.cancel();
        recorderRef.current = null;
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setRecording(false);
        setInterim("");
        setListeningPhase("paused");
        setPresenceState("idle");
      }
      if (
        wasEmpty &&
        value &&
        !busyRef.current &&
        typingSaidRef.current < TYPING_LINES.length &&
        stage === "live"
      ) {
        stopSpeaking();
        const line = TYPING_LINES[typingSaidRef.current];
        typingSaidRef.current += 1;
        if (line) void say(line);
      }
    },
    [draft.length, say, stage, stopSpeaking],
  );

  useEffect(() => {
    if (stage !== "live") return;
    const timer = window.setInterval(() => {
      if (busyRef.current || recording || handsFree || draft.length > 0) return;
      if (Date.now() - lastActivityRef.current < 22000 || nudgeRef.current >= IDLE_NUDGES.length)
        return;
      lastActivityRef.current = Date.now();
      const line = IDLE_NUDGES[nudgeRef.current];
      nudgeRef.current += 1;
      if (line) void say(line);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [draft.length, handsFree, recording, say, stage]);

  useEffect(() => {
    return () => {
      speakRef.current?.stop();
      recorderRef.current?.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (stage === "live") inputRef.current?.focus();
  }, [stage]);

  const lastMary = [...lines].reverse().find((line) => line.role === "mary");
  const history = lines.filter((line) => line.id !== lastMary?.id).slice(-6);
  const pulseScale = 1 + Math.min(0.12, level * 0.1);
  const compact = viewportHeight < 780;
  const landingOrb = Math.max(110, Math.min(200, Math.round(viewportHeight * 0.2)));
  const liveOrb = Math.max(84, Math.min(132, Math.round(viewportHeight * 0.14)));

  return (
    <main className="relative h-dvh overflow-hidden">
      <AuroraBackground intensity={stage === "landing" ? 0.18 : Math.min(1, 0.4 + level)} />
      <div className="relative z-10 mx-auto flex h-dvh min-h-0 w-full max-w-5xl flex-col px-5 py-4 sm:px-8 sm:py-5">
        <motion.header
          layout
          transition={SPRING}
          className={`flex min-h-12 items-center gap-4 ${stage === "landing" ? "justify-center" : "justify-between"}`}
        >
          <BrandLockup compact={stage !== "landing"} centered={stage === "landing"} />
          <AnimatePresence>
            {stage === "live" && (
              <motion.button
                initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={SOFT}
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
              </motion.button>
            )}
          </AnimatePresence>
        </motion.header>

        <AnimatePresence mode="wait" initial={false}>
          {stage === "landing" && (
            <motion.section
              key="landing"
              initial={reduced ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -14, filter: "blur(4px)" }}
              transition={STAGE_IN}
              className="no-scrollbar flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-4 text-center"
            >
              <div className="mx-auto flex max-w-3xl flex-col items-center">
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.05 }}
                  className="eyebrow"
                >
                  Early access · MARY is ready
                </motion.p>
                <motion.h1
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.12 }}
                  className={`text-balance font-semibold leading-[0.98] text-ink ${compact ? "mt-3 text-4xl sm:text-5xl" : "mt-5 text-5xl sm:text-6xl lg:text-7xl"}`}
                >
                  Meet <span className="text-muted-foreground">MARY.</span>
                </motion.h1>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.2 }}
                  className={`max-w-xl text-pretty leading-relaxed text-muted-foreground ${compact ? "mt-3 text-base" : "mt-5 text-lg sm:text-xl"}`}
                >
                  Your AI Revenue Concierge. She works the revenue you already have and personally
                  welcomes you to the OmniSuite launch waitlist.
                </motion.p>
                <motion.div
                  initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...SPRING, delay: 0.24 }}
                  className={`w-full max-w-md ${compact ? "mt-2" : "mt-6"}`}
                >
                  <MaryPresence state="idle" level={0} height={landingOrb} />
                </motion.div>
                <MotionButton
                  onClick={begin}
                  size="lg"
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.32 }}
                  whileHover={reduced ? {} : { y: -2, scale: 1.015 }}
                  whileTap={reduced ? {} : { scale: 0.98 }}
                  className={`h-13 rounded-full px-8 shadow-soft ${compact ? "mt-4" : "mt-7"}`}
                >
                  Talk to MARY <ArrowRight />
                </MotionButton>
                <span className="mt-3 text-sm text-muted-foreground">
                  Voice or text · switch anytime
                </span>
                <motion.div
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SOFT, delay: 0.4 }}
                  className={`flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-muted-foreground sm:text-sm ${compact ? "mt-5" : "mt-10"}`}
                >
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
              className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col py-3 pr-10 md:pr-44 lg:py-5"
            >
              <MaryPresence state={presence} level={level} height={liveOrb} />
              <div className="mt-1 flex items-center justify-between gap-4 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <motion.span
                    animate={
                      reduced || !handsFree
                        ? { opacity: 1, scale: 1 }
                        : { opacity: [0.45, 1, 0.45], scale: [1, 1.25, 1] }
                    }
                    transition={{
                      duration: 2.4,
                      repeat: handsFree && !reduced ? Infinity : 0,
                      ease: "easeInOut",
                    }}
                    className={`size-1.5 rounded-full ${handsFree ? "bg-primary" : "bg-border-strong"}`}
                  />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={handsFree ? "handsfree" : presence}
                      initial={reduced ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.22, ease: EASE }}
                    >
                      {handsFree ? "Hands-free" : PRESENCE_LABEL[presence]}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="hidden sm:inline">MARY · AI Revenue Concierge</span>
              </div>
              <ProgressConstellation collected={collected} />

              <div
                ref={trailRef}
                className="no-scrollbar mt-3 flex min-h-0 min-w-0 flex-1 flex-col justify-end overflow-y-auto"
              >
                <motion.div
                  layout
                  transition={SPRING}
                  className="no-scrollbar mx-auto w-full max-w-3xl space-y-2.5"
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {history.map((line, index) => (
                      <motion.div
                        key={line.id}
                        layout
                        initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
                        animate={{
                          opacity: 0.3 + (index / Math.max(1, history.length)) * 0.5,
                          y: 0,
                          scale: 1,
                        }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={SOFT}
                        className={line.role === "user" ? "flex justify-end" : "flex justify-start"}
                      >
                        <div
                          className={`max-w-[80%] rounded-full px-4 py-1.5 text-[0.82rem] leading-relaxed ${line.role === "user" ? "bg-ink/85 text-background" : "text-muted-foreground"}`}
                        >
                          {line.text}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {lastMary && (
                    <motion.div
                      layout
                      transition={SPRING}
                      className="mx-auto max-w-2xl pt-2 text-center"
                    >
                      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-accent-text">
                        MARY
                      </p>
                      <p className="text-pretty text-xl leading-relaxed text-ink sm:text-2xl">
                        {lastMary.text.split(/\s+/).map((word, index) => (
                          <motion.span
                            key={`${lastMary.id}-${index}`}
                            initial={false}
                            animate={
                              index < reveal
                                ? { opacity: 1, y: 0, filter: "blur(0px)" }
                                : { opacity: 0.22, y: 3, filter: "blur(1.5px)" }
                            }
                            transition={{ duration: 0.3, ease: EASE }}
                            className="mr-[0.28em] inline-block"
                          >
                            {word}
                          </motion.span>
                        ))}
                      </p>
                    </motion.div>
                  )}
                  <AnimatePresence>
                    {interim && (
                      <motion.p
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={SOFT}
                        className="text-right text-sm italic text-muted-foreground"
                      >
                        {interim}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>

              <div className="pt-3">
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
                  layout
                  animate={
                    reduced
                      ? { scale: 1 }
                      : recording || presence === "speaking"
                        ? { scale: pulseScale }
                        : { scale: 1 }
                  }
                  transition={SPRING}
                  className="mx-auto flex w-full max-w-3xl items-end gap-1 rounded-full bg-card/70 px-2 py-1.5 shadow-soft backdrop-blur-sm"
                >
                  <MotionButton
                    onClick={toggleMic}
                    whileTap={reduced ? {} : { scale: 0.94 }}
                    whileHover={reduced ? {} : { scale: 1.04 }}
                    transition={SPRING}
                    aria-label={
                      handsFree ? "Pause hands-free listening" : "Start hands-free listening"
                    }
                    size="icon"
                    className={`relative size-11 shrink-0 rounded-full ${handsFree ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    {handsFree ? <Square className="fill-current" /> : <Mic />}
                  </MotionButton>
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendUser(draft);
                      }
                    }}
                    rows={1}
                    placeholder={
                      listeningPhase === "hearing"
                        ? "I can hear you…"
                        : listeningPhase === "finishing"
                          ? "Finishing your answer…"
                          : handsFree
                            ? "Listening — or type your answer"
                            : "Speak or type your answer"
                    }
                    className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted-foreground"
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
                          onClick={() => void sendUser(draft)}
                          size="icon"
                          variant="ghost"
                          aria-label="Send"
                          className="size-11 shrink-0 rounded-full"
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
                      key={
                        listeningPhase === "hearing" || listeningPhase === "finishing"
                          ? listeningPhase
                          : handsFree
                            ? "hf"
                            : "idle"
                      }
                      initial={reduced ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.24, ease: EASE }}
                    >
                      {listeningPhase === "hearing"
                        ? "Keep speaking — MARY replies when you finish."
                        : listeningPhase === "finishing"
                          ? "Got it. MARY is preparing her reply."
                          : handsFree
                            ? "Hands-free is on. Speak naturally; no second tap needed."
                            : "Tap the microphone once for hands-free conversation, or type anytime."}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </motion.section>
          )}

          {stage === "done" && (
            <motion.section
              key="done"
              initial={reduced ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={STAGE_IN}
              className="no-scrollbar mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center overflow-y-auto py-4 text-center"
            >
              <div>
                <motion.div
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={SPRING}
                  className="mx-auto w-full max-w-md"
                >
                  <MaryPresence state="done" level={0} height={landingOrb} />
                </motion.div>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.14 }}
                  className="eyebrow mt-7"
                >
                  Early access confirmed
                </motion.p>
                <motion.h1
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.2 }}
                  className="mt-3 text-balance text-5xl font-semibold leading-tight text-ink"
                >
                  You’re on the waitlist.
                </motion.h1>
                <motion.p
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.26 }}
                  className="mx-auto mt-4 max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground"
                >
                  Thanks for signing up — we’ll be in touch as soon as OmniSuite launches, a product
                  by Omnikom.
                </motion.p>
                {result && result.position > 0 && (
                  <motion.p
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ ...SOFT, delay: 0.34 }}
                    className="mt-5 font-semibold text-accent-text"
                  >
                    Early access position #{result.position}
                  </motion.p>
                )}
              </div>

              <div className="mt-10 w-full text-left">
                <p className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Details confirmed
                </p>
                <dl className="mt-6 grid gap-6 sm:grid-cols-2">
                  {WAITLIST_FIELDS.map((field, index) => (
                    <motion.div
                      key={field}
                      initial={reduced ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SOFT, delay: 0.38 + index * 0.06 }}
                      className={field === "operations" ? "sm:col-span-2" : ""}
                    >
                      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {FIELD_LABELS[field]}
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-ink">
                        {collected[field] || "—"}
                      </dd>
                    </motion.div>
                  ))}
                </dl>
                {result && (
                  <p className="mt-8 text-center text-xs text-muted-foreground">{result.message}</p>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="flex flex-wrap items-center justify-between gap-2 py-4 text-[0.68rem] text-muted-foreground">
          <span>OmniSuite · AI-native revenue infrastructure</span>
          <span>
            A product by <span className="wordmark text-ink">omnikom</span>
          </span>
        </footer>
      </div>
    </main>
  );
}
