import { describe, expect, it } from "vitest";

import {
  detailProblem,
  IDLE_DELIVERY,
  leadOutcomeCopy,
  type LeadDelivery,
} from "@/features/mary/conversation/lead-lifecycle";
import type { ConversationResult } from "@/features/mary/conversation/types";

const sam = { name: "Sam Rivera", email: "sam@example.com" };
const delivered = (extra: Partial<LeadDelivery> = {}): LeadDelivery => ({
  ...IDLE_DELIVERY,
  ...extra,
});
const result = (sync: ConversationResult["sync"], position: number | null = null) =>
  ({ outcome: "signed_up", position, sync }) as ConversationResult;

describe("leadOutcomeCopy", () => {
  it("shows a position only when the sheet handed one out", () => {
    const view = leadOutcomeCopy(result("sheet", 42), delivered({ saved: true }), sam);
    expect(view.eyebrow).toBe("Early access confirmed");
    expect(view.status).toEqual({
      kind: "position",
      text: "Early access position #42",
      detail: "",
    });
    expect(view.retry).toBe(false);
  });

  it("stays confirmed without a number, and only mentions an email the sheet actually sent", () => {
    const plain = leadOutcomeCopy(result("sheet"), delivered({ saved: true }), sam);
    expect(plain.status.kind).toBe("saved");
    expect(plain.status.detail).not.toMatch(/confirmation/);
    const mailed = leadOutcomeCopy(
      result("sheet", 3),
      delivered({ saved: true, emailedTo: "sam@example.com" }),
      sam,
    );
    expect(mailed.status.detail).toBe("A confirmation is on its way to sam@example.com.");
  });

  it("never claims a spot when no sheet is connected", () => {
    const view = leadOutcomeCopy(result("local"), delivered({ error: "not configured" }), sam);
    expect(view.eyebrow).toBe("Almost there");
    expect(view.title).toBe("Thanks, Sam — one more step.");
    expect(view.body).toMatch(/isn't taking sign-ups from this page yet/);
    expect(view.status).toMatchObject({ kind: "unsaved", text: "Not on the list yet" });
    expect(view.retry).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/#\d|confirmed|on the list,/i);
  });

  it("admits a failed write and offers a retry", () => {
    const view = leadOutcomeCopy(result("failed"), delivered({ error: "HTTP 500" }), sam);
    expect(view.body).toMatch(/didn't answer just now/);
    expect(view.status.kind).toBe("unsaved");
    expect(view.retry).toBe(true);
    expect(view.steps.some((step) => /Try again/.test(step))).toBe(true);
  });

  it("keeps the spot but flags a correction that did not go through", () => {
    const view = leadOutcomeCopy(
      result("failed", 42),
      delivered({ saved: true, error: "timeout" }),
      sam,
    );
    expect(view.eyebrow).toBe("Early access confirmed");
    expect(view.status.text).toMatch(/spot is saved, but the change/);
    expect(view.retry).toBe(true);
  });

  it("holds off on 'confirmed' while the first write is in flight", () => {
    const first = leadOutcomeCopy(result("pending"), delivered(), sam);
    expect(first.eyebrow).toBe("Early access");
    expect(first.title).toBe("One moment, Sam.");
    expect(first.status).toMatchObject({ kind: "pending", text: "Securing your place…" });
    const again = leadOutcomeCopy(result("pending", 42), delivered({ saved: true }), sam);
    expect(again.eyebrow).toBe("Early access confirmed");
    expect(again.status.text).toBe("Updating your details…");
  });

  it("is honest about a callback that never reached the team", () => {
    const view = leadOutcomeCopy(
      { outcome: "callback", position: null, sync: "local" },
      delivered({ error: "not configured" }),
      { name: "Dana", phone: "555 0100" },
    );
    expect(view.body).toMatch(/hasn't reached the team/);
    expect(view.status.text).toBe("Not with the team yet");
    expect(view.steps[2]).toBe("Once it goes through, a real person calls you on 555 0100");
    const ok = leadOutcomeCopy(
      { outcome: "callback", position: 5, sync: "sheet" },
      delivered({ saved: true }),
      { name: "Dana", phone: "555 0100" },
    );
    expect(ok.status.kind).toBe("none");
    expect(ok.body).toMatch(/with the Omnikom team/);
  });

  it("leaves a declined conversation alone whatever the sheet said", () => {
    const view = leadOutcomeCopy(
      { outcome: "declined", position: null, sync: "failed" },
      delivered({ error: "HTTP 500" }),
      sam,
    );
    expect(view.eyebrow).toBe("No pressure");
    expect(view.status.kind).toBe("none");
    expect(view.retry).toBe(false);
  });
});

describe("detailProblem", () => {
  it("accepts real contact details and rejects the obviously wrong", () => {
    expect(detailProblem("email", "sam@riverahomes.com")).toBe("");
    expect(detailProblem("email", "sam at gmail dot com")).toMatch(/email/);
    expect(detailProblem("email", "sam@example")).toMatch(/email/);
    expect(detailProblem("name", "  ")).toMatch(/name/);
    expect(detailProblem("name", "Sam")).toBe("");
    expect(detailProblem("phone", "")).toBe("");
    expect(detailProblem("phone", "+1 555 010 2030")).toBe("");
    expect(detailProblem("phone", "call me")).toMatch(/phone/);
  });
});
