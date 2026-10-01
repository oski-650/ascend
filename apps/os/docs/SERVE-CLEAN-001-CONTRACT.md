# SERVE-CLEAN-001 — restore a trustworthy rollback build · CONTRACT

Written and reviewed in SERVE-CLEAN-001. The window it describes is executed only after this contract
is promoted **and** the owner authorizes the cleanup window in chat. Its evidence is recorded in
ROLLOUT-2A3BC-2's checkpoint and in `~/AscendDeploy` (§6). Every production-touching or
credential-bearing command is run by Oscar in his own terminal; the agent prepares commands and records
evidence, and never types a confirmation, reads `.env.production.local` values or runs admin commands.

## 0 · Why this exists, and what it does not do

ROLLOUT-2A3BC-2's read-only preconditions on 2026-09-30 found two things.

**1. The serving `.next` holds 867 iCloud-style duplicates** (`* 2.*` and similar):

| Location | Count |
|---|---|
| `server/app` | 520 |
| `server/chunks` | 286 |
| `static/chunks` | 29 |
| `build/chunks` | 12 |
| `server/edge` | 10 |
| `cache/turbopack` | 5 |
| `static/media` | 2 |
| `server/pages` | 1 |

The build is 2A.3a-2's, `BUILD_ID k5DWIdCrqMPfXkxCGDdpW`, which had zero duplicates when built. None of
the 867 is newer than `BUILD_ID`: 862 are dated 2026-09-21 and 5 are from August. iCloud synced stale
copies back into the fresh build (I1). Under ROLLOUT-2A3BC's P4 and D5, a copy of that `.next` is not a
verified rollback, so the rollout is postponed.

**2. The serving checkout has drifted.** It is on branch `work/coordfreezedb001` at `1e7a5d5`, not
detached at `ad86aa2`. Between the two, the only differences are proof tooling and recovery-registry
files, which the running app does not load. The build is unaffected, but the source no longer
matches it.

This contract **only** replaces the contaminated build with a clean rebuild of the same commit, and
records proof that it is clean. It does **not** add product code, a migration, a schema, grant or data
change, or a script or smoke change, and nothing new goes live. Moving the serving tree out of iCloud
is the permanent fix and is separate work (SERVE-RELOCATE-001, after the rollout).

## 1 · What gets rebuilt, and why it is the same build

| Claim | Evidence |
|---|---|
| The serving build came from `ad86aa2` | 2A.3a-2 T9 built `k5DWIdCrqMPfXkxCGDdpW` from the clean pinned tree, `ad86aa2` / tree `ee53508` (SLICE-2A3A2-CHECKPOINT.md, deploy pin) |
| A rebuild of `ad86aa2` reproduces it | Rehearsal (§7). Outside the cache, the serving `.next` has 1,206 non-duplicate files and the rebuild has exactly 1,206, with identical paths apart from the `static/<BUILD_ID>/` folder |
| The only expected difference is the `BUILD_ID` | Next generates a new one per build, and ROLLOUT-2A3BC-EXECUTION-CONTRACT.md is amended to pin the cleanup's (§5) |

## 2 · Preconditions (all before C0; any failure is a STOP)

| # | Precondition | How it is shown |
|---|---|---|
| CP1 | Coordinator `verify` OK after fetching `agents/coord` and `review/*`; this contract is promoted | `npm run agent -- verify` |
| CP2 | Only `com.ascend.os` holds 3001; no dev server, agent or other session in the main checkout | `lsof -iTCP:3001 -sTCP:LISTEN` shows only the launchd PID |
| CP3 | The serving checkout is clean (whatever its branch), so switching it loses nothing | `git status --porcelain` empty |
| CP4 | A smoke runner at the promoted pin. The agent prepares a detached worktree at the pin with `node_modules`, and Oscar links `.env.production.local` into its `apps/os` for the run, removing the link after. This is the 2A.3a-2 T2 precedent; `ad86aa2`'s own smoke has no `--release` | the worktree exists at the pin; the link exists only during C1/C10 |
| CP5 | Partner and owner smoke inputs set in the environment (`read -rs`), so no prompt stalls a keep-alive socket | set, never printed |
| CP6 | `~/AscendDeploy/<TS>/` created with mode 0700. It is outside iCloud, and everything this window writes goes there | `stat` shows `drwx------` |

## 3 · The sequence

All serving-tree commands run from the main checkout's `apps/os`. The checksum list uses one command:

