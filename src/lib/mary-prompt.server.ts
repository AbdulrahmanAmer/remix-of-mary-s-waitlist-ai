import { z } from "zod";
// MARY's personality and behaviour live in one document; the app reads it
// directly, so the spec and her actual behaviour can never drift apart.
import MARY_VOICE_SPEC from "../../docs/mary-voice.md?raw";
import { groundCollected, readsBackEmail, type Proposed } from "./mary-grounding";
import { CUT_OFF_MARK, isEchoOfAssistant, stripAssistantEcho } from "./voice-logic";
import {
  NO_BUSINESS,
  OPENERS,
  spotSecured,
  type Collected,
  type MaryTurn,
  type TurnFlags,
} from "./mary.functions";

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
    "SPOT",
    "EMAIL",
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
  introDone: z.boolean(),
});

export type TurnObject = z.infer<typeof TurnSchema>;

export type TurnMessage = { role: "user" | "assistant"; content: string };

const first = (name: string | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The one line that ends a sign-up; the end screen says the same. */
export function closingLine(name: string | undefined): string {
  const who = first(name);
  return `You're on the list${who ? `, ${who}` : ""} — your invite goes to that email the moment early access opens.`;
}

/** The wrap question — the only permission question she is allowed. */
export const WRAP_QUESTION = "Anything you want to ask before I lock it in?";
/** The one confirmation question she is allowed, after reading an email back. */
export const EMAIL_CHECK_QUESTION = "Did I get that right?";
/** A line of hers that offered the phone — never "who picks up the phone?" */
const PHONE_OFFERED =
  /\b(add a number|a number|your number|number'?s optional|best number|phone number|leave it at email|just email)\b/i;

/**
 * What the conversation has actually established, worked out from the record
 * rather than trusted from the model: the same history can only ever produce
 * the same phase, whichever turn or client it came from.
 */
export function readState(
  messages: TurnMessage[],
  collected: Record<string, string>,
  flags: TurnFlags,
) {
  const said = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.replace(CUT_OFF_MARK, "").trim());
  const known: Collected = {};
  for (const field of WAITLIST_FIELDS) if (collected[field]) known[field] = collected[field];

  const email = (known.email ?? "").trim();
  const noBusiness = (known.business ?? "").trim().toLowerCase() === NO_BUSINESS;
  // An address is only relied on once she has read it back and they have
  // answered: the transcriber, not the person, is what gets emails wrong.
  const emailReadBack = Boolean(email) && said.some((line) => readsBackEmail(line, email));
  const revealAt = said.findIndex((line) => /\bconvert\b/i.test(line));
  // A lanes beat she was cut off in is not replayed: whatever they heard of it counts.
  const lanesAttempted =
    revealAt >= 0 && said.slice(revealAt + 1).some((line) => /\b(cultivate|recover)\b/i.test(line));

  return {
    known,
    spot: spotSecured(known),
    noBusiness,
    rushed: flags.mode === "rushed",
    discoveryDone: Boolean(
      known.name && known.business && !noBusiness && known.industry && known.operations,
    ),
    emailChecked: !email || emailReadBack,
    phoneOffered: Boolean(known.phone) || said.some((line) => PHONE_OFFERED.test(line)),
    revealed: flags.revealed,
    lanesDone: flags.lanesDone || lanesAttempted,
    wrapAsked: Boolean(flags.wrapAsked) || said.some((line) => /\block it in\b/i.test(line)),
    introDone: Boolean(flags.introDone),
    callback: Boolean(flags.callback),
  };
}

export function buildPrompt(
  messages: TurnMessage[],
  collected: Record<string, string>,
  flags: TurnFlags,
  /** Field notes she wrote after earlier conversations — see mary-experience.server. */
  experience = "",
  /** Which fixed opener the welcome uses; random unless a caller pins it. */
  opener = Math.floor(Math.random() * OPENERS.length),
) {
  const opening = OPENERS[Math.abs(opener) % OPENERS.length]!;
  const history = messages
    .map((m) => `${m.role === "user" ? "Person" : "MARY"}: ${m.content}`)
    .join("\n");

  const state = readState(messages, collected, flags);
  const { known } = state;
  const knownLines = Object.entries(known)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
  const wasCutOff = Boolean(lastAssistant && lastAssistant.includes(CUT_OFF_MARK));
  const who = first(known.name);
  const fast = state.rushed || state.noBusiness;

  const emailAsk = known.name
    ? `"Quickest way to hold your spot, ${who}, is your email — what is it?"`
    : `"Quickest way to hold your spot is your email — what is it?"`;
  const phoneOffer = `"Number's optional — want to add one, or leave it at email?"`;
  const nextHousekeeping = !known.email
    ? `the email, tied to the spot: ${emailAsk}`
    : !state.phoneOffered
      ? `the phone, once and skippable: ${phoneOffer}`
      : `the wrap question, exactly: "${WRAP_QUESTION}" — and set wrapAsked true`;

  const callbackHasBoth = Boolean(known.name && known.phone);
  const phase = state.callback
    ? callbackHasBoth
      ? 'CALLBACK, FINAL TURN — you now have their name and a number. Do not ask for anything else. "say" confirms plainly, using their name, that you have their name and number down for a callback and the team takes it from here — no day, no time window, and never that it has already reached anyone. "followUp" is a short warm goodbye, or null. Set callbackRequested true and phase CALLBACK. Nothing after this.'
      : "CALLBACK — they asked to be called back. The sales sequence is over: do not pitch, do not run discovery. You need only their name and a number, one ask per turn, skipping anything you already have. Promise nothing about timing — say you'll note it for the team. Set callbackRequested true every turn from here. If they give you both in one message, confirm and say goodbye in that same turn."
    : !state.introDone
      ? !history
        ? `WELCOME — the very first thing you say, word for word. "say" is exactly: ${JSON.stringify(opening.say)} and "followUp" is exactly: ${JSON.stringify(opening.followUp)}. Nothing else. Set introDone true.`
        : 'WELCOME, RESUMED — your introduction was cut off before they heard all of it. "say" reacts to what they just said first, warmly and briefly — never ignore it — then folds in whatever they have not heard yet (you are MARY, you look after early access to OmniSuite, Omnikom\'s revenue engine, and two minutes with you puts them on the list), without restarting from the top or repeating wording they already heard. "followUp" is exactly one thing: asking what you should call them, woven in naturally. Set introDone true only once who you are, what OmniSuite is and what they get have all actually been said by the end of this turn.'
      : !state.emailChecked
        ? `EMAIL — they gave you an address by voice and you have not read it back yet. "say" reacts in a word, then reads the address back in chunks, spelling any part that isn't an ordinary word letter by letter ("d-a-n-a-k, at gmail dot com"). "followUp" is exactly: "${EMAIL_CHECK_QUESTION}" Nothing else this turn; if they also asked something, answer it first in one sentence. Keep complete false.`
        : fast
          ? !known.email
            ? `SPOT — ${state.noBusiness ? "they have no business of their own, which is fine: no discovery, no pitch." : "they are in a hurry: no discovery, no pitch."} Hold their spot with the least asking: the email, once, tied to the spot — ${emailAsk} ${known.name ? "" : 'If you still have no name, get the email first and the name next turn ("And who do I put it under?"). '}One ask per turn. If they refuse the email or want to go, let them go warmly in one line: set declined true, phase EXIT.`
            : !known.name
              ? 'SPOT — the email is in; you only need a name to put it under. "say" reacts, "followUp" is one light ask: "And who do I put it under?" Nothing else.'
              : `CLOSE — the last turn. "say" is one sentence: answer whatever they just asked, or a short personal send-off using their name. "followUp" is exactly: ${JSON.stringify(closingLine(known.name))} Set complete true. Nothing after it. If instead they asked for a callback, corrected something, or want to change the email, honour that first and keep complete false.`
          : !state.discoveryDone
            ? `DISCOVER — you have their name${known.email ? " and email" : ""}. Find out, in conversation, what the business is, what field it is in and what happens to a lead today (section 4 of your playbook): react to what they said, sell one point when there is an opening, then one calibrated guess or one plain question. Never state a business, industry or setup they have not given you, and never a plain intake question. If their last message supplies the last missing detail, do not ask for it again: reveal in this turn. ${known.email ? "" : "If they seem ready to go, are short with you, or ask you to just sign them up: hold the spot first — the email, tied to it — and set mode rushed. "}If they have no business at all (a student, someone job-hunting, just curious): say that's fine, record business as "${NO_BUSINESS}" with their words as evidence, and go straight to holding their spot with their email. If they clearly want to go and you have no email, ask for it once, tied to the spot, then let them go whatever they answer.`
            : !state.revealed
              ? `REVEAL — you now have their name, business, industry and how they operate, all in their own words. "say" is the reveal: show them what just happened — no form, and you already know all of it from this conversation; credit Convert by name, exactly once. "followUp" ties the spot to it: ${
                  !known.email
                    ? `"That's the whole sign-up, by the way — where should your invite go?"`
                    : !state.phoneOffered
                      ? `the phone, once and skippable: ${phoneOffer}`
                      : "null — let it land; this is the one turn allowed to end on a statement."
                } Set revealed true.`
              : !state.lanesDone
                ? `LANES — tie Cultivate and Recover to their own situation, one short beat each, naming both words, and land it: three loops in one engine deciding the next move for every opportunity, with their own people stepping in when it matters. Do not offer to explain later and do not ask which one they want. "followUp" is ${nextHousekeeping}. Set lanesDone true. Up to 35 words this turn.`
                : !known.email
                  ? `CONTACT — everything else is known. "say" reacts; "followUp" is ${emailAsk} Plainly, once.`
                  : !state.phoneOffered
                    ? `CONTACT — the spot is secured. "say" reacts; "followUp" offers ${phoneOffer} Once, and whatever they answer is final.`
                    : !state.wrapAsked
                      ? `WRAP — everything is in, but do NOT close yet. "say" is a one-line recap in your own words: their name, the business, and that the invite goes to ${known.email} (say the address once, plainly, no spelling). "followUp" is exactly: "${WRAP_QUESTION}" Keep complete false and set wrapAsked true.`
                      : `CLOSE — they've answered your wrap question. "say" is one sentence: answer whatever they asked, or a short personal send-off using their name ("Perfect, ${who || "Leo"} — you're in."). "followUp" is exactly: ${JSON.stringify(closingLine(known.name))} Set complete true. Nothing after it. If instead they asked for a callback, corrected something, or want to change the email, honour that first and keep complete false.`;

  const gate = !state.spot
    ? `\n\nThe spot needs a name and an email; you have ${
        known.name ? "the name" : known.email ? "the email" : "neither yet"
      }. You may NOT close and complete must stay false until both are in. Everything else — business, industry, operations, phone — is what makes the conversation worth having, never a condition for the spot.`
    : "\n\nName and email are in: their spot stands whatever else happens. If they want to go, close warmly now with complete true — never send someone away without their spot.";

  const cutOff = wasCutOff
    ? `\n\nYour last line was cut off where marked: they spoke over you and did not hear the rest. Do not repeat it word for word and do not assume they heard it. What they said next comes first.`
    : "";

  const rejectedNote = flags.rejected?.length
    ? `\n\nLast turn you recorded ${flags.rejected.join(", ")} without their words behind it, so it was discarded. Do not assert it.${
        flags.rejected.includes("email")
          ? " The address did not come through clearly: ask them to say it once more, slowly, or to type it in the box on screen."
          : " Ask about it plainly, or let them volunteer it."
      }`
    : "";

  const modeNote =
    flags.mode && flags.mode !== "neutral"
      ? `\n\nThey are coming across as ${flags.mode}. Match that: ${
          flags.mode === "rushed"
            ? "one short beat, get to the point, no build-up — and keep mode rushed unless they clearly settle in and start talking shop."
            : flags.mode === "skeptical"
              ? "no hype, concrete specifics, invite the pushback."
              : flags.mode === "guarded"
                ? "ask for less, explain why before you ask anything."
                : "stay warm but keep moving."
        }`
      : "";

  const intentRule = `\n\nRead their last message first and set "intent" to what it was doing. Intent outranks the phase: if they asked a question, answer it in full before anything else; if they corrected you, accept the correction without defending; if they objected, address the objection itself; if they said hello, greet back; if they asked to be called back instead, set callbackRequested true and switch to taking a name and a number only. If they say they are in a hurry or ask you to just put them on the list, set mode rushed: the email tied to the spot comes next, nothing else. If they want off the call: with name and email in hand, close now (the CLOSE shape, complete true); without the email, ask for it once, tied to the spot, and if they still want to go, let them go warmly with declined true. Never force the next funnel step onto a turn that changed the subject — but handling their point does not mean stopping there: after you have dealt with it, still end the turn on a move of your own. Also set "mode" to how they are showing up and "wrapAsked" to whether this turn asks the final wrap question.`;

  // The failure this fixes: turns that stop on a statement, or hand the wheel
  // back with a menu question, so the conversation goes nowhere.
  const driveRule = `\n\nYou drive this conversation. Unless the phase above is CLOSE, EXIT, the final callback turn, or a REVEAL with nothing left to ask, every turn must END on one concrete move — a question that comes out of their own last words, or a specific next step you are taking. Never end on a bare statement, an "okay", or a line that only summarises. Never ask permission questions or offer menus ("would you rather…", "shall I explain…", "want me to go on?", "does that make sense?") — decide, say the thing, then ask the question that gets you the next piece. Two questions are allowed as written: the wrap question, and "${EMAIL_CHECK_QUESTION}" after reading an email back. If they give you a flat answer ("okay", "sure", "hmm"), do not mirror it back: take the conversation somewhere with a specific, concrete question about their operation.`;

  const honesty = `\n\nSay only what is true about what happens next. Nothing here sends a confirmation email, and you cannot see the team: their spot is held and the invite goes to that email when early access opens; a callback request is noted for the team. Never promise a confirmation email, a day, a time, or that anyone already has it.`;

  return `Current phase: ${phase}\n\nReveal already delivered: ${state.revealed ? "yes" : "no"}\nLanes already explained: ${state.lanesDone ? "yes" : "no"}\n\nAlready captured (do not change these unless the person just corrected them):\n${knownLines || "(nothing yet)"}\n\nConversation so far:\n${
    history || "(the conversation is just starting)"
  }${gate}${cutOff}${rejectedNote}${modeNote}${intentRule}${driveRule}${honesty}${experience}\n\nProduce MARY's next spoken turn as two beats: "say" reacts to them first, "followUp" carries the one next move — a real question or a specific step — and it is null only on a closing, exit or final callback turn, or a reveal with nothing left to ask. Neither beat may repeat anything you already said. Hard limit: 25 words for the whole turn, both beats together (LANES may use 35).\n\nCapturing details: for name, business, industry and operations, set a value ONLY when the person stated it in their own words or clearly said yes to a guess you made, and copy the exact words of theirs that support it into the matching Evidence field (2–12 words, verbatim from a Person line). A guess you offered that they have not answered yet is NOT captured — leave the value and its evidence null and hold the question. Values their words do not carry are discarded. A vague answer ("a shop", "a small practice", "consulting", "a bit of everything") is not an industry — react, then narrow it with one specific question. Never default anyone to real estate or mortgages. Someone with no business at all is welcome: business "${NO_BUSINESS}", evidence their words, industry and operations left null. The turn an email arrives in, whatever the phase says: "say" reads it back in chunks and spells any part that isn't an ordinary word ("d-a-n-a-k, at gmail dot com"), and "followUp" is exactly "${EMAIL_CHECK_QUESTION}" — the one confirmation question you are allowed; the phase's own next move waits until they have said it is right. An address that arrived typed, with an @ sign, is read back plainly, no spelling. Phone is always optional: offer it once, and record "skipped" only when they wave it off.\n\nSet "phase" to the phase above, "introDone" to whether your introduction has been fully said by the end of this turn, "revealed" to whether the reveal is delivered by the end of this turn, and "lanesDone" to whether both Cultivate and Recover have been explained by the end of this turn.`;
}

/**
 * Turns the raw model object into the turn the client uses: grounded values
 * merged into what was already known, and a close that can only happen once
 * the spot is really secured — a name and an email.
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
  const spot = spotSecured(collected);

  const callbackRequested = Boolean(input.flags.callback) || out.callbackRequested;
  // A decline only ends the conversation when the model is unambiguous about
  // it: they are leaving or refusing, or she has moved to the EXIT phase. A
  // stray flag on an ordinary answer must never hang up on someone.
  const wantsOut =
    out.declined &&
    !callbackRequested &&
    (out.phase === "EXIT" || out.intent === "leaving" || out.intent === "refusing");
  // Name and email in hand means the spot stands: someone who just wants to go
  // leaves with it, and only an outright refusal gives it up.
  const leavesWithSpot = wantsOut && spot && out.intent !== "refusing";
  const declined = wantsOut && !leavesWithSpot;

  return {
    say: out.say.trim(),
    followUp: out.followUp?.trim() ? out.followUp.trim() : null,
    collected,
    nextField: out.nextField,
    // A callback conversation never "completes" the waitlist sign-up, and a
    // sign-up is only complete once the spot is secured.
    complete: !callbackRequested && spot && (out.complete || leavesWithSpot),
    declined,
    callbackRequested,
    intent: out.intent,
    mode: out.mode,
    wrapAsked: Boolean(input.flags.wrapAsked) || out.wrapAsked,
    revealed: input.flags.revealed || out.revealed,
    lanesDone: input.flags.lanesDone || out.lanesDone,
    introDone: Boolean(input.flags.introDone) || out.introDone,
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
