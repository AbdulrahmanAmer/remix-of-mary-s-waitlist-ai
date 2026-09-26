# MARY - the OmniSuite waitlist concierge

MARY greets a visitor, explains OmniSuite (a product by Omnikom), and signs them onto the waitlist
through a live voice call in the browser, with typing as a fallback. After each call she writes
herself a few PII-free lessons that inform later calls.

Built with [Lovable](https://lovable.dev/projects/73ac183b-3cba-490d-b4a7-e290763aaba5) and synced to
this repo's `main` branch: commits pushed to `main` appear in the Lovable editor. Never force-push or
rewrite pushed history (see `AGENTS.md`).

## Stack

React 19 · TanStack Start / Router (file routes and server handlers) · Vite 8 · Nitro, built as a
Cloudflare Worker · Tailwind v4 · motion · zod · Vercel AI SDK against the Lovable AI gateway ·
Google Apps Script sheet as the lead store (`docs/google-sheets/`).

## Run it

```sh
bun install
bun run dev:local    # dev server that also loads Lovable-hosted images (the logo)
bun run build && bun run preview   # the production Worker, locally, via wrangler
```

`bun run dev` is what Lovable's sandbox runs. Locally it cannot load images stored on Lovable
(`/__l5e/assets-v1/...` returns 404); `dev:local` points those requests at the project's Lovable preview.

| Script              | What it checks                                   |
| ------------------- | ------------------------------------------------ |
| `bun run typecheck` | `tsc --noEmit` (strict, unused code is an error) |
| `bun run lint`      | ESLint + Prettier                                |
| `bun run test`      | vitest unit tests in `tests/`                    |
| `bun run build`     | production build to `.output/`                   |

CI (`.github/workflows/ci.yml`) runs all four on every push and pull request.

## Environment

| Variable               | Needed for                                                                                                                                    | Without it                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LOVABLE_API_KEY`      | conversation (`/api/turn`), voice (`/api/speech`), transcription (`/api/transcribe`), debrief (`/api/reflect`)                                | those routes return 500; `/api/addressee` falls back to "addressed to MARY". Set automatically in Lovable hosting only, so the AI does not run locally today (see `PROJECT-STATE.md`, D3). |
| `SHEETS_WEBAPP_URL`    | sending leads and lessons to the Google Sheet                                                                                                 | leads stay in the visitor's browser only                                                                                                                                                   |
| `SHEETS_WEBAPP_SECRET` | authenticating to the sheet                                                                                                                   | the sheet accepts anyone holding its URL; set it, and the matching `SHARED_SECRET` in `Code.gs`                                                                                            |
| `VOICE_PROVIDER`       | choosing the voice path: `mary` (default), `retell-optin` (MARY unless `?voice=retell`) or `retell` (Retell unless `?voice=mary`)             | MARY's own voice stack, as today                                                                                                                                                           |
| `RETELL_API_KEY`       | the Retell path: minting web calls, reading calls, typed-text injection; also signs functions and webhooks unless `RETELL_WEBHOOK_KEY` is set | every `/api/retell/*` route answers 404 and `GET /api/voice` reports `retell:false`                                                                                                        |
| `RETELL_WEBHOOK_KEY`   | verifying Retell's `x-retell-signature` when the webhook-badged key is not `RETELL_API_KEY`                                                   | `RETELL_API_KEY` is used                                                                                                                                                                   |
| `RETELL_AGENT_ID`      | which Retell agent to call (created by `bun retell/setup.ts`, see `retell/README.md`)                                                         | the Retell path stays off                                                                                                                                                                  |
| `RETELL_AGENT_VERSION` | pinning the agent version (a number or a tag)                                                                                                 | `latest_published`                                                                                                                                                                         |
| `RETELL_PUBLIC_KEY`    | live captions on a Retell call (experimental, public by design)                                                                               | orb and progress only, no text of what she says                                                                                                                                            |

The Retell path is built but dormant: with none of the `RETELL_*` variables set, nothing changes
for visitors. `docs/architecture/retell-migration.md` describes it; `retell/README.md` has the
go-live checklist.

## How it fits together

`docs/architecture/architecture.corrected.mmd` (rendered: `diagram.corrected.png`, which predates the
Retell subgraph) is the map that matches the code. In short:

- `src/routes/index.tsx` → `features/mary/ui/boot-screen.tsx` → `features/mary/mary-app.tsx`, which
  runs the call: the session store and reducer (`conversation/`), the turn runner, the UI (`ui/`).
- `features/mary/voice/` (the voice line, hold-to-talk, the hold recorder) over `lib/audio-engine.ts`
  handles the microphone, her voice, echo handling and cut-ins; the pure decisions live in
  `lib/voice-logic.ts` and `lib/voice-detector.ts`.
- The dormant Retell path: `features/mary/voice/voice-provider.ts` asks `/api/voice` at mount;
  `voice/retell-call.ts` (loaded lazily by `voice/retell-loader.ts`) runs a Retell web call minted by
  `/api/retell/web-call`; Retell calls back `/api/retell/functions/save-lead` and `/api/retell/webhook`
  (`lib/retell-handlers.server.ts`, signed). The agent itself is generated from `retell/`.
- Turns stream from `/api/turn`. The prompt is in `lib/mary-prompt.server.ts`, grounding (only keep what
  the person really said) in `lib/mary-grounding.ts`, and field notes in `lib/mary-experience.server.ts`.
  `lib/mary.functions.ts` is the non-streaming fallback.
- Leads: `lib/waitlist-store.ts` (browser) and `lib/lead-sync.ts` → `/api/lead` → `lib/sheets.server.ts`
  → Apps Script.
- `lib/api-guard.ts` protects every `/api/*` write: cross-site requests are refused, bodies are capped and
  each IP is rate-limited per route.
- Owner view: Ctrl/Cmd+Shift+O, or five quick taps on "omnikom" in the footer (`components/waitlist-vault.tsx`).

MARY's voice and behaviour are specified in `docs/mary-voice.md`.

## Working on it

- Known gaps, ranked, with evidence: `docs/audit/GAP-REGISTER.md`.
- Current stage and open decisions: `PROJECT-STATE.md` (agent-os; `python .agent-os/scripts/agent_os.py stage`).
- Where the last session stopped: `.claude/POSITION.md`.
- Semantic search over code and docs: `node .claude/tools/vector-index.mjs index`, then `... find "<question>"`.
