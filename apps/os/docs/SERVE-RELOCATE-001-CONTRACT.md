# SERVE-RELOCATE-001 — move the production serving checkout out of iCloud · CONTRACT

Written and reviewed in SERVE-RELOCATE-001. The window it describes is executed only after this
contract is promoted **and** the owner authorizes the relocation window in chat. Its evidence is
recorded in `~/AscendDeploy` and in ROLLOUT-2A3BC-2's checkpoint (§8). Every production-touching or
credential-bearing command, and every edit of the launchd configuration, is run by Oscar in his own
terminal. The agent prepares commands and records evidence. It never types a confirmation, edits the
plist, reads `.env.production.local` values or runs admin commands.

## 0 · Why the relocation comes before the 2A.3bc rollout

The serving checkout is `/Users/oscar/Desktop/ascendSite/ascend`. `~/Desktop` is an iCloud-synced root:
it carries `com.apple.file-provider-domain-id = com.apple.CloudDocs.iCloudDriveFileProvider/…`, and so
does `~/Documents`. I1 has been on record since before 2A.3a. On 2026-10-01 it became a blocker.

SERVE-CLEAN-001's window (evidence `~/AscendDeploy/20261001T074908Z-clean`):
- It rebuilt `ad86aa2` clean: `BUILD_ID Wd5Bf13Y2uIu0g51_KMtH`, 1,228 files, 0 duplicates.
- It proved a never-served copy byte for byte, and its after-smoke passed.
- About four minutes after the build, C11 found 7 duplicates and 5 new non-cache paths:
  - `… 3` copies in `server/app`;
  - `build/chunks … 2` copies carrying the **previous build's** timestamp (19:59:31, 2026-09-29). These
    are stale cloud copies the build never wrote.
- Per that contract, the original build was restored: `k5DWIdCrqMPfXkxCGDdpW` back, `/login` 200,
  outage 32 s, and C1's smoke reproduced (39 passed · 0 failed · 10 expected).

No clean `.next` can be held at the Desktop path, so the rollout could never pass its own P4 there.
The relocation is therefore a prerequisite of ROLLOUT-2A3BC-2.

**What moves:** where launchd runs the app from. **What does not:** the code, the commit (`ad86aa2`),
the database, the environment values, the logs and the port. Nothing new goes live.

