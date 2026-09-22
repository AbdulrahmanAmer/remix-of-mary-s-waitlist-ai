# One screen, no scrollbars, nothing overlapping

The page should behave like an app, not a document: it fills the window exactly, never scrolls, and no scrollbar ever appears. The details rail floats above everything as a quiet overlay, and the conversation never runs underneath it.

## What changes

**No page scrolling at all**
- The experience is locked to exactly one screen height. Today two stacked full-height wrappers make the page slightly taller than the window, which is what makes the outer scrollbar appear.
- The window itself can no longer scroll on this page.
- On short windows (like the current preview height) the landing headline, spacing and orb size step down so everything — logo, headline, supporting line, orb, button, proof row — still fits without cropping.

**No visible scrollbar inside the conversation**
- The conversation trail still scrolls when there are many turns, but the scrollbar itself is hidden, so nothing appears "out of nowhere" at the edge.
- The trail keeps growing upward from the composer and always shows the latest turn.

**The details rail overlays, never collides**
- The rail stays pinned to the right edge, floating over the stage as an overlay with no layout footprint.
- The conversation column is given a hard right boundary so no message bubble, MARY line or composer can ever sit beneath the rail — on wide screens the column recentres inside the remaining space, on narrow screens the rail shrinks to dots only and sits clear of the text.
- The rail fades slightly when MARY's latest line is long, so it never competes with the reading area.

**Organised vertical rhythm in the live view**
- Orb, status line, conversation trail and composer are laid out as fixed bands within the single screen: the orb and status take a set share at the top, the composer is anchored at the bottom, and the trail absorbs whatever space is left. Nothing pushes anything else off-screen as messages come in.
- The orb height adapts to the available space rather than being a fixed number.

Landing, completion, voice, hands-free behaviour, the waitlist flow and the brand tokens stay exactly as they are.

## Technical notes

- `src/routes/index.tsx`: drop the extra `min-h-screen` wrapper duplication so only one full-height container exists.
- `src/styles.css`: page-level `overflow: hidden` with `height: 100dvh` on the app shell, plus a `no-scrollbar` utility (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`).
- `src/components/mary-experience.tsx`: shell becomes `h-dvh overflow-hidden` with a `flex` column; live stage uses `min-h-0` bands so the trail is the only flexible region; trail gets `no-scrollbar`; conversation column max-width plus right padding reserved for the rail (`lg:pr-44`, `pr-10` on small); orb height derived from a compact/tall breakpoint instead of a constant.
- `src/components/progress-constellation.tsx`: keep `fixed` + `pointer-events-none`, reduce footprint on `<md` to dots only (already) and cap the label width so the reserved gutter is accurate.
- Verify with Playwright at 1018×702, 1280×800 and 390×844: assert `document.documentElement.scrollHeight === clientHeight`, no element overlaps the rail's bounding box, and screenshots of landing / live / done.
