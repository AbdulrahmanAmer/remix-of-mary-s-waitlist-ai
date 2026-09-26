import { afterEach, describe, expect, it, vi } from "vitest";

import type { MaryTurn } from "@/lib/mary.functions";

const maryTurn = vi.fn();
vi.mock("@/lib/mary.functions", () => ({ maryTurn: (...args: unknown[]) => maryTurn(...args) }));

const { streamMaryTurn, maryTurnBounded, TurnFailedError } = await import("@/lib/mary-stream");

function turn(over: Partial<MaryTurn> = {}): MaryTurn {
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

const request = { messages: [], collected: {}, flags: { revealed: false, lanesDone: false } };
const ndjson = (events: unknown[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });

describe("streamMaryTurn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    maryTurn.mockReset();
  });

  it("hands the first beat over as it streams and returns the finished turn", async () => {
    const finished = turn({ say: "Hi.", followUp: "Name?" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjson([
          { type: "say", text: "Hi." },
          { type: "turn", turn: finished },
        ]),
      ),
    );
    const onSay = vi.fn();
    await expect(streamMaryTurn(request, onSay)).resolves.toEqual(finished);
    expect(onSay).toHaveBeenCalledWith("Hi.");
    expect(maryTurn).not.toHaveBeenCalled();
  });

  it("an error the server reports is a failure, not another model call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson([{ type: "error" }])),
    );
    await expect(streamMaryTurn(request, vi.fn())).rejects.toMatchObject({ kind: "server" });
    expect(maryTurn).not.toHaveBeenCalled();
  });

  it("falls back to the server function when the stream cannot be opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    maryTurn.mockResolvedValueOnce(turn({ say: "From the fallback." }));
    const result = await streamMaryTurn(request, vi.fn());
    expect(result.say).toBe("From the fallback.");
  });

  it("a fallback that fails too is a server failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    maryTurn.mockRejectedValueOnce(new Error("Missing LOVABLE_API_KEY"));
    await expect(streamMaryTurn(request, vi.fn())).rejects.toMatchObject({ kind: "server" });
  });

  it("a beat already spoken ends the turn on that beat when the rest never comes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson([{ type: "say", text: "First beat." }])),
    );
    const result = await streamMaryTurn(request, vi.fn());
    expect(result.say).toBe("First beat.");
    expect(result.followUp).toBeNull();
    expect(maryTurn).not.toHaveBeenCalled();
  });

  it("an aborted request is reported as aborted, never retried through the fallback", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("AbortError")));
          }),
      ),
    );
    const pending = streamMaryTurn(request, vi.fn(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
    expect(maryTurn).not.toHaveBeenCalled();
  });
});

describe("maryTurnBounded", () => {
  afterEach(() => maryTurn.mockReset());

  it("gives up on a server function that never answers", async () => {
    maryTurn.mockReturnValueOnce(new Promise(() => {}));
    await expect(maryTurnBounded(request, undefined, 20)).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("stops waiting when the turn is aborted", async () => {
    maryTurn.mockReturnValueOnce(new Promise(() => {}));
    const controller = new AbortController();
    const pending = maryTurnBounded(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(TurnFailedError);
  });
});
