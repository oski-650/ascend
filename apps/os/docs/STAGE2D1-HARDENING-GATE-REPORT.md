# Stage 2D.1 — Production Hardening Gate Report

**Date:** 2026-08-28
**Scope:** Remove the `BYPASSRLS` dependency, add a migration ledger, establish a recovery path.
**Outcome:** **PASS.** No prospect data migrated. `ASCEND_PROSPECT_SOURCE` unset. Vault untouched.

**The six-prospect migration is safe to begin**, with one caveat in §5 you should decide on first.

---

## 1. The `BYPASSRLS` dependency is gone

### What was wrong

`postgres` holds `BYPASSRLS`. While the application connected as it, a bare `SELECT` returned every
organization's rows, and tenant isolation existed only inside `asPrincipal`. A forgotten wrapper was
a silent cross-tenant leak — the query succeeded, returned too much, and nothing complained.

### What replaced it

`ascend_app`: a login with **no privilege of its own**.

| attribute | value |
|---|---|
| LOGIN | ✅ |
| SUPERUSER / BYPASSRLS / CREATEROLE / CREATEDB / REPLICATION | ❌ all false |
| INHERIT | ❌ false — privileges only by `SET ROLE` |
| direct table grants | **0** |
| may assume | `ascend_owner`, `ascend_sales`, `ascend_automation` |

The failure mode is now inverted, and that is the whole point:

> A query outside a principal binding is **refused**, not over-answered.

It is not filtered to zero rows — it errors with `permission denied`. Verified against `prospects`,
`events`, `organizations` **and** `schema_migrations`.

Migrations and application traffic no longer share a privilege level: `postgres` runs DDL over the
direct connection, `ascend_app` serves the application through the pooler.

### Proven against the live database — 14/14

| claim | result |
|---|---|
| connects as `ascend_app`, not a superuser, no `BYPASSRLS` | ✅ |
| **bare connection is refused on every table** | ✅ |
| no ambient authority — `NOINHERIT` means membership grants nothing until assumed | ✅ |
| sees only its own organization's rows | ✅ |
| switching principal does not leak the previous one | ✅ |
| a released pooled connection carries neither user nor organization | ✅ |
| cannot `ALTER POLICY`, `DROP TRIGGER`, `CREATE TABLE`, `DISABLE ROW LEVEL SECURITY`, drop a constraint | ✅ |
| cannot `SET ROLE postgres` | ✅ |
| held prospects readable, unwritable | ✅ |
| automation still cannot write judgment; still can write observation | ✅ |
| cross-tenant write refused | ✅ |
| TLS 1.3, CA-verified, pooler port 6543 | ✅ |

### Provisioning reconciles rather than creates

Re-running `provisionAppLogin` **corrects drift** rather than skipping an existing role. Demonstrated
by granting the login `BYPASSRLS CREATEDB INHERIT` plus four table privileges, re-provisioning, and
observing all of it revoked.

RLS was **not weakened** to accommodate the new login. No policy, grant or constraint changed;
`ascend_app` was added alongside the existing model.

### Two measured facts worth recording

**Supavisor authenticates custom roles** as `<role>.<project-ref>`. Plain `<role>` fails with
`no tenant identifier provided`. This is what made the whole design possible, and it was not
knowable without testing.

**A `CREATEROLE` admin may set an attribute only if it holds that attribute itself.** So `postgres`
— which has `BYPASSRLS` and `REPLICATION` — can set `NOBYPASSRLS` and `NOREPLICATION`, but
`NOSUPERUSER` is refused with `permission denied to alter role`. My first attempt named all three
and took the entire reconciliation down with it. `SUPERUSER` is therefore **verified and refused**
rather than set, so provisioning cannot report success against a login that defeats every policy.

---

## 2. Migration ledger

Migration `004_schema_migrations.sql` is applied. Production can now answer for itself:

