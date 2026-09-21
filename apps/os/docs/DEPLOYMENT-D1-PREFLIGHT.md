# Production deployment pre-flight — bringing the application forward to schema 009

**Status: PRE-FLIGHT ONLY. NOTHING DEPLOYED.** The live build, the service and the database were not
changed. No push. 2A not begun.

**Candidate release:** the committed tree at `43eec93` (plus, if authorized, the commit adding
`scripts/deploy-smoke.mjs` — scripts only; §4 shows how to prove runtime identity).
**Scope:** bring production up to the accepted application state and nothing else — no 2A, no
migration 010, no R2, no B2, no cleanup.

---

## 0 · Two corrections this pre-flight produced

> ### ⚠️ CORRECTION — Slice 1C is ALREADY DEPLOYED (contradicts `43eec93`)
>
> Commit `43eec93` recorded, at owner instruction, that because the running build predates the 1C
> commit, "Slice 1C is also undeployed". **The build's contents say otherwise.** Every one of the five
> selectors 1C added to `app/globals.css` is in the running build's CSS; the 1C rule blocks are
> **byte-identical** to the candidate's (digest `992c2ad5494c27f7` in both); and both markup hooks
> (`ascend-wipe-bar`/`-targets`, `ascend-public mx-auto`) are present.
>
> So the running build was produced from a **working tree that already contained 1C**, about 23 hours
> before 1C was committed. The ordering in `43eec93` is right — `ce59417` is the last commit before
> the build — but the inference from it is wrong. **A commit timestamp is not evidence of what a build
> contains.** The runtime-changing undeployed work is therefore **D1a and D1b.1 only.**
>
> Not yet written into the D1b.2 execution contract; §11 asks whether to add it as a second dated
> correction there.

> ### ⚠️ CORRECTION — an instrument that measured nothing
>
> This Mac has **no `timeout` command**. Every `timeout N grep … | wc -l` returned 0 because the
> command failed silently. Two earlier measurements used it: the "bounded" re-check during the D1b.2
> pre-flight, and D1b.2 pre-commit check 9. **Neither measured anything.**
>
> **The conclusion they were cited for is nonetheless true**, from two valid sources: the original,
> un-timed D1b.2 scan (`matches: 0`), and this pre-flight's re-run with positive controls — the
> running build contains **0** files naming `archived_at`, while controls `withProspectDb` (92) and
> `listProspects` (174) are found. Every absence count below is paired with a positive control.

---

## 1 · Exact current production state

