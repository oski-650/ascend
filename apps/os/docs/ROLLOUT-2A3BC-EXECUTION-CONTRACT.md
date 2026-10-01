# Rollout 2A.3bc — serve the promoted 2A.3b + 2A.3c build · EXECUTION CONTRACT

Written and reviewed in ROLLOUT-2A3BC-1. Executed, exactly as written, in ROLLOUT-2A3BC-2. Owner decisions
are recorded at authorization (§7). Every production-touching or credential-bearing command is run by
Oscar in his own terminal; the agent prepares commands and records evidence, and never types a
confirmation, reads `.env.production.local` values or handles either person's credentials.

## 0 · What goes live, and nothing else

2A.3b (Priority) and 2A.3c (one pipeline, stage summary), already promoted, reviewed and proven. It is
a **code-only deploy**: build and serve one pinned PROMOTED baseline. There is no migration and no
schema, grant, policy, index or data change.

**Undeployed range.** The serving pin is `ad86aa2` (2A.3a-2, `BUILD_ID k5DWIdCrqMPfXkxCGDdpW`). At the
time of writing, the promoted baseline is `26a8406` (2A.3c); this task's own commit follows it. Every
path in `ad86aa2..26a8406`, from `git diff --name-status`:

| Class | Paths | Reaches the running app |
|---|---|---|
| **App code** (2A.3b, 2A.3c) | `app/partner/page.tsx`, `app/sales/page.tsx`, `app/sales/list/page.tsx`, `components/sales/{SalesBrowseFilters.tsx,SalesQueueRow.tsx,presentation.ts}`, `components/shell/NavRail.tsx`, `core/crm/sales.ts`, `core/db/sales-reads.ts`, `lib/landing.ts`, `lib/sales-queue-url.ts`, `navigation/destinations.ts` | yes, and this is the change |
| **Recovery registry** (RECOVERY-CURRENT-001) | `core/recovery/legacy-contracts.ts` (one `acceptedIn` string), `core/recovery/recovery-points.ts` (new) | no. Imported only by `core/recovery/*`, `scripts/proof-orchestrator.mjs`, `scripts/recovery-verify.sh` and tests; nothing under `app/`, `components/`, `lib/`, `navigation/` or the rest of `core/` imports `core/recovery` |
| **Proof tooling** (GATE-2G1-005/006, COORD-FREEZE-DB-001) | `scripts/gate-proof.mjs`, `scripts/proof-orchestrator.mjs`, `tests/support/cleanup-db-proof-schemas.mjs`, `tools/agent/lib/gates.mjs`, `tools/agent/test/*` | no |
| **Tests** | 17 files under `tests/` | no |
| **Docs** | six checkpoints under `docs/` | no |

This task adds `docs/ROLLOUT-2A3BC-EXECUTION-CONTRACT.md`, `scripts/deploy-smoke.mjs` and two
`tests/architecture` files, none of which reach the running app. **If the pin at authorization carries
any path not in this table or this task, STOP**: the range must be re-reviewed before it ships.

**Round 2** answers Codex's two r1 findings:
- **HISTORICAL-SMOKE:** a selected release no longer runs later releases' checks (§2). The fixture
  replays both 2A.3a runs with 2A.3a-2's real results.
- **ROLLBACK-ARTIFACT:** P4 now covers the serving `.next`, T2 verifies the clone before it can count
  as a rollback, and a contaminated old build is an owner decision (D5) before any outage (§3–§5, §7).
- **Round 3** answers Codex's r2 finding: D5 is postpone-only. r2 offered a rebuild-only rollback
  that began the outage with no verified artifact; that option is removed, and T2 is never skipped.

## 1 · Why no database change is needed

| Claim | Evidence |
|---|---|
| Schema and ledger are identical | `git diff --stat ad86aa2 26a8406 -- apps/os/core/db/schema apps/os/migration apps/os/core/db/migrate.ts` is empty. Production's ledger is 001–010 (2A.3a-2 T7/T8) |
| The new reads use only objects that exist, under grants that exist | `core/db/sales-reads.ts` reads `prospects`, `events`, `prospect_contacts`, `prospect_followups`, `prospect_notes`, `prospect_stage_transitions`, `memberships`, `users`. 2A.3b adds reads of `prospects`' scoring columns and of `events` (rank 6: the `prospect.reassigned` event naming the current assignee, via `events_subject_idx`, 001:178). 2A.3c adds one `GROUP BY` over `prospects`. Both roles hold `SELECT` on `prospects` and `events` (001:252–257); RLS scopes both by organization (001:203–204). Nothing writes |
| The reads were proven under the real roles | `tests/db/sales-reads.test.ts` (36), `page-matrix-provisioned` (122) and the 2A.3b/2A.3c rendered proofs ran through `asPrincipal` and the RLS roles on 001–010 |
| No new environment name | `git diff ad86aa2 26a8406 -- app components core lib navigation` adds no `process.env` read |
| The CURRENT recovery point stays valid | The post-010 artifact (`ascend-backup-20260930T030242Z-post-010.ascbk`, profile `post-010-v1`, ledger 010) describes the schema, which is unchanged. `core/recovery/profile-registry.ts` is unchanged in the range. RECOVERY-CURRENT-001's registry change is what made that artifact CURRENT |
| Scale | 2A.3b measured the Priority section at 14.3 ms (owner) and 11.8 ms (partner) at 3,300 prospects on PostgreSQL 17.6 (checkpoint); production holds about 3,100. The stage summary is one indexed-scan aggregate over the same rows |

