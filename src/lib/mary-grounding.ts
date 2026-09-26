/**
 * Grounding: MARY may only record a detail the person actually gave her.
 *
 * The model returns each captured value together with the person's own words
 * that support it. Before anything is stored, those words are checked against
 * what the person really said — and the value itself has to follow from them:
 * a real quote ("I run a small practice") never licenses a guess ("dental").
 * A value with no words behind it is dropped, so MARY has to keep the
 * conversation going instead of assuming.
 *
 * Pure and dependency-free so it runs on the server and in tests.
 */
import { contentTokens, tokens } from "./voice-logic";

export type Proposed = { value: string | null; evidence: string | null };

/**
 * Recorded as the business when the person has none — a student, someone
 * job-hunting, just curious. They still get their spot; industry and
 * operations stay empty.
 */
export const NO_BUSINESS = "none";

/** Words that only ever mean yes. */
const STRONG_YES = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "yea",
  "ya",
  "exactly",
  "correct",
  "indeed",
  "bingo",
  "true",
  "absolutely",
  "definitely",
  "precisely",
  "affirmative",
  "totally",
  "mhm",
  "uh-huh",
]);
/**
 * Starters that open a yes ("pretty much", "spot on") but just as often a
 * whole answer of their own ("Right, we're a law firm", "You know, we mostly
 * do cars"). They count as a yes only when nothing much follows them.
 */
