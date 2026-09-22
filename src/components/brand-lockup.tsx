import { motion, useReducedMotion } from "motion/react";
import lockup from "@/assets/omnisuite-lockup.png.asset.json";

export function BrandLockup({
  compact = false,
  centered = false,
}: {
  compact?: boolean;
  centered?: boolean;
}) {
  const reduced = useReducedMotion();

  return (
    <div className={`flex min-w-0 items-center gap-3 ${centered ? "flex-col sm:flex-row" : ""}`}>
      <motion.div
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)", opacity: 0 }}
        animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
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
      <div className="hidden h-7 w-px bg-border sm:block" />
      <p
        className={`${centered ? "block" : "hidden sm:block"} whitespace-nowrap text-xs text-muted-foreground`}
      >
        A product by <span className="wordmark text-ink">omnikom</span>
      </p>
    </div>
  );
}
