/**
 * Browser-side half of the "who was that for?" judgement.
 *
 * Obvious cases never leave the device: a direct answer to what she just asked,
 * or something far too fragmentary to be anything at all. Everything in between
 * goes to a fast background call, with a hard deadline so a slow answer can
 * never leave someone waiting — if it does not come back in time, she treats it
 * as hers and replies.
 */
export type Addressee = "mary" | "ambient" | "unfinished";

const DEADLINE_MS = 1200;

/** Short, conversational words that are always a reply to her. */
const DIRECT =
  /^(yes|yeah|yep|no|nope|sure|okay|ok|right|correct|hi|hello|hey|thanks|thank you|wait|hold on|sorry|what|pardon|again|maybe|exactly|true|nah)\b/i;

/** Decided here, without a round trip. Returns null when it needs the model. */
export function quickVerdict(heard: string): Addressee | null {
  const text = heard.trim();
  if (!text) return "ambient";
  const words = text.split(/\s+/);
  // A single stray syllable from across the room is not a turn.
  if (words.length === 1 && text.length <= 2) return "ambient";
  if (DIRECT.test(text)) return "mary";
  // Anything long and well-formed enough to be a real answer goes straight on.
  if (words.length >= 12) return "mary";
  return null;
}

export async function judgeAddressee(input: {
  heard: string;
  lastAssistant: string;
  recent: string[];
}): Promise<Addressee> {
  const quick = quickVerdict(input.heard);
  if (quick) return quick;
  try {
    const response = await fetch("/api/addressee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        heard: input.heard,
        lastAssistant: input.lastAssistant,
        recent: input.recent.slice(-6),
      }),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (!response.ok) return "mary";
    const data = (await response.json()) as { verdict?: Addressee };
    return data.verdict ?? "mary";
  } catch {
    // Silence is worse than a wrong guess: she answers.
    return "mary";
  }
}
