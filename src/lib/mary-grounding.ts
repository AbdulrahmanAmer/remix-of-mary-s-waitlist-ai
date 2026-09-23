/**
 * Grounding: MARY may only record a detail the person actually gave her.
 *
 * The model returns each captured value together with the person's own words
 * that support it. Before anything is stored, those words are checked against
 * what the person really said. A guess with no words behind it is dropped, so
 * MARY has to keep the conversation going instead of assuming.
 *
 * Pure and dependency-free so it runs on the server and in tests.
 */
import { contentTokens, tokens } from "./voice-logic";

export type Proposed = { value: string | null; evidence: string | null };

const AFFIRMATION_START = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "exactly",
  "correct",
  "right",
  "thats",
  "that's",
  "pretty",
  "close",
  "spot",
  "sure",
  "indeed",
  "bingo",
  "you",
  "true",
  "absolutely",
  "definitely",
  "precisely",
  "mhm",
  "uh-huh",
  "yea",
  "ya",
  "affirmative",
  "totally",
  "basically",
  "more",
]);
const NEGATION = new Set([
  "no",
  "not",
  "nope",
  "nah",
  "but",
  "actually",
  "wrong",
  "isnt",
  "arent",
  "dont",
  "never",
  "rather",
  "instead",
  "except",
  "although",
  "though",
  "however",
  "different",
]);

/** "yeah", "that's right", "pretty much" — a yes with no correction attached. */
export function isAffirmation(text: string): boolean {
  const list = tokens(text);
  if (list.length === 0 || list.length > 7) return false;
  if (!AFFIRMATION_START.has(list[0]!)) return false;
  return !list.some((t) => NEGATION.has(t));
}

/** "Jon" vs "John": one edit apart, which is what speech recognition does to names. */
export function nearWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else if (a.length > b.length) i += 1;
    else j += 1;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function overlap(quote: string, message: string): number {
  const q = tokens(quote);
  if (q.length === 0) return 0;
  const m = new Set(tokens(message));
  let hits = 0;
  for (const t of q) if (m.has(t)) hits += 1;
  return hits / q.length;
}

/** The quote really appears (allowing for recognition slips) in one of the messages. */
export function quoteGrounded(quote: string | null, messages: string[]): boolean {
  if (!quote) return false;
  const q = tokens(quote);
  if (q.length === 0) return false;
  const needed = q.length <= 2 ? 1 : 0.7;
  return messages.some((m) => overlap(quote, m) >= needed);
}

/** MARY's last line actually contained this value, so a plain "yes" confirms it. */
export function assistantOffered(value: string, lastAssistant: string | undefined): boolean {
  if (!lastAssistant) return false;
  const v = tokens(value);
  const content = contentTokens(v);
  const a = new Set(tokens(lastAssistant));
  if (content.length === 0) return v.length > 0 && v.every((t) => a.has(t));
  let hits = 0;
  for (const t of content) if (a.has(t)) hits += 1;
  return hits / content.length >= 0.5;
}

// Words that point at real estate and finance, the fields MARY is most tempted
// to default to. If she names one and the person never came near it, she assumed.
const VERTICAL_VALUE = [
  "real",
  "estate",
  "realtor",
  "realty",
  "brokerage",
  "broker",
  "mortgage",
  "mortgages",
  "lending",
  "lender",
  "loan",
  "loans",
  "listings",
  "financial",
  "finance",
  "insurance",
  "wealth",
  "advisor",
  "advisory",
  "bank",
  "banking",
  "credit",
  "investment",
  "investments",
];
const VERTICAL_HINTS = new Set([
  ...VERTICAL_VALUE,
  "house",
  "houses",
  "home",
  "homes",
  "property",
  "properties",
  "listing",
  "buyers",
  "sellers",
  "agent",
  "agents",
  "refinance",
  "refi",
  "escrow",
  "closing",
  "closings",
  "rentals",
  "landlord",
  "tenants",
  "commercial",
  "residential",
  "underwriting",
  "fha",
  "rates",
  "premiums",
  "policies",
  "policy",
  "portfolio",
  "clients",
  "showings",
  "showing",
  "sold",
  "selling",
  "buying",
  "invest",
  "investing",
  "realtors",
  "estates",
  "leasing",
  "lease",
]);

function assumesVertical(
  value: string,
  userText: string,
  lastAssistant?: string,
  lastUser?: string,
) {
  const v = tokens(value);
  if (!v.some((t) => VERTICAL_VALUE.includes(t))) return false;
  const u = new Set(tokens(userText));
  for (const hint of VERTICAL_HINTS) if (u.has(hint)) return false;
  // The person may have said a plain "yes" to her naming it.
  if (lastUser && isAffirmation(lastUser) && assistantOffered(value, lastAssistant)) return false;
  return true;
}

