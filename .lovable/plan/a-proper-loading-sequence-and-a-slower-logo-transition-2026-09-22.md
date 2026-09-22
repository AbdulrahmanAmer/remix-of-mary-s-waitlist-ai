# A proper loading sequence, and a slower logo transition

Two things: rebuild the opening so it always plays as one complete, choreographed piece (and explain why it currently flashes past in some browsers), and give the Join-the-Waitlist logo transition roughly twice the time it has now.

## Why it disappears so fast in the live preview

The loading screen is rendered twice: once as the placeholder the page shows before the app starts, then again — as a brand-new copy — the instant the app takes over. Its animation is pure CSS, so it restarts from frame zero at that moment. The timer that decides when to leave, however, starts counting from page load.

On a fast browser the app takes over almost immediately, the animation restarts, and then the timer (1.6s) ends it while the sequence is still in its opening beats — so it reads as a flash. On a slower browser the placeholder plays for a while first, so the same sequence looks far longer. The two clocks were never tied together.

## The fix

One clock, one continuous play. The loading screen is handed a start time recorded at page load and animates from that point, so the handover to the app no longer restarts it. It always plays its full arc and always leaves on the same beat, fast browser or slow.

## The new loading sequence (about 2.5s)

A single, deliberate arc rather than several unrelated fades:

1. Light blooms out of the centre of the paper.
2. A hollow ring of light draws itself into being and settles into a slow rotation, with a faint cobalt thread through it — the same presence MARY has in the conversation.
3. M, A, R, Y rise in one at a time beneath it.
4. A hairline draws itself across, and "Preparing your conversation" settles in last.
5. The exit: the ring expands and dissolves outward, the words lift and blur away, and the home page rises into place underneath — the loading screen becomes the home page rather than being swapped for it.

Reduced motion: the same composition, held still, with a short cross-fade out.

## The Join-the-Waitlist transition (about 3s)

Same beats, twice the weight:

- "A product by omnikom" wipes left behind the divider, and the divider collapses — unhurried.
- The landing recedes backward under a blur.
- The mark grows to the centre and holds there noticeably longer before it moves.
- It travels in one continuous, slower move into its corner spot and settles.
- The conversation rises after it lands.

Nothing about the conversation, the voice, the sphere or the layout changes.

## Technical notes

- `src/routes/index.tsx` / `src/components/boot-gate.tsx`: capture a single `startedAt` (module-scope `performance.now()` evaluated at first client execution) and pass it to `MaryBoot`; `BootGate` computes its leave timer as `MIN_BOOT_MS - elapsed`. To stop the placeholder/live copies double-playing, `MaryBoot` applies a negative `animation-delay` equal to the elapsed time via a CSS custom property (`--boot-elapsed`), so the restarted copy resumes mid-sequence instead of from zero.
- `src/styles.css`: retime the boot keyframes onto a shared ~2.5s arc (glow → orb-in → ring spin → letters → line → caption), all delays expressed relative to that arc; exit keyframes (`mary-boot--out`) stretched to ~0.8s. Reduced-motion block keeps everything still.
- `src/components/boot-gate.tsx`: `MIN_BOOT_MS` 1600 → 2500, `EXIT_MS` 720 → 800; `introDelay` follows the same value so the home page entrance staggers behind the handoff.
- `src/components/mary-experience.tsx`: flight tween `duration` 1.12 → 2.3 with `times` re-spaced to hold longer at centre (`[0, 0.34, 0.6, 1]`); measurement timeout 420 → 520ms; `enterLive` delay 1320 → 2800ms; landing exit transition lengthened to match. Existing `EASE`/`STAGE_IN` vocabulary reused; repeat-click guard and reduced-motion shortcut unchanged.
- Verify with Playwright at 1368x892 and 390x844: capture frames through the boot handoff and the click transition, confirm the header logo lands at its normal position, no console errors, then format/typecheck/lint.
