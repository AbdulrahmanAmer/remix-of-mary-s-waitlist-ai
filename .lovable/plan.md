# MARY, refined: light stage, living presence

Take the taste from the two references — the calm immersive atmosphere, the big confident type, the sphere with light inside it, the silky ribbon that moves with a voice — and rebuild them in our own lime-on-paper identity. Nothing about the colors, the logo, or the wordmark changes.

## The presence

MARY becomes one continuous presence that changes form with her state, instead of a static badge.

- **Resting and thinking — the sphere.** A luminous lime orb with soft light inside it, gently breathing. While she thinks, the light inside drifts and deepens rather than spinning.
- **Speaking and listening — the ribbon.** The sphere melts into a horizontal ribbon of light that ripples across the center of the stage, riding real audio: her voice while she speaks, your voice while she listens. Louder means taller and brighter; a pause flattens it to a calm line.
- **Complete — a single bloom.** The ribbon gathers back into the sphere, brightens once, and settles.

The change between forms is a fluid morph, not a swap.

## The stage

Light paper stays, everywhere. The atmosphere comes from light instead of darkness: a soft lime glow behind MARY that strengthens as the conversation gets going, and a gentle vignette of warm paper at the edges so the center feels lit. No dark mode, no heavy blur fields.

- **Landing** — centered lockup and attribution, a short early-access label, the headline, MARY's sphere alive in the center, and one clear "Talk to MARY" action. Voice-or-type noted quietly beneath. The proof rail stays restrained at the bottom.
- **Conversation** — MARY's presence sits at the top as the ribbon. Her latest line is the largest, calmest thing on the screen, revealed word by word as she speaks. Earlier turns shrink and fade upward into a quiet trail. The composer is anchored at the bottom and breathes with the same audio signal driving the ribbon, so the whole screen pulses as one thing.
- **Completion** — the confirmation and captured details, centered under the settled sphere.

The empty gap in the middle of the current conversation panel goes away: the trail grows from the composer upward, so the layout is full at every stage.

## Motion language

One vocabulary throughout: soft vertical reveals, precise scale, a restrained spring for MARY's state changes, and slow continuous motion only where it carries meaning (the ribbon and the composer, both driven by real audio levels). The logo animates once on entry. Reduced-motion users get the same layout with the living motion stilled.

## What stays exactly as it is

Hands-free conversation, the voice, the questions MARY asks, the waitlist capture, the tokens, Space Grotesk / DM Sans, and every accessibility affordance.

## Technical notes

- New `src/components/mary-presence.tsx` replaces `mary-orb.tsx`: a single canvas rendering both sphere and ribbon, morphing on a state prop (`idle | listening | hearing | thinking | speaking | done`), driven by a level value between 0 and 1. Canvas keeps it cheap on phones; the render loop pauses whenever MARY is idle and on `prefers-reduced-motion`.
- `audio-engine.ts` already reports output amplitude while speaking and input level while recording — both are passed straight through as the presence level. No audio changes.
- `mary-experience.tsx` is restructured around the new presence and the upward-growing conversation trail; the stage machine, hands-free logic, and VAD wiring are untouched.
- `aurora-background.tsx` and `styles.css` gain the conversation-responsive lime glow and paper vignette as token-based utilities; no new colors.
- `progress-constellation.tsx` becomes the thin horizontal status strip already in place, restyled to sit with the new presence.
- Verified with Playwright on desktop and mobile, plus format, typecheck and lint.
