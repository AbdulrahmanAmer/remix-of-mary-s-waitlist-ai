import { describe, expect, it, vi } from "vitest";

import {
  correctLeadDetails,
  IDLE_DELIVERY,
  LeadLifecycle,
  retryLeadDelivery,
  type LeadDelivery,
  type LeadLifecycleDeps,
} from "@/features/mary/conversation/lead-lifecycle";
import { createSessionStore } from "@/features/mary/conversation/store";
import { createSignal } from "@/features/mary/signal/signal";
import { createOutbox, type LeadPayload, type LeadSyncResult } from "@/lib/lead-sync";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function setup(sync: LeadSyncResult | ((payload: LeadPayload) => LeadSyncResult) = unset) {
  const store = createSessionStore();
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let clock = 0;
  let nextId = 1;
  const storage = memoryStorage();
  const outbox = createOutbox(() => storage);
  const delivery = createSignal<LeadDelivery>(IDLE_DELIVERY);
  const deps: LeadLifecycleDeps = {
    store,
    sessionId: () => "sess_1",
    syncLead: vi.fn(async (payload: LeadPayload) =>
      typeof sync === "function" ? sync(payload) : sync,
    ),
    beaconLead: vi.fn(),
    saveProgress: vi.fn(() => ({ position: 0 })),
    reflect: vi.fn(async () => []),
    addLessons: vi.fn(),
    context: () => ({ page: "", referrer: "", userAgent: "", language: "", timezone: "" }),
    positionFor: () => 17,
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, at: clock + ms, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    outbox,
    delivery,
  };
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers].filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { store, deps, advance, outbox, delivery, life: new LeadLifecycle(deps) };
}

const unset: LeadSyncResult = { configured: false, saved: false, position: null };
const broken: LeadSyncResult = {
  configured: true,
  saved: false,
  position: null,
  error: "HTTP 500",
};
const savedAt = (position: number | null, emailed = false): LeadSyncResult => ({
  configured: true,
  saved: true,
  position,
  emailed,
});

const talk = (store: ReturnType<typeof createSessionStore>, n: number) => {
  for (let i = 0; i < n; i++) {
    store.dispatch({ type: "ADD_LINE", line: { id: `m${i}`, role: "mary", text: "Question?" } });
    store.dispatch({ type: "ADD_LINE", line: { id: `u${i}`, role: "user", text: "Answer" } });
  }
};

const sam = { name: "Sarah", email: "s@x.co" };

