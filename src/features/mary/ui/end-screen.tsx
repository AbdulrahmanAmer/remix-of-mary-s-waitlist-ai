import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";

import { WAITLIST_FIELDS } from "@/lib/mary.functions";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { closingCopy, FIELD_LABELS } from "../conversation/text";
import { MaryOrb } from "./mary-orb";
import { EASE, SOFT } from "./motion";
import { Logo, SiteFooter, SiteHeader } from "./site-frame";

export function EndScreen({
  store,
  orbSize,
  onResume,
  onRestart,
}: {
  store: SessionStore;
  orbSize: number;
  onResume: () => void;
  onRestart: () => void;
}) {
  const reduced = useReducedMotion();
  const result = useSession(store, (s) => s.result);
  const collected = useSession(store, (s) => s.collected);
  if (!result) return null;
  const firstName = (collected.name ?? "").trim().split(/\s+/)[0] ?? "";
  const copy = closingCopy(result.outcome, firstName, collected.phone ?? "");
  const fields = WAITLIST_FIELDS.filter(
    (field) => collected[field] || (field === "phone" && result.outcome === "signed_up"),
  );
  const at = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SOFT, delay },
  });

  return (
    <motion.section
      key="done"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="no-scrollbar fixed inset-0 flex flex-col overflow-y-auto px-5 sm:px-8"
    >
      <SiteHeader start={<Logo className="h-6 sm:h-7" />} />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-6 text-center">
        <motion.div
          layoutId="mary-orb"
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        >
          <MaryOrb state="done" size={orbSize} />
        </motion.div>
        <motion.p {...at(0.1)} className="eyebrow mt-5">
          {copy.eyebrow}
        </motion.p>
        <motion.h1
          {...at(0.16)}
          className="mt-3 text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-6xl"
        >
          {copy.title}
        </motion.h1>
        <motion.p
          {...at(0.22)}
          className="mx-auto mt-4 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          {copy.body}
        </motion.p>

        {result.outcome === "signed_up" && (
          <motion.div {...at(0.28)} className="mt-5 flex min-h-10 items-center justify-center">
            <AnimatePresence mode="wait" initial={false}>
              {result.sync === "pending" ? (
                <motion.span
                  key="pending"
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  Securing your place…
                </motion.span>
              ) : result.position ? (
                <motion.span
                  key="position"
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-5 py-2 text-sm font-semibold text-accent-text ring-1 ring-primary/40"
                >
                  Early access position #{result.position}
                </motion.span>
              ) : (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-muted-foreground"
                >
                  Your details are saved. Your position comes with the confirmation.
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {result.outcome === "declined" ? (
          <motion.div
            {...at(0.3)}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <motion.button
              type="button"
              onClick={onResume}
              whileHover={reduced ? {} : { y: -2 }}
              whileTap={reduced ? {} : { scale: 0.98 }}
              className="inline-flex h-13 items-center gap-3 rounded-full bg-primary pl-6 pr-2.5 text-sm font-semibold text-ink shadow-[inset_0_1px_0_oklch(1_0_0/0.45),0_18px_34px_-18px_oklch(0.55_0.15_118/0.75)]"
            >
              Keep talking to MARY
              <span className="grid size-8 place-items-center rounded-full bg-ink text-primary">
                <ArrowRight className="size-4" />
              </span>
            </motion.button>
            <button
              type="button"
              onClick={onRestart}
              className="h-13 rounded-full px-5 text-sm text-muted-foreground hover:text-ink"
            >
              Start over
            </button>
          </motion.div>
        ) : (
          <>
            <motion.div
              {...at(0.34)}
              className="mt-10 grid w-full gap-8 rounded-[1.75rem] bg-card p-6 text-left shadow-[0_0_0_1px_var(--color-border),0_30px_60px_-44px_oklch(0.2_0.02_110/0.45)] sm:grid-cols-[1.05fr_1fr] sm:p-8"
            >
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  What happens next
                </p>
                <ol className="mt-4 space-y-3.5">
                  {copy.steps.map((step, index) => (
                    <li
                      key={step}
                      className="flex items-start gap-3 text-sm leading-relaxed text-ink"
                    >
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/25 text-[0.65rem] font-semibold text-accent-text">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {result.outcome === "callback" ? "What the team receives" : "Details confirmed"}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                  {fields.map((field) => (
                    <div key={field} className={field === "operations" ? "col-span-2" : ""}>
                      <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {FIELD_LABELS[field]}
                      </dt>
                      <dd
                        className={`mt-0.5 break-words text-sm font-medium ${collected[field] ? "text-ink" : "text-muted-foreground"}`}
                      >
                        {collected[field] || "Skipped"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </motion.div>
            <motion.button
              {...at(0.5)}
              type="button"
              onClick={onRestart}
              className="mt-8 text-xs text-muted-foreground transition-colors hover:text-ink"
            >
              Start another conversation
            </motion.button>
          </>
        )}
      </div>
      <SiteFooter />
    </motion.section>
  );
}
