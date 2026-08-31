// PRODUCTION 2G.2 — apply 006 and PROVE what it did. A one-shot operational gate.
//
// ─── WHY A GATED TEST AND NOT A SCRIPT ─────────────────────────────────────────────────────────
//
// Same reason the 2D migration, 2D.1 hardening and 2F provisioning gates are tests: a script writes
// DDL and prints "done", while this applies the migration and then INTERROGATES THE RESULT — the
// exact policy expression, the exact role list, the exact column grants. "Migration completed
// successfully" would pass while a recreated policy came back subtly wider, which is precisely the
// failure that does not announce itself.
//
// ─── GATED ON ITS OWN VARIABLE ─────────────────────────────────────────────────────────────────
//
// `ASCEND_MIGRATE_INVITATIONS_URL`. Its own, for the reason every writing gate has its own: this
// file MUTATES PRODUCTION, and sharing a variable with a read-only suite would mean running the
// test suite migrates the database.
//
// DIRECT CONNECTION ONLY. DDL under a transaction pooler is not reliably session-consistent, and
// 006 creates a role, a table, policies and grants — and DROPs and recreates a LIVE policy.
//
// ─── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────
//
// It does not re-provision `ascend_app`. That is a SECOND production mutation with its own
// authorization: 006 creates the infrastructure, provisioning gives the existing login its
// canonical assumable-role shape. So the assertion below EXPECTS `ascend_app` not to hold
// `ascend_invite` yet — recording the true intermediate state rather than a desired one.
//
// It also performs no invitation acceptance.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor, type SqlClient } from "@/core/db";
import { applyMigrations, currentVersion, loadMigrations } from "@/core/db/migrate";

const DIRECT = process.env.ASCEND_MIGRATE_INVITATIONS_URL;
const describeIfMigrating = DIRECT ? describe : describe.skip;

/**
 * Verification is gated SEPARATELY, and read-only.
 *
 * Welding it to the one-shot apply would mean the security definition could never be re-checked
 * after the day it was applied — the opposite of what these assertions are for. `ASCEND_VERIFY_006_URL`
 * may point at any admin connection; it writes nothing.
 */
const VERIFY = process.env.ASCEND_VERIFY_006_URL ?? DIRECT;
const describeIfVerifying = VERIFY ? describe : describe.skip;

