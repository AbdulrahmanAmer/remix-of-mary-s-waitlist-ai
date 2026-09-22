import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, Square, Send, Sparkle, Volume2, VolumeX } from "lucide-react";

import { MaryOrb, type OrbState } from "./mary-orb";
import { ProgressConstellation } from "./progress-constellation";
import { AuroraBackground } from "./aurora-background";
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

const TYPING_LINES = [
  "Take your time writing what you have in mind — I'm right here with you.",
  "No rush at all, I'll wait while you type.",
];

const IDLE_NUDGES = [
  "Whenever you're ready — you can talk to me or type it out.",
  "I'm still here. Say the word, or type it if that's easier.",
];

function uid() {
  return Math.random().toString(36).slice(2);
}

export function MaryExperience() {
  const [stage, setStage] = useState<"landing" | "live" | "done">("landing");
  const [lines, setLines] = useState<Line[]>([]);
  const [collected, setCollected] = useState<Collected>({});
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [reveal, setReveal] = useState(0);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
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

  const stopSpeaking = useCallback(() => {
    speakRef.current?.stop();
    speakRef.current = null;
  }, []);

  const say = useCallback(
    (text: string, opts: { record?: boolean } = { record: true }) => {
      const words = text.split(/\s+/).filter(Boolean).length;
      if (opts.record !== false) {
        setLines((prev) => [...prev, { id: uid(), role: "mary", text }]);
      }
      setReveal(0);

      const duration = Math.max(1400, words * 300);
      const start = performance.now();
      let raf = 0;
      const animate = () => {
        const progress = Math.min(1, (performance.now() - start) / duration);
        setReveal(Math.ceil(progress * words));
        if (progress < 1) raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);

      if (mutedRef.current) {
        setOrbState("speaking");
        const timer = setTimeout(() => setOrbState("idle"), duration);
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            clearTimeout(timer);
            setOrbState("idle");
            resolve();
          }, duration),
        );
      }

      stopSpeaking();
      setOrbState("speaking");
      const handle = speak(text, {
        onLevel: setLevel,
        onEnd: () => {
          cancelAnimationFrame(raf);
          setReveal(words);
          setOrbState((s) => (s === "speaking" ? "idle" : s));
        },
      });
      speakRef.current = handle;
      return handle.done;
    },
    [stopSpeaking],
  );

  const finalize = useCallback(async (finalCollected: Collected) => {
    const transcript = linesRef.current
      .map((l) => `${l.role === "mary" ? "MARY" : "Guest"}: ${l.text}`)
      .join("\n");
    try {
      const res = await submitWaitlist({
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
      setResult({ position: res.position, message: res.message });
    } catch {
      setResult({ position: 0, message: "We captured your details." });
    }
    setStage("done");
    setOrbState("success");
  }, []);

  const runTurn = useCallback(
    async (nextLines: Line[]) => {
      busyRef.current = true;
      setOrbState("thinking");
      try {
        const turn: MaryTurn = await maryTurn({
          data: {
            messages: nextLines.map((l) => ({
              role: l.role === "mary" ? ("assistant" as const) : ("user" as const),
              content: l.text,
            })),
            collected: collectedRef.current as Record<string, string>,
          },
        });
        setCollected(turn.collected);
        collectedRef.current = turn.collected;
        await say(turn.say);
        if (turn.complete || turn.declined) {
          const allDone = WAITLIST_FIELDS.every((f) => turn.collected[f]);
          if (turn.complete && allDone) await finalize(turn.collected);
        }
      } catch {
        await say("I hit a snag on my side — could you try that once more?");
      } finally {
        busyRef.current = false;
        lastActivityRef.current = Date.now();
        inputRef.current?.focus();
      }
    },
    [say, finalize],
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

  const begin = useCallback(async () => {
    setStage("live");
    await unlockAudio();
    lastActivityRef.current = Date.now();
    await runTurn([]);
  }, [runTurn]);

  /* ---------- microphone ---------- */

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
        onresult: (e: {
          resultIndex: number;
          results: { [k: number]: { 0: { transcript: string } }; length: number };
        }) => void;
        start: () => void;
        stop: () => void;
      };
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i]![0].transcript;
        }
        setInterim(text.trim());
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      /* interim captions unavailable */
    }
  }, []);

  const toggleMic = useCallback(async () => {
    lastActivityRef.current = Date.now();
    if (recording) {
      setRecording(false);
      setOrbState("thinking");
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) return;
      const blob = await recorder.stop();
      const spoken = await transcribe(blob);
      setInterim("");
      if (spoken) await sendUser(spoken);
      else {
        setOrbState("idle");
        await say("I didn't quite catch that — try again, or type it for me.");
      }
      return;
    }

    stopSpeaking();
    try {
      const recorder = await startRecording(setLevel);
      recorderRef.current = recorder;
      setRecording(true);
      setMicError(null);
      setOrbState("listening");
      startInterim();
    } catch {
      setMicError("Microphone blocked — no problem, you can type to me instead.");
      inputRef.current?.focus();
    }
  }, [recording, sendUser, say, startInterim, stopSpeaking]);

  /* ---------- typing awareness ---------- */

  const onDraftChange = useCallback(
    (value: string) => {
      const wasEmpty = draft.length === 0;
      setDraft(value);
      lastActivityRef.current = Date.now();
      if (
        wasEmpty &&
        value.length > 0 &&
        !busyRef.current &&
        typingSaidRef.current < TYPING_LINES.length &&
        stage === "live"
      ) {
        stopSpeaking();
        const line = TYPING_LINES[typingSaidRef.current]!;
        typingSaidRef.current += 1;
        void say(line);
      }
    },
    [draft.length, say, stage, stopSpeaking],
  );

  /* ---------- idle nudges ---------- */

  useEffect(() => {
    if (stage !== "live") return;
    const timer = setInterval(() => {
      if (busyRef.current || recording || draft.length > 0) return;
      if (Date.now() - lastActivityRef.current < 22000) return;
      if (nudgeRef.current >= IDLE_NUDGES.length) return;
      lastActivityRef.current = Date.now();
      const line = IDLE_NUDGES[nudgeRef.current]!;
      nudgeRef.current += 1;
      void say(line);
    }, 4000);
    return () => clearInterval(timer);
  }, [stage, recording, draft.length, say]);

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

  const lastMary = [...lines].reverse().find((l) => l.role === "mary");
  const history = lines.filter((l) => l.id !== lastMary?.id).slice(-4);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AuroraBackground intensity={level} />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl border border-white/15 bg-white/5">
              <span className="font-display text-sm font-semibold">O</span>
            </div>
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold tracking-tight">OmniSuite</p>
              <p className="text-[11px] text-white/45">AI-Native Revenue Infrastructure</p>
            </div>
          </div>
          {stage === "live" && (
            <button
              onClick={() => {
                setMuted((m) => !m);
                if (!muted) stopSpeaking();
              }}
              className="flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-2 text-xs text-white/70 transition-colors hover:bg-white/10"
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              {muted ? "Voice off" : "Voice on"}
            </button>
          )}
        </header>

        <AnimatePresence mode="wait">
          {stage === "landing" && (
            <motion.section
              key="landing"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-1 flex-col items-center justify-center gap-10 py-10 text-center"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 120, damping: 18 }}
              >
                <MaryOrb state="idle" level={0.14} size={230} />
              </motion.div>

              <div className="max-w-2xl space-y-5">
                <motion.span
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.22em] text-white/60"
                >
                  <Sparkle className="size-3" /> Early access · Launching soon
                </motion.span>
                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.32, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="text-balance text-5xl font-semibold leading-[1.05] sm:text-6xl"
                >
                  <span className="text-gradient">Meet MARY.</span>
                  <br />
                  She'll add you to the waitlist herself.
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.42 }}
                  className="mx-auto max-w-xl text-pretty text-base text-white/60"
                >
                  A live conversation with the AI Revenue Concierge behind OmniSuite. Talk to her or
                  type — she'll take it from there.
                </motion.p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.52 }}
                className="flex flex-col items-center gap-3"
              >
                <motion.button
                  onClick={begin}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="group relative overflow-hidden rounded-full px-9 py-4 text-sm font-semibold text-[oklch(0.14_0.024_266)]"
                  style={{
                    background:
                      "linear-gradient(100deg, oklch(0.88 0.11 200), oklch(0.8 0.15 262))",
                    boxShadow: "0 18px 60px -18px var(--primary)",
                  }}
                >
                  <span className="relative z-10">Talk to MARY</span>
                  <motion.span
                    className="absolute inset-0 opacity-0 group-hover:opacity-100"
                    style={{
                      background:
                        "linear-gradient(100deg, oklch(0.92 0.1 320), oklch(0.85 0.13 200))",
                    }}
                    transition={{ duration: 0.4 }}
                  />
                </motion.button>
                <p className="text-xs text-white/40">
                  Prefer to type? She'll notice and follow your lead.
                </p>
              </motion.div>
            </motion.section>
          )}

          {stage === "live" && (
            <motion.section
              key="live"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-1 flex-col items-center justify-center gap-10 py-8"
            >
              <div className="flex flex-col items-center gap-6">
                <MaryOrb state={orbState} level={level} size={190} />
                <ProgressConstellation collected={collected} />
              </div>

              <div className="w-full max-w-2xl space-y-3">
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {history.map((line, i) => (
                      <motion.p
                        key={line.id}
                        layout
                        initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                        animate={{
                          opacity: 0.16 + i * 0.12,
                          y: 0,
                          filter: "blur(0.4px)",
                        }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`text-sm ${
                          line.role === "user" ? "text-right text-white" : "text-white/80"
                        }`}
                      >
                        {line.text}
                      </motion.p>
                    ))}
                  </AnimatePresence>
                </div>

                <motion.div layout className="min-h-[5.5rem]">
                  {lastMary && (
                    <p className="text-balance text-xl leading-snug sm:text-2xl">
                      {lastMary.text.split(/\s+/).map((word, i) => (
                        <motion.span
                          key={`${lastMary.id}-${i}`}
                          initial={{ opacity: 0.12, y: 6 }}
                          animate={i < reveal ? { opacity: 1, y: 0 } : { opacity: 0.16, y: 3 }}
                          transition={{ duration: 0.28 }}
                          className="mr-[0.3em] inline-block"
                        >
                          {word}
                        </motion.span>
                      ))}
                    </p>
                  )}
                  {interim && (
                    <p className="mt-3 text-right text-sm italic text-white/45">{interim}</p>
                  )}
                </motion.div>
              </div>

              <div className="w-full max-w-2xl space-y-3">
                {micError && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center text-xs text-white/50"
                  >
                    {micError}
                  </motion.p>
                )}
                <motion.div layout className="glass-panel flex items-end gap-2 rounded-3xl p-2.5">
                  <motion.button
                    onClick={toggleMic}
                    whileTap={{ scale: 0.94 }}
                    aria-label={recording ? "Stop and send" : "Talk to MARY"}
                    className="relative grid size-11 shrink-0 place-items-center rounded-2xl text-[oklch(0.14_0.024_266)]"
                    style={{
                      background: recording
                        ? "linear-gradient(120deg, oklch(0.8 0.17 22), oklch(0.85 0.14 40))"
                        : "linear-gradient(120deg, oklch(0.88 0.11 200), oklch(0.8 0.15 262))",
                    }}
                  >
                    {recording ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                    {recording && (
                      <motion.span
                        className="absolute inset-0 rounded-2xl border-2 border-white/60"
                        animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                  </motion.button>

                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendUser(draft);
                      }
                    }}
                    rows={1}
                    placeholder={recording ? "Listening…" : "Speak, or type your answer here"}
                    className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-white outline-none placeholder:text-white/35"
                  />

                  <motion.button
                    onClick={() => void sendUser(draft)}
                    disabled={!draft.trim()}
                    whileTap={{ scale: 0.94 }}
                    aria-label="Send"
                    className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/12 bg-white/5 text-white/80 transition-colors hover:bg-white/10 disabled:opacity-35"
                  >
                    <Send className="size-4" />
                  </motion.button>
                </motion.div>
                <p className="text-center text-[11px] text-white/35">
                  {recording
                    ? "Tap the square when you're done speaking."
                    : "Tap the mic to speak — or just start typing, MARY will wait."}
                </p>
              </div>
            </motion.section>
          )}

          {stage === "done" && (
            <motion.section
              key="done"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-1 flex-col items-center justify-center gap-8 py-10 text-center"
            >
              <MaryOrb state="success" level={0.3} size={200} />
              <div className="space-y-3">
                <h2 className="text-balance text-4xl font-semibold sm:text-5xl">
                  <span className="text-gradient">You're on the waitlist.</span>
                </h2>
                <p className="mx-auto max-w-lg text-white/60">
                  Thanks for signing up — we'll be in touch the moment OmniSuite launches.
                </p>
                {result && result.position > 0 && (
                  <p className="text-sm text-white/45">Early access position #{result.position}</p>
                )}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-panel w-full max-w-xl rounded-3xl p-6 text-left"
              >
                <dl className="grid gap-4 sm:grid-cols-2">
                  {WAITLIST_FIELDS.map((field, i) => (
                    <motion.div
                      key={field}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + i * 0.06 }}
                      className={field === "operations" ? "sm:col-span-2" : ""}
                    >
                      <dt className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        {field}
                      </dt>
                      <dd className="mt-1 text-sm text-white/85">{collected[field] || "—"}</dd>
                    </motion.div>
                  ))}
                </dl>
              </motion.div>
              {result && <p className="text-[11px] text-white/30">{result.message}</p>}
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="pt-8 text-center text-[11px] text-white/25">
          MARY works new leads, your existing database and missed opportunities across voice, SMS
          and email.
        </footer>
      </div>
    </div>
  );
}
