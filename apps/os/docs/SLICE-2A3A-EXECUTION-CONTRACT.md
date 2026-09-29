# Slice 2A.3a — production rollout of migration 010 and the promoted Sales stack · EXECUTION CONTRACT

**Status: FROZEN, NOT EXECUTED.** Written without production access (2A.3a-1). Execution is task 2A.3a-2:
owner-run, owner-authorized, and it follows this document step by step. No step may be improvised; a
condition this contract does not cover is a STOP.

## 0 · Scope: what goes live, and nothing else

- **Migration:** `core/db/schema/010_sales_actions.sql`, SHA-256
  `5cb6802a5acd4d353bac785a962ed4779ca2dd59a2dd5bff64892c19afa9bbb5`. This equals `L010` in
  `core/recovery/profile-registry.ts`, and `tests/architecture/rollout-010.test.ts` holds the two
  together.
- **Application:** the promoted baseline as it stands at authorization: every commit from the serving
  D1 build `ba648d3` to that SHA (2A.1c through 2A.2e, the gate and proof infrastructure, and this
  contract).
  - **Pin (filled at T0, not before):** deploy SHA `<to be recorded>`, tree `<to be recorded>`.
  - It must be a promoted Coordinator baseline, and it must have a green full aggregate (§3).
- **Not included:** any 2A.3b–e behaviour (priority, pipeline, notes, promotion changes), any other
  migration, any configuration change, iCloud relocation (I1), and any data change.
- **Correction carried from the 2A.3 pre-flight:** promotion does NOT bypass the stage command.
  `markProspectPromoted` (`core/db/prospects.ts:517`) already changes the stage through
  `ascend_transition_stage(…, 'promotion', …)`.

## 1 · Tools this contract adds (reviewed in 2A.3a-1)

| Tool | Default | Write path |
|---|---|---|
| `scripts/apply-migration-010.mjs --check --record <pre.json>` | read-only session (`default_transaction_read_only=on`) | none; writes the counts-and-catalog record, mode 0600 |
| `scripts/apply-migration-010.mjs --apply-to-production --service-stopped --since <pre.json>` | refuses without all three flags | applies 010 alone, in one transaction, via the real `applyMigrations` |
| `scripts/verify-migration-010.mjs --since <pre.json>` | `BEGIN READ ONLY` | none |
| `scripts/deploy-smoke.mjs --baseline/--post [--partner]` | read-only DB reads; HTTP probes use an impossible prospect | none (checked by D4/D8) |

The migration scripts run **from `apps/os`**, because `loadMigrations` resolves `core/db/schema` from
the working directory.

**Rehearsed on PostgreSQL 17.6** with the real scripts' exported checks and the real
`applyMigrations`:
- The 001–009 model's catalog equals production's post-009 verification exactly: 8 tables,
  78 columns, 27 indexes, 45 constraints, 22 policies, 30 column grants.
- Preconditions passed, 010 applied, and the matrix passed **51/51**.
- **Negative controls:** a database already at 010 is refused. A widened sales grant plus a stray
  row fail V19, V20, the grant delta and the data checks.

The smoke's new probes were run against the candidate on a fixture server, and each gave the answer
the smoke expects:
- C1–C4: 200 with the expected markers;
- C5–C7: `404 prospect_not_found`;
- R3: no owner controls for the partner;
- R4: `403`;
- R5: the "Not available" denial.

After the probes, receipts, contacts, follow-ups, transitions and events were all 0.

## 2 · Why migrate and deploy must be ONE stopped-service window

010 changes more than it adds (`010_sales_actions.sql` §7 and §9):

| 010 change | Line | Effect on the serving D1 build (`ba648d3`) |
|---|---|---|
| `REVOKE UPDATE (status, assigned_to, first_contact, last_contact) ON prospects FROM ascend_sales` | 222 | sales loses direct stage, assignment and contact-date writes |
| `REVOKE UPDATE ON prospects FROM ascend_owner` plus 27 column grants without those four | 227–228 | the owner loses them too |
| trigger `prospects_status_has_transition` | 399 | any status change without a transition record raises `42501` |

- **The D1 build breaks under 010.** Its promotion marks the prospect with
  `UPDATE prospects SET status = 'closed-won', last_contact = current_date`
  (`ba648d3:core/db/prospects.ts:523`), which is denied. The vault client files would already have
  been written, so the result is a partial promotion.
- **D1's other write paths survive 010:**
  - `website_opportunity` / `assessed_by` / `assessed_at` (assessment);
  - `archived_at` / `archived_by` (archive);
  - `website` (research);
  - `prospect_notes` inserts.

  All of these columns stay granted (V19, V21).
- **The promoted build cannot run on 009.** Its Sales reads query the four 010 tables.
- **Environment:** the promoted build references no environment name the D1 build does not
  (measured over `app`, `core`, `lib`, `components`, `instrumentation.ts`, `proxy.ts` and
  `middleware.ts`).

