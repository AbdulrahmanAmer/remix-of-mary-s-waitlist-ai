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
        const turn: MaryTurn = await maryTurn({
          data: {
            messages: nextLines.map((line) => ({
              role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
              content: line.text,
            })),
            collected: collectedRef.current as Record<string, string>,
          },
        });
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
          setPresenceState("listening");
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

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <AuroraBackground />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-5 sm:px-8 sm:py-6">
        <header
          className={`flex min-h-12 items-center gap-4 ${stage === "landing" ? "justify-center" : "justify-between"}`}
        >
          <BrandLockup compact={stage !== "landing"} centered={stage === "landing"} />
          {stage === "live" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMuted((current) => !current);
                if (!muted) stopSpeaking();
              }}
              aria-label={muted ? "Turn MARY's voice on" : "Turn MARY's voice off"}
              className="rounded-full bg-card"
            >
              {muted ? <VolumeX /> : <Volume2 />}
              <span className="hidden sm:inline">{muted ? "Voice off" : "Voice on"}</span>
            </Button>
          )}
        </header>

        <AnimatePresence mode="wait">
          {stage === "landing" && (
            <motion.section
              key="landing"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-1 flex-col items-center justify-center py-10 text-center sm:py-14"
            >
              <div className="mx-auto flex max-w-3xl flex-col items-center">
                <p className="eyebrow">Early access · MARY is ready</p>
                <h1 className="mt-5 text-balance text-5xl font-semibold leading-[0.98] text-ink sm:text-7xl lg:text-8xl">
                  Meet <span className="text-muted-foreground">MARY.</span>
                </h1>
                <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
                  Your AI Revenue Concierge. She works the revenue you already have and personally
                  welcomes you to the OmniSuite launch waitlist.
                </p>
                <div className="relative mt-8">
                  <div className="absolute inset-5 -z-10 rounded-full bg-primary/10" />
                  <MaryOrb state="idle" level={0} size={176} />
                </div>
                <MotionButton
                  onClick={begin}
                  size="lg"
                  whileHover={reduced ? {} : { y: -2, scale: 1.01 }}
                  whileTap={reduced ? {} : { scale: 0.98 }}
                  className="mt-7 h-13 rounded-full px-8 shadow-soft"
                >
                  Talk to MARY <ArrowRight />
                </MotionButton>
                <span className="mt-3 text-sm text-muted-foreground">
                  Voice or text · switch anytime
                </span>
                <div className="mt-9 grid w-full grid-cols-3 divide-x divide-border border-y border-border py-4 text-xs text-muted-foreground sm:text-sm">
                  <span className="px-2">
                    <strong className="block text-ink sm:inline">Convert</strong> fresh demand
                  </span>
                  <span className="px-2">
                    <strong className="block text-ink sm:inline">Cultivate</strong> your database
                  </span>
                  <span className="px-2">
                    <strong className="block text-ink sm:inline">Recover</strong> opportunities
                  </span>
                </div>
              </div>
            </motion.section>
          )}

          {stage === "live" && (
            <motion.section
              key="live"
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto flex w-full max-w-4xl flex-1 flex-col py-5 lg:py-7"
            >
              <div className="flex justify-center py-1">
                <MaryOrb state={presence} level={level} size={128} />
              </div>
              <div className="mt-3">
                <ProgressConstellation collected={collected} />
              </div>

              <div className="mt-4 flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lift">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div>
                    <p className="font-semibold text-ink">MARY</p>
                    <p className="text-xs text-muted-foreground">AI Revenue Concierge</p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${handsFree ? "bg-primary" : "bg-border-strong"}`}
                    />
                    {handsFree ? "Hands-free" : "Ready"}
                  </span>
                </div>

                <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-4 py-5 sm:px-7 sm:py-7">
                  <div className="mx-auto w-full max-w-3xl space-y-3 overflow-y-auto">
                    <AnimatePresence initial={false}>
                      {history.map((line) => (
                        <motion.div
                          key={line.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={
                            line.role === "user" ? "flex justify-end" : "flex justify-start"
                          }
                        >
                          <div
                            className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed ${line.role === "user" ? "rounded-br-sm bg-ink text-background" : "rounded-bl-sm bg-surface text-ink"}`}
                          >
                            {line.text}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {lastMary && (
                      <div className="mx-auto max-w-2xl text-center">
                        <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-accent-text">
                          MARY
                        </p>
                        <p className="text-pretty text-xl leading-relaxed text-ink sm:text-2xl">
                          {lastMary.text.split(/\s+/).map((word, index) => (
                            <motion.span
                              key={`${lastMary.id}-${index}`}
                              initial={false}
                              animate={
                                index < reveal ? { opacity: 1, y: 0 } : { opacity: 0.28, y: 2 }
                              }
                              transition={{ duration: 0.22 }}
                              className="mr-[0.28em] inline-block"
                            >
                              {word}
                            </motion.span>
                          ))}
                        </p>
                      </div>
                    )}
                    {interim && (
                      <p className="text-right text-sm italic text-muted-foreground">{interim}</p>
                    )}
                  </div>
                </div>

                <div className="border-t border-border bg-surface/70 p-3 sm:p-4">
                  {micError && (
                    <p className="mb-2 text-center text-xs text-muted-foreground">{micError}</p>
                  )}
                  <motion.div
                    animate={
                      reduced
                        ? false
                        : recording || presence === "speaking"
                          ? { scale: pulseScale, borderColor: "var(--primary)" }
                          : { scale: 1 }
                    }
                    transition={
                      recording || presence === "speaking"
                        ? { type: "spring", stiffness: 240, damping: 24 }
                        : { duration: 0.25 }
                    }
                    className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-border-strong bg-card p-2 shadow-soft"
                  >
                    <MotionButton
                      onClick={toggleMic}
                      whileTap={reduced ? {} : { scale: 0.94 }}
                      aria-label={
                        handsFree ? "Pause hands-free listening" : "Start hands-free listening"
                      }
                      size="icon"
                      className={`relative size-11 shrink-0 rounded-lg ${handsFree ? "bg-primary text-primary-foreground" : ""}`}
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
                      className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-ink outline-none placeholder:text-muted-foreground"
                    />
                    <Button
                      onClick={() => void sendUser(draft)}
                      disabled={!draft.trim()}
                      size="icon"
                      variant="ghost"
                      aria-label="Send"
                      className="size-11 shrink-0 rounded-lg"
                    >
                      <Send />
                    </Button>
                  </motion.div>
                  <p className="mt-2 text-center text-[0.68rem] text-muted-foreground">
                    {listeningPhase === "hearing"
                      ? "Keep speaking — MARY replies when you finish."
                      : listeningPhase === "finishing"
                        ? "Got it. MARY is preparing her reply."
                        : handsFree
                          ? "Hands-free is on. Speak naturally; no second tap needed."
                          : "Tap the microphone once for hands-free conversation, or type anytime."}
                  </p>
                </div>
              </div>
            </motion.section>
          )}

          {stage === "done" && (
            <motion.section
              key="done"
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-10 text-center"
            >
              <div>
                <div className="flex justify-center">
                  <MaryOrb state="success" level={0.3} size={190} />
                </div>
                <p className="eyebrow mt-7">Early access confirmed</p>
                <h1 className="mt-3 text-balance text-5xl font-semibold leading-tight text-ink">
                  You’re on the waitlist.
                </h1>
                <p className="mx-auto mt-4 max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground">
                  Thanks for signing up — we’ll be in touch as soon as OmniSuite launches, a product
                  by Omnikom.
                </p>
                {result && result.position > 0 && (
                  <p className="mt-5 font-semibold text-accent-text">
                    Early access position #{result.position}
                  </p>
                )}
              </div>

              <div className="mt-8 w-full rounded-2xl border border-border bg-card p-6 text-left shadow-lift sm:p-8">
                <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Registration
                    </p>
                    <p className="mt-1 text-xl font-semibold text-ink">Details confirmed</p>
                  </div>
                  <span className="rounded-full bg-primary/12 px-3 py-1.5 text-xs font-semibold text-accent-text">
                    Complete
                  </span>
                </div>
                <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                  {WAITLIST_FIELDS.map((field, index) => (
                    <motion.div
                      key={field}
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 + index * 0.05 }}
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
                  <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
                    {result.message}
                  </p>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-4 text-[0.68rem] text-muted-foreground">
          <span>OmniSuite · AI-native revenue infrastructure</span>
          <span>
            A product by <span className="wordmark text-ink">omnikom</span>
          </span>
        </footer>
      </div>
    </main>
  );
}
