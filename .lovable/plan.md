# Reworking the "Join The Waitlist" transition

Right now the page lifts away and the logo flies to the centre, blooms, then fades out toward the corner — the fade makes the landing feel like it evaporates rather than transforms.

The new version, taking the scroll-craft motion feel (long, weighted easing; scale and blur doing the work instead of opacity; one thing moving at a time):

## The sequence

1. **The attribution wipes away.** "A product by omnikom" slides left and disappears behind the thin divider, then the divider collapses. (Unchanged.)

2. **The whole page zooms out.** Instead of only the content below the logo scrolling up, the entire landing composition — headline, copy, sphere, button, proof row — recedes: it scales down slightly, softens with blur, and loses light, as if the camera pulls back. It never moves upward abruptly; it settles backward.

3. **The logo grows into the centre.** As the page recedes, the mark travels to the middle of the screen and scales up, larger than before, staying perfectly sharp at every size. It arrives with weight — fast at first, easing into stillness — and holds for a beat with a soft glow.

4. **It pops into the corner.** Rather than fading out, the logo shrinks and travels in one continuous move to its resting place in the top-left header corner, arriving with a small settle. Nothing disappears mid-flight, so the eye follows it the whole way.

5. **The conversation rises.** Once the logo lands, the sphere, the detail rail and MARY's first line come up underneath in the existing rhythm.

Total length stays around 1.5s. Reduced-motion users still get a straight cross-fade, and a second click is still ignored.

## Notes

The logo ends in its normal header position at the top-left — the same place it sits during the conversation — so the header doesn't shift afterwards.

## Technical

- `src/components/mary-experience.tsx`
  - `Flight` gains a third point: `to` (the measured header resting rect), so the mark animates `from → mid → to` in one keyframed tween instead of fading at the end. Opacity stays 1 throughout; the hand-off to the real header lockup happens on the final frame (`hidden` prop flips off as the flight unmounts).
  - The landing exit changes from `y: -90 / blur(12px)` to a recede: `scale: 0.92`, `opacity: 0`, `filter: blur(14px)`, with a slight `y` drift only, using `STAGE_IN` easing.
  - Centre size cap raised (mark grows larger at centre) while still clamped to its native width so it never softens.
  - Flight `times` retimed to `[0, 0.46, 0.66, 1]`: travel in, hold, then the pop to the corner with a spring-flavoured settle on the last leg.
  - Measure the header rect in the same 420ms timeout that measures the start rect (the header lockup is in the DOM the whole time), storing it as `flight.to`.
- No new dependencies, no token changes, no changes to the boot handoff, sphere, voice, rail, or conversation logic.
