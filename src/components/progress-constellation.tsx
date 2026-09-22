import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { WAITLIST_FIELDS, type Collected } from "@/lib/mary.functions";

const LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  business: "Business",
  industry: "Industry",
  operations: "Operations",
};

const SPRING = { type: "spring", stiffness: 220, damping: 24, mass: 0.8 } as const;

/**
 * Progress through the six details.
 *
 * `rail` — the slim side rail on wide screens: pending details sit as quiet
 * dots; the moment one is captured it flies in from off the edge and settles,
 * leaving the conversation the whole centre of the stage.
 *
 * `row` — the same six dots as a compact strip for narrow screens, where a
 * side rail would sit on top of the words.
 */
export function ProgressConstellation({
  collected,
  variant = "rail",
}: {
  collected: Collected;
  variant?: "rail" | "row";
}) {
  const completed = WAITLIST_FIELDS.filter((field) => collected[field]).length;
  const label = `${completed} of ${WAITLIST_FIELDS.length} details captured`;

  if (variant === "row") {
    return (
      <div
        className="flex items-center gap-2 rounded-full px-2 py-1"
        role="img"
        aria-label={label}
        title={label}
      >
        <div className="flex items-center gap-1.5">
          {WAITLIST_FIELDS.map((field) => {
            const value = collected[field];
            return (
              <motion.span
                key={field}
                animate={{ scale: value ? 1 : 0.78, opacity: value ? 1 : 0.7 }}
                transition={{ type: "spring", stiffness: 420, damping: 18 }}
                className={`grid size-2.5 place-items-center rounded-full ${
                  value ? "bg-primary text-primary-foreground" : "bg-border-strong/40"
                }`}
              >
                {value && <Check className="size-1.5" strokeWidth={3} />}
              </motion.span>
            );
          })}
        </div>
        <span className="text-[0.6rem] font-semibold tabular-nums uppercase tracking-[0.12em] text-muted-foreground/70">
          {completed}/{WAITLIST_FIELDS.length}
        </span>
      </div>
    );
  }

  return (
    <aside
      className="pointer-events-none fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 md:block lg:right-8"
      aria-label={label}
    >
      <div className="flex flex-col items-end gap-3.5">
        {WAITLIST_FIELDS.map((field) => {
          const value = collected[field];
          return (
            <div key={field} className="flex h-4 items-center justify-end gap-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {value ? (
                  <motion.span
                    key="value"
                    initial={{ opacity: 0, x: 420, filter: "blur(6px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    transition={SPRING}
                    className="max-w-24 truncate text-right text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ink/80"
                    title={value}
                  >
                    {value}
                  </motion.span>
                ) : (
                  <motion.span
                    key="label"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.25 }}
                    className="max-w-24 truncate text-right text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60"
                  >
                    {LABELS[field]}
                  </motion.span>
                )}
              </AnimatePresence>
              <motion.span
                animate={{ scale: value ? 1 : 0.8 }}
                transition={{ type: "spring", stiffness: 420, damping: 18 }}
                className={`grid size-3 shrink-0 place-items-center rounded-full ${
                  value ? "bg-primary text-primary-foreground" : "bg-border-strong/35"
                }`}
              >
                {value && <Check className="size-1.5" />}
              </motion.span>
            </div>
          );
        })}
        <span className="pr-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {completed}/{WAITLIST_FIELDS.length}
        </span>
      </div>
    </aside>
  );
}
