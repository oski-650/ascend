# Stage 2D — Production Postgres Provisioning · Operator Runbook

**Status: repository prepared. No production database exists. No code flipped. Vault untouched.**

This document is for **you to execute**. I cannot provision a hosted database — it needs your account and your billing. Everything the repository can do without one is done.

---

## 0. Verified current state

Checked mechanically, not asserted:

| claim | verdict |
|---|---|
| every prospect consumer goes through the canonical reader | ✅ the only `hitListDir` references outside storage owners are **in comments** — F43 (comment-stripped) passes |
| `core/crm/promote.ts` is a declared writer | ✅ two `writeMarkdownFileAtomic` calls |
| no runtime module parses prospect markdown directly | ✅ remaining `gray-matter` users parse clients, documents and automations — `lib/opportunities.ts` reads `business_context.md`, the F15-recorded duplicate *client* reader, not prospects |
| consumer parity passes | ✅ 83 db-suite tests |
| `ASCEND_PROSPECT_SOURCE` unset | ✅ absent from all env files → resolves to `vault` |
| vault byte-identical | ✅ matches backup `ascend-20260827-035409` exactly |
| no production database provisioned | ✅ no `DATABASE_URL` / `POSTGRES*` anywhere |

Full suite: **782 passed, 9 skipped, 34 files.** tsc clean, 0 lint errors, build clean.

---

## 1. Provider

**Supabase**, used purely as managed Postgres. Not on your Mac — the partner must not depend on your laptop being awake, and that is an availability requirement, not a preference.

What is used: the Postgres instance, its pooler, TLS, and automated backups.
What is **not** used: `auth.uid()`, PostgREST, Supabase Storage, Realtime, or the JS SDK. F41 fails the build if any of those reach `core/`.

Any managed Postgres works. The schema uses no Supabase-specific construct, which is what keeps this reversible.

## 2. Version

**PostgreSQL 15 or newer.** The schema uses `gen_random_uuid()` (core since 13), `GENERATED`-free `bigserial`, `FORCE ROW LEVEL SECURITY` (9.5+), column-level `GRANT`, and `col_description`. Tested against **PostgreSQL 18.3** via PGlite. Supabase currently provisions 15/17 — both are fine.

## 3. Environment variables

```bash
# apps/os/.env.production.local — gitignored, never committed
ASCEND_DATABASE_URL=postgresql://…            # POOLED (see §6)
ASCEND_DATABASE_URL_DIRECT=postgresql://…     # DIRECT, migrations only (§7)
ASCEND_PROSPECT_SOURCE=vault                  # DO NOT change yet — §12

# for the isolation gate only, never in production
ASCEND_TEST_DATABASE_URL=postgresql://…
```

`ASCEND_PROSPECT_SOURCE` is written explicitly as `vault` so the active store is a stated fact rather than an inferred default.

## 4. Migrations, in order

```text
core/db/schema/001_substrate.sql     tables · constraints · triggers · RLS · roles · grants
core/db/schema/002_prospect_fields.sql  the five scoring/history columns + column comments
core/db/schema/003_prospect_notes.sql   prospect.notes (the Stage 2C finding)
```

Run **against the DIRECT connection** (§7), in this order, once. They are not idempotent — `CREATE TABLE` will fail on a second run, which is the correct behaviour for a schema that has already been applied.

## 5. Obtaining the connection string

Supabase dashboard → **Project Settings → Database → Connection string → URI**. Two are offered; you need both (§6, §7). Replace `[YOUR-PASSWORD]` with the database password set at project creation.

## 6. Which connection the application uses

**The pooled one** (Supabase port `6543`, transaction mode). The app is serverless-shaped and opens many short connections; direct connections exhaust the instance's limit.

⚠️ **Transaction-mode pooling is exactly why `asPrincipal` uses `SET LOCAL`.** A session-scoped `SET` would leak identity between requests sharing a pooled connection. That is the property §10 exists to prove, and it is unproven until it runs.

## 7. Migrations need the DIRECT connection

Port `5432`. Transaction-mode poolers do not reliably support session-level DDL, `CREATE ROLE`, or multi-statement scripts. Use the direct URL for migrations and the pooled URL for the application.

## 8. Credentials

Never in git. `apps/os/.gitignore` already excludes `.env*.local`; `.env.example` stays committed and carries **no values**. Rotate the database password if it is ever pasted into a chat, a terminal recording, or a ticket — the same reason your production `ASCEND_OS_PASSWORD` is already distinct from the dev one.

## 9. Roles

