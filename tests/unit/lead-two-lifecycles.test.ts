import { beforeAll, describe, expect, it, vi } from "vitest";

import type { LeadPayload, LeadSyncResult } from "@/lib/lead-sync";

// Browser globals before the module loads, so the default outbox (localStorage)
// and the page-open / online triggers are the production ones.
const mem = new Map<string, string>();
const listeners: Record<string, (() => void)[]> = {};
let pageOpen: (() => void) | null = null;
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
  setTimeout: (fn: () => void) => {
    pageOpen = fn;
    return 1;
  },
  clearTimeout: () => {},
  addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
  removeEventListener: () => {},
});
vi.stubGlobal("document", {
  visibilityState: "visible",
  addEventListener: () => {},
  removeEventListener: () => {},
});

let M: typeof import("@/features/mary/conversation/lead-lifecycle");
let S: typeof import("@/features/mary/conversation/store");
let L: typeof import("@/lib/lead-sync");
beforeAll(async () => {
  M = await import("@/features/mary/conversation/lead-lifecycle");
  S = await import("@/features/mary/conversation/store");
  L = await import("@/lib/lead-sync");
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Two lifecycles on one store, built in the same order as createController in mary-app.tsx. */
function controller(send: (payload: LeadPayload) => Promise<LeadSyncResult>) {
  const store = S.createSessionStore();
  const base = {
    store,
    sessionId: () => "sess_now",
    beaconLead: () => {},
    saveProgress: () => ({ position: 0 }),
    reflect: async () => null,
    addLessons: () => {},
    context: () => ({ page: "", referrer: "", userAgent: "", language: "", timezone: "" }),
    positionFor: () => 7,
    now: () => Date.now(),
    setTimer: () => 0,
    clearTimer: () => {},
  };
  const lead = new M.LeadLifecycle({ ...base, syncLead: send });
  let retellSynced: LeadSyncResult = { configured: false, saved: false, position: null };
  const retellLead = new M.LeadLifecycle({
    ...base,
    syncLead: async () => retellSynced,
    detached: true,
  });
  const finishRetell = (
    collected: Record<string, string>,
    outcome: "signed_up" | "declined",
    synced: LeadSyncResult,
  ) => {
    retellSynced = synced;
    return retellLead.finalize(collected, outcome);
  };
  return { store, lead, finishRetell };
}

describe("MARY's lifecycle owns the page when a Retell lifecycle shares the store", () => {
  it("sends an older visit's queued row through the real sender on page open", async () => {
    const sent: LeadPayload[] = [];
    L.browserOutbox.stash(
      L.LeadPayloadSchema.parse({
        sessionId: "sess_old",
        outcome: "signed_up",
        name: "Old",
        email: "o@x.co",
      }),
      0,
    );
    controller(async (p) => (sent.push(p), { configured: true, saved: true, position: 3 }));
    pageOpen?.();
    await settle();
    expect(sent.map((p) => p.sessionId)).toEqual(["sess_old"]);
    expect(L.browserOutbox.list()).toHaveLength(0);
  });

  it("Try again and a correction on a MARY call reach the sheet", async () => {
    const sent: LeadPayload[] = [];
    let ok = false;
    const c = controller(async (p) => {
      sent.push(p);
      return ok
        ? { configured: true, saved: true, position: 12 }
        : { configured: true, saved: false, position: null, error: "HTTP 500" };
    });
    c.store.dispatch({ type: "START_CALL", at: Date.now() });
    await c.lead.finalize({ name: "Sarah", email: "s@x.co" }, "signed_up");
    expect(c.store.get().result?.sync).toBe("failed");
    ok = true;
    await M.retryLeadDelivery(c.store);
    expect(c.store.get().result?.sync).toBe("sheet");
    await M.correctLeadDetails(c.store, { name: "Sarah", email: "sarah@x.co" });
    expect(sent.map((p) => p.email)).toEqual(["s@x.co", "s@x.co", "sarah@x.co"]);
    L.browserOutbox.clear();
  });

  it("never queues a Retell call's row for /api/lead, and leaves other rows to the real sender", async () => {
    const sent: LeadPayload[] = [];
    const c = controller(
      async (p) => (sent.push(p), { configured: true, saved: true, position: 1 }),
    );
    c.store.dispatch({ type: "START_CALL", at: Date.now() });
    c.store.dispatch({ type: "SET_VIA", via: "retell" });
    await c.finishRetell({ name: "Sarah", email: "s@x.co" }, "declined", {
      configured: true,
      saved: false,
      position: null,
    });
    expect(L.browserOutbox.list()).toHaveLength(0);

    L.browserOutbox.stash(
      L.LeadPayloadSchema.parse({
        sessionId: "sess_old2",
        outcome: "signed_up",
        name: "Old",
        email: "o@x.co",
      }),
      0,
    );
    for (const fn of listeners["online"] ?? []) fn();
    await settle();
    expect(sent.map((p) => p.sessionId)).toEqual(["sess_old2"]);
    expect(L.browserOutbox.list()).toHaveLength(0);
  });
});

it("forgets the declined row's delivery when the conversation resumes", async () => {
  const c = controller(async () => ({ configured: true, saved: true, position: null }));
  c.store.dispatch({ type: "START_CALL", at: Date.now() });
  await c.lead.finalize({ name: "Sarah", email: "s@x.co" }, "declined");
  expect(M.leadDelivery.get().saved).toBe(true);
  c.lead.resume();
  expect(M.leadDelivery.get()).toEqual(M.IDLE_DELIVERY);
  L.browserOutbox.clear();
});
