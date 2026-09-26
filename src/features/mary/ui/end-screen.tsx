import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";

import { WAITLIST_FIELDS, type Collected, type WaitlistField } from "@/lib/mary.functions";

import {
  correctLeadDetails,
  detailProblem,
  leadDelivery,
  leadOutcomeCopy,
  retryLeadDelivery,
} from "../conversation/lead-lifecycle";
import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { FIELD_LABELS } from "../conversation/text";
import { MaryOrb } from "./mary-orb";
import { EASE, SOFT } from "./motion";
import { Logo, SiteFooter, SiteHeader } from "./site-frame";
import { useViewportHeight } from "./use-viewport";

/** Details heard by voice, so the ones worth a second look. */
const EDITABLE: ReadonlySet<WaitlistField> = new Set(["name", "email", "phone"]);

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
  // A Retell call's row is written by the server (the webhook retries it), so there is
  // nothing for this page to retry or re-send.
  const retell = useSession(store, (s) => s.via === "retell");
  const delivery = useSyncExternalStore(leadDelivery.subscribe, leadDelivery.get, leadDelivery.get);
  const viewportHeight = useViewportHeight();
  if (!result) return null;
  const view = leadOutcomeCopy(result, delivery, collected);
  // The summary has to fit under the orb on a laptop, so the orb gives a little.
  const orb = Math.max(150, Math.min(orbSize, 240, Math.round(viewportHeight * 0.2)));
  const fields = WAITLIST_FIELDS.filter(
    (field) => collected[field] || (field === "phone" && result.outcome === "signed_up"),
  );
  const at = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SOFT, delay },
  });
  const save = (field: WaitlistField, value: string) => {
    const next: Collected = { ...collected };
    if (value) next[field] = value;
    else delete next[field];
    void correctLeadDetails(store, next);
  };

  return (
    <motion.section
      key="done"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="no-scrollbar fixed inset-0 flex flex-col overflow-y-auto px-4 sm:px-8"
    >
      <SiteHeader start={<Logo className="h-5 sm:h-7" />} />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-3 text-center sm:py-6">
        <motion.div
          layoutId="mary-orb"
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        >
          <MaryOrb state="done" size={orb} />
        </motion.div>
        <motion.p {...at(0.1)} className="eyebrow mt-3 sm:mt-5">
          {view.eyebrow}
        </motion.p>
        <motion.h1
          {...at(0.16)}
          className="mt-2 text-balance font-display text-3xl font-semibold leading-[1.02] text-ink sm:mt-3 sm:text-5xl"
        >
          {view.title}
        </motion.h1>
        <motion.p
          {...at(0.22)}
          className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:mt-4 sm:max-w-xl sm:text-lg"
        >
          {view.body}
        </motion.p>

        {view.status.kind !== "none" && (
          <motion.div
            {...at(0.28)}
            className="mt-3 flex min-h-9 flex-col items-center justify-center gap-2 sm:mt-5 sm:min-h-10"
            aria-live="polite"
          >
            <AnimatePresence mode="wait" initial={false}>
              {view.status.kind === "pending" ? (
                <motion.span
                  key="pending"
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  {view.status.text}
                </motion.span>
              ) : view.status.kind === "position" ? (
                <motion.span
                  key="position"
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-5 py-2 text-sm font-semibold text-accent-text ring-1 ring-primary/40"
                >
                  {view.status.text}
                </motion.span>
              ) : view.status.kind === "unsaved" ? (
                <motion.span
                  key="unsaved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-full bg-card py-1.5 pl-4 pr-1.5 text-sm font-medium text-ink ring-1 ring-border-strong"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full ring-2 ring-ink/50" />
                    {view.status.text}
                  </span>
                  {view.retry && !retell && (
                    <button
                      type="button"
                      onClick={() => void retryLeadDelivery(store)}
                      className="h-8 rounded-full bg-ink px-4 text-xs font-semibold text-primary transition-opacity hover:opacity-90"
                    >
                      Try again
                    </button>
                  )}
                </motion.span>
              ) : (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm text-muted-foreground"
                >
                  {view.status.text}
                </motion.span>
              )}
            </AnimatePresence>
            {view.status.detail && (
              <span className="max-w-md text-pretty text-xs text-muted-foreground">
                {view.status.detail}
              </span>
            )}
          </motion.div>
        )}

        {result.outcome === "declined" ? (
          <motion.div
            {...at(0.3)}
            className="mt-5 flex flex-wrap items-center justify-center gap-2.5 sm:mt-8 sm:gap-3"
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
              className="mt-6 grid w-full gap-5 rounded-[1.4rem] bg-card p-4 text-left shadow-[0_0_0_1px_var(--color-border),0_30px_60px_-44px_oklch(0.2_0.02_110/0.45)] sm:grid-cols-[1.05fr_1fr] sm:gap-6 sm:rounded-[1.75rem] sm:p-6"
            >
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  What happens next
                </p>
                <ol className="mt-3 space-y-2.5">
                  {view.steps.map((step, index) => (
                    <li
                      key={step}
                      className="flex items-start gap-2.5 text-xs leading-relaxed text-ink sm:gap-3 sm:text-sm"
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {result.outcome === "callback"
                      ? "What the team receives"
                      : "What MARY recorded"}
                  </p>
                  {!retell && (
                    <p className="text-xs text-muted-foreground">Misheard? Tap Edit to fix it.</p>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6">
                  {fields.map((field) => (
                    <DetailRow
                      key={field}
                      field={field}
                      value={collected[field] ?? ""}
                      editable={!retell && EDITABLE.has(field)}
                      onSave={(value) => save(field, value)}
                    />
                  ))}
                </dl>
              </div>
            </motion.div>
            <motion.button
              {...at(0.5)}
              type="button"
              onClick={onRestart}
              className="mt-5 min-h-11 text-xs text-muted-foreground transition-colors hover:text-ink"
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

/** One recorded detail; the contact ones can be corrected in place. */
function DetailRow({
  field,
  value,
  editable,
  onSave,
}: {
  field: WaitlistField;
  value: string;
  editable: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState("");
  const label = FIELD_LABELS[field] ?? field;
  // Email and operations run long: they get the full width so nothing breaks mid-word.
  const span = field === "operations" || field === "email" ? "col-span-2" : "";

  const open = () => {
    setDraft(value);
    setProblem("");
    setEditing(true);
  };
  const close = () => {
    setEditing(false);
    setProblem("");
  };
  const commit = () => {
    const next = draft.trim();
    const issue = detailProblem(field, next);
    if (issue) {
      setProblem(issue);
      return;
    }
    close();
    if (next !== value) onSave(next);
  };

  return (
    <div className={span}>
      <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      {editing ? (
        <dd className="mt-1 flex flex-col gap-1.5">
          <input
            aria-label={label}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
            inputMode={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
            autoCapitalize={field === "name" ? "words" : "off"}
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="h-9 w-full rounded-lg bg-background px-3 text-sm font-medium text-ink ring-1 ring-border-strong focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {problem && <p className="text-xs text-destructive">{problem}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={commit}
              className="h-8 rounded-full bg-ink px-3.5 text-xs font-semibold text-primary"
            >
              Save
            </button>
            <button
              type="button"
              onClick={close}
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </dd>
      ) : (
        <dd className="mt-0.5 flex items-baseline gap-2 text-sm font-medium">
          <span
            className={`min-w-0 break-words [overflow-wrap:anywhere] ${value ? "text-ink" : "text-muted-foreground"}`}
          >
            {value || "Skipped"}
          </span>
          {editable && (
            <button
              type="button"
              aria-label={`${value ? "Edit" : "Add"} ${label.toLowerCase()}`}
              onClick={open}
              className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-ink"
            >
              {value ? "Edit" : "Add"}
            </button>
          )}
        </dd>
      )}
    </div>
  );
}
