# Live-site drift: omnisuite.omnikom.io vs GitHub

## Verdict

The live bundle is **origin/main `44318ba` plus one unsynced, purely cosmetic "compact the phone layout" edit** (9 files, 57 replacements). Nothing else differs. I reconstructed that edit from the bundle diff, applied it to a clean checkout of `44318ba`, rebuilt with the repo's own lockfile, and **all five live assets came out byte-identical (same names, same md5)**. That rules out a build-pipeline/Tailwind-version explanation, a different branch, and rewritten history. The edit exists in no git ref, tag, or PR ref.

## Evidence

**1. Asset hashes (md5)**

| asset (live name)          | live now (03:19Z) | audit snapshot (02:44Z) | build of `44318ba`                                                 | `44318ba` + reconstructed patch |
| -------------------------- | ----------------- | ----------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `index-Bi9N-ZUF.js`        | ee0d9a26          | ee0d9a26                | `index-BXuNpL4g.js` fa993a5a (identical after masking chunk names) | **ee0d9a26 same name**          |
| `routes-DZfdjxLS.js`       | 19c76d80          | 19c76d80                | `routes-BPNb9xL1.js` 3d43a655 (309 602 B vs 310 514 B)             | **19c76d80 same name**          |
| `audio-engine-I_qx9wg2.js` | f1be543a          | f1be543a                | **f1be543a same name**                                             | f1be543a                        |
| `soundcheck-X27Nz_N7.js`   | 7c9d5928          | –                       | `soundcheck-F8oC2mpk.js`                                           | **7c9d5928 same name**          |
| `styles-CTBZLJgM.css`      | fb5c3e78          | fb5c3e78                | `styles-DOkFaBD-.css` (41 846 B vs 43 718 B)                       | **fb5c3e78 same name**          |

