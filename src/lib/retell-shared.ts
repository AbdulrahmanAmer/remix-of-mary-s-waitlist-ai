/**
 * The Retell contract shared by the /api/retell routes, the browser adapter and
 * the retell/ tooling. zod and types only: bun scripts load this file directly.
 */
import { z } from "zod";

import type { Collected, WaitlistField } from "@/lib/mary.functions";

export const RETELL_PATHS = {
  voice: "/api/voice",
  webCall: "/api/retell/web-call",
  callStatus: "/api/retell/call-status",
  inject: "/api/retell/inject",
  functions: "/api/retell/functions/save-lead",
  webhook: "/api/retell/webhook",
} as const;

export type VoiceProvider = "mary" | "retell";
/** Body of GET /api/voice. */
export type VoiceStatus = {
  provider: VoiceProvider;
  retell: boolean;
  transcriptKey: string | null;
};
export const MARY_ONLY: VoiceStatus = { provider: "mary", retell: false, transcriptKey: null };

export const TYPED_PREFIX = "The visitor typed this instead of saying it: ";
export const RETELL_FUNCTIONS = ["save_lead", "note_details"] as const;
export type RetellFunction = (typeof RETELL_FUNCTIONS)[number];
export const SAVE_LEAD_STAGES = ["final", "callback"] as const;
export const WEBHOOK_EVENTS = ["call_ended", "call_analyzed"] as const;
export const ANALYSIS_OUTCOMES = ["joined", "callback", "declined", "incomplete"] as const;
export const DYNAMIC_VARIABLES = ["opening_line", "known_summary", "field_notes"] as const;
export const NOTHING_KNOWN = "nothing yet";
export const NO_FIELD_NOTES = "none yet";

/** WELCOME openers (docs/mary-voice.md section 7), each landing on the name question. */
export const OPENING_LINES = [
  "Hi, I'm MARY. I look after early access for OmniSuite, Omnikom's new revenue engine. Two minutes with me and you're on the list. What should I call you?",
  "Hey — I'm MARY, the AI behind OmniSuite from Omnikom. Give me two minutes and I'll get you on the early-access list. What's your name?",
  "Hello, thanks for stopping by. I'm MARY, from Omnikom. Two minutes with me gets you early access to OmniSuite. Who am I talking to?",
] as const;

export function welcomeBackLine(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? "").slice(0, 40);
  return `Hey${first ? ` ${first}` : ""} — good to have you back. It's MARY. Where were we?`;
}

export const RETELL_FIELDS = [
  "name",
  "email",
  "phone",
  "business",
  "industry",
  "operations",
] as const;
export const FIELD_CAPS = {
  name: 120,
  email: 200,
  phone: 60,
  business: 200,
  industry: 120,
  operations: 400,
} as const satisfies Record<WaitlistField, number>;

const text = (cap: number) => z.string().transform((v) => v.trim().slice(0, cap));
export const SESSION_ID = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const CALL_ID = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export const KnownSchema = z.object({
  name: text(120).optional(),
  email: text(200).optional(),
  phone: text(60).optional(),
  business: text(200).optional(),
  industry: text(120).optional(),
  operations: text(400).optional(),
});
export type Known = z.infer<typeof KnownSchema>;
/** Drops missing and empty values, giving a plain Collected. */
export function toCollected(known: Known): Collected {
  const out: Collected = {};
  for (const f of RETELL_FIELDS) {
    const v = known[f];
    if (v) out[f] = v;
  }
  return out;
}

export const ContextSchema = z.object({
  page: text(400).default(""),
  referrer: text(400).default(""),
  userAgent: text(400).default(""),
  language: text(40).default(""),
  timezone: text(80).default(""),
});
export const WebCallBodySchema = z.object({
  sessionId: SESSION_ID,
  known: KnownSchema.default({}),
  context: ContextSchema.default({}),
});
export type WebCallBody = z.input<typeof WebCallBodySchema>;
export const CallStatusBodySchema = z.object({ callId: CALL_ID, sessionId: SESSION_ID });
export const InjectBodySchema = z.object({
  callId: CALL_ID,
  sessionId: SESSION_ID,
  text: z.string().trim().min(1).max(500),
});

export const PROGRESS_OUTCOMES = ["in_progress", "signed_up", "callback"] as const;
export const CallProgressSchema = z.object({
  saved: z.boolean(),
  configured: z.boolean(),
  outcome: z.enum(PROGRESS_OUTCOMES),
  position: z.number().int().positive().nullable(),
  collected: KnownSchema,
});
export type CallProgress = z.infer<typeof CallProgressSchema>;
/** Body of every 200 from /api/retell/functions/save-lead; also exactly what the LLM reads. */
export type FunctionResult = CallProgress & {
  recorded: boolean;
  missing: WaitlistField[];
  rejected: string[];
  message: string;
};
/** Body of POST /api/retell/call-status. */
export type CallStatusResponse =
  | { found: false }
  | {
      found: true;
      status: string;
      ended: boolean;
      disconnectionReason: string | null;
      progress: CallProgress | null;
    };

const arg = (cap: number) =>
  z
    .unknown()
    .transform((v) =>
      typeof v === "string" || typeof v === "number"
        ? String(v).trim().slice(0, cap) || null
        : null,
    );
/** Arguments of save_lead and note_details (note_details sends a subset and no stage). */
export const SaveLeadArgsSchema = z.object({
  stage: z.enum(SAVE_LEAD_STAGES).catch("final"),
  name: arg(120),
  name_evidence: arg(300),
  email: arg(200),
  phone: arg(60),
  business: arg(200),
  business_evidence: arg(300),
  industry: arg(120),
  industry_evidence: arg(300),
  operations: arg(400),
  operations_evidence: arg(300),
  callback_requested: z.boolean().nullish().catch(null),
});
export type SaveLeadArgs = z.infer<typeof SaveLeadArgsSchema>;
export const SAVE_LEAD_ARG_KEYS = Object.keys(SaveLeadArgsSchema.shape) as (keyof SaveLeadArgs)[];
