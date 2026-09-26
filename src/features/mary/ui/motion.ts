// One motion vocabulary for the whole experience. Transform and opacity only:
// no animated blur or layout properties on large surfaces, which is what made the
// old screens stutter.
export const EASE = [0.22, 1, 0.36, 1] as const;
export const SOFT = { duration: 0.45, ease: EASE } as const;
export const QUICK = { duration: 0.28, ease: EASE } as const;
/** A caption leaving to make room for the next: fast and opacity-only, so two never overlap. */
export const SWAP = { duration: 0.12, ease: EASE } as const;
export const ORB_FLIGHT = { type: "spring", stiffness: 120, damping: 22, mass: 1 } as const;

/** Staggered entrance for a column of elements. */
export const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { ...SOFT, delay },
});
