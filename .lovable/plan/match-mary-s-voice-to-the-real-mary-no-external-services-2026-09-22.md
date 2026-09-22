# Match MARY's voice to the real Mary — no external services

## Goal

Make MARY's spoken voice sound like the real Mary from the user's recordings, without using any cloning service (no ElevenLabs, no third-party accounts). Technique: measure the real voice's characteristics from the recordings, then reproduce those characteristics through model choice, delivery steering, and playback-level tuning. This approximates pitch, pace, and delivery — it is not an exact timbre clone. The user has been told this limitation plainly.  
samples  are in uploaded files 3 voice records 

## Prerequisite

The user attaches 3 recordings (4–8 min each, conversations featuring Mary) to the chat. Copy them from /mnt/user-uploads/ into /tmp for analysis. Never place recordings in the project bundle.

## Step 1 — Analyze the recordings

In /tmp with ffmpeg + Python (numpy/scipy, no new heavy deps):

- Estimate Mary's fundamental frequency (F0) distribution: median, range, and variability (autocorrelation-based pitch tracking on speech-active frames).
- Estimate speaking rate: speech-energy on/off patterns → words-per-minute approximation, average pause lengths.
- Note delivery style: warmth/energy level, typical sentence-final intonation (falling/rising), and any consistent verbal rhythm.
Output: a small measurement report used in every later step.

## Step 2 — Measure candidate voices

Synthesize the same set of test sentences with the built-in voices via the Lovable AI Gateway (`/v1/audio/speech`, already wired in `src/routes/api/speech.ts`):

- Gemini prebuilt voices that fit a warm female concierge: Kore (current), Leda, Aoede, Autonoe, Despina, Sulafat.
- If none lands close, also test `openai/gpt-4o-mini-tts` voices (it supports `instructions` steering and a `speed` parameter).
Measure each candidate's F0 and pace with the same script as Step 1, and rank them against Mary's measurements.

## Step 3 — Match and tune

- Pick the base voice with the closest pitch and pace profile.
- Rewrite the steering prefix in `src/routes/api/speech.ts` (currently "Say this warmly, calmly and confidently...") to encode Mary's actual delivery from the analysis.
- If her natural pitch sits above or below the chosen voice, add a small pitch correction in `src/lib/audio-engine.ts` playback (playbackRate shift with speed compensation on the TTS request, or a light phase-vocoder pitch shift). Keep it subtle and optional behind a constant, so it can be dialed to 1.0 easily. Respect existing playback architecture (shared AudioContext, chunk scheduling).
- If pace needs adjusting and the chosen model lacks a speed control, switch the base to `openai/gpt-4o-mini-tts` for its `speed` + `instructions` support.

## Step 4 — Verify

- Re-run the measurement script on MARY's generated audio; confirm median F0 and pace land within a close band of the real Mary's.
- Playwright pass on the live experience: voice session still works end-to-end, no console errors, hands-free flow unaffected.
- `bunx tsgo --noEmit` clean.

## Out of scope / noted

- Exact timbre cloning requires a cloning service plus the recorded person's consent; if the user ever wants that, revisit ElevenLabs.
- Recordings stay in /tmp for analysis only — never bundled, uploaded, or stored.