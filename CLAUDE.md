# MARY waitlist - working rules

Read `AGENTS.md` first: this repo syncs to Lovable. Never force-push or rewrite pushed history on `main`.

## Where things are

- Stage + open decisions: `PROJECT-STATE.md` (agent-os). Stages 0-2 refuse writes to `src/`. Only the operator advances the stage.
- Position / next step: `.claude/POSITION.md`. Update it before you stop.
- Gap register (every known issue, with evidence): `docs/audit/GAP-REGISTER.md`; per-area detail in `docs/audit/*.md`.
- Architecture: `docs/architecture/architecture.corrected.mmd` matches the code. `architecture.mmd` / `diagram.png` are the original GitDiagram output and have known errors.

## Finding code

- Symbols, callers, blast radius: codebase-memory graph, project `E-Omnisuite final stage the CTO Packets-Waitlist for OmniSuite-remix-of-mary-s-waitlist-ai`. Re-index after structural changes (`index_repository`).
- Concepts ("where does barge-in get decided"): `node .claude/tools/vector-index.mjs find "<query>"`. Re-run `... index` after edits (incremental, local, free).
- Text/config/copy: grep.

## Gates (run them yourself before saying done; CI runs the first four)

- `bun run typecheck` · `bun run lint` · `bun run test` · `bun run build` - all must exit 0. Don't pipe them into `tail` when reading the exit code.
- Render: `MSYS_NO_PATHCONV=1 node "<render-gate.mjs from ~/.claude/machine.local.json>" <url> /` against `bun run dev:local --port 5173` or, for the real build, `bun run preview --port 8788 --ip 127.0.0.1`. Without `MSYS_NO_PATHCONV=1`, Git Bash turns `/` into a Windows path and the gate measures nothing. The first load after a cold dev start can report growth; the production preview is the reference.
- Plain `bun run dev` 404s on the Lovable-hosted logo locally; that console error is expected there, not a regression.
- A running `bun run preview` holds `.output/`, and `bun run build` then fails with `EBUSY`. Stop every `workerd`/`wrangler` process, not just the one on the port.

## Facts that are easy to get wrong

- Every AI call (turn, reflect, speech, transcribe) needs `LOVABLE_API_KEY`, which exists only in Lovable hosting. Locally those routes return 500; `/api/addressee` silently falls back to `{"verdict":"mary"}`.
- Leads go to a Google Sheet only when `SHEETS_WEBAPP_URL` is set; it is not set yet (`GET /api/lead` -> `{"configured":false}`).
- Unit tests live in `tests/unit` (vitest, standalone `vitest.config.ts`; never add plugins to `vite.config.ts`). There is still no browser/audio test harness: roadmap.md's older "verified with Playwright" claims are unproven.
- `/api/*` writes pass `src/lib/api-guard.ts` (cross-site 403, size 413, per-IP 429). Its counters are per isolate, so it limits abuse; it does not stop it.
- Keep LF line endings (repo-local `core.autocrlf=false`); CRLF produces thousands of prettier errors.
