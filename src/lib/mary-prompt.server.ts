import { z } from "zod";
// MARY's personality and behaviour live in one document; the app reads it
// directly, so the spec and her actual behaviour can never drift apart.
import MARY_VOICE_SPEC from "../../docs/mary-voice.md?raw";

export const SYSTEM = MARY_VOICE_SPEC;

export const WAITLIST_FIELDS = [
  "name",
  "email",
  "phone",
  "business",
  "industry",
  "operations",
] as const;

export const TurnSchema = z.object({
  say: z.string(),
  followUp: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  business: z.string().nullable(),
  industry: z.string().nullable(),
  operations: z.string().nullable(),
  nextField: z.enum(["name", "email", "phone", "business", "industry", "operations", "none"]),
  complete: z.boolean(),
  declined: z.boolean(),
  phase: z.enum(["WELCOME", "DISCOVER", "REVEAL", "LANES", "CONTACT", "WRAP", "CLOSE"]),
  revealed: z.boolean(),
});

export type TurnObject = z.infer<typeof TurnSchema>;

export function buildPrompt(
  messages: { role: "user" | "assistant"; content: string }[],
  collected: Record<string, string>,
) {
  const history = messages
    .map((m) => `${m.role === "user" ? "Person" : "MARY"}: ${m.content}`)
    .join("\n");

  const known = Object.entries(collected)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const allCaptured = WAITLIST_FIELDS.every((f) => collected[f]);
  const saidByMary = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join(" ");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
  // Phase is derived from what MARY has actually already said this session, so
  // a beat can never be replayed or skipped.
  const revealed = /convert/i.test(saidByMary);
  const lanesDone = /cultivate/i.test(saidByMary) && /recover/i.test(saidByMary);
  const discoveryDone = Boolean(
    collected["name"] && collected["business"] && collected["industry"] && collected["operations"],
  );
  const wrapAsked = Boolean(lastAssistant && lastAssistant.includes("?"));

  const phase = !history
    ? "WELCOME — the conversation is just starting. One sentence on who you are and what OmniSuite does, then ask if they want first access. No personal question yet."
    : !discoveryDone
      ? "DISCOVER — never mention the waitlist offer again. React to what they just said, sell one point that fits their own situation when there is an opening, and pull what is still missing using guesses, labels and assumptive framing. Never ask a plain intake question."
      : !revealed
        ? "REVEAL — you now have their name, business, industry and how they operate. Stop and show them what just happened: no form, and you already know all of it. Credit Convert, not yourself. Do not ask for anything in this turn."
        : !lanesDone
          ? "LANES — immediately tie Cultivate and Recover to their own situation, one short beat each, then land that it is three lanes in one system. No questions here."
          : !allCaptured
            ? "CONTACT — everything else is known. Get their email as housekeeping tied to their spot confirmation, and offer the phone as skippable. One ask per turn."
            : wrapAsked
              ? "CLOSE — they've answered your wrap question. Answer anything they asked in one sentence, then deliver the exact closing line and set complete true."
              : "WRAP — everything is captured, but do NOT close yet. Tell them they're all set and ask if they have questions or want you to finalise their spot. Keep complete false.";

  const missing = WAITLIST_FIELDS.filter((f) => !collected[f]);
  const gate = missing.length
    ? `\n\nStill missing: ${missing.join(", ")}. You may NOT close and complete must stay false until every one of these is captured, even if they ask you to finish now — in that case say you just need the last detail and ask for it.`
    : "";

  return `Current phase: ${phase}\n\nAlready captured:\n${known || "(nothing yet)"}\n\nConversation so far:\n${
    history || "(the conversation is just starting)"
  }${gate}\n\nProduce MARY's next spoken turn as two beats: "say" reacts to them first, "followUp" asks the one next thing (or null). Neither beat may repeat anything you already said.`;
}

export function gatewayConfig(key: string) {
  return {
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  };
}
