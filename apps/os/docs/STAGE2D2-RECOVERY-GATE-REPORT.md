# Stage 2D.2 — Recovery Gate Report

**Date:** 2026-08-28
**Scope:** Determine PITR availability, establish an independent `pg_dump` artifact, prove it restores.

## Outcome: **RECOVERY GATE PASSED**

**Resolved 2026-08-28: the project is on the FREE plan. No PITR, no managed backups.** §10 records
the resulting recovery decision. One operator action remains — confirming the off-machine copy —
and it is yours by design, not a gap in the work.

No prospect data migrated. `ASCEND_PROSPECT_SOURCE` unset. Vault untouched. Production business
tables still at **zero rows**.

---

## 1. Is PITR available? — **NO. Free plan.** (Answered by the operator; §10)

### What the database does tell us

Probed over the direct connection:

| | |
|---|---|
| `wal_level` | `logical` |
| `archive_mode` | **`on`** |
| `archive_command` | `/usr/bin/admin-mgr wal-push …` (wal-g) |
| `archive_timeout` | 2 min |
| `pg_stat_archiver` | **40 segments archived, 0 failures**, last 2026-08-28T09:54:04Z |
| `pg_is_in_recovery()` | false (primary) |

So **continuous WAL archiving is running and healthy.** That is the *mechanism* PITR is built on.

### Why that is not an answer

WAL archiving being on does **not** mean point-in-time restore is available *to you*. Supabase runs
archiving for its own operational purposes on projects that have no user-facing PITR. What decides
the question is the **plan tier, the PITR add-on, and the retention window** — none of which exist
inside PostgreSQL.

The Management API would answer it, and it requires a personal access token:

```
GET https://api.supabase.com/v1/projects/flxpbdsptirkbwkkfzqc  →  HTTP 401 Unauthorized
```