Builds of neighbours do **not** match: `a5156d2` (audio-engine `B4LUb4KT`), `210a1ea`/`c9aa879` (audio-engine `Crpo4aB-`, 28.8 kB, has wake lock; live has 0 occurrences of `wakeLock`). `6516fae` (PR #1 head) builds identically to `44318ba`. Logs: `scratchpad/drift/build-*.log`.

**2. Toolchain is identical.** Vendor chunk and audio-engine chunk are byte-equal to the local build (vite 8.1.5, rolldown 1.2.1, tailwind 4.2.1 from `bun.lock`). Only chunks that include `src/features/mary/ui/*`, `mary-app.tsx`, and `styles.css` differ.

**3. The edit is in no ref.** `git log --all -S` for `h-[8.5rem]`, `sm:text-[1.65rem]`, `mt-7 font-display text-base`, `width: 106px`, `Math.max(136` returns nothing (also checked `refs/pull/2/merge`). GitHub activity API: zero force pushes ever; every push since repo creation (2026-09-22T21:55Z) is by AbdulrahmanAmer with locally authored commits; **no Lovable/gpt-engineer-app[bot] commit after `50ebfcf` (Sep 22)**.

**4. Timeline.** Sep 23 11:04Z and 11:23Z snapshots of the live site (`scratchpad/live2/`, `live-now.html`) are byte-identical to the build of **`e92f3e2`** (`index-BfqB_5H7.js` a13dd31e, `routes-B3mltORF.js` 0c32d44f), i.e. the site was already 3 commits and 5 h behind GitHub then (published sites only move when someone presses Publish in Lovable). Between Sep 23 11:23Z and Sep 26 02:44Z the live site moved to `44318ba` + the edit. SSR HTML confirms it server-side too: the boot placeholder is `mary-boot-word mt-7 … sm:mt-9 sm:text-lg` live vs `mt-9 text-lg` in every ref.

**5. Serving identity.** `omnisuite.omnikom.io` → A 185.158.133.1 (Lovable custom-domain edge), `x-deployment-id: psr2.f249f636-…`, Lovable's `/~flock.js` injected. The bundle embeds `project_id: 73ac183b-…` only via `omnisuite-lockup.png.asset.json`, which a remix would carry too, so it does **not** prove which Lovable project serves the domain. (`omnisuite.lovable.app` is an unrelated German ERP project, deployment `34fb5fdc-…`; the preview hosts return 401.)

## What differs (complete list; full patch at `scratchpad/drift/lovable-mobile-compaction-on-44318ba.patch`, 9 files, +65/−56)

Pattern everywhere: shrink on phones, restore desktop values behind `sm:`; drop negative `tracking-*` on headings; orb 20 % smaller. No logic, copy, or server change is visible from the client bundle (server-only files cannot be checked from outside).

**boot-screen.tsx** −`mt-9 text-lg` +`mt-7 text-base sm:mt-9 sm:text-lg` · −`mt-4 text-[0.68rem]` +`mt-3 text-[0.58rem] sm:mt-4 sm:text-[0.68rem]`
**composer.tsx** hold button −`h-16 gap-3 text-base sm:h-14` +`h-14 gap-2.5 text-sm sm:gap-3 sm:text-base` · status −`mt-1.5` +`mt-1 text-[0.68rem] sm:mt-1.5 sm:text-xs` · `mt-2`→`mt-1.5 sm:mt-2` (×2) · box −`mt-2 rounded-[1.75rem] px-2 py-1.5` +`mt-1.5 rounded-[1.5rem] px-1.5 py-1 sm:…` · textarea −`max-h-28 px-3 text-base sm:text-sm` +`max-h-24 px-2.5 text-sm sm:max-h-28 sm:px-3` · hint −`mt-2 text-[0.7rem]` +`mt-1.5 text-[0.62rem] sm:mt-2 sm:text-[0.7rem]`
**progress-pills.tsx** −`gap-1.5` +`gap-1 sm:gap-1.5` · −`gap-1.5 px-3 py-1.5 text-xs` +`gap-1 px-2 py-1 text-[0.65rem] sm:…`
**site-frame.tsx** footer −`gap-2 py-4 text-[0.7rem]` +`gap-1.5 py-2 text-[0.62rem] sm:…` · header −`min-h-14 gap-4` +`min-h-12 gap-2 sm:min-h-14 sm:gap-4`
**call-stage.tsx** (14) −`px-4`+`px-3` · logo `h-6`→`h-5` · two header toggles −`gap-2 px-3 py-2 text-xs` +`min-h-11 gap-1.5 px-2 text-[0.65rem] sm:…` · −`gap-4 py-3` +`gap-2 py-1.5 sm:py-3` · caption box −`h-[10.5rem] sm:h-[12.5rem]` +`h-[8.5rem] sm:h-[11rem]` · interim/you lines −`mb-3 text-sm` +`mb-2 text-xs sm:…` (×2) · `mt-3 max-w-2xl`→`mt-2 … sm:mt-3` · prev line −`mb-2 text-lg sm:text-xl` +`mb-1.5 text-sm sm:mb-2 sm:text-base` · current line −`tracking-[-0.02em]`, sizes `text-xl sm:text-[1.6rem]`/`text-2xl sm:text-[2.1rem]` → `text-base sm:text-[1.3rem]`/`text-xl sm:text-[1.65rem]` · ellipsis −`mt-3 text-2xl sm:text-[2.1rem]` +`mt-2 text-xl sm:mt-3 sm:text-[1.65rem]` · "Show conversation" −`mt-4 py-1.5 text-xs` +`mt-2 min-h-10 text-[0.68rem] sm:mt-4 sm:text-xs` · bottom pad `0.75rem`→`0.5rem` + `sm:` original
**end-screen.tsx** (14) −`px-5`+`px-4` · logo `h-6`→`h-5` · −`py-6`+`py-3 sm:py-6` · eyebrow `mt-5`→`mt-3 sm:mt-5` · h1 −`mt-3 text-4xl tracking-[-0.04em]` +`mt-2 text-3xl sm:mt-3` · body −`mt-4 max-w-lg text-base` +`mt-3 max-w-md text-sm sm:…` · −`mt-5 min-h-10` +`mt-3 min-h-9 sm:…` · −`mt-8 gap-3` +`mt-5 gap-2.5 sm:…` · card −`mt-10 gap-8 rounded-[1.75rem] p-6` +`mt-6 gap-5 rounded-[1.4rem] p-4 sm:…` · `mt-4 space-y-3.5`→`mt-3 space-y-2.5 sm:…` · steps −`gap-3 text-sm` +`gap-2.5 text-xs sm:…` · dl −`gap-x-6 gap-y-4` +`gap-x-4 gap-y-3 sm:…` · dd −`text-sm` +`text-xs sm:text-sm` · "Start another conversation" −`mt-8` +`mt-5 min-h-11 sm:mt-8`
**landing.tsx** (13) preview card −`rounded-[1.4rem] px-4 py-3.5` +`rounded-[1.15rem] px-3 py-2.5 sm:…` · −`mt-1.5 text-[0.98rem]` +`mt-1 text-[0.82rem] sm:mt-1.5` · −`px-5`+`px-4` · `<Logo />`→`<Logo className="h-6 sm:h-7" />` · −`py-4`+`py-2 sm:py-4` · −`mb-3 max-w-sm`+`mb-2 max-w-xs` · `mt-1`→`mt-0.5 sm:mt-1` · h1 −`mt-5 text-5xl tracking-[-0.045em]` +`mt-3 text-4xl sm:mt-5` · body −`mt-4 max-w-md text-base` +`mt-3 max-w-sm text-sm sm:…` · −`mt-7 gap-3`+`mt-5 gap-2.5 sm:…` · CTA −`h-14 gap-3 pl-7 pr-2.5 text-base` +`h-12 gap-2.5 pl-6 pr-2 text-sm sm:…` · −`size-9`+`size-8 sm:size-9` · type button −`h-14 px-6 text-sm` +`h-12 px-5 text-xs sm:…`
**mary-app.tsx** orb sizes ×0.8: `Math.max(170, vh*(tight?0.26:0.32))` → `Math.max(136, vh*(tight?0.208:0.256))`; `Math.max(140, …*(tight?0.24:0.3))` → `Math.max(112, …*(tight?0.192:0.24))`
**styles.css** new `@media (max-width: 639px) { .mary-boot-orb { width: 106px; height: 106px } }` after `.mary-boot-orb`

Note: Lovable's source formatting is unknown; my reconstruction needed one `prettier --write` (end-screen.tsx) to pass `bun run lint`. Formatting does not change the bundle hash.

## Most likely explanation

1. **Most likely: an edit made in the Lovable editor (chat/Visual Edits/Dev Mode) after Lovable pulled `44318ba`, then Published, whose push back to GitHub never happened.** Lovable's copy was at exactly `44318ba` (vendor/audio chunks byte-equal), the change is a single coherent "make it fit on a phone" pass typical of one AI prompt, and GitHub shows no bot commit since the repo was connected. Either the GitHub push is broken (App permission/sync error) or the edit was made with sync disconnected.
2. **Possible: the custom domain is attached to a different Lovable project (e.g. a later remix taken after `44318ba`, which has no GitHub connection).** Indistinguishable from outside; same fix path.
3. **Ruled out:** Tailwind/Vite version or build-pipeline differences (byte-identical reproduction); a different published branch (no ref contains it); force-push/rewritten history (activity log clean).

## What it means for merging PR #2 (`c9aa879`)

- **No textual conflict with PR #2.** PR #2 touches `mary-app.tsx` (other lines), `audio-engine.ts`, `retell-shared.ts`, `soundcheck.tsx`, tests. The reconstructed patch applies cleanly on `c9aa879` (`git apply --check` and `--3way`: 9/9 files clean), and `c9aa879` + patch passes typecheck 0 / lint 0 / 80 tests / build 0 (`scratchpad/drift/wt-pr2`).
- **Risk A – silent revert:** if Lovable's project is the one serving the domain and it pulls `main` after the merge, the next Publish from whatever state Lovable ends up in either keeps the compaction (if Lovable holds a local commit and merges) or drops it (if Lovable resets to GitHub, or if the domain belongs to another project and someone publishes 73ac183b). In the second case the phone UI regresses: 44-px header targets, `min-h-11` "Start another conversation", smaller caption box all disappear.
- **Risk B – sync breakage:** if Lovable holds an unpushed commit on those 9 files and any GitHub-side change touches the same lines (e.g. the end-screen and call-stage work in progress in this session), Lovable's pull conflicts, the sync errors out, and the live site quietly stops following GitHub.
- **Risk C – double-apply:** if Lovable's push later succeeds after we commit the same change, the result is a no-op merge (same content), which is harmless.

**Recommended order:** (1) commit `lovable-mobile-compaction-on-44318ba.patch` (or Lovable's own version, if it can be exported) to `main` first, so GitHub == live before anything else moves; (2) rebase/merge PR #2 on top; (3) only then Publish from Lovable; (4) add a CI step that diffs the deployed asset names against `bun run build` of `main` (a 30-second curl of `/` catches this class of drift).

## Exactly what the operator should check in Lovable

1. **Which project owns the domain:** open lovable.dev/projects/73ac183b-3cba-490d-b4a7-e290763aaba5 → Settings → Domains. If `omnisuite.omnikom.io` is not there, find the project that has it (a later remix?) — that project is what visitors see and it is not connected to this repo.
2. **The edit itself:** in that project's History/chat, locate the change after "Merge PR #1" that shrank the phone layout (orb 20 % smaller, `sm:`-prefixed classes, boot orb 106 px). Note its timestamp and whether it came from chat, Visual Edits or Dev Mode; ask Lovable to "push to GitHub" and see whether it errors.
3. **GitHub connection status:** Settings → GitHub: repo must read `AbdulrahmanAmer/remix-of-mary-s-waitlist-ai`, branch `main`, no "out of sync"/"sync failed" banner. On GitHub, Settings → Applications → Lovable: confirm the App still has access to this repo (write).
4. **Publish state:** does the Publish button say "Update"? If yes, the editor holds further edits beyond the ones measured here (the published build is what I measured; the editor may be ahead).
5. **Do not press Publish/Update** until GitHub `main` contains the compaction (or a deliberate decision to drop it), and do not push GitHub-side edits to the 9 files above until steps 1–3 are answered.

## Files

- Patch (lint-clean, reproduces live byte-for-byte on `44318ba`, applies cleanly on `c9aa879`): `/tmp/claude-0/-home-user-remix-of-mary-s-waitlist-ai/5db0fce8-f9f0-58ea-ab86-b04df5aa8cc5/scratchpad/drift/lovable-mobile-compaction-on-44318ba.patch`
- Reconstruction script (asserts each replacement matches once): `…/scratchpad/drift/apply-live-edits.py`
- Live assets + headers: `…/scratchpad/drift/live-now/`; prettified bundle diff: `…/scratchpad/drift/pretty/routes.diff`
- Build logs per commit: `…/scratchpad/drift/build-{main,6516fae,a5156d2,210a1ea,7a47a56,e92f3e2,0904693,8eb0b34,ddaa3d7}.log`
- Worktrees kept: `…/scratchpad/drift/wt-main` (`44318ba` + patch, rebuilt = live) and `…/scratchpad/drift/wt-pr2` (`c9aa879` + patch, gates green). The main repo working tree was not modified.
