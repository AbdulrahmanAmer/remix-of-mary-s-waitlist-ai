import { describe, expect, it } from "vitest";

import {
  closingCopy,
  endingFor,
  isNearRepeat,
  toMessages,
  transcriptOf,
} from "@/features/mary/conversation/text";
import { CUT_OFF_MARK } from "@/lib/voice-logic";

const full = {
  name: "Sarah",
  email: "s@x.co",
  business: "Roof Co",
  industry: "Roofing",
  operations: "Two crews",
};

describe("isNearRepeat", () => {
  it("flags a line that reuses 80% of an earlier one's words", () => {
    expect(
      isNearRepeat(
        "Want first access through the waitlist?",
        "Want first access through the waitlist, then?",
      ),
    ).toBe(true);
    expect(isNearRepeat("What should I call you?", "What kind of business do you run?")).toBe(
      false,
    );
    expect(isNearRepeat("", "anything")).toBe(false);
  });
});

describe("endingFor", () => {
  const turn = (over: object) => ({
    complete: false,
    declined: false,
    callbackRequested: false,
    collected: {},
    ...over,
  });
  it("needs a name and a phone for a callback", () => {
    expect(
      endingFor(turn({ callbackRequested: true, collected: { name: "Sarah", phone: "555" } })),
    ).toBe("callback");
    expect(endingFor(turn({ callbackRequested: true, collected: { name: "Sarah" } }))).toBeNull();
  });
  it("needs every field except phone for a sign-up", () => {
    expect(endingFor(turn({ complete: true, collected: full }))).toBe("signed_up");
    expect(endingFor(turn({ complete: true, collected: { ...full, email: "" } }))).toBeNull();
  });
  it("ends on a decline, and otherwise carries on", () => {
    expect(endingFor(turn({ declined: true }))).toBe("declined");
    expect(endingFor(turn({}))).toBeNull();
  });
});

describe("toMessages / transcriptOf", () => {
  const lines = [
    { id: "1", role: "mary" as const, text: "Hi, I'm", interrupted: true },
    { id: "2", role: "user" as const, text: "Hello" },
  ];
  it("marks cut-off lines for the model", () => {
    expect(toMessages(lines)).toEqual([
      { role: "assistant", content: `Hi, I'm ${CUT_OFF_MARK}` },
      { role: "user", content: "Hello" },
    ]);
  });
  it("writes a readable transcript", () => {
    expect(transcriptOf(lines)).toBe("MARY: Hi, I'm …\nGuest: Hello");
  });
});

describe("closingCopy", () => {
  it("speaks to the person by name", () => {
    expect(closingCopy("signed_up", "Sarah", "").title).toBe("You're on the list, Sarah.");
    expect(closingCopy("callback", "", "555 0100").steps[1]).toBe(
      "A real person calls you on 555 0100",
    );
    expect(closingCopy("declined", "Sam", "").steps).toEqual([]);
  });
});