**Pre-deploy backup: not required (owner decision D3).** The deploy writes nothing, and the old build is
a complete rollback (§4). A backup protects data against the code being deployed; this code cannot
change data. The owner may still ask for one. If so, it is taken with the existing
`backup-production.sh` from the serving tree before T5, and proven with R1b/R1c before T6.

## 2 · The smoke for this release (reviewed in ROLLOUT-2A3BC-1)

`scripts/deploy-smoke.mjs` now takes `--release <name>`, required with `--baseline` and `--post`. A check
marked `{ release: X }` is new in release X: a `--baseline` run for X requires it to **fail** on the old
build (the discrimination proof), and every other run treats it as ordinary. Before this change the
marker was a boolean tied to 2A.3a. After 2A.3a its checks (C1–C7, R2–R4) pass on the old build, and the
boolean would have reported them as UNEXPECTED-PASS (shown below).

**A selected release runs only its own and earlier checks** (r1 finding HISTORICAL-SMOKE). Releases
are ordered as they shipped (`RELEASE_ORDER`), and the 2A.3bc blocks run inside `if (applies("2a3bc"))`.
A `--release 2a3a` run therefore contains no E1–E5 or R6–R9, and A6 keeps its frozen "/partner loads"
form there. r1 only changed how those checks were counted, so they still ran and failed on the 2A.3a
builds. `rollout-2a3bc.test.ts` requires every check marked for a release after 2a3a to sit inside that
release's guard.

`RELEASES.2a3bc`:
- The old build already runs on 010, so the ledger head is 010 in both modes.
- The Sales tables are counted in both modes, and B5 runs in both.
- D2/D3 hold the archived count still rather than at zero, since archival is ordinary owner work
  now.
- A6 expects `/partner` to redirect to `/sales`.

New checks, all GET-only, all marked `2a3bc`:

| Id | Owner | Id | Partner |
|---|---|---|---|
| A6 | `/partner` → 307 `/sales` | R6 | `/sales` leads with the Priority section |
| E1 | `/sales` leads with the Priority section and its "Priority · N" nav entry | R7 | stage links in scope `mine` |
| E2 | `/sales/list?priority=1` is titled Priority | R8 | `/partner` → 307 `/sales` |
| E3 | three stage links, in scope `team` | R9 | `/sales` (loaded) has no `/partner` link |
| E4 | `/partner?scope=mine` → `/sales?scope=mine` | | |
| E5 | `/` and `/sales` (loaded) have no `/partner` link | | |

The existing guarantees are unchanged:
- Only login writes; every other POST, PATCH or DELETE targets the impossible `ghost` reference.
- The partner is mandatory, and their credentials come only from the environment.
- Every database read is `BEGIN READ ONLY`.

**Fixture evidence** (never production): a throwaway PostgreSQL 17.6 on a Unix socket (3,300
prospects, ledger 001–010), `next dev` with every production variable unset, and a FIXTURE COPY of
the script that changes only its connections: base URL, env source, database handle, error log, and
minted session cookies in place of `/api/auth/login`, because a dev server cannot authenticate. The
production script was not modified for the run, so A1 and R1 there test the stub, not a real login.

One fixture database carried all four runs in order, so each post run is compared with its own baseline:

| Run | Build · schema | Result |
|---|---|---|
| `--baseline --release 2a3a` | `ba648d3` (the D1 build 2A.3a replaced) · 009 | **28 passed · 0 failed · 10 `2a3a` checks failed AS EXPECTED** (C1–C7, R2–R4); no E/R6–R9 ran. Identical to 2A.3a-2's real T1 |
| *(010 applied to the fixture: ledger 10, no event written)* | | |
| `--post --release 2a3a` | `ad86aa2` (serving today) · 010 | **44 passed · 0 failed**. Identical to 2A.3a-2's real T11 |
| `--baseline --release 2a3bc` | `ad86aa2` · 010 | **39 passed · 0 failed · 10 `2a3bc` checks failed AS EXPECTED**, no UNEXPECTED-PASS: A6 200, E1/R6 first section `overdue`, E3/R7 no stage links, E4/R8 200, E5/R9 `/partner` linked |
| `--post --release 2a3bc` | `3b59f9c` + this round · 010 | **53 passed · 0 failed**: A6 307 → `/sales`, E1–E5, R6–R9, B5, D1–D8, P1–P4; nothing written |

