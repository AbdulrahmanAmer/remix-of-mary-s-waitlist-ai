/**
 * What the app knows about one conversation, in the shape the Google Sheet
 * receives it. Shared by the client (which builds it) and /api/lead (which
 * validates it), so the two can never drift apart. The outbox at the bottom
 * keeps a row the sheet did not confirm until a later attempt gets it there.
 */
import { z } from "zod";

export const LEAD_OUTCOMES = [
  "in_progress",
  "signed_up",
  "callback",
  "declined",
  "abandoned",
] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

export const LeadPayloadSchema = z.object({
  sessionId: z.string().min(1).max(80),
  outcome: z.enum(LEAD_OUTCOMES),
  name: z.string().max(120).default(""),
  email: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  business: z.string().max(200).default(""),
  industry: z.string().max(120).default(""),
  operations: z.string().max(400).default(""),
  callbackRequested: z.boolean().default(false),
  transcript: z.string().max(60_000).default(""),
  turns: z.number().int().min(0).max(10_000).default(0),
  durationSec: z.number().min(0).max(86_400).default(0),
  source: z.enum(["voice", "text", "mixed", "none"]).default("none"),
  mode: z.string().max(40).default(""),
  startedAt: z.string().max(40).default(""),
  page: z.string().max(400).default(""),
  referrer: z.string().max(400).default(""),
  userAgent: z.string().max(400).default(""),
  language: z.string().max(40).default(""),
  timezone: z.string().max(80).default(""),
  localPosition: z.number().int().min(0).default(0),
  /** Also run MARY's debrief on the server (used when the page is closing). */
  reflect: z.boolean().default(false),
});

export type LeadPayload = z.infer<typeof LeadPayloadSchema>;

export type LeadSyncResult = {
  /** A sheet is connected on the server. */
  configured: boolean;
  /** The row was written (or updated). */
  saved: boolean;
  /** Position handed out by the sheet, once the person is actually on the list. */
  position: number | null;
  /** The sheet sent the visitor a confirmation email on this write (optional, see Code.gs). */
  emailed?: boolean;
  error?: string;
};

/** Browser facts that make a row useful later, gathered once. */
export function browserContext() {
  if (typeof window === "undefined") {
    return { page: "", referrer: "", userAgent: "", language: "", timezone: "" };
  }
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    timezone = "";
  }
  return {
    page: window.location.href.slice(0, 400),
    referrer: document.referrer.slice(0, 400),
    userAgent: navigator.userAgent.slice(0, 400),
    language: navigator.language ?? "",
    timezone,
  };
}

