import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";

import { WAITLIST_FIELDS, type Collected } from "@/lib/mary.functions";

import { FIELD_LABELS } from "../conversation/text";
import { QUICK } from "./motion";

/** What MARY has captured so far: filled pills show the value, the next one is ringed. */
export const ProgressPills = memo(function ProgressPills({ collected }: { collected: Collected }) {
  const next = WAITLIST_FIELDS.find((field) => !collected[field]);
  return (
    <ul
      className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto sm:gap-1.5"
      aria-label="Details MARY has so far"
    >
      {WAITLIST_FIELDS.map((field) => {
        const value = collected[field];
        const done = Boolean(value);
        return (
          <li
            key={field}
            className={`flex shrink-0 items-center gap-1 rounded-full bg-card px-2 py-1 text-[0.65rem] font-medium ring-1 transition-colors duration-300 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs ${
              done
                ? "text-ink ring-border"
                : field === next
                  ? "text-ink ring-primary"
                  : "text-muted-foreground ring-border"
            }`}
          >
            <AnimatePresence initial={false}>
              {done && (
                <motion.span
                  key="dot"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={QUICK}
                  className="size-1.5 rounded-full bg-primary"
                />
              )}
            </AnimatePresence>
            <span className="max-w-32 truncate">
              {done && field !== "operations" ? value : FIELD_LABELS[field]}
            </span>
          </li>
        );
      })}
    </ul>
  );
});
