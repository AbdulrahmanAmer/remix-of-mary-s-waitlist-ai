# MARY: how it is wired today, and how a senior team would build it

Written 2026-09-23 before the V1 rewrite. The current code is preserved as branch
`archive/v1-lovable-experience` and tag `v1-lovable-experience` (commit `53d86c4`).

## 1. What Lovable built

One React component, `mary-experience.tsx` (1,977 lines), is the whole product: screen layout,
animation, the call state machine, the turn queue, microphone and speaker control, cut-in handling,
lead saving, the debrief and page-close recovery. Under it sit hand-built libraries that are
individually reasonable: `audio-engine.ts` (1,915 lines of WebRTC loopback, echo model, VAD, barge-in),
`voice-logic.ts`, `mary-grounding.ts`, the prompt, and the sheet bridge.

### Where it falls short of a senior build

| Area | What exists | Why it hurts |
|---|---|---|
| State | ~25 `useState` plus ~45 `useRef`, the same facts held twice (`collected` and `collectedRef`, `lines` and `linesRef`) and synced by hand | No single source of truth. Every fix has to remember both copies, and a missed one shows up as a stale reply or a frozen call |
| Call lifecycle | Implied by flags: `busyRef`, `holdRef`, `pendingInterruptRef`, `interruptRef`, `sessionFinishedRef`, `turnGenerationRef` | There is no written list of states or legal transitions, so "stuck" states are possible and cannot be tested (the code even has a 5-second "last line of defence" timer to un-freeze itself) |
| Rendering | Voice level from the mic and her voice calls `setState` every frame; the word reveal calls it on every progress tick | The whole 2,000-line tree re-renders about 60 times a second while anyone speaks. That is the main reason the experience is not smooth |
| Motion | Large `filter: blur()` enter/exit transitions on whole sections, a layout-animated header, a logo "flight" measured with `getBoundingClientRect` and timers | Blur on large layers is expensive, timers race the real state, and the boot → landing hand-off leaves a blank screen |
| Voice transport | A home-made real-time audio stack (echo cancellation through a WebRTC loopback, custom VAD, barge-in scoring, a speakers fallback) | This is the hardest problem in the product and the least verifiable: its "verified in a simulated room" claims have no test in the repo. It is tied directly to the UI with no interface in between |
| Turn protocol | Ad-hoc NDJSON (`say`, `turn`, `error`), a second non-streaming fallback path, and a client-side repeat detector that asks the model again | Two code paths for one thing, and repair logic in the browser |
| Trust boundary | The browser sends the whole conversation, the collected fields and the phase flags on every turn | The server believes whatever it is sent (gaps AI-03, AI-04) |
| Data | Lead sync is fire-and-forget; a failure is only visible as a `console.error` | Leads can silently fail to arrive |
| Quality | No tests, no CI (both added during this cleanup), no telemetry on turn latency or cut-ins | Nobody can tell whether a change made calls better or worse |

## 2. How a senior team would layer it

Seven layers, each owning one concern, talking through small typed interfaces.

1. **Experience (UI).** Presentational components only: stages, composer, progress, end screen.
   A token-based design system and one motion vocabulary. Transform/opacity animation only; no
   layout thrash; no business logic in components.
2. **Presence renderer.** The orb on the GPU (a WebGL shader), driven by a signal store rather than
   React state, with a 2D fallback and a reduced-motion still. It reads the voice level inside its own
   frame loop, so audio never re-renders the page.
3. **Call state machine.** An explicit, typed state machine for the call: `idle → connecting →
   listening ⇄ userSpeaking → thinking → marySpeaking ⇄ interrupted → ended`, with guards and
   timeouts as transitions, not rescue timers. Pure and unit-tested; the UI subscribes to it.
4. **Conversation domain.** Turn orchestration (queue, first-beat streaming, cut-off accounting,
   ending rules), grounding and phase logic as pure functions with injected I/O. Tested with fakes.
5. **Voice transport (an interface).** `VoiceTransport { start, stop, speak, mute, events }`. V1's
   implementation wraps the existing audio engine; V2 swaps in Retell (managed WebRTC with server-side
   VAD, barge-in and echo handling) without touching layers 1-4. This is where a senior team would
   buy rather than build: real-time duplex voice is a product in itself.
6. **Server.** Typed endpoints behind one guard (origin, size, rate limit, later a signed session
   token). The server owns the session: it keeps the conversation and collected fields, so the browser
   sends only the new utterance. One streaming protocol, one code path.
7. **Data and observability.** Idempotent lead upserts keyed by session, with an outbox (retry queue)
   so a lead cannot silently vanish; the sheet as the owner's view and a database as the record when
   needed. Events for turn latency, cut-ins, errors and drop-off; a synthetic-call harness in CI;
   performance budgets (frame time, long tasks) checked on every change.

## 3. What the V1 rewrite takes from this (now), and what waits for V2

**V1 (this rewrite, on Lovable hosting):** layers 1-5 on the client.
- New feature folder `src/features/mary/` with the call machine, turn runner, lead lifecycle, signal
  store, `VoiceTransport` wrapping today's engine, and the new UI (H orb, Live-preview landing,
  Stage call screen).
- The existing engine, grounding, prompt, API routes and sheet contract stay as they are, so voice
  timing tuned on real phones is not re-derived.
- Unit tests for the machine, turn runner and lead lifecycle; the Playwright call harness before and
  after, with frame-time and long-task numbers.

**V2 (Retell + Cloudflare, designed in `retell-migration.md` and `cloudflare-migration.md`):** layers 5-7
on the server. Retell becomes the `VoiceTransport`, the server owns the session, leads go through an
outbox, and telemetry is added.
