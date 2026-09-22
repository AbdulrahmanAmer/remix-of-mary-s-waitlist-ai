import { motion } from "motion/react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "success";

const RING_COUNT = 5;

export function MaryOrb({
  state,
  level,
  size = 260,
}: {
  state: OrbState;
  level: number;
  size?: number;
}) {
  const energy = state === "idle" ? 0.12 : Math.max(0.1, level);
  const hueRing =
    state === "listening"
      ? "var(--aurora-2)"
      : state === "success"
        ? "var(--aurora-3)"
        : "var(--primary)";

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* audio-reactive halo */}
      <motion.div
        className="absolute rounded-full blur-3xl"
        style={{ width: size, height: size, backgroundColor: hueRing }}
        animate={{
          opacity: 0.25 + energy * 0.45,
          scale: 0.85 + energy * 0.5,
        }}
        transition={{ type: "spring", stiffness: 160, damping: 18 }}
      />

      {Array.from({ length: RING_COUNT }).map((_, i) => {
        const delay = i * 0.42;
        const inset = i * 7;
        return (
          <motion.div
            key={i}
            className="absolute rounded-full border"
            style={{
              width: size - inset * 2,
              height: size - inset * 2,
              borderColor: hueRing,
              opacity: 0.16 + i * 0.04,
            }}
            animate={{
              scale: [1, 1.06 + energy * 0.16, 1],
              rotate: [0, i % 2 === 0 ? 12 : -12, 0],
            }}
            transition={{
              duration: 6 - i * 0.5,
              repeat: Infinity,
              ease: "easeInOut",
              delay,
            }}
          />
        );
      })}

      {/* core */}
      <motion.div
        className="relative grid place-items-center rounded-full"
        style={{
          width: size * 0.52,
          height: size * 0.52,
          background:
            "conic-gradient(from 210deg, var(--aurora-1), var(--aurora-2), var(--aurora-3), var(--aurora-1))",
          boxShadow: "0 0 80px -10px var(--primary)",
        }}
        animate={{
          scale: state === "thinking" ? [1, 0.94, 1] : 1 + energy * 0.16,
          rotate: 360,
        }}
        transition={{
          scale:
            state === "thinking"
              ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
              : { type: "spring", stiffness: 220, damping: 16 },
          rotate: { duration: 22, repeat: Infinity, ease: "linear" },
        }}
      >
        <div
          className="absolute inset-[3px] rounded-full backdrop-blur-xl"
          style={{ backgroundColor: "oklch(0.15 0.025 266 / 0.72)" }}
        />
        <span className="font-display relative text-2xl font-semibold tracking-[0.35em] text-white/90">
          M
        </span>
      </motion.div>

      {/* orbiting particle */}
      <motion.div
        className="absolute"
        style={{ width: size, height: size }}
        animate={{ rotate: 360 }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
      >
        <motion.span
          className="absolute left-1/2 top-0 block size-2 -translate-x-1/2 rounded-full"
          style={{ backgroundColor: "var(--aurora-2)" }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      </motion.div>
    </div>
  );
}
