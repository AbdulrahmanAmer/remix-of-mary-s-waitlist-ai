import { describe, expect, it } from "vitest";

import { initialState } from "@/features/mary/conversation/reducer";
import {
  captionAnnouncement,
  floorFor,
  floorLine,
  handsFreeStatus,
  NOTICE_TEXT,
  noticeAnnouncement,
} from "@/features/mary/ui/floor";

describe("floorFor", () => {
  it("gives the person the floor only when she is neither talking nor thinking", () => {
    expect(floorFor("idle", "listening")).toBe("yours");
    expect(floorFor("listening", "paused")).toBe("yours");
    expect(floorFor("speaking", "listening")).toBe("hers-speaking");
    expect(floorFor("thinking", "listening")).toBe("hers-thinking");
    expect(floorFor("idle", "finishing")).toBe("hers-thinking");
  });

  it("a held button wins over everything else", () => {
    expect(floorFor("speaking", "hearing")).toBe("listening");
    expect(floorFor("thinking", "hearing")).toBe("listening");
  });
});

describe("floorLine", () => {
  it("names the turn in plain words and mentions the space bar only with a keyboard", () => {
    expect(floorLine("yours", false)).toBe("Your turn — hold to answer");
    expect(floorLine("yours", true)).toContain("space bar");
    expect(floorLine("hers-speaking", false)).toMatch(/hold to cut in/);
    expect(floorLine("hers-thinking", false)).toMatch(/thinking/);
    expect(floorLine("listening", true)).toMatch(/let go/);
  });
});

describe("handsFreeStatus", () => {
  const base = {
    presence: "idle" as const,
    listening: "listening" as const,
    micLive: true,
    micMuted: false,
  };
  it("describes the open line, the muted line and typing-only", () => {
    expect(handsFreeStatus(base)).toMatch(/Just talk/);
    expect(handsFreeStatus({ ...base, micMuted: true })).toMatch(/muted/);
    expect(handsFreeStatus({ ...base, micLive: false })).toMatch(/Type your reply/);
    expect(handsFreeStatus({ ...base, presence: "speaking" })).toMatch(/cut in/);
    expect(handsFreeStatus({ ...base, presence: "speaking", micLive: false })).toBe(
      "MARY is speaking.",
    );
  });
});

describe("noticeAnnouncement", () => {
  const notices = initialState().notices;
  const mic = { live: true, error: null };
  it("is silent when nothing is wrong", () => {
    expect(noticeAnnouncement(notices, mic)).toBe("");
  });
  it("puts a microphone error before every hint", () => {
    expect(
      noticeAnnouncement({ ...notices, missedHold: true }, { live: false, error: "No mic" }),
    ).toBe("No mic");
    expect(noticeAnnouncement({ ...notices, missedHold: true, echoHint: true }, mic)).toBe(
      NOTICE_TEXT.missedHold,
    );
  });
  it("mentions headphones only while the microphone is live", () => {
    expect(noticeAnnouncement({ ...notices, echoHint: true }, mic)).toBe(NOTICE_TEXT.echoHint);
    expect(noticeAnnouncement({ ...notices, echoHint: true }, { live: false, error: null })).toBe(
      "",
    );
  });
});

describe("captionAnnouncement", () => {
  it("reads her words only when her voice is not the channel", () => {
    const text = "Good to meet you.";
    expect(
      captionAnnouncement({ text, floor: "hers-speaking", voiceOff: true, voiceFailed: false }),
    ).toBe("MARY: Good to meet you.");
    expect(
      captionAnnouncement({ text, floor: "hers-speaking", voiceOff: false, voiceFailed: true }),
    ).toBe("MARY: Good to meet you.");
    expect(
      captionAnnouncement({ text, floor: "hers-speaking", voiceOff: false, voiceFailed: false }),
    ).toBe("MARY is speaking");
    expect(captionAnnouncement({ text, floor: "yours", voiceOff: false, voiceFailed: false })).toBe(
      "Your turn",
    );
  });
  it("says nothing before her first line", () => {
    expect(
      captionAnnouncement({ text: null, floor: "yours", voiceOff: false, voiceFailed: false }),
    ).toBe("");
  });
});
