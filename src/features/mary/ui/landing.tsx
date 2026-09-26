import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Keyboard } from "lucide-react";

import { fitOrb, LANDING_ORB_SHARES } from "./fit";
import { MaryOrb } from "./mary-orb";
import { EASE, SOFT } from "./motion";
import { SiteFooter, SiteHeader, Logo } from "./site-frame";
import { useViewportHeight } from "./use-viewport";

// The shape of her real opener: a hello, who she is, then your name.
const OPENER = "Hi, I'm MARY, the AI concierge for OmniSuite. What should I call you?";
const TYPE_MS = 38;

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
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [play, reduced]);
  const typing = count < OPENER.length;
  return (
    <div
      className={`rounded-[1.4rem] rounded-bl-md bg-card px-4 py-3.5 text-left shadow-[0_0_0_1px_var(--color-border),0_22px_44px_-28px_oklch(0.2_0.02_110/0.45)] ${className}`}
      aria-hidden="true"
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
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
  const viewportHeight = useViewportHeight();
  const orb = fitOrb(orbSize, viewportHeight, LANDING_ORB_SHARES);
  const [replied, setReplied] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(
      () => setReplied(true),
      reduced ? 0 : OPENER.length * TYPE_MS + 600,
    );
    return () => window.clearTimeout(timer);
  }, [ready, reduced]);

  // The button comes in first and fast; the scenery follows it.
  const show = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
    transition: { ...SOFT, duration: 0.5, delay: ready ? delay : 0 },
  });

  return (
    <motion.section
      key="landing"
      exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE } }}
      className="no-scrollbar screen-gutter fixed inset-0 flex flex-col overflow-y-auto"
    >
      <SiteHeader centered start={<Logo />} />
      <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
        <div className="relative flex w-full max-w-3xl flex-col items-center short:max-w-none short:flex-row short:justify-center short:gap-10 short:text-left">
          {/* Phones and tablets: the speech card sits above the orb. */}
          <motion.div {...show(0.3)} className="mb-3 w-full max-w-sm lg:hidden short:hidden">
            <SpeechPreview play={ready} />
          </motion.div>

          <div className="relative shrink-0">
            <motion.div
              layoutId="mary-orb"
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
            >
              <motion.div {...show(0)}>
                <MaryOrb state={replied ? "listening" : "speaking"} size={orb} decorative />
              </motion.div>
            </motion.div>
            {/* Wide screens: MARY's card to the right, the visitor's reply to the left. */}
            <motion.div
              {...show(0.4)}
              className="absolute left-[calc(100%-1.5rem)] top-[8%] hidden w-80 lg:block"
            >
              <SpeechPreview play={ready} />
            </motion.div>
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={
                replied ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 10, scale: 0.96 }
              }
              transition={SOFT}
              aria-hidden="true"
              className="absolute right-[calc(100%-1rem)] top-[58%] hidden whitespace-nowrap rounded-[1.3rem] rounded-br-md bg-ink px-4 py-2.5 text-[0.95rem] text-background shadow-[0_22px_44px_-26px_oklch(0.2_0.02_110/0.6)] lg:block"
            >
              Yes, sign me up
            </motion.div>
          </div>

          <div className="flex flex-col items-center short:items-start">
            <motion.div {...show(0.1)} className="mt-1 short:hidden">
              <Waveform />
            </motion.div>

            <motion.h1
              {...show(0.12)}
              className="mt-5 text-balance font-display text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-7xl short:mt-0 short:text-5xl"
            >
              Meet MARY<span className="text-primary">.</span>
            </motion.h1>
            <motion.p
              {...show(0.16)}
              className="mt-4 max-w-md text-pretty text-base leading-relaxed text-muted-foreground sm:max-w-xl sm:text-lg short:mt-3 short:text-base"
            >
              Your AI Revenue Concierge. Tell her about your business and she'll save your spot on
              the OmniSuite launch waitlist.
            </motion.p>
            <motion.div
              {...show(0.08)}
              className="mt-7 flex flex-wrap items-center justify-center gap-3 short:mt-5 short:justify-start"
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
            {/* What to expect, before the browser asks for anything. */}
            <motion.p
              {...show(0.2)}
              className="mt-5 max-w-md text-pretty text-[0.9rem] leading-relaxed text-muted-foreground short:mt-3 short:max-w-lg"
            >
              Early access and launch pricing for teams that run on leads. About three minutes: your
              browser will ask for the microphone, then she'll ask your name, your business and
              where to send the invite.
            </motion.p>
            <motion.p
              {...show(0.24)}
              className="mt-3 max-w-md text-pretty text-xs leading-relaxed text-muted-foreground short:max-w-lg"
            >
              MARY is an AI. Your conversation is transcribed and saved so the Omnikom team can
              follow up.{" "}
              <Link
                to="/privacy"
                className="text-ink underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-ink"
              >
                How your details are handled
              </Link>
            </motion.p>
          </div>
        </div>
      </div>
      <SiteFooter className="short:hidden" />
    </motion.section>
  );
}