describeIfMigrating("PRODUCTION 2G.2 — apply 006 (requires ASCEND_MIGRATE_INVITATIONS_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("PRE · production is at 005 and knows nothing of invitations", async () => {
    expect(await currentVersion(db)).toBe("005_user_credentials.sql");
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'invitations'`);
    expect(rows[0].n, "invitations already exists — this gate has run before").toBe(0);
  });

  it("APPLIES 006, in ONE transaction", async () => {
    // `applyMigrations` puts the ledger check, the DDL and the ledger insert in a single
    // transaction, so a failure anywhere leaves production at the pre-migration state rather than
    // exposing the intermediate window where `users_same_org` has been dropped and not recreated.
    const only = loadMigrations().filter((m) => m.name === "006_invitations.sql");
    expect(only).toHaveLength(1);
    const applied = await applyMigrations(db, only);
    expect(applied.map((a) => a.name)).toEqual(["006_invitations.sql"]);
    expect(await currentVersion(db)).toBe("006_invitations.sql");
  }, 120_000);

});

describeIfVerifying("PRODUCTION 2G.2 — the security definition after 006 (read-only, re-runnable)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(VERIFY!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("users_same_org came back with the intended expression AND role list", async () => {
    // The riskiest statement in the file: a live policy dropped and recreated. A policy that returns
    // subtly wider is a quieter failure than a missing table.
    const { rows } = await db.query<{ cmd: string; expr: string; roles: string[] }>(
      `SELECT polcmd AS cmd, pg_get_expr(polqual, polrelid) AS expr,
              (SELECT array_agg(rolname::text ORDER BY rolname::text) FROM pg_roles WHERE oid = ANY(polroles)) AS roles
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'users' AND p.polname = 'users_same_org'`);
    expect(rows, "users_same_org is missing after the migration").toHaveLength(1);
    expect(rows[0].cmd, "it is no longer SELECT-only").toBe("r");
    expect(rows[0].roles, "the policy is no longer scoped to the application roles")
      .toEqual(["ascend_automation", "ascend_owner", "ascend_sales"]);
    expect(rows[0].expr).toMatch(/memberships/);
    expect(rows[0].expr).toMatch(/current_org\(\)/);
  });

  it("ascend_invite exists with EXACTLY its intended grants", async () => {
    const cols = await db.query<{ table_name: string; column_name: string; privilege_type: string }>(
      `SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges
        WHERE grantee = 'ascend_invite' ORDER BY table_name, column_name, privilege_type`);
    const got = cols.rows.map((r) => `${r.table_name}.${r.column_name}:${r.privilege_type}`);
    expect(got).toEqual([
      "invitations.consumed_at:SELECT", "invitations.consumed_at:UPDATE",
      "invitations.expires_at:SELECT", "invitations.id:SELECT",
      "invitations.token_hash:SELECT", "invitations.user_id:SELECT",
      "users.id:SELECT",
      "users.password_algo:UPDATE", "users.password_hash:UPDATE", "users.password_set_at:UPDATE",
    ]);
  });

  it("ascend_invite CANNOT read password_hash — the read/write separation, on production", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.column_privileges
        WHERE grantee = 'ascend_invite' AND column_name = 'password_hash'
          AND privilege_type = 'SELECT'`);
    expect(rows[0].n, "the role that WRITES credentials can also read them").toBe(0);
    const tables = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE grantee='ascend_invite'`);
    expect(tables.rows[0].n, "ascend_invite holds a TABLE-level grant, which covers future columns").toBe(0);
  });

  it("invitations has RLS forced and the intended policies", async () => {
    const rls = await db.query<{ e: boolean; f: boolean }>(
      `SELECT relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE relname='invitations'`);
    expect(rls.rows[0]).toEqual({ e: true, f: true });
    const pol = await db.query<{ polname: string }>(
      `SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        WHERE c.relname='invitations' ORDER BY polname`);
    expect(pol.rows.map((r) => r.polname)).toEqual([
      "invitations_acceptance_burns", "invitations_acceptance_reads",
      "invitations_owner_issues", "invitations_owner_reads",
    ]);
  });

  it("MUTATION #2 HAS NOT HAPPENED — ascend_app does not yet hold ascend_invite", async () => {
    // The true intermediate state, asserted rather than glossed. F45 refused letting the migration
    // grant the login directly, so the capability arrives only when provisioning next runs — which
    // is a separate production mutation with its own authorization.
    const { rows } = await db.query<{ member: boolean }>(
      `SELECT pg_has_role('ascend_app', 'ascend_invite', 'MEMBER') AS member`);
    expect(rows[0].member,
      "ascend_app already holds ascend_invite — the migration granted the login directly, which F45 forbids"
    ).toBe(false);
  });

  it("PRODUCTION DATA IS UNCHANGED — a schema migration moved no rows", async () => {
    const n = async (t: string) =>
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    expect({ users: await n("users"), memberships: await n("memberships"),
             prospects: await n("prospects"), organizations: await n("organizations") })
      .toEqual({ users: 1, memberships: 1, prospects: 6, organizations: 1 });
    expect(await n("invitations"), "the migration created rows").toBe(0);
  });
});

describe("production 2G.2 — guard", () => {
  it("announces loudly when the migration gate has NOT run", () => {
    if (!DIRECT) {
      console.warn(
        "\n  ℹ️  PRODUCTION 2G.2 MIGRATION NOT RUN — ASCEND_MIGRATE_INVITATIONS_URL is unset.\n" +
        "      006 is applied by an explicit operational act, never by running the test suite.\n"
      );
    }
    expect(true).toBe(true);
  });
});
