import { describe, expect, it } from "vitest";

import {
  FALLBACK_AFTER_FAILURES,
  IDLE_NUDGES,
  SILENCE_END_MS,
  SILENCE_NUDGES,
  SILENCE_NUDGE_MS,
  SNAG_LINES,
  emailFromLines,
  isNearRepeat,
  micMessage,
  spokenLines,
  toMessages,
  transcriptOf,
} from "@/features/mary/conversation/text";
import type { Line } from "@/features/mary/conversation/types";
import { MicUnavailableError } from "@/lib/audio-engine";

describe("isNearRepeat on short lines", () => {
  it("does not flag a short reaction whose few words appear in a longer earlier line", () => {
    expect(
      isNearRepeat("Hey — good to meet you. I'm MARY, from Omnikom.", "Good to meet you, Sarah."),
    ).toBe(false);
    expect(isNearRepeat("Got it — and what's the business called?", "Got it.")).toBe(false);
    expect(isNearRepeat("I'll be quick, then you're all set.", "You're all set.")).toBe(false);
  });

  it("still flags the identical short line, and near-identical long ones", () => {
    expect(isNearRepeat("What should I call you?", "What should I call you?")).toBe(true);
    expect(isNearRepeat("What should I call you?", "what should I call you")).toBe(true);
    expect(
      isNearRepeat(
        "So where should the invite go when early access opens?",
        "Where should the invite go, when early access opens?",
      ),
    ).toBe(true);
  });
});

describe("asides", () => {
  const lines: Line[] = [
    { id: "1", role: "mary", text: "Hi, I'm MARY." },
    { id: "2", role: "user", text: "Hi" },
    { id: "3", role: "mary", text: "You look offline.", aside: true },
    { id: "4", role: "mary", text: "Welcome back." },
  ];

  it("never reach the model", () => {
    expect(toMessages(lines).map((m) => m.content)).toEqual([
      "Hi, I'm MARY.",
      "Hi",
      "Welcome back.",
    ]);
  });

  it("never count as something she said, but do stay in the record", () => {
    expect(spokenLines(lines)).toEqual(["Hi, I'm MARY.", "Welcome back."]);
    expect(transcriptOf(lines)).toContain("MARY: You look offline.");
  });
});

describe("emailFromLines", () => {
  it("finds the last address the person typed, however it was punctuated", () => {
    expect(
      emailFromLines([
        { id: "1", role: "user", text: "I'm Sam, sam@example.com." },
        { id: "2", role: "mary", text: "Sorry, once more?" },
        { id: "3", role: "user", text: "Hello? Use Sam.Rivera@Example.co.uk, please" },
      ]),
    ).toBe("sam.rivera@example.co.uk");
    expect(emailFromLines([{ id: "1", role: "user", text: "no email here" }])).toBe("");
    expect(emailFromLines([{ id: "1", role: "mary", text: "a@b.co" }])).toBe("");
  });
});

describe("microphone copy", () => {
  it("points at a control that exists and offers typing every time", () => {
    for (const reason of ["denied", "busy", "unknown"] as const) {
      const text = micMessage(new MicUnavailableError(reason));
      expect(text).toMatch(/mic button/);
      expect(text).toMatch(/typ/i);
    }
    expect(micMessage(new MicUnavailableError("denied"))).toMatch(/browser settings/);
    expect(micMessage(new MicUnavailableError("no-device"))).toMatch(/Typing works/);
  });
});

describe("silence and failure constants", () => {
  it("check in sooner when she cannot hear the room, and let go well after the last check-in", () => {
    expect(SILENCE_NUDGE_MS.cannotHear).toBeLessThan(SILENCE_NUDGE_MS.canHear);
    expect(SILENCE_END_MS).toBeGreaterThan(SILENCE_NUDGE_MS.canHear * SILENCE_NUDGES.hold.length);
    expect(SILENCE_NUDGES.hold.every((line) => /hold the button/i.test(line))).toBe(true);
    expect(SILENCE_NUDGES["hands-free"].every((line) => !/button/i.test(line))).toBe(true);
    expect(IDLE_NUDGES.every((line) => /type|typ/i.test(line))).toBe(true);
  });

  it("apologises with different words, and not more than twice", () => {
    expect(new Set(SNAG_LINES).size).toBe(SNAG_LINES.length);
    expect(FALLBACK_AFTER_FAILURES).toBe(2);
  });
});
