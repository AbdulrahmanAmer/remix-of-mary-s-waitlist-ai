# Hardening the live line: her vs. the room, and a calmer screen

Two problems, one cause. Right now she decides who is talking purely from sound: is it loud enough, and does it have the shape of a voice? Any human voice in the room passes that test — the person next to you, a conversation three metres away, a video on someone's phone. So in a conference hall she keeps thinking you started talking, holds her turn open waiting for you to finish, and the screen keeps churning through "I can hear you…", "Finishing your answer…", "Got it, MARY is preparing her reply."

The fix is the way real call software does it, plus the thing you asked for: keep the line open all the time, keep the transcript flowing in the background, and let her intelligence decide when something was actually said **to her**.

## 1. Tell the person on the mic from people around them

- **Learn who is on the mic.** Every time a turn is confirmed as really yours, her sense of "how loud this person is when they speak into this microphone" updates. Anything far quieter than that is the room, not you — distant speech is typically many times quieter than the person holding the device, and this is the single strongest cue available on one microphone.
- **Learn the room's voices too.** A second, slower profile of voice-shaped sound that never turns into a real turn. As the hall fills with chatter, the bar rises with it instead of the room slowly winning.
- **Stability, not just loudness.** A person addressing her produces a continuous run of syllables at a steady level; hall chatter arrives as scattered fragments from changing directions. A turn only opens on a run that holds together, and a single burst can never accumulate its way in.
- **Nothing opens a turn during her own tail.** Unchanged, but now the same near-field bar applies to cutting in over her, so a laugh across the room can't stop her mid-sentence.

## 2. Open channel, and she decides what was meant for her

- The microphone stays open continuously; the transcript streams in the background the whole time and is never shown as your words on screen.
- When a stretch of speech closes, it goes to a fast background judgement (same model she thinks with, smallest setting, one-word answer): **for MARY / not for MARY / unfinished**. It sees the last thing she said and the recent conversation, so "yes, the second one" is clearly for her and "sorry mate, can you move your bag" clearly isn't.
- **For MARY** → she answers. **Not for MARY** → it is dropped silently, she never reacts, and nothing about it teaches her anything. **Unfinished** → she waits a moment longer instead of jumping in.
- Obvious cases skip the judgement entirely so nothing slows down: clear speech right after her question goes straight through, and speech that fails the near-field bar is dropped without asking.
- Cutting in over her still stops her instantly on sound — being responsive matters more there — but if the judgement then says it was the room, she picks her sentence back up where she left off instead of waiting.

## 3. Stop the screen nagging

- One calm status line with hysteresis: it only changes when the state has genuinely held, so a passing sound no longer flips it. "Finishing your answer…" and "Got it, MARY is preparing her reply" collapse into a single quiet state.
- The typing box stops rewriting its own placeholder every second — one stable prompt, and the muted note appears once rather than reasserting itself.
- Mute is a state, not a message: the line says it once, quietly, and she stops offering advice about it.
- The nudges when she truly cannot hear you stay, but spaced further apart and capped lower.

## 4. See it before the conference

The sound check (five taps on "omnikom") gets the new numbers live: how loud the person on the mic is versus the room's voices, the current near-field margin in dB, and a running list of the last judgements — for her, not for her, unfinished — so you can stand in the hall, have someone talk behind you, and watch her correctly ignore them.

## Technical notes

- `src/lib/voice-detector.ts`: add a `NearFieldModel` — EWMA of confirmed-speech peak level (attack fast, decay slow, floored), plus an ambient-voice profile fed by voice-shaped frames that never confirm. Expose `marginDb` and `isNearField(peak)`.
- `src/lib/audio-engine.ts`: onset and cut-in gates require `isNearField` in addition to the existing level + voice-shape tests; `TIMINGS` gains `nearFieldMarginDb` (start at 9) and `onsetHoldMs`; `noVoiceEndpointMs` also closes when frames stop being near-field, so ongoing hall chatter can't hold a turn open. Utterances rejected as ambient emit a new `onAmbient` trace instead of `onUtterance`.
- New `src/lib/addressee.functions.ts` + `/api/addressee` server route calling `openai/gpt-6-astra` (reasoning `low`, `max_completion_tokens`, strict schema `{ verdict: "mary" | "ambient" | "unfinished" }`) with the last three MARY lines plus the candidate text. Client-side skip rules first; 1.2s deadline with "mary" as the fallback so a slow network never swallows a real answer.
- `src/components/mary-experience.tsx`: `handleUtterance` routes through the verdict; ambient verdicts call `releaseHold()` and resume a paused line; user bubbles/interim text removed from the transcript view; status line gets a 600ms hysteresis timer; placeholder and mute copy simplified.
- `src/components/audio-diagnostics.tsx`: near-field margin, ambient-voice level, last ten verdicts.
- Verify with the existing simulated-noise harness (babble at several distances must produce zero turns) plus a phone-sized live run.