**Round 3 (SERVE-RELOCATE-RP9-001)** corrects RP9. The preparation on 2026-10-01 (evidence
`~/AscendDeploy/20261001T095732Z-relocate`) stopped at RP9's own gate. `plutil -replace
ProgramArguments.1` **inserts** a new element at index 1 instead of replacing it: the old `next` path
moved to index 2 and every later argument shifted. RP9 now removes element 1 and inserts the new path
at index 1, and a fail-closed gate (§3, `rp9_gate`) checks the result. Nothing serving changed: the
live plist was only read.

**Round 2** answers Codex's r1 findings:
- **ROLLOUT-ROWS:** P2, P7, P8, T2, the rollback row and §6 of the rollout contract now name the
  relocation's artifacts and gate directly. P7 is retired as historical.
- **PATH-GATE:** §1's check is a fail-closed function, and RP2 gates on its exit status.

## 1 · The target, and what makes it valid

**Owner decision: `/Users/oscar/AscendServe/ascend`.** It is valid only if it is a real local directory,
with no symlink anywhere on its path, and no ancestor that is a synchronized root. The check, run
against the serving checkout and its `apps/os`:

```
serve_path_check() {
  local p=$1 fail=0 real abs d
  real=$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$p")
  abs=$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$p")
  [ -d "$real" ] || { echo "REJECT $p: not a directory"; fail=1; }
  [ "$real" = "$abs" ] || { echo "REJECT $p: resolves through a symlink to $real"; fail=1; }
  d=$abs; while [ "$d" != / ]; do [ -L "$d" ] && { echo "REJECT $p: symlink component $d"; fail=1; }; d=$(dirname "$d"); done
  d=$real; while [ "$d" != / ]; do
    xattr "$d" 2>/dev/null | grep -q '^com.apple.file-provider-domain-id$' && { echo "REJECT $p: synced root $d"; fail=1; }
    d=$(dirname "$d"); done
  case "$real/" in "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Library/Mobile Documents/"*|"$HOME/Library/CloudStorage/"*)
    echo "REJECT $p: under a synchronized location"; fail=1;; esac
  [ "$fail" -eq 0 ] && echo "ACCEPT $p (real path $real)"
  return $fail
}
```

**The function is fail-closed** (r1 finding PATH-GATE): it returns status 0 only for an accepted path
and 1 for any rejection, and a gate uses its status, never its text. RP2 runs it as
`serve_path_check /Users/oscar/AscendServe/ascend && serve_path_check /Users/oscar/AscendServe/ascend/apps/os`,
and any non-zero status is a STOP.

The file-provider attribute sits only on the synced root, not on anything inside it (measured:
`~/Desktop` and `~/Documents` carry it; `~/Desktop/ascendSite`, the checkout and `.next` do not). That is
why the check walks every ancestor. The rehearsal (§9) shows it PASSES the target and FAILS the Desktop
checkout, `~/Documents`, and a symlink into the Desktop.

## 2 · Everything tied to the serving path

| Item | Today | After | How |
|---|---|---|---|
| `~/Library/LaunchAgents/com.ascend.os.plist` (outside the repository) | `ProgramArguments[1]` = `…/Desktop/ascendSite/ascend/apps/os/node_modules/.bin/next`; `WorkingDirectory` = `…/Desktop/ascendSite/ascend/apps/os` | the same two values under `/Users/oscar/AscendServe/ascend/apps/os` | **exactly two values change**. `ProgramArguments[0]` (`/usr/local/bin/node`), `start -H 127.0.0.1 -p 3001`, `EnvironmentVariables` (none names the Desktop path), `KeepAlive`, `RunAtLoad`, `ThrottleInterval`, `ProcessType` and both log paths are unchanged |
| `.env.production.local` | in the Desktop checkout's `apps/os` | **also** in the new checkout's `apps/os`, mode 0600 | Oscar copies it (`install -m 600 <old> <new>`), never printed. The old copy stays for the rollback |
| `node_modules` | Desktop checkout | new checkout | `npm ci` at the repository root and in `apps/os`. The lockfiles are unchanged between `ad86aa2` and the pin |
| Logs | `~/Library/Logs/ascend-os{,.error}.log` | unchanged | — |
| Scripts that find their own tree | `deploy-smoke.mjs` (`APP` from `import.meta.url`), `backup-production.sh` and `recovery-verify.sh` (`cd "$(dirname "$0")/.."`) each read `.env.production.local` beside themselves | they work unchanged when run from the new checkout | they follow the env file (row 2) |
| Documents naming the Desktop path | `docs/ASCEND-OS-V1-COMPLETION-MAP.md`, `docs/DEPLOYMENT-D1-PREFLIGHT.md`; the 2A.3a and 2A.3bc contracts describe the serving tree | — | historical documents stay as written; the rollout contract is amended here (§7). Follow-ups in §10 |
| "The main checkout is the serving tree" (agent rule) | the Desktop checkout | **the serving checkout is `~/AscendServe/ascend`**; the Desktop checkout becomes development-only | §10 |
| Git | the Desktop checkout is a working repository (it was on `work/coordfreezedb001`) | the serving checkout is an **independent clone**: its own objects (`--no-hardlinks`, no `alternates`), remote `https://github.com/oski-650/ascend.git`, always **detached** at a promoted commit, never a work branch | not a worktree: a worktree's git metadata would live in the Desktop's iCloud-synced `.git` |

## 3 · Preparation (the Desktop path keeps serving; no outage)

`<TS>` is `~/AscendDeploy/<TS>-relocate/` (mode 0700). The checksum command is SERVE-CLEAN-001's
(`M="find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256"`). Every file, `cache/`
included, is listed, and lists are written to a file before `cmp`.

**The launchd gate (RP9 and W2).** It is fail-closed: it returns 0 only when `.new` is a valid edit of
`.bak` that changes exactly `ProgramArguments[1]` and `WorkingDirectory`, and 1 otherwise. `plutil -lint`
runs first. The Python plist parser and the `plutil -p` diff are each independent rejections, because
`plutil -lint` was measured to accept a file with trailing garbage.

