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
 * Slim side rail. Pending details sit as quiet dots; the moment one is
 * captured it flies in from far off the edge of the screen and settles,
 * leaving the conversation the whole centre of the stage.
 */
export function ProgressConstellation({ collected }: { collected: Collected }) {
  const completed = WAITLIST_FIELDS.filter((field) => collected[field]).length;

  return (
    <aside
      className="pointer-events-none fixed right-3 top-1/2 z-20 -translate-y-1/2 sm:right-5 lg:right-8"
      aria-label={`${completed} of ${WAITLIST_FIELDS.length} details captured`}
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
                    className="hidden max-w-24 truncate text-right text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ink/80 md:inline"
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
                    className="hidden max-w-24 truncate text-right text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60 md:inline"
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
