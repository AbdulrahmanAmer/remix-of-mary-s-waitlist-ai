import { memo } from "react";
import { motion, useReducedMotion } from "motion/react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "success";

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  success: "Complete",
};

export const MaryOrb = memo(function MaryOrb({
  state,
  level,
  size = 184,
}: {
  state: OrbState;
  level: number;
  size?: number;
}) {
  const reduced = useReducedMotion();
  const active = state === "listening" || state === "speaking";
  const energy = active ? Math.max(0.08, level) : 0;
  const coreScale = state === "success" ? 1.08 : 1 + energy * 0.18;

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`MARY is ${STATE_LABEL[state].toLowerCase()}`}
    >
      <motion.div
        className="absolute inset-2 rounded-full border border-primary/25 bg-primary/5"
        animate={
          reduced
            ? false
            : state === "idle"
              ? { scale: [0.98, 1.02, 0.98], opacity: [0.45, 0.72, 0.45] }
              : { scale: 1 + energy * 0.16, opacity: 0.5 + energy * 0.35 }
        }
        transition={
          state === "idle"
            ? { duration: 4.8, repeat: Infinity, ease: "easeInOut" }
            : { type: "spring", stiffness: 220, damping: 24 }
        }
      />

      <div className="absolute inset-6 rounded-full border border-border-strong bg-card shadow-soft" />

      <motion.div
        className="relative grid size-[48%] place-items-center rounded-full bg-ink text-background shadow-lift"
        animate={reduced ? false : { scale: coreScale }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
      >
        <span className="text-2xl font-bold">M</span>
        {state === "thinking" && !reduced && (
          <motion.span
            className="absolute -inset-2 rounded-full border-2 border-primary border-r-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
        )}
      </motion.div>

      {state === "success" && !reduced && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-primary"
          initial={{ opacity: 0.8, scale: 0.65 }}
          animate={{ opacity: 0, scale: 1.16 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      )}

      <div className="absolute bottom-1 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground shadow-soft">
        <span className={`size-1.5 rounded-full ${active ? "bg-primary" : "bg-border-strong"}`} />
        {STATE_LABEL[state]}
      </div>
    </div>
  );
});