```
rp9_gate() {
  local bak=$1 new=$2 app=$3
  plutil -lint "$new" >/dev/null || { echo "RP9 REJECT: lint"; return 1; }
  python3 - "$bak" "$new" "$app" <<'PY' || return 1
import plistlib, sys
bak, new, app = sys.argv[1:4]
a, b = (plistlib.load(open(p, "rb")) for p in (bak, new))
pa, pb = a.get("ProgramArguments", []), b.get("ProgramArguments", [])
errs = []
if len(pa) != 7 or len(pb) != 7: errs.append(f"ProgramArguments length {len(pa)} -> {len(pb)} (must be 7 -> 7)")
idx = [i for i in range(max(len(pa), len(pb))) if pa[i:i+1] != pb[i:i+1]]
if idx != [1]: errs.append(f"ProgramArguments indices changed {idx} (must be [1])")
if pb[1:2] != [f"{app}/node_modules/.bin/next"]: errs.append("ProgramArguments[1] is not the new next path")
keys = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
if keys != ["ProgramArguments", "WorkingDirectory"]: errs.append(f"changed keys {keys} (must be ProgramArguments, WorkingDirectory)")
if b.get("WorkingDirectory") != app: errs.append("WorkingDirectory is not the new path")
for e in errs: print("RP9 REJECT:", e)
sys.exit(1 if errs else 0)
PY
  local n=$(diff <(plutil -p "$bak") <(plutil -p "$new") | grep -c '^>')
  [ "$n" = 2 ] || { echo "RP9 REJECT: plutil -p diff shows $n changed lines (must be 2)"; return 1; }
  echo "RP9 ACCEPT"; return 0
}
```

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| RP1 | Coordinator `verify` OK after fetching `agents/coord` and `review/*`; this contract is promoted | OK | STOP |
| RP2 | §1's `serve_path_check` on `/Users/oscar/AscendServe/ascend` and on `/Users/oscar/AscendServe/ascend/apps/os`, chained with `&&`; record the exit status (`echo "exit $?"`) | **exit 0**; both print `ACCEPT` | any non-zero status: STOP |
| RP3 | The serving clone is exactly `ad86aa2`. Reuse the rehearsal clone only if all of the following hold; otherwise delete it and clone again (`git clone --no-hardlinks --no-checkout <desktop repo> ~/AscendServe/ascend`, set the remote to GitHub, `git checkout --detach ad86aa2`): `git rev-parse HEAD` = `ad86aa2…`; `HEAD^{tree}` = `ee5350841bd338a6cb423c637f409412b02c0511`; detached; `git status --porcelain` empty; no `.git/objects/info/alternates`; the remote is GitHub | all hold | re-clone, then re-check |
| RP4 | Oscar places the env file: `install -m 600 /Users/oscar/Desktop/ascendSite/ascend/apps/os/.env.production.local /Users/oscar/AscendServe/ascend/apps/os/.env.production.local` | present, 0600, gitignored; `git status` still empty; never printed | STOP |
| RP5 | `npm ci` at the root and in `apps/os`; then build under the same conditions production builds under (the env file present): `rm -rf .next && npx next build --turbopack` | exit 0; a `BUILD_ID`; `git status --porcelain` empty | STOP; nothing serving changed |
| RP6 | Zero duplicates: `find ~/AscendServe/ascend -name '* [0-9].*' -not -path '*/node_modules/*'` | empty | STOP |
| RP7 | `clean.manifest` and `clean.json` (commit, tree, `BUILD_ID`, file count, manifest SHA-256, 0 duplicates, time) in `<TS>`, mode 0600; the **never-served copy** `cp -Rc .next <TS>/next-clean`, whose `$M` list `cmp`-equals `clean.manifest`, with 0 duplicates | all hold; `next-clean` is the rollback artifact for the new location | STOP |
| RP8 | **Delayed stability check, at least 30 minutes after RP5** (the Desktop path failed in about four): the live `.next`'s `$M` list differs from `clean.manifest` only under `./cache/`; 0 duplicates anywhere in the checkout; `next-clean` still `cmp`-equal; `git status` empty | all hold | STOP; investigate before any window |
| RP9 | Prepare the launchd change in `<TS>`, outside `~/Library`. **(a) Backup.** If `<TS>/com.ascend.os.plist.bak` does not exist, `cp -p ~/Library/LaunchAgents/com.ascend.os.plist <TS>/com.ascend.os.plist.bak`. Then, always, `cmp ~/Library/LaunchAgents/com.ascend.os.plist <TS>/com.ascend.os.plist.bak` must report no difference (the backup is byte-identical to the live file *now*), and its SHA-256 is recorded. **(b) A fresh `.new`, always made from the backup,** overwriting any earlier `.new` (the one from the stopped 2026-10-01 run is invalid and is never used): `cp -p <TS>/com.ascend.os.plist.bak <TS>/com.ascend.os.plist.new`; `plutil -replace WorkingDirectory -string /Users/oscar/AscendServe/ascend/apps/os <TS>/com.ascend.os.plist.new`; `plutil -remove ProgramArguments.1 <TS>/com.ascend.os.plist.new`; `plutil -insert ProgramArguments.1 -string /Users/oscar/AscendServe/ascend/apps/os/node_modules/.bin/next <TS>/com.ascend.os.plist.new`. **(c) Gate:** `rp9_gate <TS>/com.ascend.os.plist.bak <TS>/com.ascend.os.plist.new /Users/oscar/AscendServe/ascend/apps/os` returns 0. **(d)** `/Users/oscar/AscendServe/ascend/apps/os/node_modules/.bin/next` is executable. Both files are 0600, and the `.new` file's SHA-256 is recorded as **the** file W2 may install | `cmp` equal; `rp9_gate` exit 0 (`plutil -lint` OK; `ProgramArguments` exactly 7 → 7 elements; only index 1 differs; the changed keys are exactly `ProgramArguments` and `WorkingDirectory`; the `plutil -p` diff shows exactly 2 changed values); `next` executable | STOP; nothing serving changed. A `.new` that failed any check is never installed |
| RP10 | Before-smoke against the Desktop path, from a smoke runner at the pin with the env file linked only for the run (SERVE-CLEAN-001 CP4): `node scripts/deploy-smoke.mjs --baseline --release 2a3bc --record <TS>/before.json` | 0 failed; the 10 `2a3bc` checks fail AS EXPECTED; no UNEXPECTED-PASS | STOP |

