# Dependency D1b.2 — execution contract (PRE-FLIGHT, FROZEN, NOT EXECUTED)

**Status: EXECUTED 2026-09-20 — see `docs/DEPENDENCY-D1B2-CHECKPOINT.md` for the result.** This
document is the contract as frozen before execution, plus two witnessed, owner-authorized corrections
made during it: the V34 matrix count (§4 / `scripts/verify-migration-009.mjs`) and two keys added to
the §8 delta list. Everything else below is exactly as frozen. No code was deployed and no prospect was
archived.

*As frozen:* PRE-FLIGHT COMPLETE. NOTHING APPLIED.

**Baseline:** `eb0f8b6` (D1b.1, accepted). **Read-only production contact this pre-flight:** two reads
— the extended precheck (§2) and the runner's own `--check` pass. Both inside `BEGIN READ ONLY` with
`default_transaction_read_only=on`. No mutation.

---

## 1 · Baseline / drift result — **NO DRIFT**

| Item | Expected | Found | |
|---|---|---|---|
| HEAD | `eb0f8b6…` | `eb0f8b642460944ac0001623fc8dcfac21a467b0` | ✅ |
| Working tree | clean | clean at check time | ✅ |
| 009 checksum | `f1c3b225…0cd7062d` | identical, 10,397 bytes | ✅ |
| `MIGRATIONS` list | 001–009, 9 entries | 9 entries, in order | ✅ |
| Retained build | PostgreSQL 17.6 | `postgres`/`pg_restore` both 17.6 | ✅ |
| `bin/postgres` sha256 | `ba83fff9…4addd6e34c7` | identical | ✅ |
| Source tarball sha256 | `e0630a36…f94cd7a8b0` | identical | ✅ |
| Build root mode | 0700, outside repo/iCloud | `drwx------ /Users/oscar/AscendPg17` | ✅ |
| R1b artifact | present, intact | `ascend-backup-20260919T120457Z-r1b.ascbk`, 15,070,041 B, mode 0600, `.sha256` beside it | ✅ |
| Pinned CA for backups | present | `~/AscendBackups/ca/supabase-root-2021.crt` | ✅ |
| `pg_dump` for backups | the 18.6 that made the R1b artifact | `/opt/homebrew/opt/libpq/bin` → **18.6** (keg-only; the script puts it on PATH itself) | ✅ |
| Deployment | none | see below | ✅ |

**No deployment has occurred, and production is running schema-008-compatible code.** The `com.ascend.os`
launchd job (PID 36325, `next-server` v16.3.0) has been up since **2026-09-18 04:18:54**, listening on
`127.0.0.1:3001`. That build predates **R1a, R1b, R1c, D1a and D1b.1** — the last commit before it is
`6cb91d2`. Its build output contains **zero** references to `archived_at`, and zero to D1a's archival
refusal strings. So the running application neither reads nor writes archival columns.

> **Side observation, not a blocker:** D1a is also undeployed. The promotion/deletion correctness fixes
> from `4276f89` are not live either. That is a separate deployment decision and is **not** part of
> D1b.2's bounded outcome; it is recorded so nobody assumes D1a is in production.

---

## 2 · Pre-migration production read — **ALL PRECONDITIONS MET**

Read-only, over the **direct** endpoint, TLS verified against the CA pinned in `core/db/tls.ts`.
Counts and schema metadata only; no names, ids, row contents or PII.

**Server:** PostgreSQL **17.6** — the same version as the retained build and as R1c's proof.

### Ledger — the gating check

| | |
|---|---|
| Row count | **8** ✅ (required: exactly 8) |
| Head | **`008_prospect_notes_log.sql`** ✅ (required: exactly 008 — otherwise STOP) |
| Checksum drift, 001–008 | **0** — every recorded checksum equals the file in `core/db/schema/` |
| Files missing locally | 0 |
| 009 already recorded | **no** |
| Backfilled timestamps | 001–003 only (expected; the historical backfill) |

### Objects 009 creates — all **ABSENT** ✅

`prospects.archived_at` 0 · `prospects.archived_by` 0 · `archival_has_provenance` 0 ·
`prospects_org_active_idx` 0

### Objects 009 depends on — all **PRESENT** ✅

`prospects` · `users` · roles `ascend_sales`/`ascend_owner`/`ascend_automation` · `current_org()` ·
policy `prospects_update_sales`

