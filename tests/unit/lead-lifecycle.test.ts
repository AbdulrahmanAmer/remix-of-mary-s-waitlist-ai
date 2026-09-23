import { describe, expect, it, vi } from "vitest";

import { LeadLifecycle, type LeadLifecycleDeps } from "@/features/mary/conversation/lead-lifecycle";
import { createSessionStore } from "@/features/mary/conversation/store";
import type { LeadSyncResult } from "@/lib/lead-sync";

function setup(sync: LeadSyncResult = { configured: false, saved: false, position: null }) {
  const store = createSessionStore();
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let clock = 0;
  let nextId = 1;
  const deps: LeadLifecycleDeps = {
    store,
    sessionId: () => "sess_1",
    syncLead: vi.fn(async () => sync),
    beaconLead: vi.fn(),
    saveProgress: vi.fn(() => ({ position: 17 })),
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
  };
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers].filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { store, deps, advance, life: new LeadLifecycle(deps) };
}

const talk = (store: ReturnType<typeof createSessionStore>, n: number) => {
  for (let i = 0; i < n; i++) {
    store.dispatch({ type: "ADD_LINE", line: { id: `m${i}`, role: "mary", text: "Question?" } });
    store.dispatch({ type: "ADD_LINE", line: { id: `u${i}`, role: "user", text: "Answer" } });
  }
};

describe("LeadLifecycle", () => {
  it("saves every change locally and sends one checkpoint 5 s after the last one", () => {
    const { store, deps, advance, life } = setup();
    store.dispatch({ type: "START_CALL", at: 0 });
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah" } });
    life.onCollectedChanged();
    advance(3000);
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah", email: "s@x.co" } });
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

  it("uses the local position when no sheet is connected", async () => {
    const { store, life } = setup({ configured: false, saved: false, position: null });
    store.dispatch({ type: "START_CALL", at: 0 });
    await life.finalize({ name: "Sarah" }, "signed_up");
    expect(store.get().result).toEqual({ outcome: "signed_up", position: 17, sync: "local" });
  });

  it("uses the sheet's position when it saved, and admits failure when it did not", async () => {
    const saved = setup({ configured: true, saved: true, position: 4 });
    saved.store.dispatch({ type: "START_CALL", at: 0 });
    await saved.life.finalize({ name: "Sarah" }, "signed_up");
    expect(saved.store.get().result).toEqual({ outcome: "signed_up", position: 4, sync: "sheet" });

    const failed = setup({ configured: true, saved: false, position: null });
    failed.store.dispatch({ type: "START_CALL", at: 0 });
    await failed.life.finalize({ name: "Sarah" }, "signed_up");
    expect(failed.store.get().result).toEqual({
      outcome: "signed_up",
      position: null,
      sync: "failed",
    });
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

  it("beacons an abandoned call once, and again only when something changed", () => {
    const { store, deps, life } = setup();
    store.dispatch({ type: "START_CALL", at: 0 });
    talk(store, 2);
    life.flush();
    life.flush();
    expect(deps.beaconLead).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.beaconLead).mock.calls[0]![0]).toMatchObject({
      outcome: "abandoned",
      reflect: true,
      turns: 2,
    });
    talk(store, 1);
    life.flush();
    expect(deps.beaconLead).toHaveBeenCalledTimes(2);
  });
});
