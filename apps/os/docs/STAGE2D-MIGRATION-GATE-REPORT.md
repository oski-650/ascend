# Stage 2D — Production Schema Migration Gate Report

**Date:** 2026-08-28
**Scope:** Apply 001 → 002 → 003 to the production database, then prove the managed server actually
enforces the architecture.
**Outcome:** **PASS.** No prospect data migrated. `ASCEND_PROSPECT_SOURCE` unset. Vault untouched.

The milestone: this is the point at which *"we designed a Postgres architecture and tested it
locally"* became *"the managed production database enforces it, and I have watched it refuse the
things it is supposed to refuse."*

---

## 1. Backup — what was and was not possible

**No restorable snapshot was taken, and one was not available to me.** Recorded plainly rather than
glossed:

- `pg_dump` and `psql` are **not installed** on this machine, and I did not install them — that
  needs your say-so.
- Supabase's own backup tooling lives in the dashboard, which I cannot reach.

What made this acceptable, and would not have in any other circumstance: **there was nothing to back
up.** `public` held 0 tables and 0 rows; the only pre-existing objects were the three `ascend_*`
roles. The recorded pre-state *is* the recovery information, and the rollback is
`DROP TABLE events, memberships, prospects, users, organizations CASCADE`.

**This stops being true after the six-prospect migration.** From that point on there is data whose
loss matters, and a real backup path — Supabase PITR, or libpq installed with your approval — should
exist before it is written.

Artifacts: [`prod-state-01-pre-migration.json`](stage2d/prod-state-01-pre-migration.json) ·
[`prod-state-02-post-migration.json`](stage2d/prod-state-02-post-migration.json) ·
[`prod-state-03-post-gate.json`](stage2d/prod-state-03-post-gate.json)

---

## 2. Pre-migration state, as recorded

| | |
|---|---|
| server | PostgreSQL 17.6 |
| login role | `postgres` — **not** superuser, has `CREATEROLE`, has **`BYPASSRLS`** |
| `public` tables | **0** |
| `ascend_*` roles | all three present, `NOLOGIN`, non-superuser, no `CREATEROLE` |
| role grants | each `SET`-able by `postgres`, `INHERIT` false |
| prospect data | none |

### The roles were verified, not assumed

They were created during the TLS/isolation work, so the gate treats them as **existing production
state** and checks they are exactly what 001 expects before writing anything:

- `NOLOGIN` — a role that could log in would not be the role the migration means, and reusing it
  would silently widen authority.
- not superuser, no `CREATEROLE` — no elevated attributes.
- `SET`-able by the login role — the PG16+ defect from the previous gate stays fixed.
- **`INHERIT` false** — authority is acquired by `SET ROLE` or not at all, never passively.

Nothing was dropped or recreated. The migration's `DO` blocks swallow `duplicate_object`, so the
pre-existing roles were adopted rather than replaced.

---

## 3. Migrations applied

Over the **direct 5432 connection**, each file in **its own transaction**, through the CA-verified
pool factory:

```
001_substrate.sql        278ms
002_prospect_fields.sql  216ms
003_prospect_notes.sql   214ms
```

`psql` was not used — partly because libpq is absent, but mainly because `psql` would open its own
connection with its own TLS posture, outside `core/db/pool.ts`. The connection that installs the
security model should be verified like every other one.

### Idempotency — stated precisely, because the loose version is false

| claim | verdict |
|---|---|
| The **role blocks** tolerate pre-existing roles | ✅ verified — this database was exactly that case |
| The `GRANT` re-issues cleanly and leaves roles unchanged | ✅ verified |
| **The migrations as a whole are re-runnable** | ❌ **NO — and they must not be** |

Re-running 001 fails on `CREATE TABLE organizations … already exists`, and there is now a test
asserting that it fails. That is not a defect to paper over with `IF NOT EXISTS`: a migration that
silently re-applies is how a schema and its history stop agreeing. The failed re-run left the schema
intact, because each file runs in a transaction.

**Gap flagged, not filled:** there is no `schema_migrations` ledger table, so "which migrations does
this database have?" is answered by introspection and by this report rather than by the database.
Adequate for three forward-only files applied once under review; **not** adequate once migrations
run unattended. Adding a ledger is a schema decision and I did not take it unilaterally.

---

## 4. Post-migration state, verified from `pg_catalog`

Not by re-reading the `.sql` files — that would diff them against themselves. Every check below
asks the **server** what it will enforce.

| | |
|---|---|
| tables | `events`, `memberships`, `organizations`, `prospects`, `users` |
| row counts | **all zero** — no migration invented a business fact |
| RLS enabled **and forced** | all 5 tables |
| policies attached | 11 |
| CHECK constraints | 11 |
| triggers | `events_no_update`, `events_no_delete` |

---

## 5. Behavioural verification — 26/26 on managed PostgreSQL

Run over the **transaction pooler** (the application path), against the **live `public` tables**.

A scratch schema would have been easier and would have proved less: it verifies that the migration
*files* describe a correct schema, not that *the schema production is running* enforces it. Those
diverge whenever a migration half-applies or a grant is later changed by hand.

**Every test runs inside a transaction that is unconditionally rolled back**, so nothing was
committed — verified afterwards by a residue check asserting all five tables are still empty. The
only trace is `events_seq_seq` advancement; sequences do not roll back. `seq` is an ordering signal,
never a count, so gaps carry no meaning — named here rather than hidden.