### The policy 009 drops and recreates — **matches 001 exactly** ✅

```
cmd        UPDATE            roles  {ascend_sales}
USING      ((organization_id = current_org()) AND (identity_state = 'anchored'::text))
WITH CHECK ((organization_id = current_org()) AND (identity_state = 'anchored'::text))
```

This is the check that makes the DROP/CREATE predictable rather than hopeful: production's policy is
byte-for-byte the one 009 was written against.

### Current grants on `prospects`

Table: owner `SELECT,INSERT,UPDATE,DELETE` · sales `SELECT,INSERT` · automation `SELECT,INSERT`.
Column-level: **28** (18 sales, 10 automation). **`ascend_sales` holds DELETE: false.**

### Counts (counts only)

| | | | |
|---|---|---|---|
| prospects_total | **3,108** | notes_total | **0** |
| anchored | 3,106 | users_total | **1** |
| held | **2** | memberships_total | 1 |
| closed_won | 1 | orgs_total | 1 |
| closed_lost | 0 | invitations_total | 0 |
| status_absent | 0 | events_total | **22,811** |
| slugged | 6 | created_by set | 3,102 |
| **with_body (non-empty `notes`)** | **6** | | |

### Catalog shape (the pre-migration baseline the §4 matrix is derived from)

`prospects` columns **29** · public columns **76** · tables **8** · indexes **26** ·
constraints (excl. `contype='n'`) **43** · policies **22** · policies on `prospects` **6** ·
`prospects` RLS enabled **and** forced.

> ### ⚠️ CORRECTION to the D1b.1 checkpoint and commit message
>
> Both state that `prospects.notes` is "the markdown body, which every one of the 3,108 rows carries".
> **That is wrong.** Only **6** rows have a non-empty body — the six vault-originated prospects. The
> 3,102 imported rows have `notes` empty or NULL.
>
> The decision is unaffected: archival is still correct, and the notes-preservation argument still
> holds for those 6 bodies plus all future `prospect_notes` state. But the *magnitude* of what a hard
> delete would destroy today is 6 bodies and 0 log rows, not 3,108 bodies. The D1b.1 checkpoint should
> be corrected in D1b.2's documentation step; it is recorded here rather than silently fixed, and no
> conclusion changes.

---

## 3 · Migration execution plan — exact command and path

**Script:** `scripts/apply-migration-009.mjs` (written this pre-flight, **not executed in apply mode**).

```bash
# read-only rehearsal — the default, and what was run during this pre-flight
node --experimental-strip-types scripts/apply-migration-009.mjs --check
```

```bash
# THE APPLY COMMAND. Requires owner authorization. Not yet run.
node --experimental-strip-types scripts/apply-migration-009.mjs --apply-to-production
```

### How it satisfies each requirement

| Requirement | How |
|---|---|
| Direct endpoint | Reads `ASCEND_DATABASE_URL_DIRECT` only; **aborts if absent**. DDL never touches the transaction pooler |
| Pinned TLS | CA read from `core/db/tls.ts`, `rejectUnauthorized: true`, TLS ≥1.2; refuses a URL carrying any `sslmode`/`ssl*` parameter, matching `core/db/pool.ts` |
| Applies only 009 | `loadMigrations().filter(name === "009_prospect_archival.sql")`, asserted to be exactly one entry |
| Fails on checksum mismatch | Compares the file's sha256 against the **frozen constant** before connecting, and re-checks what `loadMigrations` computed |
| Fails on wrong predecessor | `ledgerStatus()` must equal `001…008` **in order**; `verifyChecksums()` must report zero drift |
| No unrelated mutation paths | Imports **only** `core/db/migrate.ts` — node builtins plus a type-only `SqlClient` that stripping erases. It does **not** load `pool.ts`, `client.ts`, `prospects.ts`, `core/crm` or any route. Nothing in the process can archive, promote or write a business row |
| Cannot write by accident | `--check` opens the session with `default_transaction_read_only=on`; DDL is impossible in it. Only `--apply-to-production` opens a writable session |

**Two extra guards `applyMigrations` does not provide and this script adds**, because each is a way to
change production while believing something false about it:

- the objects 009 creates must all be **absent** (catches a partial application outside the ledger);
- `prospects_update_sales` must match the exact `USING`/`WITH CHECK` text recorded in §2 (catches
  recreating a policy we mis-read);