```
current version : 004_schema_migrations.sql
001_substrate.sql          (backfilled)
002_prospect_fields.sql    (backfilled)
003_prospect_notes.sql     (backfilled)
004_schema_migrations.sql
checksum drift  : none
```

**It refuses; it does not skip.** The tempting design — "skip anything already recorded" — turns a
second run from an error into a no-op, and a migration re-applied silently is how a schema and its
recorded history stop agreeing. A recorded version raises `MigrationAlreadyApplied`. Tested.

**Checksums.** Each row stores the sha256 of the file as applied, so editing a migration after the
fact is detectable rather than invisible. Mutation-tested: a tampered checksum is reported as drift.

**The backfill states its own provenance.** 001–003 were applied before the ledger existed, so their
timestamps were reconstructed from `prod-state-02-post-migration.json`. Every backfilled row carries
`applied_at_is_backfilled = true` and a mandatory note saying the timestamp *bounds* the application
and *did not witness it* — a `CHECK` constraint makes a backfilled row without a source impossible.
This is the same distinction the H-series backfill established: a reconstructed timestamp and an
observed one are different kinds of fact, and the system may not present one as the other.

**Not tenant data.** No `organization_id`, no policy, no grant to any `ascend_*` role. The
application cannot read it — verified from the application login.

---

## 3. Recovery path

### What I could not do

`pg_dump`/`psql` are **not installed**, and I did not install them. Supabase's PITR is behind the
dashboard, which I cannot reach.

**Two things for you:**

1. **Check the Supabase plan for PITR / daily backups.** This should be the primary mechanism; what
   I built is an interim, not a replacement.
2. **Tell me if you want libpq installed** (`brew install libpq`, ~50 MB, adds `pg_dump`/`psql`). It
   would give a standard, full-fidelity dump including schema, roles and grants. I did not install
   it because you asked to be consulted first.

### What now exists and is verified

`core/db/backup.ts` — a logical snapshot taken over the CA-verified connection.

| | |
|---|---|
| **Mechanism** | `dumpSnapshot()` → JSON; `restoreSnapshot()` → rows back |
| **Location** | `apps/os/.backups/` — **gitignored**, so business data never enters git |
| **Restores** | every row of all five business tables, **including `events.seq`** |
| **Does not restore** | schema, roles, policies, grants, triggers, indexes |
| **Last verified restore** | 2026-08-28 — round-trip gate, 9/9 |
| **Production snapshot** | `2026-08-28T09:47:11Z`, digest `70f8608…`, all tables 0 rows |

The second row is not a gap: the schema lives in `core/db/schema/*.sql` under version control.
**Recovery is two steps — run the migrations, then restore the rows** — and together they reconstruct
the database. What it does not survive is losing the repository and the snapshot together, which is
why off-machine PITR should still be the primary.

### A valid pre-migration recovery point

A snapshot taken from the direct connection, whose `migrations` list matches the current ledger and
whose `digest` verifies. `restoreSnapshot` refuses a non-empty target, so a recovery cannot silently
merge into surviving rows and produce a database that is neither the backup nor what preceded it.

### Verified by round-trip, not by assertion — 9/9

A backup nobody has restored is a hope. The gate builds a schema on the real server, fills it with
the cases most likely to be lost, dumps it, **destroys it**, restores into a fresh schema, and
compares row for row:

- **`events.seq` preserved exactly**, with deliberate gaps in the source so a `bigserial`
  renumbering would be visible. `seq` is the ordering signal that replaced log position; a restore
  that renumbered would preserve every event and silently reorder history.
- **empty string ≠ NULL** — the distinction Stage 2B lost twice.
- **dates** — `first_contact: 2026-06-10` survives as `2026-06-10`.
- unicode, quotes, newlines, backslashes in `notes`; nested `jsonb` with nulls.
- a **held** prospect: NULL identity plus stated reason.
- restoring over a non-empty schema is refused; a tampered snapshot is detected.

