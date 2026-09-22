import { motion, useReducedMotion } from "motion/react";
import lockup from "@/assets/omnisuite-lockup.png.asset.json";

const EASE = [0.22, 1, 0.36, 1] as const;

export function BrandLockup({
  compact = false,
  centered = false,
  wiping = false,
  hidden = false,
  revealDelay = 0,
}: {
  compact?: boolean;
  centered?: boolean;
  /** The attribution slides back behind the divider, then the divider collapses. */
  wiping?: boolean;
  /** Hidden while an overlay clone of the mark is in flight. */
  hidden?: boolean;
  revealDelay?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: hidden ? 0.01 : 0.3, ease: EASE }}
      className={`flex min-w-0 items-center gap-3 ${centered ? "flex-col sm:flex-row" : ""}`}
    >
      <motion.div
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)", opacity: 0 }}
        animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
        transition={{ duration: 0.7, ease: EASE, delay: revealDelay }}
        className="shrink-0"
      >
        <img
          src={lockup.url}
          alt="OmniSuite"
          width={264}
          height={56}
          className={compact ? "h-7 w-auto" : "h-8 w-auto sm:h-9"}
        />
      </motion.div>
      <motion.div
        aria-hidden="true"
        animate={{ scaleY: wiping ? 0 : 1, opacity: wiping ? 0 : 1 }}
        transition={{ duration: 0.26, ease: EASE, delay: wiping ? 0.26 : 0 }}
        className="hidden h-7 w-px origin-center bg-border sm:block"
      />
      <motion.p
        animate={
          wiping
            ? { clipPath: "inset(0 0 0 100%)", x: -18, opacity: 0 }
            : { clipPath: "inset(0 0 0 0%)", x: 0, opacity: 1 }
        }
        transition={{ duration: 0.34, ease: EASE }}
        className={`${centered ? "block" : "hidden sm:block"} whitespace-nowrap text-xs text-muted-foreground`}
      >
        A product by <span className="wordmark text-ink">omnikom</span>
      </motion.p>
    </motion.div>
  );
}
