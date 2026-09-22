import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { clearLessons, loadLessons, type StoredLesson } from "@/lib/experience-store";
import { clearEntries, downloadCsv, loadEntries, type WaitlistEntry } from "@/lib/waitlist-store";

type SheetStatus =
  | { state: "checking" }
  | { state: "off" }
  | { state: "on"; leads: number; lessons: number; version: string }
  | { state: "error"; error: string };

type Tab = "entries" | "notes";

/**
 * Owner-only view: what this device has collected, whether the Google Sheet
 * is connected, and the field notes MARY has written for herself.
 * Opens with Ctrl/Cmd + Shift + W, closes with the same keys or Escape.
 */
export function WaitlistVault() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("entries");
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [lessons, setLessons] = useState<StoredLesson[]>([]);
  const [sheet, setSheet] = useState<SheetStatus>({ state: "checking" });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setEntries(loadEntries());
    setLessons(loadLessons());
    setSheet({ state: "checking" });
    const controller = new AbortController();
    fetch("/api/lead", { signal: controller.signal })
      .then((response) => response.json())
      .then(
        (body: {
          configured: boolean;
          reachable?: boolean;
          leads?: number;
          lessons?: number;
          version?: string;
          error?: string;
        }) => {
          if (!body.configured) setSheet({ state: "off" });
          else if (body.reachable)
            setSheet({
              state: "on",
              leads: body.leads ?? 0,
              lessons: body.lessons ?? 0,
              version: body.version ?? "",
            });
          else setSheet({ state: "error", error: body.error ?? "The sheet did not answer." });
        },
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSheet({ state: "error", error: error instanceof Error ? error.message : "network" });
      });
    return () => controller.abort();
  }, [open]);

  const sheetLine =
    sheet.state === "checking"
      ? "Checking the Google Sheet…"
      : sheet.state === "off"
        ? "Google Sheet not connected — entries stay on each visitor's device. See docs/google-sheets/README.md."
        : sheet.state === "on"
          ? `Google Sheet connected · ${sheet.leads} ${sheet.leads === 1 ? "row" : "rows"} · ${sheet.lessons} pooled ${sheet.lessons === 1 ? "note" : "notes"}`
          : `Google Sheet set but unreachable — ${sheet.error}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-md sm:p-6"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Owner view"
            className="no-scrollbar max-h-[85vh] w-full max-w-3xl overflow-auto rounded-[28px] bg-background/95 p-5 shadow-2xl sm:p-7"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
              <div className="min-w-0">
                <p className="eyebrow">Owner view</p>
                <h2 className="mt-1 text-2xl font-semibold text-ink">
                  {tab === "entries"
                    ? `${entries.length} ${entries.length === 1 ? "conversation" : "conversations"} on this device`
                    : `${lessons.length} field ${lessons.length === 1 ? "note" : "notes"} MARY wrote here`}
                </h2>
                <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      sheet.state === "on"
                        ? "bg-primary"
                        : sheet.state === "error"
                          ? "bg-destructive"
                          : sheet.state === "checking"
                            ? "animate-pulse bg-muted-foreground"
                            : "bg-border-strong"
                    }`}
                  />
                  {sheetLine}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {tab === "entries" ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => downloadCsv(entries)}
                      disabled={entries.length === 0}
                    >
                      Export CSV
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        clearEntries();
                        setEntries([]);
                      }}
                      disabled={entries.length === 0}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      clearLessons();
                      setLessons([]);
                    }}
                    disabled={lessons.length === 0}
                  >
                    Forget notes
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-5 inline-flex rounded-full bg-muted/60 p-1 text-sm" role="tablist">
              {(
                [
                  ["entries", "Conversations"],
                  ["notes", "MARY's field notes"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
                    tab === key
                      ? "bg-background text-ink shadow-soft"
                      : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "entries" && (
              <div className="mt-5 space-y-3">
                {entries.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing collected here yet.</p>
                )}
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-2xl bg-muted/50 p-4 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-semibold text-ink">{entry.name || "Unnamed"}</span>
                      <span className="text-muted-foreground">{entry.email || "no email"}</span>
                      {entry.phone && <span className="text-muted-foreground">{entry.phone}</span>}
                      {entry.callbackRequested && (
                        <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[0.7rem] font-semibold text-accent-text">
                          Callback requested
                        </span>
                      )}
                      {entry.complete && (
                        <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[0.7rem] font-semibold text-accent-text">
                          On the list
                        </span>
                      )}
                      {!entry.complete && !entry.callbackRequested && (
                        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[0.7rem] font-semibold text-muted-foreground">
                          In progress
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {[entry.business, entry.industry, entry.operations]
                        .filter(Boolean)
                        .join(" · ") || "No business details yet"}
                    </p>
                    {entry.transcript && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Transcript
                        </summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-background/70 p-3 text-xs leading-relaxed text-ink">
                          {entry.transcript}
                        </pre>
                      </details>
                    )}
                    <p className="mt-2 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
                      {new Date(entry.updatedAt).toLocaleString()}
                      {entry.complete ? ` · #${entry.position}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {tab === "notes" && (
              <div className="mt-5 space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  After each conversation MARY debriefs herself and keeps short lessons — no names,
                  numbers or company names. They shape her next conversation on this device, and
                  every visitor's once the Google Sheet is connected.
                </p>
                {lessons.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No notes yet — they appear after her first finished conversation.
                  </p>
                )}
                {[...lessons]
                  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
                  .map((lesson, index) => (
                    <div
                      key={`${lesson.at}-${index}`}
                      className="rounded-2xl bg-muted/50 p-4 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-accent-text">
                          {lesson.category}
                        </span>
                        {lesson.industry && (
                          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">
                            {lesson.industry}
                          </span>
                        )}
                        <span className="text-[0.68rem] text-muted-foreground">
                          confidence {lesson.confidence}/5
                          {lesson.seen > 1 ? ` · seen ${lesson.seen}×` : ""}
                        </span>
                      </div>
                      <p className="mt-2 leading-relaxed text-ink">{lesson.lesson}</p>
                      {lesson.evidence && (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          “{lesson.evidence}”
                        </p>
                      )}
                      <p className="mt-2 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
                        {new Date(lesson.at).toLocaleString()}
                        {lesson.outcome ? ` · ${lesson.outcome.replace("_", " ")}` : ""}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
