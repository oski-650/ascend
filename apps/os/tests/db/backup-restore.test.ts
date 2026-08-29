// Layer A — THE RECOVERY GATE. A backup nobody has restored is a hope, not a recovery path.
//
// This suite does not check that a snapshot file parses. It builds a schema on the REAL managed
// server, fills it with the cases most likely to be lost in transit, dumps it, DESTROYS the schema,
// restores into a fresh one, and compares row for row.
//
// THE CASES ARE CHOSEN, NOT ARBITRARY. Each one has already been a real defect in this project or
// is the kind that survives a naive round-trip:
//
//   · a HELD prospect          — NULL identity plus a hold reason; the constraint pair is an
//                                equivalence, so a restore that coerced NULL would violate it
//   · empty string vs NULL     — Stage 2B lost exactly this distinction, twice
//   · dates                    — a date round-tripped through a JS Date in a behind-UTC zone
//                                previously came back a day early
//   · `events.seq` WITH GAPS   — seq is the ORDERING SIGNAL; bigserial renumbering would preserve
//                                every row and silently reorder history
//   · unicode, quotes, newlines in `notes` — the free-text column that carries operator judgment
//   · jsonb payloads           — including nested structure and nulls
//
// PRODUCTION IS NEVER TOUCHED. Everything happens in throwaway schemas that are dropped afterwards.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  adaptPoolClient, connectionConfigFor, digestOf, dumpSnapshot, loadMigrations, MIGRATIONS, restoreSnapshot,
  RestoreError, type SqlClient, type Snapshot,
} from "@/core/db";
import { requireAdminConnection } from "./introspect";

const CONNECTION = process.env.ASCEND_TEST_DATABASE_URL;
const describeIfDb = CONNECTION ? describe : describe.skip;

const SOURCE = "ascend_backup_src";
const TARGET = "ascend_backup_dst";

