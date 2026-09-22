# Keep the footer locked to the bottom of the screen

## Problem
The footer ("OmniSuite · AI-native revenue infrastructure / A product by omnikom") jumps to the top of the page during the intro stage. Cause: the shell is a full-height column, and the landing/live/done sections each fill the middle space, but during the intro stage (the logo flight after clicking "Join The Waitlist") no middle section is rendered — so the footer collapses up directly under the header at the top of the screen.

## Fix (one small change in `src/components/mary-experience.tsx`)
- Render an invisible flexible spacer in the middle area whenever the intro stage has no section, so the column always keeps: header at top, footer pinned at bottom, on every stage and every viewport size.
- No visual change to the footer itself, no new scrollbars, no change to the intro/logo animation.

## Verification
- Open the preview, click "Join The Waitlist", and confirm the footer stays glued to the bottom edge through the whole logo-flight transition, and remains at the bottom on the landing, conversation, and confirmation screens at multiple viewport heights.
