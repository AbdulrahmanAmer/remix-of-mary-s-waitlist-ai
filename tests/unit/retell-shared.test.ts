import { describe, expect, it } from "vitest";

import {
  CALL_ID,
  ContextSchema,
  InjectBodySchema,
  OPENING_LINES,
  SaveLeadArgsSchema,
  SESSION_ID,
  toCollected,
  welcomeBackLine,
} from "@/lib/retell-shared";

describe("welcomeBackLine", () => {
  it("greets by first name", () => {
    expect(welcomeBackLine("Leo Marsh")).toBe(
      "Hey Leo — good to have you back. It's MARY. Where were we?",
    );
  });

  it("still reads naturally without a name", () => {
    expect(welcomeBackLine("")).toBe("Hey — good to have you back. It's MARY. Where were we?");
  });
});

describe("toCollected", () => {
  it("drops empty and missing values", () => {
    expect(
      toCollected({ name: "Leo", email: "", business: undefined, industry: "plumbing" }),
    ).toEqual({
      name: "Leo",
      industry: "plumbing",
    });
  });
});

describe("ids", () => {
  it("accepts session ids the browser produces, including the storage-less fallback", () => {
    expect(SESSION_ID.safeParse("w_lx3k2_ab12cd").success).toBe(true);
    expect(SESSION_ID.safeParse("session").success).toBe(true);
    expect(SESSION_ID.safeParse("a b").success).toBe(false);
    expect(SESSION_ID.safeParse("x".repeat(81)).success).toBe(false);
  });

  it("bounds call ids", () => {
    expect(CALL_ID.safeParse("call_1234").success).toBe(true);
    expect(CALL_ID.safeParse("short").success).toBe(false);
    expect(CALL_ID.safeParse("c".repeat(129)).success).toBe(false);
    expect(CALL_ID.safeParse("call/../x").success).toBe(false);
  });
});

describe("InjectBodySchema", () => {
  const base = { callId: "call_1234", sessionId: "w_1" };

  it("trims the typed text", () => {
    expect(InjectBodySchema.parse({ ...base, text: "  jo@acme.com  " }).text).toBe("jo@acme.com");
  });

  it("rejects empty and oversize text", () => {
    expect(InjectBodySchema.safeParse({ ...base, text: "   " }).success).toBe(false);
    expect(InjectBodySchema.safeParse({ ...base, text: "a".repeat(501) }).success).toBe(false);
  });
});

describe("SaveLeadArgsSchema", () => {
  it("trims and caps values and turns empty strings into null", () => {
    const args = SaveLeadArgsSchema.parse({
      name: "  Leo  ",
      email: "",
      business: "b".repeat(250),
    });
    expect(args.name).toBe("Leo");
    expect(args.email).toBeNull();
    expect(args.business).toHaveLength(200);
  });

  it("accepts a numeric phone as text", () => {
    expect(SaveLeadArgsSchema.parse({ phone: 5551234 }).phone).toBe("5551234");
  });

  it("defaults a missing or unknown stage to final", () => {
    expect(SaveLeadArgsSchema.parse({}).stage).toBe("final");
    expect(SaveLeadArgsSchema.parse({ stage: "later" }).stage).toBe("final");
    expect(SaveLeadArgsSchema.parse({ stage: "callback" }).stage).toBe("callback");
  });

  it("only takes a real boolean for callback_requested", () => {
    expect(SaveLeadArgsSchema.parse({ callback_requested: "yes" }).callback_requested).toBeNull();
    expect(SaveLeadArgsSchema.parse({ callback_requested: true }).callback_requested).toBe(true);
  });
});

describe("ContextSchema", () => {
  it("truncates an oversize value instead of rejecting the call", () => {
    expect(ContextSchema.parse({ language: "x".repeat(100) }).language).toHaveLength(40);
  });
});

describe("OPENING_LINES", () => {
  it("names the product, asks one question and stays short", () => {
    for (const line of OPENING_LINES) {
      expect(line).toContain("OmniSuite");
      expect(line.endsWith("?")).toBe(true);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(40);
    }
  });
});
