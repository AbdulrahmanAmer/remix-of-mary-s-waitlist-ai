import { motion } from "motion/react";
import { WAITLIST_FIELDS, type Collected } from "@/lib/mary.functions";

const LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  business: "Business",
  industry: "Industry",
  operations: "Operations",
};

export function ProgressConstellation({ collected }: { collected: Collected }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {WAITLIST_FIELDS.map((field, i) => {
        const value = collected[field];
        const filled = Boolean(value);
        return (
          <motion.div
            key={field}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 24 }}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filled
                ? "border-white/25 bg-white/10 text-white"
                : "border-white/10 bg-white/[0.03] text-white/40"
            }`}
            title={value ?? undefined}
          >
            <motion.span
              className="size-1.5 rounded-full"
              style={{
                backgroundColor: filled ? "var(--aurora-2)" : "oklch(1 0 0 / 0.25)",
              }}
              animate={filled ? { scale: [1, 1.7, 1] } : {}}
              transition={{ duration: 0.6 }}
            />
            <span className="font-medium">{LABELS[field]}</span>
            {filled && <span className="max-w-[9rem] truncate text-white/55">{value}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}
