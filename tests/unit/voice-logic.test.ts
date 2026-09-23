import { describe, expect, it } from "vitest";

import {
  endpointDelayMs,
  isBackchannel,
  isEchoOfAssistant,
  isInterruptCommand,
  spokenPortion,
  stripAssistantEcho,
  tokens,
  transcriptConfirmsInterrupt,
  withoutEcho,
} from "@/lib/voice-logic";

const MARY = ["Hi, I'm MARY. Want first access to OmniSuite through the waitlist?"];

describe("tokens", () => {
  it("lowercases, drops apostrophes and punctuation, keeps emails", () => {
    expect(tokens("I'm Sarah, sarah@x.com!")).toEqual(["im", "sarah", "sarah@x.com"]);
  });
});

describe("echo handling", () => {
  it("recognises MARY's own words coming back through the mic", () => {
    expect(isEchoOfAssistant("want first access to omnisuite through the waitlist", MARY)).toBe(
      true,
    );
  });

  it("does not treat the person's own answer as echo", () => {
    expect(isEchoOfAssistant("we run a roofing company in Dallas", MARY)).toBe(false);
  });

  it("withoutEcho empties pure echo and keeps the person's words", () => {
    expect(withoutEcho("want first access to omnisuite through the waitlist", MARY)).toBe("");
    expect(withoutEcho("we run a roofing company in Dallas", MARY)).toBe(
      "we run a roofing company in Dallas",
    );
  });

  it("strips her words from the front of a transcript and keeps theirs", () => {
    const cleaned = stripAssistantEcho("first access to omnisuite yes please sign me up", MARY);
    expect(cleaned).not.toMatch(/omnisuite/i);
    expect(cleaned).toMatch(/sign me up/);
  });
});

describe("interruptions", () => {
  it("cuts in on stop words, never on acknowledgements", () => {
    expect(isInterruptCommand("wait")).toBe(true);
    expect(isInterruptCommand("hold on a second")).toBe(true);
    expect(isBackchannel("mm hmm")).toBe(true);
    expect(transcriptConfirmsInterrupt("okay", MARY)).toBe(false);
    expect(transcriptConfirmsInterrupt("stop", MARY)).toBe(true);
  });

  it("needs two real words for an ordinary cut-in, and never her own echo", () => {
    expect(transcriptConfirmsInterrupt("actually I sell roofing", MARY)).toBe(true);
    expect(transcriptConfirmsInterrupt("first access to omnisuite", MARY)).toBe(false);
  });
});

describe("endpointDelayMs", () => {
  it("waits longer mid-thought, mid-email and mid-number", () => {
    expect(endpointDelayMs("we do roofing and")).toBe(1500);
    expect(endpointDelayMs("sarah at gmail dot")).toBe(2000);
    expect(endpointDelayMs("five five five")).toBe(1800);
    expect(endpointDelayMs("that's all.")).toBe(550);
    expect(endpointDelayMs("")).toBe(800);
  });
});

describe("spokenPortion", () => {
  it("keeps only fully voiced words when she is cut off", () => {
    expect(spokenPortion("one two three four", 0.5)).toEqual({ spoken: "one two", cut: true });
    expect(spokenPortion("one two three four", 1)).toEqual({
      spoken: "one two three four",
      cut: false,
    });
    expect(spokenPortion("", 0.5)).toEqual({ spoken: "", cut: false });
  });
});
