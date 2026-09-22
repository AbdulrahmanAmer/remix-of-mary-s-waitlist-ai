import { WAITLIST_FIELDS, maryTurn, type Collected, type MaryTurn } from "./mary.functions";

type RawTurn = {
  say: string;
  followUp: string | null;
  nextField: MaryTurn["nextField"];
  complete: boolean;
  declined: boolean;
} & Partial<Record<(typeof WAITLIST_FIELDS)[number], string | null>>;

/**
 * Runs a turn against the streaming endpoint. `onSay` fires the moment MARY's
 * first beat is finished being written — well before the rest of the turn —
 * so her voice can start while the model is still thinking about the question.
 */
export async function streamMaryTurn(
  input: { messages: { role: "user" | "assistant"; content: string }[]; collected: Collected },
  onSay: (text: string) => void,
): Promise<MaryTurn> {
  const response = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: input.messages,
      collected: input.collected as Record<string, string>,
    }),
  });

  if (!response.ok || !response.body) {
    return maryTurn({
      data: {
        messages: input.messages,
        collected: input.collected as Record<string, string>,
      },
    });
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let turn: MaryTurn | null = null;
  let failed = false;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: { type: string; text?: string; turn?: RawTurn };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "say" && event.text) {
      onSay(event.text);
    } else if (event.type === "turn" && event.turn) {
      const out = event.turn;
      const collected: Collected = { ...input.collected };
      for (const field of WAITLIST_FIELDS) {
        const value = out[field];
        if (value && value.trim()) collected[field] = value.trim();
      }
      turn = {
        say: out.say.trim(),
        followUp: out.followUp?.trim() ? out.followUp.trim() : null,
        collected,
        nextField: out.nextField,
        complete: out.complete,
        declined: out.declined,
      };
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
    };
  }
  return maryTurn({
    data: { messages: input.messages, collected: input.collected as Record<string, string> },
  });
}
