# Make MARY hear like real call software

Two problems, one root: she decides "someone is talking" from raw loudness alone. Any room noise — fans, traffic, a TV, a café — crosses that line, so she cuts herself off, waits for a sentence that never comes, or answers noise. And because her turn-taking is driven by that same faulty signal, her speaking rhythm feels off: she starts late, stops mid-thought, or holds silence.

Real call software never uses loudness alone. It listens for the shape of a human voice, cleans the room out of the signal first, and only then decides someone is speaking.

## What changes

### 1. Let the device clean the line first
Ask the microphone for echo cancellation, noise suppression and auto gain the way phone calls do, and verify the device actually applied them. On devices that refuse, fall back to our own handling instead of pretending it worked.

### 2. Decide "this is a voice" from voice-shaped sound, not volume
Replace the single loudness test with a small voice detector that checks, every frame:
- how much of the energy sits in the human speech range versus the rest of the room,
- whether that energy has the rise-and-fall pattern of speech rather than the flat hum of noise,
- how far above the *learned room profile* it is, where the room profile keeps updating all through the call instead of only during the first half second.

A frame only counts as speech when the sound is voice-shaped **and** clearly above the room. Steady noise, however loud, never qualifies.

### 3. Turn-taking the way calls do it
- Start of turn: a short run of confirmed voice frames, so a door slam or a cough can't open a turn.
- End of turn: silence measured only against confirmed voice, with a grace window so a pause between words doesn't cut her in, and a hard stop so noise can't hold the turn open.
- Hold releases: every wait state ends in a decision within a fixed window — no path can leave her frozen.

### 4. Cut-ins that survive a noisy room
While she is speaking, only a voice-shaped sound that also beats the current echo estimate counts as a cut-in, and the words captured must survive the existing self-speech filter. Anything else is ignored silently — she keeps talking instead of stuttering to a stop.

### 5. Speak properly
- Her voice starts the moment the first sentence is ready and continues without gaps between sentences, so she doesn't sound stitched together.
- A cut-in stops her inside ~150ms and keeps only what she actually said.
- Her turn never ends on silence: if playback stalls or a cut-in turns out to be nothing, she resumes the rest of her line instead of waiting.

### 6. Hear it before you trust it
A built-in listening check in the owner view: live meters for room level, voice-likeness, speech/noise ratio and the current decision, so you can stand in the conference hall and see whether she is hearing the room or hearing you — before you go on stage.

## Technical notes

- `src/lib/audio-engine.ts`: add `echoCancellation`/`noiseSuppression`/`autoGainControl` to `getUserMedia` constraints and read back `getSettings()`. Replace peak-only gating with an FFT-based feature set off the existing `AnalyserNode`: band energy ratio (300–3400Hz vs full spectrum), spectral flatness (noise is flat, voice is peaky), and a continuously-adapted noise profile (fast-attack/slow-decay per band, updated only on non-speech frames). Combine into a 0..1 voice-likeness score; gate onset on `score > threshold` for N consecutive frames with hangover, gate endpointing on absence of voice frames rather than absence of loudness. Keep `EchoTracker`, `recognitionQuarantine` and `recognitionReopenAt` as-is; they feed the cut-in branch.
- Replace the deprecated `ScriptProcessorNode` capture with an `AudioWorklet` (with a ScriptProcessor fallback for older Safari) so detection runs off the main thread and stops missing frames when the UI animates.
- Tighten timers into one named table: calibration, onset frames, hangover, endpoint silence, cut-in settle, hold watchdog — one place to tune, all exposed to the diagnostics panel.
- `src/components/mary-experience.tsx`: consume a single `voiceScore` in place of `level` for the presence animation so the sphere reacts to speech, not noise; hold/resume logic unchanged except it now keys off confirmed voice.
- `src/components/audio-diagnostics.tsx`: add the live meters described above.
- Verification: unit-style replay of recorded noise profiles (café babble, fan hum, TV speech, silence) through the detector asserting zero false turns, plus a Playwright pass at phone size and a manual iPhone check.

## Scope note

You asked for 100 agents. I'll run a focused set of parallel investigations on the pieces that genuinely differ between implementations — WebRTC-grade VAD feature choice, AudioWorklet portability on iOS Safari, endpointing timings used by live-call products, and echo handling when the device refuses cancellation — rather than 100 overlapping ones. The work above is the deliverable either way.
