/**
 * What the app knows about one conversation, in the shape the Google Sheet
 * receives it. Shared by the client (which builds it) and /api/lead (which
 * validates it), so the two can never drift apart.
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
      error: error instanceof Error ? error.message : "network",
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
