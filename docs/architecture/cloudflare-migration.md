# Leaving Lovable: self-hosting on Cloudflare (with Retell voice)

Status: DESIGN ONLY, no code changed. Diagram: `cloudflare-target.mmd`, rendered as
`diagram.cloudflare.png` (same style as the GitDiagram originals). Builds on
`retell-migration.md`; together they describe the whole target system. Written 2026-09-23.
Sources are at the end; items marked VERIFY must be confirmed during the build.

## What Lovable does for us today, and what replaces it

| Lovable provides | Where it shows up in the repo | Cloudflare replacement |
|---|---|---|
| Hosting (a Cloudflare Worker on Lovable's account) | build via `@lovable.dev/vite-tanstack-config` → Nitro preset `cloudflare-module` → `.output/server/wrangler.json` | The **same Worker on your own account**: `wrangler deploy`. Already proven locally: `bun run preview` serves the built Worker in `workerd` (`/` → 200) |
| AI gateway + key (`LOVABLE_API_KEY`, `ai.gateway.lovable.dev`) | 6 server files: `mary-prompt.server.ts` (`gatewayConfig`), `mary-experience.server.ts`, `mary.functions.ts`, `api/turn`, `api/reflect`, `api/lead` (plus speech/transcribe/addressee, which Retell deletes) | **One provider module** (`lib/ai-provider.server.ts`, new) pointing the AI SDK at **Cloudflare AI Gateway** (`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai`, or the Anthropic route) with your own provider key. Gives logs, caching, per-gateway rate limits and fallback |
| Speech-to-text and text-to-speech models | `api/transcribe` (Gemini transcribe), `api/speech` (Gemini TTS) | **Retell** (see `retell-migration.md`); both routes are deleted |
| Image hosting for the logo (`/__l5e/assets-v1/...`) | `src/assets/omnisuite-lockup.png.asset.json`, used by `brand-lockup.tsx` and `mary-experience.tsx` | Move the PNG into `public/` and serve it with **Workers Static Assets** (already how `public/` ships). Also removes the local-dev 404 and the `dev:local` workaround |
| Secrets UI | `SHEETS_WEBAPP_URL`, `SHEETS_WEBAPP_SECRET`, `LOVABLE_API_KEY` | **Worker secrets** (`wrangler secret put`), with `.dev.vars` locally (already gitignored) |
| Error capture in the editor | `lib/lovable-error-reporting.ts`, `__root.tsx` | **Workers Logs** (observability) for the server; optional Sentry for the browser. The Lovable hook becomes a no-op and is deleted |
| Editor ⇄ GitHub sync and deploy on push | Lovable project `73ac183b-…` | **GitHub Actions**: the existing CI job plus a `wrangler deploy` step on `main` (token in `CLOUDFLARE_API_TOKEN`). Lovable is disconnected or kept only as an editor that never deploys |
| Preview URL for the logo proxy (`LOVABLE_PREVIEW_HOST`) | `dev:local` script | Not needed after the logo moves to `public/` |

The app's framework (TanStack Start, React, Tailwind) stays. `@lovable.dev/vite-tanstack-config` is only
a bundle of standard Vite plugins; it can stay at first, then be swapped for a plain
`tanstackStart()` + `nitro({ preset: "cloudflare-module" })` config.

## What Cloudflare adds that Lovable could not

- **Rate limits that hold across isolates.** The Workers **Rate Limiting binding**
  (`env.LIMITER.limit({ key })`, periods of 10 or 60 s, counted per Cloudflare location) replaces the
  in-memory counters in `api-guard.ts`, which today reset per isolate (gap AI-01, "PARTIAL"). A
  **WAF rate-limiting rule** on `/api/*` sits in front as a second layer.
- **Bot check before a paid call.** **Turnstile** on the "Start" button; `/api/retell/web-call`
  verifies the token at `https://challenges.cloudflare.com/turnstile/v0/siteverify` before asking Retell
  for a call, so scripts cannot start paid voice minutes.
- **Real protection for the owner view.** **Cloudflare Access** in front of an `/owner` route and
  `GET /api/lead` (gap FE-02), instead of a hidden keyboard shortcut.
- **Option A becomes possible.** On our own Worker we control WebSocket upgrades, so Retell's
  custom-LLM socket (`wss://<domain>/api/retell/llm/{call_id}`) can run MARY's own prompt and grounding.
  (On Lovable's hosting this was unverified.)
- **A database when you want one.** **D1** can become the system of record for leads, with the Google
  Sheet kept as the owner's view. Optional; the sheet works today (decision D2).

## Setup, in order

1. **Account and domain.** Add the domain to Cloudflare (or use a `*.workers.dev` URL first).
2. **Commit a `wrangler.jsonc`** at the repo root: `name`, `main: ".output/server/index.mjs"`,
   `compatibility_flags: ["nodejs_compat"]`, `assets: { directory: ".output/public", binding: "ASSETS" }`,
   `routes` for the custom domain, `observability: { enabled: true }`, and a `ratelimits` binding
   (`name`, `namespace_id`, `simple: { limit, period }`). VERIFY: whether to point wrangler at this file
   or have Nitro merge it into the generated `.output/server/wrangler.json` (Nitro's `cloudflare`
   options). Deploy one of them, never both.
3. **Secrets** (`wrangler secret put …`):
   - `RETELL_API_KEY`
   - `RETELL_AGENT_ID` (a var is fine)
   - `SHEETS_WEBAPP_URL`, `SHEETS_WEBAPP_SECRET` (the values already live in Lovable today)
   - `AI_GATEWAY_URL` plus the provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`), for typing mode and MARY's debrief
   - `TURNSTILE_SECRET_KEY`

   Public vars: `VITE_TURNSTILE_SITE_KEY`.
4. **AI Gateway**: create a gateway and turn on logging and a rate limit. The provider module uses
   its URL.
5. **Turnstile**: create a widget for the domain and add the site key and secret key.
6. **Access**: create an Access application for `/owner*` and `/api/lead` (GET) allowing only your email.
7. **Retell dashboard** (from `retell-migration.md`): the agent, webhook URL
   `https://<domain>/api/retell/webhook`, and the `save_lead` function URL
   `https://<domain>/api/retell/functions/save-lead`.
8. **CI deploy**: add a `deploy` job to `.github/workflows/ci.yml` after `check`, only on `main`:
   `bun run build` then `bunx wrangler deploy`, with `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets. Pull requests get a Workers preview version instead.
9. **Cut over**: deploy to `workers.dev`, run the render gate and one real call there, then move the
   domain and switch Lovable off, so two hosts never serve the site at once.

## Code changes this implies (when approved)

- `lib/ai-provider.server.ts` (new): one place that builds the AI SDK provider from env. Replaces
  `gatewayConfig` and the 6 `LOVABLE_API_KEY` reads (this is decision D3's seam, and it makes local
  development work with your own key).
- `lib/api-guard.ts`: keep the origin and size checks and call the Rate Limiting binding instead of the
  in-memory map.
- `api/retell/web-call`: verify the Turnstile token first.
- Logo: move it to `public/omnisuite-lockup.png`, point both components at `/omnisuite-lockup.png`, and
  delete the `.asset.json` and the `dev:local` script.
- Delete `lovable-error-reporting.ts` and its use in `__root.tsx`.
- Add `wrangler.jsonc`, `.dev.vars.example`, and the deploy job.
- Voice: everything in `retell-migration.md` (new Retell routes and `retell-call.ts`; delete the audio
  engine, detector, voice logic, `/api/speech`, `/api/transcribe`, `/api/addressee`).

## Risks and open points

- **Nitro is a beta** (`3.0.260603-beta`), and the build config package is Lovable's. It builds today, so
  pin both and upgrade deliberately.
- **Two deployers.** If Lovable stays connected to `main`, it keeps deploying its own copy. Decide
  before cut-over: disconnect it, or use Lovable only as an editor on a branch.
- **Rate limits are per location.** Cloudflare's own binding counts per data centre, not globally.
  That's enough for abuse control; the WAF rule adds a second layer.
- **Costs move to your bills**: Workers (paid plan for the limits and logs you want), Retell per
  minute, the LLM provider per token, and AI Gateway (free tier available). Budget before launch.

## Sources

- Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/ and https://developers.cloudflare.com/ai-gateway/usage/providers/openai/
- Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Retell: see `retell-migration.md`
