import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  browserRoutesEnabled,
  readRetellEnv,
  serverRoutesEnabled,
  voiceStatus,
} from "@/lib/retell-env.server";
import {
  handleCallStatus,
  handleInject,
  handleRetellFunction,
  handleVoice,
  handleWebCall,
  handleWebhook,
  resetRetellMemory,
  type RetellDeps,
} from "@/lib/retell-handlers.server";
import {
  DYNAMIC_VARIABLES,
  MARY_ONLY,
  OPENING_LINES,
  RETELL_PATHS,
  TYPED_PREFIX,
  welcomeBackLine,
  type FunctionResult,
} from "@/lib/retell-shared";

import {
  AGENT,
  CONTEXT,
  KEY,
  NOW,
  SESSION,
  agent,
  browserPost,
  deps,
  envelope,
  fakeRetell,
  fixture,
  sent,
  signedPost,
  user,
  type TestDeps,
} from "./helpers/retell-server";

beforeEach(() => resetRetellMemory());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LIVE_CALL = "call_fixture_live_0001";
const LEO_FOUR = {
  name: "Leo Marsh",
  business: "Marsh Plumbing",
  industry: "plumbing",
  operations: "calls come in, whoever's free grabs them",
};
const LEO_SIX = { ...LEO_FOUR, email: "leo@marshplumbing.com", phone: "skipped" };

type Json = Record<string, unknown>;
const lead = (request: { body: Json | undefined } | undefined) =>
  ((request?.body?.["fields_to_override"] as Json)["metadata"] as Json)["lead"] as Json;
const edit = (text: string, change: (value: Json) => void) => {
  const value = JSON.parse(text) as Json;
  change(value);
  return JSON.stringify(value);
};

describe("env and GET /api/voice", () => {
  const KEYS = { RETELL_API_KEY: "key_api", RETELL_AGENT_ID: "agent_1" };
  const status = (env: Record<string, string>) => voiceStatus(readRetellEnv(env));

  it("answers MARY when nothing is set", () => {
    expect(status({})).toEqual(MARY_ONLY);
  });

  it("does nothing for retell without the keys", () => {
    expect(status({ VOICE_PROVIDER: "retell" })).toEqual(MARY_ONLY);
    expect(status({ VOICE_PROVIDER: "retell", RETELL_API_KEY: "key_api" })).toEqual(MARY_ONLY);
  });

  it("opt-in offers Retell but keeps MARY the default", () => {
    expect(status({ VOICE_PROVIDER: "retell-optin", ...KEYS })).toEqual({
      provider: "mary",
      retell: true,
      transcriptKey: null,
    });
  });

  it("retell with the keys makes Retell the default, whatever the case", () => {
    expect(status({ VOICE_PROVIDER: " Retell ", ...KEYS })).toEqual({
      provider: "retell",
      retell: true,
      transcriptKey: null,
    });
  });

  it("reads an unknown setting as MARY", () => {
    expect(status({ VOICE_PROVIDER: "elevenlabs", ...KEYS })).toEqual(MARY_ONLY);
    expect(status({ VOICE_PROVIDER: "mary", ...KEYS })).toEqual(MARY_ONLY);
  });

  it("shares the public key only while Retell is offered", () => {
    const withKey = { ...KEYS, RETELL_PUBLIC_KEY: "public_key_1" };
    expect(status({ VOICE_PROVIDER: "retell", ...withKey }).transcriptKey).toBe("public_key_1");
    expect(status({ VOICE_PROVIDER: "mary", ...withKey }).transcriptKey).toBeNull();
  });

  it("signs with the webhook key when there is one", () => {
    expect(readRetellEnv(KEYS).signingKey).toBe("key_api");
    expect(readRetellEnv({ ...KEYS, RETELL_WEBHOOK_KEY: "key_hook" }).signingKey).toBe("key_hook");
  });

  it("always sends an agent version", () => {
    const version = (value?: string) =>
      readRetellEnv(value === undefined ? {} : { RETELL_AGENT_VERSION: value }).agentVersion;
    expect(version("3")).toBe(3);
    expect(version("prod")).toBe("prod");
    expect(version("latest")).toBe("latest");
    expect(version("v2")).toBe("latest_published");
    expect(version("Bad")).toBe("latest_published");
    expect(version("")).toBe("latest_published");
    expect(version(undefined)).toBe("latest_published");
  });

  it("keeps Retell's own routes live under mary, so calls in flight drain", () => {
    const env = readRetellEnv({ VOICE_PROVIDER: "mary", ...KEYS });
    expect(serverRoutesEnabled(env)).toBe(true);
    expect(browserRoutesEnabled(env)).toBe(false);
    expect(serverRoutesEnabled(readRetellEnv({ RETELL_AGENT_ID: "agent_1" }))).toBe(false);
    const hookOnly = readRetellEnv({ RETELL_WEBHOOK_KEY: "key_hook", RETELL_AGENT_ID: "agent_1" });
    expect(serverRoutesEnabled(hookOnly)).toBe(true);
  });

  it("is never cached", async () => {
    const response = handleVoice({
      env: readRetellEnv({ VOICE_PROVIDER: "retell-optin", ...KEYS }),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ provider: "mary", retell: true, transcriptKey: null });
  });
});

