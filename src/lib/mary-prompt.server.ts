import { z } from "zod";
// MARY's personality and behaviour live in one document; the app reads it
// directly, so the spec and her actual behaviour can never drift apart.
import MARY_VOICE_SPEC from "../../docs/mary-voice.md?raw";
import { groundCollected, type Proposed } from "./mary-grounding";
import { CUT_OFF_MARK, isEchoOfAssistant, stripAssistantEcho } from "./voice-logic";
import type { Collected, MaryTurn, TurnFlags } from "./mary.functions";

export const SYSTEM = MARY_VOICE_SPEC;

export const WAITLIST_FIELDS = [
  "name",
  "email",
  "phone",
  "business",
  "industry",
  "operations",
] as const;

// Property order matters: "say" streams first and is final the moment
// "followUp" begins, which is what lets her voice start early.
export const TurnSchema = z.object({
  say: z.string(),
  followUp: z.string().nullable(),
  name: z.string().nullable(),
  nameEvidence: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  business: z.string().nullable(),
  businessEvidence: z.string().nullable(),
  industry: z.string().nullable(),
  industryEvidence: z.string().nullable(),
  operations: z.string().nullable(),
  operationsEvidence: z.string().nullable(),
  nextField: z.enum(["name", "email", "phone", "business", "industry", "operations", "none"]),
  complete: z.boolean(),
  declined: z.boolean(),
  // What their last message was doing — read before anything about the funnel.
  intent: z.enum([
    "greeting",
    "answering",
    "asking",
    "correcting",
    "objecting",
    "callback",
    "refusing",
    "leaving",
    "smalltalk",
  ]),
  mode: z.enum(["neutral", "rushed", "skeptical", "guarded", "warm"]),
  callbackRequested: z.boolean(),
  wrapAsked: z.boolean(),
  phase: z.enum([
    "WELCOME",
    "DISCOVER",
    "REVEAL",
    "LANES",
    "CONTACT",
    "WRAP",
    "CLOSE",
    "CALLBACK",
    "EXIT",
  ]),
  revealed: z.boolean(),
  lanesDone: z.boolean(),
});

export type TurnObject = z.infer<typeof TurnSchema>;

export type TurnMessage = { role: "user" | "assistant"; content: string };

export function buildPrompt(
  messages: TurnMessage[],
  collected: Record<string, string>,
  flags: TurnFlags,
) {
  const history = messages
    .map((m) => `${m.role === "user" ? "Person" : "MARY"}: ${m.content}`)
    .join("\n");

  const known = Object.entries(collected)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  // Phone is always offered but always skippable, so it never blocks the close.
  const requiredFields = WAITLIST_FIELDS.filter((f) => f !== "phone");
  const allCaptured = requiredFields.every((f) => collected[f]);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
  // Phase is derived from what MARY has actually finished saying this session —
  // a beat she was cut off in does not count — so nothing is replayed or skipped.
  const revealed = flags.revealed;
  const lanesDone = flags.lanesDone;
  const discoveryDone = Boolean(
    collected["name"] && collected["business"] && collected["industry"] && collected["operations"],
  );
  // The wrap question is marked explicitly by the turn that asked it — no
  // guessing from punctuation, which stalled whenever a line was cut off.
  const wrapAsked = Boolean(flags.wrapAsked);
  const wasCutOff = Boolean(lastAssistant && lastAssistant.includes(CUT_OFF_MARK));
  const callback = Boolean(flags.callback);

  const phase = callback
    ? "CALLBACK — they asked to be called back. The sales sequence is over: do not pitch, do not run discovery. You need only their name and a number, one ask per turn, skipping anything you already have. Promise nothing about timing — say the request goes straight to the team. Set callbackRequested true every turn from here."
    : !history
      ? "WELCOME — the very first thing you say. Greet them like a person first (a short hello on its own), then say who you are in one plain line, then what OmniSuite is in one plain line. Three short beats maximum, no stacking. No personal question at all this turn — end with something easy to respond to, not an intake question. Vary the wording; never use the same opener twice."
      : !discoveryDone
        ? "DISCOVER — never mention the waitlist offer again. React to what they just said, sell one point that fits their own situation when there is an opening, and draw out what is still missing with tentative guesses phrased as real questions, labels and threading. Never state their business, industry or setup as a fact they have not given you, and never ask a plain intake question. If you still do not have their name and the conversation has warmth, ask for it lightly and naturally ('Sorry — I got ahead of myself. Who am I speaking with?'). If they have no business at all, say so is fine, mark declined and wind down warmly instead of continuing the ladder."
        : !revealed
          ? "REVEAL — you now have their name, business, industry and how they operate, all in their own words. Stop and show them what just happened: no form, and you already know all of it. Credit Convert, not yourself. Do not ask for anything in this turn. Set revealed true."
          : !lanesDone
            ? "LANES — immediately tie Cultivate and Recover to their own situation, one short beat each, then land that it is three lanes in one system. No questions here. Set lanesDone true."
            : !allCaptured
              ? "CONTACT — everything else is known. Get their email as housekeeping tied to their spot confirmation, and offer the phone as skippable. One ask per turn."
              : wrapAsked
                ? "CLOSE — they've answered your wrap question. Answer anything they asked in one sentence, then deliver the exact closing line and set complete true."
                : "WRAP — everything is captured, but do NOT close yet. Tell them they're all set and ask if they have questions or want you to finalise their spot. Keep complete false and set wrapAsked true on the turn where you ask it.";

  const missing = requiredFields.filter((f) => !collected[f]);
  const gate = missing.length
    ? `\n\nStill missing: ${missing.join(", ")}. You may NOT close and complete must stay false until every one of these is captured, even if they ask you to finish now — in that case say you just need the last detail and ask for it.`
    : "";

  const cutOff = wasCutOff
    ? `\n\nYour last line was cut off where marked: they spoke over you and did not hear the rest. Do not repeat it word for word and do not assume they heard it. What they said next comes first.`
    : "";

  return `Current phase: ${phase}\n\nReveal already delivered: ${revealed ? "yes" : "no"}\nLanes already explained: ${lanesDone ? "yes" : "no"}\n\nAlready captured (do not change these unless the person just corrected them):\n${known || "(nothing yet)"}\n\nConversation so far:\n${
    history || "(the conversation is just starting)"
  }${gate}${cutOff}\n\nProduce MARY's next spoken turn as two beats: "say" reacts to them first, "followUp" carries the one next move (or null). Neither beat may repeat anything you already said.\n\nCapturing details: for name, business, industry and operations, set a value ONLY when the person stated it in their own words or clearly said yes to a guess you made, and copy the exact words of theirs that support it into the matching Evidence field (2–12 words, verbatim from a Person line). A guess you offered that they have not answered yet is NOT captured — leave the value and its evidence null and hold the question. Values without matching evidence are discarded. A vague answer ("a shop", "consulting", "a bit of everything") is not an industry — react, then narrow it with one specific question. Never default anyone to real estate or mortgages.\n\nSet "phase" to the phase above, "revealed" to whether the reveal is delivered by the end of this turn, and "lanesDone" to whether both Cultivate and Recover have been explained by the end of this turn.`;
}