describe("LeadLifecycle", () => {
  it("saves every change locally and sends one checkpoint 5 s after the last one", () => {
    const { store, deps, advance, life } = setup();
    store.dispatch({ type: "START_CALL", at: 0 });
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah" } });
    life.onCollectedChanged();
    advance(3000);
    store.dispatch({ type: "SET_COLLECTED", collected: sam });
    life.onCollectedChanged();
    expect(deps.saveProgress).toHaveBeenCalledTimes(2);
    advance(4999);
    expect(deps.syncLead).not.toHaveBeenCalled();
    advance(1);
    expect(deps.syncLead).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.syncLead).mock.calls[0]![0]).toMatchObject({
      outcome: "in_progress",
      email: "s@x.co",
    });
  });

  it("never lets a checkpoint land after the final save", async () => {
    const { store, deps, advance, life } = setup();
    store.dispatch({ type: "START_CALL", at: 0 });
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah" } });
    life.onCollectedChanged();
    await life.finalize({ name: "Sarah" }, "declined");
    advance(10_000);
    expect(vi.mocked(deps.syncLead).mock.calls.map((c) => c[0].outcome)).toEqual(["declined"]);
  });

  it("never invents a position: no sheet means no number, and the row waits in the outbox", async () => {
    const { store, life, outbox, delivery } = setup(unset);
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize(sam, "signed_up");
    expect(store.get().result).toEqual({ outcome: "signed_up", position: null, sync: "local" });
    expect(delivery.get()).toMatchObject({ saved: false, error: "not configured", attempts: 1 });
    expect(outbox.list().map((row) => row.payload.sessionId)).toEqual(["sess_1"]);
  });

  it("shows the sheet's position when it saved, and admits failure when it did not", async () => {
    const saved = setup(savedAt(4, true));
    saved.store.dispatch({ type: "START_CALL", at: 0 });
    await saved.life.finalize(sam, "signed_up");
    expect(saved.store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "sheet" });
    expect(saved.delivery.get()).toMatchObject({ saved: true, emailedTo: "s@x.co", error: "" });
    expect(saved.outbox.list()).toEqual([]);
    expect(vi.mocked(saved.deps.saveProgress).mock.calls.at(-1)![1]).toMatchObject({
      position: 4,
      emailedTo: "s@x.co",
    });
    expect(vi.mocked(saved.deps.saveProgress).mock.calls.at(-1)![1].syncedAt).toBeTruthy();

    const noNumber = setup(savedAt(null));
    noNumber.store.dispatch({ type: "START_CALL", at: 0 });
    await noNumber.life.finalize(sam, "signed_up");
    expect(noNumber.store.get().result).toEqual({
      outcome: "signed_up",
      position: null,
      sync: "sheet",
    });

    const failed = setup(broken);
    failed.store.dispatch({ type: "START_CALL", at: 0 });
    await failed.life.finalize(sam, "signed_up");
    expect(failed.store.get().result).toEqual({
      outcome: "signed_up",
      position: null,
      sync: "failed",
    });
    expect(failed.delivery.get()).toMatchObject({ saved: false, error: "HTTP 500" });
    expect(failed.outbox.list()[0]).toMatchObject({ attempts: 1, lastError: "HTTP 500" });
  });

  it("does not queue a row nobody can be reached through", async () => {
    const { store, life, outbox } = setup(broken);
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize({ business: "Acme" }, "declined");
    expect(outbox.list()).toEqual([]);
  });

  it("re-sends the final row when a detail is corrected on the end screen", async () => {
    const { store, deps, life, delivery } = setup(savedAt(4));
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize(sam, "signed_up");
    const results: string[] = [];
    let last = store.get().result?.sync ?? "none";
    store.subscribe(() => {
      const sync = store.get().result?.sync ?? "none";
      if (sync === last) return;
      last = sync;
      results.push(sync);
    });
    await correctLeadDetails(store, { ...sam, email: "sarah@x.co" });
    expect(vi.mocked(deps.syncLead).mock.calls.map((c) => [c[0].outcome, c[0].email])).toEqual([
      ["signed_up", "s@x.co"],
      ["signed_up", "sarah@x.co"],
    ]);
    expect(results).toEqual(["pending", "sheet"]);
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "sheet" });
    expect(delivery.get().attempts).toBe(2);
  });

  it("keeps the earlier position when a correction fails, and retries on demand", async () => {
    let answer: LeadSyncResult = savedAt(4);
    const { store, deps, life, outbox } = setup(() => answer);
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize(sam, "signed_up");
    answer = broken;
    await correctLeadDetails(store, { ...sam, name: "Sara" });
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "failed" });
    expect(outbox.list()).toHaveLength(1);
    answer = savedAt(4);
    await retryLeadDelivery(store);
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "sheet" });
    expect(outbox.list()).toEqual([]);
    expect(deps.syncLead).toHaveBeenCalledTimes(3);
  });

  it("folds a correction made mid-delivery into one extra send", async () => {
    let release: (value: LeadSyncResult) => void = () => {};
    const { store, deps, life } = setup();
    vi.mocked(deps.syncLead).mockImplementation(
      () => new Promise<LeadSyncResult>((resolve) => (release = resolve)),
    );
    store.dispatch({ type: "START_CALL", at: 0 });
    const finishing = life.finalize(sam, "signed_up");
    await Promise.resolve();
    // The first write is still in flight when they fix the email — twice.
    void correctLeadDetails(store, { ...sam, email: "a@x.co" });
    void correctLeadDetails(store, { ...sam, email: "b@x.co" });
    const first = release;
    first(savedAt(4));
    await finishing;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.syncLead).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.syncLead).mock.calls[1]![0].email).toBe("b@x.co");
    release(savedAt(4));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "sheet" });
  });

  it("retries a stuck row on its own only once the backoff has passed, then older rows", async () => {
    let answer: LeadSyncResult = broken;
    const { store, deps, advance, life, outbox } = setup(() => answer);
    outbox.stash({ ...life.payload("signed_up"), sessionId: "sess_old", name: "Old" }, 0);
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize(sam, "signed_up");
    expect(store.get().result?.sync).toBe("failed");
    answer = savedAt(8);
    await life.flushDue();
    // Too soon for this conversation's row; the old one goes.
    expect(vi.mocked(deps.syncLead).mock.calls.map((c) => c[0].sessionId)).toEqual([
      "sess_1",
      "sess_old",
    ]);
    expect(store.get().result?.sync).toBe("failed");
    advance(20_000);
    await life.flushDue();
    expect(vi.mocked(deps.syncLead).mock.calls.map((c) => c[0].sessionId)).toEqual([
      "sess_1",
      "sess_old",
      "sess_1",
    ]);
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 8, sync: "sheet" });
    expect(outbox.list()).toEqual([]);
  });

  it("leaves the running conversation's own row alone when older rows are flushed", async () => {
    const { store, deps, life, outbox } = setup(savedAt(1));
    outbox.stash({ ...life.payload("abandoned"), sessionId: "sess_1", name: "Me" }, 0);
    outbox.stash({ ...life.payload("abandoned"), sessionId: "sess_old", name: "Old" }, 0);
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.flushDue();
    expect(vi.mocked(deps.syncLead).mock.calls.map((c) => c[0].sessionId)).toEqual(["sess_old"]);
  });

  it("debriefs only after at least two answers", async () => {
    const short = setup();
    short.store.dispatch({ type: "START_CALL", at: 0 });
    talk(short.store, 1);
    await short.life.finalize({}, "declined");
    expect(short.deps.reflect).not.toHaveBeenCalled();

    const long = setup();
    long.store.dispatch({ type: "START_CALL", at: 0 });
    talk(long.store, 3);
    await long.life.finalize({}, "declined");
    expect(long.deps.reflect).toHaveBeenCalledTimes(1);
  });

  it("beacons an abandoned call once, keeps it in the outbox without a debrief, and again only when something changed", () => {
    const { store, deps, life, outbox } = setup();
    store.dispatch({ type: "START_CALL", at: 0 });
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah" } });
    talk(store, 2);
    life.flush();
    life.flush();
    expect(deps.beaconLead).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.beaconLead).mock.calls[0]![0]).toMatchObject({
      outcome: "abandoned",
      reflect: true,
      turns: 2,
    });
    expect(outbox.list()[0]!.payload).toMatchObject({ outcome: "abandoned", reflect: false });
    talk(store, 1);
    life.flush();
    expect(deps.beaconLead).toHaveBeenCalledTimes(2);
    expect(outbox.list()).toHaveLength(1);
  });
});
