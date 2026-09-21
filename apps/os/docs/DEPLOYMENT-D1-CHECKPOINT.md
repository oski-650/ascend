# Production deployment — D1a + D1b.1 onto schema 009

**Status: DEPLOYED 2026-09-21.** Dependency D1 is COMPLETE **and** DEPLOYED.
Pre-flight: `docs/DEPLOYMENT-D1-PREFLIGHT.md`. Record: `~/AscendDeploy/20260921T064008Z/` (0700; no
secrets, no email).

---

## Result

| | |
|---|---|
| Pre-flight artifact commit | `dae1d45` |
| **Deployed candidate** | **`ba648d3`** — runtime tree byte-identical to the proven `43eec93` (empty diff across `app`, `components`, `core`, `lib`, `packages`, `middleware.ts`, `instrumentation.ts`, `next.config.ts`, `package*.json`, `tsconfig.json`) |
| Build ID | `G_Q7DayTK3-h1oZSv1N1U` → **`2NCS2fCKGRoKqk3tUd4F8`** |
| Process | PID 36325 (up since 2026-09-18 04:18:54) → **PID 18362** (2026-09-21 00:12:45 local), launchd `runs = 1` |
| **Outage** | **8 s** — 07:12:39Z → 07:12:47Z |
| Build | exit 0, 6 s, in the served location from the clean committed tree; 12 pre-existing tracing warnings, 0 errors |
| Pre-deploy smoke | **22 / 22 non-D1 checks passed**; B2, B3, B4 failed **only** in their expected old-build modes |
| **Post-deploy smoke** | **30 / 30 passed** — B2, B3, B4 flipped to PASS; B5 passed |
| Schema | 009 before and after — accepted matrix **51 / 51** both times |
| Rollback | **not used**; clone of the old build retained |

## Order followed

1. Pre-deploy record and schema matrix (51/51).
2. Pre-deploy smoke on the old build; baseline recorded.
3. Rollback clone of the old `.next`, taken **while the old service was still serving**.
4. `launchctl bootout` — port 3001 free, old PID gone. **No build ran while the service was live.**
5. `next build --turbopack` in the served location, from the clean committed tree.
6. Build success required: exit 0, new `BUILD_ID`.
7. `launchctl bootstrap`.
8. Healthy startup: `/login` 200.
9. Served-build verification, then the post-deploy smoke.

## The candidate is what is serving

Measured on the **served** `.next`, each absence count paired with a positive control:

| | Served | Proven candidate |
|---|---|---|
| control `withProspectDb` / `listProspects` | 27 / 48 | 27 / 48 |
| `archived_at IS NULL` | 9 | 9 |
| `pg_advisory_xact_lock` | 5 | 5 |
| `already_archived` | 12 | 12 |
| `promoted_from_prospect_id` | 29 | 29 |
| `assertVaultProspectWritable` | 19 | 19 |
| **old `promotion_id`** | **0** | 0 |
| 1C selectors in served CSS | 5 / 5 | 5 / 5 |
| iCloud duplicates in the new `.next` | 0 | 0 |

## Post-deploy acceptance smoke — 30 / 30

| | |
|---|---|
| Shell · S1–S3 | `/login` 200 · `/` → `/login` · the linked CSS carries all five 1C selectors |
| Auth · A1–A11 | login · owner principal (`/admin`) · `/`, `/galaxy`, `/sales`, `/partner`, `/crm`, `/tasks`, `/signals` 200 · `/search` 307 → `/console` · `/console` 200 |
| **D1 · B1–B5** | active prospect page 200 under 009 · **Archive present** · **no "Delete"** · `DELETE` on a non-existent ref → 404, `store:postgres`, `not_found`, nothing touched · `promote` on a non-existent ref → 404, `refused`, store postgres |
| Nothing moved · D1–D7 | ledger 009 · 0 archived · 3,108/3,108 active · events 22,811 → 22,811 · prospects/notes unchanged · vault unchanged · 0 new error-log bytes |
| Across the deployment · P1–P4 | events, prospects, notes, users, vault and error log all reconcile with the pre-deploy baseline |

## Mutation accounting

**Zero production mutation outside the application release itself.**

| | Before | After |
|---|---|---|
| events (and `max(seq)`) | 22,811 | 22,811 — unchanged |
| prospects / active / archived | 3,108 / 3,108 / 0 | 3,108 / 3,108 / 0 |
| `prospect_notes` / users | 0 / 1 | 0 / 1 |
| vault hit list (names + bytes) and CRM folder | digest | same digest |
| error log | 15,981 B | 15,981 B |

No real prospect was promoted, archived, deleted or imported, and URL intake was not called.

**URL intake** is covered by D1a's M11 behavioural test (`createProspect` refuses while Postgres owns
prospects) and by the deployed bundle (`assertVaultProspectWritable` in 19 server files). It was
**not** live-probed, by owner decision, because the route fetches the operator's URL before refusing.

## Deviations, each recorded rather than smoothed over

1. **Baseline attempt 1 crashed on the client side.** The login POST hit `write EPIPE`: during the
   in-script silent prompt, the server's 5 s keep-alive timeout closed the idle socket left from the
   S1–S3 requests, and `fetch` reused it. No production effect. The retry supplied the email through
   the script's documented `ASCEND_SMOKE_OWNER_EMAIL` input, read silently by the shell first, so there
   was no idle gap. The script was unchanged.
2. **A10 was a smoke-specification defect**, caught before the outage. `/search` is a deliberate
   permanent redirect to `/console`, so a 307 is healthy. It was corrected and one check (A11,
   `/console` 200) was added by owner authorization in `ba648d3`, and the baseline was re-run from the
   start. No other expectation changed.

## Rollback status

**Not used.** The old build is retained at
`~/AscendDeploy/20260921T064008Z/next-rollback-G_Q7DayTK3-h1oZSv1N1U` (5,878 files, APFS clone), and it
remains a valid rollback target because it is proven compatible with schema 009. Rollback procedure:
`docs/DEPLOYMENT-D1-PREFLIGHT.md` §8. The owner decides when it is removed.

## Carried

1. **RT-1** — three R1b/R1c recovery assertions assume every prospect is active. Must be fixed before,
   or with, the first real production archival (`docs/RECOVERY-RUNBOOK.md` §7).
2. **Sales archival** still not witnessed against a production sales principal, because none exists.
3. **Production serves from inside iCloud Drive**, out of the development working tree. Accepted for
   this deployment only. Recorded as a **separate infrastructure slice**: move serving and build state
   outside iCloud and out of the working tree, so a build cannot come from uncommitted files and cannot
   collect duplicates or evictions. Not mixed with D1.
4. **Build provenance.** The previous build had no commit identity: it contained uncommitted Slice 1C.
   This deployment records `ba648d3 ↔ 2NCS2fCKGRoKqk3tUd4F8`. That pairing should become standard.
5. **The smoke's in-script email prompt** is subject to a keep-alive race. Use the documented
   `ASCEND_SMOKE_OWNER_EMAIL` input, read silently by the shell.
