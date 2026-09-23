# PROJECT STATE

> agent-os reads this file at session start and loads only the current stage's contract.
> Append to the log, never rewrite it. Only the operator advances the STAGE line.
STAGE: 3
enforcement: deny

Why stage 3: the operator asked for every programmatic gap and error to be fixed (log, 2026-09-23).
The cleanup works `docs/plans/2026-09-23-cleanup.md`. D1-D5 below are still open; work that depends
on them is out of the cleanup's scope.

## OPEN DECISIONS

### D1. What is this next phase for? UNDECIDED
The operator's goals and direction for the codebase. Pending from the operator.

*Settled: (not yet)*

### D2. Where do leads live? UNDECIDED
Today: browser localStorage, plus a Google Sheet that is not connected (`configured:false`), so no lead
reaches the owner (GAP LD-01, P0). Options: (a) connect the sheet as designed (`docs/google-sheets/`,
set `SHEETS_WEBAPP_URL` + a non-empty `SHEETS_WEBAPP_SECRET`); (b) a real database (e.g. Supabase) with
the sheet as an export; (c) both. Recommendation: (a) now, because it is already built and only needs
deployment, then (b) if leads need querying or auth'd access.

*Settled: (not yet)*

### D3. Stay on the Lovable AI gateway, or add a provider seam? UNDECIDED
Today every AI call needs `LOVABLE_API_KEY` (Lovable hosting only), so the conversation cannot run
locally or anywhere else (GAP AI-08). Options: (a) stay Lovable-only, test only in Lovable previews;
(b) put one provider module behind an env switch (Lovable gateway in prod, direct OpenAI-compatible key
locally). Recommendation: (b). It is what makes local testing and a test harness possible.

*Settled: (not yet)*

### D4. How are the public API routes protected? UNDECIDED
Today: none are (GAP AI-01/LD-02/AI-02, P0). Options range from origin check + body caps + per-IP rate
limit (Cloudflare) up to a signed per-session token issued at boot. Recommendation: caps + origin check
+ rate limit first; they are cheap and close the money leak.

*Settled: (not yet)*

### D5. Does the owner view need real auth, or should it leave the public bundle? UNDECIDED
GAP FE-02. It shows only this browser's data, but it ships to every visitor and `GET /api/lead` is public.

*Settled: (not yet)*

## SETTLED DECISIONS

| # | decision | date | why |
|---|---|---|---|
| S1 | Workspace tooling lives in-repo: `.agent-os/` (stage gate + skills payload), `.claude/skills/` (14 skills), `.claude/tools/vector-index.mjs`; derived index gitignored. | 2026-09-23 | Reproducible on any machine that clones the repo. |
| S2 | agent-os adapters: global Claude Code plugin + git pre-commit gate only. No project-local Claude hooks (the global plugin already fires them) and no AGENTS.md injection (Lovable's agent reads AGENTS.md). | 2026-09-23 | Avoid double-firing hooks; avoid a stage-0 "don't write src" block reaching Lovable. |
| S3 | Repo-local git `core.autocrlf=false`, `core.eol=lf`. | 2026-09-23 | Global autocrlf=true produced ~14,000 CRLF prettier errors. |
| S4 | Version plan: V1 = the current Lovable-hosted app, fixed and polished now. V2 = Retell voice + self-hosted Cloudflare (`docs/architecture/retell-migration.md`, `cloudflare-migration.md`, `diagram.cloudflare.png`), built later. | 2026-09-23 | Operator: "we will end doing this as version two but for now lets actually properly fix the current setup". |

## LOG - newest at the bottom, append only

- 2026-09-23 - Workspace set up: deps installed (bun, 424 pkgs), codebase-memory graph indexed, vector index built, agent-os installed, diagram imported to `docs/architecture/`. Baseline: tsc exit 0, build ok, lint 1 error + 6 warnings, render-gate `/` pass.
- 2026-09-23 - Full audit by five area reviewers, P0/P1 re-verified by hand: `docs/audit/GAP-REGISTER.md`. Opened D2-D5 from its findings.
- 2026-09-23 - Operator: "fix all the programmatic things and errors that we have so we are actually clean and ready to work on things". STAGE 0 -> 3 on that instruction. Scope: every register item that does not depend on D2-D5; plan in `docs/plans/2026-09-23-cleanup.md`.
- 2026-09-23 - Cleanup plan S1-S7 worked. Gates: typecheck 0 · lint 0 (0 warnings) · test 31/31 · build 0; the same four pass from a clean copy of the commit-able files. Production Worker (wrangler) renders `/` with bounded layout and 0 uncaught; guard verified there (cross-site 403). Remaining open items and their decisions: GAP-REGISTER "STILL OPEN". Nothing committed.
- 2026-09-23 - Pushed 4542c9e (cleanup) and 605d927 (Retell design, docs only) to origin/main at the operator's request; GitHub CI run 35807448045 green. Kept local (public repo): docs/audit/, .claude/skills/, .agent-os/skills/ via .git/info/exclude.
- 2026-09-23 - Hardened Apps Script (rewritten, not Lovable's) deployed by the operator; live read-only probe: ping ok (version 2026-09-23, 0 leads), wrong secret -> unauthorized. Pending: operator sets SHEETS_WEBAPP_URL + SHEETS_WEBAPP_SECRET in Lovable, then one real call end to end (closes LD-01 once a lead lands).
- 2026-09-23 - Operator: V1 polish round - fix the buggy/unsmooth experience, stronger animations, a futuristic orb, better look end to end. V2 (Retell + Cloudflare) deferred.
