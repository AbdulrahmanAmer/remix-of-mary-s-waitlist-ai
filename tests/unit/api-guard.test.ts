import { beforeEach, describe, expect, it } from "vitest";

import { checkApiRequest, resetApiGuard } from "@/lib/api-guard";
import { TurnInput } from "@/lib/mary.functions";

const SITE = "https://mary.example.com";

function post(path: string, headers: Record<string, string> = {}) {
  return new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.7", ...headers },
  });
}

beforeEach(() => resetApiGuard());

describe("checkApiRequest", () => {
  it("lets same-origin and header-less requests through", () => {
    expect(checkApiRequest(post("/api/turn", { origin: SITE }))).toEqual({ ok: true });
    expect(checkApiRequest(post("/api/lead"))).toEqual({ ok: true });
  });

  it("ignores reads and non-api paths", () => {
    const get = new Request(`${SITE}/api/lead`, { headers: { origin: "https://evil.test" } });
    expect(checkApiRequest(get)).toEqual({ ok: true });
    expect(checkApiRequest(post("/", { origin: "https://evil.test" }))).toEqual({ ok: true });
  });

  it("refuses cross-site browser requests", () => {
    expect(checkApiRequest(post("/api/turn", { origin: "https://evil.test" }))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkApiRequest(post("/api/speech", { "sec-fetch-site": "cross-site" }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses a declared body over the route's limit", () => {
    expect(
      checkApiRequest(post("/api/speech", { "content-length": String(64 * 1024) })),
    ).toMatchObject({ ok: false, status: 413 });
    expect(
      checkApiRequest(post("/api/transcribe", { "content-length": String(2 * 1024 * 1024) })),
    ).toEqual({ ok: true });
  });

  it("rate-limits per IP and route, and forgets after a minute", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) expect(checkApiRequest(post("/api/reflect"), t0 + i).ok).toBe(true);
    expect(checkApiRequest(post("/api/reflect"), t0 + 10)).toMatchObject({
      ok: false,
      status: 429,
    });
    // another route and another IP have their own budgets
    expect(checkApiRequest(post("/api/turn"), t0 + 10).ok).toBe(true);
    expect(
      checkApiRequest(post("/api/reflect", { "cf-connecting-ip": "198.51.100.1" }), t0 + 10).ok,
    ).toBe(true);
    expect(checkApiRequest(post("/api/reflect"), t0 + 61_000).ok).toBe(true);
  });
});

describe("Retell budgets", () => {
  it("takes a large webhook body and refuses a larger one", () => {
    const webhook = (bytes: number) =>
      checkApiRequest(post("/api/retell/webhook", { "content-length": String(bytes) }));
    expect(webhook(1.5 * 1024 * 1024)).toEqual({ ok: true });
    expect(webhook(3 * 1024 * 1024)).toMatchObject({ ok: false, status: 413 });
  });

  it("lets Retell's one IP call its functions freely", () => {
    const t0 = 2_000_000;
    const retell = { "cf-connecting-ip": "100.20.5.228" };
    for (let i = 0; i < 100; i++) {
      expect(checkApiRequest(post("/api/retell/functions/save-lead", retell), t0 + i).ok).toBe(
        true,
      );
    }
  });

  it("limits how many web calls one IP can mint", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 20; i++) {
      expect(checkApiRequest(post("/api/retell/web-call"), t0 + i).ok).toBe(true);
    }
    expect(checkApiRequest(post("/api/retell/web-call"), t0 + 20)).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("refuses a cross-site web call", () => {
    expect(
      checkApiRequest(post("/api/retell/web-call", { origin: "https://evil.test" })),
    ).toMatchObject({ ok: false, status: 403 });
  });
});

describe("TurnInput bounds", () => {
  const base = { collected: {}, flags: { revealed: false, lanesDone: false } };

  it("accepts a long but real conversation", () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: "a normal sentence of conversation",
    }));
    expect(TurnInput.safeParse({ ...base, messages }).success).toBe(true);
  });

  it("rejects unbounded input", () => {
    const huge = [{ role: "user" as const, content: "x".repeat(5000) }];
    expect(TurnInput.safeParse({ ...base, messages: huge }).success).toBe(false);
    const many = Array.from({ length: 401 }, () => ({ role: "user" as const, content: "hi" }));
    expect(TurnInput.safeParse({ ...base, messages: many }).success).toBe(false);
    const fields = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, "v"]));
    expect(TurnInput.safeParse({ ...base, messages: [], collected: fields }).success).toBe(false);
  });
});