// DERIVED from MIGRATIONS, never a hardcoded list. An earlier version enumerated four filenames
// and went stale the moment 005 landed — a fixture that must be edited whenever the schema grows is
// a fixture that will eventually be edited wrongly.
const SCHEMA_SQL = MIGRATIONS
  .map((f) => readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8"))
  .join("\n");

describeIfDb("BACKUP AND RESTORE (requires ASCEND_TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let snapshot: Snapshot;

  /**
   * Build a schema WITHOUT mutating session state.
   *
   * `SET search_path` on a pooled connection is not safe here. Supavisor hands the same backend to
   * other client connections between transactions, so a session-level search_path leaks OUT of this
   * suite — it did, and it made sibling suites fail with `relation "organizations" does not exist`.
   * `SET LOCAL` inside a transaction is scoped to that transaction and cannot escape. Same rule the
   * pooled-principal suite already follows for roles and GUCs, applied to search_path.
   */
  const build = async (c: PoolClient, schema: string) => {
    await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await c.query(`CREATE SCHEMA ${schema}`);
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL search_path TO ${schema}`);
      await c.query(SCHEMA_SQL);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; }
  };

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(CONNECTION!), max: 2 });
    const c = await pool.connect();
    try {
      await requireAdminConnection(adaptPoolClient(c), "backup and restore");
      await build(c, SOURCE);
      // Transaction-scoped, for the reason given on `build`.
      await c.query("BEGIN");
      await c.query(`SET LOCAL search_path TO ${SOURCE}`);

      // The ledger, populated as a real database's would be. Applying the raw SQL creates the table
      // but records nothing, so without this the "snapshot carries its schema version" assertion
      // would pass against an empty list and prove nothing.
      for (const m of loadMigrations()) {
        await c.query(`INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)`,
                      [m.name, m.checksum]);
      }

      const org = (await c.query(`INSERT INTO organizations (slug,name) VALUES ('bk','BK') RETURNING id`)).rows[0].id;
      const usr = (await c.query(`INSERT INTO users (email,display_name) VALUES ('bk@test','Bk') RETURNING id`)).rows[0].id;
      await c.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'owner')`, [usr, org]);

      // An anchored prospect exercising empty-string-vs-NULL, dates, unicode and judgment fields.
      const anchored = (await c.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name,
           business_type, location, website, contact_name, contact_phone, contact_email, source,
           status, website_quality, website_opportunity, assessed_by, assessed_at,
           first_contact, last_contact, notes)
         VALUES ($1, gen_random_uuid(), 'anchored', 'bk-anchored', 'Tapia Tile & Marble',
           'tile', 'Modesto, CA', 'https://x.test', '', '209-555-0100', NULL, 'sheet',
           'contacted', 'outdated', 'yellow', $2, now(),
           '2026-06-10'::date, NULL, $3)
         RETURNING id`,
        [org, usr, "Line one\nLine two — “quoted”, ñ, 日本語, O'Brien\\path"]
      )).rows[0].id;

      // A HELD prospect: NULL identity, stated reason. The constraint pair is an equivalence.
      await c.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name)
         VALUES ($1, NULL, 'held', 'duplicate candidate of bk-anchored', 'bk-held', 'Tapia Tile and Marble Co')`,
        [org]
      );

      // Events with DELIBERATE seq gaps and identical occurred_at, so a renumbering restore is
      // detectable. Identical timestamps are the case that broke id-based ordering.
      const when = "2026-08-01T12:00:00.000Z";
      for (let i = 0; i < 5; i++) {
        await c.query(
          `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                               subject_entity, subject_entity_id, data, correlation_id)
           VALUES (gen_random_uuid(), $1, 'prospect.status_changed', $2, 'operator', $3,
                   'prospect', $4, $5::jsonb, $6)`,
          [org, when, usr, anchored, JSON.stringify({ i, from: null, to: "contacted", deep: { a: [1, 2, null] } }),
           i % 2 === 0 ? `corr-${i}` : null]
        );
        // Burn sequence values so `seq` is not 1..5. A bigserial restore would renumber densely and
        // this is what makes that visible.
        await c.query(`SELECT nextval(pg_get_serial_sequence('${SOURCE}.events','seq')) FROM generate_series(1,3)`);
      }
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
    finally { c.release(); }
  }, 120_000);

  afterAll(async () => {
    const c = await pool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${SOURCE} CASCADE`);
      await c.query(`DROP SCHEMA IF EXISTS ${TARGET} CASCADE`);
    } finally { c.release(); await pool.end(); }
  });

  const on = async <T>(fn: (db: SqlClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try { return await fn(adaptPoolClient(c)); } finally { c.release(); }
  };

  it("takes a snapshot carrying every row and the schema version it belongs to", async () => {
    snapshot = await on((db) => dumpSnapshot(db, SOURCE));
    expect(snapshot.rowCounts).toEqual({
      organizations: 1, users: 1, memberships: 1, prospects: 2, events: 5,
    });
    // A snapshot that cannot say which schema it belongs to cannot be safely restored.
    expect(snapshot.migrations.map((m) => m.version)).toEqual([...MIGRATIONS]);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the source really did have non-contiguous seq — otherwise the ordering check is vacuous", async () => {
    const events = snapshot.tables.find((t) => t.table === "events")!;
    const seq = events.rows.map((r) => Number(r[events.columns.indexOf("seq")]));
    expect(seq).toHaveLength(5);
    expect(seq[seq.length - 1] - seq[0], "seq values are dense; the renumbering test proves nothing")
      .toBeGreaterThan(4);
  });

  it("RESTORES into a fresh schema, byte for byte", async () => {
    // Built BEFORE a connection is checked out for the restore. Nesting `pool.connect()` inside
    // `on()` deadlocks the pool against itself — the outer client is held while the inner one waits
    // for a slot that only the outer can release.
    const c = await pool.connect();
    try { await build(c, TARGET); } finally { c.release(); }

    await on((db) => restoreSnapshot(db, snapshot, TARGET));

    const restored = await on((db) => dumpSnapshot(db, TARGET));
    // The digest covers row content only, so it is comparable across schemas and across time.
    expect(restored.digest, "restored content differs from the snapshot").toBe(snapshot.digest);
    expect(restored.rowCounts).toEqual(snapshot.rowCounts);
  }, 120_000);

  it("preserves events.seq EXACTLY — history is not silently reordered", async () => {
    const src = snapshot.tables.find((t) => t.table === "events")!;
    const restored = await on((db) => dumpSnapshot(db, TARGET));
    const dst = restored.tables.find((t) => t.table === "events")!;
    const seqOf = (t: typeof src) => t.rows.map((r) => String(r[t.columns.indexOf("seq")]));
    expect(seqOf(dst)).toEqual(seqOf(src));
  });

  it("the restored sequence does not collide with a restored row", async () => {
    // Without setval, the next append would reuse a seq already taken — a primary key collision at
    // best, and a corrupted ordering at worst.
    const c = await pool.connect();
    try {
      // Schema-qualified rather than search_path-dependent: no session state is touched at all.
      const [{ max }] = (await c.query<{ max: string }>(
        `SELECT max(seq)::text AS max FROM ${TARGET}.events`)).rows;
      const [{ next }] = (await c.query<{ next: string }>(
        `SELECT nextval(pg_get_serial_sequence('${TARGET}.events','seq'))::text AS next`)).rows;
      expect(Number(next)).toBeGreaterThan(Number(max));
    } finally { c.release(); }
  });

  it("preserves the awkward values: empty string ≠ NULL, dates, unicode, jsonb", async () => {
    const restored = await on((db) => dumpSnapshot(db, TARGET));
    const p = restored.tables.find((t) => t.table === "prospects")!;
    const col = (name: string) => p.columns.indexOf(name);
    const anchored = p.rows.find((r) => r[col("slug")] === "bk-anchored")!;
    const held = p.rows.find((r) => r[col("slug")] === "bk-held")!;

    // The distinction Stage 2B lost twice.
    expect(anchored[col("contact_name")], "empty string became NULL").toBe("");
    expect(anchored[col("contact_email")], "NULL became empty string").toBeNull();
    expect(anchored[col("last_contact")], "an absent date must stay absent").toBeNull();

    // The date that previously came back a day early. Cast to text server-side precisely so no
    // timezone is ever applied to a value that has none.
    expect(anchored[col("first_contact")]).toBe("2026-06-10");

    expect(anchored[col("notes")]).toContain("日本語");
    expect(anchored[col("notes")]).toContain("O'Brien\\path");
    expect(anchored[col("notes")]).toContain("\n");

    // A held prospect survives as held, with no identity and its reason intact.
    expect(held[col("prospect_id")]).toBeNull();
    expect(held[col("identity_state")]).toBe("held");
    expect(held[col("hold_reason")]).toContain("duplicate candidate");

    const e = restored.tables.find((t) => t.table === "events")!;
    const data = e.rows[0][e.columns.indexOf("data")] as { deep: { a: unknown[] } };
    expect(data.deep.a).toEqual([1, 2, null]);
  });

  it("REFUSES to restore over a non-empty schema", async () => {
    // Merging would produce a database that is neither the backup nor what preceded it, and nothing
    // afterwards could tell which rows came from where.
    await on(async (db) => {
      await expect(restoreSnapshot(db, snapshot, TARGET)).rejects.toThrow(RestoreError);
      await expect(restoreSnapshot(db, snapshot, TARGET)).rejects.toThrow(/already holds/);
    });
  });

  it("DETECTS a snapshot altered after it was taken", async () => {
    // Mutation control on the digest. Without it, "the digest matched" would be untested.
    const tampered: Snapshot = structuredClone(snapshot);
    const p = tampered.tables.find((t) => t.table === "prospects")!;
    p.rows[0][p.columns.indexOf("name")] = "Quietly Renamed Ltd";
    expect(digestOf(tampered.tables)).not.toBe(tampered.digest);
    await on(async (db) => {
      await expect(restoreSnapshot(db, tampered, "nonexistent_schema")).rejects.toThrow(/altered/);
    });
  });
});

describe("backup and restore — guard", () => {
  it("announces when the recovery gate has NOT run", () => {
    if (!CONNECTION) {
      console.warn(
        "\n  ⚠️  RECOVERY PATH NOT VERIFIED — ASCEND_TEST_DATABASE_URL is unset.\n" +
        "      A backup nobody has restored is not a backup.\n"
      );
    }
    expect(true).toBe(true);
  });
});
