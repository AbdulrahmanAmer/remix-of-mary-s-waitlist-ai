# Swapping MARY's voice stack for Retell - target architecture

Status: DESIGN ONLY. Nothing in `src/` has changed. Diagram: `retell-target.mmd`, rendered to
`diagram.retell.png`. Written 2026-09-23 from Retell's docs (sources at the end); the SDK details
marked VERIFY must be confirmed against the installed SDK version before building.

## What changes, in one paragraph

Today MARY's voice is roughly 2,500 lines of in-house audio engineering Lovable built on top of three
separate AI calls: `audio-engine.ts` (mic capture, a WebRTC loopback for echo cancellation, a
playback-aware echo model, barge-in scoring, the speaker/call-route watcher), plus `/api/transcribe`
(speech-to-text), `/api/speech` (text-to-speech) and `/api/addressee` (was that speech for MARY?).
Retell replaces all of that with one managed real-time voice session. It does the listening,
turn-taking, interruptions, echo handling and speaking, and our code keeps only what is ours: the
screen, MARY's brain (prompt and grounding), and the lead pipeline.

## Component map

| Today (Lovable) | After the swap | Why |
|---|---|---|
| `lib/audio-engine.ts` (1,915 lines) | **deleted**; replaced by `lib/retell-call.ts` (~150 lines) wrapping `retell-client-js-sdk` | Retell owns capture, playback, echo, barge-in |
| `lib/voice-logic.ts`, `lib/voice-detector.ts` | **deleted** | Turn-taking and interruption rules live in Retell |
| `/api/transcribe`, `/api/speech`, `/api/addressee` | **deleted** | STT, TTS and addressee judgement are inside the Retell session |
| `lib/addressee.ts`, `components/audio-diagnostics.tsx` | **deleted** | Same |
| `components/mary-experience.tsx` | **kept, slimmer**: the call UI reads Retell events (status, transcript, agent talking, audio level) instead of driving an audio engine | The screen, orb, progress and end screen are ours |
| `mary-presence.tsx`, `progress-constellation.tsx`, `boot-gate.tsx` | **kept** | Pure UI |
| `lib/mary-prompt.server.ts`, `lib/mary-grounding.ts` | **kept** as MARY's brain (Option A below) or ported into Retell's prompt (Option B) | Personality, phases, and "only keep what they really said" |
| `lib/mary-experience.server.ts` (lessons) | **kept**, fed by Retell's post-call transcript | The transcript now comes from Retell, not the browser |
| `/api/turn` + `lib/mary-stream.ts` | **kept only for typing** (the no-microphone fallback) | Voice no longer uses it |
| `/api/lead`, `lib/sheets.server.ts`, Apps Script | **kept**; also called by Retell | Leads still go to your sheet |
| - | **new** `POST /api/retell/web-call` | Server mints the call with the secret key |
| - | **new** `POST /api/retell/functions/save-lead` | Retell calls it mid-call when details are confirmed |
| - | **new** `POST /api/retell/webhook` | `call_ended` / `call_analyzed`: transcript, outcome, analysis |
| - | **new** `wss /api/retell/llm/{call_id}` (Option A only) | Retell asks our server for each reply |

## How a call runs after the swap

