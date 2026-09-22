import { maryTurn, type Collected, type MaryTurn, type TurnFlags } from "./mary.functions";

export type TurnRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  collected: Collected;
  flags: TurnFlags;
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
  };

  const response = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
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

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      handle(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  }
  handle(buffer);

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
      wrapAsked: false,
      revealed: input.flags.revealed,
      lanesDone: input.flags.lanesDone,
      rejected: [],
    };
  }
  return maryTurn({ data: body });
}
