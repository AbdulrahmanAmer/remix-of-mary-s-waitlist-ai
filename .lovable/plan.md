# Match MARY's voice to the real Mary — no external services

## Goal

Make MARY's spoken voice sound like the real Mary from the three recordings, without any cloning service or new account. Technique: measure the real voice's characteristics, then reproduce them through voice choice, delivery steering, and playback tuning. This approximates pitch, pace, and delivery — it is not an exact timbre copy. That limit is unavoidable without a cloning service and the real person's consent.

## The recordings

All three have arrived and are available for analysis:

- `REc5e84945123fc684f416564be1d00f58.wav`
- `20260226_1714_3305711455.mp3`
- `Call recording of (925) 366-6092 at 2026-04-21 02-08-32.mp3`

They are used for measurement only — copied to a temporary working folder, never added to the website or shared anywhere.

## Step 1 — Separate Mary from the other speaker

These are two-person conversations, so the analysis has to isolate her voice first. Speech segments are grouped into two speaker clusters by voice characteristics. If it is not obvious which cluster is Mary, a short sample of each is played back for confirmation before going further.

## Step 2 — Measure her voice

From her segments only:

- Pitch: median, range, and how much it moves while she talks.
- Pace: speaking rate and typical pause lengths between phrases.
- Delivery: energy level, warmth, and how she tends to end sentences.

This produces a short profile used in every later step.

## Step 3 — Find the closest available voice

The same test sentences are generated with each candidate built-in voice (Kore — the current one, Leda, Aoede, Autonoe, Despina, Sulafat), then measured with the same method and ranked against Mary's profile. If none lands close enough, an alternative speech model with finer speed and delivery control is tested too.

## Step 4 — Match and tune

- Switch MARY to the closest base voice.
- Rewrite her delivery instructions so the generated speech carries Mary's actual pacing, warmth, and phrasing rhythm.
- If her natural pitch sits above or below that voice, apply a small, subtle pitch correction during playback — adjustable, and easy to switch off.
- Adjust speaking speed to match her measured pace.

## Step 5 — Verify

- Re-measure MARY's generated speech and confirm pitch and pace land close to the real Mary's.
- Run through a full live voice session to confirm hands-free conversation, typing, and the pulsing composer all still work with no errors.

## Technical notes

- Analysis runs in `/tmp` with ffmpeg plus numpy/scipy: energy-gated speech masking, autocorrelation F0 with parabolic interpolation, MFCC-style clustering for the two-speaker split, pause/run statistics for pace.
- Voice steering lives in the speech prefix in `src/routes/api/speech.ts`; playback pitch/rate correction goes in `src/lib/audio-engine.ts` behind a named constant defaulting to a subtle value.
- Candidate synthesis goes through the existing Lovable AI Gateway speech route; no new dependencies and no new services.

## Out of scope

- Exact timbre cloning — that needs a cloning service and the recorded person's explicit consent.
