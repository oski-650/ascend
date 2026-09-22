# Ascend OS — restoring recovery artifact <TS>

This file travels INSIDE the encrypted artifact `ascend-backup-<TS>.ascbk`, sealed under key
`<KEY_ID>`. The full procedure, and why each step exists, is `docs/RECOVERY-RUNBOOK.md` in the
repository. This is the short form.

## What this artifact is

- **Contains:** the `public` schema and every row; sequence state; RLS, policies, grants, functions,
  triggers; the migration ledger; Ascend's roles and memberships **without passwords**; a fidelity
  manifest taken from production before and after the dump, and — format `ascend-backup/3` — its own
  recovery contract: `recovery-manifest.sql` (the exact manifest SQL that produced it) and
  `PROVENANCE.json` (its SHA-256, the source commit, the ledger). **Also contains credential-derived
  material** (`users.password_hash`, scrypt; `invitations.token_hash`) **and PII.** See `CONTENTS.md`.
- **Does not contain:** the vault (Dependency R2), environment secrets, Supabase platform
  schemas/extensions (none of Ascend's objects depend on one), role passwords.

## Never

- **Never restore with a command that has no explicit target.** The 2D version of this file ran
  `createdb` / `psql -d …` with no host. In a shell that had just taken a backup, those commands
  reached the production cluster.
- **Never `DROP SCHEMA public` before replaying the dump.** `pg_dump --schema=public` does not
  re-grant the default `USAGE` to `PUBLIC`. A database restored that way looks complete, and
  `ascend_owner`, `ascend_sales` and `ascend_automation` cannot see a single table in it. (Found in
  R1a. The canonical restore keeps the target's own `public`.)
- **Never decrypt to a synced folder or into the repository**, and never copy the key next to the
  artifact.

## 1 · Verify the artifact

    shasum -a 256 -c ascend-backup-<TS>.ascbk.sha256
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON core/recovery/artifact.ts inspect   ascend-backup-<TS>.ascbk
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON core/recovery/artifact.ts verify    ascend-backup-<TS>.ascbk

`verify` finds key `<KEY_ID>` in `~/.config/ascend/backup-keys/`. If it is not there, recover that
key from its escrow. No other key opens this artifact.

## 2 · Restore and prove it, isolated (the canonical path)

    npm run recovery:verify -- --artifact ~/AscendBackups/ascend-backup-<TS>.ascbk --owner-email <owner email>

This empties the environment, opens the artifact in memory, and restores it into an **in-process
PGlite** with no network. It then verifies F1–F18 against the manifest production produced — computed
with the manifest SEALED in this artifact, never the repository's current one (RT-3) — and logs
in as the owner through the application's own code. No plaintext touches disk. **PASS = every test
passed, none skipped.**

## 3 · Restoring onto a real PostgreSQL server

This is not yet a proven path. It is **R1c**: a same-version, PostgreSQL 17 restore and server boot,
required before PostgreSQL disaster recovery is called production-proven. Until R1c documents and
proves it, follow `docs/RECOVERY-RUNBOOK.md` §5, which lists the known requirements (explicit
`--host`, `pg_restore` with platform `DEFAULT ACL` entries filtered, a kept `public` schema, and a
re-keyed `ascend_app`).

## What invalidates this artifact

- a migration beyond the ledger it records;
- time — it holds production as of <TS> and nothing after;
- a failed checksum or failed authentication (tampering, truncation, or the wrong key).
