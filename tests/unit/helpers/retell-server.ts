/**
 * Shared by the Retell server tests: an independent signer (node:crypto, not
 * our WebCrypto code), call and envelope builders, the fixtures, a fake Retell
 * API and fake handler dependencies.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { vi, type Mock } from "vitest";

import type { RetellEnv } from "@/lib/retell-env.server";
import type { RetellDeps } from "@/lib/retell-handlers.server";
import { RetellCallSchema, type RetellCall } from "@/lib/retell-lead.server";
import { TYPED_PREFIX } from "@/lib/retell-shared";

export const KEY = "key_test_webhook_0123456789";
export const AGENT = "agent_mary_test";
export const NOW = 1_790_000_000_000;
export const SITE = "https://mary.example.com";
export const SESSION = "w_lx3k2_ab12cd";
export const CONTEXT = {
  page: "https://mary.example.com/",
  referrer: "",
  userAgent: "Mozilla/5.0 (Macintosh)",
  language: "en-US",
  timezone: "Europe/Berlin",
};

/** Retell's signature, computed with node:crypto so it checks our WebCrypto code independently. */
export function signBody(body: string, key = KEY, ts = NOW): string {
  return `v=${ts},d=${createHmac("sha256", key)
    .update(body + ts)
    .digest("hex")}`;
}

/** The exact text of a fixture in tests/fixtures/retell. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../../fixtures/retell/${name}`, import.meta.url), "utf8");
}

// ---------- Transcript items and calls ----------

type Item = Record<string, unknown>;

export const agent = (content: string): Item => ({ role: "agent", content, words: [] });
export const user = (content: string): Item => ({ role: "user", content, words: [] });
export const typed = (text: string): Item => ({
  role: "injected",
  content: TYPED_PREFIX + text,
  time_sec: 30,
});
export const invoke = (id: string, name: string, args: Record<string, unknown>): Item => ({
  role: "tool_call_invocation",
  tool_call_id: id,
  name,
  arguments: JSON.stringify(args),
});
export const result = (id: string, content: unknown, successful = true): Item => ({
  role: "tool_call_result",
  tool_call_id: id,
  content: typeof content === "string" ? content : JSON.stringify(content),
  successful,
});

export function metadata(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    app: "mary-waitlist",
    sessionId: SESSION,
    known: {},
    context: CONTEXT,
    startedAt: "2026-09-21T14:11:19.000Z",
    ...over,
  };
}

/** A call object as Retell sends it (input shape), with overrides. */
export function call(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    call_type: "web_call",
    call_id: "call_test_000001",
    agent_id: AGENT,
    agent_version: 3,
    call_status: "ongoing",
    start_timestamp: NOW - 120_000,
    metadata: metadata(),
    transcript_with_tool_calls: [],
    ...over,
  };
}

/** The same call, parsed the way the handlers parse it. */
export function parsedCall(over: Record<string, unknown> = {}): RetellCall {
  return RetellCallSchema.parse(call(over));
}

export function envelope(event: string, over: Record<string, unknown> = {}) {
  return { event, call: call(over) };
}

// ---------- Requests ----------

/** A POST from Retell: signed with KEY at NOW unless told otherwise (`signature: null` sends none). */
export function signedPost(
  path: string,
  body: string,
  opts: { key?: string; ts?: number; signature?: string | null } = {},
): Request {
  const signature =
    opts.signature === undefined ? signBody(body, opts.key ?? KEY, opts.ts ?? NOW) : opts.signature;
  return new Request(SITE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-retell-signature": signature } : {}),
    },
    body,
  });
}

/** A POST from the browser. */
export function browserPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(SITE + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------- A fake Retell API ----------

type Answer = () => Response | Promise<Response>;

/** Answers get-call, create-web-call and update-live-call; anything else is a test bug (500). */
export function fakeRetell(answers: { get?: Answer; create?: Answer; patch?: Answer } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/v2/get-call/")) {
      return answers.get ? answers.get() : new Response("Not found", { status: 404 });
    }
    if (method === "POST" && url.endsWith("/v3/create-web-call")) {
      return answers.create
        ? answers.create()
        : new Response(fixture("web-call.response.json"), { status: 201 });
    }
    if (method === "PATCH" && url.includes("/v2/update-live-call/")) {
      return answers.patch ? answers.patch() : Response.json({ success: true });
    }
    return new Response(`not faked: ${method} ${url}`, { status: 500 });
  });
}

export type SentRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
};

/** What the handler sent to Retell, parsed. */
export function sent(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }): SentRequest[] {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
  }));
}

// ---------- Handler dependencies ----------

export function testEnv(over: Partial<RetellEnv> = {}): RetellEnv {
  return {
    setting: "retell",
    apiKey: KEY,
    agentId: AGENT,
    agentVersion: "latest_published",
    signingKey: KEY,
    publicKey: null,
    lovableKey: null,
    ...over,
  };
}

type LogFn = (...data: unknown[]) => void;

export type TestDeps = RetellDeps & {
  fetch: Mock<typeof fetch>;
  sheetPost: Mock<RetellDeps["sheetPost"]>;
  reflect: Mock<RetellDeps["reflect"]>;
  fieldNotes: Mock<RetellDeps["fieldNotes"]>;
  log: { info: Mock<LogFn>; warn: Mock<LogFn>; error: Mock<LogFn> };
  /** Everything handed to `defer`, in order. */
  deferred: Promise<unknown>[];
};

export function deps(
  over: Partial<Omit<TestDeps, "env">> & { env?: Partial<RetellEnv> } = {},
): TestDeps {
  const deferred: Promise<unknown>[] = [];
  const { env, ...rest } = over;
  return {
    fetch: fakeRetell(),
    sheetsConfigured: () => true,
    sheetPost: vi.fn<RetellDeps["sheetPost"]>(async () => ({ position: 412 })),
    reflect: vi.fn<RetellDeps["reflect"]>(async () => null),
    fieldNotes: vi.fn<RetellDeps["fieldNotes"]>(async () => ""),
    defer: async (task) => {
      deferred.push(task);
    },
    now: () => NOW,
    random: () => 0,
    log: { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() },
    ...rest,
    env: testEnv(env),
    deferred,
  };
}
