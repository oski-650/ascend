// Layer A — 2D.1 PRODUCTION HARDENING. One-shot operational gate: provision the application login
// and install the migration ledger, then verify both against the live server.
//
// GATED ON `ASCEND_HARDEN_DATABASE_URL`, its own variable, for the same reason the migration gate
// has one: this file WRITES to production — it creates a login role and applies migration 004.
// Sharing a variable with a read-only suite would mean that running tests provisions credentials.
//
// DIRECT CONNECTION ONLY. Role creation and DDL are administrative, and the whole point of this
// gate is that administration and application traffic stop sharing a privilege level.

import { beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  adaptPoolClient, applyMigrations, APP_LOGIN_ROLE, ASSUMABLE_ROLES, backfillLedger,
  connectionConfigFor, currentVersion, describeAppLogin, ledgerStatus, loadMigrations,
  MigrationAlreadyApplied, provisionAppLogin, verifyChecksums, type SqlClient,
} from "@/core/db";

const DIRECT = process.env.ASCEND_HARDEN_DATABASE_URL;
const PASSWORD = process.env.ASCEND_APP_DB_PASSWORD;
const describeIfHardening = DIRECT && PASSWORD ? describe : describe.skip;

/**
 * When 001–003 were applied, taken from the gate artifact written at the time.
 *
 * This is a RECONSTRUCTED timestamp: it is the moment the post-migration state was captured, which
 * bounds the application from above but did not witness it. Every row written with it is flagged
 * `applied_at_is_backfilled = true` and carries this provenance in its `note`.
 */
const PRE_LEDGER_MIGRATIONS = ["001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql"];
const PRE_LEDGER_APPLIED_AT = "2026-08-28T09:14:36.144Z";
const PRE_LEDGER_NOTE =
  "Applied before the ledger existed (Stage 2D migration gate). Timestamp reconstructed from " +
  "docs/stage2d/prod-state-02-post-migration.json capturedAt; it bounds the application, it did not witness it.";

