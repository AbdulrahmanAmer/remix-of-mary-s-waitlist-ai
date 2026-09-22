# Make MARY sound natural and think conversationally

Five independent audits found the same underlying gap: MARY has a strong sales script, but the runtime forces every reply through a fixed signup sequence. This change makes her respond to the person first, then continue the signup only when it fits.

## 1. Replace the scripted opening with a real greeting

- Start with a brief human hello before introducing MARY or OmniSuite.
- Separate the opening into natural beats: greet, introduce herself, explain OmniSuite in plain speech, then invite the person into the conversation.
- Add several opening patterns so she does not repeatedly say “my name is…” followed by a product description.
- Keep the opening concise and conversational; no personal-detail question in her first turn.

Example shape:

> “Hey — good to meet you. I’m MARY.”
>
> “I help OmniSuite work the leads and follow-up a business normally loses. Want to see how it would work for yours?”

## 2. Give MARY intent awareness alongside signup progress

- Keep the existing progress stages for discovery, the Convert reveal, Cultivate/Recover, contact details, and closing.
- Add a separate per-turn intent so she can recognize greetings, answers, questions, corrections, objections, callback requests, refusals, and exits.
- Make the immediate intent take priority over the funnel: answer a question fully, acknowledge a correction, or handle a callback request before attempting another discovery move.
- Preserve the current short two-beat delivery, but allow a single acknowledgement-only response when advancing would feel unnatural.
- Make refusal and graceful exit real outcomes instead of unused model output.

## 3. Make name discovery reliable and natural

- Add explicit name timing rules: learn it after rapport or when needed to personalize the next step, not as an intake field.
- Use natural lines such as “Sorry, I got ahead of myself — who am I speaking with?” or “And what should I call you?”
- If the name is unclear, repeat it once as a confirmation rather than silently accepting a speech-recognition guess.
- Require the person’s self-identifying words as evidence before saving a name; do not accept a name merely because that word appeared in a company name or story.
- Handle corrections, nicknames, and “close, but…” as corrections rather than confirmations.

## 4. Handle “call me back” as a real branch

The selected behavior is to capture the callback request.

- Recognize “call me back,” “can someone call me instead,” “not now,” and equivalent language from any point in the conversation.
- Stop the normal sales sequence immediately and respond without resistance.
- Ask only for what the callback needs: the person’s name and phone number, skipping either if already known.
- Mark the saved lead as a callback request so it is distinguishable from an ordinary waitlist signup.
- Promise only that the request has been passed to the team; do not invent a callback time or claim it has been scheduled.
- Confirm success only after the request is actually saved. If saving fails, say it was not recorded and offer the existing typed contact path rather than making a false promise.

Example shape:

> “Of course — I can pass that to the team. Who should I say they’re calling?”
>
> “And what’s the best number for you?”

## 5. Improve conversational judgment

- Add explicit answer-first behavior for product questions, skepticism, interruptions, off-topic remarks, uncertainty, and corrections.
- Remember the person’s conversational mode—rushed, skeptical, guarded, or neutral—so later replies keep the right pace and tone.
- Feed rejected or weakly grounded details back into the next turn so MARY clarifies instead of forgetting, guessing again, or asking an unrelated question.
- Never force the reveal, lane explanation, or email ask immediately after the person changes topic or asks for help.
- Remove the brittle punctuation check that decides whether wrapping is complete; track that conversational step explicitly.
- Ensure someone without a business, or someone who declines the signup, can still leave naturally instead of becoming trapped in discovery.

## 6. Keep the spoken history coherent

- Prevent near-duplicate closing lines from bypassing the existing repeat guard.
- Keep typing and idle acknowledgements out of the sales transcript, or route them through the same turn ordering rules.
- Preserve interruption behavior and only count a reveal or lane explanation when the person actually heard it.

## 7. Verification

Run repeatable scripted conversations covering:

- a normal visitor who starts with “hi”
- a visitor who gives their business before their name
- an unclear or corrected name
- a visitor asking a product question mid-discovery
- “call me back” with no details yet
- “call me back” when the name or phone is already known
- a rushed, skeptical, hostile, and talkative visitor
- a person with no business and a person who declines
- interruptions during the opening, reveal, and callback capture

For each script, verify that MARY greets naturally, answers before advancing, never invents a detail, captures the callback request correctly, avoids repeated lines, and exits cleanly.

## Technical scope

- Update the voice playbook and runtime prompt together so they remain one consistent source of behavior.
- Extend the turn schema/state with intent, callback status, conversational mode, and an explicit wrap marker.
- Strengthen name grounding and return grounding failures to the following turn.
- Extend the existing waitlist submission record with callback-request status while preserving ordinary signups.
- Update the client’s completion handling so callback confirmation follows a successful save.
- No visual redesign; this is a conversation and behavior upgrade.