- plus a row-count guard against the frozen baseline (`--allow-count-drift` to override knowingly).

### `--check` result, this pre-flight

```
[ok] 009 matches the frozen checksum              f1c3b225e557fdb5…
[ok] exactly one migration will be applied        009_prospect_archival.sql
[ok] connected to the DIRECT endpoint over verified TLS   read-only
[ok] server version                               17.6
[ok] ledger is exactly 001–008                    head 008_prospect_notes_log.sql
[ok] zero checksum drift across the applied ledger        8 files
[ok] archival columns, constraint and index are all absent
[ok] prospects_update_sales matches 001 exactly   drop/recreate is predictable
     prospects / notes / users / events           3108 / 0 / 1 / 22811
[ok] row counts consistent with the frozen baseline

CHECK ONLY. Every precondition passed and NOTHING was written.
```

### Evidence that the migration committed

Written by `applyMigrations` itself, inside the **same transaction** as the DDL (so a crash cannot
leave a schema change unrecorded or a record without its change), and re-read immediately after:

1. `schema_migrations` contains `009_prospect_archival.sql`;
2. its `checksum` equals `f1c3b225…0cd7062d`;
3. `applied_at_is_backfilled = false` — witnessed, not reconstructed;
4. ledger row count 9, head 009;
5. the §4 matrix passes with zero failures.

Absent any of 1–4, the script aborts and says so rather than reporting success.

---

## 4 · Post-migration verification matrix — **FROZEN BEFORE THE MIGRATION**

**Script:** `scripts/verify-migration-009.mjs`, read-only inside `BEGIN READ ONLY`.

Every expected value was measured on production **before** 009 and the deltas derived from 009's text.
Writing the matrix afterwards would let the observed state define "correct", which describes rather
than checks.

**Proof that it discriminates:** run against production *now* (pre-migration) it reports
**15 passed, 22 failed** and exits non-zero — failing in exactly the sections 009 changes, while the
invariants that must *not* change already read green.

| id | Check | Expected |
|---|---|---|
| V1–V2 | ledger rows / head | 9 / `009_prospect_archival.sql` |
| V3 | recorded checksum | `f1c3b225…0cd7062d` |
| V4 | `applied_at_is_backfilled` | `false` |
| V5–V7 | `archived_at` | `timestamp with time zone`, nullable, **no default** |
| V8–V10 | `archived_by` | `uuid`, nullable, **no default** |
| V11 | `archived_by` FK target | `users.id` |
| V12 | FK ON DELETE | **`a`** (NO ACTION) — not `n`/SET NULL, which would erase attribution |
| V13–V14 | `archival_has_provenance` | exists, and is the intended predicate |
| V15–V17 | `prospects_org_active_idx` | exists, **partial** on `archived_at IS NULL`, non-unique |
| V18–V19 | sales UPDATE policy | exists; `USING` **carries** `archived_at IS NULL` |
| **V20** | **`WITH CHECK` does NOT carry it** | **`no`** — the trap: `yes` means sales can never archive |
| V21 | `USING` still anchored-only | yes |
| V22 | owner policy unchanged | no archival predicate |
| V23 | RLS on `prospects` | enabled **and** forced |
| V24 | sales UPDATE columns added | exactly `archived_at,archived_by` |
| V25 | sales TABLE grants | still only `INSERT,SELECT` |
| **V26** | **sales has NO DELETE** | none |
| V27 | sales has no table-level UPDATE | none |
| V28 | automation on archival columns | **0** |
| V29 | total column grants on `prospects` | **30** (was 28) |
| V30–V31 | column counts | `prospects` **31** (was 29); public **78** (was 76) |
| V32 | tables | **8** — 009 creates none |
| V33 | indexes | **27** (was 26) |
| V34 | constraints | **44** (was 43) |
| V35–V36 | policies | **22** total, **6** on `prospects` — drop+create nets zero |
| **V37** | **prospects archived** | **0** — 009 backfills nothing |
| V38–V51 | prospects_total 3,108 · anchored 3,106 · held 2 · closed_won 1 · closed_lost 0 · status_absent 0 · slugged 6 · with_body 6 · notes 0 · users 1 · orgs 1 · memberships 1 · invitations 0 · events 22,811 | **all unchanged** |

