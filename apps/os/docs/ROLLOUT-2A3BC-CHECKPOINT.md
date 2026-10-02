# Rollout 2A.3bc — 2A.3b + 2A.3c served in production · CHECKPOINT

**Status: COMPLETE.** The promoted build carrying 2A.3b (Priority) and 2A.3c (one pipeline, stage
summary) is serving production from `/Users/oscar/AscendServe/ascend/apps/os`, executed to
ROLLOUT-2A3BC-EXECUTION-CONTRACT.md. Code-only: no migration and no schema, grant, policy, index or data
change. Every production-touching command was run by Oscar in his own terminal from scripts the agent
prepared. The agent typed no confirmation and handled no credential. Evidence lives in
`~/AscendDeploy/`, non-secret only.

The contract (§6) requires the two earlier windows to be recorded first, so this checkpoint has three
parts: the cleanup window (SERVE-CLEAN-001), the relocation window (SERVE-RELOCATE-001), then the
rollout window.

## Cleanup window (SERVE-CLEAN-001, 2026-10-01) — C11 failed, original build restored

Evidence: `~/AscendDeploy/20261001T074908Z-clean`.

| Step | Result |
|---|---|
| C1 before-smoke | 39 passed · 0 failed · 10 `2a3bc` checks failed AS EXPECTED |
| C2 contaminated build | `BUILD_ID k5DWIdCrqMPfXkxCGDdpW`, 2,097 files, **867 iCloud duplicates** |
| C3 outage start | 2026-10-01T08:09:03Z; port 3001 free |
| C4 | contaminated `.next` moved aside intact (2,097 files, 867 duplicates) to `next-contaminated` |
| C5 | serving checkout at `ad86aa2`, tree `ee53508`, clean |
| C6 | clean rebuild, `BUILD_ID Wd5Bf13Y2uIu0g51_KMtH` |
| C7 | 0 duplicates |
| C8 / C8b | `clean.manifest` over all 1,228 files (cache included); never-served `next-clean` `cmp`-equal, 0 duplicates |
| C9 outage end | 2026-10-01T08:10:05Z, `/login` 200 (**outage 62 s**) |
| C10 after-smoke | 39 · 0 · 10, identical to C1; counts unchanged (ledger 010, 3,108 prospects, 22,812 events, 2 users, same vault) |
| **C11 delayed check** | **FAILED**: the live `.next` had 5 differences outside `cache/` and **7 new duplicates** within about four minutes. `next-clean` itself re-proved equal |
| §4 restore | 08:15:55Z–08:16:27Z: rebuilt `.next` kept as evidence (`next-rebuild-failed-081557`), original `k5DWIdCrqMPfXkxCGDdpW` back, `/login` 200. `after-restore.json` counts equal `before.json` |

Conclusion recorded at the time: iCloud re-contaminates any build at the Desktop path, so that path was
retired as the serving tree (P7 retired; SERVE-RELOCATE-001 became the gate, P8). `next-contaminated` and
the Desktop-built `next-clean` are kept until the owner decides their deletion (E3); the Desktop-built
`next-clean` embeds the Desktop path and was never a rollback artifact for the new location.

## Relocation window (SERVE-RELOCATE-001, amended by RP9-001 and W13-001)

Evidence: `~/AscendDeploy/20261001T095732Z-relocate`.

**Preparation (2026-10-01).** RP1/RP2 passed (path gate exit 0 for the clone and its `apps/os`). RP3: an
independent clone at `ad86aa2`, tree `ee53508`, detached, no alternates, GitHub remote. RP4: env file
placed 0600, gitignored. RP5: built `BUILD_ID 7nb7jXKeqqPFZkNT9YI6x` at 10:00:38Z. RP6: 0 duplicates.
RP7: `clean.manifest` over 1,228 files, never-served `next-clean` `cmp`-equal. RP8 at 61 and 123 minutes:
no differences, cache included, 0 duplicates. RP9 first stopped at its own gate (`plutil -replace`
inserts); corrected by SERVE-RELOCATE-RP9-001.