The `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in your env is a **data-plane** key and cannot query the
platform. I did not create a token, because that is a credential decision.

### The answer, from the dashboard

**FREE plan — no PITR, no user-restorable managed backup.**

This is the case the paragraph above anticipated: the `pg_dump` artifact is not a secondary safety
net, it is **the only recovery path**. That single fact reorders the whole contract, and §10 records
the consequences.

**I did not change the plan or billing, and did not create a management API token.**

---

## 2. `libpq` installed — client tools only

```
pg_dump  (PostgreSQL) 18.6      psql (PostgreSQL) 18.6      pg_restore (PostgreSQL) 18.6
```

`brew list` shows **`libpq` only** — no PostgreSQL server was installed, no service registered, and
nothing is listening on 5432 locally. `pg_dump` 18.6 ≥ server 17.6, which is the required direction.

---

## 3. The backup artifact

**Location:** `~/AscendBackups/20260828T095715Z/` — outside the repository, outside iCloud, `chmod 700`.
Nothing is retained inside the repo, so there is nothing for git to ignore.

| artifact | bytes | SHA-256 |
|---|---|---|
| `ascend-public-20260828T095715Z.dump` (custom) | 43 087 | `0ea36d0d1ae49d4ea75ea4e727a7f6b64bab785322a00a1c1a90c112214b837f` |
| `ascend-public-20260828T095715Z-portable.sql` (plain, `--inserts`) | 31 760 | `faa0ab2c62ef42c8d3ff2033ae43d38cd892549871a5e1464c080d622cc357f2` |
| `ascend-public-20260828T095715Z.sql` (plain, COPY) | 32 423 | `a459906b07114ab59ee7b9def1232ea8d7ee60346821f4bf7d82df89bccd5723` |
| `globals-20260828T095715Z.sql` (roles, **contains password hashes** — local only, `0600`) | 8 747 | `0e02a9326c040310cecba0a32643b882b32f31537c491ed998f0d0f6dcee94cd` |
| `globals-20260828T095715Z-nopw.sql` (roles, no credentials — this is the one that travels) | — | see manifest |

Manifest `SHA256SUMS.txt`; `shasum -c` re-verified after all testing — all four **OK**.

**Production state captured:** migration version `004_schema_migrations.sql`; rows —
`organizations=0 users=0 memberships=0 prospects=0 events=0`, `schema_migrations=4`;
`events_seq_seq.last_value = 218`.

### Transport was certificate-verified, and that was proven, not assumed

`PGSSLMODE=verify-full` with the pinned `Supabase Root 2021 CA`. The password went via `PGPASSWORD`,
never in `argv` (so never visible in `ps`) and never echoed.

**Negative control:** the same command with a self-signed CA was **rejected** —
`SSL error: certificate verify failed`. With the pinned CA: `TLS=true TLSv1.3`. `rejectUnauthorized:
false` was never used anywhere.

---

## 4. Restore verification — an actual restore, twice

### 4a. Full-fidelity restore into an isolated database

No local PostgreSQL server exists and Docker is not installed, so the isolated target is a **separate
database** (`ascend_restore_verify`) on the same instance — created, restored, compared, **dropped**.
Production was never a restore target.

`pg_restore --exit-on-error --no-owner` → **exit 0, empty stderr.**

Then production and restored were compared by running identical catalogue queries against both and
diffing:

| aspect | result |
|---|---|
| tables | **IDENTICAL** (6) |
| columns — name, type, nullability, default | **IDENTICAL** (58) |
| constraints — full `pg_get_constraintdef` | **IDENTICAL** (30) |
| indexes — full `indexdef` | **IDENTICAL** (20) |
| triggers — full `pg_get_triggerdef` | **IDENTICAL** (2) |
| RLS enabled **and forced** | **IDENTICAL** (6) |
| policies — cmd, roles, USING, WITH CHECK | **IDENTICAL** (13) |
| table grants | **IDENTICAL** (23) |
| column grants | **IDENTICAL** (333) |
| functions — signature + body hash | **IDENTICAL** (3) |
| migration ledger | **IDENTICAL** (4) |
| sequences | **IDENTICAL** (1) |

Because production holds no rows, data semantics cannot be proven from production data — so the
**restored schema was exercised** with the cases most likely to be lost. **18/18 passed:**

UUIDv7 identity byte-exact · version nibble = 7 · `date` stays `2026-06-10` · empty string preserved ·
NULL not coerced · unicode/quote/backslash/newline intact · held prospect (no identity + reason) ·
held-without-reason refused · anchored-without-identity refused · duplicate identity refused ·
judgment-without-provenance refused · `seq` gaps preserved with exact ordering · identical
`occurred_at` still ordered · events `UPDATE` refused · events `DELETE` refused · operator event must
name a human · system event must not · invalid enum refused.

### 4b. Rebuild on vanilla PostgreSQL — the disaster that matters

4a restores onto the **same Supabase instance**. That covers a corrupted migration and says nothing
about losing the Supabase project. So the portable dump was also replayed into **PGlite** — a vanilla
PostgreSQL with no Supabase platform, no `supabase_admin`, no pooler. **6/6 passed:** all six tables,
every named CHECK, 11 policies, 2 triggers, 20 indexes, RLS **enabled and forced** on all six, the
ledger *with its backfill provenance intact*, and the constraints still **enforcing** (held-prospect
rules, append-only events, date and empty-string semantics).

Two Supabase-platform artifacts are stripped and neither is Ascend's: `ALTER DEFAULT PRIVILEGES FOR
ROLE supabase_admin`, and psql meta-commands.

### Three findings that changed the procedure

1. **`pg_dump`'s "plain" output is not pure SQL.** Version 18 wraps it in `\restrict` / `\unrestrict`.
   These are psql directives; any other executor fails on line 5. **Restore plain dumps with `psql`.**
2. **The default plain dump carries data in `COPY … FROM stdin` blocks**, whose payload is a psql
   streaming convention, not SQL. This surfaced only because `schema_migrations` has rows — with
   six prospects it would have been far worse. Hence the **`--inserts` portable artifact**.
3. **`CREATE SCHEMA public` collides with the target's own.** Both restore paths need
   `DROP SCHEMA public CASCADE` on the target first, and `pg_dump` leaves `search_path` empty, so a
   session must reset it before using unqualified names.

---

## 5. Did the backup alter production? — No

| check | before | after |
|---|---|---|
| business rows (all five tables) | 0 | **0** |
| migration ledger | 4 rows, `004…` | **4 rows, `004…`** |
| ledger checksum digest | — | `ec07293d5a67d7cd62f778705bdb86a0` |
| `events_seq_seq.last_value` | 218 | **218 — unchanged** |
| RLS enabled + forced on all tables | true | **true** |
| policies | 11 | **11** |
| `ascend_app` | no BYPASSRLS/SUPERUSER, NOINHERIT, 0 grants | **unchanged** |
| events emitted | 0 | **0** |
| databases | `postgres` + templates | **restored target dropped** |
| vault | — | **no file modified in 8 h** |

`pg_dump` is read-only; the sequence did not move, confirming the dump neither consumed nor reset it.

---

## 6. The recovery contract

### Mechanisms, in order

| rank | mechanism | status |
|---|---|---|
| **PRIMARY** | `pg_dump` artifact in `~/AscendBackups/` | ✅ **verified by restore, twice** |
| **SECONDARY** | `core/db/backup.ts` JSON snapshot in `apps/os/.backups/` | ✅ verified (2D.1) |
| ~~Supabase PITR / managed backups~~ | **unavailable on the Free plan** | ❌ |

There is no managed safety net. Both surviving mechanisms are files, and until one leaves this Mac
they share a single point of failure.

### Recovery procedure

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export PGSSLMODE=verify-full PGSSLROOTCERT=~/AscendBackups/ca/supabase-root-2021.crt
export PGHOST=<direct host> PGPORT=5432 PGUSER=postgres PGPASSWORD=<from .env.production.local>

# 0. verify the artifact BEFORE trusting it
cd ~/AscendBackups/<timestamp> && shasum -a 256 -c SHA256SUMS.txt

# 1. roles first — a single-schema dump records GRANTs but cannot carry the roles
psql -d postgres -f globals-<ts>.sql          # ignore "already exists" on existing roles

# 2. prepare the target (NEVER production while it holds data)
psql -d postgres -c "CREATE DATABASE ascend_recovered"
psql -d ascend_recovered -c "DROP SCHEMA public CASCADE"

# 3. restore, excluding Supabase platform ACLs a non-superuser cannot apply
pg_restore -l ascend-public-<ts>.dump | grep -v "DEFAULT ACL" > toc.list
pg_restore --dbname=ascend_recovered --exit-on-error --no-owner -L toc.list ascend-public-<ts>.dump

# 4. verify before switching anything
psql -d ascend_recovered -c "SET search_path TO public; SELECT version, applied_at_is_backfilled FROM schema_migrations ORDER BY version"
psql -d ascend_recovered -c "SELECT count(*) FROM prospects"
```

