/**
 * The Retell routes (and /api/voice), with every dependency injected so the
 * tests call them directly; the route files only wire them up.
 *
 * - Browser routes (web-call, call-status, inject) answer 404 unless the
 *   operator opted in; Retell's own routes (save-lead, webhook) answer 404
 *   unless a signature can be checked, and 401 when it does not match.
 * - Every handler catches everything and answers with an explicit status.
 * - Upstream detail goes to the log, never back to the caller. Nothing logged
 *   carries an access_token, a key, the signature header or typed text.
 */
import { z } from "zod";

import type { ReflectInput } from "@/lib/mary-experience.server";
import {
  browserRoutesEnabled,
  serverRoutesEnabled,
  voiceStatus,
  type RetellEnv,
} from "@/lib/retell-env.server";
import {
  RetellCallSchema,
  functionMessage,
  groundSaveLead,
  knownSummary,
  leadRowFromCall,
  metadataOf,
  planWebhook,
  progressFromCall,
  type RetellCall,
} from "@/lib/retell-lead.server";
import {
  CallStatusBodySchema,
  InjectBodySchema,
  NO_FIELD_NOTES,
  OPENING_LINES,
  RETELL_FUNCTIONS,
  SaveLeadArgsSchema,
  TYPED_PREFIX,
  WEBHOOK_EVENTS,
  WebCallBodySchema,
  toCollected,
  welcomeBackLine,
  type CallProgress,
  type CallStatusResponse,
  type FunctionResult,
} from "@/lib/retell-shared";
import { verifyRetellSignature } from "@/lib/retell-signature.server";

export type RetellDeps = {
  env: RetellEnv;
  fetch: typeof fetch;
  sheetsConfigured: () => boolean;
  sheetPost: (
    action: "lead",
    payload: Record<string, unknown>,
    opts: { timeoutMs: number },
  ) => Promise<{ position?: unknown }>;
  reflect: (input: ReflectInput, apiKey: string) => Promise<unknown>;
  fieldNotes: (industry: string | null) => Promise<string>;
  /** Keeps work alive after the response (waitUntil), or waits a bounded time for it. */
  defer: (task: Promise<unknown>) => Promise<void>;
  now: () => number;
  random: () => number;
  log: Pick<Console, "info" | "warn" | "error">;
};

export const RETELL_API = "https://api.retellai.com";

const KB = 1024;
// The same caps as the guard's budgets, checked again on the text: a chunked body declares no length.
const MAX_CHARS = {
  webCall: 8 * KB,
  callStatus: 2 * KB,
  inject: 4 * KB,
  functions: 1024 * KB,
  webhook: 2048 * KB,
};
const NO_STORE = { "cache-control": "no-store" };
const ENDED_STATUSES = new Set(["ended", "error", "not_connected"]);
const SDK_VERSION = /^\d+\.\d+\.\d+$/;
const SDK_VERSION_HEADERS = [
  "X-Retell-Client-JS-SDK-Min-Version",
  "X-Retell-Client-JS-SDK-Recommended-Version",
];
const FIELD_NOTES_BUDGET_MS = 900;
const UNAVAILABLE = { status: "error", message: "The voice line is not available right now." };

const notFound = () => new Response("Not found", { status: 404 });
const invalidBody = () => new Response("Invalid body", { status: 400 });
const tooLarge = () => new Response("Request too large", { status: 413 });
const unauthorized = () => new Response(null, { status: 401 });
const noContent = () => new Response(null, { status: 204 });
const lineUnavailable = () => new Response("Voice line unavailable", { status: 502 });

const FunctionBodySchema = z.object({
  name: z.enum(RETELL_FUNCTIONS),
  args: z.record(z.unknown()).nullish(),
  call: RetellCallSchema,
});
const WebhookBodySchema = z.object({ event: z.string().min(1).max(80), call: RetellCallSchema });

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWith<T extends z.ZodTypeAny>(schema: T, raw: string): z.infer<T> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readCapped(request: Request, maxChars: number): Promise<string | null> {
  const raw = await request.text();
  return raw.length > maxChars ? null : raw;
}

async function guarded(
  route: string,
  deps: RetellDeps,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    deps.log.error(`[retell] ${route} failed: ${errorText(error)}`);
    return new Response("Server error", { status: 500 });
  }
}

// ---------- Retell's API ----------

type Upstream = { status: number; ok: boolean; headers: Headers; text: string };

