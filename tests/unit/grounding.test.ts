import { describe, expect, it } from "vitest";

import {
  assistantOffered,
  groundCollected,
  isAffirmation,
  nearWord,
  NO_BUSINESS,
  quoteGrounded,
  readsBackEmail,
  spokenToEmail,
  supportRatio,
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

  it("takes a soft yes only when nothing much follows it", () => {
    for (const yes of [
      "pretty much",
      "spot on",
      "you got it",
      "that's right",
      "you're right",
      "close enough",
      "sure, whatever",
      "more or less",
    ])
      expect(isAffirmation(yes), yes).toBe(true);
  });

  it("reads a sideways reply as an answer, not a yes", () => {
    for (const answer of [
      "Pretty much the opposite, we do cars",
      "You know, we mostly do cars",
      "Basically we're a law firm",
      "Close, it's actually a law firm",
      "Right, we're a law firm",
      "Sure, four agents and a manager",
    ])
      expect(isAffirmation(answer), answer).toBe(false);
  });
});

describe("supportRatio", () => {
  it("is carried by their own words, a synonym, or a transcriber's near miss", () => {
    expect(supportRatio("dental", "I'm a dentist")).toBe(1);
    expect(supportRatio("automotive", "we mostly do cars")).toBe(1);
    expect(supportRatio("legal", "basically we're a law firm")).toBe(1);
    expect(supportRatio("roofing", "we're roofers, two crews")).toBe(1);
    expect(supportRatio("Brightpath Realty", "yeah, bright path realty")).toBe(1);
  });

  it("is not carried by a vague or unrelated answer", () => {
    expect(supportRatio("dental", "I run a small practice")).toBe(0);
    expect(supportRatio("healthcare", "I run a small practice")).toBe(0);
    expect(supportRatio("consulting", "we do construction")).toBe(0);
    expect(supportRatio("Smile Dental Group", "I run a small practice")).toBe(0);
  });
});

