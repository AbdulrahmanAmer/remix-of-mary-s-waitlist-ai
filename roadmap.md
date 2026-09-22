# Roadmap

## Now
- [ ] Connect the Google Sheet: paste `docs/google-sheets/Code.gs` into the sheet's Apps Script, deploy as a web app, then add `SHEETS_WEBAPP_URL` (and optional `SHEETS_WEBAPP_SECRET`) as project secrets — waits on the owner

## Next
- [ ] Real waitlist position everywhere: once the sheet answers, retire the on-device estimate on the end screen and in the owner view
- [ ] Cut-in confirmation should be echo-aware (compare against the echo model's expected tail, not only the room floor) and require words when speaker coupling is high
- [ ] Move the microphone graph from ScriptProcessorNode to an AudioWorklet
- [ ] Scripted /api/turn conversations for the edge cases (ambiguous "a shop", one-word "consulting", guess-correction) as a repeatable check
- [ ] Field-notes quality gate: a repeatable script that replays saved transcripts through /api/reflect and flags notes that leak names or contradict the playbook

## Done
- [x] Phone layout: long messages are proper rounded bubbles, the call is locked to the visible screen with the composer above the keyboard and the home indicator, older lines fade at the top of the thread, progress dots move into the header on narrow screens
- [x] Natural pacing: no more "take your time writing" lines while someone types; "MARY is thinking…" shows while she works; a silent or suspended audio output can no longer freeze a turn mid-line
- [x] MARY learns: after each conversation she debriefs herself (summary, objections, what worked/stalled, up to 5 PII-free lessons); lessons live in the browser and pool in the sheet's Experience tab, and the best ones ride into every turn as field notes
- [x] Google Sheet receiver (`docs/google-sheets/Code.gs` + README): Waitlist / Experience / Activity tabs, upsert by session, status that never downgrades, real position handed out once, partial rows for people who leave, secret check, self-test; verified in a simulated spreadsheet
- [x] Closing: sign-up ends with the exact launch line, callback confirms name + number and says goodbye, decline gets one warm line; the end screen is personal (position, what happens next, details confirmed / what the team receives) — verified for all three on a phone-sized screen
- [x] Owner view (Ctrl/Cmd+Shift+W): sheet connection status, conversations with transcripts, and MARY's field notes
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

## Cross-browser startup (done 2026-09-22)
- Her voice now plays even when the WebRTC loopback route fails (Safari/Firefox/older WebViews); previously she was silently inaudible.
- Audio element is primed inside the tap so iPhone Safari allows playback.
- Mic context resumes on iOS; both contexts are woken by the watchdog after screen lock.
- Specific messages for blocked / missing / busy mic, http pages and unsupported browsers; status line points at typing when there is no mic.
- ResizeObserver guarded with window resize/orientation fallback.