**No application deployment happens at this step.**

---

## 5 · Failure / abort policy

**Governing principle:** 009 adds two nullable columns plus security objects and backfills nothing, so
a bounded post-commit problem is **corrected forward**, never by a casual destructive rollback — and
**every** forward correction STOPS for owner review before production is touched again.

| Situation | Action |
|---|---|
| **Transaction fails before commit** | `applyMigrations` already rolled it back; the ledger has no 009 row and no object exists. **Nothing to undo.** Report the error, re-run `--check`, do not retry blindly |
| **Commits, but a verification check fails** | **STOP. Do not back up, do not deploy.** Report the failing V-ids. The schema is additive and nullable, so the database is not in a dangerous state. Propose a bounded forward fix (`010_*`) and **wait for owner approval** |
| **RLS / grant shape wrong** (V19–V29) | **The most serious class**, because it is a security shape. STOP immediately. Do not deploy — D1b.1's code assumes this shape. Fix forward in a reviewed `010_*` after owner approval. Never hand-patch production with ad-hoc SQL |
| **V20 specifically** (`WITH CHECK` carries the predicate) | Sales could never archive. Forward-fix by recreating the policy correctly, owner-approved, then re-run the whole matrix |
| **V37 / V38–V51 fail** (data changed) | **Treat as an incident.** 009 must not alter business data. STOP, do not back up, and establish what changed before anything else |
| **Application incompatible with the resulting schema** | Do not deploy. The running build is schema-008-compatible and keeps working after 009 (it never references the new columns), so **production stays serving** while this is resolved |
| **Backup creation later fails** | 009 stays applied — correct and safe. The pre-009 artifact remains valid **for pre-009 production** and must NOT be presented as current. Retry the backup; if it keeps failing, D1 stays incomplete and is reported as such. Never mark the pre-009 artifact "current" to close the gate |
| **R1b or R1c fails on an unexpected delta** | **Fail closed.** Any F-key delta beyond §8's permitted list is an abort, not a tolerance to widen |

**Explicitly refused:** dropping the columns, dropping/recreating objects by hand outside the ledger,
`DELETE`/`UPDATE` on business tables as "cleanup", and editing `009_prospect_archival.sql` after it is
applied (`verifyChecksums` would report drift forever).

---

## 6 · Deployment order — confirmed, and not reversible

1. **production at 008 + old app** ← where we are now (build of 2026-09-18, no archival references)
2. **apply 009** (§3)
3. **verify 009** (§4)
4. **only then** may D1b.1 application code become deployable

Deploying before step 2 makes **every** prospect read fail with `column "archived_at" does not exist`
— the canonical reader carries `WHERE archived_at IS NULL` — taking `/sales`, `/partner`, the graph,
the forecast and intake down together. There is no graceful degradation.

The order is safe in the other direction: 009 is additive and nullable, and the currently-running
build never names the new columns, so **production keeps serving normally between steps 2 and 4**.

**D1b.2 does not itself need to deploy.** Deployment is a separate authorization (§10).

---

## 7 · New recovery artifact procedure — not executed

**Command** (after §4 passes with zero failures):

```bash
bash scripts/backup-production.sh --read-production --key-file <existing 0600 backup key> <label>
```

| Requirement | How it is met |
|---|---|
| Existing encryption key | The **same** key file used for the R1b artifact. No rotation — rotation is separate work and would be stated, not silent |
| Manifest before/after equality | The script runs `manifest.sql` **before** the dump and **again after**, and requires equality — proof the database did not move underneath the dump |
| Ledger 001–009 | The script's own **A5 guard** compares production's `F17.ledger` against every file in `core/db/schema/`, checksum for checksum, and aborts on mismatch. Since the repo now holds 009, **this guard structurally refuses to back up a pre-009 production** — the ordering is enforced by the tool, not just by discipline |
| No plaintext leftover | Work directory is `mktemp -d` inside `~/AscendBackups`, removed by an `EXIT/INT/TERM` trap; only the sealed `.ascbk` and its `.sha256` remain |
| Destination | `~/AscendBackups` only, mode 0700; refuses a path inside the repo or any cloud-synced folder |
| Read-only | `PGOPTIONS=-c default_transaction_read_only=on`, `PGSSLMODE=verify-full` with the pinned CA; `pg_dump` takes only `ACCESS SHARE` |
| Toolchain identical to R1b's | `pg_dump` **18.6** from `/opt/homebrew/opt/libpq/bin` — the same version that produced the existing artifact, so R1c's "four TOC entries skipped" figure carries over |
| Pre-009 artifact | **Retained**, renamed/annotated as **historical — pre-009, non-current**. Never deleted |
| Becomes current | **Only after** the new artifact passes full R1b **and** full two-leg R1c. Until then there is no current recovery point for post-009 production, and the runbook says so |

