import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { clearEntries, downloadCsv, loadEntries, type WaitlistEntry } from "@/lib/waitlist-store";

/**
 * Owner-only view of everything collected on this device.
 * Opens with Ctrl/Cmd + Shift + W, closes with the same keys or Escape.
 */
export function WaitlistVault() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);

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
    if (open) setEntries(loadEntries());
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-6 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-[28px] bg-background/95 p-7 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Stored on this device</p>
                <h2 className="mt-1 text-2xl font-semibold text-ink">
                  {entries.length} waitlist {entries.length === 1 ? "entry" : "entries"}
                </h2>
              </div>
              <div className="flex gap-2">
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
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="mt-6 space-y-3">
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
                  <p className="mt-1 text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {new Date(entry.updatedAt).toLocaleString()} · #{entry.position}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
