// Test support — a REAL Postgres, in-process.
//
// PGlite is Postgres 18 compiled to WASM, so these tests exercise the ACTUAL constraints, triggers,
// grants and row-level-security policies in `core/db/schema/001_substrate.sql` — not a mock of
// them. That matters more here than in most suites: the Stage 2A claim is precisely that rules
// previously enforced by convention are now enforced by the database, and a fake would make that
// claim unfalsifiable.
//
// Each test gets a fresh in-memory database. No server, no fixtures on disk, nothing shared.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SqlClient, SqlValue } from "@/core/db";

/** Every migration, in order. A new file must be added here or it is silently never applied. */
const MIGRATIONS = ["001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql"];
const SCHEMA = MIGRATIONS.map((f) =>
  readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8")
).join("\n");

/** Adapt PGlite to the vendor-neutral SqlClient the production code speaks. */
function adapt(pg: PGlite): SqlClient {
  const client: SqlClient = {
    async query(sql, params) {
      const res = await pg.query(sql, params ? [...(params as SqlValue[])] : undefined);
      return { rows: (res.rows ?? []) as never[], affected: res.affectedRows ?? 0 };
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async transaction(fn) {
      await pg.exec("BEGIN");
      try {
        const out = await fn(client);
        await pg.exec("COMMIT");
        return out;
      } catch (e) {
        await pg.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return client;
}

export type TestDb = { client: SqlClient; close: () => Promise<void> };

/**
 * One database per test FILE, truncated between tests.
 *
 * Booting a WASM Postgres costs ~700 ms, so a fresh instance per test made this suite 24 s on its
 * own — a 10x slowdown of the whole run, which is how a suite stops being run. DDL (roles, policies,
 * grants, triggers) is created once and is exactly what these tests exercise; only ROWS need to be
 * clean between tests, and TRUNCATE gives that. Isolation is preserved where it is load-bearing.
 */
let shared: { pg: PGlite; client: SqlClient } | null = null;

export async function freshDb(): Promise<TestDb> {
  if (!shared) {
    const pg = new PGlite();
    await pg.exec(SCHEMA);
    shared = { pg, client: adapt(pg) };
  }
  // RESTART IDENTITY resets the `seq` sequence, so ordering assertions start from a known point
  // rather than inheriting a previous test's high-water mark.
  await shared.pg.exec("TRUNCATE events, prospects, memberships, users, organizations RESTART IDENTITY CASCADE");
  return { client: shared.client, close: async () => {} };
}
