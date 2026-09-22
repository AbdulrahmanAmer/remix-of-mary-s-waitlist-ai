# Stop MARY from repeating "Want first access through the waitlist?"

## What you'll notice after this

- MARY asks the waitlist question exactly once, at the start. Once you say yes, she moves straight into getting to know you and never brings it up again.
- Her replies feel like a real conversation: she reacts to what you just said ("Love that", "Got it, Sarah"), then naturally asks the next thing — no canned loop.
- If you go quiet or say something off-track, she gently picks up where you left off instead of restarting the pitch.
- The sign-off happens once, at the end: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom."
- Everything else stays as is: hands-free voice, typing, animations, collected details, the waitlist write.

## How

1. **Restructure MARY's script** (`src/lib/mary.functions.ts` SYSTEM prompt). Today the "first turn" instruction keeps bleeding into later turns, so the model re-asks the waitlist question. Rewrite it as explicit conversation phases:
   - **Welcome** — greet, introduce MARY + OmniSuite by Omnikom, ask the waitlist question. One time only.
   - **Collect** — once they agree (or show interest), acknowledge and move through name → email → phone (skippable) → business → industry → operations, one question per turn. Explicit rule: never mention the waitlist offer or first access again after this point.
   - **Close** — when all six fields are captured, say the single closing line and stop asking questions.
2. **Add a "never repeat yourself" rule** — each reply must respond to the person's last message first, then advance; no echoing earlier lines, no re-asking captured fields.
3. **State tracking in the prompt** — the per-turn prompt already lists what's captured; extend it with a plain-language conversation phase ("they've agreed to join; you're now collecting X") so the model can't drift back to the welcome phase.
4. **Client-side safety net** (`src/components/mary-experience.tsx`) — if MARY's next line is nearly identical to a line she already said this session, ask the turn engine for a fresh rephrasing once before showing it.
5. **Verify** — scripted Playwright run through a full conversation (agree → give details → done), confirming the waitlist question appears only in the first turn and the closing line only at the end; typecheck + lint clean.

## Technical details

- Only two files change: `src/lib/mary.functions.ts` (SYSTEM prompt + phase hint in the per-turn prompt) and `src/components/mary-experience.tsx` (repeat-line guard). No visual or audio changes.
- Phase is derived client-side from `collected` + whether the user said yes, passed as one line in the prompt — no schema change to the turn output.
