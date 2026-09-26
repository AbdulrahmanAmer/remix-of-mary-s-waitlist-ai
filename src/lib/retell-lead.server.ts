/**
 * From a Retell call object to what MARY already understands: a MARY/Guest
 * conversation, grounded lead fields, a sheet row and a debrief input.
 *
 * Pure: no env, no network. Grounding is the existing groundCollected, so a
 * detail only counts when the person said it, exactly as on MARY's own path.
 * The sheet upserts one row per sessionId and never moves a status backwards,
 * so every row built here is safe to send more than once.
 */
import { z } from "zod";

import { LeadPayloadSchema, type LeadOutcome, type LeadPayload } from "@/lib/lead-sync";
import type { ReflectInput } from "@/lib/mary-experience.server";
import { groundCollected, type Proposed } from "@/lib/mary-grounding";
import type { Collected, WaitlistField } from "@/lib/mary.functions";
import {
  CallProgressSchema,
  ContextSchema,
  FIELD_CAPS,
  KnownSchema,
  NOTHING_KNOWN,
  RETELL_FIELDS,
  RETELL_FUNCTIONS,
  SESSION_ID,
  SaveLeadArgsSchema,
  TYPED_PREFIX,
  WEBHOOK_EVENTS,
  toCollected,
  type CallProgress,
  type RetellFunction,
  type SaveLeadArgs,
} from "@/lib/retell-shared";

// ---------- The call object ----------

/** An optional field that is absent, null or of the wrong type reads as null: an odd field never costs a lead. */
const loose = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().catch(null);

const UtteranceSchema = z
  .object({
    role: z.string(),
    content: loose(z.string()),
    name: loose(z.string()),
    /** A JSON string in Retell's schema; an object is accepted too. */
    arguments: loose(z.union([z.string(), z.record(z.unknown())])),
    tool_call_id: loose(z.string()),
    successful: loose(z.boolean()),
  })
  .passthrough();
export type Utterance = z.infer<typeof UtteranceSchema>;

/** Keeps the items that look like utterances and drops the rest. */
const Utterances = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = UtteranceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

