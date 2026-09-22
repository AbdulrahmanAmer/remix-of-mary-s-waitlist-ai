# Centered Apple-Inspired MARY Experience

## Direction

Rework the current split-screen presentation into the selected **Focused instrument** direction: one centered, precise experience where MARY is the clear focal point. Keep OmniSuite’s existing lime-on-paper identity rather than copying Apple’s colors or branding.

## Landing experience

- Center the OmniSuite lockup and “A product by Omnikom” attribution at the top.
- Build a single vertical composition with a concise early-access label, an editorial headline led by “Meet MARY,” and shorter supporting copy.
- Place MARY’s animated presence directly in the center of the page, visually connecting the introduction to the primary action.
- Make “Talk to MARY” the single dominant action, with the voice-or-text option presented quietly beneath it.
- Consolidate Convert, Cultivate, and Recover into a restrained proof rail below the main interaction.
- Remove the oversized right-side card and reduce dead space so the page feels composed at laptop, desktop, and mobile sizes.

## Live conversation

- Continue the centered instrument metaphor after entry instead of switching to a two-column dashboard.
- Keep MARY and her current state visible above the conversation, with the latest response as the visual focus.
- Present prior messages quietly and compactly so they support, rather than compete with, the active exchange.
- Keep the voice/text composer anchored and prominent, with an audio-responsive pulse that communicates listening, hearing, thinking, and speaking.
- Reposition waitlist progress as a subtle horizontal status strip instead of a separate sidebar.
- Preserve all existing hands-free behavior: one microphone consent click, automatic reply after silence, automatic listening restart, barge-in, manual pause/resume, and typed-message support.

## Completion state

- Center the success moment around MARY’s completion animation and the “You’re on the waitlist” confirmation.
- Present captured details in a clean, compact summary beneath the confirmation.
- Retain the exact OmniSuite launch and Omnikom attribution in the closing copy.

## Motion and performance

- Use one motion language throughout: soft vertical reveals, precise scale changes, and a restrained spring for MARY’s key state changes.
- Animate the logo once on entrance; do not loop it.
- Keep only the meaningful MARY/composer pulse continuous and drive it from actual audio activity.
- Remove decorative grid dominance, large blur effects, and unnecessary always-running animation.
- Respect reduced-motion preferences and keep the page efficient on lower-powered phones.

## Design system

- Preserve the existing semantic lime, paper, ink, surface, and border tokens.
- Refine spacing, typography, shadows, and control proportions through shared tokens rather than one-off colors.
- Continue using the official OmniSuite logo and the existing Space Grotesk/DM Sans pairing.
- Keep controls accessible, keyboard-friendly, and large enough for touch.

## Validation

- Verify the landing, live conversation, typing, hands-free voice cycle, paused microphone state, and completion screen.
- Check desktop and mobile layouts for clipping, overflow, and unwanted empty space.
- Confirm animation remains smooth, reduced-motion works, and no browser errors appear.

## Technical notes

- The visual refactor will stay within the existing React views, semantic Tailwind tokens, and Motion-based transitions.
- The AI conversation, speech recognition, speech playback, transcription, waitlist fields, and submission behavior will remain unchanged.
- The video-creator skill informs the motion system and pacing only; this remains an interactive website, not a rendered video.
