import { Check } from "lucide-react";
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

/**
 * Slim side rail: one dot per captured detail, pinned to the right edge of
 * the stage so the conversation keeps the full centre. Labels show on
 * comfortable screens; dots only on small ones.
 */
export function ProgressConstellation({ collected }: { collected: Collected }) {
  const completed = WAITLIST_FIELDS.filter((field) => collected[field]).length;

  return (
    <aside
      className="pointer-events-none fixed right-4 top-1/2 z-20 -translate-y-1/2 sm:right-6 lg:right-10"
      aria-label={`${completed} of ${WAITLIST_FIELDS.length} details captured`}
    >
      <div className="flex flex-col items-end gap-4">
        {WAITLIST_FIELDS.map((field, i) => {
          const value = collected[field];
          return (
            <motion.div
              key={field}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 210, damping: 26 }}
              className="flex items-center gap-2.5"
              title={value ?? LABELS[field]}
            >
              <span className="hidden max-w-36 truncate text-right text-[0.6rem] font-semibold uppercase tracking-[0.12em] md:inline">
                <span className={value ? "text-ink/80" : "text-muted-foreground/70"}>
                  {value ?? LABELS[field]}
                </span>
              </span>
              <motion.span
                animate={{ scale: value ? 1 : 0.85 }}
                transition={{ type: "spring", stiffness: 380, damping: 20 }}
                className={`grid size-3 shrink-0 place-items-center rounded-full ${
                  value ? "bg-primary text-primary-foreground" : "bg-border-strong/40"
                }`}
              >
                {value && <Check className="size-1.5" />}
              </motion.span>
            </motion.div>
          );
        })}
        <span className="pr-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          {completed}/{WAITLIST_FIELDS.length}
        </span>
      </div>
    </aside>
  );
}