The fixture database: 120 prospects seeded at 009 through the D1 build's own schema and
`seedOperationalWorld`, then 010 applied with `psql`.

The fixture run found one defect, fixed before freezing. R9 passed on an HTTP 500 page, because an
error page has no links. R9 now requires the page to have loaded, as E5 already did, and a test
holds both to it.

**P4/T2 against a planted duplicate:** a synthetic `.next/server/app/page 2.js` was listed by the new
P4 command and missed by r1's (which excluded `.next`). The T2 clone check found the same file in the
`cp -Rc` clone, whose file count matched the source, so a contaminated build stops before T3.

## 3 · Preconditions (all before T0; any failure is a STOP)

| # | Precondition | How it is shown |
|---|---|---|
| P1 | The pin is the latest PROMOTED baseline, and Coordinator `verify` is OK after fetching `agents/coord` and `review/*` | `npm run agent -- verify` |
| P2 | **Full aggregate green on the pin's tree**: static, server, db and recovery fixture, plus owner R1b/R1c. The receipts come from the pin's own task while it was claimed. For this rollout that is ROLLOUT-2A3BC-1, whose owner phase Oscar runs (`env -u ASCEND_AGENT npm run agent -- prove ROLLOUT-2A3BC-1 --owner`) before its freeze | `node scripts/gate-proof.mjs aggregate` exit 0 for that tree |
| P3 | The serving checkout (main checkout) is switched, detached, from `ad86aa2` to the pin **while the old build keeps serving** (the running server holds the built `.next`, not the source). It is then clean, and `apps/os/node_modules` needs no change (`package.json` and the lockfile are unchanged in the range) | `git status --porcelain` empty; `git rev-parse HEAD` = pin; `git diff --stat ad86aa2 <pin> -- package.json package-lock.json apps/os/package.json` empty |
| P4 | No iCloud duplicates (`* 2.*`, `* 3.*`) in the serving tree's source **or its `.next`**. The serving `.next` becomes the rollback artifact at T2, so a contaminated one is a STOP here, before any outage (r1 finding ROLLBACK-ARTIFACT). Read-only: nothing under `.next` is touched while launchd serves it (2A.3a-2 owner rule) | `find . -name '* [0-9].*' -not -path './node_modules/*'` (which includes `.next`) is empty. **If it lists anything inside `.next`, STOP for owner decision D5** |
| P5 | Only `com.ascend.os` holds 3001; no dev server, agent or other session in the main checkout | `lsof -iTCP:3001 -sTCP:LISTEN` shows only the launchd PID |
| P6 | Partner credentials available for the smoke (`read -rs` into `ASCEND_SMOKE_PARTNER_EMAIL` / `_PASSWORD`), and the owner email in `ASCEND_SMOKE_OWNER_EMAIL`, set before T1 so no prompt stalls a keep-alive socket (2A.3a-2 T1) | set, never printed |

## 4 · The sequence

Record every step's non-secret output in `~/AscendDeploy/<TS>/` (mode 0700). All commands run from
the serving tree's `apps/os`.

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| **T0** | Owner authorization recorded in chat: pin and tree, window start, D1–D4 (§7). If P4 found duplicates inside `.next`, there is no T0 (D5: postpone) | — | no authorization, no T1 |
| T1 | Baseline smoke on the OLD build: `node scripts/deploy-smoke.mjs --baseline --release 2a3bc --record ~/AscendDeploy/<TS>/baseline.json` | 0 failed; the 10 `2a3bc` checks (A6, E1–E5, R6–R9) fail AS EXPECTED; no UNEXPECTED-PASS | STOP; nothing has changed |
| T2 | Rollback clone of the serving build, while still serving: `cp -Rc .next ~/AscendDeploy/<TS>/next-ad86aa2`. `~/AscendDeploy` is outside the iCloud-synced tree. Then verify the clone, read-only: `find ~/AscendDeploy/<TS>/next-ad86aa2 -name '* [0-9].*'` is empty; its `BUILD_ID` = `k5DWIdCrqMPfXkxCGDdpW`; `find <clone> -type f \| wc -l` equals the same count for `.next` | all three hold; the clone is the verified rollback artifact. T2 is never skipped | STOP; nothing has changed. A clone that fails any check is never used as a rollback |
| T3 | **Outage starts:** `launchctl bootout gui/501/com.ascend.os` (bootout, not stop: the job has KeepAlive) | port 3001 free; old PID gone | STOP; `launchctl bootstrap` the old build |
| T4 | Remove the old build output and build from the clean pinned tree: `rm -rf .next && npx next build --turbopack` | exit 0; new `BUILD_ID`; `git status --porcelain` still empty | §5 "build fails" |
| T5 | iCloud check on the fresh build: `find . -name '* [0-9].*' -not -path './node_modules/*'` | empty (T6 is chained behind it, as in 2A.3a-2) | remove the duplicates or rebuild; do not start |
| T6 | **Outage ends:** `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist`, after the build has completed (the build/restart race) | `/login` 200 within 30 s | §5 "does not start" |
| T7 | Post smoke: `node scripts/deploy-smoke.mjs --post --release 2a3bc --since ~/AscendDeploy/<TS>/baseline.json` | every check passes, owner and partner; D and P rows show nothing written across the deployment | §5 "smoke fails" |
| T8 | Owner acceptance: Oscar opens `/sales` as himself and sees the Priority section first, the stage summary, and no Partner entry in the rail; `/partner` lands on `/sales` | owner-confirmed | report; roll back if Oscar says so (§5) |

## 5 · Failure and rollback

The old build **is** a valid rollback here, because the schema does not change (unlike 2A.3a, where
010 made it invalid).

| Situation | Action |
|---|---|
| T1–T2 fail | STOP. Nothing has changed; the old build is serving. |
| T3 cannot stop the service | STOP; do not build under a running server. |
| **Build fails (T4)** | Service is down. Roll back (below) and report. Do not retry blindly: a failed build of a promoted tree is a finding. |
| **Does not start (T6)** or **smoke fails (T7)** | Roll back (below). |
| Owner rejects at T8 | Roll back (below). |
| **Rollback** | Re-run T2's duplicate check on the clone, then `launchctl bootout gui/501/com.ascend.os` (if running) → `rm -rf .next && cp -Rc ~/AscendDeploy/<TS>/next-ad86aa2 .next` → the same duplicate check on the restored `.next` → `git switch --detach ad86aa2` in the serving checkout → `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist` → `/login` 200 → `node scripts/deploy-smoke.mjs --baseline --release 2a3bc --record ~/AscendDeploy/<TS>/after-rollback.json`, which must match T1 (0 failed, the same 10 expected failures). Run that last smoke from the pin's `scripts/`, e.g. a detached worktree at the pin with `.env.production.local` linked for the run and removed after (the 2A.3a-2 T2 precedent), because `ad86aa2`'s smoke has no `--release`. |

A rollback discards nothing, because nothing is written between T1 and the rollback except by the
people using the site, and the old build serves that data unchanged.

## 6 · Evidence the ROLLOUT-2A3BC-2 checkpoint must record (non-secret only)

- The pin and tree.
- Old and new `BUILD_ID`.
- The T1 summary line and its expected-failure list.
- The P4 count (source and `.next`).
- The T2 clone's `BUILD_ID`, its duplicate count and its file count against `.next`.
- The outage start, end and duration.
- The T5 count.
- The T7 summary line, with the P1–P4 rows.
- The owner's T8 confirmation.
- Any failure, rollback or deviation, as it happened.

## 7 · Owner decisions (recorded at T0)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Deploy pin and window | The latest PROMOTED baseline with P2 green, pinned exactly; a quiet window (the outage is the build, about two minutes in 2A.3a-2) |
| D2 | Rollback policy | Roll back on any T6/T7 failure or at the owner's word at T8; no forward-fix under an outage, because the old build is valid |
| D3 | Pre-deploy backup | Not required (§1). The owner may ask for one |
| D4 | Serving-tree hygiene (P3–P5), including stopping other sessions in the main checkout | Required |
| D5 | **Only if P4 finds duplicates inside the serving `.next`:** there is no verified rollback artifact, so the window does not start | **Postpone.** No outage begins without T2's verified clone. Making a clean old-build artifact (for example rebuilding `ad86aa2` in a stopped-service window of its own) is separate, owner-authorized work with its own proof, and this rollout waits for it. Never clone a contaminated build, and never clean `.next` while it is serving |

**Recorded risks, not new work:**
- I1: the serving tree lives under iCloud sync, which creates `* 2.*` duplicates. T5 guards the
  build.
- R1c intermittency (2A.3a-2 follow-up 3): it affects P2's owner phase only, and a failed R1c is a
  STOP before T0, never inside the window.