| | |
|---|---|
| Service | launchd `com.ascend.os`, **KeepAlive**, RunAtLoad, ThrottleInterval 10, 29 runs, last exit 143 (SIGTERM) |
| Command | `/usr/local/bin/node …/apps/os/node_modules/.bin/next start -H 127.0.0.1 -p 3001` |
| Working directory | **`/Users/oscar/Desktop/ascendSite/ascend/apps/os` — the git working tree itself, inside iCloud Drive** |
| Runtime | Node **v24.12.0**, Next **16.3.0** (`next-server (v16.3.0)`) |
| Environment | plist: `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, PATH. Everything else from `.env.production.local` (12 keys; `ASCEND_PROSPECT_SOURCE=postgres`) |
| Process | PID **36325**, started **2026-09-18 04:18:54**, RSS 67 MB |
| Build | `.next/BUILD_ID` = **`G_Q7DayTK3-h1oZSv1N1U`** (2026-09-18 04:18:54); 684 MB; contains **3,696 iCloud duplicate files** (inert — Next loads by manifest name) |
| Build contents | pre-D1a promotion (`promotion_id`: 8 files) · 0 D1a/D1b markers · **Slice 1C present** (§0) |
| Endpoint | **`127.0.0.1:3001` only.** No domain, no tunnel (`cloudflared` absent) |
| Health | `/` 307→`/login` · `/login` 200 · `/sales` 307 unauthenticated |
| Recent errors | only `destination stream closed early` (client aborts; benign). Older entries include 39× "Could not find a production build" and 2× missing `middleware-manifest` — the signature of past in-place builds under a running service — and one iCloud-class `scandir … Unknown system error -11` |
| **Live schema** | **009** — re-verified read-only this pre-flight with the accepted matrix: **51 / 51**, ledger head `009_prospect_archival.sql`, 0 archived, events 22,811 |

**Build/start commands today:** `npm run build` (`next build --turbopack`) in `apps/os`, then
`launchctl kickstart -k gui/501/com.ascend.os`. The single database contact in this pre-flight was
that read-only matrix run.

---

## 2 · Undeployed commit range — `ce59417..43eec93`

| Commit | Subject | Class | Runtime behaviour change? |
|---|---|---|---|
| `6cb91d2` | Slice 1C | **UI-only** (CSS + two className hooks) | **No — already in the running build** (§0) |
| `e95e3bd` | R1a | recovery/tooling-only | **No.** Removes `core/db/backup.ts` from the `core/db` barrel, but no served code ever called it (0 callers at `ce59417`). Adds a **dev**Dependency and an npm script. `core/recovery/*` is imported by no served entrypoint |
| `dd46b95` | R1b | recovery-only (`manifest.sql`) | No |
| `680d94e` | R1c | recovery-only (`restore.ts`) | No |
| `1fca27f` | map | documentation-only | No |
| **`4276f89`** | **D1a** | **database/application behaviour** | **YES** — promotion, deletion and URL intake become source-correct |
| **`eb0f8b6`** | **D1b.1** | **database/application behaviour · schema-dependent (009) · security via 009's grants/RLS** | **YES** — archival, active-set reader, advisory lock, Archive UI |
| `326a407` | D1b.2 | docs + ops scripts | No |
| `fad74f6` | map | documentation-only | No |
| `43eec93` | correction | documentation-only | No |

**No commit in the range touches** `core/auth`, `lib/route-guard.ts`, `lib/auth.ts`, `middleware.ts`,
`instrumentation.ts`, `next.config.ts`, the capability map or the route-authorization map. **No runtime
dependency changes**; `node_modules` matches the lockfile at HEAD.

**The deployment is D1a + D1b.1**, 28 runtime files: three prospect API routes, the prospect page,
`ArchiveProspectButton` (replacing `DeleteProspectButton`), `PromoteButton`, `core/crm/{archive,client,
index,promote,prospect,source}`, `core/db/{index,migrate,prospects}`, `core/intake/import`,
`core/vault/{io,markdown}`, `packages/domain/events`.

---

## 3 · Schema / code compatibility

| Claim | Evidence |
|---|---|
| **Old app is compatible with 009** | It has served against 009 continuously since D1b.2 applied it. Its build names `archived_at` in **0** files (positive controls found). 009 is additive and nullable; its one policy change only narrows sales UPDATE on **archived** rows, of which there are 0 |
| **Candidate expects 009** | Names `archived_at` in 10 server files, `archived_at IS NULL` in 9. Every test suite runs it against 001–009 (`gate:db` 496 passed) |
| **Candidate expects nothing beyond 009** | `MIGRATIONS` ends at `009_prospect_archival.sql`; no `010_*` exists; `verifyChecksums` is clean |
| **Candidate's readers work on PRODUCTION's actual schema** | R1c (D1b.2) restored the post-009 **production** artifact onto 17.6 and ran the candidate's own `listProspects` (with the active-set filter), `readEvents`, `listProspectNotes`, `credentialFor`, `resolvePrincipal` against it through the real `pg` driver: 3,108 / 22,811 / all passing, both legs. F2 proved that restore's schema equals production's |
| **009 ledger/checksum still correct** | Re-verified today: 51 / 51, recorded checksum `f1c3b225…0cd7062d`, not backfilled |

---

## 4 · Build proof — candidate built in isolation

Built from **`git archive HEAD`** (exactly the committed tree — nothing untracked, nothing
iCloud-generated), with `node_modules` as an **APFS clone** of the live one (no network, live copy
untouched), in a scratch directory **outside iCloud**, with **no production env file present**.

| Requirement | Result |
|---|---|
| Clean typecheck | `tsc --noEmit` exit **0** |
| Production build | `next build --turbopack` exit **0** — compiled in 2.8 s; all routes dynamic (`ƒ`); 3 static pages, none touching the database |
| No missing runtime env | The code references **no `NEXT_PUBLIC_*`**, so nothing environment-specific is inlined. Server env is read at `next start` from `.env.production.local`, which holds all 12 keys. `instrumentation.register` runs at server start, not at build |
| No iCloud duplicates enter the release | **0** in the candidate `.next` (live has 3,696) |
| New D1 paths bundled | `archived_at IS NULL` 9 · `pg_advisory_xact_lock` 5 · `already_archived` 12 · `archived_prospect` 4 · `promoted_from_prospect_id` 29 · `assertVaultProspectWritable` 19 · Archive copy 2 |
| Stale pre-D1 paths absent | `promotion_id` **0** (live: 8) · D1a's interim refusal string **0** |
| Build did not contact production | no production env present; build log has 0 lines mentioning 3001 / `ECONNREFUSED` / fetch |
| Warnings | 12, **one class**: "dynamic filesystem access causes tracing of the whole project". All **pre-existing** (`admin/wipe` unchanged; `migrate.ts:64` and the `client.ts` sites predate the range). They affect `output: "standalone"` only; this app has none and `next start` reads from disk |

**A built `.next` is not relocatable.** `required-server-files.json` embeds the build directory's
absolute path. The proof build therefore **cannot** be moved into production: the release must be
built where it will be served (§5).

**Runtime identity if the smoke script is committed first:** `git diff --stat 43eec93..<new HEAD> --
app components core lib packages middleware.ts instrumentation.ts next.config.ts package.json
package-lock.json` must be empty.

**Live build untouched by this pre-flight:** 5,348 files identical by path, size and mtime; same
`BUILD_ID`; same PID.

---

## 5 · Deployment method

### Today's mechanism, and why it is not used as-is

`npm run build` **in the served directory**, then `kickstart -k`. It is **not atomic** and **destroys
the old build**: the build rewrites `.next` underneath the running process, and KeepAlive restarts
`next start` into a half-written `.next`. That is exactly the 39× "Could not find a production build"
already in the error log. It leaves **no rollback artifact**. It builds from whatever the working tree
holds, which is how a build came to contain uncommitted 1C with no commit identity.

### Proposed procedure — same location, same commands, made safe

Three changes, none of which alter the service configuration:

1. **stop the service cleanly** with `bootout`, so KeepAlive cannot restart it into a half-built `.next`;
2. **clone the old build out first**, giving an instant rollback that lives outside the repo and iCloud;
3. **build only from a clean, committed tree**, recording commit ↔ `BUILD_ID`.

```bash
cd /Users/oscar/Desktop/ascendSite/ascend/apps/os
TS=$(date -u +%Y%m%dT%H%M%SZ); D="$HOME/AscendDeploy/$TS"; mkdir -p "$D"; chmod 700 "$HOME/AscendDeploy" "$D"

# ── P · pre-deploy snapshot (§6) and authenticated BASELINE smoke on the OLD build ──
test -z "$(git status --porcelain)" && git rev-parse HEAD | tee "$D/commit"
node --experimental-strip-types scripts/verify-migration-009.mjs            # must be 51/51
node scripts/deploy-smoke.mjs --baseline --record "$D/baseline.json"         # owner types email

# ── R · rollback artifact, taken while the old service is still serving ──
cp -Rc .next "$D/next-rollback-$(cat .next/BUILD_ID)"                        # APFS clone; fails loudly on any dataless file → ABORT, nothing changed

# ── DOWNTIME STARTS ──
launchctl bootout gui/501/com.ascend.os                                      # KeepAlive cannot restart it
! lsof -nP -iTCP:3001 -sTCP:LISTEN                                           # must be free

# ── B · build in place, from the clean committed tree ──
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  ./node_modules/.bin/next build --turbopack 2>&1 | tee "$D/build.log"      # must exit 0
cat .next/BUILD_ID | tee "$D/build_id"                                       # must differ from G_Q7DayTK3-h1oZSv1N1U
#   bundle markers (§4), each WITH a positive control, and duplicate count — recorded in $D

# ── S · start ──
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist
until curl -sf -o /dev/null http://127.0.0.1:3001/login; do sleep 1; done    # bounded to 60 s in practice
# ── DOWNTIME ENDS ──

node scripts/deploy-smoke.mjs --post --since "$D/baseline.json"             # owner types email; must be all-pass
```

| Question | Answer |
|---|---|
| Build directory | `apps/os/.next` — unchanged location; it has to be, because `.next` embeds its path |
| Restart / reload | `launchctl bootout` then `launchctl bootstrap`. **Not** `stop` (KeepAlive restarts within a second) and **not** a bare `kickstart -k` over an in-place build (the historical crash loop) |
| Atomic? | **No, and it doesn't pretend to be.** It trades an *undefined* partial state for a *defined* outage: nothing listens during the build. The isolated build measured **7 s wall time** (log file born→last write). Expected total downtime **under a minute**, budgeted at 2 min; loopback-only, single user |
| Old build | cloned to `~/AscendDeploy/<TS>/next-rollback-G_Q7DayTK3-h1oZSv1N1U` before anything stops. Outside the repo (no dirty tree) and outside iCloud |
| Files that change | `apps/os/.next/` (replaced). New: `~/AscendDeploy/<TS>/` (commit, baseline, rollback clone, build log, build id). **Nothing tracked by git, no source, no plist, no env file, no `node_modules`, no database object** |
| Processes that change | PID 36325 ends; one new `next-server` under the same launchd job |

**iCloud caveat.** Building in place inside iCloud cannot guarantee zero duplicates: iCloud may add
`… 2.js` copies to the new `.next` as it syncs. They are **inert**, because Next loads by manifest name.
The procedure measures them right after the build and again after the smoke. The structural fix —
serving from outside iCloud — changes the service's location and is **outside this deployment's scope**
(§11, decision 3).

---

## 6 · Pre-deploy snapshot — required evidence

| Evidence | How | Expected |
|---|---|---|
| Current HEAD | `git rev-parse HEAD` | the accepted candidate |
| Working tree clean | `git status --porcelain` | empty |
| Production schema ledger | `scripts/verify-migration-009.mjs` | **51 / 51**, head 009 |
| Current process | `ps -o pid,lstart` | PID 36325, 2026-09-18 04:18:54 |
| Current build | `.next/BUILD_ID` | `G_Q7DayTK3-h1oZSv1N1U` |
| Health | `deploy-smoke.mjs --unauth-only` | S1–S3 pass |
| Authenticated baseline | `deploy-smoke.mjs --baseline --record` | A/D checks pass; **B2, B3, B4 fail as expected** — the proof the D1 checks discriminate |
| Recovery artifact | `shasum -c …post-009.ascbk.sha256` | OK (`5958f3fc…`) |
| Counts | recorded in `baseline.json` | events 22,811 · prospects 3,108 · archived 0 · notes 0 · users 1 |

**No new database backup is required.** The deployment changes no persistent state: no migration, and
the smoke writes nothing, which D4/D5/P1/P2 prove. The post-009 artifact remains current.

---

## 7 · Post-deploy smoke matrix — frozen in `scripts/deploy-smoke.mjs`

Written and exercised **before** deployment. Its unauthenticated section passes against the live build
today (S1–S3).

| id | Check | Mutation-free because |
|---|---|---|
| **AUTH / SHELL** | | |
| S1 · S2 | `/login` 200; `/` 307 → `/login` unauthenticated | GET |
| S3 | **1C** · the stylesheet the page links carries all five 1C selectors | GET |
| A1 | login succeeds, issues `ascend_os_session` | sessions are stateless HMAC tokens; login only reads |
| A2 | **owner principal** — `/admin` (demands `admin:*`) 200 | GET |
| A3–A9 | `/`, `/galaxy`, `/sales`, `/partner`, `/crm`, `/tasks`, `/signals` 200 | GET; each page checked for write calls: none |
| A10 | `/search` → **307, `Location: /console`** *(corrected — see below)* | GET |
| A11 | `/console` 200 *(added — see below)* | GET |

> ### ⚠️ WITNESSED SMOKE-SPECIFICATION DEFECT (2026-09-21, owner-authorized) + one bounded coverage addition
>
> As frozen, A10 expected `/search` → 200. The pre-deploy baseline on the old build returned **307**,
> and that is the correct, healthy behaviour: `/search` is a deliberate permanent redirect to `/console`
> (`app/search/page.tsx`, since `4c21aaa`, 2026-08-14), kept so bookmarks still resolve. It predates the
> undeployed range, and neither `/search` nor `/console` changed in the candidate. Left as frozen, A10
> would have failed after deployment and met the rollback trigger for a route working as designed —
> which is why it was caught and corrected **before** the outage.
>
> A10 now asserts the redirect. **A11 is one added check** on the redirect's real destination,
> `/console`, which owns command invocation and the mutation confirm gate. **No other expectation in
> the matrix was changed.**
| **SALES / D1** | | |
| B1 | an **active** prospect's page loads under 009 | ref chosen read-only, held in memory, never printed |
| B2 | the **Archive** action is present | GET |
| B3 | **no ordinary "Delete"** action remains | GET |
| B4 | `DELETE` on a **non-existent** ref → 404, `store:"postgres"`, `changed` all none — the source-correct path, no vault unlink | the resolver refuses before any write |
| B5 | `POST …/promote` on a **non-existent** ref → 404, `refused`/`prospect_not_found`, store postgres *(post-deploy only)* | the resolver refuses before any write |
| — | **URL intake is NOT probed live** | it fetches the URL and may call PageSpeed before refusing, and **on the old build it writes a vault file**. Evidenced by D1a M11 (`createProspect` refuses in Postgres mode) and the bundle (`assertVaultProspectWritable` 19 files) |
| **NOTHING MOVED** | | |
| D1 | ledger head 009, 9 rows | read-only |
| D2 · D3 | **0 prospects archived**; active = total | read-only |
| D4 · D5 | no event appended, prospects/notes unchanged **during** the smoke | counts + `max(seq)` before/after |
| D6 | vault hit list (names **and bytes**) and CRM folder unchanged | hashed before/after |
| D7 | no `archived_at` / "does not exist" error logged | new error-log bytes only |
| P1–P4 | **across the whole deployment**: events, prospects/notes/users, vault, error log unchanged since the baseline | compared with `baseline.json` |

**Never done:** archive, promote a real prospect, delete, import, call URL intake, load a page that
reconciles on read.

---

## 8 · Failure plan

**Rollback is safe**, because the old build is proven schema-009-compatible (§3):

```bash
launchctl bootout gui/501/com.ascend.os
mv .next "$D/next-failed-$(cat .next/BUILD_ID 2>/dev/null || echo none)"
cp -Rc "$D/next-rollback-G_Q7DayTK3-h1oZSv1N1U" .next
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist
# verify: BUILD_ID == G_Q7DayTK3-h1oZSv1N1U, /login 200, deploy-smoke --unauth-only passes
```

One semantic caveat, and it doesn't arise in this plan: the old build does not filter archived
prospects. If anything were archived by the new build before a rollback, the old build would show it as
active again. The smoke archives nothing, and A4 remains unauthorized.

| Condition | Action |
|---|---|
| **Build fails** (non-zero exit, or no new `BUILD_ID`) | **Do not bootstrap the new build.** Restore the rollback clone, bootstrap, verify. Report |
| **Service will not start** (bootstrap error, nothing on 3001 in 60 s, or crash-loop lines in the error log) | Rollback. Report |
| **Login fails** (A1) | Rollback. It is most likely env or perimeter, not data; investigate on the old build |
| **`/sales` or a prospect page fails** (A5, B1) | Rollback. Capture new error-log lines, redacted |
| **Schema mismatch** (D1 ≠ 009, or `column … does not exist` logged) | **STOP.** Rollback. Should be impossible after §6; if it happens, production changed underneath, and that is an owner-review incident |
| **Unexpected production write** (D4/D5/P1/P2 differ) | **STOP immediately.** Rollback the code, then establish read-only what changed. Do not "fix" data |
| **Old D1 behaviour still observable** (B2–B5 fail post-deploy, or `promotion_id` in the new bundle) | **STOP.** The old build is being served. Check `BUILD_ID` and process start time before anything else; never re-run blindly |
| **Bounded defect in the new build** | **Rollback first** (seconds), then fix on the branch and repeat this pre-flight. Never hand-edit `.next`, never patch production SQL |

---

## 9 · Deployment scope

**In:** D1a + D1b.1 runtime code, plus the already-live 1C. Built from the committed tree.
**Out:** 2A, migration 010, R2, B2, service relocation out of iCloud, removal of iCloud duplicates from
the old build, RT-1, any cleanup. The old build is kept, not deleted.

---

## 10 · What this pre-flight changed

- **Repository:** `43eec93` (the authorized baseline correction), plus this document and
  `scripts/deploy-smoke.mjs`, both **uncommitted**.
- **Production:** nothing. One read-only matrix run (51/51); three unauthenticated GETs to the live
  service.
- **Outside the repo:** a scratch build in the session scratchpad (`git archive` tree, cloned
  `node_modules`, isolated `.next`), and memory notes. No production file, service or database object
  touched.

---

## 11 · Owner authorization still required

| # | Decision | Recommendation |
|---|---|---|
| **1** | **Authorize the deployment (A3)** using the §5 procedure | Yes, when you are at the keyboard. The smoke needs your email at a silent prompt, twice |
| **2** | **Accept a brief outage** — build measured 7 s in isolation; budget 2 min (loopback, single user) | Yes. A defined outage is safer than serving a half-built `.next` |
| **3** | **iCloud location** | **(a) Accept for this deployment**, and track moving the service out of iCloud as its own slice. (b) `.next` → `.next.nosync` symlink, which is unproven with Next 16 and not recommended untested. (c) Relocate first, which is out of scope |
| **4** | **URL-intake evidence** | **Accept M11 + bundle evidence.** A live probe needs a real public URL: outbound traffic and possibly PageSpeed quota |
| **5** | **Commit `scripts/deploy-smoke.mjs` (and this document) before deploying**, so the deployed tree is clean and the smoke is frozen in git | Yes. It is scripts/docs only; §4 gives the runtime-identity check |
| **6** | **Second dated correction** to the D1b.2 execution contract: 1C **is** deployed (§0) | Yes. The `43eec93` text is now contradicted by build contents |
| **7** | **Where deployment records live** — `~/AscendDeploy/<TS>/` (0700, outside repo and iCloud) | Yes |

**STOPPING BEFORE DEPLOYMENT.**
