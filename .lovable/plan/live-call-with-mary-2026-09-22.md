# Live call with MARY

Turn the conversation into a real live call: the microphone is open from the moment the conversation starts, MARY hears you continuously, replies the instant you stop talking, and you can talk over her. No tapping to speak — only a mute button when you want her to stop hearing you. Typing stays available.

At the same time, fix the conversation bubbles that currently mix up and repeat.

## What you will experience

1. You press Join The Waitlist. The browser asks once for microphone access, MARY greets you, and the line stays open for the whole conversation.
2. You speak whenever you want. She stops talking the moment you start, and answers as soon as you finish — no button, no second tap.
3. The mic button becomes a mute toggle. Muted: she can't hear you, you can still type. Unmuting reopens the line instantly.
4. The transcript reads in true order — every line in the order it was said, nothing repeated, nothing jumping around.

## Why the bubbles mix up today

Three confirmed causes in the current code:

- The live captioning reads every result the browser has collected since the mic opened and joins them together, so your second sentence is sent with your first sentence stuck to the front of it.
- Two separate captioning sessions can run at once (one started when listening begins, another when the "talk over her" listener arms), so the same words arrive twice.
- The centre line is chosen as "the most recent thing MARY said" rather than "the most recent line in the conversation", so after you answer, one of her older lines is still shown as the current one while the rest of the trail reshuffles around it.

## Technical plan

### Persistent mic session (`src/lib/audio-engine.ts`)

Replace the per-turn `startRecording` lifecycle with a single `MicSession` created once when the conversation opens and torn down when it ends:

- one `getUserMedia` call (echo cancellation + noise suppression on) and one `AudioContext` graph for the whole session
- continuous VAD over the same analyser loop already in place, emitting `onSpeechStart` / `onUtteranceEnd(blob)` per utterance rather than per recorder
- per-utterance PCM buffering: frames accumulate only between speech start and end-of-silence, then flush to a WAV blob and reset
- `setMuted(boolean)` gates frames and VAD without releasing the device (no permission re-prompt, no restart delay)
- `setEchoGuard(boolean)`: while MARY is speaking, the speech threshold is scaled up so only a genuine interruption triggers barge-in
- expose `onLevel` for the sphere, unchanged

### Single captioning stream

One `SpeechRecognition` instance owned by the session, started once:

- track `event.resultIndex` and keep only results at or after the last committed index, so each utterance carries only its own words
- commit final results into the utterance text at end-of-speech, then reset the buffer
- never create a second recognizer; the barge-in listener reuses the session

### Conversation state (`src/components/mary-experience.tsx`)

- Remove the `handsFree` on/off mode and `toggleMic`/`armBargeIn`/`startListening`/`finishListening` churn; the session is always live unless muted.
- Mic button becomes `micMuted` toggle (`Mic` / `MicOff`), the existing volume toggle keeps controlling her voice.
- Utterance end -> `sendUser(text)`; speech start -> stop her playback immediately (barge-in).
- Queue guard: a single `turnLock` so an utterance arriving mid-turn is appended to the pending user text rather than racing `busyRef`.
- Centre line = last line in `lines` when it is MARY's; when the newest line is yours, the centre shows her line only until your reply lands, then the trail renders in strict chronological order. `history` becomes `lines.slice(0, -1)` so ordering can never diverge.
- `reveal` becomes per-line (`{ id, count }`) so word-by-word reveal can't bleed onto a different bubble.
- Idle nudges and typing lines only fire when the mic is muted and no turn is running.

### Unchanged

Turn model, playbook, Convert/Cultivate/Recover positioning, the sphere, layout, and the waitlist submission all stay as they are.

## Verification

Playwright run with a fake microphone device (`--use-fake-device-for-media-stream` plus a WAV of two separate sentences) to confirm: mic opens without a tap, each utterance is sent once with only its own words, bubbles stay in order, mute stops capture, and barge-in cuts her mid-sentence.
