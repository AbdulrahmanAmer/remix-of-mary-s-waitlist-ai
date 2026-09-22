# Roadmap

## Now
- [ ] Phone layout: long user messages render as a proper bubble (no circle), composer locked above the keyboard, nothing slips under the screen, progress rail moves out of the text on narrow screens
- [ ] MARY learns: after every conversation she writes field notes (what worked, what stalled, objections) that feed her next conversations — kept in the browser and, once connected, in the Google Sheet
- [ ] Google Sheet: Apps Script receiver (Waitlist + Experience + Activity tabs), lead upsert by session, real waitlist position, partial rows for people who leave mid-conversation
- [ ] Closing: she confirms and says goodbye properly for sign-up, callback and decline; the end screen is personal, shows the confirmed position, what happens next, and the details captured

## Next
- [ ] Cut-in confirmation should be echo-aware (compare against the echo model's expected tail, not only the room floor) and require words when speaker coupling is high
- [ ] Move the microphone graph from ScriptProcessorNode to an AudioWorklet
- [ ] Scripted /api/turn conversations for the edge cases (ambiguous "a shop", one-word "consulting", guess-correction) as a repeatable check

## Done
- [x] Remove unsafe direct-speaker fallback; protected WebRTC playback now retries after failure and otherwise stays silent instead of entering the microphone
- [x] Close the caption watchdog race: no restart can bypass MARY's playback quarantine, and interruption captions reopen only after her measured output tail clears
- [x] Hard-stop browser live captioning while MARY is audible; reopen a fresh captioning session only after playback pauses or its echo tail clears
- [x] Research (25 parallel investigations): browser echo cancellation, barge-in design, transcript echo rejection, VAD, prompt grounding
- [x] Stop MARY hearing herself: playback-aware echo model (peak-hold coupling, learned only from echo-like frames), tail guard after playback, transcript-vs-her-lines echo stripping with garble tolerance, short/hallucinated transcript rejection
- [x] Barge-in needs real evidence: burst-tolerant onset score over the echo threshold, then a settle-and-verify window that always ends in a decision (resume or hold); stop-words cut in immediately, acknowledgements never do
- [x] Cutting her off is instant: she pauses on the first sign of a voice (~0.3 s after onset in a simulated room), stops for good once it is confirmed, and history keeps only the words she actually got out
- [x] She waits her turn: a line that starts while the person is already mid-sentence pauses on the spot instead of talking over them
- [x] One turn at a time: the welcome shares the same queue as everything after it, and an overtaken turn stops at its next step (fixes mixed-up bubbles)
- [x] Ground extraction: business/industry/operations/name are only recorded with the person's own words or an explicit confirmation of a tentative guess
- [x] Verified with a Playwright simulated room (her voice fed back into the mic at 0.1–0.5 coupling): echo-only never creates a user turn; a mid-sentence cut-in pauses her in ~0.3 s and is transcribed cleanly; a normal turn round-trips
- [x] Rewrite `docs/mary-voice.md` as MARY's full playbook
- [x] Phase machine WELCOME → CLOSE derived from what MARY has said
- [x] Live call: persistent mic session, mute toggle, ordered turn queue
- [x] Boot screen restart fix; footer pinned in all stages
