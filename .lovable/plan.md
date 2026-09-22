# Fix the iPhone call: no sound out, no microphone in

On your iPhone neither direction works — you can't hear MARY and she can't hear you. Everything else (typing, layout, the conversation itself) is fine, so this is the audio start-up path on iOS Safari specifically.

## What is most likely going wrong

Two separate iOS rules, both hit at once:

1. **Her voice is routed through a hidden "phone call" audio path.** That route exists so the iPhone can cancel her voice out of your microphone. On iOS this same route gets muted by the ringer/silent switch and can be sent to the quiet earpiece speaker instead of the loudspeaker. Result: she looks like she is talking, nothing comes out.
2. **The microphone is asked for a couple of seconds after your tap**, not during it. iOS only reliably treats a permission request as "the user asked for this" while the tap is still being handled. Late requests can be refused silently, with no prompt shown — which matches "she can't hear me" with no permission popup.

## The fix

**Ask for the microphone the moment you tap.** The request moves into the Talk to MARY tap itself, before the intro animation, so the iPhone shows the prompt immediately and the audio session is opened with the tap's permission.

**Always make her audible, even if the call route fails.** Her voice gets a second, plain playback path that runs alongside the call route. If the call route produces no sound within a moment, playback switches to the plain route automatically. Being heard wins over echo cancellation; the existing echo filtering already covers the difference.

**Handle the silent switch.** If no sound is measured leaving the output while she is speaking, she shows a short, plain line: turn the ring switch on the side of your phone on, or plug in headphones — plus a Play sound button that restarts her voice on the loudspeaker.

**Tell you the truth about the microphone.** If no prompt ever appeared or permission was refused, the mic button becomes an explicit "Allow microphone" retry rather than a silent no-op, and the status line says she is reading, not listening.

**A quick self-check you can run on the phone.** A small diagnostics panel (reachable from the existing owner view) shows, live: audio engine state, whether the call route was built, whether sound is actually leaving the output, microphone permission state, whether the mic track is live, the measured input level, and whether the browser can do live captions. That way we can confirm on your actual device which of the two problems is biting, instead of guessing.

## Verification

- Run the automated start-up checks again (no call route, denied mic, no mic) to confirm nothing regressed.
- Then you open the link on your iPhone, open the diagnostics panel, and read out the lines. Whatever it shows gets fixed in the same pass.

## Technical notes

- `src/components/mary-experience.tsx`: move `startMicSession` into the landing tap handler (awaited alongside `unlockAudio`) and pass the resulting session to the live stage instead of acquiring it in a `stage === "live"` effect; keep the existing `retryMic` path for later recovery.
- `src/lib/audio-engine.ts`:
  - `ensureSink` keeps the loopback element but also connects the destination node to `ctx.destination` as a fallback gate; an output-level watchdog (reusing the playback monitor's `lastSoundAt`) flips to direct output and sets `degraded = true` when the element produces no measurable output ~700ms into a line.
  - Export `audioDiagnostics()` returning context state/sampleRate, sink `ok`/`paused`/`degraded`, `lastSoundAt`, mic track `readyState`/`muted`, `navigator.permissions` mic state, and SpeechRecognition availability.
  - Add a `replayCurrentLine()` used by the Play sound button.
- New `src/components/audio-diagnostics.tsx` rendered inside `waitlist-vault.tsx` as a third tab, polling `audioDiagnostics()` at 500ms.
- No changes to the conversation logic, prompts, sheet sync, or layout.
