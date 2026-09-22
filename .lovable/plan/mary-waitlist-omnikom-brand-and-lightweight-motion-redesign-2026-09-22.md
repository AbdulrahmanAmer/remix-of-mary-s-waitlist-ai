# MARY Waitlist — Omnikom Brand and Lightweight Motion Redesign

Rebuild the current waitlist presentation around the latest Omnikom design system while preserving the working voice, typing, conversation, and signup flow.

## Brand and copy

- Replace the current blue/purple aurora styling with the referenced project's verified **“Lime on paper”** system:
  - warm paper background and ink text
  - lime as the primary action and live-state signal
  - cobalt used sparingly as a secondary signal
  - DM Sans for interface/content and Space Grotesk only for the Omnikom wordmark
  - the source project's border, surface, elevated, radius, and shadow roles
- Bring over the official Omnikom lime mark through the project asset flow; pair it with the Omnikom wordmark and present **OmniSuite as a product by Omnikom**.
- Update MARY’s identity and closing language so she says that **OmniSuite is a product by Omnikom** and closes with: “Thanks for signing up — we’ll be in touch as soon as OmniSuite launches, a product by Omnikom.”
- Keep MARY’s existing role, revenue-loop knowledge, collection order, and conversational behavior unchanged.

## New layout

### Entry view

- Use a compact branded header with the animated Omnikom mark, Omnikom wordmark, and a clear “OmniSuite” product label.
- Replace the vertically sparse composition with a balanced first viewport: strong MARY introduction, concise supporting copy, the live MARY presence, and one unmistakable start action.
- Keep voice and typing equally visible from the beginning without adding explanatory clutter.

### Live conversation

- Turn the experience into a focused conversation workspace rather than a centered stack:
  - persistent MARY status/presence area
  - readable transcript with clear MARY and guest turns
  - compact captured-detail progress
  - anchored composer that remains easy to reach on desktop and mobile
- Make the composer the visual heartbeat: a restrained lime pulse when ready, input-level response while listening, and a speaking response tied to MARY’s real output level.
- Preserve interim speech text, barge-in, typing awareness, mute control, corrections, and typed fallback.
- Keep layout dimensions stable as messages, status labels, and collected details change.

### Completion

- Use an Omnikom-branded launch confirmation with a controlled lime success sweep, the collected details, and waitlist position.
- Display “OmniSuite — a product by Omnikom” as part of the resolved final state.

## Motion system

- Animate the official mark with a lightweight reveal: short masked entrance, subtle lime trace, then a quiet idle state rather than perpetual complex rotation.
- Replace the current five-ring orb with a simplified MARY signal made from a small number of composited layers:
  - idle: nearly still, low-frequency breath
  - listening: microphone-level pulse
  - thinking: one restrained travelling signal
  - speaking: output-audio pulse
  - success: one-time bloom and settle
- Use one consistent entrance language: clipped or translated reveal with spring-settled opacity. Use its inverse for exits.
- Limit perpetual animation to the active voice/chat signal. Pause decorative motion when the page is hidden and avoid animating expensive blur/filter properties.
- Reduced-motion mode removes pulsing, tracing, and travelling effects while preserving state changes through color, labels, and static emphasis.

## Performance work

- Remove the three fixed 40–46rem blur layers and their endless transforms from the current background.
- Replace filter-heavy depth effects with tokenized solid surfaces, hairline grids, small shadows, and static gradients where needed.
- Reduce the number of continuously animated nodes in the MARY presence and avoid large repaint regions.
- Keep audio-level updates isolated to the smallest visual elements so transcript and page layout do not rerender unnecessarily.
- Defer nonessential effects until the conversation begins and stop them when inactive.
- Verify smooth behavior on mobile and desktop, including lower-powered device conditions, reduced motion, and microphone-denied typing mode.

## Validation

- Test the complete typed flow from greeting through all six collected fields and the final Omnikom launch message.
- Test the voice state transitions, barge-in, mute control, typing-awareness response, and composer pulse.
- Check desktop and mobile layouts for clipping, overlap, unstable resizing, and keyboard reachability.
- Compare runtime animation load before and after, confirming the redesigned page no longer relies on large continuous blur animations.
- Confirm the official logo asset renders crisply and all visual colors come from the imported Omnikom semantic tokens.

## Reference and skill handling

- Use the active **video-creator** skill for transferable art direction, timing, animation hierarchy, and motion-system consistency—not video rendering.
- Treat the linked `agent-os` repository as a design/process reference only. External repositories cannot be mass-installed as trusted active skills during planning; skills must be reviewed and activated through Lovable’s Skills settings. No repository scripts or instructions will be executed automatically.

## Technical notes

- Primary files: the waitlist experience, MARY presence/logo components, progress display, global design tokens, root font metadata, and MARY dialogue prompt.
- The Google Sheets integration, speech/transcription endpoints, waitlist fields, and working conversation state machine remain in scope only where needed to preserve behavior during the visual restructure.
- The source logo pointer cannot be copied directly between projects; the official image will be downloaded from its source-project asset URL and re-added to this project through the supported asset flow.