### Demonstrated, not asserted

| property | how it was shown |
|---|---|
| Tenant isolation | org A sees its 2 rows, org B sees its 1 |
| Default deny | unset `ascend.org_id` → **zero** rows, no error |
| Cross-tenant write | refused by `WITH CHECK` (`row-level security` violation) |
| **Held prospects readable** | visible to owner, sales **and automation** |
| **Held prospects immutable** | sales and automation both affect **0 rows**; the row is unchanged |
| No escape into held | automation cannot move a row into `held` to dodge the barrier |
| Automation ≠ judgment | `website_opportunity` / `assessed_by` / `assessed_at` → **permission denied** |
| Automation may observe | `website`, `website_quality` updates succeed — the grant is narrow, not total |
| Judgment needs provenance | authorless assessment → `assessment_has_provenance` violation |
| Append-only | `UPDATE`/`DELETE` on events → `events are append-only`, **even for the table owner** |
| No role can even try | all three roles → `permission denied` before reaching the trigger |
| Identity constraints | `anchored_iff_identified`, `held_states_its_reason`, unique `prospect_id` |
| §19 protection | operator event without a human, and system event with one, both refused |
| Absence stays absence | invalid `status` / `website_quality` refused, not coerced |
| Atomicity | rolled-back insert leaves the count unchanged |
| Transport | TLS 1.3, CA-verified, socket `remotePort` **6543** |

### Mutation controls — 5/5

A prohibited operation can fail for the wrong reason. Each control **removes the specific
protection** and requires the operation to then succeed. PostgreSQL takes DDL transactionally, so
every mutation was applied and rolled back inside its transaction — **the weakened schema was never
committed and never visible to another connection.**

| protection removed | result |
|---|---|
| `DROP TRIGGER events_no_delete` | the delete succeeds → the trigger is what enforces append-only |
| read policy narrowed to `anchored` | the held row **vanishes from the matcher** → its breadth is load-bearing |
| `GRANT UPDATE (website_opportunity…)` to automation | automation writes judgment → the column grant is what stops it |
| `DROP CONSTRAINT anchored_iff_identified` | an anchored prospect with no identity is admitted |
| — | a final check confirms all four rollbacks left production intact |

The second one is worth pausing on: it *demonstrates* the duplicate-creating failure. With the read
policy narrowed, the matcher can no longer see the very record whose existence stops it creating a
third copy of a business a human already flagged.

---

## 6. Findings

### 6.1 The login role has `BYPASSRLS` — RLS protects nothing outside `asPrincipal`

`postgres` holds `BYPASSRLS`; `ascend_owner`, `ascend_sales` and `ascend_automation` do not. So a
query issued on a bare connection sees **every organization's rows**, and tenant isolation exists
only inside a principal binding. Verified directly: a bare `SELECT` returned all three prospects
across both orgs.

This is not a defect — migrations and provisioning need it — and it is not a difference from PGlite,
where the login is a superuser and also bypasses RLS. But it converts F43's "one canonical reader"
from a tidiness rule into a **security** rule: a consumer that reaches past `listProspects()` loses
tenant isolation silently.

**Recommendation, not taken unilaterally:** give the application its own login role *without*
`BYPASSRLS`, so a forgotten `asPrincipal` fails closed instead of quietly returning everything.
That means provisioning a second credential, which is your decision.

### 6.2 `inet_server_port()` is to ports what `pg_stat_ssl` is to TLS

My first version of the transport check asserted `inet_server_port() = 6543` through the pooler. It
returns **5432** — like `pg_stat_ssl`, it describes the pooler→Postgres hop and knows nothing about
the endpoint this process dialled. Now measured from `socket.remotePort`, with the SQL value kept as
a documented contrast. The migration gate's direct-endpoint check was corrected the same way.

The pattern is worth naming, because it will recur: **through a pooler, no SQL function can describe
your own connection.** Only the client socket can.

### 6.3 No production authorization behaviour differed from PGlite

Nothing was adapted to make a test pass. The one behavioural difference found in this whole stage —
`SET ROLE` failing for a non-superuser `CREATEROLE` creator — was found in the previous gate and
fixed in the schema, not in the tests.

---

## 7. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| production migration gate | **14 passed** |
| production authorization gate | **26 passed** (incl. 5 mutation controls) |
| pooled principal isolation | **13 passed** |
| architecture fitness (F1–F44) | **147 passed** |
| full suite, live DB | **829 passed, 22 skipped, 37 files** |
| full suite, no DB | 792 passed, 59 skipped, 37 files |
| production tables after everything | **all 5 empty** |
| vault | untouched |

---

## 8. State now

| | |
|---|---|
| schema | 001, 002, 003 applied to `public` |
| data | **none** — all five tables empty |
| `ASCEND_PROSPECT_SOURCE` | **unset** — the vault is still authoritative |
| readers | unchanged; nothing reads Postgres |
| vault | untouched |

**Not done, deliberately:** the six-prospect migration · consumer parity against production · the
read flip · Sheets intake · the research engine · auth UI · wiring `core/db` to any surface.

---

## 9. Open items before the next gate

1. **A real backup path** — required before any data is written, and currently unavailable to me.
2. **`schema_migrations` ledger** — the database cannot currently state what has been applied.
3. **A non-`BYPASSRLS` application login** — so tenant isolation fails closed.

None blocks the six-prospect migration; all three are worth settling before the read flip.
