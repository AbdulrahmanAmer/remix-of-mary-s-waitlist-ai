import { describe, expect, it } from "vitest";

import { CALL_ORB_SHARES, fitOrb, LANDING_ORB_SHARES } from "@/features/mary/ui/fit";

describe("fitOrb", () => {
  it("leaves the orb alone on a tall screen", () => {
    expect(fitOrb(280, 844, CALL_ORB_SHARES)).toBe(280);
    expect(fitOrb(300, 900, LANDING_ORB_SHARES)).toBe(300);
  });

  it("shrinks it on a short phone so the caption keeps its lines", () => {
    // iPhone SE: the app asks for 0.3 * 667 = 200; the words need it nearer 147.
    expect(fitOrb(200, 667, CALL_ORB_SHARES)).toBe(147);
    expect(fitOrb(213, 667, LANDING_ORB_SHARES)).toBe(173);
  });

  it("shrinks it further on a phone on its side, and never grows it", () => {
    expect(fitOrb(140, 390, CALL_ORB_SHARES)).toBe(109);
    expect(fitOrb(100, 390, CALL_ORB_SHARES)).toBe(100);
    expect(fitOrb(170, 390, LANDING_ORB_SHARES)).toBe(140);
  });
});
