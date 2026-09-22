import type { ClientLesson } from "./experience-store";
import { maryTurn, type Collected, type MaryTurn, type TurnFlags } from "./mary.functions";

export type TurnRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  collected: Collected;
  flags: TurnFlags;
  /** Field notes kept in this browser. */
  experience?: ClientLesson[];
};

/**
 * Runs a turn against the streaming endpoint. `onSay` fires the moment MARY's
 * first beat is finished being written — well before the rest of the turn —
 * so her voice can start while the model is still thinking about the question.
 */
export async function streamMaryTurn(
  input: TurnRequest,
  onSay: (text: string) => void,
): Promise<MaryTurn> {
  const body = {
    messages: input.messages,
    collected: input.collected as Record<string, string>,
    flags: input.flags,
    experience: input.experience,
  };

  // A stalled connection must never leave her thinking forever: the request is
  // dropped if nothing arrives for a while, and she answers from here instead.
  const controller = new AbortController();
  let watchdog = 0;
  const arm = (ms: number) => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => controller.abort(), ms);
  };
  arm(15000);

  let response: Response;
  try {
    response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    window.clearTimeout(watchdog);
    return maryTurn({ data: body });
  }

  if (!response.ok || !response.body) {
    window.clearTimeout(watchdog);
    return maryTurn({ data: body });
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let turn: MaryTurn | null = null;
  let failed = false;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: { type: string; text?: string; turn?: MaryTurn };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "say" && event.text) {
      onSay(event.text);
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
      arm(15000);
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
    window.clearTimeout(watchdog);
  }

  if (turn) return turn;
  if (failed) {
    return {
      say: "Sorry — I lost my train of thought there. Could you say that once more?",
      followUp: null,
      collected: input.collected,
      nextField: "none",
      complete: false,
      declined: false,
      callbackRequested: false,
      intent: "answering" as const,
      mode: "neutral" as const,
      wrapAsked: false,
      revealed: input.flags.revealed,
      lanesDone: input.flags.lanesDone,
      introDone: input.flags.introDone ?? false,
      rejected: [],
    };
  }
  return maryTurn({ data: body });
}
