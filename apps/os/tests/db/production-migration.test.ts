// Layer A — THE PRODUCTION MIGRATION GATE. Applies 001→003 to the real database, then asks the
// SERVER what it ended up enforcing.
//
// GATED ON ITS OWN VARIABLE, and not on `ASCEND_TEST_DATABASE_URL`. This file WRITES SCHEMA TO
// PRODUCTION. Sharing a gate variable with the read-only isolation suite would mean that anyone
// exporting one variable to run tests silently issues DDL against the live database. The blast
// radius of a mistake here is the whole schema, so the trigger is deliberate and separate.
//
// DIRECT CONNECTION, NOT THE POOLER. DDL under a transaction pooler is not reliably
// session-consistent, and 001 creates roles, tables, policies and grants in one transaction.
//
// WHAT IT VERIFIES, and the distinction that makes the verification worth anything: it does NOT
// re-read the .sql files and diff them against themselves. Every assertion below queries
// `pg_catalog` — the server's own account of what it will enforce. A migration that ran but whose
// policies silently failed to attach would pass a file-diff and fail this.

import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, applyMigrations, assertVerifiedTls, connectionConfigFor, loadMigrations, MIGRATIONS, type SqlClient } from "@/core/db";
import { captureState, columnGrants, constraints, policies, rlsFlags, tableGrants, triggers } from "./introspect";

const DIRECT = process.env.ASCEND_MIGRATE_DATABASE_URL;
const describeIfMigrating = DIRECT ? describe : describe.skip;

const ARTIFACTS = path.join(process.cwd(), "docs", "stage2d");