const SOFT_YES = new Set([
  "right",
  "thats",
  "youre",
  "pretty",
  "close",
  "spot",
  "sure",
  "you",
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

/** "yeah", "that's right", "pretty much" — a yes with no correction or answer attached. */
export function isAffirmation(text: string): boolean {
  const list = tokens(text);
  if (list.length === 0 || list.length > 7) return false;
  if (list.some((t) => NEGATION.has(t))) return false;
  const first = list[0]!;
  if (STRONG_YES.has(first)) return true;
  if (!SOFT_YES.has(first)) return false;
  // "pretty much", "close enough", "you got it": a soft yes carries no answer of its own.
  return contentTokens(list).length <= 2;
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

/**
 * Words a person uses that point at an industry MARY may name differently:
 * "we do cars" supports "automotive", "we're a law firm" supports "legal".
 * Deliberately no vague words — "practice", "shop", "firm" — those get a
 * narrowing question, not a record.
 */
const INDUSTRY_WORDS: Record<string, readonly string[]> = {
  automotive: [
    "auto",
    "car",
    "cars",
    "dealer",
    "dealers",
    "dealership",
    "dealerships",
    "vehicle",
    "vehicles",
    "trucks",
    "motors",
  ],
  auto: ["car", "cars", "dealer", "dealership", "vehicle", "vehicles", "automotive"],
  dental: [
    "dentist",
    "dentists",
    "dentistry",
    "teeth",
    "tooth",
    "orthodontist",
    "orthodontics",
    "hygienist",
    "hygienists",
  ],
  hvac: ["heating", "cooling", "furnace", "furnaces", "air", "conditioning", "ducts", "ductwork"],
  "real estate": [
    "realtor",
    "realtors",
    "realty",
    "listings",
    "listing",
    "homes",
    "houses",
    "property",
    "properties",
    "brokerage",
    "buyers",
    "sellers",
  ],
  staffing: [
    "recruiting",
    "recruiter",
    "recruiters",
    "recruitment",
    "placements",
    "placement",
    "temp",
    "temps",
    "hiring",
    "candidates",
    "staff",
  ],
  recruiting: [
    "staffing",
    "recruiter",
    "recruiters",
    "placements",
    "placement",
    "candidates",
    "hiring",
  ],
  legal: [
    "law",
    "lawyer",
    "lawyers",
    "attorney",
    "attorneys",
    "solicitor",
    "solicitors",
    "paralegal",
  ],
  law: ["legal", "lawyer", "lawyers", "attorney", "attorneys"],
  insurance: ["insurer", "insurers", "policies", "policy", "premiums", "claims", "coverage"],
  mortgage: ["mortgages", "lender", "lenders", "lending", "loans", "loan", "refinance", "refi"],
  lending: ["lender", "lenders", "loans", "loan", "mortgage", "mortgages"],
  finance: [
    "financial",
    "advisor",
    "advisors",
    "advisory",
    "wealth",
    "investment",
    "investments",
    "bank",
    "banking",
    "credit",
  ],
  financial: [
    "finance",
    "advisor",
    "advisors",
    "advisory",
    "wealth",
    "investment",
    "investments",
    "bank",
    "banking",
  ],
  roofing: ["roof", "roofs", "roofer", "roofers"],
  plumbing: ["plumber", "plumbers", "pipes", "drains"],
  electrical: ["electrician", "electricians", "wiring"],
  solar: ["panels", "photovoltaic"],
  landscaping: ["lawn", "lawns", "landscaper", "landscapers", "gardens"],
  construction: [
    "builder",
    "builders",
    "contractor",
    "contractors",
    "remodel",
    "remodeling",
    "renovation",
    "renovations",
  ],
  fitness: ["gym", "gyms", "trainer", "trainers"],
  hospitality: ["hotel", "hotels", "restaurant", "restaurants", "cafe", "catering"],
  healthcare: [
    "clinic",
    "clinics",
    "medical",
    "doctor",
    "doctors",
    "physician",
    "physicians",
    "patients",
    "chiropractor",
    "physio",
    "physiotherapy",
  ],
  medical: [
    "clinic",
    "clinics",
    "healthcare",
    "doctor",
    "doctors",
    "physician",
    "physicians",
    "patients",
  ],
  education: ["school", "schools", "tutoring", "tutor", "tutors", "students", "courses", "academy"],
  software: ["saas", "app", "apps", "startup", "platform", "developers"],
  marketing: ["agency", "agencies", "advertising", "branding"],
  cleaning: ["cleaners", "maid", "maids", "janitorial"],
  photography: ["photographer", "photographers", "photos", "shoots"],
  retail: ["boutique", "ecommerce", "e-commerce", "shopify", "storefront"],
  travel: ["tours", "tour", "agency", "bookings"],
  wellness: ["spa", "salon", "massage", "clinic"],
};

/** The value's word and the person's word could be the same word to a transcriber. */
function wordSupports(theirs: string, ours: string): boolean {
  if (theirs === ours || nearWord(theirs, ours)) return true;
  const shorter = theirs.length <= ours.length ? theirs : ours;
  const longer = shorter === theirs ? ours : theirs;
  // roof/roofing, auto/automotive, staff/staffing
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
  // plumbing/plumber, consulting/consultant — but not consulting/construction
  if (shorter.length >= 6) {
    let prefix = 0;
    while (prefix < shorter.length && shorter[prefix] === longer[prefix]) prefix += 1;
    return prefix >= 5;
  }
  return false;
}

/**
 * How much of a value the person's own words carry, 0..1: the share of its
 * content words that they said (or said a synonym of). A value with no content
 * words ("IT") needs every word said.
 */
export function supportRatio(value: string, userText: string): number {
  const said = tokens(userText);
  if (said.length === 0) return 0;
  const all = tokens(value);
  const content = contentTokens(all);
  const words = content.length ? content : all;
  if (words.length === 0) return 0;
  const phrase = value.trim().toLowerCase();
  const synonyms = new Set<string>(INDUSTRY_WORDS[phrase] ?? []);
  for (const w of words) for (const s of INDUSTRY_WORDS[w] ?? []) synonyms.add(s);
  let hits = 0;
  for (const w of words) {
    if (said.some((t) => wordSupports(t, w) || synonyms.has(t))) hits += 1;
  }
  return hits / words.length;
}

// Words that name a vertical MARY is tempted to default to. If she records one
// and the person never came near it, she assumed.
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
  "dental",
  "dentistry",
  "automotive",
  "auto",
  "dealership",
  "dealer",
  "hvac",
  "staffing",
  "recruiting",
];
const VERTICAL_HINTS = new Set([
  ...VERTICAL_VALUE,
  ...Object.values(INDUSTRY_WORDS).flat(),
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

/** "dana k at gmail dot com" → "danak@gmail.com": an address the way it is said aloud. */
export function spokenToEmail(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+(dash|hyphen)\s+/g, "-")
    .replace(/[\s,]+/g, "");
}

/** Words about email that are one slip away from a provider's name. */
const MAIL_WORDS = new Set(["email", "emails", "mail", "mails"]);

/** Spelling and separators stripped, so "d-a-n-a-k" and "dana.k" both read as "danak". */
function bareEmailPart(text: string): string {
  return spokenToEmail(text).replace(/[-._]/g, "");
}

/**
 * Whether a line of MARY's reads this address back — the local part and the
 * domain both in it, spelled out or not — so a spoken address is only ever
 * relied on once she has said it back and been told it is right.
 */
export function readsBackEmail(line: string, email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  const label = domain.split(".")[0] ?? "";
  const bareLocal = bareEmailPart(local);
  if (bareLocal.length < 2 || !label) return false;
  // Anchored on the @, so "sarah at brightpath" never passes for "sara@brightpath".
  return bareEmailPart(line).includes(`${bareLocal}@${label}`);
}

/** The person said they have no business of their own. */
const NO_BUSINESS_SAID =
  /\b(student|studying|job[- ]?(seek\w*|hunt\w*)|looking for (a |some )?(job|work)|between jobs|unemployed|retired|no business|not (a|my) business|don'?t (have|own|run) (a |any |the )?(business|company)|no company|just (curious|looking|browsing|here|visiting|interested)|for myself|personal(ly)?|hobby|not (a|an) (owner|business))\b/i;

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

/** How much of a value the person's words must carry before it is recorded. */
const SUPPORT_NEEDED: Record<string, number> = {
  // One word or a synonym of it: "cars" carries "automotive".
  industry: Number.EPSILON,
  // Half the name: "Bright Path Realty" from "brightpath realty".
  business: 0.5,
  // A summary in MARY's words of what they described, never a description they never gave.
  operations: 1 / 3,
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
        const v = value.toLowerCase();
        const [local = "", domain = ""] = v.split("@");
        const label = domain.split(".")[0] ?? "";
        const squashed = spokenToEmail(scopeText);
        // A correction often restates only the part that was wrong, so the
        // other part may stand as it was first said. The domain is what a guess
        // invents ("sarah@gmail.com" from "Sarah"), so it has to have been said
        // too — anywhere in the conversation.
        const existingLocal = existing?.toLowerCase().split("@")[0] ?? "";
        const localOk =
          local.length >= 2 &&
          (squashed.includes(local) ||
            (local === existingLocal && spokenToEmail(allUser).includes(local)));
        const saidWords = tokens(allUser);
        const domainOk =
          label.length > 0 &&
          ((label.length >= 4
            ? spokenToEmail(allUser).includes(label)
            : saidWords.includes(label)) ||
            // "ackme" for acme — but never "email" standing in for gmail.
            (label.length >= 4 && saidWords.some((t) => !MAIL_WORDS.has(t) && nearWord(t, label))));
        ok = squashed.includes(v) || (localOk && domainOk);
        // "Did I get that right?" — "Yes."
        if (!ok && affirmed && lastAssistant) ok = readsBackEmail(lastAssistant, v);
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
        if (field === "business" && value.toLowerCase() === NO_BUSINESS) {
          // "I'm a student", "just curious": no business, and that is recorded
          // only when they said as much.
          ok = NO_BUSINESS_SAID.test(scopeText) && (!evidence || quoteGrounded(evidence, scope));
          break;
        }
        const evidenceOk = quoteGrounded(evidence, scope) && !isAffirmation(evidence ?? "");
        // A real quote is not enough on its own: the value has to follow from
        // their words, or "I run a small practice" turns into "dental".
        const supported = supportRatio(value, scopeText) >= (SUPPORT_NEEDED[field] ?? 0.5);
        const affirmedOk = affirmed && assistantOffered(value, lastAssistant);
        ok = (evidenceOk && supported) || affirmedOk;
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