/** One call to Retell with the server key; the timeout covers reading the body too. */
async function retellRequest(
  deps: RetellDeps,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: unknown,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Upstream> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${deps.env.apiKey ?? ""}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      signal: controller.signal,
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await deps.fetch(`${RETELL_API}${path}`, init);
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

type GetCall = { kind: "found"; call: RetellCall } | { kind: "missing" } | { kind: "failed" };

async function getCall(deps: RetellDeps, callId: string, timeoutMs: number): Promise<GetCall> {
  let upstream: Upstream;
  try {
    upstream = await retellRequest(
      deps,
      "GET",
      `/v2/get-call/${encodeURIComponent(callId)}`,
      undefined,
      timeoutMs,
    );
  } catch (error) {
    deps.log.error(`[retell] get-call failed: ${errorText(error)}`);
    return { kind: "failed" };
  }
  if (upstream.status === 404) return { kind: "missing" };
  if (!upstream.ok) {
    deps.log.error(`[retell] get-call failed ${upstream.status}: ${upstream.text.slice(0, 300)}`);
    return { kind: "failed" };
  }
  // The call object carries its access_token: it is read here and never logged or returned.
  const call = parseWith(RetellCallSchema, upstream.text);
  if (!call) {
    deps.log.error("[retell] get-call answered with something that is not a call");
    return { kind: "failed" };
  }
  return { kind: "found", call };
}

/**
 * Puts the lead on the call's metadata, where call-status and the webhook read
 * it. update-live-call replaces the whole metadata object, so ours is spread
 * first; without it (a payload that did not echo metadata) nothing is patched,
 * because the sessionId would be lost.
 */
async function patchLead(
  deps: RetellDeps,
  call: RetellCall,
  lead: CallProgress & { at: number },
): Promise<void> {
  if (!deps.env.apiKey) return;
  const metadata = call.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    deps.log.warn("[retell] lead not patched: the call carried no metadata to keep");
    return;
  }
  try {
    const upstream = await retellRequest(
      deps,
      "PATCH",
      `/v2/update-live-call/${encodeURIComponent(call.call_id)}`,
      { fields_to_override: { metadata: { ...metadata, lead } } },
      2000,
    );
    if (!upstream.ok) {
      deps.log.warn(
        `[retell] lead patch failed ${upstream.status}: ${upstream.text.slice(0, 300)}`,
      );
    }
  } catch (error) {
    deps.log.warn(`[retell] lead patch failed: ${errorText(error)}`);
  }
}

function positionOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// ---------- GET /api/voice ----------

export function handleVoice(deps: Pick<RetellDeps, "env">): Response {
  return Response.json(voiceStatus(deps.env), { headers: NO_STORE });
}

// ---------- POST /api/retell/web-call ----------