function squash(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+(dash|hyphen)\s+/g, "-")
    .replace(/[\s,]+/g, "");
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  double: "",
  triple: "",
};
function digitsOf(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => NUMBER_WORDS[w.replace(/[^a-z]/g, "")] ?? w.replace(/\D/g, ""))
    .join("");
}

export type GroundingResult = {
  collected: Record<string, string>;
  rejected: string[];
};

/**
 * Merges the model's proposed values into what is already known, keeping only
 * the ones the person's own words support. Known values only change when the
 * person's latest message is what changed them.
 */
export function groundCollected(params: {
  previous: Record<string, string>;
  proposed: Record<string, Proposed>;
  userMessages: string[];
  lastAssistant?: string | undefined;
}): GroundingResult {
  const { previous, proposed, userMessages, lastAssistant } = params;
  const collected: Record<string, string> = { ...previous };
  const rejected: string[] = [];
  const allUser = userMessages.join("\n");
  const lastUser = userMessages[userMessages.length - 1] ?? "";
  const affirmed = isAffirmation(lastUser);

  for (const [field, { value: rawValue, evidence }] of Object.entries(proposed)) {
    const value = rawValue?.trim() ?? "";
    if (!value) continue;
    const existing = previous[field];
    const isChange = Boolean(existing) && existing!.toLowerCase() !== value.toLowerCase();
    // A change must come from what they just said; a first capture can come from anywhere.
    const scope = isChange ? [lastUser] : userMessages;
    const scopeText = isChange ? lastUser : allUser;

    let ok = false;
    switch (field) {
      case "name": {
        // A name only counts when they said it themselves (allowing for a
        // recognition slip of a letter or two) or clearly confirmed her guess.
        const heard = tokens(scopeText);
        const spoken = tokens(value).some(
          (t) => t.length >= 2 && heard.some((h) => h === t || nearWord(h, t)),
        );
        // If she quoted them, the quote itself must be real and must not be a
        // bare "yeah" standing in for words they never said.
        const evidenceOk = evidence
          ? quoteGrounded(evidence, scope) && !isAffirmation(evidence)
          : true;
        ok = spoken && evidenceOk;
        if (!ok && affirmed && !/^(close|pretty|more|basically)\b/i.test(lastUser.trim()))
          ok = assistantOffered(value, lastAssistant);
        break;
      }
      case "email": {
        const squashed = squash(scopeText);
        const v = value.toLowerCase();
        const local = v.split("@")[0] ?? "";
        ok = squashed.includes(v) || (local.length >= 2 && squashed.includes(local));
        if (!ok && affirmed) ok = assistantOffered(value, lastAssistant);
        break;
      }
      case "phone": {
        const vDigits = value.replace(/\D/g, "");
        if (vDigits.length >= 5) {
          const uDigits = digitsOf(scopeText);
          ok = uDigits.includes(vDigits.slice(-4)) && uDigits.includes(vDigits.slice(0, 3));
          if (!ok && affirmed) ok = assistantOffered(value, lastAssistant);
        } else {
          // "skipped" / "email only" — only when they actually waved it off,
          // or said yes to her own offer to leave the phone out.
          const offeredSkip =
            /\b(skip|without|email('s| is)? (fine|enough|okay|ok)|just email|no phone|rather not|leave (it|the phone|the number) out)\b/i.test(
              lastAssistant ?? "",
            );
          ok = /skip|declin|none|no phone|email only|not needed|prefer not/i.test(value)
            ? /\b(skip|no|nah|just email|email('s| is)? fine|don'?t|rather not|pass|leave it|without)\b/i.test(
                lastUser,
              ) ||
              (offeredSkip && isAffirmation(lastUser))
            : false;
        }
        break;
      }
      default: {
        // business, industry, operations — the person's words must carry it.
        const evidenceOk = quoteGrounded(evidence, scope) && !isAffirmation(evidence ?? "");
        const affirmedOk = affirmed && assistantOffered(value, lastAssistant);
        ok = evidenceOk || affirmedOk;
        if (ok && (field === "business" || field === "industry")) {
          if (assumesVertical(value, allUser, lastAssistant, lastUser)) ok = false;
        }
      }
    }

    if (ok) collected[field] = value;
    else {
      rejected.push(field);
      if (!existing) delete collected[field];
    }
  }

  return { collected, rejected };
}
