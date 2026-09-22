# Roadmap

## In progress — live call hardening
- [ ] Research (25 parallel investigations): browser echo cancellation, barge-in design, transcript echo rejection, VAD, prompt grounding
- [ ] Stop MARY hearing herself: gate recognition + capture while she speaks, tail guard after playback, transcript-vs-her-lines echo filter, playback-aware energy threshold
- [ ] Make barge-in require real evidence (sustained energy + words that are not hers) before cutting her off
- [ ] Ground extraction: MARY may only record business/industry/operations the person actually stated or confirmed; guesses stay questions
- [ ] Verify with Playwright (fake mic) + scripted /api/turn conversations (ambiguous, one-word, guess-correction)

## Done
- [x] Rewrite `docs/mary-voice.md` as MARY's full playbook
- [x] Phase machine WELCOME → CLOSE derived from what MARY has said
- [x] Live call: persistent mic session, mute toggle, ordered turn queue
- [x] Boot screen restart fix; footer pinned in all stages