/**
 * Turns the raw model object into the turn the client uses: grounded values
 * merged into what was already known, and a close that can only happen once
 * everything required is really there.
 */
export function finishTurn(
  out: TurnObject,
  input: { messages: TurnMessage[]; collected: Record<string, string>; flags: TurnFlags },
): MaryTurn {
  // Anything that is really MARY's own words coming back through the room is
  // never allowed to stand as proof of what the person told her.
  const spokenBefore = (index: number) =>
    input.messages
      .slice(0, index)
      .filter((m) => m.role === "assistant")
      .slice(-4)
      .map((m) => m.content.replace(CUT_OFF_MARK, ""));
  const userMessages = input.messages
    .map((m, i) => {
      if (m.role !== "user") return "";
      const hers = spokenBefore(i);
      const cleaned = stripAssistantEcho(m.content, hers);
      return cleaned && isEchoOfAssistant(cleaned, hers) ? "" : cleaned;
    })
    .filter(Boolean);
  const lastAssistant = [...input.messages]
    .reverse()
    .find((m) => m.role === "assistant")
    ?.content.replace(CUT_OFF_MARK, "");

  const proposed: Record<string, Proposed> = {
    name: { value: out.name, evidence: out.nameEvidence },
    email: { value: out.email, evidence: null },
    phone: { value: out.phone, evidence: null },
    business: { value: out.business, evidence: out.businessEvidence },
    industry: { value: out.industry, evidence: out.industryEvidence },
    operations: { value: out.operations, evidence: out.operationsEvidence },
  };
  const grounded = groundCollected({
    previous: input.collected,
    proposed,
    userMessages,
    lastAssistant,
  });

  const collected: Collected = {};
  for (const field of WAITLIST_FIELDS) {
    const value = grounded.collected[field];
    if (value) collected[field] = value;
  }
  const required = WAITLIST_FIELDS.filter((f) => f !== "phone");
  const allCaptured = required.every((f) => collected[f]);

  return {
    say: out.say.trim(),
    followUp: out.followUp?.trim() ? out.followUp.trim() : null,
    collected,
    nextField: out.nextField,
    complete: out.complete && allCaptured,
    declined: out.declined,
    revealed: input.flags.revealed || out.revealed,
    lanesDone: input.flags.lanesDone || out.lanesDone,
    rejected: grounded.rejected,
  };
}

export function gatewayConfig(key: string) {
  return {
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  };
}
