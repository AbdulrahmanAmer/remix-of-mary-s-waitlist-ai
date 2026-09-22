# Cleaner stage, sharper sphere, neutral paper

Four changes, all visual. Nothing about the conversation, the voice, the waitlist capture or the layout behaviour changes.

## 1. Remove the status line above the conversation

The small row above the chat currently shows a state word on the left (Hands-free / Listening / Thinking / Speaking) and "MARY · AI Revenue Concierge" on the right. The sphere already communicates her state clearly, and the right-hand label repeats what the landing screen just said.

Both go away. The sphere sits directly above the conversation, with the spacing rebalanced so nothing looks stranded where the row used to be.

## 2. Make the sphere's surface truly transparent

The sphere sits on a faint textured wash that reads as a patch of grain over the paper. That grain layer was there to smooth the glow, but it is now doing more harm than good — it gets removed entirely, so the sphere floats on clean paper with nothing behind it but its own light.

## 3. Sharper, higher-resolution sphere

The sphere gets drawn at a genuinely high pixel density (up to 4x, capped so phones stay smooth), with more segments along each tube and a tighter, cleaner core edge. Smooth gradient falloff stays, so removing the grain does not bring banding back — the extra resolution handles it.

## 4. Neutral background

The wide lime wash behind the page is removed, so the background is plain warm paper. The soft edge vignette stays, and the sphere keeps its own lime glow — the colour lives on MARY, not on the whole screen.

## Technical notes

- `src/components/mary-experience.tsx`: delete the status row block in the live stage (the hands-free dot, `PRESENCE_LABEL` line and the "MARY · AI Revenue Concierge" span), adjust the trail's top margin; drop `PRESENCE_LABEL` if it becomes unused.
- `src/components/mary-presence.tsx`: remove `grainFor` and its draw call; raise the supersample cap from 3 to 4 (small screens stay at 2) and increase tube segment count; keep the `visualViewport` re-rasterise on zoom.
- `src/styles.css`: neutralise the `brand-focus` utility (remove the lime radial), leaving `paper-vignette` as-is.
- `src/components/aurora-background.tsx`: keep the intensity prop wiring, but the focus layer no longer tints the page.
- Verify with Playwright at 1582x892 and 390x844: landing and live screenshots, no console errors, then format/typecheck/lint.