describe("spokenToEmail / readsBackEmail", () => {
  it("turns a spoken address into one", () => {
    expect(spokenToEmail("dana k at gmail dot com")).toBe("danak@gmail.com");
    expect(spokenToEmail("jo underscore lee at acme dash co dot com")).toBe("jo_lee@acme-co.com");
  });

  it("knows when MARY read an address back, spelled or not", () => {
    expect(readsBackEmail("d-a-n-a-k, at gmail dot com.", "danak@gmail.com")).toBe(true);
    expect(readsBackEmail("Got it — danak at gmail dot com.", "danak@gmail.com")).toBe(true);
    expect(readsBackEmail("Good to meet you, Dana.", "danak@gmail.com")).toBe(false);
    expect(readsBackEmail("d-a-n-a-k, at outlook dot com.", "danak@gmail.com")).toBe(false);
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

  it("rejects a name whose only evidence is a bare yeah", () => {
    const result = groundCollected({
      previous: {},
      proposed: { name: { value: "Sarah", evidence: "yeah" } },
      userMessages: ["yeah"],
      lastAssistant: "Sounds like a two-person team?",
    });
    expect(result.collected["name"]).toBeUndefined();
    expect(result.rejected).toContain("name");
  });

  describe("email", () => {
    it("grounds an address said aloud, and a typed one", () => {
      const spoken = groundCollected({
        previous: {},
        proposed: { email: { value: "jo@acme.com", evidence: null } },
        userMessages: ["jo at acme dot com"],
      });
      expect(spoken.collected["email"]).toBe("jo@acme.com");

      const typed = groundCollected({
        previous: {},
        proposed: { email: { value: "Leo.M@BrightPath.io", evidence: null } },
        userMessages: ["leo.m@brightpath.io"],
      });
      expect(typed.collected["email"]).toBe("Leo.M@BrightPath.io");
    });

    it("rejects an invented domain, even when the local part is their name", () => {
      const result = groundCollected({
        previous: { name: "Sarah" },
        proposed: { email: { value: "sarah@gmail.com", evidence: null } },
        userMessages: ["Sarah.", "We run a real estate team.", "Just use my work email."],
        lastAssistant: "Where should your invite go?",
      });
      expect(result.collected["email"]).toBeUndefined();
      expect(result.rejected).toEqual(["email"]);
    });

    it("tolerates a transcriber's slip in the domain, never 'email' standing in for gmail", () => {
      const slip = groundCollected({
        previous: {},
        proposed: { email: { value: "sam@acme.com", evidence: null } },
        userMessages: ["sam at ackme dot com"],
      });
      expect(slip.collected["email"]).toBe("sam@acme.com");

      const mail = groundCollected({
        previous: {},
        proposed: { email: { value: "sam@gmail.com", evidence: null } },
        userMessages: ["Sam. Send me an email."],
      });
      expect(mail.collected["email"]).toBeUndefined();
    });

    it("takes a correction that restates only the part that was wrong", () => {
      const local = groundCollected({
        previous: { email: "danak@gmail.com" },
        proposed: { email: { value: "dana.k@gmail.com", evidence: null } },
        userMessages: ["dana k at gmail dot com", "No — dana dot k."],
        lastAssistant: "d-a-n-a-k, at gmail dot com. Did I get that right?",
      });
      expect(local.collected["email"]).toBe("dana.k@gmail.com");

      const domain = groundCollected({
        previous: { email: "danak@gmail.com" },
        proposed: { email: { value: "danak@outlook.com", evidence: null } },
        userMessages: ["dana k at gmail dot com", "No, it's outlook, not gmail."],
        lastAssistant: "d-a-n-a-k, at gmail dot com. Did I get that right?",
      });
      expect(domain.collected["email"]).toBe("danak@outlook.com");
    });

    it("keeps the address on a yes to the read-back", () => {
      const result = groundCollected({
        previous: { email: "danak@gmail.com" },
        proposed: { email: { value: "danak@gmail.com", evidence: null } },
        userMessages: ["dana k at gmail dot com", "yes"],
        lastAssistant: "d-a-n-a-k, at gmail dot com. Did I get that right?",
      });
      expect(result.collected["email"]).toBe("danak@gmail.com");
      expect(result.rejected).toEqual([]);
    });
  });

  describe("business, industry, operations", () => {
    it("drops values a real but vague quote does not carry", () => {
      const result = groundCollected({
        previous: {},
        proposed: {
          industry: { value: "dental", evidence: "I run a small practice" },
          business: { value: "Smile Dental Group", evidence: "I run a small practice" },
          operations: {
            value: "front desk calls every lead back by hand",
            evidence: "I run a small practice",
          },
        },
        userMessages: ["I run a small practice."],
        lastAssistant: "What's the business, roughly?",
      });
      expect(result.collected).toEqual({});
      expect(result.rejected).toEqual(["industry", "business", "operations"]);
    });

    it("keeps everything a full answer gives, in her summary words", () => {
      const result = groundCollected({
        previous: { name: "Dana", email: "danak@gmail.com" },
        proposed: {
          business: {
            value: "Bright Smile Dental, two locations",
            evidence: "Bright Smile Dental, two locations",
          },
          industry: { value: "Dental", evidence: "Bright Smile Dental" },
          operations: {
            value: "Google ads generate leads; the front desk calls back when available.",
            evidence: "Leads come from Google ads and the front desk calls them back",
          },
        },
        userMessages: [
          "I'm Dana. It's dana k at gmail dot com.",
          "Bright Smile Dental, two locations. Leads come from Google ads and the front desk calls them back when they get a chance. What does it cost?",
        ],
        lastAssistant: "To finish, what's the business, roughly?",
      });
      expect(result.rejected).toEqual([]);
      expect(result.collected["industry"]).toBe("Dental");
      expect(result.collected["business"]).toBe("Bright Smile Dental, two locations");
    });

    it("does not let a sideways reply confirm her real-estate guess, but takes the answer it carries", () => {
      const guess = groundCollected({
        previous: {},
        proposed: { industry: { value: "real estate", evidence: null } },
        userMessages: ["You know, we mostly do cars"],
        lastAssistant: "Let me guess — real estate, and the leads come from Zillow?",
      });
      expect(guess.collected["industry"]).toBeUndefined();
      expect(guess.rejected).toEqual(["industry"]);

      const answer = groundCollected({
        previous: {},
        proposed: { industry: { value: "automotive", evidence: "we mostly do cars" } },
        userMessages: ["You know, we mostly do cars"],
        lastAssistant: "Let me guess — real estate, and the leads come from Zillow?",
      });
      expect(answer.collected["industry"]).toBe("automotive");

      const law = groundCollected({
        previous: {},
        proposed: { industry: { value: "legal", evidence: "we're a law firm" } },
        userMessages: ["Basically we're a law firm"],
        lastAssistant: "Let me guess — real estate?",
      });
      expect(law.collected["industry"]).toBe("legal");
    });

    it("still takes a plain yes to a specific guess she made", () => {
      const result = groundCollected({
        previous: {},
        proposed: {
          industry: { value: "real estate", evidence: "yeah" },
          operations: { value: "a Zillow lead at nine at night sits till morning", evidence: null },
        },
        userMessages: ["We've got four agents.", "Pretty much."],
        lastAssistant: "So real estate — a Zillow lead at nine at night sits till morning?",
      });
      expect(result.collected["industry"]).toBe("real estate");
      expect(result.collected["operations"]).toBe(
        "a Zillow lead at nine at night sits till morning",
      );
    });

    it("survives a transcriber splitting a business name", () => {
      const result = groundCollected({
        previous: {},
        proposed: { business: { value: "Brightpath Realty", evidence: "Bright Path Realty" } },
        userMessages: ["Yeah, Bright Path Realty."],
        lastAssistant: "And the team — that's yours?",
      });
      expect(result.collected["business"]).toBe("Brightpath Realty");
    });

    it("records no business only when they said they have none", () => {
      const student = groundCollected({
        previous: {},
        proposed: { business: { value: NO_BUSINESS, evidence: "I'm a student" } },
        userMessages: ["I'm a student, just curious really."],
      });
      expect(student.collected["business"]).toBe(NO_BUSINESS);

      const bakery = groundCollected({
        previous: {},
        proposed: { business: { value: NO_BUSINESS, evidence: null } },
        userMessages: ["We run a bakery."],
      });
      expect(bakery.collected["business"]).toBeUndefined();
      expect(bakery.rejected).toEqual(["business"]);
    });
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
