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