1. The visitor taps start. The browser calls `POST /api/retell/web-call` (through the existing API guard).
2. The server calls Retell `POST /v3/create-web-call` with `RETELL_API_KEY`, `agent_id`,
   `metadata: { sessionId }` and `retell_llm_dynamic_variables` (e.g. the visitor's local time), and
   returns only the short-lived `access_token` (with `call_id`, `expires_at`) to the browser.
3. The browser joins with `retell-client-js-sdk`. Audio flows browser ⇄ Retell over WebRTC; our server
   is not in the audio path.
4. MARY's replies come from one of two brains:
   - **Option A: our brain (custom LLM).** Retell opens a WebSocket to
     `wss://<site>/api/retell/llm/{call_id}` and sends `response_required` / `reminder_required` /
     `update_only` events. Our handler reuses `buildPrompt`, `finishTurn` and grounding, streams the
     reply back as `response` events (`response_id`, `content`, `content_complete`) and sets
     `end_call` after the closing line. MARY keeps her exact current behaviour and field notes.
   - **Option B: Retell's LLM.** The playbook (`docs/mary-voice.md`) and the prompt's phase rules are
     ported into a Retell agent prompt; no WebSocket server is needed.
5. When the person confirms their details, the agent calls the custom function `save_lead`. Retell
   POSTs to `/api/retell/functions/save-lead` (signed with `x-retell-signature`), and our handler
   validates with `LeadPayloadSchema`, grounds the fields, writes the sheet row and returns the waitlist
   position, which MARY can say out loud.
6. The browser shows the live transcript from SDK transcript events, drives the orb from agent-talking
   and audio-level events, and moves to the end screen on the end event.
7. After hang-up Retell sends `call_ended`, then `call_analyzed` (transcript + `call_analysis`) to
   `/api/retell/webhook`. We verify the signature, upsert the sheet row (outcome, transcript,
   duration), and run MARY's debrief (`reflectAndStore`) on Retell's transcript.

## Recommendation

**Start with Option B, keep Option A as step two.** B needs no WebSocket server, and whether Lovable's
hosted Cloudflare Worker accepts a long-lived WebSocket upgrade on a TanStack Start route is
UNVERIFIED. A works technically on Workers, but on this host it is unproven. B gets a real voice agent
live fastest. Move to A if the ported prompt loses MARY's grounding discipline (the "only record what
they said" rules), which is the part of her that is most custom.

## What this fixes from the gap register

- Removes the whole unproven audio surface: VA-01…VA-10, DR-10, the direct-speaker fallback, echo and
  barge-in tuning, and the "verified in a simulated room" claims that nothing backs.
- Closes AI-04 (prompt injection through fake transcripts): lessons are learned only from transcripts
  that Retell signs, never from what a browser posts.
- Shrinks AI-01's paid-endpoint exposure from four routes to one (`/api/retell/web-call`), which the
  existing guard already rate-limits.

## What it does not fix

- **Leads still need a home (D2).** Retell stores calls, not your waitlist. Until the sheet (or a
  database) is connected, `save_lead` has nowhere durable to write.
- **Typing fallback** still uses `/api/turn` and the Lovable gateway (or Retell's chat API, as a
  separate decision).
- **Cost model changes** from per-token gateway calls to Retell's per-minute pricing plus its LLM.
  Budget before launch.

## New configuration

| Variable | Where | Purpose |
|---|---|---|
| `RETELL_API_KEY` | server secret | create web calls; verify `x-retell-signature` on functions and webhooks |
| `RETELL_AGENT_ID` | server | which agent to call |
| `VITE_RETELL_PUBLIC_KEY` | browser (only if using the SDK's public-key flow) | Retell's docs show a public-key `RetellClient`; the server-minted token flow above is preferred because it goes through our guard |

In the Retell dashboard: agent voice, webhook URL `https://<site>/api/retell/webhook`, custom function
`save_lead` → `https://<site>/api/retell/functions/save-lead` with a JSON-schema body (top-level
`"type": "object"`), and post-call analysis fields (`outcome`, `industry`, `business`,
`callback_requested`).

## Build slices (when approved)

1. `/api/retell/web-call` + `lib/retell-call.ts` + UI wiring behind a flag, with the old engine still in
   place. Exit: a real call connects, transcript shows, the orb moves.
2. `save_lead` function + webhook with signature checks, plus unit tests of the handlers using signed
   fixtures. Exit: a test call writes a sheet row and a lesson.
3. Port the prompt (Option B). Exit: five scripted calls reach CLOSE with only grounded fields.
4. Delete the old voice stack (engine, detector, logic, three routes) once 1-3 hold on real phones.
5. Optional: Option A WebSocket brain, after proving the WebSocket upgrade on Lovable's hosting.

## VERIFY before building

- The browser SDK entry point. Retell's current web-call page shows
  `new RetellClient({ key: "public_key_..." }).createWebCall({ agent_id, ... hooks })`; the older SDK
  used `RetellWebClient.startCall({ accessToken })`. Confirm which one the installed
  `retell-client-js-sdk` version exposes, and whether it accepts a server-minted `access_token`.
- The exact names of the SDK's transcript and audio-level hooks.
- WebSocket upgrade support on Lovable's hosting (Option A only).

## Sources

- Create web call: https://docs.retellai.com/api-references/create-web-call
- Web call SDK: https://docs.retellai.com/deploy/web-call
- Webhooks and signature verification: https://docs.retellai.com/features/webhook-overview
- Custom functions: https://docs.retellai.com/build/conversation-flow/custom-function
- Custom LLM WebSocket: https://docs.retellai.com/integrate-llm/overview