async function fieldNotesWithin(deps: RetellDeps, industry: string | null): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), FIELD_NOTES_BUDGET_MS);
  });
  try {
    const notes = Promise.resolve()
      .then(() => deps.fieldNotes(industry))
      .then(
        (text) => (typeof text === "string" ? text : ""),
        () => "",
      );
    return await Promise.race([notes, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mints a Retell web call for the browser. The upstream body is built from our
 * own allowlist; nothing the browser sends reaches Retell except its sessionId,
 * known fields and context, as metadata. Retell's answer (all five fields the
 * SDK needs) goes back unchanged.
 */
export function handleWebCall(request: Request, deps: RetellDeps): Promise<Response> {
  return guarded("web-call", deps, async () => {
    const { env } = deps;
    if (!browserRoutesEnabled(env)) return notFound();
    const raw = await readCapped(request, MAX_CHARS.webCall);
    if (raw === null) return tooLarge();
    const body = parseWith(WebCallBodySchema, raw);
    if (!body) return invalidBody();

    const known = toCollected(body.known);
    const notes = await fieldNotesWithin(deps, known.industry ?? null);
    const pick = Math.floor(deps.random() * OPENING_LINES.length);
    const opening = known.name
      ? welcomeBackLine(known.name)
      : OPENING_LINES[Math.min(OPENING_LINES.length - 1, Math.max(0, pick))]!;
    const upstreamBody = {
      agent_id: env.agentId,
      agent_version: env.agentVersion,
      metadata: {
        v: 1,
        app: "mary-waitlist",
        sessionId: body.sessionId,
        known,
        context: body.context,
        startedAt: new Date(deps.now()).toISOString(),
      },
      retell_llm_dynamic_variables: {
        opening_line: opening,
        known_summary: knownSummary(known),
        field_notes: notes.trim().slice(0, 4000) || NO_FIELD_NOTES,
      },
    };
    const version = request.headers.get("x-retell-client-js-sdk-version");

    let upstream: Upstream;
    try {
      upstream = await retellRequest(
        deps,
        "POST",
        "/v3/create-web-call",
        upstreamBody,
        8000,
        version && SDK_VERSION.test(version) ? { "X-Retell-Client-JS-SDK-Version": version } : {},
      );
    } catch (error) {
      deps.log.error(`[retell] create-web-call failed: ${errorText(error)}`);
      return Response.json(UNAVAILABLE, { status: 502 });
    }
    if (upstream.status === 429) {
      deps.log.warn("[retell] create-web-call busy (429)");
      return Response.json({ status: "error", message: "busy" }, { status: 429 });
    }
    if (!upstream.ok) {
      deps.log.error(
        `[retell] create-web-call failed ${upstream.status}: ${upstream.text.slice(0, 300)}`,
      );
      return Response.json(UNAVAILABLE, { status: 502 });
    }
    const headers = new Headers({ "content-type": "application/json", ...NO_STORE });
    for (const name of SDK_VERSION_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.text, { status: upstream.status, headers });
  });
}

// ---------- POST /api/retell/functions/save-lead ----------

/**
 * save_lead and note_details, called by Retell mid-call. Grounds the agent's
 * arguments against the transcript, writes the row once there is something to
 * save, and answers with the result the agent speaks from.
 */
export function handleRetellFunction(request: Request, deps: RetellDeps): Promise<Response> {
  return guarded("save-lead", deps, async () => {
    const raw = await readCapped(request, MAX_CHARS.functions);
    if (raw === null) return tooLarge();
    const { env } = deps;
    if (!serverRoutesEnabled(env)) return notFound();
    const signature = request.headers.get("x-retell-signature");
    if (!(await verifyRetellSignature(raw, env.signingKey ?? "", signature, deps.now()))) {
      return unauthorized();
    }
    const body = parseWith(FunctionBodySchema, raw);
    if (!body) return invalidBody();
    const { name, call } = body;
    const configured = deps.sheetsConfigured();

    if (call.agent_id !== env.agentId) {
      const ignored: FunctionResult = {
        recorded: false,
        saved: false,
        configured,
        outcome: "in_progress",
        position: null,
        collected: {},
        missing: [],
        rejected: [],
        message: "This agent is not connected to the waitlist.",
      };
      return Response.json(ignored);
    }

    const args = SaveLeadArgsSchema.parse(body.args ?? {});
    const d = groundSaveLead(args, call, name === "note_details" ? "progress" : args.stage);
    const now = deps.now();
    let saved = false;
    let position: number | null = null;

    if (d.outcome === "signed_up" || d.outcome === "callback") {
      if (configured) {
        const row = leadRowFromCall(call, d.collected, d.outcome, now);
        try {
          const answer = await deps.sheetPost(
            "lead",
            { ...row, reflect: undefined },
            { timeoutMs: 6000 },
          );
          saved = true;
          position = positionOf(answer?.position);
        } catch (error) {
          deps.log.error(`[retell] save_lead sheet write failed: ${errorText(error)}`);
        }
      }
      // Awaited: update-live-call only works while the call is ongoing, and the
      // agent says goodbye and ends the call straight after reading this result.
      await patchLead(deps, call, {
        saved,
        configured,
        outcome: d.outcome,
        position,
        collected: d.collected,
        at: now,
      });
    } else {
      // A save already recorded on this call is never overwritten with progress.
      const recorded = progressFromCall(call)?.outcome;
      if (recorded !== "signed_up" && recorded !== "callback") {
        await deps.defer(
          patchLead(deps, call, {
            saved: false,
            configured,
            outcome: "in_progress",
            position: null,
            collected: d.collected,
            at: now,
          }),
        );
      }
    }

    const result: FunctionResult = {
      recorded: d.missing.length === 0 && d.rejected.length === 0,
      saved,
      configured,
      outcome: d.outcome,
      position,
      collected: d.collected,
      missing: d.missing,
      rejected: d.rejected,
      message: functionMessage(name, d, { saved, position }),
    };
    return Response.json(result);
  });
}

// ---------- POST /api/retell/webhook ----------

// Deliveries already handled, per isolate. Retell retries a failed delivery up to three times.
const handled = new Map<string, number>();
const HANDLED_MAX = 500;

function remember(key: string, at: number) {
  handled.delete(key);
  handled.set(key, at);
  while (handled.size > HANDLED_MAX) {
    const oldest = handled.keys().next().value;
    if (oldest === undefined) break;
    handled.delete(oldest);
  }
}

/** For tests: forgets which webhook deliveries were handled. */
export function resetRetellMemory() {
  handled.clear();
}

/**
 * call_ended and call_analyzed: the backstop row (every call that spoke gets
 * one, whatever the agent did) and, after the analysis, MARY's debrief. The
 * row is awaited and a failed write answers 502 so Retell retries; the debrief
 * is deferred and never changes the status.
 */
export function handleWebhook(request: Request, deps: RetellDeps): Promise<Response> {
  return guarded("webhook", deps, async () => {
    const raw = await readCapped(request, MAX_CHARS.webhook);
    if (raw === null) return tooLarge();
    const { env } = deps;
    if (!serverRoutesEnabled(env)) return notFound();
    const now = deps.now();
    const signature = request.headers.get("x-retell-signature");
    if (!(await verifyRetellSignature(raw, env.signingKey ?? "", signature, now))) {
      return unauthorized();
    }
    const body = parseWith(WebhookBodySchema, raw);
    if (!body) return invalidBody();
    const { event, call } = body;
    if (call.agent_id !== env.agentId) return noContent();
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(event)) return noContent();
    const key = `${event}:${call.call_id}`;
    if (handled.has(key)) return noContent();

    const plan = planWebhook(event, call, now);
    if (plan.row && deps.sheetsConfigured()) {
      try {
        await deps.sheetPost("lead", { ...plan.row, reflect: undefined }, { timeoutMs: 7000 });
      } catch (error) {
        deps.log.error(`[retell] webhook sheet write failed (${event}): ${errorText(error)}`);
        return new Response("Sheet unavailable", { status: 502 });
      }
    }
    const reflect = plan.reflect;
    const lovableKey = env.lovableKey;
    if (reflect && lovableKey) {
      await deps.defer(
        Promise.resolve()
          .then(() => deps.reflect(reflect, lovableKey))
          .catch((error: unknown) => {
            deps.log.error(`[retell] debrief failed: ${errorText(error)}`);
          }),
      );
    }
    remember(key, now);
    return noContent();
  });
}

// ---------- POST /api/retell/call-status ----------

/** The browser's view of its own call: status and the progress our function handler recorded. */
export function handleCallStatus(request: Request, deps: RetellDeps): Promise<Response> {
  return guarded("call-status", deps, async () => {
    if (!browserRoutesEnabled(deps.env)) return notFound();
    const raw = await readCapped(request, MAX_CHARS.callStatus);
    if (raw === null) return tooLarge();
    const body = parseWith(CallStatusBodySchema, raw);
    if (!body) return invalidBody();

    const found = await getCall(deps, body.callId, 6000);
    if (found.kind === "failed") return lineUnavailable();
    if (found.kind === "missing" || metadataOf(found.call)?.sessionId !== body.sessionId) {
      const missing: CallStatusResponse = { found: false };
      return Response.json(missing, { headers: NO_STORE });
    }
    const status = found.call.call_status ?? "unknown";
    const result: CallStatusResponse = {
      found: true,
      status,
      ended: ENDED_STATUSES.has(status),
      disconnectionReason: found.call.disconnection_reason ?? null,
      progress: progressFromCall(found.call),
    };
    return Response.json(result, { headers: NO_STORE });
  });
}

// ---------- POST /api/retell/inject ----------

/** Typed text during a Retell call, handed to the agent as their words. Own, ongoing calls only. */
export function handleInject(request: Request, deps: RetellDeps): Promise<Response> {
  return guarded("inject", deps, async () => {
    if (!browserRoutesEnabled(deps.env)) return notFound();
    const raw = await readCapped(request, MAX_CHARS.inject);
    if (raw === null) return tooLarge();
    const body = parseWith(InjectBodySchema, raw);
    if (!body) return invalidBody();

    const found = await getCall(deps, body.callId, 5000);
    if (found.kind === "failed") return lineUnavailable();
    if (
      found.kind === "missing" ||
      metadataOf(found.call)?.sessionId !== body.sessionId ||
      found.call.call_status !== "ongoing"
    ) {
      return notFound();
    }
    try {
      const upstream = await retellRequest(
        deps,
        "PATCH",
        `/v2/update-live-call/${encodeURIComponent(body.callId)}`,
        { call_control: { additional_context: TYPED_PREFIX + body.text, trigger_response: true } },
        5000,
      );
      if (upstream.ok) return noContent();
      deps.log.error(`[retell] inject failed ${upstream.status}: ${upstream.text.slice(0, 300)}`);
    } catch (error) {
      deps.log.error(`[retell] inject failed: ${errorText(error)}`);
    }
    return lineUnavailable();
  });
}
