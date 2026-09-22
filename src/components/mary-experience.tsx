import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";

import { AuroraBackground } from "./aurora-background";
import { BrandLockup } from "./brand-lockup";
import { MaryPresence, type PresenceState } from "./mary-presence";
import { ProgressConstellation } from "./progress-constellation";
import { Button } from "@/components/ui/button";
import lockupAsset from "@/assets/omnisuite-lockup.png.asset.json";
import { maryTurn, WAITLIST_FIELDS, type Collected, type MaryTurn } from "@/lib/mary.functions";
import { streamMaryTurn } from "@/lib/mary-stream";
import { submitWaitlist } from "@/lib/waitlist.functions";
import {
  speak,
  startMicSession,
  transcribe,
  unlockAudio,
  type MicSession,
  type SpeakHandle,
} from "@/lib/audio-engine";

type Line = { id: string; role: "user" | "mary"; text: string };
type ListeningPhase = "idle" | "listening" | "hearing" | "finishing" | "paused";
type Point = { x: number; y: number; w: number };
/** Screen-space path the OmniSuite mark travels during the intro. */
type Flight = { from: Point; mid: Point; to: Point };

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
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [ref]);
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
  const [result, setResult] = useState<{ position: number; message: string } | null>(null);

  const speakRef = useRef<SpeakHandle | null>(null);
  const sessionRef = useRef<MicSession | null>(null);
  const typingSaidRef = useRef(0);
  const nudgeRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const busyRef = useRef(false);
  const interruptRef = useRef(false);
  const micMutedRef = useRef(false);
  const sessionFinishedRef = useRef(false);
  /** One queue for the whole call, so utterances are answered in the order they were said. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const handleUtteranceRef = useRef<(u: { text: string; audio: Blob | null }) => void>(() => {});

  const mutedRef = useRef(false);
  const collectedRef = useRef<Collected>({});
  const linesRef = useRef<Line[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);
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
      const id = uid();
      if (opts.record !== false) setLines((prev) => [...prev, { id, role: "mary", text }]);
      setReveal({ id, count: 0 });

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
      // Her own voice in the room must not read as an interruption.
      sessionRef.current?.setEchoGuard(true);
      const handle = speak(text, {
        onLevel: setLevel,
        approxDurationSec: approx,
        // Words land in step with the voice that is actually playing.
        onProgress: (progress) => setReveal({ id, count: Math.ceil(progress * words) }),
        onEnd: () => {
          setReveal({ id, count: words });
          sessionRef.current?.setEchoGuard(false);
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
    sessionRef.current?.setMuted(true);

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
      interruptRef.current = false;
      setPresenceState("thinking");
      try {
        const messages = nextLines.map((line) => ({
          role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
          content: line.text,
        }));
        const previous = nextLines.filter((line) => line.role === "mary").map((line) => line.text);

        // Her first beat starts playing the moment it is written, while the
        // rest of the turn is still being generated.
        let firstBeat: Promise<void> | null = null;
        let turn: MaryTurn = await streamMaryTurn(
          { messages, collected: collectedRef.current },
          (text) => {
            if (previous.some((prev) => isNearRepeat(prev, text))) return;
            if (!firstBeat) firstBeat = say(text);
          },
        );

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

        if (firstBeat) await firstBeat;
        else await say(turn.say);

        if (turn.followUp && !interruptRef.current) {
          // Second beat: a short breath, then the question lands as its own moment.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 260));
          await say(turn.followUp);
        }
        if (turn.complete || turn.declined) {
          const allDone = WAITLIST_FIELDS.every((field) => turn.collected[field]);
          if (turn.complete && allDone) await finalize(turn.collected);
        }
      } catch {
        await say("I hit a snag on my side — could you try that once more?");
      } finally {
        busyRef.current = false;
        lastActivityRef.current = Date.now();
        setListeningPhase(micMutedRef.current ? "paused" : "listening");
        inputRef.current?.focus();
      }
    },
    [finalize, say],
  );

  const sendUser = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return chainRef.current;
      // Talking (or typing) over her ends her turn immediately.
      interruptRef.current = true;
      stopSpeaking();
      // One queue: anything said while she is mid-turn is answered next, in order.
      const run = chainRef.current
        .then(async () => {
          if (sessionFinishedRef.current) return;
          stopSpeaking();
          setInterim("");
          setDraft("");
          const next = [...linesRef.current, { id: uid(), role: "user" as const, text: clean }];
          setLines(next);
          linesRef.current = next;
          await runTurn(next);
        })
        .catch(() => {});
      chainRef.current = run;
      return run;
    },
    [runTurn, stopSpeaking],
  );

  /** A complete utterance came off the open line. */
  const handleUtterance = useCallback(
    async ({ text, audio }: { text: string; audio: Blob | null }) => {
      if (sessionFinishedRef.current || micMutedRef.current) return;
      let spoken = text.trim();
      if (!spoken && audio) {
        setListeningPhase("finishing");
        setPresenceState("thinking");
        try {
          spoken = (await transcribe(audio)).trim();
        } catch {
          spoken = "";
        }
      }
      setInterim("");
      if (!spoken) {
        setListeningPhase("listening");
        setPresenceState((current) => (current === "hearing" ? "idle" : current));
        return;
      }
      void sendUser(spoken);
    },
    [sendUser],
  );

  handleUtteranceRef.current = (utterance) => void handleUtterance(utterance);

  const enterLive = useCallback(async () => {
    setStage("live");
    lastActivityRef.current = Date.now();
    await runTurn([]);
  }, [runTurn]);

  // Talk to MARY: the attribution wipes back behind the divider, the page
  // scrolls away under a blur, and the mark flies to centre, blooms, then
  // pops up to its resting place in the corner.
  const begin = useCallback(async () => {
    if (introRef.current) return;
    introRef.current = true;
    await unlockAudio();

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
          onSpeechStart: () => {
            lastActivityRef.current = Date.now();
            // The first word from you stops her mid-sentence.
            interruptRef.current = true;
            speakRef.current?.stop();
            speakRef.current = null;
            setListeningPhase("hearing");
            setPresenceState("hearing");
          },
          onUtterance: (utterance) => handleUtteranceRef.current(utterance),
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
      } catch {
        setMicLive(false);
        setMicError("Microphone access is off. You can keep the conversation going by typing.");
        inputRef.current?.focus();
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current = null;
      setMicLive(false);
      session?.close();
    };
  }, [stage]);

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
      setListeningPhase("paused");
      setPresenceState((current) =>
        current === "hearing" || current === "listening" ? "idle" : current,
      );
    } else {
      setListeningPhase("listening");
    }
  }, []);

  const onDraftChange = useCallback(
    (value: string) => {
      const wasEmpty = draft.length === 0;
      setDraft(value);
      lastActivityRef.current = Date.now();
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
      // She only nudges when she genuinely cannot hear you.
      if (busyRef.current || !micMutedRef.current || draft.length > 0) return;
      if (Date.now() - lastActivityRef.current < 22000 || nudgeRef.current >= IDLE_NUDGES.length)
        return;
      lastActivityRef.current = Date.now();
      const line = IDLE_NUDGES[nudgeRef.current];
      nudgeRef.current += 1;
      if (line) void say(line);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [draft.length, micMuted, say, stage]);

  useEffect(() => {
    return () => {
      speakRef.current?.stop();
      sessionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (stage === "live") inputRef.current?.focus();
  }, [stage]);

  // Keep the newest turn in view without ever showing a scrollbar.
  useEffect(() => {
    const node = trailRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, interim, stage, viewportHeight]);

  // The centre holds her latest line; everything before it stays in order above.
  const last = lines[lines.length - 1];
  const lastMary = last?.role === "mary" ? last : undefined;
  const history = (lastMary ? lines.slice(0, -1) : lines).slice(-6);

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

  return (
    <main ref={shellRef} className="no-scrollbar relative min-h-dvh overflow-y-auto">
      <AuroraBackground intensity={stage === "landing" ? 0.18 : Math.min(1, 0.4 + level)} />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-4 sm:px-8 sm:py-5">
        <motion.header
          ref={headerRef}
          layout
          transition={SPRING}
          className={`flex min-h-12 items-center gap-4 ${stage === "landing" || stage === "intro" ? "justify-center" : "justify-between"}`}
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
              <div className="mx-auto flex max-w-3xl flex-col items-center">
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
              className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-6 py-3 sm:px-0 lg:py-5"
            >
              <MaryPresence state={presence} level={level} height={liveOrb} />

              <div
                ref={trailRef}
                className="no-scrollbar mt-4 flex min-h-0 min-w-0 flex-1 flex-col justify-end overflow-y-auto"
              >
                <motion.div
                  layout
                  transition={SPRING}
                  className="no-scrollbar mx-auto w-full max-w-xl space-y-2.5"
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
                      className="mx-auto max-w-xl pt-2 text-center"
                    >
                      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-accent-text">
                        MARY
                      </p>
                      <p
                        className={`text-pretty leading-relaxed text-ink ${compact ? "text-lg" : "text-xl sm:text-2xl"}`}
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
                      : presence === "hearing" || presence === "speaking"
                        ? { scale: pulseScale }
                        : { scale: 1 }
                  }
                  transition={SPRING}
                  className="surface-floating mx-auto flex w-full max-w-xl items-end gap-1 rounded-full bg-card/80 px-2 py-1.5 backdrop-blur-sm"
                >
                  <MotionButton
                    onClick={toggleMicMute}
                    whileTap={reduced ? {} : { scale: 0.94 }}
                    whileHover={reduced ? {} : { scale: 1.04 }}
                    transition={SPRING}
                    aria-label={micMuted ? "Unmute your microphone" : "Mute your microphone"}
                    size="icon"
                    className={`surface-raised relative size-11 shrink-0 rounded-full ${micMuted ? "" : "bg-primary text-primary-foreground"}`}
                  >
                    {micMuted ? <MicOff /> : <Mic />}
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
                          : micMuted
                            ? "Muted — type your answer"
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
                      key={
                        listeningPhase === "hearing" || listeningPhase === "finishing"
                          ? listeningPhase
                          : micMuted
                            ? "muted"
                            : "live"
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
                          : micMuted
                            ? "Your microphone is muted. Unmute to keep talking, or type."
                            : "MARY is listening. Just talk — she answers when you pause."}
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
              className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-4 text-center"
            >
              <div>
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
                  Early access confirmed
                </motion.p>
                <motion.h1
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SOFT, delay: 0.2 }}
                  className={`mt-3 text-balance font-semibold leading-tight text-ink ${compact ? "text-4xl" : "text-5xl"}`}
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

              <div className={`w-full text-left ${compact ? "mt-6" : "mt-10"}`}>
                <p className="text-center text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Details confirmed
                </p>
                <dl className={`grid sm:grid-cols-2 ${compact ? "mt-3 gap-4" : "mt-6 gap-6"}`}>
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

        {stage === "live" && <ProgressConstellation collected={collected} />}

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