Created by `001_substrate.sql`, all `NOLOGIN` — they are assumed via `SET LOCAL ROLE`, never connected as:

| role | may |
|---|---|
| `ascend_owner` | full read/write on prospects; read organizations, users, memberships; append events |
| `ascend_sales` | read all prospects **including held**; insert; update sales/qualification/judgment/notes columns |
| `ascend_automation` | read all prospects **including held**; insert; update **research-owned columns only** |

## 10. Permissions — what the grants encode

Three rules are enforced by the database rather than by application code:

```text
ascend_automation has NO grant on  website_opportunity · assessed_by · assessed_at
                                   decision_maker_access · project_urgency · niche_alignment
                                   notes
   → automation cannot write a human judgment, a qualification, or the operator's prose,
     even if a future code path tried

RLS UPDATE policies require identity_state = 'anchored'
   → no automated path can write a HELD prospect (P3)

RLS SELECT policy is deliberately NOT narrowed by identity_state
   → held prospects stay MATCHABLE (P4) — a write barrier, not an information barrier
```

## 11. Backups

Supabase takes automated daily backups on paid tiers; free-tier projects do not. **Confirm which you are on before the migration**, because the vault stops being the only copy the moment reads flip. Until then the vault remains a complete rollback, and `/Users/oscar/AI/vault-backups/ascend-20260827-035409` is restore-verified.

## 12. Verifying TLS

The isolation suite includes a TLS check: it asserts `pg_stat_ssl.ssl = true` for any non-local host. Supabase requires TLS, so a plaintext connection string will fail that gate rather than quietly succeed.

## 13. Safe destroy / recreate during this phase

The database holds **no authoritative data** until reads flip. Until then it is disposable:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
DROP ROLE IF EXISTS ascend_owner, ascend_sales, ascend_automation;
-- then re-run 001 → 002 → 003
```

The isolation suite already does this for itself in an isolated `ascend_pool_test` schema, so it never touches your data.

**This ceases to be safe the moment `ASCEND_PROSPECT_SOURCE=postgres`.** After that the database is authoritative and this section does not apply.

---

## The gate, once the database exists

```bash
# 1 — migrations, DIRECT connection
psql "$ASCEND_DATABASE_URL_DIRECT" -f core/db/schema/001_substrate.sql
psql "$ASCEND_DATABASE_URL_DIRECT" -f core/db/schema/002_prospect_fields.sql
psql "$ASCEND_DATABASE_URL_DIRECT" -f core/db/schema/003_prospect_notes.sql

# 2 — THE BLOCKING GATE: pooled principal isolation
ASCEND_TEST_DATABASE_URL="$ASCEND_DATABASE_URL" npx vitest run tests/db/pooled-principal.test.ts
```

Step 2 is written and ready. It runs **nine** gates: sequential reuse, post-release cleanliness, concurrency, row visibility, failed-request cleanup, rollback, missing principal, unknown organization, TLS. It forces `max: 1` so every request shares one physical connection — a larger pool could hide a leak behind luck.

**Right now it skips and says so loudly**, because a security property that silently no-ops is worse than one that fails.

Only after those pass do the Stage 2B migration and its behavioural ledger run against production.

---

## What I added, and what I did not

**Added:** `pg` + `@types/pg` as **devDependencies**, and `tests/db/pooled-principal.test.ts`. Nothing else — no application code changed, no schema changed, no env changed.

`pg` will need to become a regular dependency when the app actually connects. It is a devDependency now because the only thing that uses it is a test, and I would rather not add an unverifiable production dependency.

**Did not:** install anything on your Mac, provision anything, flip anything, or touch the vault.

---

## The eight gate questions

| | | |
|---|---|---|
| 1 | production Postgres behaves identically to the tested database | ⛔ **no production database** |
| 2 | pooled principal isolation passes | ⛔ **written, skipped — unproven** |
| 3 | six prospects migrated without changing historical meaning | ⛔ not run against production |
| 4 | consumer-output parity passes | ✅ against PGlite |
| 5 | all consumers use the canonical reader | ✅ eleven, F43-enforced |
| 6 | vault byte-identical | ✅ verified against backup |
| 7 | `ASCEND_PROSPECT_SOURCE` unset | ✅ |
| 8 | ready for the read flip | ⛔ **NO** — 1, 2 and 3 are open |

**STOP.** Three answers are no, and all three need the database.

Next action is yours: create the Supabase project, put the two connection strings in `.env.production.local`, and tell me. Then §Gate runs, and if isolation passes we migrate the six and re-verify the ledger against production.
