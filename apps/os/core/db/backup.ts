// core/db/backup — a LOGICAL, VERIFIED recovery point.
//
// ─── WHY THIS EXISTS RATHER THAN `pg_dump` ─────────────────────────────────────────────────────
//
// `pg_dump` is the right default and is not available: libpq is not installed on this machine, and
// installing system software is not a decision to take unilaterally. Supabase's own PITR lives
// behind the dashboard and depends on the plan.
//
// So this is the interim mechanism, and its scope is stated rather than implied:
//
//   RESTORES        every row of every business table, including `events.seq`
//   DOES NOT RESTORE  schema, roles, policies, grants, triggers, indexes
//
// The second line is not a gap, because the schema lives in `core/db/schema/*.sql` under version
// control and is reproducible by running the migrations. A recovery is therefore two steps —
// migrations, then rows — and together they reconstruct the database completely. What this does not
// survive is losing the git repository and the snapshot file at the same time.
//
// ─── `events.seq` IS RESTORED EXPLICITLY, AND THAT IS THE WHOLE POINT ──────────────────────────
//
// `seq` is the event spine's ORDERING SIGNAL — the thing that replaced log position when the vault
// moved to Postgres, and the reason `event_id` was rejected for ordering (a UUIDv7's sub-millisecond
// bits are random). A restore that let `bigserial` re-number the rows would preserve every event and
// silently reorder history. So `seq` is dumped, inserted explicitly, and the sequence is then
// advanced past the highest value — otherwise the next append would collide with a restored row.
//
// ─── A BACKUP NOBODY HAS RESTORED IS NOT A BACKUP ──────────────────────────────────────────────
//
// The accompanying gate does not merely take a snapshot and check the file parses. It builds a
// schema, fills it with the awkward cases (a held prospect with no identity, an event log with
// deliberate `seq` gaps, NULLs, empty strings, unicode, jsonb), dumps it, DESTROYS it, restores
// into a fresh schema, and compares row for row.

import "server-only";
import { createHash } from "node:crypto";
import type { SqlClient } from "./client";

/**
 * Dump order is INSERT order, and it is a foreign-key topology, not an alphabetical list.
 * `memberships` references both `users` and `organizations`; `prospects` references `users` through
 * `assessed_by`, `assigned_to` and `created_by`.
 */
export const BACKED_UP_TABLES = [
  "organizations",
  "users",
  "memberships",
  "prospects",
  "events",
] as const;

export type TableSnapshot = { table: string; columns: string[]; rows: unknown[][] };

export type Snapshot = {
  formatVersion: 1;
  takenAt: string;
  server: string;
  database: string;
  /** The migration ledger as it stood. A snapshot restored onto a different schema version is a bug. */
  migrations: { version: string; checksum: string }[];
  tables: TableSnapshot[];
  rowCounts: Record<string, number>;
  /** sha256 over the canonical row content. Detects a snapshot altered after it was taken. */
  digest: string;
};

type Column = { name: string; type: string };

async function columnsOf(c: SqlClient, schema: string, table: string): Promise<Column[]> {
  return (await c.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table]
  )).rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

/**
 * How each column is read out of the server.
 *
 * `date` IS CAST TO TEXT IN SQL, and that is not a stylistic choice. The driver turns a `date` into
 * a JS `Date` at LOCAL midnight; converting that to an ISO string yields the PREVIOUS day for any
 * timezone ahead of UTC. This project has already lost a day this way once — `first_contact:
 * 2026-06-10` came back as the 9th — and a backup is the last place to reintroduce it. Letting
 * Postgres render the date means no timezone is ever applied to a value that has none.
 */
function selectExpr(col: Column): string {
  const q = `"${col.name}"`;
  return col.type === "date" ? `${q}::text AS ${q}` : q;
}

/** Stable digest of the rows only — independent of when the snapshot was taken or by whom. */
export function digestOf(tables: TableSnapshot[]): string {
  const h = createHash("sha256");
  for (const t of tables) {
    h.update(`\n#${t.table}:${t.columns.join(",")}`);
    for (const row of t.rows) {
      // JSON with a stable element order; Dates are already ISO strings by this point.
      h.update("\n" + JSON.stringify(row));
    }
  }
  return h.digest("hex");
}

