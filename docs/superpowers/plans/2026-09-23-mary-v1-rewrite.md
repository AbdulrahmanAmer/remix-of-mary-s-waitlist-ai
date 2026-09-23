# MARY V1 Experience Rewrite Implementation Plan

> **For agentic workers:** executed inline by the authoring session (operator: "get it done end to end", no review rounds). Steps use checkbox syntax for tracking.

**Goal:** Replace the 1,977-line `mary-experience.tsx` and its UI companions with a layered feature (`src/features/mary/`) that keeps every behaviour in the spec, fixes smoothness at the root, and ships orb H, the Live-preview landing and the Stage call screen.

**Architecture:** One external session store (single source of truth, `useSyncExternalStore`) replaces ~70 hooks and refs; a pure reducer defines state changes; the turn queue and lead lifecycle are classes with injected I/O (unit-tested with fakes); the voice line wraps the unchanged audio engine; the orb is a WebGL shader fed by a signal store outside React.

**Tech Stack:** React 19, TanStack Start, motion 13, Tailwind v4, WebGL1, vitest 5.

Spec: `docs/superpowers/specs/2026-09-23-mary-v1-rewrite-design.md`. Baseline: tag `v1-lovable-experience`. Branch: `feat/mary-v1-rewrite`.

---

## File map

| File | Responsibility |
|---|---|
| `src/features/mary/signal/signal.ts` | `createSignal<T>()`: get/set/subscribe outside React; `voiceLevel` instance |
| `src/features/mary/conversation/types.ts` | `Line`, `Stage`, `PresenceState`, `ListeningPhase`, `ConversationOutcome`, `ConversationResult`, `SessionState` |
| `src/features/mary/conversation/reducer.ts` | Pure `reduce(state, action)`; `initialState()` |
| `src/features/mary/conversation/store.ts` | `createSessionStore()` (get, dispatch, subscribe) + `useSession(selector)` |
| `src/features/mary/conversation/text.ts` | `toMessages`, `transcriptOf`, `isNearRepeat`, `fieldsKey`, `closingCopy`, `micMessage`, `micLostMessage`, `endingFor` |
| `src/features/mary/conversation/turn-runner.ts` | `TurnRunner`: welcome/send/queue/stale/first beat/repeat guard/flags/ending |
| `src/features/mary/conversation/lead-lifecycle.ts` | `LeadLifecycle`: checkpoint, finalize + position, flush beacon, debrief |
| `src/features/mary/voice/use-voice-line.ts` | Mic session + speak + hold rules; writes store + `voiceLevel` |
| `src/features/mary/ui/mary-orb.tsx` | H shader orb, 2D fallback, reduced-motion still |
| `src/features/mary/ui/boot-screen.tsx` | Boot overlay that hands over to an already-rendered landing |
| `src/features/mary/ui/landing.tsx` | Live-preview landing |
| `src/features/mary/ui/call-stage.tsx` | Stage call screen (orb + line + echo + history drawer) |
| `src/features/mary/ui/composer.tsx` | Mic button, textarea, send, status line, notices |
| `src/features/mary/ui/progress-pills.tsx` | Collected-details pills |
| `src/features/mary/ui/end-screen.tsx` | Outcome screen |
| `src/features/mary/ui/site-frame.tsx` | Header (logo, pills slot, voice toggle) + footer (owner taps) |
| `src/features/mary/mary-app.tsx` | Composition root |
| `src/routes/index.tsx` | Render `MaryApp` instead of `BootGate` |
| Delete | `mary-experience.tsx`, `mary-presence.tsx`, `mary-boot.tsx`, `boot-gate.tsx`, `progress-constellation.tsx`, `aurora-background.tsx` (+ their CSS in `styles.css`) |
| Tests | `tests/unit/session-reducer.test.ts`, `turn-runner.test.ts`, `lead-lifecycle.test.ts`, `mary-text.test.ts` |

## Tasks

- [ ] **T0** Branch `feat/mary-v1-rewrite`; baseline harness numbers already in `scratchpad/run-before/desktop-report.json` (751/1903 frames >33 ms, 9 long tasks, 628 ms).
- [ ] **T1 Signal + types + reducer + store.** Tests first: `START_CALL` moves landing→call and records start time; `ADD_LINE`/`CUT_LINE` keep only the heard words and mark `interrupted` (empty → line removed); `SET_COLLECTED` replaces; `MERGE_FLAGS`; `FINISH` → stage done + result pending + presence done; `RESUME` → stage call, result null; `SET_RESULT` only while done. Run `bun run test` red → implement → green.
- [ ] **T2 Text helpers.** Tests: `isNearRepeat` 80% threshold; `endingFor` (callback needs name+phone; sign-up needs all but phone; declined; else null); `toMessages` appends `CUT_OFF_MARK` to interrupted MARY lines; `closingCopy` names. Move logic verbatim from the old component.
- [ ] **T3 TurnRunner.** Deps: `streamTurn(req, onSay)`, `retryTurn(req)`, `say(text) → Promise<void>`, `stopSpeaking()`, `isHeld()`, `wait(ms)`, `lessons(industry)`, `onFinish(collected, outcome)`, `onSettled()`, `store`. Tests with fakes: welcome speaks say + followUp and settles; a `send` during a turn makes the old turn stale (its follow-up is never spoken); flags only set when the heard text contains the keyword; ending → `wait(1300)` then `onFinish`; a thrown stream → snag line; near-repeat of an earlier line triggers `retryTurn` once.
- [ ] **T4 LeadLifecycle.** Deps: `syncLead`, `beaconLead`, `saveProgress`, `reflect(payload)`, timers, `payload(outcome, extra)`. Tests: checkpoint fires once 5 s after the last change and never after `finalize`; `finalize` returns local position when not configured, sheet position when saved, `failed` otherwise, then debriefs once (≥2 turns, ≥2 new); `flush` is skipped when nothing changed since the last abandoned beacon.
- [ ] **T5 Voice line hook** over `startMicSession`/`speak`/`transcribe`/`judgeAddressee` implementing spec items 4-8; level to `voiceLevel.set`, never React state.
- [ ] **T6 Orb.** WebGL1 shader from the approved mockup (H), states tune speed/level, `voiceLevel` read per frame, DPR ≤2, pause when off-screen/hidden, 2D fallback, reduced-motion still, context-loss safe.
- [ ] **T7 UI screens** per the approved mockups: Landing (typed opener card, reply bubble, waveform from `voiceLevel`, "Start talking" / "Type instead"), CallStage (orb + her line large + your last answer as echo + "Show conversation" drawer), Composer, ProgressPills in header, EndScreen, BootScreen. Motion: transform/opacity only, one easing, shared-element orb between landing and call (`layoutId`).
- [ ] **T8 Composition + route + deletions.** `MaryApp` wires store, runner, lifecycle, voice line, owner taps, page-hide flush, restore on load, idle nudges, viewport. Delete the old files and dead CSS.
- [ ] **T9 Verify.** `bun run typecheck && bun run lint && bun run test && bun run build` all exit 0; harness (desktop + mobile) reaches "You're on the list" with fewer janky frames and long tasks than baseline; screenshots reviewed against mockups; render gate on the production Worker.
- [ ] **T10 Ship.** Merge to `main`, push (Lovable sync), watch CI green, update `PROJECT-STATE.md`, `.claude/POSITION.md`, register.