```
M="find . -type f -not -path './cache/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256"
```

It covers every build file except `.next/cache`, which Next may write at run time (image and fetch
caches) and regenerates if lost. The duplicate checks cover everything, cache included.

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| **C0** | Owner authorization in chat: the cleanup window's start, and that this contract is the promoted one | — | no authorization, no C1 |
| C1 | Before-smoke on the current build, from the CP4 runner: `node scripts/deploy-smoke.mjs --baseline --release 2a3bc --record ~/AscendDeploy/<TS>/before.json` | 0 failed; the 10 `2a3bc` checks fail AS EXPECTED; no UNEXPECTED-PASS | STOP; nothing has changed |
| C2 | Record the contaminated build, read-only: `cat .next/BUILD_ID`; total files; duplicate count (`find .next -name '* [0-9].*' \| wc -l`) | `BUILD_ID` = `k5DWIdCrqMPfXkxCGDdpW`; counts recorded | STOP; nothing has changed |
| C3 | **Outage starts:** `launchctl bootout gui/501/com.ascend.os` (bootout, not stop: the job has KeepAlive) | port 3001 free; old PID gone | STOP; bootstrap the old build |
| C4 | Move the contaminated build aside, never delete it: `mv .next ~/AscendDeploy/<TS>/next-contaminated` | `.next` absent; the moved copy holds C2's counts | §4 "restore" |
| C5 | Point the serving checkout at the serving commit: `git switch --detach ad86aa2` | `git rev-parse HEAD` = `ad86aa2…`; `HEAD^{tree}` = `ee5350841bd338a6cb423c637f409412b02c0511`; `git status --porcelain` empty | §4 "restore" |
| C6 | Build: `npx next build --turbopack` | exit 0; a new `BUILD_ID`; `git status --porcelain` still empty | §4 "build fails" |
| C7 | Duplicate check on the fresh build: `find . -name '* [0-9].*' -not -path './node_modules/*'` | **empty**. C9 is chained behind it (`test "$N" = 0 &&`), so the service cannot start otherwise | §4 "fresh build has duplicates" |
| C8 | Write the clean-build evidence before starting: `(cd .next && eval "$M") > ~/AscendDeploy/<TS>/clean.manifest`, and `clean.json` holding commit, tree, `BUILD_ID`, file count, manifest line count, the manifest's SHA-256, duplicate count 0, and time. Both mode 0600 | both written; the manifest line count equals the files outside `cache/` | §4 "restore" |
| C9 | **Outage ends:** `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist`, after the build has completed (the build/restart race) | `/login` 200 within 30 s | §4 "does not start" |
| C10 | After-smoke, same runner: `node scripts/deploy-smoke.mjs --baseline --release 2a3bc --record ~/AscendDeploy/<TS>/after.json` | the same result as C1. `before.json` and `after.json` agree on ledger head, prospects, notes, users and events (the site was down in between) | §4 "smoke differs" |
| C11 | **Verify the checksum artifact on the live tree**, read-only: `(cd .next && eval "$M")` equals `clean.manifest` byte for byte, and the duplicate count over `.next` is 0. Remove the CP4 env link | equal; 0 | §4 "artifact mismatch" |

**The cleanup has succeeded only when C11 passes.** Only then does Oscar unblock ROLLOUT-2A3BC-2
(`admin unblock`). Its own window still needs its own authorization (§8).

## 4 · Failure and restore

Production is never left down to finish the cleanup. The moved-aside build served correctly (its
contamination is unreferenced copies), so it is the restore point for every failure here.

| Situation | Action |
|---|---|
| C1–C2 fail | STOP. Nothing has changed. |
| C3 cannot stop the service | STOP. Do not touch `.next` under a running server. |
| **Restore** (C4, C5 or C8 fails) | If a new `.next` exists, move it aside to `~/AscendDeploy/<TS>/next-rebuild-failed`. Then `mv ~/AscendDeploy/<TS>/next-contaminated .next` → `launchctl bootstrap …` → `/login` 200 → report. ROLLOUT-2A3BC-2 stays blocked. |
| **Build fails (C6)** | Restore (above). Report: a failed build of a commit that already built once is a finding. |
| **Fresh build has duplicates (C7)** | Do not start. Move the new `.next` aside as `next-rebuild-dup` and rebuild once. If C7 fails again, restore and report: I1 has become urgent. |
| **Does not start (C9)** or **smoke differs (C10)** | `launchctl bootout …` → restore → `/login` 200 → C1's smoke must reproduce → report. |
| **Artifact mismatch (C11)** | The service stays up on the rebuilt build, which passed C10, but it is **not** a verified rollback: something changed `.next` between C8 and C11. Do not unblock the rollout. Report, and decide the next step with the owner. |

