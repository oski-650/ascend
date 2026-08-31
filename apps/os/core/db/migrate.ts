// core/db/migrate — apply the schema files, in order, over the DIRECT connection.
//
// WHY A MODULE RATHER THAN `psql -f`. The runbook originally said `psql`. This machine has no
// libpq, and installing one is not a decision to take silently — but the deeper reason is that
// `psql` would open its own connection with its own TLS posture, outside `core/db/pool.ts`. Every
// connection this system opens should be verified the same way, including the one that installs the
// security model.
//
// ONE TRANSACTION PER FILE. PostgreSQL takes DDL transactionally, so a file that fails halfway
// leaves NOTHING behind rather than half a schema. That matters most for 001, which creates the
// roles, the tables, the policies and the grants: a partial 001 would be a database that looks
// migrated and enforces only some of its rules — the worst possible state, because the missing half
// is invisible.
//
// FORWARD-ONLY, AND NOT RE-RUNNABLE. These files are not idempotent as wholes and are not intended
// to be: `CREATE TABLE organizations` fails on a second run. Only the ROLE blocks are idempotent,
// deliberately, because roles are cluster-wide and may already exist from another database or an
// earlier gate. Re-running a migration is an error, not a no-op, and this module does not pretend
// otherwise.
//
// THE LEDGER REFUSES, IT DOES NOT SKIP. `schema_migrations` (004) records what has been applied, so
// the database can answer "which migrations do I have?" without a human comparing two documents.
// The tempting next step — "skip anything already recorded" — is NOT taken: it converts a second
// run from an error into a no-op, and a migration re-applied silently is how a schema and its
// recorded history stop agreeing. A recorded version raises `MigrationAlreadyApplied`.
//
// CHECKSUMS. Each row stores the sha256 of the file as applied, so editing a migration after the
// fact is detectable instead of invisible.

import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SqlClient } from "./client";

/** In order. The order IS the dependency graph — 002 and 003 add columns to 001's tables. */
export const MIGRATIONS = [
  "001_substrate.sql",
  "002_prospect_fields.sql",
  "003_prospect_notes.sql",
  "004_schema_migrations.sql",
  "005_user_credentials.sql",
  "006_invitations.sql",
] as const;

export type Migration = { name: string; sql: string; checksum: string };

export class MigrationAlreadyApplied extends Error {}

/** sha256 of the file exactly as it will be executed. */
export function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function schemaDir(): string {
  return path.join(process.cwd(), "core", "db", "schema");
}

export function loadMigrations(dir = schemaDir()): Migration[] {
  return MIGRATIONS.map((name) => {
    const sql = readFileSync(path.join(dir, name), "utf8");
    return { name, sql, checksum: checksum(sql) };
  });
}

const LEDGER_EXISTS =
  `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`;

async function ledgerPresent(tx: SqlClient): Promise<boolean> {
  return (await tx.query<{ present: boolean }>(LEDGER_EXISTS)).rows[0].present;
}

export type AppliedMigration = { name: string; ms: number };

/**
 * Apply every migration, each inside its own transaction.
 *
 * Throws on the first failure, having rolled that file back. Files applied before it stay applied —
 * which is correct for forward-only migrations, and is why the gate reports exactly how far it got
 * rather than claiming all-or-nothing across the set.
 */
export async function applyMigrations(
  client: SqlClient,
  migrations: Migration[] = loadMigrations()
): Promise<AppliedMigration[]> {
  const applied: AppliedMigration[] = [];
  for (const m of migrations) {
    const started = Date.now();
    try {
      await client.transaction(async (tx) => {
        // The ledger check and the migration share one transaction, so a crash between them cannot
        // leave a schema change unrecorded or a record without its change.
        if (await ledgerPresent(tx)) {
          const seen = await tx.query<{ version: string }>(
            `SELECT version FROM schema_migrations WHERE version = $1`, [m.name]
          );
          if (seen.rows.length > 0) {
            throw new MigrationAlreadyApplied(
              `${m.name} is already recorded as applied. Re-running it is refused rather than ` +
                `skipped: a silent second application is how a schema and its history diverge.`
            );
          }
        }

        await tx.exec(m.sql);

        // Re-checked, because 004 CREATES the ledger — it must record itself.
        if (await ledgerPresent(tx)) {
          await tx.query(
            `INSERT INTO schema_migrations (version, checksum, applied_at_is_backfilled)
             VALUES ($1, $2, false)`,
            [m.name, m.checksum]
          );
        }
      });
    } catch (e) {
      if (e instanceof MigrationAlreadyApplied) throw e;
      throw new Error(
        `migration ${m.name} FAILED and was rolled back: ${(e as Error).message}. ` +
          `Applied before it: ${applied.map((a) => a.name).join(", ") || "none"}.`,
        { cause: e }
      );
    }
    applied.push({ name: m.name, ms: Date.now() - started });
  }
  return applied;
}

// ─── Ledger ────────────────────────────────────────────────────────────────────────────────────

export type LedgerRow = {
  version: string;
  applied_at: string;
  applied_by: string;
  checksum: string;
  applied_at_is_backfilled: boolean;
  note: string | null;
};

export async function ledgerStatus(client: SqlClient): Promise<LedgerRow[]> {
  return (await client.query<LedgerRow>(
    `SELECT version, to_char(applied_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS applied_at,
            applied_by, checksum, applied_at_is_backfilled, note
     FROM schema_migrations ORDER BY version`
  )).rows;
}

/** The highest applied version, or null. What "which version is this database on?" means. */
export async function currentVersion(client: SqlClient): Promise<string | null> {
  const rows = await ledgerStatus(client);
  return rows.length === 0 ? null : rows[rows.length - 1].version;
}

export type BackfillEntry = { version: string; appliedAt: string; appliedBy: string; note: string };

/**
 * Record migrations applied BEFORE the ledger existed.
 *
 * Every row is written with `applied_at_is_backfilled = true` and a mandatory note naming where the
 * timestamp came from. The flag is not decoration: a reconstructed timestamp bounds an event, it
 * does not witness it, and this system does not present one as the other. A `note` is required by
 * the schema, so a backfilled row cannot exist without stating its source.
 */
export async function backfillLedger(client: SqlClient, entries: BackfillEntry[]): Promise<void> {
  const byName = new Map(loadMigrations().map((m) => [m.name, m]));
  await client.transaction(async (tx) => {
    for (const e of entries) {
      const m = byName.get(e.version);
      if (!m) throw new Error(`cannot backfill unknown migration ${e.version}`);
      await tx.query(
        `INSERT INTO schema_migrations
           (version, applied_at, applied_by, checksum, applied_at_is_backfilled, note)
         VALUES ($1, $2::timestamptz, $3, $4, true, $5)`,
        [m.name, e.appliedAt, e.appliedBy, m.checksum, e.note]
      );
    }
  });
}

/**
 * Compare each recorded checksum with the file on disk today.
 *
 * A mismatch means a migration file was edited AFTER it was applied: the ledger says the database
 * has that version, and the file now describes something the database never received.
 */
export async function verifyChecksums(
  client: SqlClient,
  migrations: Migration[] = loadMigrations()
): Promise<{ version: string; recorded: string; onDisk: string }[]> {
  const rows = await ledgerStatus(client);
  const onDisk = new Map(migrations.map((m) => [m.name, m.checksum]));
  return rows
    .filter((r) => onDisk.has(r.version) && onDisk.get(r.version) !== r.checksum)
    .map((r) => ({ version: r.version, recorded: r.checksum, onDisk: onDisk.get(r.version)! }));
}