/** Normalise driver values to something JSON round-trips without losing meaning. */
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Buffer) return v.toString("base64");
  return v;
}

export async function dumpSnapshot(c: SqlClient, schema = "public"): Promise<Snapshot> {
  const [meta] = (await c.query<{ v: string; db: string }>(
    `SELECT version() AS v, current_database() AS db`
  )).rows;

  const ledgerPresent = (await c.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`, [`${schema}.schema_migrations`]
  )).rows[0].present;

  const migrations = ledgerPresent
    ? (await c.query<{ version: string; checksum: string }>(
        `SELECT version, checksum FROM ${schema}.schema_migrations ORDER BY version`
      )).rows
    : [];

  const tables: TableSnapshot[] = [];
  const rowCounts: Record<string, number> = {};

  for (const table of BACKED_UP_TABLES) {
    const cols = await columnsOf(c, schema, table);
    if (cols.length === 0) continue;
    const columns = cols.map((x) => x.name);

    // ORDER BY the primary key so a dump is byte-stable across runs. `events` orders by `seq`,
    // which is also the ordering the restore must preserve.
    const order = table === "events" ? "seq" : table === "memberships" ? "user_id, organization_id" : "id";
    const res = await c.query<Record<string, unknown>>(
      `SELECT ${cols.map(selectExpr).join(", ")} FROM ${schema}.${table} ORDER BY ${order}`
    );
    const rows = res.rows.map((r) => columns.map((col) => plain(r[col])));
    tables.push({ table, columns, rows });
    rowCounts[table] = rows.length;
  }

  return {
    formatVersion: 1,
    takenAt: new Date().toISOString(),
    server: meta.v.split(" on ")[0],
    database: meta.db,
    migrations,
    tables,
    rowCounts,
    digest: digestOf(tables),
  };
}

export class RestoreError extends Error {}

/**
 * Restore a snapshot into `schema`, which must already carry the migrated structure and be EMPTY.
 *
 * Refuses to run against a non-empty target. A restore that merged into existing rows would produce
 * a database that is neither the backup nor what was there before, and no later check could tell
 * which rows came from where.
 */
export async function restoreSnapshot(c: SqlClient, snap: Snapshot, schema = "public"): Promise<void> {
  if (snap.formatVersion !== 1) throw new RestoreError(`unsupported snapshot format ${snap.formatVersion}`);
  if (digestOf(snap.tables) !== snap.digest) {
    throw new RestoreError(
      "snapshot digest does not match its contents — the file was altered after it was taken"
    );
  }

  await c.transaction(async (tx) => {
    for (const table of BACKED_UP_TABLES) {
      const [{ n }] = (await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${schema}.${table}`
      )).rows;
      if (Number(n) !== 0) {
        throw new RestoreError(
          `${schema}.${table} already holds ${n} row(s). Restore targets an EMPTY schema: merging ` +
            "would produce a database that is neither the backup nor what preceded it."
        );
      }
    }

    for (const t of snap.tables) {
      if (t.rows.length === 0) continue;
      const cols = t.columns.map((x) => `"${x}"`).join(", ");
      for (const row of t.rows) {
        const params = row.map((_, i) => `$${i + 1}`).join(", ");
        await tx.query(
          `INSERT INTO ${schema}.${t.table} (${cols}) VALUES (${params})`,
          row as never[]
        );
      }
    }

    // `events.seq` was inserted explicitly, so the sequence still points at 1 and the next append
    // would collide with a restored row. Advance it past the highest restored value.
    const events = snap.tables.find((t) => t.table === "events");
    if (events && events.rows.length > 0) {
      await tx.query(
        `SELECT setval(pg_get_serial_sequence($1, 'seq'),
                       (SELECT max(seq) FROM ${schema}.events))`,
        [`${schema}.events`]
      );
    }
  });
}
