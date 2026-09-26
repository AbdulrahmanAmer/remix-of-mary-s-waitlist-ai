import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

import type { Collected } from "@/lib/mary.functions";

import { QUICK } from "./motion";
import { progressOf } from "./progress";

/**
 * What MARY has captured so far. Saved pills show the value with a check, the
 * next one is ringed in dark lime and every pill says its state to a screen
 * reader. When the row overflows it fades at the edge that has more and the
 * next pill is scrolled into view.
 */
export const ProgressPills = memo(function ProgressPills({ collected }: { collected: Collected }) {
  const { pills, saved, total, next } = progressOf(collected);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [fade, setFade] = useState<"" | "pill-fade-start" | "pill-fade-end" | "pill-fade-both">("");

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const more = list.scrollWidth - list.clientWidth;
      if (more <= 2) return setFade("");
      const atStart = list.scrollLeft <= 2;
      const atEnd = list.scrollLeft >= more - 2;
      setFade(atStart ? "pill-fade-end" : atEnd ? "pill-fade-start" : "pill-fade-both");
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [saved]);

  // The pill that is up next comes into view as fields fill in.
  useEffect(() => {
    const list = listRef.current;
    const target = next ? list?.querySelector<HTMLElement>(`[data-field="${next}"]`) : null;
    target?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [next]);

  return (
    <ul
      ref={listRef}
      tabIndex={fade ? 0 : undefined}
      className={`no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto py-0.5 outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ink)] ${fade}`}
      aria-label={`Details MARY has so far: ${saved} of ${total} saved`}
    >
      {pills.map((pill) => (
        <li
          key={pill.field}
          data-field={pill.field}
          className={`flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium ring-1 transition-colors duration-300 ${
            pill.state === "saved"
              ? "text-ink ring-border"
              : pill.state === "next"
                ? "text-accent-text ring-accent-text"
                : "text-muted-foreground ring-border"
          }`}
        >
          <AnimatePresence initial={false}>
            {pill.state === "saved" && (
              <motion.span
                key="check"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={QUICK}
                className="grid size-3.5 place-items-center rounded-full bg-primary text-ink"
                aria-hidden="true"
              >
                <Check className="size-2.5" strokeWidth={3} />
              </motion.span>
            )}
          </AnimatePresence>
          <span className="max-w-32 truncate">{pill.text}</span>
          <span className="sr-only">, {pill.hint}</span>
        </li>
      ))}
    </ul>
  );
});
