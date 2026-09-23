# MARY V1 experience rewrite - design spec

Date 2026-09-23. Operator decisions (via the brainstorming companion): orb **H** (lime aurora, ChatGPT-
style round orb), landing **Live preview**, call screen **Stage**, keep the current colours exactly,
rewrite the experience (not a reskin). Background and layering rationale: `docs/architecture/mary-system-design.md`.
Baseline preserved at tag `v1-lovable-experience`.

## Scope

In: everything under the old `mary-experience.tsx` and its UI companions (`mary-presence`, `mary-boot`,
`boot-gate`, `progress-constellation`, `aurora-background`), replaced by `src/features/mary/`.
Out (unchanged): `lib/audio-engine.ts`, `voice-logic.ts`, `voice-detector.ts`, `mary-stream.ts`,
`mary.functions.ts`, grounding, prompt, lead-sync, stores, `waitlist-vault.tsx`, `/api/*`, the sheet.

## Modules

| Module | Responsibility |
|---|---|
| `signal/level-store.ts` | Voice level (0-1) and orb state outside React; subscribe/get for the orb's frame loop |
| `ui/mary-orb.tsx` | H shader (WebGL1), premultiplied alpha on paper; 2D-canvas fallback when WebGL is missing; still frame under reduced motion; states idle/listening/hearing/thinking/speaking/done |
| `conversation/machine.ts` | Pure reducer: stage (`boot`,`landing`,`call`,`done`), lines, collected, flags, result, reveal |
| `conversation/turn-runner.ts` | The turn queue with injected deps (stream turn, fallback turn, say, clock) |
| `conversation/lead-lifecycle.ts` | Checkpoint, final save + position, page-close beacon, debrief |
| `voice/use-voice-line.ts` | Mic session + speak over the audio engine; hold/pause/cut-in rules |
| `ui/*` | BootScreen, Landing, CallStage, Composer, ProgressPills, EndScreen, SiteFrame |
| `mary-app.tsx` | Composition; replaces `BootGate` in `routes/index.tsx` |

## Behaviours that must survive (from the old code)

1. Tap to start: mic permission is requested inside the tap before any await (iOS), then `unlockAudio`; mic errors use the same plain-language messages (denied, no device, busy, insecure, unsupported, in-app browser).
2. The welcome turn runs in the same queue as every later turn.
3. Turn runner: newest turn wins (generation counter); first beat plays as soon as streamed; near-repeat guard (80% word overlap) with one non-streaming retry; collected fields replaced from the turn; follow-up after 260 ms unless held; flags `revealed`/`lanesDone`/`introDone` only count if the words were heard in full; ending rules: callback needs name+phone, sign-up needs every field except phone, declined; 1.3 s breath before the end screen; a failure says "I hit a snag on my side — could you try that once more?".
4. Sending (typed or spoken) interrupts her; the transcript keeps only the words she got out, marked cut off.
5. Utterances: transcribe when there is no text and the clip is ≥350 ms with peak ≥0.02; strip her echo; ask `judgeAddressee`; non-addressed speech is ignored and releases any hold.
6. Mic callbacks: speech start → hearing; interrupt candidate → pause her; confirmed → hold; cancelled → resume (count false cut-ins, maybe show the headphones hint); ambient → release; lost → message and typing.
7. A hold never lasts more than 5 s; the iPhone silent-switch hint when her voice had to go to speakers; the mic comes back on its own when permission is granted in settings.
8. Mic mute and voice on/off (voice off animates her words without audio); idle nudges only when she cannot hear (22 s, at most 3).
9. Collected details are saved to the browser immediately, and a checkpoint reaches the sheet 5 s later; known fields are restored on reload.
10. Final save → end screen at once with "Securing your place…", then the sheet's position (or the local one when no sheet), then the debrief.
11. Decline → "Keep talking to MARY" resumes; "Start another conversation" starts a new session.
12. Page hidden/closed mid-call → abandoned beacon with the debrief flag (same guard as today).
13. Owner view: five quick taps on "omnikom" (and the vault's own keyboard shortcut).
14. Phone keyboard: the call screen follows the visual viewport; the composer is focused only on hover-capable devices.
15. Screen readers get each MARY line once via `aria-live`.

## Fixes the rewrite must deliver

- No blank screen between boot and landing (the boot hands over to a landing that is already rendered).
- Voice level never re-renders React; word reveal updates at word granularity only.
- No `filter: blur()` transitions on large sections; transform/opacity only.
- Call screen has no empty band: orb and her line are one centred group (Stage layout).

## Acceptance

- `bun run typecheck`, `lint`, `test`, `build` all exit 0 (CI too).
- New unit tests for machine, turn runner and lead lifecycle.
- Harness run (scripted AI, desktop + phone) completes the conversation to "You're on the list"; long tasks and janky frames lower than the baseline run in `run-before`.
- Render gate on `/` clean on the production Worker (except the known Lovable-hosted logo 404 locally).
