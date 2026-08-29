# Ascend OS — production recovery artifact

Taken  : <TS> (UTC)   Source: Supabase project flxpbdsptirkbwkkfzqc, PostgreSQL 17.6
Schema : migration ledger at 004_schema_migrations.sql
Rows   : organizations=0 users=0 memberships=0 prospects=0 events=0, schema_migrations=4

CONTAINS NO CREDENTIALS. Role password hashes are deliberately excluded; `ascend_app` is recreated
from ASCEND_APP_DB_PASSWORD via core/db/provision.ts. The schema itself lives in git under
core/db/schema/, so a full rebuild is: roles -> schema -> rows.

## 0. Verify before trusting
    shasum -a 256 -c SHA256SUMS.txt

## 1. Restore onto PostgreSQL >= 17 (any provider, or none)
    createdb ascend_recovered
    psql -d ascend_recovered -c "DROP SCHEMA public CASCADE"
    psql -d ascend_recovered -f globals-<TS>-nopw.sql      # roles; "already exists" is fine
    psql -d ascend_recovered -f ascend-public-<TS>-portable.sql

The -portable.sql file uses INSERT statements, so ANY SQL client can replay it. The plain
ascend-public-<TS>.sql uses COPY blocks and psql meta-commands and MUST be run with psql.

## 2. Or restore with pg_restore (custom format, richer)
    pg_restore -l ascend-public-<TS>.dump | grep -v "DEFAULT ACL" > toc.list
    pg_restore --dbname=ascend_recovered --exit-on-error --no-owner -L toc.list ascend-public-<TS>.dump

"DEFAULT ACL" lines are Supabase-platform grants a non-superuser cannot apply; excluding them is
expected and loses nothing belonging to Ascend.

## 3. Verify the restore
    psql -d ascend_recovered -c "SET search_path TO public;
      SELECT version, applied_at_is_backfilled FROM schema_migrations ORDER BY version"
    psql -d ascend_recovered -c "SELECT count(*) FROM prospects"

applied_at_is_backfilled = true means that timestamp was RECONSTRUCTED, not observed.

## 4. Connecting to Supabase with certificate verification
    PGSSLMODE=verify-full PGSSLROOTCERT=./supabase-root-2021.crt
Never use sslmode=require: it disables certificate verification.

## What invalidates this recovery point
- any write to production (it captures ZERO business rows)
- a new migration beyond 004
- checksum failure