---

## 8 · R1b re-proof contract — full, not narrowed

`tests/db/restore-independence.test.ts` against the **new** artifact: restore off-vendor into
in-process PGlite, **F1–F18 with zero skips**, plus the owner's real login through the application.

**Permitted deltas versus the pre-009 manifest — and nothing else:**

| Key | Expected change |
|---|---|
| `F2.columns.count` | **+2** |
| `F2.columns.digest` | changes |
| `F4.digest.prospects` | **changes even with zero archived rows** — F4 digests `t::text`, the whole-row rendering, which gains two empty fields for all 3,108 rows |
| `F4.held.digest` | changes (same mechanism, 2 rows) |
| `F5.constraints.count` / `.digest` | **+1** (`archival_has_provenance`) |
| `F5.indexes.count` / `.digest` | **+1** (`prospects_org_active_idx`) |
| `F11.policies.digest` | changes (the `USING` expression) |
| `F13.grants.columns.count` / `.digest` | **+2** |
| `F17.ledger` | gains 009 and its checksum |
| `F3.rows.schema_migrations` | **8 → 9** — *added post-hoc, see the correction below* |
| `F4.digest.schema_migrations` | changes — *added post-hoc, see the correction below* |
| `F18` | new artifact checksum |
| `F11.policies.count` | **unchanged** at 22 — drop + create of the same name |
| `F1`, `F3` (**except** `F3.rows.schema_migrations`), `F6`–`F10`, `F14`–`F16` | **unchanged** |

**Any delta outside this table fails closed.** The list is a specification, not a tolerance band.

> ### ⚠️ WITNESSED ENUMERATION DEFECT (2026-09-20, owner-authorized)
>
> **This is a defect in the frozen delta specification — not a recovery defect and not a
> production-data correction.**
>
> As first frozen, this list omitted two keys. The pre-009 vs post-009 comparison, run after R1b had
> already passed 61/61 with zero skips, reported them as the only UNEXPECTED deltas:
>
> | Key | Observed |
> |---|---|
> | `F3.rows.schema_migrations` | 8 → 9 |
> | `F4.digest.schema_migrations` | changed |
>
> **Why they must move:** migration 009 intentionally adds exactly **one** row to `schema_migrations`
> — its own ledger entry. F3 counts that table's rows, so it goes 8 → 9; F4 digests that table's
> content, so it changes. `F17.ledger` was correctly predicted to change; these two keys are
> additional representations of **the same intentional ledger mutation**, measured as a table rather
> than as a rendered ledger string. The omission is the same class of under-counting as the V34
> matrix defect.
>
> **Evidence nothing else moved:** every business table's F3 row count and F4 content digest is
> unchanged (events, users, organizations, memberships, invitations, prospect_notes); the event
> sequence is identical (F6: min 369, max 31,384, 22,811 distinct, order digest unchanged); the six
> legacy note bodies are byte-identical (F7: 6 → 6, digest unchanged); credentials unchanged (F9).
> `F4.digest.prospects` changed only in the predicted manner — the whole-row rendering gaining two
> empty archival columns — while `F3.rows.prospects` stayed 3,108 → 3,108.
>
> **Exactly these two keys were added. Nothing else was widened.**
`manifest.sql` itself is **not edited**: it is catalog-driven, so F1–F18 need no semantic change — only
the expected values move, and production produces those at dump time.

`F4.digest.prospects` moving with zero archived rows is the one that reads like corruption to anyone
comparing across the migration. It must be stated in the runbook **before** the proof runs.

---

## 9 · R1c re-proof contract — full two-leg, not shortened