## 5 · The amendment to ROLLOUT-2A3BC-EXECUTION-CONTRACT.md

Made in this task, in the same review. Nothing is weakened:

- **§0** names the cleaned build: commit `ad86aa2`, with its `BUILD_ID` and checksum list taken from
  `clean.json`. The undeployed-range list admits this task's two documents, so the new pin passes the
  contract's own STOP rule.
- **New precondition P7:** the cleanup succeeded (C11 passed), and the serving `.next`'s `BUILD_ID`
  equals `clean.json`'s.
- **P4** is re-run immediately before T0.
- **T2:** the clone's `BUILD_ID` equals `clean.json`'s. The clone's checksum list (the same `$M`)
  equals `clean.manifest` byte for byte, and the clone has zero duplicates, cache included. Anything
  else is a STOP. This replaces r3's file-count comparison with an exact one.
- **Rollback** re-verifies the clone against `clean.manifest` before restoring it.
- **Timing:** the rollout window follows the cleanup in the same sitting where practical, under its
  own separate authorization, so iCloud has little time to put duplicates back. If it does, P4 catches
  it.
- **D5** stays postpone-only.

## 6 · Where the evidence is kept, and why there is no separate execution task

The window's evidence goes in two places:
- **`~/AscendDeploy/<TS>/`:** `before.json`, `after.json`, `clean.manifest`, `clean.json` and the
  step outputs.
- **ROLLOUT-2A3BC-2's checkpoint:** a "Cleanup window" section with the non-secret summary (old and
  new `BUILD_ID`, counts, C1/C10 summaries, outage times, C11 result).

A separately promoted execution task would move the deploy pin a second time. Under D1 the pin is
the latest promoted baseline with P2 green, so each promotion forces a new full aggregate including
owner R1b/R1c. This task's promoted commit becomes the pin. Recording the cleanup inside the rollout
task keeps it there.

The contaminated build stays at `~/AscendDeploy/<TS>/next-contaminated` until the rollout is
complete. Deleting it is a later owner decision; the agent never deletes it.

## 7 · Rehearsal evidence (no production contact)

- **Build:** `ad86aa2` was built in a clean worktree outside iCloud with `npx next build --turbopack`
  and no production environment. Exit 0 in 16 s; 1,228 files, 1,206 outside `cache/`; zero
  duplicates; the tree stayed clean. Tree `ee53508`, equal to 2A.3a-2's deploy tree.
- **Same shape as production:** the serving `.next`, minus its 867 duplicates, has 1,230 files
  (1,206 outside `cache/`). Its paths equal the rebuild's apart from the `static/<BUILD_ID>/` folder.
- **Runtime writes:** `next start` on a spare loopback port, serving `/login`, `/`, `/sales`,
  `/partner` and the image endpoint, changed no file in `.next`. `cache/` is still excluded from
  the equality, because the image and fetch caches can write there.
- **The C8/C11/T2 comparison**, on a `cp -Rc` clone, with the exact `$M` and duplicate commands:

  | Case | Result |
  |---|---|
  | Untouched clone | VERIFIED |
  | Planted `… 2.js` | REJECTED (duplicate, and the checksum list differs) |
  | Duplicate removed again | VERIFIED |
  | One byte changed | REJECTED (the checksum list differs) |
  | A runtime cache file only | VERIFIED |
  | A planted duplicate inside `cache/` | REJECTED (duplicate) |

## 8 · Order of events, and owner decisions

Order, as the owner set it:
1. Codex reviews this contract.
2. It is promoted.
3. The owner explicitly authorizes the cleanup window (C0).
4. The clean rebuild and smokes run (C1–C10).
5. The checksum artifact is verified (C11).
6. ROLLOUT-2A3BC-2 is unblocked.
7. The owner separately authorizes the rollout window.

| # | Decision | Recommendation |
|---|---|---|
| E1 | Cleanup window start | A quiet time; the outage is the build, about 16 s of build plus start-up |
| E2 | Run the rollout in the same sitting | Yes, under its own authorization after C11, to shorten iCloud's window |
| E3 | Keep `next-contaminated` until after the rollout | Yes; the owner deletes it later |
