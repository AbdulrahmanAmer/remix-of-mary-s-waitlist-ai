import { describe, expect, it, vi } from "vitest";

import { createSessionStore } from "@/features/mary/conversation/store";
import { FALLBACK_LINE, OFFLINE_LINE, SNAG_LINES } from "@/features/mary/conversation/text";
import { TurnRunner, type TurnRunnerDeps } from "@/features/mary/conversation/turn-runner";
import { TurnFailedError } from "@/lib/mary-stream";
import type { MaryTurn } from "@/lib/mary.functions";

const OPENER = "Hi, I'm MARY from OmniSuite. What should I call you?";

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

/** Rejects the way the stream does when the runner drops the request. */
function untilAborted(signal: AbortSignal): Promise<MaryTurn> {
  return new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(new TurnFailedError("aborted"))),
  );
}

function setup(overrides: Partial<TurnRunnerDeps> = {}) {
  const store = createSessionStore();
  store.dispatch({ type: "START_CALL", at: 1 });
  const spoken: string[] = [];
  const asides: string[] = [];
  const waits: number[] = [];
  const deps: TurnRunnerDeps = {
    store,
    streamTurn: vi.fn(async (_req, onSay) => {
      onSay("Nice to meet you, Sarah.");
      return turn({ say: "Nice to meet you, Sarah.", followUp: "What do you run?" });
    }),
    retryTurn: vi.fn(async () => turn({ say: "Something new entirely." })),
    say: vi.fn(async (text: string) => {
      spoken.push(text);
      store.dispatch({ type: "ADD_LINE", line: { id: String(spoken.length), role: "mary", text } });
    }),
    aside: vi.fn((text: string) => {
      asides.push(text);
      store.dispatch({
        type: "ADD_LINE",
        line: { id: `aside-${asides.length}`, role: "mary", text, aside: true },
      });
    }),
    stopSpeaking: vi.fn(),
    isHeld: () => false,
    wait: vi.fn(async (ms: number) => {
      waits.push(ms);
    }),
    lessons: () => [],
    openingLine: vi.fn(() => OPENER),
    onFinish: vi.fn(),
    onSettled: vi.fn(),
    ...overrides,
  };
  return { store, deps, spoken, asides, waits, runner: new TurnRunner(deps) };
}

describe("TurnRunner welcome", () => {
  it("speaks the fixed opener at once, without the model", async () => {
    const { runner, spoken, deps, store } = setup();
    await runner.welcome();
    expect(spoken).toEqual([OPENER]);
    expect(deps.streamTurn).not.toHaveBeenCalled();
    expect(store.get().flags.introDone).toBe(true);
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
    expect(runner.busy).toBe(false);
  });

  it("picks the opener from what she already knows", async () => {
    const { runner, deps, store } = setup();
    store.dispatch({ type: "SET_COLLECTED", collected: { name: "Sarah" } });
    await runner.welcome();
    expect(deps.openingLine).toHaveBeenCalledWith({ name: "Sarah" });
  });

  it("an opener cut off by a real hold does not count as the intro", async () => {
    let finishLine: () => void = () => {};
    const { runner, deps, store } = setup({
      say: vi.fn(() => new Promise<void>((resolve) => (finishLine = resolve))),
    });
    const welcome = runner.welcome();
    await vi.waitFor(() => expect(deps.say).toHaveBeenCalled());
    runner.interrupt();
    finishLine();
    await welcome;
    expect(deps.stopSpeaking).toHaveBeenCalled();
    expect(store.get().flags.introDone).toBe(false);
  });
});