/** Sends the row and waits for the answer — used when someone is watching the screen. */
export async function syncLead(payload: LeadPayload, timeoutMs = 9000): Promise<LeadSyncResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      keepalive: true,
    });
    if (!response.ok) {
      return { configured: true, saved: false, position: null, error: `HTTP ${response.status}` };
    }
    return (await response.json()) as LeadSyncResult;
  } catch (error) {
    return {
      configured: true,
      saved: false,
      position: null,
      error: controller.signal.aborted
        ? "timeout"
        : error instanceof Error
          ? error.message
          : "network",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Fire-and-forget delivery for the moment a tab is closing or going to the
 * background. sendBeacon survives navigation; text/plain keeps it simple.
 */
export function beaconLead(payload: LeadPayload): void {
  if (typeof navigator === "undefined") return;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      if (navigator.sendBeacon("/api/lead", blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  void fetch("/api/lead", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
    keepalive: true,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Outbox: a row the sheet has not confirmed waits in the browser and goes again
// later. Rows are keyed by session id and the sheet upserts by the same id, so a
// retry can only ever update the row it was meant for, never add a second one.
// ---------------------------------------------------------------------------

const OUTBOX_KEY = "omnisuite.waitlist.outbox.v1";
/** Rows kept at most; the oldest go first when it is full. */
const OUTBOX_MAX = 25;
/** A row nobody could deliver in a month is forgotten. */
const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_BASE_MS = 20_000;
const RETRY_MAX_MS = 60 * 60 * 1000;
/** Rows sent per flush: /api/lead allows 20 a minute per address. */
const FLUSH_BATCH = 5;

export type OutboxEntry = {
  payload: LeadPayload;
  /** When the row first went into the outbox (ms since epoch). */
  queuedAt: number;
  /** Deliveries tried so far. */
  attempts: number;
  /** Not before this time (ms since epoch); grows with every failure. */
  nextAt: number;
  lastError: string;
};

export type LeadOutbox = {
  list: () => OutboxEntry[];
  /** Put a row in (or replace the one with the same session id); it is due at once. */
  stash: (payload: LeadPayload, now?: number) => void;
  /** Note a failed delivery: the row stays and waits longer before the next try. */
  failed: (sessionId: string, error: string, now?: number) => void;
  /** The sheet confirmed the row: nothing left to send. */
  drop: (sessionId: string) => void;
  clear: () => void;
};

/** 20 s, 40 s, 80 s … capped at an hour. */
export function retryDelay(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

/** Only a row somebody can be reached through is worth carrying around. */
export function worthKeeping(payload: LeadPayload): boolean {
  return Boolean(payload.name.trim() || payload.email.trim() || payload.phone.trim());
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function coerceEntry(raw: unknown): OutboxEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const payload = LeadPayloadSchema.safeParse(value["payload"]);
  if (!payload.success) return null;
  const num = (key: string, fallback: number) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? (value[key] as number)
      : fallback;
  return {
    payload: payload.data,
    queuedAt: num("queuedAt", 0),
    attempts: num("attempts", 0),
    nextAt: num("nextAt", 0),
    lastError: typeof value["lastError"] === "string" ? value["lastError"] : "",
  };
}

/**
 * An outbox on top of any Storage-like object. `storage` is read on every call
 * because localStorage can appear, vanish or throw between visits.
 */
export function createOutbox(storage: () => KeyValueStore | null): LeadOutbox {
  const read = (): OutboxEntry[] => {
    try {
      const store = storage();
      if (!store) return [];
      const parsed: unknown = JSON.parse(store.getItem(OUTBOX_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(coerceEntry).filter((entry): entry is OutboxEntry => entry !== null);
    } catch {
      return [];
    }
  };
  const write = (entries: OutboxEntry[]) => {
    try {
      const store = storage();
      if (!store) return;
      if (entries.length === 0) store.removeItem(OUTBOX_KEY);
      else store.setItem(OUTBOX_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: the row still had its direct attempt.
    }
  };
  const fresh = (entries: OutboxEntry[], now: number) =>
    entries.filter((entry) => now - entry.queuedAt < OUTBOX_MAX_AGE_MS);
  return {
    list: read,
    stash(payload, now = Date.now()) {
      const entries = fresh(read(), now);
      const index = entries.findIndex((entry) => entry.payload.sessionId === payload.sessionId);
      // A replayed row must never ask the server for a second debrief.
      const next = { ...payload, reflect: false };
      if (index >= 0) {
        const previous = entries[index]!;
        entries[index] = { ...previous, payload: next, nextAt: now };
      } else {
        entries.push({ payload: next, queuedAt: now, attempts: 0, nextAt: now, lastError: "" });
      }
      while (entries.length > OUTBOX_MAX) entries.shift();
      write(entries);
    },
    failed(sessionId, error, now = Date.now()) {
      const entries = read();
      const entry = entries.find((candidate) => candidate.payload.sessionId === sessionId);
      if (!entry) return;
      entry.attempts += 1;
      entry.nextAt = now + retryDelay(entry.attempts);
      entry.lastError = error.slice(0, 120);
      write(entries);
    },
    drop(sessionId) {
      const entries = read();
      const kept = entries.filter((entry) => entry.payload.sessionId !== sessionId);
      if (kept.length !== entries.length) write(kept);
    },
    clear() {
      write([]);
    },
  };
}

/** The outbox in this browser's localStorage. */
export const browserOutbox: LeadOutbox = createOutbox(() => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
});

export type FlushReport = { sent: string[]; failed: string[]; skipped: string[] };

let flushing: Promise<FlushReport> | null = null;

/**
 * Send the rows that are due, oldest first. Rows the caller wants left alone
 * (the conversation still running on this page) are skipped. Two triggers at
 * once share a single pass, so a row is never in flight twice.
 */
export function flushOutbox(
  opts: {
    outbox?: LeadOutbox;
    send?: (payload: LeadPayload) => Promise<LeadSyncResult>;
    skip?: (sessionId: string) => boolean;
    /** Ignore the backoff: the owner asked for it. */
    force?: boolean;
    now?: () => number;
  } = {},
): Promise<FlushReport> {
  if (flushing) return flushing;
  const outbox = opts.outbox ?? browserOutbox;
  const send = opts.send ?? syncLead;
  const now = opts.now ?? Date.now;
  const skip = opts.skip ?? (() => false);
  flushing = (async () => {
    const report: FlushReport = { sent: [], failed: [], skipped: [] };
    const due = outbox
      .list()
      .filter((entry) => {
        const id = entry.payload.sessionId;
        if (skip(id)) {
          report.skipped.push(id);
          return false;
        }
        return opts.force || entry.nextAt <= now();
      })
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .slice(0, FLUSH_BATCH);
    for (const entry of due) {
      const id = entry.payload.sessionId;
      let result: LeadSyncResult;
      try {
        result = await send(entry.payload);
      } catch (error) {
        result = {
          configured: true,
          saved: false,
          position: null,
          error: error instanceof Error ? error.message : "network",
        };
      }
      if (result.saved) {
        outbox.drop(id);
        report.sent.push(id);
      } else {
        outbox.failed(
          id,
          result.error ?? (result.configured ? "not saved" : "not configured"),
          now(),
        );
        report.failed.push(id);
        // The sheet is not there at all: the rest can wait for a later trigger.
        if (!result.configured) break;
      }
    }
    return report;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * The moments a stuck row gets another chance: shortly after the page opens,
 * when the browser comes back online, and when the tab is looked at again.
 */
export function watchOutboxTriggers(fire: () => void, delayMs = 4000): () => void {
  if (typeof window === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") fire();
  };
  const timer = window.setTimeout(fire, delayMs);
  window.addEventListener("online", fire);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("online", fire);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