describeIfHardening("2D.1 PRODUCTION HARDENING (requires ASCEND_HARDEN_DATABASE_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  // ─── 1. The application login ────────────────────────────────────────────────────────────────

  it("provisions ascend_app, and it holds NO privilege of its own", async () => {
    await provisionAppLogin(db, PASSWORD!);
    const a = await describeAppLogin(db);

    expect(a.exists).toBe(true);
    expect(a.canLogin, "an application login must be able to log in").toBe(true);

    // The whole reason this role exists.
    expect(a.bypassRls, "ascend_app must NOT bypass row-level security").toBe(false);
    expect(a.superuser).toBe(false);
    expect(a.createRole).toBe(false);
    expect(a.createDb).toBe(false);
    expect(a.replication).toBe(false);

    // NOINHERIT: membership grants the ability to BECOME a role, never its privileges passively.
    expect(a.inherits, "ascend_app must not inherit its roles' privileges ambiently").toBe(false);

    expect(a.assumable).toEqual([...ASSUMABLE_ROLES].sort());

    // No table grant at all. This is stronger than RLS: a query outside a principal binding is not
    // filtered to zero rows, it is REFUSED.
    expect(a.directTableGrants, "ascend_app holds direct table privileges").toEqual([]);
  });

  it("is idempotent, and CORRECTS drift rather than tolerating it", async () => {
    // The strongest available drift: BYPASSRLS itself. A CREATEROLE admin that HOLDS BYPASSRLS can
    // grant it, and `postgres` does — so this reproduces the precise condition the whole hardening
    // effort exists to eliminate, and requires provisioning to take it back.
    await db.query(`ALTER ROLE ${APP_LOGIN_ROLE} BYPASSRLS CREATEDB INHERIT`);
    await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON prospects TO ${APP_LOGIN_ROLE}`);

    const drifted = await describeAppLogin(db);
    expect(drifted.bypassRls, "the drift was not established").toBe(true);
    expect(drifted.createDb).toBe(true);
    expect(drifted.inherits, "INHERIT would give the login ambient authority").toBe(true);
    expect(drifted.directTableGrants.length).toBeGreaterThan(0);

    await provisionAppLogin(db, PASSWORD!);

    const fixed = await describeAppLogin(db);
    expect(fixed.bypassRls, "re-provisioning did not revoke BYPASSRLS").toBe(false);
    expect(fixed.createDb, "re-provisioning did not revoke CREATEDB").toBe(false);
    expect(fixed.inherits, "re-provisioning did not restore NOINHERIT").toBe(false);
    expect(fixed.directTableGrants, "re-provisioning did not revoke the hand-granted privileges")
      .toEqual([]);
  });

  it("REFUSES to report success if the login is still dangerous", async () => {
    // SUPERUSER is the one attribute this connection cannot clear, so provisioning verifies rather
    // than fixes it. The alternative is silently succeeding against a login that defeats every
    // policy in the database.
    const attrs = await describeAppLogin(db);
    expect(attrs.bypassRls).toBe(false);
    expect(attrs.superuser).toBe(false);
    expect(attrs.replication).toBe(false);
    // The guard is wired. The condition itself cannot be produced from a non-superuser connection.
    expect(String(provisionAppLogin)).toMatch(/dangerous\.length > 0[\s\S]*ProvisioningError/);
  });

  it("refuses a weak or unquotable password", async () => {
    await expect(provisionAppLogin(db, "short")).rejects.toThrow(/at least 20/);
    await expect(provisionAppLogin(db, "x".repeat(20) + "'; DROP TABLE prospects; --")).rejects
      .toThrow(/single quote|backslash/);
  });

  // ─── 2. The migration ledger ─────────────────────────────────────────────────────────────────

  it("applies 004 and records itself", async () => {
    // RE-RUNNABLE BY ASSERTING STATE, not by assuming a fresh database. This gate is operational and
    // may legitimately be run twice — the claim being tested is what the ledger CONTAINS, which is
    // true whether this run wrote it or a previous one did. Applying unconditionally would make the
    // gate fail on its second run for a reason that says nothing about correctness.
    const four = loadMigrations().filter((m) => m.name === "004_schema_migrations.sql");
    const already = (await tableExists(db, "schema_migrations"))
      && (await ledgerStatus(db)).some((r) => r.version === "004_schema_migrations.sql");
    if (!already) {
      const applied = await applyMigrations(db, four);
      expect(applied.map((a) => a.name)).toEqual(["004_schema_migrations.sql"]);
    }

    const rows = await ledgerStatus(db);
    const own = rows.find((r) => r.version === "004_schema_migrations.sql");
    expect(own, "004 did not record itself").toBeDefined();
    // Observed, not reconstructed: the ledger existed at the moment it was written.
    expect(own!.applied_at_is_backfilled).toBe(false);
    expect(own!.note).toBeNull();
    expect(own!.checksum).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it("backfills 001–003, flagged as reconstructed and carrying their source", async () => {
    const present = new Set((await ledgerStatus(db)).map((r) => r.version));
    const missing = PRE_LEDGER_MIGRATIONS.filter((v) => !present.has(v));
    if (missing.length > 0) {
      await backfillLedger(db, missing.map((version) => ({
        version, appliedAt: PRE_LEDGER_APPLIED_AT, appliedBy: "postgres", note: PRE_LEDGER_NOTE,
      })));
    }

    const rows = await ledgerStatus(db);
    expect(rows.map((r) => r.version)).toEqual([
      "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql", "004_schema_migrations.sql",
    ]);
    for (const v of PRE_LEDGER_MIGRATIONS) {
      const row = rows.find((r) => r.version === v)!;
      // The distinction the whole flag exists for: these timestamps bound the event, they did not
      // witness it, and the row says so rather than presenting them as observations.
      expect(row.applied_at_is_backfilled, `${v} must be flagged as reconstructed`).toBe(true);
      expect(row.note).toContain("did not witness");
    }
  });

  it("a backfilled row cannot exist without stating its source — enforced by CHECK", async () => {
    await expect(db.query(
      `INSERT INTO schema_migrations (version, checksum, applied_at_is_backfilled, note)
       VALUES ('999_fake.sql', 'x', true, NULL)`
    )).rejects.toThrow(/backfilled_rows_state_their_source/);
  });

  it("answers which version the database is on", async () => {
    expect(await currentVersion(db)).toBe("004_schema_migrations.sql");
  });

  it("REFUSES a recorded migration — it does not silently skip it", async () => {
    // The distinction that makes this ledger safe. Skipping would turn a second run into a no-op,
    // and a migration re-applied silently is how a schema and its history stop agreeing.
    const four = loadMigrations().filter((m) => m.name === "004_schema_migrations.sql");
    await expect(applyMigrations(db, four)).rejects.toThrow(MigrationAlreadyApplied);
    await expect(applyMigrations(db, four)).rejects.toThrow(/refused rather than.*skipped/s);
  });

  it("CHECKSUMS: the files on disk match what was recorded as applied", async () => {
    expect(await verifyChecksums(db)).toEqual([]);
  });

  it("CHECKSUMS: an edited migration file is DETECTED", async () => {
    // Mutation control. Without it, "checksums match" would be a sentence nobody had tested.
    const tampered = loadMigrations().map((m) =>
      m.name === "002_prospect_fields.sql" ? { ...m, checksum: "0".repeat(64) } : m);
    const drift = await verifyChecksums(db, tampered);
    expect(drift.map((d) => d.version)).toEqual(["002_prospect_fields.sql"]);
  });

  it("the ledger is not readable by the application roles", async () => {
    // Operational metadata, not tenant data. Expressed as an absent grant rather than a policy.
    const grants = (await db.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.role_table_grants
       WHERE table_name = 'schema_migrations' AND grantee LIKE 'ascend%'`
    )).rows;
    expect(grants).toEqual([]);
  });

  it("PRODUCTION STILL HOLDS NO BUSINESS DATA", async () => {
    for (const t of ["prospects", "events", "organizations", "users", "memberships"]) {
      const [{ n }] = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`)).rows;
      expect(Number(n), `${t} is not empty`).toBe(0);
    }
  });
});

async function tableExists(db: SqlClient, name: string): Promise<boolean> {
  return (await db.query<{ present: boolean }>(
    `SELECT to_regclass('public.' || $1) IS NOT NULL AS present`, [name]
  )).rows[0].present;
}

describe("production hardening — guard", () => {
  it("announces when the hardening gate has NOT run", () => {
    if (!DIRECT) {
      expect(process.env.ASCEND_HARDEN_DATABASE_URL).toBeUndefined();
      console.warn(
        "\n  ℹ️  PRODUCTION HARDENING GATE NOT RUN — ASCEND_HARDEN_DATABASE_URL is unset.\n" +
        "      This is the normal state; the variable is set deliberately, once.\n"
      );
    }
    expect(true).toBe(true);
  });
});
