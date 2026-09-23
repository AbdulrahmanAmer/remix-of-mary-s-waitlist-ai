import { describe, expect, it, vi } from "vitest";

import { createSessionStore } from "@/features/mary/conversation/store";
import { TurnRunner, type TurnRunnerDeps } from "@/features/mary/conversation/turn-runner";
import type { MaryTurn } from "@/lib/mary.functions";

function turn(over: Partial<MaryTurn>): MaryTurn {
  return {
    say: "Hello.",
    followUp: null,
    collected: {},
    nextField: "none",
    complete: false,
    declined: false,
    callbackRequested: false,
    intent: "answering",
    mode: "neutral",
    wrapAsked: false,
    revealed: false,
    lanesDone: false,
    introDone: false,
    rejected: [],
    ...over,
  };
}

function setup(overrides: Partial<TurnRunnerDeps> = {}) {
  const store = createSessionStore();
  const spoken: string[] = [];
  const waits: number[] = [];
  const deps: TurnRunnerDeps = {
    store,
    streamTurn: vi.fn(async (_req, onSay) => {
      onSay("Hi, I'm MARY from OmniSuite.");
      return turn({
        say: "Hi, I'm MARY from OmniSuite.",
        followUp: "Want first access?",
        introDone: true,
      });
    }),
    retryTurn: vi.fn(async () => turn({ say: "Something new entirely." })),
    say: vi.fn(async (text: string) => {
      spoken.push(text);
      store.dispatch({ type: "ADD_LINE", line: { id: String(spoken.length), role: "mary", text } });
    }),
    stopSpeaking: vi.fn(),
    isHeld: () => false,
    wait: vi.fn(async (ms: number) => {
      waits.push(ms);
    }),
    lessons: () => [],
    onFinish: vi.fn(),
    onSettled: vi.fn(),
    ...overrides,
  };
  return { store, deps, spoken, waits, runner: new TurnRunner(deps) };
}

describe("TurnRunner", () => {
  it("welcome speaks the first beat, then the follow-up after a breath", async () => {
    const { runner, spoken, waits, deps, store } = setup();
    await runner.welcome();
    expect(spoken).toEqual(["Hi, I'm MARY from OmniSuite.", "Want first access?"]);
    expect(waits).toContain(260);
    expect(store.get().flags.introDone).toBe(true);
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
  });

  it("a newer message makes the older turn stale, so its lines are never spoken", async () => {
    let release: (value: MaryTurn) => void = () => {};
    const first = new Promise<MaryTurn>((resolve) => (release = resolve));
    const streamTurn = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => turn({ say: "Nice to meet you, Sarah." }));
    const { runner, spoken, store } = setup({ streamTurn });
    const welcome = runner.welcome();
    await Promise.resolve();
    const reply = runner.send("I'm Sarah", "text");
    release(turn({ say: "Old welcome line that must not play." }));
    await Promise.all([welcome, reply]);
    expect(spoken).toEqual(["Nice to meet you, Sarah."]);
    expect(store.get().lines.find((l) => l.role === "user")?.text).toBe("I'm Sarah");
    expect(store.get().source.text).toBe(true);
  });

  it("counts the reveal only when its words were heard in full", async () => {
    const heard = setup({
      streamTurn: vi.fn(async () =>
        turn({ say: "OmniSuite helps you convert fresh demand.", revealed: true }),
      ),
    });
    await heard.runner.welcome();
    expect(heard.store.get().flags.revealed).toBe(true);

    const notHeard = setup({
      streamTurn: vi.fn(async () => turn({ say: "Here's the idea.", revealed: true })),
    });
    await notHeard.runner.welcome();
    expect(notHeard.store.get().flags.revealed).toBe(false);
  });

  it("finishes a complete sign-up after a breath", async () => {
    const collected = {
      name: "Sarah",
      email: "s@x.co",
      business: "Roof Co",
      industry: "Roofing",
      operations: "Two crews",
    };
    const { runner, deps, waits } = setup({
      streamTurn: vi.fn(async () =>
        turn({ say: "Thanks for signing up.", complete: true, collected }),
      ),
    });
    await runner.welcome();
    expect(waits).toContain(1300);
    expect(deps.onFinish).toHaveBeenCalledWith(collected, "signed_up");
  });

  it("says so plainly when the turn fails", async () => {
    const { runner, spoken } = setup({
      streamTurn: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    await runner.welcome();
    expect(spoken).toEqual(["I hit a snag on my side — could you try that once more?"]);
  });

  it("asks once for a fresh line when she is about to repeat herself", async () => {
    const { runner, spoken, deps, store } = setup({
      streamTurn: vi.fn(async () => turn({ say: "What should I call you?" })),
    });
    store.dispatch({
      type: "ADD_LINE",
      line: { id: "old", role: "mary", text: "What should I call you?" },
    });
    await runner.welcome();
    expect(deps.retryTurn).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual(["Something new entirely."]);
  });
});
