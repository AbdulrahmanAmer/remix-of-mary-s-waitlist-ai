import { describe, expect, it, vi } from "vitest";

import { initialState, reduce } from "@/features/mary/conversation/reducer";
import { createSessionStore } from "@/features/mary/conversation/store";
import { createSignal } from "@/features/mary/signal/signal";

const mary = (id: string, text: string) => ({ id, role: "mary" as const, text });

describe("session reducer", () => {
  it("starts the call once and records when", () => {
    const s = reduce(initialState(), { type: "START_CALL", at: 1000 });
    expect(s.stage).toBe("call");
    expect(s.startedAt).toBe(1000);
    const again = reduce(s, { type: "START_CALL", at: 5000 });
    expect(again.startedAt).toBe(1000);
  });

  it("keeps only the heard words of a cut-off line, or drops it when nothing was heard", () => {
    let s = reduce(initialState(), { type: "ADD_LINE", line: mary("a", "Hi there, I'm MARY") });
    s = reduce(s, { type: "CUT_LINE", id: "a", spoken: "Hi there," });
    expect(s.lines).toEqual([{ id: "a", role: "mary", text: "Hi there,", interrupted: true }]);
    s = reduce(s, { type: "ADD_LINE", line: mary("b", "Second line") });
    s = reduce(s, { type: "CUT_LINE", id: "b", spoken: "" });
    expect(s.lines.map((l) => l.id)).toEqual(["a"]);
  });

  it("replaces collected fields and merges flags", () => {
    let s = reduce(initialState(), { type: "SET_COLLECTED", collected: { name: "Sarah" } });
    s = reduce(s, { type: "SET_COLLECTED", collected: { name: "Sarah", email: "s@x.co" } });
    expect(s.collected).toEqual({ name: "Sarah", email: "s@x.co" });
    s = reduce(s, { type: "MERGE_FLAGS", flags: { revealed: true } });
    expect(s.flags).toMatchObject({ revealed: true, lanesDone: false });
  });

  it("finishes into a pending result, and resumes back to the call", () => {
    let s = reduce(initialState(), { type: "START_CALL", at: 1 });
    s = reduce(s, { type: "FINISH", outcome: "declined" });
    expect(s.stage).toBe("done");
    expect(s.presence).toBe("done");
    expect(s.result).toEqual({ outcome: "declined", position: null, sync: "pending" });
    s = reduce(s, { type: "RESUME" });
    expect(s.stage).toBe("call");
    expect(s.result).toBeNull();
    expect(s.presence).toBe("idle");
  });

  it("only accepts a result update while the end screen is showing", () => {
    const s = reduce(initialState(), {
      type: "SET_RESULT",
      result: { outcome: "signed_up", position: 3, sync: "sheet" },
    });
    expect(s.result).toBeNull();
  });

  it("returns the same object when nothing changed, so subscribers are not woken", () => {
    const s = reduce(initialState(), { type: "SET_REVEAL", id: "a", count: 2 });
    expect(reduce(s, { type: "SET_REVEAL", id: "a", count: 2 })).toBe(s);
    expect(reduce(s, { type: "SET_PRESENCE", presence: s.presence })).toBe(s);
  });
});

describe("session store and signal", () => {
  it("notifies subscribers only on real changes", () => {
    const store = createSessionStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
    expect(fn).not.toHaveBeenCalled();
    store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get().presence).toBe("thinking");
    off();
    store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("signal holds a value outside React", () => {
    const level = createSignal(0);
    const seen: number[] = [];
    level.subscribe((v) => seen.push(v));
    level.set(0.4);
    expect(level.get()).toBe(0.4);
    expect(seen).toEqual([0.4]);
  });
});

describe("talk mode", () => {
  it("defaults to hold-to-talk and switches to hands-free", () => {
    const s = initialState();
    expect(s.talkMode).toBe("hold");
    const hands = reduce(s, { type: "SET_TALK_MODE", mode: "hands-free" });
    expect(hands.talkMode).toBe("hands-free");
    expect(reduce(hands, { type: "SET_TALK_MODE", mode: "hands-free" })).toBe(hands);
  });
});
