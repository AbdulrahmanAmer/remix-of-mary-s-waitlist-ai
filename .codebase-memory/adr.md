## PURPOSE
MARY: an AI voice concierge that greets a visitor in the browser, explains OmniSuite, and signs them onto the waitlist through a live voice call (typing fallback). Built by Lovable, synced to GitHub main.

## STACK
React 19, TanStack Start/Router (file routes, server handlers), Vite 8, Nitro 3 beta -> Cloudflare Worker, Tailwind v4, motion, zod, Vercel AI SDK (ai@7 + @ai-sdk/openai@4) against the Lovable AI gateway (LOVABLE_API_KEY), Google Apps Script sheet as the lead/experience store (docs/google-sheets/Code.gs). bun for installs.

## ARCHITECTURE
Client: routes/index.tsx -> boot-gate -> mary-experience.tsx (1945-line orchestrator: phase machine, turn queue, UI) using lib/audio-engine.ts (1915 lines: mic capture via AudioWorklet, TTS playback over WebRTC loopback or direct, echo model, barge-in) + voice-logic.ts/voice-detector.ts (pure decisions). Turns: mary-stream.ts -> POST /api/turn (NDJSON stream; prompt in mary-prompt.server.ts, grounding in mary-grounding.ts, field notes from mary-experience.server.ts), fallback server fn maryTurn (mary.functions.ts). Voice: /api/speech (TTS SSE), /api/transcribe (STT). Leads: waitlist-store.ts (localStorage) + lead-sync.ts -> /api/lead -> sheets.server.ts -> Apps Script. Post-call /api/reflect writes PII-free lessons pooled into every future prompt. Owner view: waitlist-vault.tsx (hidden gesture). Corrected diagram: docs/architecture/architecture.corrected.mmd.

## PATTERNS
Server-only modules end in .server.ts. Grounding: extracted fields need verbatim evidence from the person's lines. Phase derived from what MARY has said. One turn queue; one audio output leg.

## TRADEOFFS
Known gaps (docs/audit/GAP-REGISTER.md): public API routes with no auth/rate limit/body caps (P0), sheet not connected so leads are browser-only (P0), cross-session prompt injection via reflect lessons, no tests/CI, AI unusable off Lovable, 44/45 shadcn components unused, two god files.

## PHILOSOPHY
agent-os stage gate (PROJECT-STATE.md) decides what may be written; decisions live in files, not chat. Verify by running the gate (tsc, lint, build, render-gate), never by claim.