**First window (2026-10-01) — failed at W3, rolled back.** W0 prechecks passed (the go-ahead was the
owner running the script, which round 4 replaced with an explicit chat message). W1 outage start
12:07:19Z, port free; the label's state was not checked. W2 installed the gated `.new` (`83a3b058…`),
`cmp` equal, lint OK. W3 `launchctl bootstrap` → `5: Input/output error`. Rollback 12:07:52Z–12:07:56Z:
`.bak` restored (`cmp` equal, `0ff5741b…`), `/login` 200 from the Desktop path; RP10's smoke reproduced
(39 · 0 · 10). Outage 37 s. Leading hypothesis, not a proven root cause: W1 waited only for the port, and
launchd was still unloading the label. SERVE-RELOCATE-W13-001 made W1 wait for both, allowed one guarded
W3 retry, and logged every transition through the contract's `ld_*` functions.

**Second preparation (2026-10-02, pin `70148c9`).** RP1–RP3 re-run at the pin. RP8 at 1,536 minutes: no
differences, 0 duplicates, clean at `ad86aa2`. RP9: gate accepted, `.bak` still byte-identical to the live
plist, `.new` `83a3b058…`. RP10: 39 · 0 · 10. Three RP10 attempts failed first, none touching anything
serving: two at the smoke's in-script email prompt (its blocking read outlived the server's keep-alive:
`EPIPE`, then `ECONNRESET`; reproduced locally), one at R0 because the partner credentials were not
supplied. The scripts now read all three inputs with `read -rs` before the smoke and pass them only in its
environment (contract P6).

