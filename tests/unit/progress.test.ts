import { describe, expect, it } from "vitest";

import { progressOf } from "@/features/mary/ui/progress";

describe("progressOf", () => {
  it("marks saved fields, the next open one, and the rest", () => {
    const { pills, saved, total, next } = progressOf({ name: "Sarah Okafor" });
    expect(saved).toBe(1);
    expect(total).toBe(6);
    expect(next).toBe("email");
    expect(pills[0]).toMatchObject({
      field: "name",
      state: "saved",
      text: "Sarah Okafor",
      hint: "Name saved",
    });
    expect(pills[1]).toMatchObject({
      field: "email",
      state: "next",
      text: "Email",
      hint: "up next",
    });
    expect(pills[3]).toMatchObject({ field: "business", state: "open", hint: "still to come" });
  });

  it("says phone is optional until it is given, and never shows the operations text", () => {
    const open = progressOf({ name: "S", email: "s@x.co" });
    expect(open.pills.find((p) => p.field === "phone")?.text).toBe("Phone (optional)");
    const full = progressOf({
      name: "S",
      email: "s@x.co",
      phone: "+1 415 555 0142",
      business: "Roof Co",
      industry: "Roofing",
      operations: "Two crews, a paper diary and a part-time dispatcher",
    });
    expect(full.next).toBeUndefined();
    expect(full.saved).toBe(6);
    expect(full.pills.find((p) => p.field === "phone")?.text).toBe("+1 415 555 0142");
    expect(full.pills.find((p) => p.field === "operations")?.text).toBe("Operations");
  });
});