Therefore:
- the service is stopped BEFORE 010 is applied, and started only on the new build after verification;
- **the D1 `.next` rollback clone is not a valid rollback once 010 is committed.** It serves reads, but
  its promotion fails. From T7 onwards, rollback means forward-fix or the §6 restore.

## 3 · Preconditions (all before T0; any failure is a STOP)

| # | Condition | Evidence |
|---|---|---|
| P1 | The deploy SHA is a PROMOTED Coordinator baseline, and `verify` is OK | `npm run agent -- verify` |
| P2 | **Full aggregate green on the exact deploy tree**: static, server, db and recovery phases, including owner R1b/R1c, through `prove <task> --owner`. A selected-phase freeze is not enough here | `node scripts/gate-proof.mjs aggregate` exit 0 for that tree |
| P3 | The serving tree (main checkout `apps/os`) is clean, at the deploy SHA, with **`apps/os/next.config.ts` reverted** (the uncommitted `allowedDevOrigins` edit) | `git status --porcelain` empty; `git rev-parse HEAD` = pin |
| P4 | No iCloud duplicates (`* 2.*`, `* 3.*`) in the serving tree's source or `.next` | `find . -name '* [0-9].*' -not -path './node_modules/*'` is empty |
| P5 | No other session, dev server or agent is using the main checkout; only `com.ascend.os` holds 3001 | `lsof -iTCP:3001 -sTCP:LISTEN` shows only the launchd PID |
| P6 | Backup key present (0600); `pg_dump` 18.6 at `/opt/homebrew/opt/libpq/bin`; `~/AscendPg17` build intact | runbook §2–§3 |
| P7 | A worktree at **`8ef09f5`**, clean, with `node_modules`. That commit is the last whose `core/db/schema` ends at 009, it carries the `post-009-v1` profile, and its `backup-production.sh` writes `ascend-backup/3` with the A5 ledger guard | `git -C <wt> rev-parse HEAD` |

**Why P7:** `backup-production.sh` A5 (lines 121–125) refuses unless production's ledger equals every
file in `core/db/schema`. A 010 tree therefore refuses, correctly, to back up 009 production. A5 is
not weakened. The backup of 009 production is taken from a tree that describes 009.

## 4 · The sequence

Record every step's output (counts, hashes and pass/fail only) in `~/AscendDeploy/<TS>/`, mode 0700.

| Step | Action | Pass condition | On failure |
|---|---|---|---|
| **T0** | Owner authorization recorded, naming deploy SHA and tree, window start, and decisions D2–D5 (§8) | — | no authorization, no T1 |
| T1 | Pre-deploy smoke on the OLD build: `node scripts/deploy-smoke.mjs --baseline --record ~/AscendDeploy/<TS>/baseline.json [--partner]` | S/A/B/D checks pass; C1–C7 and R2–R4 **fail as expected** (the discrimination proof); no UNEXPECTED-PASS | STOP; nothing has changed |
| T2 | Fresh backup of 009 production, from the P7 worktree: `./scripts/backup-production.sh --read-production --key-file <key> pre-010` | sealed `ascend-backup/3`; ledger 001–009; manifest equal before and after | STOP; nothing has changed |
| T3 | Prove it (runbook §4–§5): `npm run recovery:verify -- --artifact <T2> --owner-email-prompt --only-artifact` (R1b), then `./scripts/recovery-verify.sh --artifact <T2> --r1c-root ~/.ascend-r1c/<TS> --owner-email-prompt` (two-leg R1c on 17.6; the root holds a private, byte-verified copy of the `~/AscendPg17` build). `ascend-backup/3` takes no `--legacy-contract` | every test passed, none skipped | STOP. Without a proven recovery point there is no migration |
| T4 | `node --experimental-strip-types scripts/apply-migration-010.mjs --check --record ~/AscendDeploy/<TS>/pre-010.json` | all preconditions `[ok]`; record written | STOP; nothing has changed |
| T5 | Rollback clone of the serving `.next` (`cp -Rc`) while still serving. Valid only until T7 | clone present | STOP |
| T6 | **Outage starts:** `launchctl bootout gui/501/com.ascend.os` | port 3001 free; old PID gone | STOP; bootstrap the old build |
| T7 | `node --experimental-strip-types scripts/apply-migration-010.mjs --apply-to-production --service-stopped --since ~/AscendDeploy/<TS>/pre-010.json` | `APPLIED`; ledger row checksum = pin; not backfilled | before commit: rolled back, nothing to undo; bootstrap the OLD build and STOP |
| T8 | `node --experimental-strip-types scripts/verify-migration-010.mjs --since ~/AscendDeploy/<TS>/pre-010.json` | **0 failed** | §6 row "committed, verification fails" |
| T9 | Build in place from the clean committed tree: `next build --turbopack` | exit 0; new `BUILD_ID` | §6 row "build fails" |
| T10 | **Outage ends:** `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist` | `/login` 200 | §6 row "does not start" |
| T11 | `node scripts/deploy-smoke.mjs --post --since ~/AscendDeploy/<TS>/baseline.json [--partner]` | every check passes, including C1–C7, D1 (head 010), D4/D8 (nothing written), P1–P4 | §6 row "smoke fails" |
| T12 | After-backup from the DEPLOY tree (ledger 001–010, profile `post-010-v1`) and its R1b/R1c proof | proven | 010 stays applied; the T2 artifact is historical for 009 and must not be called current; retry |
| T13 | Owner acceptance: one real contact (and, if wanted, a follow-up) on a prospect Oscar is actually working, recorded as ordinary work | saved; visible on the timeline and in the queue | report; the service stays up; forward-fix |

Expected outage (T6–T10): T7 and T8 (seconds) plus one `next build`. For comparison, D1's measured outage was 8 s with a 6 s build (`docs/DEPLOYMENT-D1-CHECKPOINT.md`), and this window adds the migration and its verification.

## 5 · What each verification proves

- **T4 (read-only):**
  - server 17.x;
  - ledger exactly 001–009 with zero checksum drift;
  - every 010 table, function and trigger absent;
  - `prospects` grants exactly the reviewed pre-010 shape: sales UPDATE on 20 columns including the
    guarded four; owner table-level UPDATE, no column grants;
  - the counts and catalog snapshot.
- **T7 refuses unless:**
  - `--service-stopped` is attested;
  - 0 application sessions are active or of invisible state;
  - the T4 record is at most 120 minutes old, mode 0600, with an unchanged ledger and no moved data key.
- **T8 (read-only), 51 checks:**
  - ledger row, checksum and not-backfilled;
  - 001–009 unchanged;
  - the four tables with RLS enabled and forced;
  - exactly 12 indexes;
  - the trigger, BEFORE UPDATE FOR EACH ROW;
  - exactly nine policies;
  - six functions: SECURITY DEFINER exactly where reviewed, `search_path` empty, no PUBLIC EXECUTE,
    EXECUTE exactly for owner and sales on the three commands;
  - exact table and column grants: sales 16 columns, none guarded; owner 27, none guarded, no table
    UPDATE; nothing for automation, auth or invite;
  - exact catalog deltas (+4 tables, +47 columns, +12 indexes, +52 constraints, +9 policies,
    +6 functions, +1 trigger, +23 column grants);
  - every business data key unchanged, and the four new tables empty.

## 6 · Failure and rollback

| Situation | Action |
|---|---|
| Any failure T1–T5 | STOP. Production is unchanged. |
| T6 fails to stop the service | STOP; do not apply 010 while the D1 build can serve. |
| T7 fails before commit | `applyMigrations` rolled back; no 010 row, no object. Bootstrap the OLD build, report, re-plan. Do not retry blindly. |
| **T7 committed, T8 fails** | **Keep the service DOWN.** Do not build or deploy. Report the failing V-ids. A grant or RLS shape failure is the most serious class. Owner decides: (a) a reviewed forward-fix migration, or (b) restore from the T2 artifact (proven at T3), which loses nothing because the service has been down since T6. **The D1 build must not be started on a 010 schema.** |
| T9 build fails | Service down, 010 verified. Fix the build from a clean committed tree, or decide (b) above. Do not start D1. |
| T10 does not start / T11 smoke fails | Service up on the new build or down. **Forward-fix.** The D1 clone is not a rollback after T7. Restore from T2 is a last resort that discards every write since T6, and needs explicit owner approval at the time. |
| T12 fails | 010 stays applied (correct and safe). Retry the backup. The T2 artifact stays historical for 009 and is never presented as current. |

**Refused in every case:**
- editing `010_sales_actions.sql` after it is applied;
- ad-hoc SQL against production, or hand-patching grants or policies;
- dropping the new tables;
- `DELETE` or `UPDATE` on business rows as "cleanup";
- starting the D1 build on a 010 schema;
- weakening A5 or any guard in these scripts.

## 7 · Evidence the 2A.3a-2 checkpoint must record (non-secret only)

- The deploy SHA and tree.
- The T2 artifact SHA-256 and the T3 pass counts.
- The T4 record digest.
- The T7 ledger row, and the T8 `51 passed, 0 failed`.
- Build ID; the T11 pass count, with the baseline's expected-fail list.
- The outage start and end times.
- The T12 artifact and its proof.
- The T13 acceptance, confirmed by the owner.

No URL, password, email, token, key or row content.

## 8 · Owner decisions (recorded at T0)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Authorize the migration and deploy as one stopped-service window, and choose its time | Required |
| D2 | Rollback policy after T7 | Forward-fix; restore from T2 only as a last resort, decided at the time |
| D3 | Write smoke | None automated. T13 is one genuine contact by the owner |
| D4 | Partner checks (`--partner`) | Yes if the partner can type their credentials into the shell for T1 and T11 (`read -rs`); otherwise skipped and recorded as skipped |
| D5 | Deploy SHA | The latest promoted baseline at T0, pinned exactly |
| D6 | Serving-tree hygiene (P3–P5), including stopping other sessions in the main checkout | Required; I1 (move serving out of iCloud) stays a recorded risk |