**The retained build is suitable for reuse**, verified this pre-flight: PostgreSQL **17.6**
(production's exact version), `bin/postgres` and source tarball checksums both matching the recorded
values, root mode 0700 outside the repo and iCloud, **no process running**, **no service**, and **no
cluster data directory, dump or backup artifact inside it** (`PG_VERSION`/`*.ascbk`/`*.dump` count: 0).
`ASCEND_R1C_ROOT=/Users/oscar/AscendPg17` resolves `pg17/bin` as the harness expects.

`tests/db/restore-same-version.test.ts` against the new artifact, after R1b passes:

- PostgreSQL **17.6**, a **fresh disposable cluster per leg**, Unix socket only, `listen_addresses=''`;
- **both** restore legs — the portable-SQL `restoreInto` **and** the runbook's `pg_restore -L` with
  exactly four TOC entries skipped;
- **all F1–F18**, key-for-key against the manifest production produced at dump time;
- behaviour checks; real `pg`-driver application reads as the restored `ascend_app`
  (`credentialFor`/`verifyPassword`, `resolvePrincipal`, `listProspects`, `readEvents`,
  `listProspectNotes`, invitations under RLS, `listOrganizationMembers`);
- isolation assertions (version, data directory, system identifier, postmaster start time);
- write-refusal proof on a trigger-guarded clone — including the standing
  `F12.sales-cannot-delete-prospects`, which **must still pass after 009**;
- cleanup of every cluster afterwards.

**No shortened variant.** Proving one leg and carrying the other forward would relabel evidence about
artifact *N* as evidence about *N+1* — R1 abort condition **A10**.

**Note:** `listProspects` in that proof now returns the **active** set. With zero archived rows the
count is unchanged, but the assertion should state active-plus-archived explicitly rather than relying
on them being equal (D1b.1 checkpoint §2.6, item R4).

---

## 10 · What is required before Dependency D1 may be marked COMPLETE

1. 009 applied to production and the §4 matrix passing with **zero** failures;
2. post-migration security/grant shape proven (V18–V29) — RLS predicates and the two-column grant;
3. a **new** encrypted artifact created, and proven through **full R1b**;
4. **full two-leg R1c** passed on that artifact;
5. no production business data changed (V37, V38–V51);
6. D1b.1 code **officially marked deployable** against schema 009;
7. pre-009 artifact **retained and marked historical**, and not the current recovery point;
8. `docs/DEPENDENCY-D1B2-CHECKPOINT.md` written, plus updates to `RECOVERY-RUNBOOK.md`,
   `scripts/RESTORE.template.md`, the R1b/R1c checkpoints and the completion map;
9. the §2 correction to the D1b.1 checkpoint applied.

**A first real production archival is NOT required.** The migration is proven by the schema matrix and
the recovery proofs; archiving a real prospect would alter business data purely to manufacture
evidence, and the behaviour is already proven against the real `ascend_sales`/`ascend_owner` roles in
`tests/db/d1-archival.test.ts` and on a real 17.6 server in `tests/db/d1-concurrency.test.ts`. It is
**not proposed**.

---

## 11 · Owner authorization still required

| # | Action | Status | Notes |
|---|---|---|---|
| **A1** | **Apply migration 009 to production** — `node --experimental-strip-types scripts/apply-migration-009.mjs --apply-to-production` | **REQUIRED — not yet given** | The one irreversible-ish step. Additive and nullable; rehearsed read-only with every precondition passing |
| **A2** | **Create the new encrypted production backup** — `scripts/backup-production.sh --read-production --key-file <key> <label>` | **REQUIRED — not yet given** | Read-only against production, but it writes an artifact containing credential hashes and PII. Needs the key-file path, which only the owner has |
| **A3** | **Deploy D1b.1 application code** | **REQUIRED IF WANTED — not requested** | Not needed for D1b.2's bounded outcome. Only valid *after* A1 + §4 pass. Would also be the first deployment of D1a |
| **A4** | **Archive a real production prospect** | **NOT PROPOSED** | Would alter business data to manufacture evidence. Recommended against; ask only if you want it |
| **A5** | Re-run R1b / R1c | Covered by A2 | Needs `ASCEND_BACKUP_KEYRING`, `ASCEND_RECOVERY_OWNER_EMAIL`, `ASCEND_RECOVERY_OWNER_PASSWORD` at run time. R1's standing rule: the owner email is supplied by silent prompt, never echoed |

**Nothing in A1–A5 has been performed. STOPPING FOR APPROVAL BEFORE APPLYING 009.**
