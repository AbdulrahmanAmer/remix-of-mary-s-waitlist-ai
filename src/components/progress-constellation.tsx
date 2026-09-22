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

export function ProgressConstellation({ collected }: { collected: Collected }) {
  const completed = WAITLIST_FIELDS.filter((field) => collected[field]).length;

  return (
    <div
      className="w-full"
      aria-label={`${completed} of ${WAITLIST_FIELDS.length} details captured`}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {WAITLIST_FIELDS.map((field, i) => {
          const value = collected[field];
          return (
            <motion.span
              key={field}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: value ? 1 : 0.5, y: 0 }}
              transition={{
                delay: i * 0.04,
                type: "spring",
                stiffness: 210,
                damping: 26,
              }}
              className="inline-flex min-w-0 items-center gap-1.5"
              title={value ?? undefined}
            >
              <motion.span
                animate={{ scale: value ? 1 : 0.9 }}
                transition={{ type: "spring", stiffness: 380, damping: 20 }}
                className={`grid size-3.5 shrink-0 place-items-center rounded-full ${value ? "bg-primary text-primary-foreground" : "bg-border-strong/50"}`}
              >
                {value && <Check className="size-2" />}
              </motion.span>
              <span className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {value ? value : LABELS[field]}
              </span>
            </motion.span>
          );
        })}
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
          {completed}/{WAITLIST_FIELDS.length}
        </span>
      </div>
    </div>
  );
}