**A defect found and fixed here:** my first `dumpSnapshot` rendered `date` columns through a JS
`Date` and `toISOString()`, which yields the *previous day* for any timezone ahead of UTC — exactly
the bug this project already hit once. Dates are now cast to text server-side, so no timezone is
ever applied to a value that has none.

---

## 4. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| production hardening gate | **14 passed** |
| production application login gate | **14 passed** |
| backup/restore round-trip | **9 passed** |
| production authorization | **26 passed** (5 mutation controls) |
| pooled principal isolation | **13 passed** |
| architecture fitness (F1–**F45**) | **152 passed** |
| full suite, live DB | **858 passed, 35 skipped, 40 files** |
| full suite, no DB | 800 passed, 93 skipped, 40 files |
| **production business rows** | **all five tables 0** |
| vault | untouched |

### F45 added and mutation-tested

New rule: *the application login holds no ambient authority.* Both provisioning paths must clear
`BYPASSRLS` and `INHERIT`; provisioning must refuse to report success on a dangerous login; it must
reconcile rather than merely create; and **no migration may grant `ascend_app` anything directly** —
its privileges arrive only through role membership, so what the application may do is described in
exactly one place.

Two mutations, both caught: removing `NOBYPASSRLS` from the `ALTER` path, and weakening the
reconciling `REVOKE`.

Also added under F41: **a restore never emits an event.** If `backup.ts` emitted events for restored
rows, a recovery would double the record — every restored prospect arriving with a fresh "created"
event beside its original. A restore reinstates history; it does not author it.

### A test-isolation defect I introduced and fixed

`production-authorization` asserted on the *whole* `prospects` table, which failed once
`production-app-login` began committing fixtures — vitest runs files in parallel. Both suites'
assertions are now scoped to their own namespaces. The cross-tenant claims are unchanged; they
simply no longer depend on the rest of the database being idle. A test that fails because a sibling
is doing its job measures the scheduler, not the database.

---

## 5. Is the six-prospect migration safe to begin?

**Yes — with one decision for you first.**

| precondition | status |
|---|---|
| schema applied and verified against `pg_catalog` | ✅ |
| authorization demonstrated, not asserted | ✅ 26 + 5 mutations |
| application login cannot bypass the security boundary | ✅ |
| pooled identity isolation through the real pooler | ✅ |
| migration ledger, forward-only, checksummed | ✅ |
| recovery mechanism **verified by restore** | ✅ |
| production holds zero business rows | ✅ |
| **off-machine backup** | ⚠️ **your decision** |

The caveat: the verified recovery path writes to `apps/os/.backups/` **on this Mac**. That is a real
recovery point for a corrupted migration — the case most likely to matter — but not for losing the
machine or the Supabase project. Before six prospects with irreplaceable history and notes go in, I
would want either PITR confirmed on your plan, or approval to install libpq, or an instruction to
copy snapshots somewhere off-machine.

That is a small gap and it is genuinely yours to close, because all three options cost money, disk,
or a decision I should not make for you.

---

## 6. State now

| | |
|---|---|
| schema | 001–004 applied; ledger current at `004` |
| business data | **none** |
| application login | `ascend_app`, no `BYPASSRLS`, no direct grants |
| admin login | `postgres`, direct connection, migrations only |
| `ASCEND_PROSPECT_SOURCE` | **unset** — the vault is still authoritative |
| readers | unchanged; nothing reads Postgres |
| vault | untouched |

Credentials live in `apps/os/.env.production.local`, which is gitignored. `ASCEND_DATABASE_URL` now
points at the application login; the admin pooled URL moved to `ASCEND_DATABASE_URL_ADMIN_POOLED`,
and the test harnesses fail with one clear sentence if pointed at the wrong one.

**Not done, deliberately:** the six-prospect migration · consumer parity against production · the
read flip · Sheets intake · the research engine · auth UI · wiring `core/db` to any surface.
