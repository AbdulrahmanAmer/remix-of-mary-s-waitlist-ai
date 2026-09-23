import { describe, expect, it } from "vitest";

import {
  assistantOffered,
  groundCollected,
  isAffirmation,
  nearWord,
  quoteGrounded,
} from "@/lib/mary-grounding";

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length]!;
}

describe("nearWord", () => {
  it("accepts one recognition slip in a name", () => {
    expect(nearWord("jon", "john")).toBe(true);
    expect(nearWord("sara", "sarah")).toBe(true);
    expect(nearWord("mark", "marc")).toBe(true);
  });

  it("rejects two edits and very short words", () => {
    expect(nearWord("jon", "jane")).toBe(false);
    expect(nearWord("al", "ali")).toBe(false);
  });

  it("agrees with Levenshtein distance <= 1 for words of 3+ letters", () => {
    const words = [
      "jon",
      "joan",
      "john",
      "jhon",
      "sara",
      "sarah",
      "sera",
      "mark",
      "marc",
      "marco",
      "ana",
      "anna",
      "anne",
    ];
    for (const a of words) {
      for (const b of words) {
        expect(nearWord(a, b), `${a} vs ${b}`).toBe(levenshtein(a, b) <= 1);
      }
    }
  });
});

describe("isAffirmation", () => {
  it("reads a plain yes as a yes and a negated one as no", () => {
    expect(isAffirmation("yeah that's right")).toBe(true);
    expect(isAffirmation("yes")).toBe(true);
    expect(isAffirmation("no")).toBe(false);
    expect(isAffirmation("yeah no, not really")).toBe(false);
  });
});

describe("quoteGrounded / assistantOffered", () => {
  it("only grounds a quote that the person actually said", () => {
    expect(quoteGrounded("we run a dental clinic", ["we run a dental clinic in town"])).toBe(true);
    expect(quoteGrounded("we sell cars", ["we run a dental clinic"])).toBe(false);
    expect(quoteGrounded(null, ["anything"])).toBe(false);
  });

  it("knows when MARY's last line contained the value", () => {
    expect(assistantOffered("dental", "So you're in dental, right?")).toBe(true);
    expect(assistantOffered("roofing", "So you're in dental, right?")).toBe(false);
    expect(assistantOffered("dental", undefined)).toBe(false);
  });
});

describe("groundCollected", () => {
  it("keeps a name the person said and rejects one they never said", () => {
    const said = groundCollected({
      previous: {},
      proposed: { name: { value: "Sarah", evidence: "I'm Sarah" } },
      userMessages: ["hi, I'm Sarah"],
    });
    expect(said.collected["name"]).toBe("Sarah");

    const invented = groundCollected({
      previous: {},
      proposed: { name: { value: "Sarah", evidence: null } },
      userMessages: ["hi there"],
    });
    expect(invented.collected["name"]).toBeUndefined();
    expect(invented.rejected).toContain("name");
  });

  it("accepts a phone number only when its digits were spoken", () => {
    const ok = groundCollected({
      previous: {},
      proposed: { phone: { value: "555 123 4567", evidence: null } },
      userMessages: ["it's five five five one two three four five six seven"],
    });
    expect(ok.collected["phone"]).toBe("555 123 4567");

    const bad = groundCollected({
      previous: {},
      proposed: { phone: { value: "555 999 0000", evidence: null } },
      userMessages: ["it's 555 123 4567"],
    });
    expect(bad.collected["phone"]).toBeUndefined();
  });

  it("accepts a phone skip when they wave it off", () => {
    const result = groundCollected({
      previous: {},
      proposed: { phone: { value: "skipped", evidence: null } },
      userMessages: ["just email is fine"],
      lastAssistant: "What's the best number to reach you on?",
    });
    expect(result.collected["phone"]).toBe("skipped");
  });

  it("accepts a bare yes as a phone skip only when MARY offered to skip it (AI-05)", () => {
    const offered = groundCollected({
      previous: {},
      proposed: { phone: { value: "skipped", evidence: null } },
      userMessages: ["yeah"],
      lastAssistant: "Or is email enough, and we skip the phone?",
    });
    expect(offered.collected["phone"]).toBe("skipped");

    // "yeah" answered an unrelated question; it is not a phone decline.
    const unrelated = groundCollected({
      previous: {},
      proposed: { phone: { value: "skipped", evidence: null } },
      userMessages: ["yeah"],
      lastAssistant: "So you're in dental, right?",
    });
    expect(unrelated.collected["phone"]).toBeUndefined();
    expect(unrelated.rejected).toContain("phone");
  });
});
