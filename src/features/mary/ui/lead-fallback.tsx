import { useId, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, RotateCcw } from "lucide-react";

import type { SessionStore } from "../conversation/store";
import { useSession } from "../conversation/store";
import { emailFromLines } from "../conversation/text";
import { MaryOrb } from "./mary-orb";
import { EASE, SOFT } from "./motion";
import { Logo, SiteFooter, SiteHeader } from "./site-frame";

export type FallbackFields = { name: string; email: string; business: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function Field({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="flex items-baseline justify-between text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {hint && <span className="font-medium normal-case tracking-normal">{hint}</span>}
      </span>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-1.5 h-12 w-full rounded-2xl bg-background px-4 text-base text-ink outline-none transition-shadow placeholder:text-muted-foreground focus:shadow-[0_0_0_2px_var(--color-ink)] ${
          error
            ? "shadow-[0_0_0_2px_var(--color-accent-text)]"
            : "shadow-[0_0_0_1px_var(--color-border)]"
        }`}
        {...input}
      />
      {error && (
        <span id={`${id}-error`} className="mt-1.5 block text-sm text-accent-text">
          {error}
        </span>
      )}
    </label>
  );
}

/**
 * MARY's line to the AI is down. Instead of a loop of apologies, the visitor
 * gets the shortest possible form, saved through the same lead pipeline as a
 * finished conversation, so nobody leaves with nothing.
 */
export function LeadFallback({
  store,
  orbSize,
  onSubmit,
  onRetry,
}: {
  store: SessionStore;
  orbSize: number;
  onSubmit: (fields: FallbackFields) => void;
  /** Back to the call, for when the outage has passed. */
  onRetry: () => void;
}) {
  const reduced = useReducedMotion();
  const collected = useSession(store, (s) => s.collected);
  const lines = useSession(store, (s) => s.lines);
  const [name, setName] = useState(collected.name ?? "");
  const [email, setEmail] = useState(collected.email ?? emailFromLines(lines));
  const [business, setBusiness] = useState(collected.business ?? "");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: { name?: string; email?: string } = {};
    if (!name.trim()) next.name = "Your name, so the team knows who to write to.";
    if (!EMAIL.test(email.trim()))
      next.email = "That email doesn't look complete — check the @ and the domain.";
    setErrors(next);
    if (next.name || next.email) return;
    setSaving(true);
    onSubmit({ name: name.trim(), email: email.trim(), business: business.trim() });
  };

  const at = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SOFT, delay },
  });

  return (
    <motion.section
      key="fallback"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="no-scrollbar fixed inset-0 flex flex-col overflow-y-auto px-5 sm:px-8"
    >
      <SiteHeader start={<Logo className="h-6 sm:h-7" />} />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-6 text-center">
        <motion.div
          layoutId="mary-orb"
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        >
          <MaryOrb state="idle" size={orbSize} />
        </motion.div>
        <motion.p {...at(0.1)} className="eyebrow mt-5">
          MARY's line is down
        </motion.p>
        <motion.h1
          {...at(0.16)}
          className="mt-3 text-balance font-display text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl"
        >
          I can't reach my team right now.
        </motion.h1>
        <motion.p
          {...at(0.22)}
          className="mx-auto mt-4 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          Leave your details and a real person will follow up. Your spot on the launch list is held
          either way.
        </motion.p>

        <motion.form
          {...at(0.3)}
          noValidate
          onSubmit={submit}
          aria-label="Your details"
          className="mt-8 w-full max-w-md space-y-4 rounded-[1.75rem] bg-card p-5 text-left shadow-[0_0_0_1px_var(--color-border),0_30px_60px_-44px_oklch(0.2_0.02_110/0.45)] sm:p-6"
        >
          <Field
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Sam Rivera"
            error={errors.name}
            autoFocus={!name}
          />
          <Field
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="sam@yourbusiness.com"
            error={errors.email}
          />
          <Field
            label="Business"
            hint="optional"
            value={business}
            onChange={(event) => setBusiness(event.target.value)}
            autoComplete="organization"
            enterKeyHint="done"
            placeholder="What it's called, what it does"
          />
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-primary pl-4 pr-2.5 text-base font-semibold text-ink shadow-[inset_0_1px_0_oklch(1_0_0/0.45),0_18px_34px_-18px_oklch(0.55_0.15_118/0.75)] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-70"
          >
            {saving ? "Saving your spot…" : "Save my spot"}
            <span className="grid size-9 place-items-center rounded-full bg-ink text-primary">
              <ArrowRight className="size-4" />
            </span>
          </button>
        </motion.form>

        <motion.button
          {...at(0.4)}
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Try talking to MARY again
        </motion.button>
      </div>
      <SiteFooter />
    </motion.section>
  );
}
