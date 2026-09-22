# Pin the details rail to the true edge of the screen

## Problem

The captured-details rail (Name, Email, Phone, Business, Industry, Operations) renders mid-screen, right beside MARY's text, instead of floating at the far right edge of the window where the annotation shows it should be.

Root cause: the rail uses `position: fixed`, but it is mounted inside the live conversation section, which is an animated element (it enters with a move + blur). Browsers treat any transformed/filtered ancestor as the anchor for `fixed` positioning, so the rail pins itself to the conversation column's edge instead of the screen's edge. That is exactly the misplaced box in the screenshot.

## What changes

- **Rail at the true screen edge.** Move the rail out of the animated conversation section and mount it at the top level of the experience, where nothing transformed wraps it. It then genuinely floats at the far right edge of the window, vertically centred, as a quiet overlay with no layout footprint.
- **Fly-in still comes from far off-screen.** Captured details keep flying in from beyond the right edge and settling onto the rail — now noticeably farther, since the rail truly sits at the edge.
- **Conversation stays centred and never collides.** The conversation column keeps its reserved right-side padding so no message, MARY line, or composer can slide beneath the rail at any window width; on phones the rail stays dots-only.
- **Everything else untouched.** Voice, hands-free flow, sphere, waitlist logic, tokens and one-screen no-scrollbar layout stay exactly as they are.

## Technical notes

- `src/components/mary-experience.tsx`: move the `<ProgressConstellation />` mount from inside the live `motion.section` to the untransformed outer shell (rendered once for the live stage, alongside it rather than within it).
- `src/components/progress-constellation.tsx`: keep `fixed right-3 sm:right-5 lg:right-8 top-1/2`; bump the fly-in distance (`x: 220` → larger) so the entrance visibly travels from off-screen now that the rail is at the edge.
- Verify with Playwright at 1018×702 and 1280×800: rail's right edge sits within ~40px of the window edge, no bubble overlaps its bounds, and the full signup still completes cleanly.
