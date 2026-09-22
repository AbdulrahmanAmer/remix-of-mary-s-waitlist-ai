# Roadmap

## Next
- [ ] Move the microphone graph from ScriptProcessorNode to an AudioWorklet
- [ ] Scripted /api/turn conversations for the edge cases (ambiguous "a shop", one-word "consulting", guess-correction) as a repeatable check

## Done
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
