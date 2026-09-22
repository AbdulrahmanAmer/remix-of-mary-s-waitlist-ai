# MARY always finishes her introduction — even when interrupted

## What is wrong

Her introduction ("hello, I'm MARY, this is OmniSuite…") only runs when the conversation history is completely empty. The instant someone speaks over her mid-intro, history exists, so the next turn jumps straight into discovery mode: the intro is never finished, and the natural "what should I call you?" at the end of it never comes. The name then has to be recovered later with a separate, awkward ask.

## What will change

- **Her introduction becomes a milestone, not a one-shot opening.** Just like the "reveal" and "three lanes" moments are already tracked, whether she has *fully delivered* her intro will be tracked across turns — a beat she was cut off in does not count.
- **Interrupted intro → she resumes it gracefully.** If someone talks over her before the intro is done, her next turn reacts to what they said first (warm, human, never ignoring them), then folds in whatever part of the intro they haven't heard yet — who she is, what OmniSuite is — and ends on the name question. No restarting from the top, no repeating words they already heard.
- **The intro always ends with the name question.** Once the greeting and the one-liners about her and OmniSuite are out, the turn closes with a natural "what should I call you?" — so the name arrives as part of the hello, not as an intake question later.
- **The existing cut-off rule still applies** — she never repeats a cut-off line word for word — but it no longer cancels the intro; it reshapes how she finishes it.
- **Normal flow is unchanged**: an uninterrupted welcome still runs exactly as today, just now ending on the name question as its final beat.

## Technical details

- Add an `introDone` flag alongside `revealed`/`lanesDone` in `TurnFlags` (`src/lib/mary.functions.ts`), the turn schema and phase logic in `src/lib/mary-prompt.server.ts`, persisted through the turn API the same way the other flags are.
- Phase rule becomes: intro not delivered → WELCOME variant (first-visit wording when history is empty; a "resume the intro" wording when history exists but the intro was cut short) → then DISCOVER/REVEAL/… as today. `introDone` is set true only on a turn where the greeting + identity + OmniSuite line were actually completed.
- The WELCOME phase text gains: end the intro on the name question, woven in naturally.
- Verify with a scripted conversation: interrupt during the welcome, confirm her next turn acknowledges the interruption, completes the intro, and asks the name — and that a normal uninterrupted welcome still works end to end.