**Off Supabase entirely**, use the portable dump with `psql` on any PostgreSQL ≥ 17: create the eight
roles, `DROP SCHEMA public CASCADE`, then `psql -f ascend-public-<ts>-portable.sql`. Proven in §4b.

### What invalidates this recovery point

1. **Any write to production.** It captures a database with **zero business rows**. The moment the
   six prospects land it is stale — **take a fresh dump immediately after that migration**.
2. **A new migration.** The ledger inside the dump pins `004_schema_migrations.sql`; restoring it
   onto a different schema version is a mismatch.
3. **Checksum failure** on `shasum -c` — the artifact was altered or corrupted.
4. **Losing this Mac.** Both file-based mechanisms live here. This is the live gap.
5. **A schema file edited after being applied** — `verifyChecksums()` reports drift.

### Last verified restore point

**2026-08-28T09:57:15Z** — `20260828T095715Z`, restored and compared **twice** (isolated Supabase
database, and vanilla PostgreSQL), 12/12 structural aspects identical, 18/18 semantics, 6/6
independence.

---

## 7. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| architecture fitness (F1–F45) | **152 passed** |
| full suite, live DB + backup | **864 passed, 35 skipped, 41 files** |
| full suite, no DB | 801 passed, 98 skipped, 41 files |
| stability | two consecutive clean full runs |
| production business rows | **0** |
| vault | untouched |

### A harness defect this exposed

Running every gate together failed with `relation "organizations" does not exist` in a *different*
suite. Cause: `backup-restore` set a **session-level `search_path`** on a pooled connection, and
Supavisor hands that backend to other client connections between transactions — so the setting
leaked out of the suite. Converted to transaction-scoped `SET LOCAL` and schema-qualified names.

Worth noting because it is the same lesson as the pooled-principal suite, arriving from a new
direction: **on a transaction pooler, session state is not yours to set.** Two consecutive clean
full runs confirm the fix.

---

## 8. State now

| | |
|---|---|
| schema | 001–004 applied; ledger current at `004` |
| business data | **none** |
| application login | `ascend_app` — no BYPASSRLS, no direct grants |
| `ASCEND_PROSPECT_SOURCE` | **unset** — the vault is still authoritative |
| readers | unchanged; nothing reads Postgres |
| vault | untouched |

**Not done, deliberately:** the six-prospect migration · consumer parity against production · the
read flip · Sheets intake · the research engine · auth UI · wiring `core/db` to any surface.

---

## 9. What is still blocking

**Nothing technical.** One operator action, detailed in §10: copy the bundle off this Mac and
confirm its checksum matched at the destination.


---

## 10. Final recovery decision — recorded 2026-08-28

### The plan question is answered

**Supabase plan: FREE. PITR: NOT AVAILABLE. Managed backups: NONE user-restorable.**

