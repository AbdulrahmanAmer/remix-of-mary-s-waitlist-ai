import { isInAppBrowser, MicUnavailableError, type MicFailure } from "@/lib/audio-engine";
import { spotSecured, WAITLIST_FIELDS, type Collected, type MaryTurn } from "@/lib/mary.functions";
import { CUT_OFF_MARK } from "@/lib/voice-logic";

import type { ConversationOutcome, Line } from "./types";

export function uid(): string {
  return Math.random().toString(36).slice(2);
}

/** The conversation as the model should see it; cut-off lines say so, asides are not part of it. */
export function toMessages(lines: Line[]) {
  return lines
    .filter((line) => !line.aside)
    .map((line) => ({
      role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
      content:
        line.role === "mary" && line.interrupted ? `${line.text} ${CUT_OFF_MARK}` : line.text,
    }));
}

/** Her real lines so far, for the repeat check: asides were never her turn. */
export function spokenLines(lines: Line[]): string[] {
  return lines.filter((line) => line.role === "mary" && !line.aside).map((line) => line.text);
}

export function transcriptOf(lines: Line[]): string {
  return lines
    .map(
      (line) =>
        `${line.role === "mary" ? "MARY" : "Guest"}: ${line.text}${line.interrupted ? " …" : ""}`,
    )
    .join("\n");
}

/** An address the person typed or said before her line went down, so the form starts filled. */
export function emailFromLines(lines: Line[]): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.role !== "user") continue;
    const match = line.text.match(/[^\s@,;:"'<>()]+@[^\s@,;:"'<>()]+\.[a-z]{2,}/i);
    if (match) return match[0].toLowerCase();
  }
  return "";
}

export function fieldsKey(collected: Collected): string {
  return WAITLIST_FIELDS.map((field) => collected[field] ?? "").join("\u0001");
}

/** Below this many words, only the identical line counts as a repeat ("Got it." is not one). */
const REPEAT_MIN_WORDS = 6;

/** Word-overlap check: catches MARY re-saying a line she already delivered. */
export function isNearRepeat(previous: string, next: string): boolean {
  const normalise = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);
  const wordsA = normalise(previous);
  const wordsB = normalise(next);
  if (!wordsA.length || !wordsB.length) return false;
  // Short reactions share their few words with half of what she says; those only
  // repeat when they are the same line.
  if (Math.min(wordsA.length, wordsB.length) < REPEAT_MIN_WORDS)
    return wordsA.join(" ") === wordsB.join(" ");
  const a = new Set(wordsA);
  const b = new Set(wordsB);
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.min(a.size, b.size) >= 0.8;
}

/** How the conversation ends after this turn, if it ends here. */
export function endingFor(
  turn: Pick<MaryTurn, "complete" | "declined" | "callbackRequested" | "collected">,
): ConversationOutcome | null {
  if (turn.callbackRequested && turn.collected.name && turn.collected.phone) return "callback";
  // The server sets complete only once name and email secure the spot.
  if (turn.complete && spotSecured(turn.collected)) return "signed_up";
  if (turn.declined) return "declined";
  return null;
}

/** Copy for the end screen — personal, definite, and honest about what happens next. */
export function closingCopy(outcome: ConversationOutcome, firstName: string, phone: string) {
  const who = firstName ? `, ${firstName}` : "";
  switch (outcome) {
    case "callback":
      return {
        eyebrow: "Callback requested",
        title: `We'll call you back${who}.`,
        body: `Your request is with the Omnikom team${phone ? ` — they'll reach you on ${phone}` : ""}. Nothing else to fill in.`,
        steps: [
          "The team receives your request straight away",
          phone ? `A real person calls you on ${phone}` : "A real person gets in touch",
          "Everything you told MARY travels with it, so nobody asks twice",
        ],
      };
    case "declined":
      return {
        eyebrow: "No pressure",
        title: `Thanks for the chat${who}.`,
        body: "No spot reserved, and that's completely fine. If OmniSuite becomes relevant later, MARY will be right here.",
        steps: [] as string[],
      };
    default:
      return {
        eyebrow: "Early access confirmed",
        title: `You're on the list${who}.`,
        body: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom.",
        steps: [
          "You hear from us first, the moment early access opens",
          "Invitations go out in order of position",
          "MARY already knows your setup — no forms later",
        ],
      };
  }
}

