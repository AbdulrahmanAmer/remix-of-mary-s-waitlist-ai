import { isInAppBrowser, MicUnavailableError, type MicFailure } from "@/lib/audio-engine";
import { WAITLIST_FIELDS, type Collected, type MaryTurn } from "@/lib/mary.functions";
import { CUT_OFF_MARK } from "@/lib/voice-logic";

import type { ConversationOutcome, Line } from "./types";

export function uid(): string {
  return Math.random().toString(36).slice(2);
}

/** The conversation as the model should see it; cut-off lines say so. */
export function toMessages(lines: Line[]) {
  return lines.map((line) => ({
    role: line.role === "mary" ? ("assistant" as const) : ("user" as const),
    content: line.role === "mary" && line.interrupted ? `${line.text} ${CUT_OFF_MARK}` : line.text,
  }));
}

export function transcriptOf(lines: Line[]): string {
  return lines
    .map(
      (line) =>
        `${line.role === "mary" ? "MARY" : "Guest"}: ${line.text}${line.interrupted ? " …" : ""}`,
    )
    .join("\n");
}

export function fieldsKey(collected: Collected): string {
  return WAITLIST_FIELDS.map((field) => collected[field] ?? "").join("\u0001");
}

/** Word-overlap check: catches MARY re-saying a line she already delivered. */
export function isNearRepeat(previous: string, next: string): boolean {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(Boolean),
    );
  const a = words(previous);
  const b = words(next);
  if (!a.size || !b.size) return false;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.min(a.size, b.size) >= 0.8;
}

/** How the conversation ends after this turn, if it ends here. */
export function endingFor(
  turn: Pick<MaryTurn, "complete" | "declined" | "callbackRequested" | "collected">,
): ConversationOutcome | null {
  if (turn.callbackRequested && turn.collected.name && turn.collected.phone) return "callback";
  if (turn.complete && WAITLIST_FIELDS.filter((f) => f !== "phone").every((f) => turn.collected[f]))
    return "signed_up";
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
  switch (reason) {
    case "denied":
      return "I couldn't get the microphone. Tap the mic button to ask again, allow it, or just type — I'm reading either way.";
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

/** Only when she cannot hear you (muted mic, no microphone) and nothing is happening. */
export const IDLE_NUDGES = [
  "Whenever you're ready — you can talk to me or type it out.",
  "I'm still here. Say the word, or type it if that's easier.",
  "No rush at all — I'll be right here when you want to pick it back up.",
];
