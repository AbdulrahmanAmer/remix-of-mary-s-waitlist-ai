/**
 * MARY's experience: how she learns from the conversations she has.
 *
 * After a conversation ends she debriefs it herself — what worked, what
 * stalled, which objections came up — and writes a handful of short lessons.
 * Those lessons are stored (browser + Google Sheet when connected) and the
 * best of them are folded into her prompt as "field notes" on every turn.
 * Her playbook stays the same document; her judgement grows around it.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

import MARY_VOICE_SPEC from "../../docs/mary-voice.md?raw";
import { LESSON_CATEGORIES, normalizeLesson, type ClientLesson } from "./experience-store";
import { gatewayConfig } from "./mary-prompt.server";
import { sheetGet, sheetPost, sheetsConfigured } from "./sheets.server";

export const LessonSchema = z.object({
  category: z.enum(LESSON_CATEGORIES),
  lesson: z.string(),
  evidence: z.string().nullable(),
  industry: z.string().nullable(),
  confidence: z.number(),
});

export const ReflectionSchema = z.object({
  summary: z.string(),
  objections: z.array(z.string()),
  whatWorked: z.string().nullable(),
  whatStalled: z.string().nullable(),
  lessons: z.array(LessonSchema),
});

export type Reflection = z.infer<typeof ReflectionSchema>;

export type Lesson = {
  category: (typeof LESSON_CATEGORIES)[number];
  lesson: string;
  evidence: string | null;
  industry: string | null;
  confidence: number;
  outcome: string;
  at: string;
  seen: number;
};

export type ReflectInput = {
  sessionId: string;
  transcript: string;
  outcome: "signed_up" | "callback" | "declined" | "abandoned" | "in_progress";
  collected: {
    name?: string;
    email?: string;
    phone?: string;
    business?: string;
    industry?: string;
    operations?: string;
  };
  mode?: string | undefined;
  turns?: number | undefined;
  durationSec?: number | undefined;
};

const OUTCOME_TEXT: Record<ReflectInput["outcome"], string> = {
  signed_up: "they joined the waitlist and MARY closed properly",
  callback: "they asked to be called back instead; name and number were taken",
  declined: "they declined the spot, or left before giving an email, and MARY let them go",
  abandoned: "they left mid-conversation without finishing",
  in_progress: "the conversation was still going",
};

const REFLECT_SYSTEM = `You are MARY, reviewing one of your own conversations afterwards — the way a good salesperson debriefs on the drive home. Your playbook is below so you know what you already do; do not restate it.

Write lessons that would change how you handle the NEXT conversation with a DIFFERENT person. A good lesson is specific, generalisable, and phrased as an instruction to yourself ("When someone answers in one word, ..."). Every lesson must be grounded in a real moment from this transcript, quoted in "evidence" (their words or yours, under 15 words). Zero lessons is a valid answer when nothing new happened. Never include names, email addresses, phone numbers or company names anywhere in your output — say "the person" or "their business". If they left mid-conversation, the most valuable lesson is what happened right before they left. Keep each lesson under 28 words and the summary under 30.

Confidence: 5 = clearly caused the outcome, 3 = plausible pattern, 1 = a hunch.

--- PLAYBOOK ---
${MARY_VOICE_SPEC}`;

function reflectPrompt(input: ReflectInput): string {
  const facts = [
    `Outcome: ${OUTCOME_TEXT[input.outcome]}.`,
    input.collected.industry
      ? `Industry (for the industry field only): ${input.collected.industry}.`
      : "",
    input.mode ? `How they came across: ${input.mode}.` : "",
    typeof input.turns === "number" ? `Person's turns: ${input.turns}.` : "",
    typeof input.durationSec === "number" && input.durationSec > 0
      ? `Length: ${Math.round(input.durationSec)} seconds.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${facts}\n\nTranscript (MARY is you; Guest is the person):\n${input.transcript.slice(0, 24_000)}\n\nDebrief it. Set "summary" (one line, what happened and why it ended the way it did), "objections" (short phrases, only ones actually raised), "whatWorked", "whatStalled", and up to 5 "lessons". Industry on a lesson only when the lesson is specific to that industry; otherwise null.`;
}

/** Strips anything that could identify the person from a line of text. */
export function scrubPII(
  text: string,
  known: { name?: string; email?: string; phone?: string; business?: string },
): string {
  let out = text;
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "their email");
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, "their number");
  const swap = (value: string | undefined, replacement: string) => {
    if (!value || value.trim().length < 2) return;
    const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), replacement);
    // First name on its own, too.
    const first = value.trim().split(/\s+/)[0];
    if (first && first.length >= 3 && first !== value.trim()) {
      const escapedFirst = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${escapedFirst}\\b`, "gi"), replacement);
    }
  };
  swap(known.name, "the person");
  swap(known.business, "their business");
  return out.replace(/\s{2,}/g, " ").trim();
}

function cleanLessons(reflection: Reflection, input: ReflectInput): Lesson[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const lessons: Lesson[] = [];
  for (const raw of reflection.lessons.slice(0, 5)) {
    const lesson = scrubPII(raw.lesson, input.collected).slice(0, 240);
    if (lesson.split(/\s+/).length < 4) continue;
    const key = normalizeLesson(lesson);
    if (seen.has(key)) continue;
    seen.add(key);
    lessons.push({
      category: raw.category,
      lesson,
      evidence: raw.evidence ? scrubPII(raw.evidence, input.collected).slice(0, 160) : null,
      industry: raw.industry ? raw.industry.slice(0, 60) : null,
      confidence: Math.min(5, Math.max(1, Math.round(raw.confidence || 3))),
      outcome: input.outcome,
      at: now,
      seen: 1,
    });
  }
  return lessons;
}

/** Runs the debrief. Throws when the model is unavailable; callers decide whether that matters. */
export async function reflectOnConversation(
  input: ReflectInput,
  apiKey: string,
): Promise<{ reflection: Reflection; lessons: Lesson[] }> {
  const lovable = createOpenAI(gatewayConfig(apiKey));
  const result = await generateText({
    model: lovable.responses("openai/gpt-6-astra"),
    system: REFLECT_SYSTEM,
    prompt: reflectPrompt(input),
    output: Output.object({ schema: ReflectionSchema }),
    providerOptions: {
      openai: { forceReasoning: true, reasoningEffort: "low", store: false },
    },
  });
  const reflection = result.output;
  const cleaned: Reflection = {
    ...reflection,
    summary: scrubPII(reflection.summary, input.collected).slice(0, 300),
    objections: reflection.objections
      .slice(0, 6)
      .map((item) => scrubPII(item, input.collected).slice(0, 80)),
    whatWorked: reflection.whatWorked
      ? scrubPII(reflection.whatWorked, input.collected).slice(0, 200)
      : null,
    whatStalled: reflection.whatStalled
      ? scrubPII(reflection.whatStalled, input.collected).slice(0, 200)
      : null,
  };
  return { reflection: cleaned, lessons: cleanLessons(cleaned, input) };
}

/**
 * Debrief and store: lessons go to the sheet's Experience tab and the
 * conversation's row gets its summary. Never throws — a failed debrief must
 * not take anything else down with it.
 */
export async function reflectAndStore(
  input: ReflectInput,
  apiKey: string,
): Promise<{ reflection: Reflection; lessons: Lesson[] } | null> {
  let outcome: { reflection: Reflection; lessons: Lesson[] };
  try {
    outcome = await reflectOnConversation(input, apiKey);
  } catch (error) {
    console.error("[mary] debrief failed", error);
    return null;
  }
  if (sheetsConfigured()) {
    try {
      await Promise.all([
        outcome.lessons.length
          ? sheetPost("experience", { sessionId: input.sessionId, lessons: outcome.lessons })
          : Promise.resolve(),
        sheetPost("lead", {
          sessionId: input.sessionId,
          summary: outcome.reflection.summary,
          objections: outcome.reflection.objections.join("; "),
          whatWorked: outcome.reflection.whatWorked ?? "",
          whatStalled: outcome.reflection.whatStalled ?? "",
        }),
      ]);
    } catch (error) {
      console.error("[mary] storing the debrief in the sheet failed", error);
    }
  }
  // Invalidate so the next turn picks the new lessons up.
  cache = null;
  return outcome;
}

// ---------- Reading lessons back for the prompt ----------

type RawSheetLesson = {
  at?: string;
  category?: string;
  lesson?: string;
  evidence?: string | null;
  industry?: string | null;
  outcome?: string;
  confidence?: number | string;
};

let cache: { at: number; lessons: Lesson[] } | null = null;
let inflight: Promise<Lesson[]> | null = null;
const CACHE_MS = 3 * 60_000;

function coerceSheetLesson(raw: RawSheetLesson): Lesson | null {
  const lesson = typeof raw.lesson === "string" ? raw.lesson.trim() : "";
  if (!lesson) return null;
  const category = (LESSON_CATEGORIES as readonly string[]).includes(String(raw.category))
    ? (raw.category as Lesson["category"])
    : "discovery";
  const confidence = Number(raw.confidence);
  return {
    category,
    lesson: lesson.slice(0, 240),
    evidence: typeof raw.evidence === "string" && raw.evidence ? raw.evidence : null,
    industry: typeof raw.industry === "string" && raw.industry ? raw.industry : null,
    confidence: Number.isFinite(confidence) ? Math.min(5, Math.max(1, confidence)) : 3,
    outcome: typeof raw.outcome === "string" ? raw.outcome : "",
    at: typeof raw.at === "string" && raw.at ? raw.at : new Date().toISOString(),
    seen: 1,
  };
}

/**
 * Lessons pooled across every visitor, from the sheet. Cached; never holds a
 * turn for longer than the budget — if the sheet is slow, whatever was cached
 * (or nothing) is used and the fetch finishes in the background.
 */
export async function sheetLessons(budgetMs = 900): Promise<Lesson[]> {
  if (!sheetsConfigured()) return [];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.lessons;
  if (!inflight) {
    inflight = sheetGet<{ lessons: RawSheetLesson[] }>(
      "experience",
      { limit: 400 },
      { timeoutMs: 7000 },
    )
      .then((body) => {
        const lessons = (body.lessons ?? [])
          .map(coerceSheetLesson)
          .filter((item): item is Lesson => item !== null);
        cache = { at: Date.now(), lessons };
        return lessons;
      })
      .catch((error) => {
        console.error("[mary] could not read field notes from the sheet", error);
        // Back off for a minute rather than hammering a broken deployment.
        cache = { at: Date.now() - CACHE_MS + 60_000, lessons: cache?.lessons ?? [] };
        return cache.lessons;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const pending = inflight;
  const timeout = new Promise<Lesson[]>((resolve) =>
    setTimeout(() => resolve(cache?.lessons ?? []), budgetMs),
  );
  return Promise.race([pending, timeout]);
}

function ageDays(at: string): number {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return 30;
  return Math.max(0, (Date.now() - then) / 86_400_000);
}

function scoreLesson(lesson: Lesson, industry?: string | null): number {
  const recency = Math.exp(-ageDays(lesson.at) / 45);
  const industryBoost =
    industry && lesson.industry && lesson.industry.toLowerCase() === industry.toLowerCase()
      ? 1.2
      : 0;
  return lesson.confidence + 0.7 * Math.log(lesson.seen) + recency + industryBoost;
}

/** Dedupe (repeats reinforce), rank, keep the categories varied, cap the count. */
export function selectLessons(
  pool: Lesson[],
  opts: { industry?: string | null | undefined; limit?: number | undefined } = {},
): Lesson[] {
  const merged = new Map<string, Lesson>();
  for (const item of pool) {
    const key = normalizeLesson(item.lesson);
    const previous = merged.get(key);
    if (previous) {
      previous.seen += item.seen;
      previous.confidence = Math.max(previous.confidence, item.confidence);
      if (Date.parse(item.at) > Date.parse(previous.at)) previous.at = item.at;
      if (!previous.industry && item.industry) previous.industry = item.industry;
    } else {
      merged.set(key, { ...item });
    }
  }
  const ranked = [...merged.values()].sort(
    (a, b) => scoreLesson(b, opts.industry) - scoreLesson(a, opts.industry),
  );
  const perCategory = new Map<string, number>();
  const picked: Lesson[] = [];
  const limit = opts.limit ?? 16;
  for (const item of ranked) {
    // Notes about another industry are noise for this person.
    if (
      item.industry &&
      opts.industry &&
      item.industry.toLowerCase() !== opts.industry.toLowerCase()
    )
      continue;
    const used = perCategory.get(item.category) ?? 0;
    if (used >= 3) continue;
    perCategory.set(item.category, used + 1);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}

function fromClient(lessons: ClientLesson[] | undefined): Lesson[] {
  return (lessons ?? []).map((item) => ({
    category: item.category,
    lesson: item.lesson.slice(0, 240),
    evidence: null,
    industry: item.industry,
    confidence: Math.min(5, Math.max(1, item.confidence || 3)),
    outcome: "",
    at: item.at,
    seen: 1,
  }));
}

/** The prompt section, or an empty string when she has nothing yet. */
export function formatExperience(lessons: Lesson[], totalKnown: number): string {
  if (!lessons.length) return "";
  const lines = lessons.map((item) => `- (${item.category}) ${item.lesson}`).join("\n");
  return `\n\nField notes — lessons you wrote for yourself after earlier conversations (${totalKnown} on record). They are experience, not rules: apply them with judgement when the moment matches, never mention them, never quote them, and never let them override what this person is actually saying.\n${lines}`;
}

/** Everything MARY should carry into this turn, merged from the browser and the sheet. */
export async function experienceForTurn(
  clientLessons: ClientLesson[] | undefined,
  industry?: string | null,
): Promise<string> {
  const pooled = await sheetLessons();
  const all = [...pooled, ...fromClient(clientLessons)];
  if (!all.length) return "";
  const picked = selectLessons(all, { industry });
  const distinct = new Set(all.map((item) => normalizeLesson(item.lesson))).size;
  return formatExperience(picked, distinct);
}