/** Plain words for every way a microphone can fail to open. */
export function micMessage(error: unknown): string {
  const reason: MicFailure = error instanceof MicUnavailableError ? error.reason : "unknown";
  // Inside Instagram, LinkedIn or WhatsApp the only real fix is opening the link properly.
  if (isInAppBrowser() && (reason === "denied" || reason === "unsupported")) {
    return "This is an in-app browser, so it won't hand me the microphone. Tap the ⋯ menu and choose “Open in browser” for voice — or just type here.";
  }
  // Every one of these is shown next to a mic button: a failed microphone moves the
  // call to typing, where that button is the way to ask again.
  switch (reason) {
    case "denied":
      return "I couldn't get the microphone. Allow it for this site in your browser settings, then tap the mic button — or just type, I'm reading either way.";
    case "no-device":
      return "I can't find a microphone on this device. Typing works perfectly.";
    case "busy":
      return "Another app is using your microphone. Close it, then tap the mic button to try again — or keep going by typing.";
    case "insecure":
      return "This page needs a secure (https) address to use the microphone. You can still type to me.";
    case "unsupported":
      return "This browser won't let me listen — Safari, Chrome or Edge will. Typing works here.";
    default:
      return "I couldn't open the microphone. Tap the mic button to try again, or keep going by typing.";
  }
}

/** The line dropped mid-call — say what happened and how to get it back. */
export function micLostMessage(reason: MicFailure): string {
  if (reason === "busy")
    return "Something else took the microphone. Tap the mic button to pick the line back up, or carry on by typing.";
  return "The microphone disconnected — a headset unplugged, maybe. Tap the mic button to reopen the line, or keep typing.";
}

export const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  business: "Business",
  industry: "Industry",
  operations: "Operations",
};

/** When she cannot hear you (muted mic, no microphone) and nothing is happening. */
export const IDLE_NUDGES = [
  "Whenever you're ready — I'm reading, so type away, or turn the mic on.",
  "I'm still here. Type it whenever suits you.",
];

/** The line is open but nobody has spoken for a while. */
export const SILENCE_NUDGES = {
  hold: [
    "Still with me? No rush — hold the button when you're ready, or type it below.",
    "I'll hold your spot as long as you like. Hold the button, or type, whenever you're back.",
  ],
  "hands-free": [
    "Still with me? No rush.",
    "I'll hold your spot as long as you like — just say the word when you're back.",
  ],
} as const;

/** Milliseconds of nothing before the first check-in, by whether she can hear the room. */
export const SILENCE_NUDGE_MS = { canHear: 45000, cannotHear: 22000 } as const;
/** Milliseconds of nothing after which the call lets go, releasing the microphone and the screen. */
export const SILENCE_END_MS = 180000;

/** One turn went wrong: the same apology twice in a row would sound like a loop. */
export const SNAG_LINES = [
  "I hit a snag on my side — could you try that once more?",
  "Sorry, that one didn't get through to me. Once more?",
] as const;

/** Her reply never made it: the runner stops asking for repeats after this many failures in a row. */
export const FALLBACK_AFTER_FAILURES = 2;
/** What she says as the call gives way to the form. */
export const FALLBACK_LINE =
  "I can't reach my team right now, so I'll stop wasting your time. Leave your details below and a real person will follow up.";
export const OFFLINE_LINE = "You look offline — I'll pick this up the moment you're back.";
export const TRANSCRIBE_FAILED_LINE =
  "I couldn't process that just now — hold the button and say it again, or type it below.";