describeIfMigrating("PRODUCTION MIGRATION (requires ASCEND_MIGRATE_DATABASE_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
    mkdirSync(ARTIFACTS, { recursive: true });
  }, 60_000);

  // ─── Before ──────────────────────────────────────────────────────────────────────────────────

  it("PRE: the public schema is empty — this gate refuses to run over an existing schema", async () => {
    const state = await captureState(db);
    // If tables already exist, the migration has been applied and re-running it is an ERROR, not a
    // no-op. Failing here is the correct outcome; it must not be "fixed" by adding IF NOT EXISTS.
    expect(state.publicTables).toEqual([]);
    expect(state.server).toMatch(/PostgreSQL 1[5-9]/);
  });

  it("PRE: the three ascend_* roles already exist and match what 001 expects", async () => {
    const state = await captureState(db);
    expect(state.ascendRoles.map((r) => r.rolname)).toEqual([
      "ascend_automation", "ascend_owner", "ascend_sales",
    ]);
    // 001 creates them `NOLOGIN` and nothing else. A role carrying LOGIN or elevated attributes
    // would NOT be the role the migration expects, and reusing it would silently widen authority.
    for (const r of state.ascendRoles) {
      expect(r.canlogin, `${r.rolname} must not be able to log in`).toBe(false);
      expect(r.superuser, `${r.rolname} must not be superuser`).toBe(false);
      expect(r.createrole, `${r.rolname} must not have CREATEROLE`).toBe(false);
    }
  });

  it("PRE: the login role can already ASSUME each role — the managed-Postgres defect is fixed", async () => {
    // The defect this gate exists downstream of: on PG16+ a CREATEROLE creator gets ADMIN but not
    // SET, so `SET LOCAL ROLE` fails and the whole authorization model is inert.
    const state = await captureState(db);
    for (const role of ["ascend_owner", "ascend_sales", "ascend_automation"]) {
      const canSet = state.roleGrants.some((g) => g.role === role && g.member === "postgres" && g.set);
      expect(canSet, `${role} is not SET-able by the login role`).toBe(true);
    }
  });

  // ─── Apply ───────────────────────────────────────────────────────────────────────────────────

  it("applies 001 → 002 → 003, each in its own transaction", async () => {
    const before = await captureState(db);
    writeFileSync(
      path.join(ARTIFACTS, "prod-state-01-pre-migration.json"),
      JSON.stringify({ capturedAt: new Date().toISOString(), ...before }, null, 2) + "\n"
    );

    const applied = await applyMigrations(db);
    expect(applied.map((a) => a.name)).toEqual([...MIGRATIONS]);
    console.info("\n  applied:\n" + applied.map((a) => `    ${a.name}  ${a.ms}ms`).join("\n"));

    const after = await captureState(db);
    writeFileSync(
      path.join(ARTIFACTS, "prod-state-02-post-migration.json"),
      JSON.stringify({ capturedAt: new Date().toISOString(), ...after }, null, 2) + "\n"
    );
    expect(after.publicTables).toEqual(["events", "memberships", "organizations", "prospects", "users"]);
    // Applied, and EMPTY. No migration may invent a business fact.
    expect(after.rowCounts).toEqual({ organizations: 0, users: 0, memberships: 0, prospects: 0, events: 0 });
  }, 120_000);

  it("IDEMPOTENCY: the role blocks tolerate the pre-existing roles, and the roles are unchanged", async () => {
    // The narrow, true claim. The role DO-blocks in 001 swallow `duplicate_object`, and the GRANT
    // re-issues cleanly — which is exactly the situation this database was in.
    const state = await captureState(db);
    expect(state.ascendRoles.map((r) => r.rolname)).toEqual([
      "ascend_automation", "ascend_owner", "ascend_sales",
    ]);
    for (const r of state.ascendRoles) {
      expect(r.canlogin).toBe(false);
      expect(r.superuser).toBe(false);
    }
    // Still assumable after the migration re-issued its grant.
    for (const role of ["ascend_owner", "ascend_sales", "ascend_automation"]) {
      expect(state.roleGrants.some((g) => g.role === role && g.member === "postgres" && g.set)).toBe(true);
      // …and never by inheritance. Authority is acquired by SET ROLE or not at all.
      const inherited = state.roleGrants.filter((g) => g.role === role && g.member === "postgres" && g.inherit);
      expect(inherited, `${role} is inherited passively by the login role`).toEqual([]);
    }
  });

  it("IDEMPOTENCY, honestly: re-running a migration FAILS — these files are forward-only", async () => {
    // Stated as a test rather than as a comment, because "the migrations are idempotent" is a claim
    // someone will otherwise carry forward from the role blocks to the whole file. They are not.
    // `CREATE TABLE organizations` on a migrated database is an error, and that is correct: a silent
    // second application is how a schema and its history stop agreeing.
    const [first] = loadMigrations();
    await expect(applyMigrations(db, [first])).rejects.toThrow(/already exists/);

    // And the failed re-run left the schema intact, because each file runs in a transaction.
    const state = await captureState(db);
    expect(state.publicTables).toEqual(["events", "memberships", "organizations", "prospects", "users"]);
    expect(state.rowCounts.prospects).toBe(0);
  }, 60_000);

  // ─── Verify, by asking the server ────────────────────────────────────────────────────────────

  it("VERIFY: row-level security is ENABLED and FORCED on every tenant table", async () => {
    const flags = await rlsFlags(db, "public");
    for (const t of ["prospects", "events", "memberships", "organizations", "users"]) {
      const row = flags.find((f) => f.table === t);
      expect(row, `${t} missing`).toBeDefined();
      expect(row!.enabled, `${t}: RLS not enabled`).toBe(true);
      // FORCE is the load-bearing half. Without it the TABLE OWNER bypasses every policy — and the
      // owner is the role the application connects as.
      expect(row!.forced, `${t}: RLS not FORCED — the owner would bypass every policy`).toBe(true);
    }
  });

  it("VERIFY: the read policy on prospects is NOT narrowed by identity_state", async () => {
    // The single most important line in the schema. A SELECT policy filtered to anchored rows turns
    // every held record into a matching miss, and an import then creates duplicates of exactly the
    // businesses a human flagged as duplicated. A hold is a WRITE barrier, not an information one.
    const read = (await policies(db, "public")).filter(
      (p) => p.tablename === "prospects" && p.cmd === "SELECT"
    );
    expect(read.length).toBeGreaterThan(0);
    for (const p of read) {
      expect(p.qual).toMatch(/current_org\(\)/);
      expect(p.qual ?? "", `${p.policyname} narrows reads by identity_state`).not.toMatch(/identity_state/);
    }
    // …while UPDATE policies DO narrow to anchored.
    const updates = (await policies(db, "public")).filter(
      (p) => p.tablename === "prospects" && p.cmd === "UPDATE"
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((p) => /identity_state/.test(`${p.qual} ${p.with_check}`))).toBe(true);
  });

  it("VERIFY: the identity and provenance CHECK constraints exist on the server", async () => {
    const defs = (await constraints(db, "public")).filter((c) => c.type === "c").map((c) => c.name);
    for (const name of [
      "anchored_iff_identified",
      "held_states_its_reason",
      "assessment_has_provenance",
      "operator_events_name_their_human",
      "system_events_name_no_human",
    ]) {
      expect(defs, `missing CHECK ${name}`).toContain(name);
    }
  });

  it("VERIFY: the append-only trigger is attached to events", async () => {
    const tg = await triggers(db, "public");
    const onEvents = tg.filter((t) => t.table === "events");
    expect(onEvents.length, "events has no trigger — append-only would rest on convention").toBeGreaterThan(0);
    expect(onEvents.map((t) => t.def).join("\n")).toMatch(/UPDATE|DELETE/);
  });

  it("VERIFY: automation holds no grant on the judgment columns", async () => {
    // Expressed as a GRANT rather than as an application check, so it cannot be forgotten at a call
    // site. `ascend_automation` is the research/import runner: it may record what it observed and
    // may not record what a human concluded.
    const grants = await columnGrants(db, "public", "prospects");
    const automationWritable = grants
      .filter((g) => g.grantee === "ascend_automation" && g.privilege === "UPDATE")
      .map((g) => g.column);
    for (const forbidden of ["website_opportunity", "assessed_by", "assessed_at"]) {
      expect(automationWritable, `automation may UPDATE ${forbidden}`).not.toContain(forbidden);
    }
    expect(automationWritable.length, "automation has no UPDATE grants at all").toBeGreaterThan(0);
  });

  it("VERIFY: nobody holds UPDATE or DELETE on events", async () => {
    const grants = (await tableGrants(db, "public")).filter((g) => g.table === "events");
    const mutating = grants.filter((g) => g.privilege === "UPDATE" || g.privilege === "DELETE");
    expect(mutating, "an event log with UPDATE/DELETE grants is not append-only").toEqual([]);
    expect(grants.some((g) => g.privilege === "INSERT")).toBe(true);
  });

  it("VERIFY: the connection that ran this was TLS-verified and DIRECT", async () => {
    // Measured from the SOCKET. `inet_server_port()` reports the backend Postgres, which is 5432
    // whether or not a pooler sits in front — so it cannot distinguish the two endpoints and must
    // not be used to. The socket knows which host and port this process actually dialled.
    const socket = assertVerifiedTls(raw);
    expect(socket.remotePort, "migrations must run over the DIRECT endpoint, not the pooler").toBe(5432);
    expect(socket.authorized).toBe(true);

    // On the DIRECT endpoint there is no pooler in between, so pg_stat_ssl IS our hop here — and it
    // agrees with the socket. Through the pooler it does not, which is why the socket is canonical.
    const [row] = (await db.query<{ ssl: boolean }>(
      `SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`)).rows;
    expect(row.ssl).toBe(true);
  });
});

describe("production migration — guard", () => {
  it("announces when the migration gate has NOT run", () => {
    if (!DIRECT) {
      expect(process.env.ASCEND_MIGRATE_DATABASE_URL).toBeUndefined();
      console.warn(
        "\n  ℹ️  PRODUCTION MIGRATION GATE NOT RUN — ASCEND_MIGRATE_DATABASE_URL is unset.\n" +
        "      This is the normal state. The variable is set deliberately, once, to apply schema.\n"
      );
    }
    expect(true).toBe(true);
  });
});
