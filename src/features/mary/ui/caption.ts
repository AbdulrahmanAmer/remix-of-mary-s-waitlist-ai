import type { Line } from "../conversation/types";

/**
 * What the caption area shows: the person's last words (echo), her newest line
 * (the caption) and, where there is room, the beat she said just before it.
 */
export function captionOf(lines: Line[]): {
  lastUser: Line | undefined;
  current: Line | undefined;
  before: Line | undefined;
} {
  const lastUserIndex = lines.map((l) => l.role).lastIndexOf("user");
  const lastUser = lastUserIndex >= 0 ? lines[lastUserIndex] : undefined;
  const maryNow = lines.slice(lastUserIndex + 1).filter((l) => l.role === "mary");
  return {
    lastUser,
    current: maryNow[maryNow.length - 1],
    before: maryNow.length > 1 ? maryNow[maryNow.length - 2] : undefined,
  };
}

/**
 * Type size for her line: long lines step down so they fit the clamped box on a
 * phone instead of being sliced by its edge. The classes are static strings so
 * Tailwind can see them.
 */
export function captionSize(text: string): string {
  const length = text.length;
  if (length > 150) return "text-lg sm:text-2xl";
  if (length > 90) return "text-xl sm:text-[1.6rem]";
  return "text-2xl sm:text-[2.1rem]";
}

/** The page title while the call is up, so tabs and screen readers say where they are. */
export const CALL_TITLE = "Talking with MARY · OmniSuite";
