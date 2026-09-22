# She stays frozen until you mute yourself

## What is actually happening

When you speak while MARY is talking, she pauses instantly to let you in. Her next step depends on what that sound turns out to be:

- real words -> she stops for good and answers you
- a false alarm (her own voice in the room, a door, a cough) -> she picks up where she left off

There is a third case the code never handles. If she has already decided the sound was really you — so she is holding, silent, waiting for your sentence — and then the recording ends up with nothing usable in it (no words heard, and the audio judged to be her own voice coming back through the speaker), she is left paused with nobody ever telling her to carry on. She sits there silently, forever.

Muting yourself is the one action in the app that clears that hold, which is exactly why muting makes her start responding again.

On a phone held at speaker volume this case is common: her voice is loud in the room, live captions are deliberately switched off while she talks, and the recording frequently fails the "was there a genuinely loud moment of your own" test. So on iPhone it can happen on almost every cut-in.

Confirmed in the code: `src/lib/audio-engine.ts` reports an empty recording as a cancelled interruption (`flush`, the `!text && !audio` branch), and the handler in `src/components/mary-experience.tsx` only resumes her when no hold is in place — a confirmed hold is never released on that path.

## The fix

**Never leave her held with nothing coming.**
An empty recording after a confirmed cut-in tells her the same thing a false alarm does: nothing to answer, carry on. The hold is released and she continues her sentence instead of going quiet.

**A hold always expires.**
A safety timer releases any hold that has lasted longer than a few seconds with no sentence arriving, whatever the cause. She resumes or moves on by herself — muting is never the only way out.

**Your sentence must end even in a noisy room.**
Room noise currently keeps a recording open, because she only re-learns the room while nobody is talking. Add a cap so a stretch with no real speech in it closes the turn, rather than letting it run to the 45-second limit.

**Say less that isn't true.**
While she is held, the status line should read that she's listening, not that she's speaking.

## Technical notes

- `src/lib/audio-engine.ts`
  - `flush()`: on the `!text && !audio` path, report the outcome distinctly (e.g. `onUtteranceEmpty`, or pass `wasHolding` to `onInterruptCancelled`) so the app can tell "false alarm" from "confirmed cut-in that produced nothing".
  - Add a hold watchdog inside the tick loop: if `holding` has been true for more than ~4 s with no flush, flush (or cancel) and clear it.
  - Endpointing: track frames since the last peak that exceeded `baseThreshold` independently of `lastSpeechAt` refreshes from steady room noise; close the utterance after ~2.5 s of no real speech rather than waiting for `maxUtteranceMs`.
- `src/components/mary-experience.tsx`
  - `onInterruptCancelled`: call `releaseHold()` (clears `holdRef`, resumes a paused handle) when the engine reports a confirmed-but-empty cut-in.
  - Add a client-side guard: if `holdRef.current` has been set for >5 s with `busyRef` false, call `releaseHold()`.
  - Status line: `hearing`/held state should not render "MARY is speaking".

## Verification

Playwright with a fake microphone: play a burst of noise over her line (no speech), confirm she resumes on her own within a few seconds and the transcript is unchanged. Then play a real sentence over her line and confirm she stops and answers. Then leave steady background noise running after a sentence and confirm the turn still closes. Mute is never needed in any of the three.
