# A living orb for MARY

Right now MARY's sphere is a flat glowing circle with an "M" in the middle, and it disappears into a ribbon while she talks. It reads as a graphic, not as a presence. The goal is the ElevenLabs feeling: a soft, liquid orb that looks like it is made of moving light, breathing on its own and reacting to the voice in real time.

## What it will look and feel like

- **A liquid shape, not a circle.** The outline gently wobbles and swells like a drop of light. It never looks perfectly round, and it never looks jittery.
- **Light moving inside it.** Two or three soft blooms of lime drift and fold through the body at different speeds, so the inside always looks alive. A brighter highlight sits slightly off-centre and slowly drifts, giving it depth.
- **A soft halo.** A wide, very light glow behind the orb that grows when her voice gets louder and settles back down in silence.
- **It reacts to the voice.** Louder speech pushes the surface outward in soft ripples and brightens the core; a pause smooths everything back to a calm breath. When you speak, the same reaction happens in a cooler, quieter register so listening and speaking feel distinct.
- **States read at a glance.** Resting: slow breathing. Thinking: the inner light swirls faster and tighter while the outline calms. Speaking: full ripple and brightness. Complete: one bright bloom, then it settles into a still, softly glowing orb.
- **The "M" goes away.** The orb carries her presence on its own; the letter makes it feel like a logo badge.
- **The ribbon stays, but as a companion.** During the conversation the orb remains the presence and the voice line sits with it rather than replacing it, so nothing snaps between forms.

Brand stays exactly as it is: lime on paper, the same tokens, no dark stage, no new colours.

## Performance and accessibility

- Drawn on the existing canvas with cheap maths only — no blur filters, no WebGL, no extra libraries.
- Frame work scales down on small screens, and the loop idles when MARY is resting and nothing is moving.
- With reduced motion on, the orb renders as one calm static state with no animation.

## Technical notes

- Rework `src/components/mary-presence.tsx` only; its props (`state`, `level`, `height`) and the `PresenceState` values stay the same, so `mary-experience.tsx` needs no changes.
- Shape: a closed path built from ~96 points, radius modulated by layered sine terms (value-noise style, seeded offsets per harmonic) plus a smoothed audio term; drawn with `quadraticCurveTo` midpoints for a fluid outline.
- Body: radial gradients composited with `source-atop` inside the clipped blob — a base fill, two drifting bloom gradients on slow independent orbits, one specular highlight.
- Halo: single wide radial gradient behind the blob, alpha driven by the smoothed level.
- Level smoothing: attack ~0.12s, release ~0.35s so the orb swells fast and relaxes slowly; state changes lerp the harmonic amplitudes rather than switching.
- Colours continue to come from computed `--primary`/`--ink` via the existing `withAlpha` helper.
- Verify with Playwright on desktop and mobile across idle / speaking / done, plus format, typecheck and lint.
