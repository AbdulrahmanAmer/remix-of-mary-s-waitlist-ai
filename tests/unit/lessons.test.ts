import { describe, expect, it } from "vitest";

import { formatExperience, selectLessons } from "@/lib/mary-experience.server";
import { normalizeLesson } from "@/lib/experience-store";

type Lesson = Parameters<typeof selectLessons>[0][number];

const now = new Date().toISOString();
const lesson = (text: string, extra: Partial<Lesson> = {}): Lesson => ({
  category: "discovery",
  lesson: text,
  evidence: null,
  industry: null,
  confidence: 3,
  outcome: "",
  at: now,
  seen: 1,
  ...extra,
});

describe("normalizeLesson", () => {
  it("makes near-identical lessons collide", () => {
    expect(normalizeLesson("Ask ONE question, then wait!")).toBe(
      normalizeLesson("ask one question then wait"),
    );
  });
});

describe("selectLessons", () => {
  it("merges repeats so they reinforce instead of duplicating", () => {
    const picked = selectLessons([
      lesson("Ask one question, then wait."),
      lesson("ask one question then wait"),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.seen).toBe(2);
  });

  it("drops notes about another industry", () => {
    const picked = selectLessons(
      [lesson("Dentists care about no-shows.", { industry: "dental" }), lesson("General note.")],
      { industry: "roofing" },
    );
    expect(picked.map((l) => l.lesson)).toEqual(["General note."]);
  });

  it("keeps categories varied and respects the limit", () => {
    const pool = Array.from({ length: 10 }, (_, i) => lesson(`Discovery lesson number ${i}`));
    expect(selectLessons(pool)).toHaveLength(3);
    expect(selectLessons(pool, { limit: 2 })).toHaveLength(2);
  });
});

describe("formatExperience", () => {
  it("is empty with no lessons and lists them otherwise", () => {
    expect(formatExperience([], 0)).toBe("");
    const text = formatExperience([lesson("Ask one question, then wait.")], 1);
    expect(text).toContain("Field notes");
    expect(text).toContain("- (discovery) Ask one question, then wait.");
  });
});
