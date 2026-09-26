/**
 * The orb the app asked for, or less where the screen cannot give the words
 * their room: a short phone (iPhone SE and the like) and a phone on its side.
 * `shares` are fractions of the viewport height for those two cases.
 */
export function fitOrb(
  orbSize: number,
  viewportHeight: number,
  shares: { short: number; tight: number },
): number {
  if (viewportHeight <= 480) return Math.min(orbSize, Math.round(viewportHeight * shares.short));
  if (viewportHeight < 720) return Math.min(orbSize, Math.round(viewportHeight * shares.tight));
  return orbSize;
}

/** On the call screen the words come first; the orb yields to them. */
export const CALL_ORB_SHARES = { short: 0.28, tight: 0.22 } as const;
/** On the landing the orb is the picture, but the Start button must stay above the fold. */
export const LANDING_ORB_SHARES = { short: 0.36, tight: 0.26 } as const;
