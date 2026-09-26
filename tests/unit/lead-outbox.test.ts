import { describe, expect, it, vi } from "vitest";

import {
  createOutbox,
  flushOutbox,
  retryDelay,
  worthKeeping,
  type LeadPayload,
  type LeadSyncResult,
} from "@/lib/lead-sync";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map,
  };
}

const payload = (sessionId: string, extra: Partial<LeadPayload> = {}): LeadPayload => ({
  sessionId,
  outcome: "signed_up",
  name: "Sam Rivera",
  email: "sam@example.com",
  phone: "",
  business: "Rivera Homes",
  industry: "Real estate",
  operations: "",
  callbackRequested: false,
  transcript: "MARY: hi\nGuest: hi",
  turns: 3,
  durationSec: 40,
  source: "text",
  mode: "",
  startedAt: "",
  page: "",
  referrer: "",
  userAgent: "",
  language: "",
  timezone: "",
  localPosition: 0,
  reflect: false,
  ...extra,
});

const saved: LeadSyncResult = { configured: true, saved: true, position: 9 };
const broken: LeadSyncResult = {
  configured: true,
  saved: false,
  position: null,
  error: "HTTP 500",
};
const unset: LeadSyncResult = { configured: false, saved: false, position: null };

describe("outbox", () => {
  it("keeps one row per session, newest payload, and never a server debrief", () => {
    const storage = memoryStorage();
    const outbox = createOutbox(() => storage);
    outbox.stash(payload("a", { reflect: true }), 1000);
    outbox.stash(payload("a", { email: "fixed@example.com" }), 2000);
    outbox.stash(payload("b"), 3000);
    const rows = outbox.list();
    expect(rows.map((row) => row.payload.sessionId)).toEqual(["a", "b"]);
    expect(rows[0]!.payload.email).toBe("fixed@example.com");
    expect(rows[0]!.payload.reflect).toBe(false);
    expect(rows[0]!.queuedAt).toBe(1000);
  });

  it("backs off after each failure and forgets a row once the sheet confirmed it", () => {
    const storage = memoryStorage();
    const outbox = createOutbox(() => storage);
    outbox.stash(payload("a"), 1000);
    outbox.failed("a", "HTTP 500", 1000);
    expect(outbox.list()[0]).toMatchObject({ attempts: 1, nextAt: 1000 + retryDelay(1) });
    outbox.failed("a", "timeout", 5000);
    expect(outbox.list()[0]).toMatchObject({ attempts: 2, nextAt: 5000 + retryDelay(2) });
    expect(retryDelay(1)).toBe(20_000);
    expect(retryDelay(2)).toBe(40_000);
    expect(retryDelay(20)).toBe(60 * 60 * 1000);
    outbox.drop("a");
    expect(outbox.list()).toEqual([]);
    expect(storage.raw.size).toBe(0);
  });

  it("survives garbage in storage and drops rows the schema cannot read", () => {
    const storage = memoryStorage();
    storage.setItem("omnisuite.waitlist.outbox.v1", "not json");
    const outbox = createOutbox(() => storage);
    expect(outbox.list()).toEqual([]);
    storage.setItem(
      "omnisuite.waitlist.outbox.v1",
      JSON.stringify([{ payload: { nope: true } }, { payload: payload("ok"), queuedAt: 1 }]),
    );
    expect(outbox.list().map((row) => row.payload.sessionId)).toEqual(["ok"]);
    const none = createOutbox(() => null);
    none.stash(payload("x"));
    expect(none.list()).toEqual([]);
  });

  it("only carries rows with someone to reach", () => {
    expect(worthKeeping(payload("a"))).toBe(true);
    expect(worthKeeping(payload("a", { name: "", email: "", phone: "" }))).toBe(false);
    expect(worthKeeping(payload("a", { name: "", email: "", phone: "555 0100" }))).toBe(true);
  });
});

describe("flushOutbox", () => {
  it("sends due rows oldest first, drops the confirmed ones and backs off the rest", async () => {
    const storage = memoryStorage();
    const outbox = createOutbox(() => storage);
    outbox.stash(payload("late"), 3000);
    outbox.stash(payload("early"), 1000);
    outbox.stash(payload("soon"), 2000);
    outbox.failed("soon", "HTTP 500", 2000); // not due until 22 s later
    const send = vi.fn(async (row: LeadPayload) => (row.sessionId === "late" ? broken : saved));
    const report = await flushOutbox({ outbox, send, now: () => 5000 });
    expect(send.mock.calls.map((call) => call[0].sessionId)).toEqual(["early", "late"]);
    expect(report).toEqual({ sent: ["early"], failed: ["late"], skipped: [] });
    expect(
      outbox
        .list()
        .map((row) => row.payload.sessionId)
        .sort(),
    ).toEqual(["late", "soon"]);
    expect(outbox.list().find((row) => row.payload.sessionId === "late")).toMatchObject({
      attempts: 1,
      lastError: "HTTP 500",
    });
  });

  it("leaves the running conversation's row alone, and stops when no sheet is configured", async () => {
    const storage = memoryStorage();
    const outbox = createOutbox(() => storage);
    outbox.stash(payload("mine"), 1000);
    outbox.stash(payload("old"), 2000);
    outbox.stash(payload("older"), 3000);
    const send = vi.fn(async () => unset);
    const report = await flushOutbox({
      outbox,
      send,
      skip: (id) => id === "mine",
      now: () => 10_000,
    });
    expect(report.skipped).toEqual(["mine"]);
    // The first answer said "not configured": the rest wait for a later chance.
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.failed).toEqual(["old"]);
    expect(outbox.list()).toHaveLength(3);
  });

  it("ignores the backoff when forced, and never runs two passes at once", async () => {
    const storage = memoryStorage();
    const outbox = createOutbox(() => storage);
    outbox.stash(payload("a"), 1000);
    outbox.failed("a", "HTTP 500", 1000);
    let release: (value: LeadSyncResult) => void = () => {};
    const send = vi.fn(() => new Promise<LeadSyncResult>((resolve) => (release = resolve)));
    const first = flushOutbox({ outbox, send, now: () => 1001, force: true });
    const second = flushOutbox({ outbox, send, now: () => 1001, force: true });
    expect(second).toBe(first);
    release(saved);
    expect(await first).toEqual({ sent: ["a"], failed: [], skipped: [] });
    expect(send).toHaveBeenCalledTimes(1);
    // Without force the row was not due, so nothing would have gone.
    outbox.stash(payload("b"), 1000);
    outbox.failed("b", "HTTP 500", 1000);
    const quiet = vi.fn(async () => saved);
    expect(await flushOutbox({ outbox, send: quiet, now: () => 1001 })).toEqual({
      sent: [],
      failed: [],
      skipped: [],
    });
    expect(quiet).not.toHaveBeenCalled();
  });
});
