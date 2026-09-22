# A proper opening: boot handoff and the logo transition

Two sequences to build, both purely visual.

## 1. The boot screen hands over properly

Right now the loading screen is whatever shows while the app is getting ready, and the moment it is ready it is simply replaced — a hard cut, with a length that is entirely at the mercy of how fast the page loads (sometimes a flash, sometimes a hang).

New behaviour:

- The boot sequence always plays for a sensible minimum (around 1.6s) so it never flashes, and never lingers once the app is ready — whichever finishes last ends it.
- When it ends, it does not cut. The ring of light expands and dissolves outward, the "MARY" letters and the caption lift and blur away, and the home page rises into place underneath with the same soft vertical reveal the rest of the app uses — so the boot screen becomes the home page rather than being swapped for it.
- The home page's own entrance is staggered behind that handoff: the logo settles first, then the label, headline, supporting line, sphere, button and proof row follow in the existing rhythm.
- With reduced motion on, the boot screen holds briefly and cross-fades.

## 2. The "Talk to MARY" logo transition

Clicking "Talk to MARY" currently just swaps screens. The new sequence, in order:

1. "A product by omnikom" slides left and is wiped away behind the thin divider line, which stays put — as if it slid back into it. The divider then collapses.
2. Everything below the logo (label, headline, copy, sphere, button, proof row) scrolls upward and blurs away as it goes.
3. The OmniSuite logo travels to the centre of the screen and scales up as it moves.
4. At centre it brightens, then pops — fading as it shoots off toward the top-left, arriving at its small resting position in the header corner.
5. Only then does the conversation view play its entrance: sphere, then the detail rail, then MARY's first line and the composer.

The whole thing runs about 1.5s, is skipped entirely under reduced motion (straight cross-fade), and cannot be re-triggered by a second click.

## Technical notes

- New `src/components/boot-gate.tsx` (or equivalent state in `src/routes/index.tsx`): keep `MaryBoot` mounted above `MaryExperience` and unmount it on a timer of `max(minimum elapsed, hydrated)`, animating its exit with `AnimatePresence` — `MaryExperience` mounts underneath immediately so its entrance runs during the handoff. `ClientOnly` still supplies the SSR fallback.
- `src/components/mary-boot.tsx`: add exit keyframes (ring scale-out + fade, letters lift/blur) driven by an `exiting` prop, honouring the existing reduced-motion block.
- `src/components/brand-lockup.tsx`: accept a `transition` phase prop; the attribution animates `clipPath`/`x` into the divider, the divider collapses via `scaleY`, and the whole lockup is wrapped in a `motion.div` whose layout is driven by the phase.
- `src/components/mary-experience.tsx`: add an intermediate `"intro"` stage between `landing` and `live`. `begin()` sets `intro`, a timeline (staggered `motion` variants, no new library) runs the four beats, then sets `live`. Landing content exits with upward translate + blur; the lockup travels using a `motion.div` with `animate` targets computed from the header/stage box (or a fixed-position overlay clone during the flight) so it lands exactly on the header position. Guard with a ref so repeat clicks are ignored; reduced motion jumps straight to `live`.
- Reuse the existing `EASE`, `STAGE_IN`, `SOFT`, `SPRING` vocabulary throughout — no new easing.
- Verify with Playwright at 1368x892 and 390x844: capture frames through the boot handoff and the click transition, confirm the header lockup ends at its normal position, no console errors, no layout shift, then format/typecheck/lint.
