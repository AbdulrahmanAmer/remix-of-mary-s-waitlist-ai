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
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink">Your details</span>
        <span className="text-muted-foreground">
          {completed}/{WAITLIST_FIELDS.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
        {WAITLIST_FIELDS.map((field, i) => {
          const value = collected[field];
          return (
            <motion.div
              key={field}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035, duration: 0.3 }}
              className={`min-w-0 rounded-lg border px-3 py-2.5 ${
                value ? "border-primary/40 bg-primary/8" : "border-border bg-surface"
              }`}
              title={value ?? undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid size-4 place-items-center rounded-full ${value ? "bg-primary text-primary-foreground" : "border border-border-strong"}`}
                >
                  {value && <Check className="size-2.5" />}
                </span>
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {LABELS[field]}
                </span>
              </div>
              <p className="mt-1.5 truncate text-xs font-medium text-ink">
                {value || "Not captured"}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
