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

## 2026-09-23 - iPhone still silent: rebuilt on ElevenLabs' route (branch claude/iphone-audio-playback-compat-lmufp8)
FOUND (evidence, not hypotheses)
- The published site https://mary-waitlist-buddy.lovable.app never got a5156d2: same bundle (routes-B3mltORF.js) has no audioSession code, /soundcheck is 404, and an instrumented Chromium posing as an iPhone 13 shows the old path (24 kHz context, WebRTC loopback, second mic). Lovable only updates the published URL on Publish -> Update.
- ElevenLabs, from their shipped SDK (@elevenlabs/client 1.25.0, 2026-09-07) and their live site driven in the same instrumented browser: PCM -> AudioWorklet -> MediaStreamAudioDestinationNode -> hidden `<audio autoplay>`; mic opened first and kept live the whole conversation; never navigator.audioSession; on iOS an AudioContext unlocked in the tap + explicit audioElement.play() (1.8.1 fix for a silent first message). OpenAI, Vapi, Retell, LiveKit all end in an `<audio>` element with the mic live.
- WebKit source (MediaSessionManagerCocoa.mm, AudioContext.cpp): capture -> PlayAndRecord + DefaultToSpeaker; playing `<audio>` (MediaStream-backed counts as MediaType::Audio) -> MediaPlayback; Web Audio alone -> AmbientSound, which the ring/silent switch mutes. AudioContext may start without a tap while the page is capturing. So a5156d2 (Web Audio only, mic closed) was exposed to the silent switch; the old path's likely failure is the looped-back WebRTC track (Safari 27 notes: remote track not unmuted on first packet).
- Live AI routes began failing ~08:00 UTC: /api/speech 502 "Speech unavailable", /api/turn {"type":"error"}, /api/transcribe 502 (they returned 200 at 07:59). Upstream Lovable AI gateway (credits or rate limit?) - operator must check; she is silent on every device while this lasts.

DONE (uncommitted -> committed on the branch; see git log)
- iPhone/iPad route "element": hub -> MediaStreamDestination -> hidden `<audio>`, created and play()ed synchronously in the Start tap; no peer connection; direct leg kept as fallback. Desktop/Android keep the "call" (loopback) route.
- Mic from the tap handed to the hold recorder (takePrimedMic); iPhone keeps the track live for the call (desktop still disables it between holds). App no longer touches navigator.audioSession.
- resume()/play() waits capped (settled) so a line never hangs; "Can't hear her? / Play sound" on iPhone until the first answer (tap restarts audio in-gesture, then direct leg).
- /soundcheck rewritten: device/iOS/browser line, ring switch selector, new route with/without mic, app-order test, old routes, copy button. Diagnostics panel shows route + audio session.

VERIFIED (headless Chromium, not a real iPhone)
- iPhone UA: 0 RTCPeerConnection, 1 getUserMedia, 0 track stops/disables, 0 audioSession writes, element playing; synthetic 24 kHz PCM reaches the element (peak 0.40); touch hold -> /api/transcribe, mic stays live.
- Desktop UA: loopback route unchanged (callRoute true, peak 0.40 through it), track disabled between holds.
- typecheck 0 · lint 0 · test 67/67 · build 0.

REVIEW ROUND (adversarial workflow: 14 findings confirmed, 0 refuted) - fixed in the follow-up commit
- WebKit runs a MediaStream element's clock on wall time: the watchdog only catches a paused element, never a silent one. So "Can't hear her?" stays until "I can hear her" (or 3 answers), and returns when the output moves; Play sound alternates element <-> speakers inside the tap instead of dropping the element for good.
- A Play sound replay is stopped by a hold press / new line (stopCurrentLine from VoiceLine.stopSpeaking).
- HoldRecorder: close() during an in-flight open() wins (generation guard); concurrent opens share one mic.
- Call end releases the hidden element (iOS gives the audio back); Resume rebuilds it inside its tap.
- /soundcheck: each route test builds and tears down its own element, Web Audio-only tests first, results kept per ring-switch pass across a reload.
- Verified again in Chromium (iPhone + desktop profiles); gates 0/0/67/0.

FOLLOW-UP (independent diagnosis + 3 skeptics from the research workflow)
- Added ElevenLabs' element prime: after the mic is granted, ~100 ms of silence through hub -> element, then play() again (primeOutput).
- Safari on a Mac also takes the element route (isWebKitEngine: navigator.vendor Apple): the looped-back WebRTC track can stay muted there until Safari 27. Chrome/Firefox/Edge desktop keep the loopback.
- Verified in Chromium: iPhone, desktop and Mac-Safari (vendor) profiles; gates 0/0/67/0.
- Not done (noted as risks): screen wake lock (ElevenLabs holds one), a "playback" audio-session backstop for no-mic sessions, hands-free switch keeping capture continuous, AirPods staying in call profile while the mic is live.
- The phone may also have used the Lovable editor preview (iframe, possibly without allow="microphone"); test on the published URL in Safari itself.