## 4 · The relocation window (owner-authorized)

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| **W0** | Owner authorization in chat: the window's start, and that this contract is the promoted one | — | no authorization, no W1 |
| W1 | **Outage starts:** `launchctl bootout gui/501/com.ascend.os` | port 3001 free | STOP; `launchctl bootstrap` the unchanged plist |
| W2 | Install only the `.new` RP9 accepted in this preparation run. Before installing: `rp9_gate` on `.bak` and `.new` returns 0 again; `cmp ~/Library/LaunchAgents/com.ascend.os.plist <TS>/com.ascend.os.plist.bak` reports no difference (the live file has not changed since RP9); the `.new` file's SHA-256 equals the one RP9 recorded. Then `cp -p <TS>/com.ascend.os.plist.new ~/Library/LaunchAgents/com.ascend.os.plist`, `cmp` of the live file against `.new` reports no difference, and `plutil -lint` passes | all hold | before the copy: STOP and `launchctl bootstrap` the unchanged plist (outage ends; nothing changed). After the copy: §5 rollback |
| W3 | **Outage ends:** `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist` | `/login` 200 within 30 s; the launchd PID's working directory is the new path (`lsof -a -p <pid> -d cwd` shows `/Users/oscar/AscendServe/ascend/apps/os`), and the PID holds 3001 | §5 rollback |
| W4 | After-smoke, same runner: `--baseline --release 2a3bc --record <TS>/after.json` | the same result as RP10. `before.json` and `after.json` agree on ledger head, prospects, notes, users and events | §5 rollback |
| W5 | Live check, read-only: the live `.next`'s `$M` list differs from `clean.manifest` only under `./cache/`, 0 duplicates; `next-clean` re-proven; remove the runner's env link | all hold | §5 rollback |
| W6 | **Delayed stability check, at least 30 minutes after W3**, read-only: as RP8, against the serving `.next` | all hold. **The relocation is now completed and verified** | §5 rollback |

Expected outage (W1→W3): seconds. Nothing is built inside the window.

## 5 · Rollback

**The Desktop checkout and its `.next` are not touched at any point in the relocation**, so the only
thing a rollback changes is the launchd file. It applies to any failure from W2 to W6 (W6 included):

1. `launchctl bootout gui/501/com.ascend.os` (if running).
2. `cp -p <TS>/com.ascend.os.plist.bak ~/Library/LaunchAgents/com.ascend.os.plist`. Its SHA-256 equals
   the one recorded at RP9.
3. `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist`.
4. `/login` 200, and the PID's working directory is the Desktop path.
5. RP10's smoke reproduces (39 passed · 0 failed · 10 expected).
6. Report. The new checkout and `<TS>` are kept as evidence, and ROLLOUT-2A3BC-2 stays blocked.

The Desktop `.next` it returns to is today's `k5DWIdCrqMPfXkxCGDdpW`. It is contaminated with
unreferenced copies, but it serves correctly, as RP10 and SERVE-CLEAN-001's restore show.

## 6 · What happens to `next-clean` from SERVE-CLEAN-001

