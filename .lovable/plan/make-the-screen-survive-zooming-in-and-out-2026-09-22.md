# Make the screen survive zooming in and out

I captured the page at five window sizes (1920x1080, 1582x892, 1280x800, 1018x702, 390x844) and seven browser zoom levels (50% to 200%). Three real problems showed up.

## What breaks today

**1. Zoomed in, the bottom of the page is cut off and unreachable.**
At 125% and above the "Talk to MARY" button, the "voice or text" line and the proof row fall below the bottom of the window. Because the page is locked to exactly one screen with scrolling switched off, nothing scrolls and the button simply cannot be reached. On a phone-width window at 150% the button sits 923px down in an 844px window — completely invisible. This is the most serious issue: at higher zoom the page becomes unusable.

**2. Zoomed out, everything shrinks into the top corner.**
At 50% and 67% the whole composition sits in the top third and the rest of the screen is a big empty field. The layout still thinks the window is the original size, so it doesn't rescale with the zoom.

**3. The sphere sits in a visible square patch.**
At every zoom you can see a faint rectangle of slightly different shade around the sphere, because its drawing surface paints a very light tint instead of being fully transparent over the paper background.

No horizontal scrollbar and no page scrollbar appeared at any size, and there were no errors.

## The fix

**Keep one screen, but never trap the user.**
The page stays a single, non-scrolling screen whenever everything fits. The moment the content genuinely can't fit — heavy zoom, a very short window — the screen quietly allows scrolling instead of clipping, with the scrollbar hidden so no bar ever appears at the edge. Nothing is ever unreachable again.

**Scale the composition to the space it actually has.**
Instead of reading the window height alone, the landing, live and confirmation views measure the real space they're given and step their sizes down in more stages than the current single "short window" step: headline, spacing, sphere size and the proof row all shrink smoothly. Zoomed out, the composition re-centres in the window instead of hugging the top, so the empty field disappears.

**Sphere blends into the paper.**
Its drawing surface becomes genuinely transparent, so the square patch disappears and the glow sits on the paper at every zoom. It also redraws at the correct sharpness when zoom changes, so it never goes soft or blocky after a zoom step.

**The side rail follows the zoom.**
The details rail stays pinned to the true right edge and keeps its clear gap from the conversation at every zoom level; at heavy zoom it drops to dots only rather than colliding with the text.

## Verification

Re-run the same sweep — five window sizes x seven zoom levels — and confirm for each: no horizontal scroll, the "Talk to MARY" button fully inside the window, the conversation and composer clear of the rail, the sphere uncut, and no console errors. Screenshots at 50%, 100% and 200% on desktop and mobile for a visual pass.

## Technical notes

- `src/styles.css`: replace the hard `overflow: hidden` on `html`/`body` with an app shell that is `min-h-dvh` and scrolls only on overflow, retaining `no-scrollbar`; keep `overscroll-behavior: none`.
- `src/components/mary-experience.tsx`: shell `h-dvh` -> `min-h-dvh` with `overflow-y-auto no-scrollbar`; replace the single `compact` boolean with a small size-step helper derived from a `ResizeObserver` on the stage (not just `window.innerHeight`), feeding headline/spacing/orb classes; landing and done sections centre with `my-auto`.
- `src/components/mary-presence.tsx`: `getContext('2d', { alpha: true })`, drop the background fill; recompute `dpr` on `visualViewport` `resize`/`scale` change so zoom re-rasterises crisply.
- `src/components/progress-constellation.tsx`: keep `fixed` at the shell root; tie the label-visible breakpoint to the measured stage width so heavy zoom collapses it to dots.
- Verification script: `/tmp/browser/zoom/check.py` (already written) plus per-zoom assertions on the CTA rect and rail overlap.