describe("POST /api/retell/web-call", () => {
  const body = { sessionId: SESSION, known: {}, context: CONTEXT };
  const mint = (d: TestDeps, b: unknown = body, headers: Record<string, string> = {}) =>
    handleWebCall(browserPost(RETELL_PATHS.webCall, b, headers), d);
  const upstream = (d: TestDeps) => sent(d.fetch)[0]!;
  const variables = (d: TestDeps) =>
    upstream(d).body!["retell_llm_dynamic_variables"] as Record<string, unknown>;

  it("is closed while the setting is mary, and without the keys", async () => {
    for (const env of [{ setting: "mary" as const }, { apiKey: null }, { agentId: null }]) {
      const d = deps({ env });
      expect((await mint(d)).status).toBe(404);
      expect(d.fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses a bad body", async () => {
    const d = deps();
    expect((await mint(d, { ...body, sessionId: "a b" })).status).toBe(400);
    expect((await mint(d, "not json")).status).toBe(400);
    expect((await mint(d, { ...body, pad: "x".repeat(9000) })).status).toBe(413);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("mints at Retell with the server key", async () => {
    const d = deps();
    await mint(d);
    expect(upstream(d).url).toBe("https://api.retellai.com/v3/create-web-call");
    expect(upstream(d).method).toBe("POST");
    expect(upstream(d).headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("builds the upstream body only from its own allowlist", async () => {
    const d = deps({ env: { agentVersion: 7 } });
    await mint(d, {
      ...body,
      agent_id: "agent_someone_else",
      agent_override: { retell_llm: { model: "something-cheaper" } },
      tool_mocks: [{ tool_name: "save_lead" }],
      current_state: "close",
      known: { name: "Leo", favourite_colour: "blue" },
    });
    const sentBody = upstream(d).body!;
    expect(Object.keys(sentBody).sort()).toEqual([
      "agent_id",
      "agent_version",
      "metadata",
      "retell_llm_dynamic_variables",
    ]);
    expect(sentBody["agent_id"]).toBe(AGENT);
    expect(sentBody["agent_version"]).toBe(7);
    expect(sentBody["metadata"]).toEqual({
      v: 1,
      app: "mary-waitlist",
      sessionId: SESSION,
      known: { name: "Leo" },
      context: CONTEXT,
      startedAt: new Date(NOW).toISOString(),
    });
  });

  it("fills every dynamic variable with a string", async () => {
    const fresh = deps({ random: () => 0.7 });
    await mint(fresh);
    expect(Object.keys(variables(fresh)).sort()).toEqual([...DYNAMIC_VARIABLES].sort());
    expect(variables(fresh)).toEqual({
      opening_line: OPENING_LINES[2],
      known_summary: "nothing yet",
      field_notes: "none yet",
    });

    const back = deps({ random: () => 0.999 });
    await mint(back, { ...body, known: { name: "Leo Marsh", industry: "plumbing" } });
    expect(variables(back)).toMatchObject({
      opening_line: welcomeBackLine("Leo Marsh"),
      known_summary: "name: Leo Marsh; industry: plumbing",
    });
    for (const value of Object.values(variables(back))) expect(typeof value).toBe("string");
    expect(back.fieldNotes).toHaveBeenCalledWith("plumbing");
  });

  it("passes field notes, and still mints when they fail or are slow", async () => {
    const notes = "\n\nField notes — lessons you wrote.\n- (opening) Ask the name first.";
    const good = deps({ fieldNotes: vi.fn(async () => notes) });
    await mint(good);
    expect(variables(good)["field_notes"]).toBe(notes.trim());

    const failing = deps({
      fieldNotes: vi.fn(async () => {
        throw new Error("sheet down");
      }),
    });
    expect((await mint(failing)).status).toBe(201);
    expect(variables(failing)["field_notes"]).toBe("none yet");

    vi.useFakeTimers();
    const slow = deps({ fieldNotes: vi.fn(() => new Promise<string>(() => {})) });
    const pending = mint(slow);
    await vi.advanceTimersByTimeAsync(900);
    expect((await pending).status).toBe(201);
    expect(variables(slow)["field_notes"]).toBe("none yet");
  });

  it("passes Retell's answer through byte for byte", async () => {
    const text = fixture("web-call.response.json");
    const d = deps({
      fetch: fakeRetell({
        create: () =>
          new Response(text, {
            status: 201,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "X-Retell-Client-JS-SDK-Min-Version": "3.0.0",
              "X-Retell-Client-JS-SDK-Recommended-Version": "3.0.1",
              "x-upstream-only": "1",
            },
          }),
      }),
    });
    const response = await mint(d);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe(text);
    expect(Object.keys(JSON.parse(text) as Json).sort()).toEqual([
      "access_token",
      "call_id",
      "expires_at",
      "ice_servers",
      "transport",
    ]);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-retell-client-js-sdk-min-version")).toBe("3.0.0");
    expect(response.headers.get("x-retell-client-js-sdk-recommended-version")).toBe("3.0.1");
    expect(response.headers.get("x-upstream-only")).toBeNull();
  });

  it("forwards only a well-formed SDK version header", async () => {
    const good = deps();
    await mint(good, body, { "X-Retell-Client-JS-SDK-Version": "3.0.1" });
    expect(upstream(good).headers.get("x-retell-client-js-sdk-version")).toBe("3.0.1");
    for (const bad of ["3.0.1; x=y", "latest", "3.0"]) {
      const d = deps();
      await mint(d, body, { "x-retell-client-js-sdk-version": bad });
      expect(upstream(d).headers.get("x-retell-client-js-sdk-version")).toBeNull();
    }
  });

  it("answers busy on 429 and hides every other failure", async () => {
    const busy = deps({
      fetch: fakeRetell({
        create: () => Response.json({ status: "error", message: "limit" }, { status: 429 }),
      }),
    });
    const tooBusy = await mint(busy);
    expect(tooBusy.status).toBe(429);
    expect(await tooBusy.json()).toEqual({ status: "error", message: "busy" });

    for (const status of [401, 402, 500]) {
      const d = deps({
        fetch: fakeRetell({
          create: () => new Response(`{"message":"upstream detail ${status}"}`, { status }),
        }),
      });
      const response = await mint(d);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).not.toContain("upstream detail");
      expect(JSON.parse(text)).toEqual({
        status: "error",
        message: "The voice line is not available right now.",
      });
      expect(d.log.error).toHaveBeenCalledWith(
        expect.stringContaining(`[retell] create-web-call failed ${status}`),
      );
    }

    const offline = deps({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect((await mint(offline)).status).toBe(502);
  });

  it("never logs an access token", async () => {
    const consoleSpies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const d = deps({
      fetch: fakeRetell({ get: () => new Response(fixture("get-call.ongoing.json")) }),
    });
    await mint(d);
    await handleCallStatus(
      browserPost(RETELL_PATHS.callStatus, { callId: LIVE_CALL, sessionId: "w_other_1" }),
      d,
    );
    const failing = deps({
      fetch: fakeRetell({ create: () => new Response("upstream failure", { status: 500 }) }),
    });
    await mint(failing);
    const logged = JSON.stringify([
      ...[d, failing].flatMap((x) => [
        x.log.info.mock.calls,
        x.log.warn.mock.calls,
        x.log.error.mock.calls,
      ]),
      ...consoleSpies.map((spy) => spy.mock.calls),
    ]);
    expect(logged).toContain("create-web-call failed 500");
    expect(logged).not.toContain("access_token");
    expect(logged).not.toContain("fixture_access_token");
  });
});

describe("POST /api/retell/functions/save-lead", () => {
  const FINAL = fixture("function.save-lead.final.json");
  const run = (d: TestDeps, text: string, opts: Parameters<typeof signedPost>[2] = {}) =>
    handleRetellFunction(signedPost(RETELL_PATHS.functions, text, opts), d);
  const result = async (response: Response) => (await response.json()) as FunctionResult;

  it("refuses a bad signature before doing anything", async () => {
    const d = deps();
    for (const opts of [{ key: "key_wrong" }, { signature: null }, { ts: NOW - 300_001 }]) {
      const response = await run(d, FINAL, opts);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
    }
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("is closed without a signing key or an agent", async () => {
    expect((await run(deps({ env: { signingKey: null } }), FINAL)).status).toBe(404);
    expect((await run(deps({ env: { agentId: null } }), FINAL)).status).toBe(404);
  });

  it("refuses bad JSON, unknown functions and a missing call", async () => {
    const d = deps();
    expect((await run(d, "not json")).status).toBe(400);
    const unknown = edit(FINAL, (v) => {
      v["name"] = "delete_everything";
    });
    expect((await run(d, unknown)).status).toBe(400);
    expect((await run(d, JSON.stringify({ name: "save_lead", args: {} }))).status).toBe(400);
    expect(d.sheetPost).not.toHaveBeenCalled();
  });

  it("does not record anything for another agent", async () => {
    const d = deps();
    const foreign = edit(FINAL, (v) => {
      (v["call"] as Json)["agent_id"] = "agent_someone_else";
    });
    const response = await run(d, foreign);
    expect(response.status).toBe(200);
    expect(await result(response)).toEqual({
      recorded: false,
      saved: false,
      configured: true,
      outcome: "in_progress",
      position: null,
      collected: {},
      missing: [],
      rejected: [],
      message: "This agent is not connected to the waitlist.",
    });
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.deferred).toHaveLength(0);
  });

  it("saves a grounded sign-up, patches the call, and only then answers", async () => {
    const events: string[] = [];
    const d = deps({
      fetch: fakeRetell({
        patch: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push("patched");
          return Response.json({ success: true });
        },
      }),
    });
    const response = await run(d, FINAL);
    events.push("answered");
    expect(events).toEqual(["patched", "answered"]);
    expect(d.deferred).toHaveLength(0);

    expect(d.sheetPost).toHaveBeenCalledTimes(1);
    const [action, row, opts] = d.sheetPost.mock.calls[0]!;
    expect(action).toBe("lead");
    expect(opts).toEqual({ timeoutMs: 6000 });
    expect(row).toMatchObject({
      sessionId: SESSION,
      outcome: "signed_up",
      ...LEO_SIX,
      source: "mixed",
      callbackRequested: false,
    });
    expect(row["reflect"]).toBeUndefined();

    expect(await result(response)).toMatchObject({
      recorded: true,
      saved: true,
      configured: true,
      outcome: "signed_up",
      position: 412,
      collected: LEO_SIX,
      missing: [],
      rejected: [],
      message: expect.stringContaining("number 412"),
    });

    const patch = sent(d.fetch).find((request) => request.method === "PATCH");
    expect(patch?.url).toBe(`https://api.retellai.com/v2/update-live-call/${LIVE_CALL}`);
    expect(patch?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const original = (JSON.parse(FINAL) as { call: { metadata: Json } }).call.metadata;
    const metadata = (patch?.body?.["fields_to_override"] as Json)["metadata"] as Json;
    expect(metadata).toMatchObject({
      v: 1,
      app: "mary-waitlist",
      sessionId: SESSION,
      known: original["known"],
      context: original["context"],
      startedAt: original["startedAt"],
    });
    expect(lead(patch)).toEqual({
      saved: true,
      configured: true,
      outcome: "signed_up",
      position: 412,
      collected: LEO_SIX,
      at: NOW,
    });
  });

  it("tells the agent not to give a number when no sheet is connected", async () => {
    const d = deps({ sheetsConfigured: () => false });
    const body = await result(await run(d, FINAL));
    expect(body).toMatchObject({
      configured: false,
      saved: false,
      position: null,
      outcome: "signed_up",
    });
    expect(body.message).toContain("Do not give a position number");
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(lead(sent(d.fetch).find((r) => r.method === "PATCH"))).toMatchObject({
      saved: false,
      configured: false,
      outcome: "signed_up",
    });
  });

  it("keeps a failed sheet write's detail out of the answer", async () => {
    const d = deps({
      sheetPost: vi.fn<RetellDeps["sheetPost"]>(async () => {
        throw new Error("Sheet error: quota exceeded on sheet-id-1234");
      }),
    });
    const response = await run(d, FINAL);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ saved: false, configured: true, position: null });
    expect(text).not.toContain("quota");
    expect(text).not.toContain("sheet-id-1234");
    expect(d.log.error).toHaveBeenCalledWith(
      expect.stringContaining("[retell] save_lead sheet write failed"),
    );
  });

  it("answers the same whether or not the metadata patch lands", async () => {
    const expected = await result(await run(deps(), FINAL));
    const thrown = deps({
      fetch: fakeRetell({
        patch: () => {
          throw new Error("network down");
        },
      }),
    });
    expect(await result(await run(thrown, FINAL))).toEqual(expected);
    const refused = deps({
      fetch: fakeRetell({ patch: () => new Response("gone", { status: 400 }) }),
    });
    expect(await result(await run(refused, FINAL))).toEqual(expected);
    expect(refused.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("[retell] lead patch failed 400"),
    );
  });

  it("note_details never writes the sheet and queues its patch", async () => {
    const d = deps();
    const body = await result(await run(d, fixture("function.note-details.json")));
    expect(body).toMatchObject({
      recorded: true,
      saved: false,
      outcome: "in_progress",
      position: null,
      collected: LEO_FOUR,
      missing: [],
      rejected: [],
    });
    expect(body.message).toMatch(/^Noted\. Now the reveal/);
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(d.deferred).toHaveLength(1);
    await Promise.all(d.deferred);
    expect(lead(sent(d.fetch).find((r) => r.method === "PATCH"))).toEqual({
      saved: false,
      configured: true,
      outcome: "in_progress",
      position: null,
      collected: LEO_FOUR,
      at: NOW,
    });
  });

  it("never overwrites a recorded save with progress", async () => {
    const d = deps();
    const afterSave = edit(fixture("function.note-details.json"), (v) => {
      const metadata = (v["call"] as Json)["metadata"] as Json;
      metadata["lead"] = {
        saved: true,
        configured: true,
        outcome: "signed_up",
        position: 412,
        collected: LEO_SIX,
        at: NOW - 1000,
      };
    });
    expect((await run(d, afterSave)).status).toBe(200);
    expect(d.deferred).toHaveLength(0);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("saves the spot but leaves out what is not in their own words, and says so", async () => {
    const d = deps();
    const body = await result(await run(d, fixture("function.save-lead.ungrounded.json")));
    expect(body).toMatchObject({
      recorded: false,
      saved: true,
      outcome: "signed_up",
      rejected: ["industry"],
      missing: [],
    });
    expect(body.collected.industry).toBeUndefined();
    expect(body.message).toContain(
      "Left out because they have not said it in their own words: industry.",
    );
    expect(JSON.stringify(d.sheetPost.mock.calls)).not.toContain("roofing");
  });

  it("sends the same row for the same request twice", async () => {
    const d = deps();
    await run(d, FINAL);
    await run(d, FINAL);
    expect(d.sheetPost).toHaveBeenCalledTimes(2);
    expect(d.sheetPost.mock.calls[1]).toEqual(d.sheetPost.mock.calls[0]);
  });

  it("stays under 4,000 characters with every value at its cap", async () => {
    const d = deps();
    const text = edit(FINAL, (v) => {
      // Values the grounding accepts (a spoken token, the local part, the digits, a real
      // quote), padded to each cap with characters JSON has to escape.
      v["args"] = {
        ...(v["args"] as Json),
        name: `Leo ${'"'.repeat(116)}`,
        email: `leo@${"m".repeat(192)}.com`,
        phone: `555${" ".repeat(53)}0123`,
        business: `Marsh Plumbing ${"\\".repeat(185)}`,
        industry: `plumbing ${'"'.repeat(111)}`,
        // Grounding needs words the person said, so the padding follows a real quote.
        operations: `whoever's free grabs them ${'\\"'.repeat(187)}`,
      };
      const call = v["call"] as Json;
      call["metadata"] = { ...(call["metadata"] as Json), lead: undefined };
      (call["transcript_with_tool_calls"] as Json[]).push(
        user(`It's leo at ${"m".repeat(192)} dot com.`),
        user("Call me on 555 0123."),
      );
    });
    const response = await run(d, text);
    const body = await response.text();
    expect((JSON.parse(body) as FunctionResult).outcome).toBe("signed_up");
    expect(Object.values((JSON.parse(body) as FunctionResult).collected).join("")).toHaveLength(
      120 + 200 + 60 + 200 + 120 + 400,
    );
    expect(body.length).toBeLessThan(4000);
  });

  it("answers 500 instead of throwing", async () => {
    const d = deps({
      sheetsConfigured: () => {
        throw new Error("boom");
      },
    });
    expect((await run(d, FINAL)).status).toBe(500);
    expect(d.log.error).toHaveBeenCalledWith("[retell] save-lead failed: boom");
  });
});

describe("POST /api/retell/webhook", () => {
  const SIGNED_UP = fixture("call-ended.signed-up.json");
  const DECLINED = fixture("call-analyzed.declined.json");
  const run = (d: TestDeps, text: string, opts: Parameters<typeof signedPost>[2] = {}) =>
    handleWebhook(signedPost(RETELL_PATHS.webhook, text, opts), d);
  const row = (d: TestDeps, i = 0) => d.sheetPost.mock.calls[i]![1];

  it("refuses a bad signature", async () => {
    const d = deps();
    const response = await run(d, SIGNED_UP, { key: "key_wrong" });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(d.sheetPost).not.toHaveBeenCalled();
  });

  it("refuses a body over 2 MB, and is closed without a key", async () => {
    const d = deps();
    const big = JSON.stringify(envelope("call_ended", { pad: "x".repeat(2 * 1024 * 1024) }));
    expect((await run(d, big)).status).toBe(413);
    expect((await run(deps({ env: { signingKey: null } }), SIGNED_UP)).status).toBe(404);
    expect((await run(d, "{not json")).status).toBe(400);
    expect(d.sheetPost).not.toHaveBeenCalled();
  });

  it("acknowledges other events without doing any work", async () => {
    const d = deps({ env: { lovableKey: "lovable_key" } });
    const talk = {
      transcript_with_tool_calls: [agent("Hi."), user("Hello."), user("Still here.")],
    };
    for (const event of ["call_started", "transcript_updated", "transcript_updated"]) {
      const response = await run(d, JSON.stringify(envelope(event, talk)));
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    }
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(d.deferred).toHaveLength(0);
  });

  it("writes one signed-up row for a finished call", async () => {
    const d = deps();
    expect((await run(d, SIGNED_UP)).status).toBe(204);
    expect(d.sheetPost).toHaveBeenCalledTimes(1);
    const [action, written, opts] = d.sheetPost.mock.calls[0]!;
    expect(action).toBe("lead");
    expect(opts).toEqual({ timeoutMs: 7000 });
    expect(written).toMatchObject({
      sessionId: SESSION,
      outcome: "signed_up",
      ...LEO_SIX,
      turns: 6, // five spoken, one typed
      durationSec: 192,
      startedAt: "2026-09-21T14:10:00.000Z",
      source: "mixed",
      callbackRequested: false,
      language: "en-US",
      timezone: "Europe/Berlin",
    });
    const transcript = String(written["transcript"]);
    expect(transcript.startsWith("MARY: Hey — good to meet you.")).toBe(true);
    expect(transcript).toContain("\nGuest: I'm Leo, Leo Marsh.\n");
    expect(transcript).toContain("\nGuest: leo@marshplumbing.com\n");
    expect(transcript).not.toMatch(/^(Agent|User):/m);
    expect(written).not.toHaveProperty("summary");
    expect(d.deferred).toHaveLength(0);
  });

  it("marks a call that left early abandoned, with what note_details recorded", async () => {
    const d = deps();
    expect((await run(d, fixture("call-ended.abandoned.json"))).status).toBe(204);
    expect(row(d)).toMatchObject({
      sessionId: "w_lx9p1_zz77qq",
      outcome: "abandoned",
      name: "Priya Shah",
      business: "Shah Dental",
      industry: "dental clinic",
      operations: "the front desk answers and books them",
      email: "",
      turns: 4,
      durationSec: 90,
    });
  });

  it("handles a repeated delivery once", async () => {
    const d = deps();
    expect((await run(d, SIGNED_UP)).status).toBe(204);
    expect((await run(d, SIGNED_UP)).status).toBe(204);
    expect(d.sheetPost).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the sheet fails, so Retell retries, and the retry writes", async () => {
    const sheetPost = vi
      .fn<RetellDeps["sheetPost"]>()
      .mockRejectedValueOnce(new Error("Sheet request failed [503]"))
      .mockResolvedValue({ position: 412 });
    const d = deps({ sheetPost });
    expect((await run(d, SIGNED_UP)).status).toBe(502);
    expect((await run(d, SIGNED_UP)).status).toBe(204);
    expect((await run(d, SIGNED_UP)).status).toBe(204);
    expect(sheetPost).toHaveBeenCalledTimes(2);
    expect(sheetPost.mock.calls[1]).toEqual(sheetPost.mock.calls[0]);
  });

  it("debriefs an analysed call in the background, with the summary on the row", async () => {
    const d = deps({ env: { lovableKey: "lovable_key" } });
    expect((await run(d, DECLINED)).status).toBe(204);
    expect(row(d)).toMatchObject({
      sessionId: "w_lxa0b_cc11dd",
      outcome: "declined",
      summary: "Sam was browsing without a business and politely declined; no details were taken.",
      objections: "no business right now; just browsing",
    });
    expect(d.deferred).toHaveLength(1);
    await Promise.all(d.deferred);
    expect(d.reflect).toHaveBeenCalledTimes(1);
    expect(d.reflect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "w_lxa0b_cc11dd",
        outcome: "declined",
        turns: 3,
        durationSec: 60,
        transcript: expect.stringMatching(/^MARY: Hello — thanks for stopping by\./),
      }),
      "lovable_key",
    );
  });

  it("does not debrief without the Lovable key", async () => {
    const d = deps();
    expect((await run(d, DECLINED)).status).toBe(204);
    expect(d.sheetPost).toHaveBeenCalledTimes(1);
    expect(d.deferred).toHaveLength(0);
    expect(d.reflect).not.toHaveBeenCalled();
  });

  it("still answers 204 when the debrief fails", async () => {
    const d = deps({
      env: { lovableKey: "lovable_key" },
      reflect: vi.fn<RetellDeps["reflect"]>(async () => {
        throw new Error("model unavailable");
      }),
    });
    expect((await run(d, DECLINED)).status).toBe(204);
    await expect(Promise.all(d.deferred)).resolves.toBeDefined();
    expect(d.log.error).toHaveBeenCalledWith("[retell] debrief failed: model unavailable");
  });

  it("ignores another agent's calls", async () => {
    const d = deps({ env: { lovableKey: "lovable_key" } });
    const foreign = edit(DECLINED, (v) => {
      (v["call"] as Json)["agent_id"] = "agent_someone_else";
    });
    expect((await run(d, foreign)).status).toBe(204);
    expect(d.sheetPost).not.toHaveBeenCalled();
    expect(d.deferred).toHaveLength(0);
  });
});

describe("POST /api/retell/call-status", () => {
  const ONGOING = fixture("get-call.ongoing.json");
  const ask = (d: TestDeps, body: unknown) =>
    handleCallStatus(browserPost(RETELL_PATHS.callStatus, body), d);
  const own = { callId: LIVE_CALL, sessionId: SESSION };

  it("refuses a bad call id without asking Retell", async () => {
    const d = deps();
    expect((await ask(d, { callId: "../v2/delete-call/x", sessionId: SESSION })).status).toBe(400);
    expect((await ask(d, { callId: "short", sessionId: SESSION })).status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
    expect((await ask(deps({ env: { setting: "mary" } }), own)).status).toBe(404);
  });

  it("reports a call Retell does not know as not found", async () => {
    const response = await ask(deps(), own);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it("does not show another session's call", async () => {
    const d = deps({ fetch: fakeRetell({ get: () => new Response(ONGOING) }) });
    expect(await (await ask(d, { ...own, sessionId: "w_other_1" })).json()).toEqual({
      found: false,
    });
  });

  it("reports status and recorded progress for the visitor's own call", async () => {
    const d = deps({ fetch: fakeRetell({ get: () => new Response(ONGOING) }) });
    const response = await ask(d, own);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("access_token");
    expect(JSON.parse(text)).toEqual({
      found: true,
      status: "ongoing",
      ended: false,
      disconnectionReason: null,
      progress: {
        saved: false,
        configured: true,
        outcome: "in_progress",
        position: null,
        collected: LEO_FOUR,
      },
    });
    expect(sent(d.fetch)[0]).toMatchObject({
      url: `https://api.retellai.com/v2/get-call/${LIVE_CALL}`,
      method: "GET",
    });
    expect(sent(d.fetch)[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);

    const ended = edit(ONGOING, (v) => {
      v["call_status"] = "ended";
      v["disconnection_reason"] = "agent_hangup";
      const metadata = v["metadata"] as Json;
      metadata["lead"] = {
        ...(metadata["lead"] as Json),
        saved: true,
        outcome: "signed_up",
        position: 412,
      };
    });
    const after = deps({ fetch: fakeRetell({ get: () => new Response(ended) }) });
    expect(await (await ask(after, own)).json()).toMatchObject({
      found: true,
      status: "ended",
      ended: true,
      disconnectionReason: "agent_hangup",
      progress: { saved: true, outcome: "signed_up", position: 412 },
    });
  });

  it("answers 502 when Retell fails", async () => {
    const down = deps({ fetch: fakeRetell({ get: () => new Response("oops", { status: 500 }) }) });
    expect((await ask(down, own)).status).toBe(502);
    const garbled = deps({ fetch: fakeRetell({ get: () => new Response("<html>") }) });
    expect((await ask(garbled, own)).status).toBe(502);
  });
});

describe("POST /api/retell/inject", () => {
  const ONGOING = fixture("get-call.ongoing.json");
  const inject = (d: TestDeps, body: unknown) =>
    handleInject(browserPost(RETELL_PATHS.inject, body), d);
  const body = { callId: LIVE_CALL, sessionId: SESSION, text: "leo@marshplumbing.com" };
  const patches = (d: TestDeps) => sent(d.fetch).filter((r) => r.method === "PATCH");

  it("refuses text over 500 characters", async () => {
    const d = deps({ fetch: fakeRetell({ get: () => new Response(ONGOING) }) });
    expect((await inject(d, { ...body, text: "x".repeat(501) })).status).toBe(400);
    expect((await inject(d, { ...body, text: "   " })).status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("only reaches the visitor's own call while it is ongoing", async () => {
    const own = deps({ fetch: fakeRetell({ get: () => new Response(ONGOING) }) });
    expect((await inject(own, { ...body, sessionId: "w_other_1" })).status).toBe(404);
    const over = edit(ONGOING, (v) => {
      v["call_status"] = "ended";
    });
    const ended = deps({ fetch: fakeRetell({ get: () => new Response(over) }) });
    expect((await inject(ended, body)).status).toBe(404);
    const unknown = deps();
    expect((await inject(unknown, body)).status).toBe(404);
    for (const d of [own, ended, unknown]) expect(patches(d)).toHaveLength(0);
  });

  it("hands the typed text to the agent", async () => {
    const d = deps({ fetch: fakeRetell({ get: () => new Response(ONGOING) }) });
    expect((await inject(d, { ...body, text: "  leo@marshplumbing.com  " })).status).toBe(204);
    expect(patches(d)).toHaveLength(1);
    expect(patches(d)[0]!.url).toBe(`https://api.retellai.com/v2/update-live-call/${LIVE_CALL}`);
    expect(patches(d)[0]!.body).toEqual({
      call_control: {
        additional_context: `${TYPED_PREFIX}leo@marshplumbing.com`,
        trigger_response: true,
      },
    });
  });

  it("answers 502 when Retell fails", async () => {
    const refused = deps({
      fetch: fakeRetell({
        get: () => new Response(ONGOING),
        patch: () => new Response("no", { status: 422 }),
      }),
    });
    expect((await inject(refused, body)).status).toBe(502);
    const down = deps({ fetch: fakeRetell({ get: () => new Response("oops", { status: 503 }) }) });
    expect((await inject(down, body)).status).toBe(502);
  });
});
