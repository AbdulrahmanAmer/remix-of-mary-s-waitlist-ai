# A liquid 2.5D sphere, voice-synced text, and a better-crafted interface

Four things to fix: her words appear faster than she speaks them, the sphere is clipped at the top and bottom, the sphere looks coarse rather than liquid, and buttons and motion need more craft.

## 1. Words follow her voice, not a guess

Right now the text reveal runs on a fixed estimate (a third of a second per word) that starts the moment the line arrives — before the audio has even begun streaming. So the sentence finishes writing itself while she is still talking.

The reveal will instead be driven by the actual audio: nothing appears until her first sound plays, then words appear in step with how far through the spoken audio she is. If sound is muted or unavailable, the old estimated pace is the fallback. The last word lands exactly as she stops.

## 2. Nothing gets clipped

The glow around the sphere reaches roughly two and a half times its own size, but the sphere is sized as if only its body had to fit — so on the shorter conversation view the halo and the outer rings get cut off at the top and bottom.

The sphere will be sized from the space actually available _including_ its glow, so the whole presence always sits inside its area with breathing room. It also gets a slightly wider stage in the conversation view so the light can spread sideways instead of being squeezed.

## 3. A genuinely liquid, 2.5D sphere

The current rings are drawn as short straight strokes, which is where the coarse, faceted look comes from. The rebuild:

- **Smooth liquid ribbons** — each ribbon becomes one continuous flowing curve with a soft, varying thickness, so it reads as a band of liquid light rather than a chain of segments. Edges get a soft falloff instead of a hard line.
- **Real depth** — ribbons are sorted front-to-back and drawn in that order, so the ones passing behind the sphere are genuinely occluded and dimmed by the body rather than just faded. Front ribbons pick up a brighter specular edge.
- **A body, not an outline** — a soft translucent core with an off-centre highlight and a darker rim shading on the lower-far side, so the sphere has volume.
- **Grounding for the 2.5D feel** — a faint elliptical shadow and a soft reflected pool of light beneath the orb, so it floats above the paper rather than being pasted on it.
- **Liquid surface motion** — the ribbon paths flow and fold continuously instead of wobbling in place; loud speech pushes ripples outward along the ribbons, silence lets them settle.
- Rendering stays cheap: canvas only, no blur filters, no WebGL, resolution and ribbon count step down on small screens, and reduced-motion still gets one calm static frame.

## 4. Better buttons and better motion

- **Buttons** get a crafted 2.5D treatment matching the orb: a soft raised surface, a fine light edge along the top, a grounded shadow underneath that presses in on click, and a light sheen that sweeps once on hover. Applied to "Talk to MARY", the mic and the send control.
- **Composer** becomes a softly raised floating surface with the same language, its glow breathing from the live audio level.
- **Motion polish** — entrances stagger slightly instead of moving as one block, the state label cross-fades rather than swapping, the mic press has a real physical response, and the completion moment blooms and settles instead of simply appearing.
- Everything keeps the existing lime-on-paper tokens, Comfortaa headings, hands-free behaviour, one-screen layout, and accessibility affordances.

## Technical notes

- `src/lib/audio-engine.ts`: `speak()` gains `onProgress(0..1)` computed from `ctx.currentTime` against the scheduled playhead, plus the existing `onFirstAudio`. `mary-experience.tsx` `say()` drops the timer-driven reveal in favour of `onProgress`, keeping the timed path only for the muted branch.
- `src/components/mary-presence.tsx` rewritten: ribbons as `Path2D` built from cubic curves through 3D-projected points, per-ribbon depth sort, occlusion by compositing the body over back ribbons, `createRadialGradient` core/rim/highlight, ground ellipse + reflection, ripple term from smoothed level. Radius derived from `min(box) / (haloReach * 2)` so the halo always fits. Props unchanged.
- `src/components/mary-experience.tsx`: live orb band gets more vertical share and full column width; landing/live/done heights recomputed from the new halo-aware sizing.
- `src/styles.css`: new `@utility` classes for the raised surface, top light edge, press shadow and hover sheen — all built from existing tokens, no new colours.
- Verify with Playwright at 1018x702, 1280x800 and 390x844: no scrollbars, orb fully inside its box at every height, a scripted conversation confirming word reveal tracks audio; then format, typecheck and lint.
