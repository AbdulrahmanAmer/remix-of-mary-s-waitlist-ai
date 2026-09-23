import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Keyboard } from "lucide-react";

import { MaryOrb } from "./mary-orb";
import { EASE, SOFT } from "./motion";
import { SiteFooter, SiteHeader, Logo } from "./site-frame";

const OPENER = "Hi, I'm MARY. Want first access to OmniSuite through the launch waitlist?";

/** MARY's opener typing itself out, as a preview of the call. */
function SpeechPreview({ play, className = "" }: { play: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!play) return;
    if (reduced) {
      setCount(OPENER.length);
      return;
    }
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= OPENER.length) window.clearInterval(timer);
    }, 38);
    return () => window.clearInterval(timer);
  }, [play, reduced]);
  const typing = count < OPENER.length;
  return (
    <div
      className={`rounded-[1.4rem] rounded-bl-md bg-card px-4 py-3.5 text-left shadow-[0_0_0_1px_var(--color-border),0_22px_44px_-28px_oklch(0.2_0.02_110/0.45)] ${className}`}
    >
      <p className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-accent-text">
        <span className={`size-1.5 rounded-full bg-primary ${typing ? "animate-pulse" : ""}`} />
        MARY · {typing ? "speaking" : "waiting for you"}
      </p>
      <p className="mt-1.5 min-h-[2.9em] text-[0.98rem] leading-snug text-ink sm:text-[1.05rem]">
        {OPENER.slice(0, count)}
        {typing && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-ink" />
        )}
      </p>
    </div>
  );
}

/** A CSS-only voice waveform: no per-frame JavaScript. */
function Waveform() {
  return (
    <div className="flex h-7 items-center justify-center gap-[5px]" aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <span key={i} className="mary-wave-bar" style={{ animationDelay: `${(i * 97) % 900}ms` }} />
      ))}
    </div>
  );
}

export function Landing({
  ready,
  orbSize,
  onStart,
}: {
  /** The boot screen is leaving: start the entrance. */
  ready: boolean;
  orbSize: number;
  onStart: (voice: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const [replied, setReplied] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setReplied(true), reduced ? 0 : 3400);
    return () => window.clearTimeout(timer);
  }, [ready, reduced]);

  const show = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 16 },
    animate: ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 },
    transition: { ...SOFT, duration: 0.7, delay: ready ? delay : 0 },
  });

  return (
    <motion.section
      key="landing"
      exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE } }}
      className="no-scrollbar fixed inset-0 flex flex-col overflow-y-auto px-5 sm:px-8"
    >
      <SiteHeader centered start={<Logo />} />
      <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
        <div className="relative flex w-full max-w-3xl flex-col items-center">
          {/* Phones: the speech card sits above the orb. */}
          <motion.div {...show(0.35)} className="mb-3 w-full max-w-sm sm:hidden">
            <SpeechPreview play={ready} />
          </motion.div>

          <div className="relative">
            <motion.div
              layoutId="mary-orb"
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
            >
              <motion.div {...show(0.05)}>
                <MaryOrb state={replied ? "listening" : "speaking"} size={orbSize} />
              </motion.div>
            </motion.div>
            {/* Desktop: MARY's card to the right, the visitor's reply to the left. */}
            <motion.div
              {...show(0.45)}
              className="absolute left-[calc(100%-1.5rem)] top-[8%] hidden w-80 sm:block"
            >
              <SpeechPreview play={ready} />
            </motion.div>
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={
                replied ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 10, scale: 0.96 }
              }
              transition={SOFT}
              className="absolute right-[calc(100%-1rem)] top-[58%] hidden whitespace-nowrap rounded-[1.3rem] rounded-br-md bg-ink px-4 py-2.5 text-[0.95rem] text-background shadow-[0_22px_44px_-26px_oklch(0.2_0.02_110/0.6)] sm:block"
            >
              Yes, sign me up
            </motion.div>
          </div>

          <motion.div {...show(0.2)} className="mt-1">
            <Waveform />
          </motion.div>

          <motion.h1
            {...show(0.25)}
            className="mt-5 text-balance font-display text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-7xl"
          >
            Meet MARY<span className="text-primary">.</span>
          </motion.h1>
          <motion.p
            {...show(0.32)}
            className="mt-4 max-w-md text-pretty text-base leading-relaxed text-muted-foreground sm:max-w-xl sm:text-lg"
          >
            Your AI Revenue Concierge. Talk to her for two minutes and she'll save your spot on the
            OmniSuite launch waitlist.
          </motion.p>
          <motion.div
            {...show(0.4)}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <motion.button
              type="button"
              onClick={() => onStart(true)}
              whileHover={reduced ? {} : { y: -2 }}
              whileTap={reduced ? {} : { scale: 0.98 }}
              className="inline-flex h-14 items-center gap-3 rounded-full bg-primary pl-7 pr-2.5 text-base font-semibold text-ink shadow-[inset_0_1px_0_oklch(1_0_0/0.45),0_1px_0_oklch(0.55_0.15_118/0.5),0_18px_34px_-18px_oklch(0.55_0.15_118/0.75)] outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Start talking
              <span className="grid size-9 place-items-center rounded-full bg-ink text-primary">
                <ArrowRight className="size-4" />
              </span>
            </motion.button>
            <button
              type="button"
              onClick={() => onStart(false)}
              className="inline-flex h-14 items-center gap-2 rounded-full bg-card px-6 text-sm font-medium text-ink ring-1 ring-border transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ink"
            >
              <Keyboard className="size-4 text-muted-foreground" />
              Type instead
            </button>
          </motion.div>
        </div>
      </div>
      <SiteFooter />
    </motion.section>
  );
}
