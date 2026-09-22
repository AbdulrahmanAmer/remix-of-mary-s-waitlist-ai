/**
 * MARY's field notes, kept in this browser.
 *
 * After every conversation she debriefs herself (see /api/reflect) and the
 * lessons land here. They ride along with each turn request so the very next
 * conversation on this device already benefits — and, once a Google Sheet is
 * connected, the same lessons are pooled across every visitor.
 */

export const LESSON_CATEGORIES = [
  "opening",
  "name",
  "discovery",
  "objection",
  "reveal",
  "contact",
  "callback",
  "close",
  "pacing",
  "industry",
] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

export type StoredLesson = {
  category: LessonCategory;
  lesson: string;
  evidence: string | null;
  industry: string | null;
  confidence: number;
  outcome: string;
  /** ISO time it was written. */
  at: string;
  /** How many conversations reinforced the same lesson. */
  seen: number;
};

/** The compact shape sent with a turn. */
export type ClientLesson = {
  category: LessonCategory;
  lesson: string;
  industry: string | null;
  confidence: number;
  at: string;
};

const KEY = "omnisuite.mary.experience.v1";
const CAP = 80;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function normalizeLesson(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coerce(raw: unknown): StoredLesson | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const lesson = typeof value["lesson"] === "string" ? value["lesson"].trim() : "";
  if (!lesson) return null;
  const category = (LESSON_CATEGORIES as readonly string[]).includes(String(value["category"]))
    ? (value["category"] as LessonCategory)
    : "discovery";
  return {
    category,
    lesson: lesson.slice(0, 240),
    evidence: typeof value["evidence"] === "string" ? value["evidence"].slice(0, 160) : null,
    industry: typeof value["industry"] === "string" ? value["industry"].slice(0, 60) : null,
    confidence:
      typeof value["confidence"] === "number"
        ? Math.min(5, Math.max(1, Math.round(value["confidence"])))
        : 3,
    outcome: typeof value["outcome"] === "string" ? value["outcome"] : "",
    at: typeof value["at"] === "string" ? value["at"] : new Date().toISOString(),
    seen: typeof value["seen"] === "number" && value["seen"] > 0 ? Math.round(value["seen"]) : 1,
  };
}

export function loadLessons(): StoredLesson[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerce).filter((item): item is StoredLesson => item !== null);
  } catch {
    return [];
  }
}

function persist(lessons: StoredLesson[]) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lessons));
  } catch {
    // Storage full or blocked — she simply learns a little less on this device.
  }
}

/** Merges new lessons in: a repeat reinforces, a new one is added, the oldest weakest go first. */
export function addLessons(
  incoming: Omit<StoredLesson, "seen" | "at">[] | StoredLesson[],
): StoredLesson[] {
  const existing = loadLessons();
  const byKey = new Map(existing.map((item) => [normalizeLesson(item.lesson), item]));
  const now = new Date().toISOString();
  for (const raw of incoming) {
    const item = coerce({ ...raw, at: (raw as StoredLesson).at ?? now });
    if (!item) continue;
    const key = normalizeLesson(item.lesson);
    const previous = byKey.get(key);
    if (previous) {
      previous.seen += 1;
      previous.at = now;
      previous.confidence = Math.min(5, Math.max(previous.confidence, item.confidence));
      if (!previous.industry && item.industry) previous.industry = item.industry;
    } else {
      byKey.set(key, { ...item, seen: 1, at: now });
    }
  }
  const merged = [...byKey.values()].sort((a, b) => score(b) - score(a)).slice(0, CAP);
  persist(merged);
  return merged;
}

function ageDays(at: string): number {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return 30;
  return Math.max(0, (Date.now() - then) / 86_400_000);
}

/** Confidence, reinforcement and freshness, in that order of weight. */
export function score(lesson: StoredLesson, industry?: string | null): number {
  const recency = Math.exp(-ageDays(lesson.at) / 45);
  const industryBoost =
    industry && lesson.industry && lesson.industry.toLowerCase() === industry.toLowerCase()
      ? 1.2
      : 0;
  return lesson.confidence + 0.7 * Math.log(lesson.seen) + recency + industryBoost;
}

/** The handful worth sending with a turn — varied by category, best first. */
export function lessonsForTurn(industry?: string | null, limit = 20): ClientLesson[] {
  const ranked = loadLessons().sort((a, b) => score(b, industry) - score(a, industry));
  const perCategory = new Map<string, number>();
  const picked: ClientLesson[] = [];
  for (const item of ranked) {
    const used = perCategory.get(item.category) ?? 0;
    if (used >= 4) continue;
    perCategory.set(item.category, used + 1);
    picked.push({
      category: item.category,
      lesson: item.lesson,
      industry: item.industry,
      confidence: item.confidence,
      at: item.at,
    });
    if (picked.length >= limit) break;
  }
  return picked;
}

export function clearLessons() {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