Reported by the operator. Consistent with what the database showed: WAL archiving is running
(`archive_mode=on`, wal-g, 40 segments, 0 failures) purely for Supabase's own operations. That was
never evidence of user-restorable PITR, and it is not treated as such here.

**Nothing was upgraded. Billing was not touched. No management API token was created.**

### Consequence: the ranking inverts

| rank | mechanism | status |
|---|---|---|
| **PRIMARY** | `pg_dump` artifact, `~/AscendBackups/20260828T095715Z/` | ✅ verified by restore, twice |
| **SECONDARY** | `core/db/backup.ts` JSON snapshot, `apps/os/.backups/` | ✅ verified (2D.1) |
| ~~PITR~~ | unavailable on Free | ❌ |

There is no managed safety net. **If the Supabase project is lost, these files are the only path
back** — which is exactly why §4b (rebuilding on vanilla PostgreSQL, no Supabase present) was worth
doing, and why the copy must leave this Mac before any real data goes in.

### The off-machine bundle

    ~/AscendBackups/ascend-backup-20260828T095715Z.tar.gz      21 320 bytes
    sha256  d3c6431f4c8807db464d75b7d9ebe7bb043a4d4562458c0db6f94187732826eb

Verified end to end as the artifact you will actually copy: checksum checked, extracted to a
different directory, manifest re-verified (6/6), and the extracted portable dump **rebuilt Ascend on
vanilla PostgreSQL, 6/6**.

**It carries NO credential material.** `pg_dumpall --globals-only` includes SCRAM-SHA-256 password
hashes for `ascend_app` and `postgres`; a stolen SCRAM verifier is enough to authenticate, so it is
a secret, not merely a hash. The bundle therefore ships `--no-role-passwords` globals instead, and
the hash-bearing file stays local at mode `0600`. Nothing is lost: `provisionAppLogin` recreates
`ascend_app` from `ASCEND_APP_DB_PASSWORD`. A full-text scan of all 7 extracted files finds no
credential material.

The bundle includes `RESTORE.md` and the pinned CA, so it is self-describing on a machine that has
never seen this repository.

### Final readiness — all 13 required conditions

| # | condition | evidence |
|---|---|---|
| 1 | verified production backup exists | `20260828T095715Z` |
| 2 | outside repo and iCloud | `~/AscendBackups/`, `chmod 700` |
| 3 | checksum verifies | 6 of 6 files OK |
| 4 | restore performed and compared | 12/12 structural · 18/18 semantics · 6/6 vanilla-PG |
| 5 | production unchanged | ledger 4 rows, schema identical |
| 6 | no business rows | **0** across all five tables |
| 7 | migration ledger correct | `004_schema_migrations.sql`, 3 backfilled + flagged |
| 8 | RLS intact | enabled **and forced** on 6 tables |
| 9 | `ascend_app` non-BYPASSRLS | `bypassrls=false super=false inherit=false`, 0 direct grants |
| 10 | TLS CA-verified | `verify-full` OK, TLSv1.3 |
| 11 | pooled principal isolation | **13 passed** |
| 12 | no vault changes | nothing modified in 10 h |
| 13 | `ASCEND_PROSPECT_SOURCE` | **unset** |

Suite: **864 passed, 35 skipped, 41 files**. Fitness F1–F45: 152. `tsc` clean.

### One number that moved, and why

`events_seq_seq.last_value` was **218** when the dump was taken and is now **343**. This is *not* a
change the backup caused — it was 218 immediately after `pg_dump`, confirming the dump neither
consumed nor reset it. The advance came from the test suites that followed: they append events
inside transactions that always roll back, and **sequence allocation does not roll back**.

That is expected and carries no meaning. `seq` is the event spine's ORDERING signal, never a count,
so gaps are information-free. It is recorded here only because a number that moved without
explanation is exactly the kind of thing that should never be waved through.

### What must happen before 2E

**One operator action: confirm the off-machine copy exists.**

    shasum -a 256 -c ~/AscendBackups/ascend-backup-20260828T095715Z.tar.gz.sha256   # verify first
    # then copy ascend-backup-20260828T095715Z.tar.gz to an external drive or private cloud storage
    # and verify the checksum again AT THE DESTINATION

The instruction for this gate was to *require* that confirmation rather than assume it, so 2E does
not begin until you say the copy exists and its checksum matched at the destination.

### Recurring backup, once data exists

A recovery point captures a moment. This one captures an empty database, so it expires the instant
the six prospects land. After 2E, take a fresh dump immediately, and thereafter on a schedule — the
`pg_dump` invocation is recorded in §6 and needs no new tooling.
