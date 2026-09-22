import { motion } from "motion/react";

export function AuroraBackground({ intensity = 0 }: { intensity?: number }) {
  const boost = 1 + intensity * 0.5;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,oklch(0.24_0.06_268)_0%,oklch(0.14_0.024_266)_55%,oklch(0.11_0.02_266)_100%)]" />
      <motion.div
        className="absolute -left-40 top-[-18%] h-[46rem] w-[46rem] rounded-full blur-[130px]"
        style={{ backgroundColor: "var(--aurora-1)", opacity: 0.3 }}
        animate={{
          x: [0, 90, -30, 0],
          y: [0, 60, 120, 0],
          scale: [1 * boost, 1.14 * boost, 0.96 * boost, 1 * boost],
        }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-52 top-[12%] h-[40rem] w-[40rem] rounded-full blur-[140px]"
        style={{ backgroundColor: "var(--aurora-2)", opacity: 0.22 }}
        animate={{
          x: [0, -70, 40, 0],
          y: [0, 90, -40, 0],
          scale: [1 * boost, 0.92 * boost, 1.16 * boost, 1 * boost],
        }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[-25%] left-1/3 h-[42rem] w-[42rem] rounded-full blur-[150px]"
        style={{ backgroundColor: "var(--aurora-3)", opacity: 0.18 }}
        animate={{ x: [0, 60, -60, 0], y: [0, -50, 30, 0] }}
        transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="grain-overlay absolute inset-0 opacity-[0.035] mix-blend-overlay" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_60%,oklch(0.1_0.02_266)_100%)]" />
    </div>
  );
}
