# MARY Waitlist — Live Voice Onboarding Experience

A standalone, visually stunning waitlist page where MARY — the AI Revenue Concierge from OmniSuite — greets visitors out loud, introduces herself, and conversationally onboards them onto the launch waitlist. Signups land in your Google Sheet.

## The experience

Landing state
- Full-bleed cinematic hero in OmniSuite's brand language (Space Grotesk + DM Sans, dark ink surface, soft aurora gradients, glass panels).
- A living MARY orb at the centre: layered animated rings that breathe, drift and react. One primary call to action — "Talk to MARY".
- Short line of context plus a "Prefer to type?" secondary entry so nobody is blocked by a missing microphone.

The conversation
- MARY opens unprompted, in her own voice:
  "Hi, I'm MARY — the AI Revenue Concierge behind OmniSuite. I work new leads, existing databases and missed opportunities across voice, SMS and email, then hand the right conversations to the human team. We're opening early access soon — would you like me to put you on the waitlist and make you one of the first to work with me?"
- If yes, she collects, one natural question at a time:
  1. Name
  2. Email
  3. Phone (optional, she'll offer to skip)
  4. What their business is
  5. What industry / line of business they're in
  6. How they currently handle operations — who works the leads, follow-ups and bookings today
- She confirms details back conversationally, handles corrections ("actually it's…"), and never repeats a question already answered.
- Close: "Thanks for signing up for the waitlist — we'll be in touch the moment we launch." Then a celebratory reveal card with their details and a waitlist position.

Real-time interactivity (the core of the build)
- Speak or type, interchangeably, mid-conversation — switching modes never resets anything.
- Live voice: streaming speech recognition with interim words appearing as the person speaks, plus barge-in (start talking and MARY stops).
- Typing awareness: the moment keys are pressed, MARY notices and says things like "Take your time writing what you have in mind — I'm right here with you," then goes quiet while they type. Idle pauses get gentle, non-repetitive nudges.
- MARY's own speech streams as audio while the matching words animate in, word-by-word, in sync.
- The orb is state-driven: idle breathing, listening (reacts to actual microphone amplitude), thinking, speaking (pulses to output audio), and a success bloom.

## Motion and visual quality

- Motion for React for all orchestration; springs over easing, staggered entrances, shared-layout transitions between stages.
- Real-time audio-reactive visuals driven by Web Audio analysers on both input and output — the orb genuinely moves with the voices, it is not a looping animation.
- Live captions rail with depth-of-field falloff on older lines, progress constellation showing which details MARY has captured, animated field cards that materialise as each answer is confirmed.
- Ambient grain, parallax light, magnetic cursor on the primary action, and a confetti-free, premium success moment.
- Fully responsive, keyboard accessible, respects reduced-motion, and degrades to typed conversation if the microphone is denied.

## Data capture

- Completed signups are POSTed to a Google Apps Script Web App that appends a row to your sheet: timestamp, name, email, phone, business, industry, operations summary, plus the full transcript.
- The endpoint URL and a shared secret are stored as server-side secrets; the browser never sees them.
- Duplicate-safe, with a clear retry and a visible error if the sheet write fails so no signup is silently lost.

### What I need from you
1. Deploy the Apps Script Web App (I'll give you the exact script to paste) and send me its URL.
   Until then I'll wire the endpoint and queue signups so nothing is lost — the page works end to end either way.

## Technical section

- Stack: TanStack Start, Tailwind v4 tokens, Motion for React, Web Audio API.
- Routes: `/` is the waitlist experience with its own head metadata. Brand tokens extended in `src/styles.css` (ink, aurora, glass, Space Grotesk / DM Sans loaded via a `<link>` in `__root.tsx`).
- Conversation engine: a client state machine (`stage`, `collected`, `pendingField`, `inputMode`, `typingActive`) driving both UI and prompts; MARY's turn logic runs server-side.
- AI: Lovable AI Gateway.
  - Dialogue: `openai/gpt-6-astra` via a streaming server function, structured output per turn returning `{ say, fieldUpdates, nextField, complete }` so extraction and phrasing happen in one pass.
  - Speech out: `google/gemini-3.1-flash-tts-preview` streamed as SSE through a server route, decoded and scheduled chunk-by-chunk on an `AudioContext` for sub-second first audio.
  - Speech in: browser `SpeechRecognition` for interim transcripts where available, with a Web Audio PCM → WAV capture uploaded to `google/gemini-3.5-transcribe` as the universal fallback (Safari/Firefox).
- Typing detection: keystroke events set a `typing` flag that suppresses nudges, cancels queued speech, and triggers the one-time "take your time" line.
- Server boundaries: `src/routes/api/speech.ts` (TTS stream), `src/routes/api/transcribe.ts` (STT), `src/lib/mary.functions.ts` (turn engine), `src/lib/waitlist.functions.ts` (Apps Script write). `LOVABLE_API_KEY`, `SHEETS_WEBAPP_URL` and `SHEETS_WEBAPP_SECRET` read only inside handlers.
- All audio work is client-only, mounted behind hydration guards so SSR stays clean.