export const RetellCallSchema = z
  .object({
    call_id: z.string().min(1).max(128),
    agent_id: loose(z.string()),
    call_type: loose(z.string()),
    call_status: loose(z.string()),
    start_timestamp: loose(z.number()),
    end_timestamp: loose(z.number()),
    duration_ms: loose(z.number()),
    disconnection_reason: loose(z.string()),
    transcript: loose(z.string()),
    transcript_object: loose(Utterances),
    transcript_with_tool_calls: loose(Utterances),
    metadata: z.unknown(),
    call_analysis: loose(
      z
        .object({
          call_summary: loose(z.string()),
          custom_analysis_data: loose(z.record(z.unknown())),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type RetellCall = z.infer<typeof RetellCallSchema>;

/** What our mint put on the call (plus `lead`, which the function handler patches in). */
export const RetellMetadataSchema = z
  .object({
    v: z.number().optional().catch(undefined),
    app: z.string().optional().catch(undefined),
    sessionId: SESSION_ID.optional().catch(undefined),
    known: KnownSchema.optional().catch(undefined),
    context: ContextSchema.optional().catch(undefined),
    startedAt: z.string().max(40).optional().catch(undefined),
    lead: CallProgressSchema.extend({ at: z.number() }).optional().catch(undefined),
  })
  .passthrough();
export type RetellMetadata = z.infer<typeof RetellMetadataSchema>;

export function metadataOf(call: RetellCall): RetellMetadata | null {
  const parsed = RetellMetadataSchema.safeParse(call.metadata);
  return parsed.success ? parsed.data : null;
}

/** The sheet's row key. "session" is the storage-less browser fallback, shared by everyone. */
export function sessionIdOf(call: RetellCall): string {
  const id = metadataOf(call)?.sessionId;
  return id && id !== "session" ? id : `retell_${call.call_id}`.slice(0, 80);
}

// ---------- The conversation ----------

export type Utter = { who: "mary" | "guest"; text: string; typed: boolean };

function fromItems(items: Utterance[]): Utter[] {
  const out: Utter[] = [];
  for (const item of items) {
    const content = (item.content ?? "").trim();
    if (item.role === "agent" && content) out.push({ who: "mary", text: content, typed: false });
    else if (item.role === "user" && content) {
      out.push({ who: "guest", text: content, typed: false });
    } else if (item.role === "injected" && content.startsWith(TYPED_PREFIX)) {
      // Typed text reaches the agent through update-live-call; it is still their words.
      const text = content.slice(TYPED_PREFIX.length).trim();
      if (text) out.push({ who: "guest", text, typed: true });
    }
  }
  return out;
}

function fromTranscript(transcript: string): Utter[] {
  const out: Utter[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const match = /^(Agent|User):\s*(.*)$/.exec(line.trim());
    const text = match?.[2]?.trim();
    if (match && text)
      out.push({ who: match[1] === "Agent" ? "mary" : "guest", text, typed: false });
  }
  return out;
}

/** MARY and the guest in order, from the richest transcript the payload carries. */
export function conversationOf(call: RetellCall): Utter[] {
  if (call.transcript_with_tool_calls?.length) return fromItems(call.transcript_with_tool_calls);
  if (call.transcript_object?.length) return fromItems(call.transcript_object);
  return fromTranscript(call.transcript ?? "");
}

function transcriptOf(conversation: Utter[]): string {
  return conversation
    .map((u) => `${u.who === "mary" ? "MARY" : "Guest"}: ${u.text}`)
    .join("\n")
    .slice(0, 60_000);
}

/** The same MARY:/Guest: lines as MARY's own transcripts, which the sheet and the debrief read. */
export function transcriptText(call: RetellCall): string {
  return transcriptOf(conversationOf(call));
}

/** The known_summary dynamic variable. */
export function knownSummary(known: Collected): string {
  const parts = RETELL_FIELDS.flatMap((field) => {
    const value = known[field]?.replace(/\s+/g, " ").trim();
    return value ? [`${field}: ${value}`] : [];
  });
  return parts.length ? parts.join("; ") : NOTHING_KNOWN;
}

// ---------- Tool calls ----------

function isRetellFunction(name: unknown): name is RetellFunction {
  return typeof name === "string" && (RETELL_FUNCTIONS as readonly string[]).includes(name);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The last save_lead or note_details the agent called, with arguments that parse. */
export function lastFunctionArgs(
  call: RetellCall,
): { name: RetellFunction; args: SaveLeadArgs } | null {
  const items = call.transcript_with_tool_calls ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.role !== "tool_call_invocation" || !isRetellFunction(item.name)) continue;
    const raw = typeof item.arguments === "string" ? parseJson(item.arguments) : item.arguments;
    const args = SaveLeadArgsSchema.safeParse(raw);
    if (args.success) return { name: item.name, args: args.data };
  }
  return null;
}

// ---------- Grounding ----------

export type Decision = {
  collected: Collected;
  rejected: string[];
  missing: WaitlistField[];
  outcome: "in_progress" | "signed_up" | "callback";
};

const DISCOVERY_FIELDS = ["name", "business", "industry", "operations"] as const;
const REQUIRED_FIELDS = ["name", "email", "business", "industry", "operations"] as const;

/**
 * Grounds the agent's arguments against what the person said on this call.
 * `progress` is note_details: the four discovery fields, never a save.
 */
export function groundSaveLead(
  args: SaveLeadArgs,
  call: RetellCall,
  stage: "final" | "callback" | "progress",
): Decision {
  const conversation = conversationOf(call);
  const userMessages = conversation.filter((u) => u.who === "guest").map((u) => u.text);
  // Her last line before their last message: what a plain "yes" would be answering.
  let lastAssistant: string | undefined;
  let seenGuest = false;
  for (let i = conversation.length - 1; i >= 0 && lastAssistant === undefined; i--) {
    const u = conversation[i]!;
    if (u.who === "guest") seenGuest = true;
    else if (seenGuest) lastAssistant = u.text;
  }

  // Already grounded on this call (the patched lead) or on an earlier visit (known).
  const meta = metadataOf(call);
  const previous: Record<string, string> = {
    ...toCollected(meta?.lead?.collected ?? meta?.known ?? {}),
  };

  const offered: Record<WaitlistField, Proposed> = {
    name: { value: args.name, evidence: args.name_evidence },
    email: { value: args.email, evidence: null },
    phone: { value: args.phone, evidence: null },
    business: { value: args.business, evidence: args.business_evidence },
    industry: { value: args.industry, evidence: args.industry_evidence },
    operations: { value: args.operations, evidence: args.operations_evidence },
  };
  const proposed: Record<string, Proposed> = {};
  for (const field of RETELL_FIELDS) {
    const { value } = offered[field];
    if (!value) continue;
    // Re-sending what is already held is not a change: groundCollected would keep the old value
    // yet still list the field as rejected.
    if (previous[field]?.trim().toLowerCase() === value.trim().toLowerCase()) continue;
    proposed[field] = offered[field];
  }

  const grounded = groundCollected({ previous, proposed, userMessages, lastAssistant });
  const collected = toCollected(grounded.collected);
  const rejected = grounded.rejected;
  const required = stage === "progress" ? DISCOVERY_FIELDS : REQUIRED_FIELDS;
  let missing: WaitlistField[] = required.filter((field) => !collected[field]);
  let outcome: Decision["outcome"] = "in_progress";

  if (stage === "progress") {
    outcome = "in_progress";
  } else if (args.callback_requested || stage === "callback") {
    const reachable = (collected.phone ?? "").replace(/\D/g, "").length >= 5;
    missing = [
      ...(collected.name ? [] : ["name" as const]),
      ...(reachable ? [] : ["phone" as const]),
    ];
    outcome = missing.length === 0 ? "callback" : "in_progress";
  } else if (stage === "final" && missing.length === 0) {
    outcome = "signed_up";
  }
  return { collected, rejected, missing, outcome };
}

// ---------- Progress recorded on the call ----------

const isFinal = (outcome: string | undefined) => outcome === "signed_up" || outcome === "callback";

function progressFromTools(call: RetellCall): CallProgress | null {
  const items = call.transcript_with_tool_calls ?? [];
  const invoked = new Map<string, string>();
  for (const item of items) {
    if (item.role === "tool_call_invocation" && item.tool_call_id && item.name) {
      invoked.set(item.tool_call_id, item.name);
    }
  }
  let latest: CallProgress | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.role !== "tool_call_result" || item.successful === false || !item.tool_call_id) {
      continue;
    }
    if (!isRetellFunction(invoked.get(item.tool_call_id))) continue;
    const progress = CallProgressSchema.safeParse(parseJson(item.content ?? ""));
    if (!progress.success) continue;
    // A save outranks anything said after it (the sheet never moves a status back either).
    if (isFinal(progress.data.outcome)) return progress.data;
    latest ??= progress.data;
  }
  return latest;
}

/**
 * The progress our own function handler reported, from the tool results echoed
 * back in the call and from the metadata it patched. The metadata patch is
 * best effort and can be stale, so the higher-ranked of the two wins.
 */
export function progressFromCall(call: RetellCall): CallProgress | null {
  const fromTools = progressFromTools(call);
  const lead = metadataOf(call)?.lead;
  const fromMeta: CallProgress | null = lead
    ? {
        saved: lead.saved,
        configured: lead.configured,
        outcome: lead.outcome,
        position: lead.position,
        collected: lead.collected,
      }
    : null;
  if (isFinal(fromTools?.outcome)) return fromTools;
  if (isFinal(fromMeta?.outcome)) return fromMeta;
  return fromTools ?? fromMeta ?? null;
}

// ---------- The sheet row ----------

/** The sheet's lead row. summary and objections go past LeadPayloadSchema, which would strip them. */
export type SheetRow = LeadPayload & { summary?: string; objections?: string };

function isoOf(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function durationOf(call: RetellCall, now: number): number {
  let seconds = 0;
  if (typeof call.duration_ms === "number") seconds = Math.round(call.duration_ms / 1000);
  else if (typeof call.start_timestamp === "number") {
    seconds = Math.round(((call.end_timestamp ?? now) - call.start_timestamp) / 1000);
  }
  return Number.isFinite(seconds) ? Math.min(86_400, Math.max(0, seconds)) : 0;
}

export function leadRowFromCall(
  call: RetellCall,
  collected: Collected,
  outcome: LeadOutcome,
  now: number,
  extra: Partial<SheetRow> = {},
): SheetRow {
  const conversation = conversationOf(call);
  const guest = conversation.filter((u) => u.who === "guest");
  const meta = metadataOf(call);
  const { summary, objections, ...leadExtra } = extra;
  const fields = Object.fromEntries(
    RETELL_FIELDS.map((field) => [field, (collected[field] ?? "").slice(0, FIELD_CAPS[field])]),
  );
  const row = LeadPayloadSchema.parse({
    sessionId: sessionIdOf(call),
    outcome,
    ...fields,
    callbackRequested: outcome === "callback",
    transcript: transcriptOf(conversation),
    turns: guest.length,
    durationSec: durationOf(call, now),
    source: guest.some((u) => u.typed) ? "mixed" : "voice",
    mode: "",
    startedAt: isoOf(call.start_timestamp) ?? meta?.startedAt ?? "",
    ...meta?.context,
    localPosition: 0,
    reflect: false,
    ...leadExtra,
  });
  return {
    ...row,
    ...(summary !== undefined ? { summary } : {}),
    ...(objections !== undefined ? { objections } : {}),
  };
}

// ---------- The webhook ----------

function isWebhookEvent(event: string): event is (typeof WEBHOOK_EVENTS)[number] {
  return (WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * What a call_ended or call_analyzed delivery writes. An outcome our function
 * handler recorded stands as it is: re-grounding it against the finished
 * transcript (whose last message is now "bye") could undo a valid save.
 * Analysis values for lead fields are never written; they are not grounded.
 */
export function planWebhook(
  event: string,
  call: RetellCall,
  now: number,
): { row: SheetRow | null; reflect: ReflectInput | null } {
  if (!isWebhookEvent(event)) return { row: null, reflect: null };

  const recorded = progressFromCall(call);
  let regrounded: Decision | null = null;
  if (!recorded) {
    const last = lastFunctionArgs(call);
    if (last) {
      regrounded = groundSaveLead(
        last.args,
        call,
        last.name === "note_details" ? "progress" : last.args.stage,
      );
    }
  }

  const saveOutcome = [recorded?.outcome, regrounded?.outcome].find(isFinal) as
    "signed_up" | "callback" | undefined;
  const analysis = call.call_analysis?.custom_analysis_data ?? null;
  const final: LeadOutcome =
    saveOutcome ?? (analysis?.["outcome"] === "declined" ? "declined" : "abandoned");
  const collected = recorded
    ? toCollected(recorded.collected)
    : (regrounded?.collected ?? toCollected(metadataOf(call)?.known ?? {}));

  const turns = conversationOf(call).filter((u) => u.who === "guest").length;
  // They never spoke and nothing was recorded: no row.
  if (turns === 0 && !recorded && !regrounded) return { row: null, reflect: null };

  const analyzed = event === "call_analyzed";
  const objections = analysis?.["objections"];
  const row = leadRowFromCall(call, collected, final, now, {
    callbackRequested:
      final === "callback" || (analyzed && analysis?.["callback_requested"] === true),
    ...(analyzed
      ? {
          summary: call.call_analysis?.call_summary ?? "",
          objections: typeof objections === "string" ? objections.slice(0, 1000) : "",
        }
      : {}),
  });

  const reflect: ReflectInput | null =
    analyzed && row.turns >= 2 && row.transcript.length >= 20
      ? {
          sessionId: row.sessionId,
          transcript: row.transcript,
          outcome: final,
          collected,
          turns: row.turns,
          durationSec: row.durationSec,
        }
      : null;
  return { row, reflect };
}

// ---------- What the agent reads back ----------

/** The instruction in every function result; the agent speaks from it. */
export function functionMessage(
  fn: RetellFunction,
  d: Decision,
  sync: { saved: boolean; position: number | null },
): string {
  if (fn === "note_details") {
    const open = [...d.rejected, ...d.missing];
    if (open.length) {
      return `Not recorded yet: ${open.join(", ")}. Ask about ${open[0]} plainly — one ask — in their own words, then call note_details again. Do not reveal yet.`;
    }
    return "Noted. Now the reveal: no form, you already have it all — credit Convert by name, and ask nothing in that turn.";
  }
  if (d.outcome === "in_progress") {
    const next = d.missing[0] ?? d.rejected[0] ?? "what is still open";
    let message = `Not finished yet. Still needed: ${d.missing.join(", ")}. Ask for ${next} — one ask — then call save_lead again.`;
    if (d.rejected.length) {
      message += ` Not recorded because they have not said it in their own words: ${d.rejected.join(", ")}. Do not repeat those values; ask about them plainly.`;
    }
    return message;
  }
  if (!sync.saved) {
    return "Noted, but the list could not be updated right now. Do not give a position number. Tell them the team will confirm by email, then close as usual.";
  }
  if (d.outcome === "callback") {
    return "Callback request saved. Confirm plainly, using their name, that the team will reach them on that number — no day or time. Then a short goodbye and end_call.";
  }
  if (sync.position !== null) {
    return `Saved. They are number ${sync.position} on the early-access list. Give a short send-off with their first name and the number, then say the close line and call end_call.`;
  }
  return "Saved. There is no position number yet — do not give one. Short send-off, the close line, then end_call.";
}
