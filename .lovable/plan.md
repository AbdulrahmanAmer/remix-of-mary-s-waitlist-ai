# Fix the sphere: spacing and image quality

Two separate problems are visible in your screenshot.

## 1. The sphere sits in a box far wider than itself

The area reserved for MARY is a wide rectangle (roughly 448 x 182), but the sphere is drawn from the smaller of the two sides, so it only fills the middle third. That leaves large dead gaps left and right, and the drawing surface is also stretched 30% above and below its own box to fit the glow — so the space the layout reserves and the space the sphere actually occupies never match.

Fix:
- Make MARY's area square and centred, sized from the height available, so there is no empty width around her.
- Remove the stretched overflow trick. The glow and ground shadow get a proper margin inside the square instead, so nothing is clipped and nothing overhangs.
- Landing, live and confirmation views all use the same square presence, with the size still adapting to short windows.

## 2. The pixelated, banded look

Three things are stacking up:
- The picture is rendered at the screen's raw pixel density (1.25x here). Wide, very soft glows need more resolution than that or they step.
- The halo and inner light are broad gradients that fade from a few percent opacity to zero. On an 8-bit canvas that fade can only be drawn in visible steps — the concentric rings you see.
- Each tube of light is drawn as six stacked near-transparent strokes; every pass rounds its own colour, so the steps pile up and the edges go chalky rather than luminous.

Fix:
- Always render at a minimum of 2x pixel density (supersampling) regardless of the screen, so soft edges resolve smoothly.
- Rebuild the glows so light adds up instead of layering transparency: draw the halo, inner pool and tube blooms in additive mode with a smooth multi-stop falloff, which removes the ring stepping entirely.
- Collapse the six stroke passes down to three (wide bloom, mid body, bright core) with stronger values, so the tube reads as one solid filament of light with a soft edge rather than six faint outlines.
- Add a very fine noise dither over the glow area, at a level you cannot consciously see, which breaks up any remaining banding.
- Cap the cost so phones stay smooth: fewer curve segments and 2x (not higher) density on small screens.

Colours, brand tokens, states, voice reactivity and reduced-motion behaviour stay exactly as they are.

## Technical notes

- `src/components/mary-presence.tsx` only.
- Wrapper becomes a centred square (`aspect-square`, width driven by the `height` prop); canvas fills it with no negative insets. `R0` derived as `min(w, h) / 2 * SPHERE_FRACTION` with an explicit halo/shadow margin constant.
- `resize()`: `dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1))`, small screens clamp to 2.
- Halo / inner pool / bloom passes drawn with `globalCompositeOperation = "lighter"` and 5-6 eased gradient stops; `PASSES` reduced to 3 entries.
- Dither: one small tiled noise pattern generated once, drawn over the sphere bounds at ~1.5% alpha.
- `src/components/mary-experience.tsx`: the `max-w-md` wrappers around `MaryPresence` change to a centred square sized from `landingOrb` / `liveOrb`.
- Verify with Playwright at 1018x702, 1280x800 and 390x844: no scrollbars, sphere fully inside its area, zoomed element screenshots to confirm the banding is gone.
