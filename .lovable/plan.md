# A written voice spec for MARY, and a live-feeling conversation

Two things: give MARY a single written document that defines how she speaks, and change the conversation from strict turn-taking into something that flows continuously.

## First, the honest answer on "real-time"

A true speech-to-speech model — one that hears and talks back simultaneously, with no separate steps — is not available through the AI service this app uses. The available models do one job each: listen, think, or speak. So a genuinely duplex session can only come from a separate provider account (ElevenLabs' conversational service is the usual one), which you said you'd rather not set up.

What we can do — and what actually accounts for most of the "she feels slow and robotic" gap — is stop waiting for each step to finish before starting the next. Today she waits for you to stop talking, then transcribes, then thinks the whole reply, then generates all the audio, then plays it. Four waits stacked back to back. The plan removes almost all of that waiting so it feels continuous.

## Making the conversation flow

- **She hears you as you speak, not after.** Your words are already being recognised live while you talk; that live text becomes what she answers, so the moment you finish there is nothing left to transcribe.
- **She starts thinking before you finish.** As soon as your sentence looks finished, she begins forming the reply; if you keep going, that draft is dropped and restarted.
- **She starts speaking on her first sentence.** Her reply is generated progressively and the first sentence is voiced while the rest is still being written, instead of waiting for the whole thing.
- **You can talk over her.** If you start speaking while she's talking, she stops immediately and listens — the way a person does. The microphone stays open through her turn rather than being switched off.
- **No dead air.** Short natural sounds ("mm", a small breath of pause) cover the moment between you finishing and her first word, so the silence never feels like loading.
- **She finishes her thought.** If a reply is cut off by the network, she resumes rather than stopping mid-sentence.

Net effect: the gap between you stopping and her starting drops from roughly two to three seconds to well under a second, and she can be interrupted — which is what makes a conversation feel live rather than turn-based.

## The voice spec document

A single file, `docs/mary-voice.md`, becomes the one place her personality and behaviour are written down, and the app reads its content directly so the document and her actual behaviour can never drift apart. It defines:

- **Who she is, and what OmniSuite is** — MARY is the concierge you talk to; OmniSuite is the full revenue platform behind her, by Omnikom. She is explicit that this is software running a business's entire revenue operation — not a voice bot. It works every new lead, every contact already sitting in their database, and every missed call, no-show and stalled deal, across voice, text and email, around the clock, and hands the human team only the conversations worth their time.
- **What it buys back** — she makes the value concrete rather than abstract: leads answered in seconds instead of hours, a database that gets worked instead of going stale, missed calls recovered instead of lost, follow-up that never stops at 6pm, and a team that spends its day on live opportunities instead of chasing. Over time it compounds — the same pipeline produces more, without adding headcount.
- **How she sells** — she persuades by connecting it to what the person just told her about their own operation, never by reciting features. One sharp, specific point at a time, in their language: if two agents are chasing callbacks, that's the thing OmniSuite takes off their plate. Confident, never pushy, never a pitch deck read aloud.
- **How she talks** — spoken, never written: short, one idea per breath, contractions, no lists, no jargon, no restating what the person just said back at them.
- **The two beats of every turn** — a genuine reaction to what was just said, then at most one question.
- **Condensing** — hard ceilings: a reaction under ten words, a question under fifteen, never two questions in a turn, never a sentence that exists only to be polite.
- **Ending on their thread** — every question must come out of what the person just said, not from the next empty field. If they mention two agents chasing callbacks, the next question is about that, not "and what industry are you in?" Details get captured from the answers rather than requested one by one.
- **Answering questions** — when they ask something, answer it plainly in one sentence before anything else; never deflect into the next question.
- **The four phases** — welcome once, get to know them, wrap ("you're all set — anything you want to ask me?"), close.
- **Never do this** — a short explicit list: never repeat a line, never re-ask a captured detail, never re-pitch the waitlist, never announce what she's about to do, never read anything that sounds like a form.
- **Worked examples** — a handful of real exchanges showing good and bad versions side by side, which is what actually moves this kind of behaviour.

## Technical notes

- New `docs/mary-voice.md` holds the full spec. `src/lib/mary.functions.ts` imports it as a raw string (Vite `?raw`) and uses it as the system prompt, with the per-turn phase/state prompt still assembled in code. Editing the doc changes her behaviour; there is no second copy.
- Turn engine streams: `streamText` with the existing `Output.object` schema, reading the partial stream so `say` can be sent to speech as soon as it is complete, ahead of `followUp`. The two beats become two overlapping speech requests instead of a sequential pair with a fixed 520ms gap.
- `src/lib/audio-engine.ts`: keep the microphone stream open across MARY's turn; while she is speaking, monitor input level and fire `onBargeIn` above the calibrated threshold, which calls `stopSpeaking()` and switches to listening. Silence detection stays as-is for end-of-turn.
- `src/components/mary-experience.tsx`: drive the turn from the live interim transcript (already captured via `SpeechRecognition`) rather than waiting for the post-hoc `transcribe()` call; keep the audio upload + `google/gemini-3.5-transcribe` path as the fallback when live recognition is unavailable or empty. Speculatively start `maryTurn` when the interim text has been stable for ~350ms, and abort it if more speech arrives. Remove the artificial human-beat delay now that real latency is low; keep a much shorter jitter.
- Word reveal stays tied to actual speech progress (`onProgress`), so it tracks her voice as it does now.
- Verification with Playwright at 1368x892 using fake media streams: a full scripted signup measuring the gap between the last user word and MARY's first audio, a barge-in check (speech starts mid-reply, she stops), and confirmation that all six details are captured and the close fires. Then format, typecheck, lint.

## Not included

A duplex speech-to-speech session with a separate provider account. If you later want that, it is a contained swap of the listen/think/speak pipeline for one live session, and the voice spec document carries over unchanged.