UNPROVEN / NEXT
- A real iPhone. Operator: merge, Publish -> Update in Lovable, then on the iPhone open /soundcheck (ring switch silent and ring) and a real call.
- Fix the AI gateway failure first, or no device will hear her.

## 2026-09-23 - Apple readiness audit of merged main (44318ba) -> follow-up PR
- Audit workflow (3 area auditors, 2 refuters per finding, completeness critic). Verdict: approach correct (ElevenLabs route); not provable without a device. Confidence: iPhone Safari with mic medium, no-mic path low, Mac Safari medium, desktop Chrome high (all assuming the voice backend works and main is published).
- Fixed on the branch (restarted from main): screen wake lock for the call (requested in the tap, re-acquired on return, released at the end); recorder closed whenever the call screen goes away (a Hold press after "Type instead" left the mic on); element restarted once the mic is live so WebKit can join it to the voice-processing unit, as ElevenLabs builds its element after getUserMedia; /soundcheck test 6 reports a failed speech request; diagnostics no longer call the element route "echo cancellation degraded".
- Verified in Chromium (iPhone, desktop, Mac-Safari profiles): elementRestarted trace, audio still reaches the element (0.40), wake lock requested inside the tap (denied in headless, handled), desktop unchanged; gates 0/0/67/0.
- Still open (not code): voice backend 502 since ~08:00 UTC; publish main; real-device test (/soundcheck silent + ring, one call, one Type-instead call, Mac Safari call).

## 2026-09-26 - iPhone confirmed; Retell voice path built dormant (branches retell/*, PR pending)

FOUND
- Operator confirmed on a real iPhone 13 that MARY is audible after PR #1 (the ElevenLabs-style `<audio>` element route, 44318ba + 210a1ea). First real-device proof of the Apple route; Mac Safari, the no-mic path and AirPods are still unproven.
- Operator asked to finalize the Retell structure so the waitlist backend can switch to a Retell agent as soon as one exists. Decision: build it now, dormant behind `VOICE_PROVIDER` + keys (amends S4's "built later" for the code; going live still waits on the operator's Retell account).

DONE (plan: scratchpad `retell/plan.md`, judged from two designs against the real SDK sources; three work packages in parallel worktrees, merged by an integration step)
- WP0 contract `src/lib/retell-shared.ts` (c9aa879). WP1 server: env rule, HMAC signature (mirrors `retell-sdk` 6.0.1 `webhook_auth.ts`, golden vectors), call-to-lead mapping through the existing `groundCollected`, six handlers with injected deps, routes, guard budgets, fixtures. WP2 client: `/api/voice` probe at mount, lazy `retell-loader.ts` (the only value import of `retell-client-js-sdk` 3.0.1), `RetellCall` adapter with the proxy fetch, orb from `onAudio`, End call, typed-text inject, post-end poll, fallback to typing.
- WP3 (this branch): `retell/` agent as code (`llm.json`, `agent.json`, `prompt-header.md`, `config.ts`, `setup.ts` with dry run / `--apply` / `--publish`, `sign.ts`), every Retell field name checked against `retell-sdk` 6.0.1 `resources/{llm,agent}.ts`; `tests/unit/retell-config.test.ts` (15 tests: playbook edits occur exactly once, prompt contents, tools and agent match the shared contract); docs rewritten to the built reality (`retell-migration.md` BUILT/DORMANT, `retell-target.mmd`, corrected diagram subgraph, README env rows, CLAUDE.md facts, roadmap V2 status, sheets README).
- Dry run works: `bun retell/setup.ts --site https://example.com --voice test_voice` writes gitignored `retell/out/` and prints about 8k prompt tokens (about 2x Retell billing).

UNPROVEN
- No real Retell call, webhook, phone or Lovable deploy has run; unit tests use docs-shaped fixtures and fakes (`retell-migration.md` section 9 lists everything unverified).
- Captions (`RETELL_PUBLIC_KEY`) unresolved; Option A (own brain over WebSocket) not built.
- Whether `gpt-5.6-terra` follows the ported prompt's grounding discipline; five scripted calls must reach CLOSE with only grounded fields before `VOICE_PROVIDER=retell`.

NEXT
- Integration: merge WP1 + WP2 + WP3, all four gates, bundle check (`livekit` in exactly one lazy chunk, entry chunks grow < 5 KB), render gate with and without the Retell env, Worker smoke test with `.dev.vars`; open the PR (never push to `main`).
- Operator: answer the six questions in `retell-migration.md` section 10 (cost, transcript storage, voice id, loud-room default, captions, call limits), create the Retell account, then follow `retell/README.md` go-live.
