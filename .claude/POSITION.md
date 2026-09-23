# POSITION - MARY waitlist

## 2026-09-23 - workspace setup + full audit (session 1)

DONE
- Dependencies installed (`bun install --frozen-lockfile`, 424 packages).
- codebase-memory graph indexed; after the audit, 1,970 nodes / 2,491 edges, with the ADR stored (`.codebase-memory/adr.md`).
- Vector index: `.claude/tools/vector-index.mjs` (local MiniLM, incremental): 89 files / 294 chunks over src, docs (including audit), .lovable plans, diagram and state files.
- Final gates: tsc exit 0 · build exit 0 · lint 1 error (`src/lib/voice-detector.ts:195`, pre-existing, left for stage 3) · agent-os gate watched-fail on `src/` (hook + git pre-commit) · rule budget 23/80.
- agent-os: `PROJECT-STATE.md` (STAGE 0), git pre-commit gate, 14 skills in `.claude/skills/`, payload in `.agent-os/`.
- Diagram imported: `docs/architecture/{diagram.png,architecture.mmd}`; corrected version `architecture.corrected.mmd`.
- Audit: `docs/audit/GAP-REGISTER.md` + five area files. P0/P1 re-verified by hand; OP-04 refuted, VA-08 downgraded.
- Local git set to LF (`core.autocrlf=false`); ESLint/Prettier ignore the tooling dirs.

NOT DONE / UNPROVEN
- Nothing in `src/` was changed (stage 0 forbids it). All gaps in the register are open.
- AI routes were never exercised end to end: no `LOVABLE_API_KEY` locally.
- Workspace changes are uncommitted; the operator decides whether to commit (commits to `main` sync to Lovable).

NEXT
- Operator states the goal (D1) and answers D2-D5 in `PROJECT-STATE.md`, then advances the stage.
- Then: write the plan (`writing-plans` skill), sliced, P0s first.

## 2026-09-23 - cleanup (session 1, second half) - STAGE 3

DONE (plan `docs/plans/2026-09-23-cleanup.md`, statuses in `docs/audit/GAP-REGISTER.md`)
- vitest + 31 unit tests; `typecheck`/`test`/`dev:local`/`preview` scripts; CI workflow.
- `/api/*` guard (403 cross-site, 413 size, 429 per-IP per route), bounded turn input, no upstream error echo.
- Bugs: AI-05 phone skip, VA-01 silent TTS failure, FE-06 timers, VA-04 output release, FE-09, FE-01 aria-live, DR-04 prompt contradiction.
- Removed 44 dead UI files + 37 packages; unused-code checks on; README, roadmap, CLAUDE.md updated; indexes rebuilt.

VERIFIED
- typecheck 0 · lint 0 · test 31/31 · build 0 (also from a clean copy). Render: production Worker 0 uncaught, bounded; only console error is the Lovable-hosted logo, which `dev:local` / Lovable hosting serve (200).

NOT DONE / UNPROVEN
- Voice path changes (VA-01 notice, VA-04 release, echo helper) are typechecked and unit-tested only where pure; no real call ran (no LOVABLE_API_KEY locally, no device).
- Rate limit is per isolate (PARTIAL). D2-D5 items untouched. Nothing committed or pushed.

NEXT
- Operator: review the diff, decide to commit (syncs to Lovable), answer D1-D5.

## 2026-09-23 07:55 - hold-to-talk for the conference (TODAY) - STAGE 3

CONSTRAINT: conference is TODAY; Retell may never arrive. V1 must work on the floor.

DONE (pushed to main: 8eb0b34, 0904693; CI green on 8eb0b34)
- Hold-to-talk is the default (`voice/hold-recorder.ts`, `voice/hold-talk.ts`); hands-free behind "Quiet room?" header toggle.
- Rules (war room, `war-room/decisions.md`): min hold 300 ms, 250 ms re-press grace, 30 s cap, first 100 ms dropped, peak < -50 dBFS discarded locally, 2 misses -> "type instead".
- Held audio -> `transcribe()` directly, never the addressee judge. Press -> `runner.interrupt()` (no follow-up over them); `stopSpeaking` silences before re-render.

VERIFIED
- typecheck 0, lint 0, vitest 67/67 (hold-talk + interrupt tests watched-fail).
- Browser harness (scratchpad/hold-harness.mjs, fake mic, mocked AI): room audio alone sends nothing; WAV 16 kHz sent on release; no judge call; mis-tap/grace/space-bar/toggle OK; 0 console errors.
- Probe (scratchpad/probe-voice.mjs): press -> source.stop() 6 ms.

UNPROVEN / NOT DONE
- Real phone + real LOVABLE_API_KEY transcription never run. Lovable deploy of 0904693 unchecked.
- Harness "interrupt within 16 ms" check has broken instrumentation (FAILs); probe is the evidence.
- War-room office test (10 scripted holds, p50 < 900 ms) NOT run - needs a real device.
- MARY product knowledge: user will supply; goes into `docs/mary-voice.md` (her system prompt).

## 2026-09-23 - MARY script rebuilt on Omnikom V6 (7a47a56, CI green)
- Source: C:\Users\DELL\Downloads\omnikom-v6-native-mary-revenue-orchestration-master (1).md
- docs/mary-voice.md rewritten: revenue orchestrator identity, V6 loops, channel orchestration, human layer, policy-first, unlimited DB, planned pricing 297/597/997/custom (only when asked), no vendor names, event-floor handling.
- Decisions made without the operator (confirm): product name stays OmniSuite; she quotes V6 pricing as "planned launch pricing"; "built first around real estate"; CRM list phrased as "being built to plug into".
- Also also: space bar hold works in empty answer box (e92f3e2).
- UNPROVEN: behaviour on the real model (openai/gpt-6-astra via Lovable). Proxy check only: 4 simulated conversations with Claude Sonnet.

## 2026-09-23 - iPhone "no sound" fix (pushed, UNPROVEN on a real iPhone)
- Root-cause hypothesis (evidence: code reading + samueleddy.com/writing/ios-safari-audio-sessions): iOS puts the page in phone-call mode while any mic is open or a WebRTC call route plays; TTS then goes to the earpiece or is muted. The app kept the mic open all call (primed stream never released; hold recorder only disabled its track) and played her voice through a WebRTC loopback <audio> element.
- Fix (Apple mobile only): direct Web Audio output at native rate (no loopback, no RTC warm-up), resume context every line incl. "interrupted", silent unlock buffer in the tap, primed mic released after permission, mic opened per hold and released after, audioSession "playback" / "play-and-record" per phase.
- Verified in Chromium with iPhone UA: 0 peer connections, 0 live mics while she talks, session flips correctly; checks watched-fail against old behaviour. Desktop harness unchanged.
- /soundcheck page: 6 output routes with heard/silent marks + device state; the evidence path if the fix is not enough.
- Hands-free mode on iPhone still keeps the mic open (earpiece risk) - hold is default.