describe("TurnRunner send", () => {
  it("puts the typed line on screen before the turn runs, and clears the hold notices", () => {
    const { runner, store, deps } = setup({
      streamTurn: vi.fn(() => new Promise<MaryTurn>(() => {})),
    });
    store.dispatch({ type: "SET_NOTICE", key: "missedHold", value: true });
    store.dispatch({ type: "SET_NOTICE", key: "suggestTyping", value: true });
    void runner.send("  I'm Sarah ", "text");
    expect(store.get().lines).toEqual([
      { id: expect.any(String), role: "user", text: "I'm Sarah" },
    ]);
    expect(store.get().notices.missedHold).toBe(false);
    expect(store.get().notices.suggestTyping).toBe(false);
    expect(store.get().source.text).toBe(true);
    expect(runner.busy).toBe(true);
    expect(deps.stopSpeaking).toHaveBeenCalled();
  });

  it("speaks the first beat as it streams, then the follow-up after a breath", async () => {
    const { runner, spoken, waits, deps } = setup();
    await runner.send("I'm Sarah", "text");
    expect(spoken).toEqual(["Nice to meet you, Sarah.", "What do you run?"]);
    expect(waits).toContain(260);
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
  });

  it("a newer message drops the request in flight and one turn answers both", async () => {
    const signals: AbortSignal[] = [];
    const streamTurn = vi.fn((_req, _onSay, signal: AbortSignal) => {
      signals.push(signal);
      if (signals.length === 1) return untilAborted(signal);
      return Promise.resolve(turn({ say: "Sarah from Roof Co, got it." }));
    });
    const { runner, spoken, deps } = setup({ streamTurn });
    const first = runner.send("I'm Sarah", "text");
    await Promise.resolve();
    const second = runner.send("from Roof Co", "text");
    await Promise.all([first, second]);
    expect(signals[0]?.aborted).toBe(true);
    expect(streamTurn).toHaveBeenCalledTimes(2);
    const request = streamTurn.mock.calls[1]![0] as { messages: { content: string }[] };
    expect(request.messages.map((m) => m.content)).toEqual(["I'm Sarah", "from Roof Co"]);
    expect(spoken).toEqual(["Sarah from Roof Co, got it."]);
    // No apology for a turn the person themselves overtook.
    expect(spoken.some((line) => SNAG_LINES.includes(line as (typeof SNAG_LINES)[number]))).toBe(
      false,
    );
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
    expect(runner.busy).toBe(false);
  });

  it("keeps what a turn captured even when a hold overtook it", async () => {
    let release: (value: MaryTurn) => void = () => {};
    const { runner, spoken, store } = setup({
      streamTurn: vi.fn(() => new Promise<MaryTurn>((resolve) => (release = resolve))),
    });
    const reply = runner.send("I'm Sarah", "text");
    await Promise.resolve();
    runner.interrupt();
    release(turn({ say: "Old line.", collected: { name: "Sarah" } }));
    await reply;
    expect(spoken).toEqual([]);
    expect(store.get().collected).toEqual({ name: "Sarah" });
  });

  it("counts the reveal only when its words were heard in full", async () => {
    const heard = setup({
      streamTurn: vi.fn(async () =>
        turn({ say: "OmniSuite helps you convert fresh demand.", revealed: true }),
      ),
    });
    await heard.runner.send("Tell me", "text");
    expect(heard.store.get().flags.revealed).toBe(true);

    const notHeard = setup({
      streamTurn: vi.fn(async () => turn({ say: "Here's the idea.", revealed: true })),
    });
    await notHeard.runner.send("Tell me", "text");
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
    await runner.send("Yes please", "text");
    expect(waits).toContain(1300);
    expect(deps.onFinish).toHaveBeenCalledWith(collected, "signed_up");
  });
});

