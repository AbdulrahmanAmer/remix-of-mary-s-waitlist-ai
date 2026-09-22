# MARY Hands-Free Voice Conversation

Turn the existing push-to-stop microphone flow into a natural, hands-free conversation while preserving typing as an equal input option.

## Voice experience

- Keep the first microphone click as the browser-required consent gesture, then run the rest of the conversation hands-free.
- Detect when the visitor starts speaking and automatically submit their answer after a short natural silence; no second microphone click required.
- After MARY finishes each spoken reply, automatically reopen the microphone and return to listening for the next answer.
- Preserve barge-in: if the visitor speaks while MARY is talking, stop her audio and capture the visitor’s new turn.
- Keep the microphone button as a manual pause/resume control for privacy and noisy environments.

## End-of-speech detection

- Extend microphone capture with local voice-activity detection using the existing audio analyser rather than sending continuous background audio.
- Calibrate briefly for ambient noise, then use an adaptive threshold to distinguish speech from room noise.
- Require a short amount of real speech before accepting a turn, followed by roughly one second of silence before auto-stopping and transcribing.
- Add safeguards for very short noise spikes, empty transcripts, long recordings, and repeated silence so MARY does not respond accidentally or become stuck.
- Show clear live states—listening, hearing speech, finishing, thinking, and paused—through the existing MARY signal and composer.

## Typing remains available

- Keep the text field and Send action active throughout the session.
- Typing immediately pauses listening and MARY’s speech so microphone audio cannot compete with written input.
- Sending text follows the same conversation state and automatically returns to voice listening after MARY replies when hands-free mode is active.
- Microphone denial or unsupported browser features continue to fall back cleanly to typed conversation.

## Technical approach

- Add speech-start, silence, and maximum-duration callbacks to the browser audio recorder while retaining the existing WAV recording and amplitude reporting.
- Refactor the conversation controller into explicit listening lifecycle functions so auto-stop, manual stop, barge-in, cleanup, and restart cannot race each other.
- Track hands-free intent separately from the current recording state; only restart listening when the session is active, voice mode is enabled, and no response is processing.
- Ensure all audio tracks, recognition sessions, timers, and animation updates stop on pause, completion, navigation, or component cleanup.

## Validation

- Test one initial mic click followed by several complete voice turns without further clicks.
- Verify automatic response after natural silence, automatic listening after MARY replies, and barge-in while she speaks.
- Test background noise, a silent microphone, short utterances, manual pause/resume, muted voice, and microphone denial.
- Verify visitors can switch freely between voice and typing without duplicated messages, overlapping recordings, or lost conversation state.