`~/AscendDeploy/20261001T074908Z-clean/next-clean` is a proven clean build of `ad86aa2` made **at the
Desktop path**, and Next's build output is not path-independent. Measured on both builds, the
`required-server-files.json` and `.js` files embed the checkout's absolute path in `appDir`,
`config.outputFileTracingRoot` and `config.repoRoot`. So:

- It is **not** a rollback artifact for `~/AscendServe/ascend`. The relocation's own never-served
  copy (RP7) is.
- It remains SERVE-CLEAN-001 evidence. It and `next-contaminated` are kept until the rollout is
  complete and verified, and their deletion is the owner's later decision (E3).
- It is also not needed for this relocation's rollback, which returns to the Desktop path's own
  `.next` (§5).

## 7 · The amendments made in this task

**ROLLOUT-2A3BC-EXECUTION-CONTRACT.md**, with nothing weakened:
- "The serving tree" becomes `/Users/oscar/AscendServe/ascend` (with `apps/os`), in P3–P5 and T1–T7.
- P3 moves the serving clone to the pin with `git -C ~/AscendServe/ascend fetch origin` and
  `git -C ~/AscendServe/ascend checkout --detach <pin>`, then `npm ci` if the lockfiles changed
  (they have not).
- A new **P8**: SERVE-RELOCATE-001 completed and verified (W6 passed; launchd's `WorkingDirectory`
  is the new path; the serving PID's cwd is the new path). It replaces P7's reliance on
  SERVE-CLEAN-001's C11, which failed at the old path.
- T2 re-proves the relocation's `next-clean` (`<RELOCATE-TS>`), and the rollback restores it into
  the new location after re-proof. The rollback returns the serving clone to `ad86aa2`.

**SERVE-CLEAN-001-CONTRACT.md:** a superseded note recording that its C11 failed at the Desktop
path (§0) and that this relocation replaces its rollback artifact.

These amendments are the enforced dependency of ROLLOUT-2A3BC-2. The rollout must follow its
contract exactly (CONTRACT-EXACT), and it stays BLOCKED until the owner unblocks it after W6.

## 8 · Evidence location

- **`~/AscendDeploy/<TS>-relocate/`:** manifests, `clean.json`, `next-clean`, both plist files,
  smoke records and step outputs.
- **ROLLOUT-2A3BC-2's checkpoint:** a "Relocation window" section, after its "Cleanup window"
  section.

The reason is SERVE-CLEAN-001 §6: a separately promoted execution task would move the deploy pin
again and force another full aggregate including owner R1b/R1c.

## 9 · Rehearsal evidence (no production contact)

**Path validity:** round 2 ran §1's `serve_path_check` exactly as written in this document, extracted
from it and sourced. Exit statuses:

| Path | Exit |
|---|---|
| `/Users/oscar/AscendServe/ascend` | **0** (ACCEPT) |
| `/Users/oscar/AscendServe/ascend/apps/os` | **0** (ACCEPT) |
| `/Users/oscar/Desktop/ascendSite/ascend` | **1** (synced root `~/Desktop`; under Desktop) |
| `~/Documents` | **1** |
| a symlink into the Desktop | **1** (resolves through a symlink; symlink component; synced ancestor) |
| a path that does not exist | **1** |
| RP2's chained command | **0** |
| the same chain with the Desktop checkout as the second path | **1** |

Round 1's snippet set `fail=1` but never returned it, so a gate could not stop on it (r1 finding
PATH-GATE). The scratch script used in round 1 did exit with its status, but the contract text did not.

**The clone:** `git clone --no-hardlinks --no-checkout` of the Desktop repository took 5 s with the
checkout. Remote set to GitHub, detached at `ad86aa2`, tree `ee53508`, clean, no `alternates`.

**The build** (no production environment present): `npm ci` (root and `apps/os`), then
`npx next build --turbopack`. Exit 0 in 16 s; `BUILD_ID 7wZSXSgrqTpQxc_RJ94-V`; 1,228 files (equal to
the Desktop builds); **0 duplicates**. The never-served `cp -Rc` copy is `cmp`-equal over all 1,228
files.

**Path dependence:** 2 files name the checkout path, `required-server-files.json` and `.js`
(`appDir`, `outputFileTracingRoot`, `repoRoot`). The Desktop `next-clean` names the Desktop path in
the same keys.

**`next start`** from the new location on a spare loopback port: `/login` 200; `/`, `/sales` and
`/partner` 307 to login (no session). It changed no file in `.next`.

