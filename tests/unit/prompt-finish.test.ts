import { describe, expect, it } from "vitest";

import { closingLine, finishTurn, type TurnObject } from "@/lib/mary-prompt.server";
import { spotSecured, REQUIRED_FIELDS } from "@/lib/mary.functions";

const a = (content: string) => ({ role: "assistant" as const, content });
const u = (content: string) => ({ role: "user" as const, content });
const flags = { revealed: false, lanesDone: false, introDone: true };

const model = (over: Partial<TurnObject> = {}): TurnObject => ({
  say: "Sure.",
  followUp: null,
  name: null,
  nameEvidence: null,
  email: null,
  phone: null,
  business: null,
  businessEvidence: null,
  industry: null,
  industryEvidence: null,
  operations: null,
  operationsEvidence: null,
  nextField: "none",
  complete: false,
  declined: false,
  intent: "answering",
  mode: "neutral",
  callbackRequested: false,
  wrapAsked: false,
  phase: "DISCOVER",
  revealed: false,
  lanesDone: false,
  introDone: true,
  ...over,
});

const dana = {
  messages: [
    a("Hi"),
    u("I'm Dana, dana k at gmail dot com"),
    a("d-a-n-a-k at gmail dot com?"),
    u("yep"),
  ],
  collected: { name: "Dana", email: "danak@gmail.com" },
  flags,
};

describe("spotSecured", () => {
  it("is name and email, nothing more", () => {
    expect(REQUIRED_FIELDS).toEqual(["name", "email"]);
    expect(spotSecured({ name: "Dana", email: "d@x.co" })).toBe(true);
    expect(spotSecured({ name: "Dana", email: " " })).toBe(false);
    expect(spotSecured({ name: "Dana", business: "Acme", industry: "x", operations: "y" })).toBe(
      false,
    );
  });
});

describe("finishTurn and the spot", () => {
  it("completes on name and email, even with no business on record", () => {
    const turn = finishTurn(model({ complete: true, phase: "CLOSE" }), dana);
    expect(turn.complete).toBe(true);
    expect(turn.declined).toBe(false);
  });

  it("never completes without the email, whatever the model says", () => {
    const turn = finishTurn(model({ complete: true, phase: "CLOSE" }), {
      ...dana,
      collected: { name: "Dana", business: "Acme", industry: "x", operations: "y" },
    });
    expect(turn.complete).toBe(false);
  });

  it("someone leaving with name and email leaves signed up, not declined", () => {
    const turn = finishTurn(model({ declined: true, intent: "leaving", phase: "EXIT" }), dana);
    expect(turn.complete).toBe(true);
    expect(turn.declined).toBe(false);
  });

  it("an outright refusal of the spot still declines", () => {
    const turn = finishTurn(model({ declined: true, intent: "refusing", phase: "EXIT" }), dana);
    expect(turn.complete).toBe(false);
    expect(turn.declined).toBe(true);
  });

  it("leaving without an email declines, and a stray flag on an answer does nothing", () => {
    const left = finishTurn(model({ declined: true, intent: "leaving" }), {
      ...dana,
      collected: { name: "Dana" },
    });
    expect(left.declined).toBe(true);
    expect(left.complete).toBe(false);

    const stray = finishTurn(model({ declined: true, intent: "answering" }), dana);
    expect(stray.declined).toBe(false);
    expect(stray.complete).toBe(false);
  });

  it("a callback never completes the sign-up", () => {
    const turn = finishTurn(model({ complete: true, callbackRequested: true }), dana);
    expect(turn.complete).toBe(false);
    expect(turn.callbackRequested).toBe(true);
  });

  it("grounds the email before it can secure the spot", () => {
    const turn = finishTurn(model({ complete: true, email: "dana@invented.com", phase: "CLOSE" }), {
      ...dana,
      collected: { name: "Dana" },
    });
    expect(turn.collected.email).toBeUndefined();
    expect(turn.rejected).toContain("email");
    expect(turn.complete).toBe(false);
  });
});

describe("closingLine", () => {
  it("uses the first name and promises only the invite", () => {
    expect(closingLine("Dana Kim")).toBe(
      "You're on the list, Dana — your invite goes to that email the moment early access opens.",
    );
    expect(closingLine(undefined)).toBe(
      "You're on the list — your invite goes to that email the moment early access opens.",
    );
  });
});
