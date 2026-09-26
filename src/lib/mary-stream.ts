import type { ClientLesson } from "./experience-store";
import { maryTurn, type Collected, type MaryTurn, type TurnFlags } from "./mary.functions";

export type TurnRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  collected: Collected;
  flags: TurnFlags;
  /** Field notes kept in this browser. */
  experience?: ClientLesson[];
};

/** The request as both /api/turn and the server function receive it. */
type TurnBody = {
  messages: TurnRequest["messages"];
  collected: Record<string, string>;
  flags: TurnFlags;
  experience?: ClientLesson[] | undefined;
};

/** Nothing arrived on the stream for this long: the connection is treated as dead. */
export const STREAM_IDLE_MS = 15000;
/** The non-streaming fallback gets one bounded chance before the turn counts as failed. */
export const FALLBACK_TIMEOUT_MS = 12000;

/**
 * Why a turn produced nothing. "aborted" is the caller's own doing (a newer
 * message, a hold) and never counts against the service.
 */
export type TurnFailure = "aborted" | "timeout" | "network" | "server";

export class TurnFailedError extends Error {
  constructor(readonly kind: TurnFailure) {
    super(`turn ${kind}`);
    this.name = "TurnFailedError";
  }
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof TurnFailedError && error.kind === "aborted") ||
    (error as { name?: string } | null)?.name === "AbortError"
  );
}

/**
 * Runs the non-streaming server function with a deadline and an abort signal.
 * The request itself cannot be cancelled once sent, but the turn stops waiting.
 */
export function maryTurnBounded(
  body: TurnBody,
  signal?: AbortSignal,
  timeoutMs = FALLBACK_TIMEOUT_MS,
): Promise<MaryTurn> {
  if (signal?.aborted) return Promise.reject(new TurnFailedError("aborted"));
  return new Promise<MaryTurn>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new TurnFailedError("aborted")));
    const timer = setTimeout(() => finish(() => reject(new TurnFailedError("timeout"))), timeoutMs);
    signal?.addEventListener("abort", onAbort);
    maryTurn({ data: body }).then(
      (turn) => finish(() => resolve(turn)),
      () => finish(() => reject(new TurnFailedError("server"))),
    );
  });
}

/**
 * Runs a turn against the streaming endpoint. `onSay` fires the moment MARY's
 * first beat is finished being written — well before the rest of the turn —
 * so her voice can start while the model is still thinking about the question.
 *
 * Rejects with a TurnFailedError; "aborted" means `signal` fired.
 */
export async function streamMaryTurn(
  input: TurnRequest,
  onSay: (text: string) => void,
  signal?: AbortSignal,
): Promise<MaryTurn> {
  const body: TurnBody = {
    messages: input.messages,
    collected: input.collected as Record<string, string>,
    flags: input.flags,
    experience: input.experience,
  };
  if (signal?.aborted) throw new TurnFailedError("aborted");

  // A stalled connection must never leave her thinking forever: the request is
  // dropped if nothing arrives for a while, and she answers from here instead.
  const controller = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => controller.abort(), ms);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const aborted = () => Boolean(signal?.aborted);
  const fallbackTurn = () => {
    clearTimeout(watchdog);
    if (aborted()) throw new TurnFailedError("aborted");
    return maryTurnBounded(body, signal);
  };
  arm(STREAM_IDLE_MS);

  try {
    let response: Response;
    try {
      response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return await fallbackTurn();
    }

    if (!response.ok || !response.body) return await fallbackTurn();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let turn: MaryTurn | null = null;
    let failed = false;
    /** The beat already handed to her voice; a fallback must build on it, not replace it. */
    let said = "";

    const handle = (line: string) => {
      if (!line.trim()) return;
      let event: { type: string; text?: string; turn?: MaryTurn };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "say" && event.text) {
        if (!said) {
          said = event.text;
          onSay(event.text);
        }
      } else if (event.type === "turn" && event.turn) {
        turn = event.turn;
      } else if (event.type === "error") {
        failed = true;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Each piece that lands buys the connection more time.
        arm(STREAM_IDLE_MS);
        buffer += value;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          handle(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
        }
      }
      handle(buffer);
    } catch {
      // The line went quiet mid-answer: keep whatever she already said.
    } finally {
      clearTimeout(watchdog);
    }

    if (aborted()) throw new TurnFailedError("aborted");
    if (turn) return turn;
    // Her first beat is already being spoken. Generating a whole new turn now
    // would voice a second, unrelated follow-up on top of it — the turn simply
    // ends on what she said, and the next one picks the thread back up.
    if (said) return partialTurn(input, said);
    // The server said so itself: the model never produced a turn. Trying the
    // same model again through the fallback would only double the wait.
    if (failed) throw new TurnFailedError("server");
    return await fallbackTurn();
  } finally {
    clearTimeout(watchdog);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** A turn that ends on the beat she already started, changing nothing else. */
function partialTurn(input: TurnRequest, say: string): MaryTurn {
  return {
    say,
    followUp: null,
    collected: input.collected,
    nextField: "none",
    complete: false,
    declined: false,
    callbackRequested: false,
    intent: "answering",
    mode: "neutral",
    wrapAsked: false,
    revealed: input.flags.revealed,
    lanesDone: input.flags.lanesDone,
    introDone: input.flags.introDone ?? false,
    rejected: [],
  };
}