describe("TurnRunner failures", () => {
  it("apologises once, then hands over to the details form instead of looping", async () => {
    const { runner, spoken, asides, store } = setup({
      streamTurn: vi.fn(async () => {
        throw new TurnFailedError("server");
      }),
    });
    await runner.send("I'm Sarah", "text");
    expect(spoken).toEqual([SNAG_LINES[0]]);
    expect(store.get().stage).toBe("call");
    await runner.send("Hello?", "text");
    expect(spoken).toEqual([SNAG_LINES[0]]);
    expect(asides).toEqual([FALLBACK_LINE]);
    expect(store.get().stage).toBe("fallback");
    expect(store.get().presence).toBe("idle");
    expect(runner.busy).toBe(false);
  });

  it("a reply in between resets the count", async () => {
    const streamTurn = vi
      .fn()
      .mockRejectedValueOnce(new TurnFailedError("timeout"))
      .mockResolvedValueOnce(turn({ say: "Back with you." }))
      .mockRejectedValueOnce(new TurnFailedError("network"));
    const { runner, spoken, store } = setup({ streamTurn });
    await runner.send("one", "text");
    await runner.send("two", "text");
    await runner.send("three", "text");
    expect(spoken).toEqual([SNAG_LINES[0], "Back with you.", SNAG_LINES[0]]);
    expect(store.get().stage).toBe("call");
  });

  it("never leaves her thinking after a failed turn", async () => {
    const { runner, store } = setup({
      streamTurn: vi.fn(async () => {
        throw new TurnFailedError("server");
      }),
    });
    await runner.send("I'm Sarah", "text");
    expect(store.get().presence).not.toBe("thinking");
  });

  it("waits for the network to come back instead of failing", async () => {
    let online = false;
    let backOnline: () => void = () => {};
    const { runner, spoken, asides, deps, store } = setup({
      online: () => online,
      whenOnline: vi.fn(() => new Promise<void>((resolve) => (backOnline = resolve))),
    });
    const reply = runner.send("I'm Sarah", "text");
    await vi.waitFor(() => expect(asides).toEqual([OFFLINE_LINE]));
    expect(store.get().presence).toBe("idle");
    expect(deps.streamTurn).not.toHaveBeenCalled();
    online = true;
    backOnline();
    await reply;
    expect(spoken).toEqual(["Nice to meet you, Sarah.", "What do you run?"]);
    expect(store.get().stage).toBe("call");
  });

  it("a request that died because the connection dropped is retried once it is back", async () => {
    let online = true;
    const streamTurn = vi
      .fn()
      .mockImplementationOnce(async () => {
        online = false;
        throw new TurnFailedError("network");
      })
      .mockResolvedValueOnce(turn({ say: "There you are." }));
    const { runner, spoken, asides } = setup({
      streamTurn,
      online: () => online,
      whenOnline: vi.fn(async () => {
        online = true;
      }),
    });
    await runner.send("I'm Sarah", "text");
    expect(asides).toEqual([OFFLINE_LINE]);
    expect(spoken).toEqual(["There you are."]);
  });
});

describe("TurnRunner repeats", () => {
  it("asks once for a fresh line when she is about to repeat herself", async () => {
    const { runner, spoken, deps, store } = setup({
      streamTurn: vi.fn(async () => turn({ say: "What should I call you?" })),
    });
    store.dispatch({
      type: "ADD_LINE",
      line: { id: "old", role: "mary", text: "What should I call you?" },
    });
    await runner.send("Hello", "text");
    expect(deps.retryTurn).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual(["Something new entirely."]);
  });

  it("lets the follow-up carry the turn when the retry repeats too", async () => {
    const repeat = "What should I call you?";
    const { runner, spoken, store } = setup({
      streamTurn: vi.fn(async () => turn({ say: repeat, followUp: "And your business?" })),
      retryTurn: vi.fn(async () => turn({ say: repeat })),
    });
    store.dispatch({ type: "ADD_LINE", line: { id: "old", role: "mary", text: repeat } });
    await runner.send("Hello", "text");
    expect(spoken).toEqual(["And your business?"]);
  });

  it("says a repeated line rather than nothing when there is no follow-up", async () => {
    const repeat = "What should I call you?";
    const { runner, spoken, store } = setup({
      streamTurn: vi.fn(async () => turn({ say: repeat })),
      retryTurn: vi.fn(async () => {
        throw new TurnFailedError("server");
      }),
    });
    store.dispatch({ type: "ADD_LINE", line: { id: "old", role: "mary", text: repeat } });
    await runner.send("Hello", "text");
    expect(spoken).toEqual([repeat]);
    expect(store.get().presence).not.toBe("thinking");
  });
});
