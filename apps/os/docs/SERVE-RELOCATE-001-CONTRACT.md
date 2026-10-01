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

**Round 4 (SERVE-RELOCATE-W13-001)** sequences launchd teardown and bootstrap. In the first relocation
window (2026-10-01, evidence §9), W0–W2 passed. Then W3's `launchctl bootstrap` failed with
`5: Input/output error`. The §5 rollback restored the backup and the Desktop path served again: the
outage was 37 s, and RP10's smoke reproduced.
- **Findings:** neither the relocation build nor the launchd file is implicated (§9).
- **Leading hypothesis, not a proven root cause:** W1 waited only for port 3001 to close, and the
  long-running server's launchd job may still have been unloading.
- **The change:**
  - W1 now waits for the label itself to disappear, which is a stronger readiness condition
    whatever the cause.
  - W3 may retry once, and only after the label is confirmed absent.
  - The rollback uses the same wait.
  - Every transition is logged.
  - W0 needs an explicit chat go-ahead.

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

**Launchd sequencing (round 4).** W1–W3 and the §5 rollback use **only** these functions, verbatim,
with `<log>` = `<TS>/window-transitions.log`. Every event they cause is logged there with a UTC
timestamp, and no secrets are logged:
- the bootout call and its exit status;
- every change in the readiness poll;
- the install of a plist, with `cmp` result and SHA-256 prefix;
- each bootstrap attempt and its exit status;
- the retry decision;
- `/login` status, the listening PID, launchd's PID and that PID's cwd.

**Readiness is never sticky** (r1 finding STICKY-READINESS). `ld_wait_unloaded` returns 0 only when
**one poll** observes, live, port 3001 free, then the label absent
(`launchctl print gui/501/com.ascend.os` fails), then the port still free. Earlier observations
decide only what is logged. It gives up at its deadline.

`ld_bootstrap_guarded` bootstraps once. On failure it retries **exactly once**, and only after
`ld_wait_unloaded` returns 0; otherwise it returns 1 (roll back). `ld_health` returns 0 only for
`/login` 200 within 30 s, the listening PID equal to launchd's PID, and that PID's cwd equal to the
expected path.

