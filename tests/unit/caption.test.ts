import { describe, expect, it } from "vitest";

import { captionOf, captionSize } from "@/features/mary/ui/caption";

const mary = (id: string, text: string) => ({ id, role: "mary" as const, text });
const user = (id: string, text: string) => ({ id, role: "user" as const, text });

describe("captionOf", () => {
  it("shows her newest line since the person last spoke, and the beat before it", () => {
    const lines = [
      mary("a", "Hello."),
      mary("b", "What's your name?"),
      user("c", "Sarah"),
      mary("d", "Hi Sarah."),
      mary("e", "What's the business?"),
    ];
    const caption = captionOf(lines);
    expect(caption.lastUser?.id).toBe("c");
    expect(caption.current?.id).toBe("e");
    expect(caption.before?.id).toBe("d");
  });

  it("has no previous beat when she has said one thing, and no echo before they speak", () => {
    const caption = captionOf([mary("a", "Hello.")]);
    expect(caption.lastUser).toBeUndefined();
    expect(caption.current?.id).toBe("a");
    expect(caption.before).toBeUndefined();
  });

  it("shows nothing of hers while she is still thinking after their words", () => {
    const caption = captionOf([mary("a", "Hello."), user("b", "Sarah")]);
    expect(caption.lastUser?.id).toBe("b");
    expect(caption.current).toBeUndefined();
  });
});

describe("captionSize", () => {
  it("steps the type down as her line gets longer", () => {
    expect(captionSize("Good to meet you.")).toBe("text-2xl sm:text-[2.1rem]");
    expect(captionSize("x".repeat(100))).toBe("text-xl sm:text-[1.6rem]");
    expect(captionSize("x".repeat(160))).toBe("text-lg sm:text-2xl");
  });
});
