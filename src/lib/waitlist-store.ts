/**
 * Waitlist storage — entirely in the browser.
 *
 * There is no database and no network hop: every detail MARY grounds is written
 * straight to localStorage the moment it is confirmed, so nothing she says ever
 * waits on a round trip, and a refresh mid-conversation loses nothing.
 */

const KEY = "omnisuite.waitlist.v1";
const SESSION_KEY = "omnisuite.waitlist.session";

export type WaitlistEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  phone: string;
  business: string;
  industry: string;
  operations: string;
  transcript: string;
  /** They asked to be called back instead of finishing here. */
  callbackRequested: boolean;
  /** Everything required was captured and MARY closed. */
  complete: boolean;
  position: number;
};

export type WaitlistFields = Partial<Omit<WaitlistEntry, "id" | "createdAt" | "updatedAt">>;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function blank(id: string): WaitlistEntry {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    name: "",
    email: "",
    phone: "",
    business: "",
    industry: "",
    operations: "",
    transcript: "",
    callbackRequested: false,
    complete: false,
    position: 0,
  };
}

function coerce(raw: unknown): WaitlistEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value["id"] !== "string") return null;
  const entry = blank(value["id"]);
  for (const key of Object.keys(entry) as (keyof WaitlistEntry)[]) {
    const incoming = value[key];
    if (key === "callbackRequested" || key === "complete") {
      if (typeof incoming === "boolean") entry[key] = incoming;
    } else if (key === "position") {
      if (typeof incoming === "number") entry.position = incoming;
    } else if (typeof incoming === "string") {
      entry[key] = incoming;
    }
  }
  return entry;
}

export function loadEntries(): WaitlistEntry[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerce).filter((entry): entry is WaitlistEntry => entry !== null);
  } catch {
    return [];
  }
}

function persist(entries: WaitlistEntry[]) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked — the conversation carries on regardless.
  }
}

/** A stable id for this visit, so incremental writes update one row. */
export function sessionId(): string {
  if (!hasStorage()) return "session";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "session";
  }
}

/** Forget this visit's id, so the next conversation starts a fresh row. */
export function newSession(): void {
  if (!hasStorage()) return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Deterministic, computed on the spot — the closing line never waits. */
export function positionFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return 128 + (hash % 640);
}

/** Writes through: merges the given fields into this visit's row. Synchronous. */
export function saveProgress(id: string, fields: WaitlistFields): WaitlistEntry {
  const entries = loadEntries();
  const index = entries.findIndex((entry) => entry.id === id);
  const base = index >= 0 ? entries[index]! : blank(id);
  const next: WaitlistEntry = { ...base, ...fields, updatedAt: new Date().toISOString() };
  if (!next.position) next.position = positionFor(next.email || id);
  if (index >= 0) entries[index] = next;
  else entries.push(next);
  persist(entries);
  return next;
}

/** What is already known about this visitor, so MARY never re-asks it. */
export function loadProgress(id: string): WaitlistEntry | null {
  return loadEntries().find((entry) => entry.id === id) ?? null;
}

const CSV_COLUMNS: (keyof WaitlistEntry)[] = [
  "createdAt",
  "updatedAt",
  "name",
  "email",
  "phone",
  "business",
  "industry",
  "operations",
  "callbackRequested",
  "complete",
  "position",
  "transcript",
];

function cell(value: string | number | boolean): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(entries: WaitlistEntry[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = entries.map((entry) => CSV_COLUMNS.map((key) => cell(entry[key])).join(","));
  return [header, ...rows].join("\n");
}

export function downloadCsv(entries: WaitlistEntry[]) {
  if (typeof window === "undefined") return;
  const blob = new Blob([toCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `omnisuite-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function clearEntries() {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