```
ld_log() { print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" | tee -a "$2"; }
ld_loaded() { launchctl print "gui/501/$1" >/dev/null 2>&1; }
ld_port_free() { [ -z "$(lsof -nP -iTCP:$1 -sTCP:LISTEN -t 2>/dev/null)" ]; }
# ld_wait_unloaded <label> <port> <limit-seconds> <log>: 0 only when ONE poll observes, live, the port
# free, then the label absent, then the port still free. Nothing observed earlier counts toward readiness;
# earlier values only decide what changed and is logged.
ld_wait_unloaded() {
  local label=$1 port=$2 limit=$3 log=$4 t0=$(date +%s) pf la pf2 prev=""
  while :; do
    ld_port_free $port && pf=1 || pf=0
    ld_loaded $label && la=0 || la=1
    ld_port_free $port && pf2=1 || pf2=0
    [ "$pf/$la/$pf2" != "$prev" ] && ld_log "poll: port $port free=$pf, label $label absent=$la, port free again=$pf2" $log
    prev="$pf/$la/$pf2"
    [ $pf = 1 ] && [ $la = 1 ] && [ $pf2 = 1 ] && { ld_log "ready: port $port free and label $label absent in the same poll" $log; return 0; }
    [ $(( $(date +%s) - t0 )) -ge $limit ] && { ld_log "deadline ${limit}s reached, not ready (last poll $prev)" $log; return 1; }
    sleep 0.25
  done
}
# ld_bootout <label> <log>: bootout if loaded; logs the call and its exit status.
ld_bootout() {
  local label=$1 log=$2 rc
  if ld_loaded $label; then launchctl bootout "gui/501/$label" 2>>"$log"; rc=$?; ld_log "bootout $label exit $rc" $log; return $rc; fi
  ld_log "bootout $label skipped: not loaded" $log; return 0
}
# ld_install <src> <dst> <log>: cp -p, then cmp; logs both SHA-256 prefixes and the result.
ld_install() {
  local src=$1 dst=$2 log=$3
  cp -p "$src" "$dst" 2>>"$log" || { ld_log "install ${src:t} -> ${dst:t} FAILED (cp)" $log; return 1; }
  cmp -s "$src" "$dst" || { ld_log "install ${src:t} -> ${dst:t} FAILED (cmp differs)" $log; return 1; }
  ld_log "install ${src:t} -> ${dst:t} ok, cmp equal, sha256 $(shasum -a 256 "$dst" | cut -c1-16)" $log; return 0
}
# ld_bootstrap_guarded <label> <plist> <port> <log>: attempt 1; on failure, retry exactly once and only
# after ld_wait_unloaded confirms readiness. 0 = bootstrapped; 1 = roll back.
ld_bootstrap_guarded() {
  local label=$1 plist=$2 port=$3 log=$4 rc
  launchctl bootstrap gui/501 "$plist" 2>>"$log"; rc=$?; ld_log "bootstrap attempt 1 exit $rc" $log
  [ $rc = 0 ] && return 0
  ld_wait_unloaded $label $port 30 $log || { ld_log "not ready: no retry; roll back" $log; return 1; }
  launchctl bootstrap gui/501 "$plist" 2>>"$log"; rc=$?; ld_log "bootstrap attempt 2 (the only retry) exit $rc" $log
  [ $rc = 0 ] && return 0
  ld_log "retry failed; roll back" $log; return 1
}
# ld_health <label> <port> <expected-cwd> <log>: 0 only if /login answers 200 within 30 s, the listening
# PID is the label's launchd PID, and that PID's cwd is the expected path. Logs all three.
ld_health() {
  local label=$1 port=$2 want=$3 log=$4 c=000 pid lpid cwd i
  for i in {1..30}; do c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login"); [ "$c" = 200 ] && break; sleep 1; done
  pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1)
  lpid=$(launchctl print "gui/501/$label" 2>/dev/null | awk '/^\tpid = /{print $3}')
  cwd=$([ -n "$pid" ] && lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  ld_log "health: /login $c, listening pid ${pid:-none}, launchd pid ${lpid:-none}, cwd ${cwd:-none}" $log
  [ "$c" = 200 ] && [ -n "$pid" ] && [ "$pid" = "$lpid" ] && [ "$cwd" = "$want" ] && { ld_log "health ok" $log; return 0; }
  ld_log "health FAILED (expected cwd $want)" $log; return 1
}
```

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| **W0** | **An explicit one-line go-ahead from the owner in chat**, naming the window's start, sent before any production command of the window runs. Running the script is not the authorization. Then the prechecks: RP8 re-run (the live AscendServe `.next` against `clean.manifest`, differences only under `./cache/`; 0 duplicates; `next-clean` `cmp`-equal; HEAD `ad86aa2`; clean tree); RP9's (`rp9_gate` on `.bak`/`.new` returns 0; the live plist `cmp`-equals `.bak`; the `.new` SHA-256 equals RP9's); and RP10's before-smoke re-run, with the same result | go-ahead recorded; prechecks pass | no go-ahead or a failed precheck: no W1; nothing changed |
| W1 | **Outage starts:** `ld_bootout com.ascend.os <log>`, then `ld_wait_unloaded com.ascend.os 3001 30 <log>` | both exit 0: port 3001 free **and** the label absent **in the same poll**, logged, within 30 s | deadline reached: STOP **before W2**, with nothing installed. When the label is absent, bring the unchanged plist back with `ld_bootstrap_guarded com.ascend.os ~/Library/LaunchAgents/com.ascend.os.plist 3001 <log>` and `ld_health com.ascend.os 3001 /Users/oscar/Desktop/ascendSite/ascend/apps/os <log>`. If that fails, the service is down: report immediately |
| W2 | Install only the `.new` RP9 accepted in this preparation run. Before installing: `rp9_gate` on `.bak` and `.new` returns 0 again; `cmp ~/Library/LaunchAgents/com.ascend.os.plist <TS>/com.ascend.os.plist.bak` reports no difference (the live file has not changed since RP9); the `.new` file's SHA-256 equals the one RP9 recorded. Each precheck result is logged with `ld_log`. Then `ld_install <TS>/com.ascend.os.plist.new ~/Library/LaunchAgents/com.ascend.os.plist <log>` (copy, `cmp`, SHA-256 logged), and `plutil -lint` passes (logged) | all hold | before the copy: STOP and `launchctl bootstrap` the unchanged plist (outage ends; nothing changed). After the copy: §5 rollback |
| W3 | **Outage ends:** `ld_bootstrap_guarded com.ascend.os ~/Library/LaunchAgents/com.ascend.os.plist 3001 <log>` (one attempt, and at most one retry, only after readiness), then `ld_health com.ascend.os 3001 /Users/oscar/AscendServe/ascend/apps/os <log>` | both exit 0: bootstrapped; `/login` 200 within 30 s; the listening PID is launchd's PID; its cwd is the new path; all logged | either exits 1: §5 rollback |
| W4 | After-smoke, same runner: `--baseline --release 2a3bc --record <TS>/after.json` | the same result as RP10. `before.json` and `after.json` agree on ledger head, prospects, notes, users and events | §5 rollback |
| W5 | Live check, read-only: the live `.next`'s `$M` list differs from `clean.manifest` only under `./cache/`, 0 duplicates; `next-clean` re-proven; remove the runner's env link | all hold | §5 rollback |
| W6 | **Delayed stability check, at least 30 minutes after W3**, read-only: as RP8, against the serving `.next` | all hold. **The relocation is now completed and verified** | §5 rollback |

Expected outage (W1→W3): seconds. Nothing is built inside the window.

## 5 · Rollback

**The Desktop checkout and its `.next` are not touched at any point in the relocation**, so the only
thing a rollback changes is the launchd file. It applies to any failure from W2 to W6 (W6 included):

1. `ld_log "rollback started: <reason>" <log>`; `ld_bootout com.ascend.os <log>` (it skips and logs when
   the label is not loaded); `ld_wait_unloaded com.ascend.os 3001 30 <log>`.
2. `ld_install <TS>/com.ascend.os.plist.bak ~/Library/LaunchAgents/com.ascend.os.plist <log>` (`cmp` equal;
   the logged SHA-256 prefix equals RP9's `.bak` prefix).
3. `ld_bootstrap_guarded com.ascend.os ~/Library/LaunchAgents/com.ascend.os.plist 3001 <log>`, then
   `ld_health com.ascend.os 3001 /Users/oscar/Desktop/ascendSite/ascend/apps/os <log>`. If either
   returns 1, the service is down on the restored configuration: report immediately, do not improvise.
4. (Covered by step 3's `ld_health`: `/login` 200, PID = launchd's, cwd = the Desktop path.)
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

**The first relocation window** (2026-10-01, round 3's contract; `window-transitions` were not yet logged):

| Step | Result |
|---|---|
| W0 | Prechecks passed (gate, live = `.bak`, `.new` SHA-256 = RP9's). The go-ahead was the owner running the script, not a prior chat message; round 4 requires the message |
| W1 | Outage start 12:07:19Z; port 3001 free. The label's state was not checked |
| W2 | Installed the gated `.new` (SHA-256 `83a3b058…`); `cmp` equal; lint OK |
| W3 | `launchctl bootstrap` → `5: Input/output error`; STOPPED; rollback |
| Rollback | Started 12:07:52Z. `.bak` restored (`cmp` equal); bootstrapped; `/login` 200 at 12:07:56Z; PID cwd = Desktop path. RP10's smoke reproduced (39 · 0 · 10). **Outage 37 s** |

**Diagnosis**, with production untouched:
- **The new configuration works under launchd.** A throwaway job (label `com.ascend.relocatetest`,
  port 3249, made from the gated `.new`) started `next` from `/Users/oscar/AscendServe/ascend/apps/os`
  with that cwd.
- **The installed file is not the cause.** Its mode (0600), owner (501:20), extended attributes
  (`com.apple.provenance`) and XML form equal the `.bak` that bootstrapped successfully.
- **Error 5 reproduces when a label is still loaded.** Bootstrapping a still-loaded label returns
  exactly `5: Input/output error` (rehearsal B below).
- **The race did not reproduce with a short-lived job.** Three immediate bootout→bootstrap cycles of
  the throwaway job all succeeded, because its label was already gone when its port freed.
- **No unload timing is available.** The service logs record no shutdown timing.
- **Conclusion:** the teardown race is the leading hypothesis, not a proven cause.

**Round 4 rehearsal.** This is the functions above, extracted from this document, run against the
throwaway job (never the production label). Production was checked before and after: the same PID,
`/login` 200.

| Case | Logged transitions | Result |
|---|---|---|
| A · normal teardown, then W3 | port free → label absent → attempt 1 exit 0 | W1 exit 0, W3 exit 0, serving |
| B · bootstrap while the label is still loaded; it unloads 3 s later | attempt 1 exit **5** → port free, label absent (+3 s) → attempt 2 exit 0 | the single guarded retry succeeds |
| C · W1, the label never unloads (5 s deadline) | deadline reached: port_free=0 label_absent=0 | W1 exit 1, stop before W2 |
| D · W3, the label stays loaded (5 s deadline) | attempt 1 exit 5 → deadline → "no retry; roll back" | W3 exit 1, roll back, no second bootstrap |

The production contract uses 30 s deadlines. C and D shortened them only for the rehearsal.

**Round 4, review round 2 (Codex r1 findings).**

*STICKY-READINESS.* r1's `ld_wait_unloaded` latched each condition once seen, so it could report ready
while the port was occupied again. A replay with mocked checks (the port free only on the first check,
the label absent from the second poll):

| Version | Result |
|---|---|
| r1 | **exit 0 while the port was occupied** (the defect Codex found) |
| r2 | **exit 1** at the deadline, logging `free=1/absent=0`, then `free=0/absent=1`: never both in one poll |
| r2, with both conditions becoming true and staying true | exit 0, logged "ready … in the same poll" |

*TRANSITION-LOG.* W1–W3 and the rollback now run only through `ld_bootout`, `ld_wait_unloaded`,
`ld_install`, `ld_bootstrap_guarded` and `ld_health`, which log every event.

*Full-flow rehearsal* of those functions, extracted from this document. It used a throwaway label
(`com.ascend.relocatetest`) on port 3249, serving a dummy `/login` from two scratch folders ("old" and
"new"), so nothing touched production or its environment. Production was checked before and after:
the same PID, `/login` 200. 55 logged lines:

| Case | Logged sequence | Result |
|---|---|---|
| R1 · happy path | bootout exit 0 → ready (same poll) → install `cmp` equal → attempt 1 exit 0 → health 200, PID = launchd's, cwd new | exit 0 |
| R2 · first bootstrap while the label is still loaded | install → attempt 1 exit **5** → polls → ready at +3 s → attempt 2 exit 0 → health ok | exit 0 |
| R3 · the new config fails health (missing working directory) | install → attempt 1 exit 0 → health `/login 000`, no PID → FAILED → rollback: bootout → ready → install `.bak` → attempt 1 exit 0 → health ok, cwd old | W3 exit 1, rollback exit 0 |
| R4 · W1 deadline (label kept loaded) | poll 0/0/0 → deadline reached, not ready | W1 exit 1, nothing installed |

**What re-runs after round 4 is promoted** (the deploy pin is round 4's commit, with the full aggregate
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