**The 2026-10-01 preparation run** (`~/AscendDeploy/20261001T095732Z-relocate`, round 2's contract):

| Step | Result |
|---|---|
| RP4–RP7 | PASSED. Env file placed (0600, gitignored, tree clean); `BUILD_ID 7nb7jXKeqqPFZkNT9YI6x` built at 10:00:38Z with the env file present; 1,228 files; 0 duplicates; `next-clean` proven |
| RP8 | **PASSED** at 11:01:42Z, 61 minutes after the build: 0 non-cache differences, 0 cache differences, 0 duplicates, `next-clean` equal, tree clean |
| RP9 | **STOPPED at its gate.** The `.new` file's array shifted (8 changed lines, not 2). `.bak` is byte-identical to the live file; `.new` is invalid and is overwritten by round 3's RP9 |
| RP10 | not run |

**RP9 rehearsal** (round 3, on scratch copies of the live plist, no production contact):

| Case | `rp9_gate` |
|---|---|
| Round 2's commands (`-replace ProgramArguments.1`) | **exit 1**: length 7 → 8; indices 1–7 changed. Reproduced separately: the `plutil -p` diff showed 7 changed lines from the array shift |
| Round 3's commands (`-remove` then `-insert ProgramArguments.1`) | **exit 0**: exactly two changed values; length 7 → 7; only index 1 differs; changed keys `ProgramArguments`, `WorkingDirectory` |
| Round 3's commands plus an extra changed key (`KeepAlive`) | **exit 1**: changed keys include `KeepAlive` |
| `ProgramArguments[1]` changed, `WorkingDirectory` left unchanged | **exit 1** |
| A `.new` with trailing garbage | **exit 1**. `plutil -lint` accepted it, and the Python plist parser rejected it |

**Stability:**

| When | Result |
|---|---|
| t0, 2026-10-01T08:24:41Z | PASS (0 non-cache differences, 0 cache differences, 0 duplicates, copy equal, clean) |
| t+30 min, 2026-10-01T08:55:19Z | **PASS** (0 non-cache differences, 0 cache differences, 0 duplicates anywhere in the checkout, copy equal, clean) |

Control: the Desktop path's own result is SERVE-CLEAN-001's C11, which failed within about four
minutes of an identical build.

The rehearsal clone is left at `~/AscendServe/ascend` (detached, clean, not serving). RP3 decides
whether it is reused. Its `.next` is rebuilt at RP5 with the env file present.

## 10 · Order, owner decisions and follow-ups

**What re-runs after round 3 is promoted** (the deploy pin is round 3's commit, with the full aggregate
including owner R1b/R1c):
- RP1: `verify`, at the new pin.
- RP2: the path gate.
- RP8: re-run in the same preparation run as RP9. The 2026-10-01 pass at 61 minutes stays as
  evidence, and the build it checks is unchanged.
- RP9: corrected.
- RP10: the before-smoke.

RP3–RP7 are not repeated: the build at `~/AscendServe/ascend` is still `ad86aa2`, and RP8
re-validates it against `clean.manifest`. If RP8 fails, the preparation restarts at RP3.

**Order:**
1. This contract is reviewed and promoted.
2. The preparation RP1–RP10 runs (no outage).
3. The owner authorizes the relocation window (W0).
4. W1–W5 run.
5. The W6 stability check passes.
6. The owner unblocks ROLLOUT-2A3BC-2.
7. The rollout's own preconditions, with P8, are re-run.
8. The owner separately authorizes the rollout window.

| # | Decision | Recommendation |
|---|---|---|
| F1 | Serving path | **Decided: `/Users/oscar/AscendServe/ascend`**, valid only under §1 |
| F2 | Relocation window start | Any time after RP8 passes; the outage is seconds |
| F3 | The Desktop checkout afterwards | Kept as the development checkout, never serving. Its contaminated `.next` stays until the rollout is verified; removing it is the owner's later decision |
| F4 | Reuse the rehearsal clone at RP3 | Yes, if every RP3 condition holds |

**Follow-ups once W6 passes** (documentation and agent rules, outside this task's write paths):
- The serving-tree rule in agent instructions and memory: serving is `~/AscendServe/ascend`, and
  agents never use it for development.
- The recovery runbook and any procedure naming the Desktop serving path.
- `docs/ASCEND-OS-V1-COMPLETION-MAP.md` and `docs/DEPLOYMENT-D1-PREFLIGHT.md` stay historical but
  get a pointer.
- The Desktop `.next` and SERVE-CLEAN-001's artifacts, at the owner's word.