**Second window (2026-10-02) — passed.** Owner go-ahead in chat at 11:42:31Z ("Go: start the relocation
window now."), recorded before the script ran.

| Step | Result (from `window-transitions.log`) |
|---|---|
| W0 | RP8 re-run clean; `rp9_gate` ACCEPT; live plist = `.bak`; `.new` SHA-256 = RP9's; before-smoke 39 · 0 · 10 |
| W1 | outage start 11:44:07Z; bootout exit 0; port free at 11:44:08Z but **label still present until 11:44:13Z**; ready only when both held in one poll |
| W2 | gate, `cmp` and SHA-256 re-checked; `.new` installed, `cmp` equal, lint OK |
| W3 | bootstrap attempt 1 exit 0 (no retry); `/login` 200, listening PID 81083 = launchd's, cwd `/Users/oscar/AscendServe/ascend/apps/os`; outage end 11:44:14Z (**7 s**) |
| W4 | after-smoke 39 · 0 · 10; before/after agree on ledger, prospects, notes, users, events |
| W5 | live `.next` = `clean.manifest` (no differences), 0 duplicates, `next-clean` equal, runner env link removed |
| W6 | 12:27:42Z, 43 minutes after W3: no differences (cache included), 0 duplicates, clean at `ad86aa2`; `WorkingDirectory` the new path; health ok, same PID. **Relocation completed and verified** |

The 5-second gap between the port freeing and the label disappearing at W1 is consistent with the first
window's error 5, which supports the hypothesis without proving it. ROLLOUT-2A3BC-2 was unblocked only
after W6.

## Rollout window (2026-10-02)

Evidence: `~/AscendDeploy/20261002T131549Z-rollout2a3bc` (`rollout-transitions.log`, smoke outputs,
`baseline.json`, `t4-build.log`, `p8-plutil.txt`; scripts with `rollout-kit.sha256`).

### Deploy pin

`451ba133d7d05a266e2dad60c388c28696658b16`, tree `523a824ba1248c04e18289543e2a586837e81e62`
(ROLLOUT-RANGE-001 r2, promoted). The §0 range check first stopped at pin `70148c9`: it carried
`docs/SERVE-RELOCATE-001-CONTRACT.md`, which the STOP clause did not name. The owner chose a reviewed
amendment (ROLLOUT-RANGE-001; Codex r1 FIX_REQUIRED on the clause's logic, r2 ACCEPTED). This task was
blocked meanwhile (EXTERNAL_DEPENDENCY) and unblocked by the owner after the promotion.

### T0 · owner authorization (chat, 2026-10-02T13:33:24Z)

"T0: pin 451ba133 tree 523a824b, start now; D1 yes, D2 roll back on T6/T7 failure or at my word, D3 no
backup, D4 yes." D5 did not arise (P4 found no duplicates). A first run of the window script at 13:32:02Z,
before the message, stopped at T0 with "no recorded authorization" and changed nothing.

### Preconditions

| # | Result |
|---|---|
| P1 | `verify` OK at the pin after fetching `agents/coord` and `review/*` |
| P2 | `gate-proof aggregate`: all 80 PROVEN suites valid for tree `523a824b…`, including owner R1b/R1c, in ROLLOUT-RANGE-001's worktree |
| §0 range | `ad86aa2..451ba13`: 48 paths, none outside the table or the named tasks' paths; package files and lockfiles unchanged |
| P3 | serving clone fetched and detached at `451ba13` while the old build served; clean; lockfile diff empty |
| P4 | 0 duplicates in source and `.next` (13:31:30Z); re-run at T0: 0 |
| P5 | port 3001 held only by launchd's PID 81083 (re-run at T0) |
| P6 | owner email and the sanctioned partner's email and password read with `read -rs` before T1; never printed |
| P7 | retired (historical; see the cleanup window) |
| P8 | W6 passed; `plutil -p`: `WorkingDirectory` and `ProgramArguments[1]` under `/Users/oscar/AscendServe/ascend/apps/os`; launchd PID's cwd that path; serving `BUILD_ID 7nb7jXKeqqPFZkNT9YI6x` = the relocation's `clean.json`; `next-clean` present |

### Sequence

| Step | Result |
|---|---|
| T1 | baseline on the old build: **39 passed · 0 failed · 10 `2a3bc` checks failed AS EXPECTED** (A6, E1–E5, R6–R9), no UNEXPECTED-PASS |
| T2 | relocation `next-clean`: `BUILD_ID 7nb7jXKeqqPFZkNT9YI6x` = `clean.json`'s; manifest `cmp` equal to `clean.manifest`; 0 duplicates |
| T3 | outage start **13:37:12Z**; bootout exit 0; port free at once, label gone at 13:37:17Z |
| T4 | `rm -rf .next && npx next build --turbopack`: exit 0 in 15 s; old `BUILD_ID 7nb7jXKeqqPFZkNT9YI6x` → new **`7qWp7bcGFp-sFNVNOrvOx`**; checkout still clean |
| T5 | 0 duplicates |
| T6 | bootstrap exit 0; `/login` 200, listening PID 84529 = launchd's, cwd the AscendServe path; outage end **13:37:34Z** (**22 s**) |
| T7 | post: **53 passed · 0 failed**. A6 307 → `/sales`; E1/R6 first section `priority`; E3/R7 three stage links (team / mine); E4/R8 307; E5/R9 no `/partner` link. D1–D8 and P1–P4: nothing written across the deployment (events 22,812 → 22,812; prospects 3,108, notes 0, users 2; vault unchanged) |
| T8 | **owner-confirmed** ("T8 accepted"): Priority first, stage summary, no Partner in the rail, `/partner` lands on `/sales` |

### How the scripts executed the contract

The window ran the contract's commands, with logging around them. Where a wrapper adds anything, the
addition is a stricter check, and none removes or replaces a step:
- T3 is `launchctl bootout` through `ld_bootout`, then also waits until the label is gone as well as the
  port (SERVE-RELOCATE-W13-001's lesson).
- T6 is one plain `launchctl bootstrap`, with no retry, as the contract states. Its health check also
  requires the listening PID to be launchd's and its cwd to be the AscendServe path, beyond `/login` 200.
- The §5 rollback was prepared exactly as written and rehearsed on a throwaway label, but it was not needed.

## State after the rollout

- Serving: `/Users/oscar/AscendServe/ascend` detached at `451ba13`, `BUILD_ID 7qWp7bcGFp-sFNVNOrvOx`,
  launchd PID 84529.
- Rollback artifact retained: `~/AscendDeploy/20261001T095732Z-relocate/next-clean` (the old build of
  `ad86aa2`, made at the AscendServe path).
- Owner decisions pending, not part of this task: deleting `next-contaminated`, the Desktop-built
  `next-clean` and the Desktop checkout's old `.next`.
- Follow-ups: repository docs and agent rules that still name the Desktop checkout as the serving tree.
