import { describe, expect, it } from "vitest";

import {
  DONE_REST_S,
  isSoftwareRenderer,
  nextFrameDelay,
  orbInterval,
  orbShouldRest,
  SOFTWARE_FPS,
} from "@/features/mary/ui/orb-pace";

describe("orbInterval", () => {
  it("runs at full rate only while a voice moves the orb", () => {
    expect(orbInterval("speaking")).toBeCloseTo(1000 / 60);
    expect(orbInterval("hearing")).toBeCloseTo(1000 / 60);
    expect(orbInterval("idle")).toBeGreaterThan(1000 / 30);
    expect(orbInterval("listening")).toBeCloseTo(1000 / 30);
    expect(orbInterval("done")).toBeCloseTo(1000 / 30);
  });

  it("caps every state on a software renderer", () => {
    expect(orbInterval("speaking", true)).toBeCloseTo(1000 / SOFTWARE_FPS);
    expect(orbInterval("idle", true)).toBeCloseTo(1000 / SOFTWARE_FPS);
    expect(orbInterval("idle", true)).toBeGreaterThan(orbInterval("idle"));
  });
});

describe("orbShouldRest", () => {
  it("rests only on the end screen, after the bloom has faded and settled", () => {
    expect(orbShouldRest("done", DONE_REST_S + 1, 0)).toBe(true);
    expect(orbShouldRest("done", DONE_REST_S + 1, 0.2)).toBe(false);
    expect(orbShouldRest("done", 1, 0)).toBe(false);
    expect(orbShouldRest("idle", 100, 0)).toBe(false);
    expect(orbShouldRest("speaking", 100, 0)).toBe(false);
  });
});

describe("nextFrameDelay", () => {
  it("waits out the rest of the interval, trimmed for rAF's own frame, never negative", () => {
    expect(nextFrameDelay(1000 / 30, 4)).toBeCloseTo(1000 / 30 - 10);
    expect(nextFrameDelay(1000 / 60, 20)).toBe(0);
  });
});

describe("isSoftwareRenderer", () => {
  it("recognises the software GL strings and leaves real GPUs alone", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe(
      true,
    );
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)")).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });
});
