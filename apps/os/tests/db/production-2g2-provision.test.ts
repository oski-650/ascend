// PRODUCTION 2G.2 — MUTATION #2: give the existing app login its canonical role shape.
//
// ─── WHY NOT THE 2D.1 HARDENING GATE ───────────────────────────────────────────────────────────
//
// That gate also PROVES provisioning corrects drift, and it does so by CREATING the drift first:
// `ALTER ROLE ascend_app BYPASSRLS CREATEDB INHERIT` and a direct table grant on `prospects`. On
// production that opens a window in which the application login can bypass row-level security
// entirely — corrected moments later, but real, and well beyond "re-provision the login". It also
// re-applies 004. So this gate does one thing: `provisionAppLogin`, and then interrogates the result.
//
// ─── WHY MUTATION #2 EXISTS AT ALL ─────────────────────────────────────────────────────────────
//
// F45 forbids a migration granting the application login anything: "its privileges must arrive ONLY
// through role membership, so that what the application may do is described in exactly one place."
// So 006 created `ascend_invite` and could not hand it to `ascend_app`. Provisioning is that one
// place, and ASSUMABLE_ROLES is the list. Until this runs, invitation acceptance fails in
// production — correctly, and that intermediate state was asserted by the 006 gate.
//
// PostgreSQL role MEMBERSHIP is what decides whether a login may assume a role. It is independent of
// the table and column grants the role itself holds, which is why both are verified separately below.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor, type SqlClient } from "@/core/db";
import { APP_LOGIN_ROLE, ASSUMABLE_ROLES, describeAppLogin, provisionAppLogin } from "@/core/db/provision";

const DIRECT = process.env.ASCEND_PROVISION_APP_URL;
const PASSWORD = process.env.ASCEND_APP_DB_PASSWORD;
const describeIfProvisioning = DIRECT && PASSWORD ? describe : describe.skip;

describeIfProvisioning("PRODUCTION 2G.2 — re-provision the app login (ASCEND_PROVISION_APP_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("PRE · the login exists and does NOT yet hold ascend_invite", async () => {
    const before = await describeAppLogin(db);
    expect(before.exists).toBe(true);
    expect(before.assumable, "ascend_invite is already held — this gate has run").not.toContain("ascend_invite");
  });

  it("RE-PROVISIONS, and the login still holds NO privilege of its own", async () => {
    await provisionAppLogin(db, PASSWORD!);
    const a = await describeAppLogin(db);
    // Provisioning reconciles rather than merely creates: these are the attributes that would
    // defeat every policy in the database.
    expect({ superuser: a.superuser, bypassRls: a.bypassRls, replication: a.replication,
             createRole: a.createRole, createDb: a.createDb, inherits: a.inherits })
      .toEqual({ superuser: false, bypassRls: false, replication: false,
                 createRole: false, createDb: false, inherits: false });
    expect(a.canLogin).toBe(true);
  }, 120_000);

  it("now holds EXACTLY the canonical assumable set — no more, no less", async () => {
    const a = await describeAppLogin(db);
    expect([...a.assumable].sort()).toEqual([...ASSUMABLE_ROLES].sort());
    expect(a.assumable, "the whole point of mutation #2").toContain("ascend_invite");
  });

  it("holds no DIRECT table privilege — authority arrives only through membership", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE grantee = $1`,
      [APP_LOGIN_ROLE]);
    expect(rows[0].n, "the login holds a table grant of its own, which F45 exists to prevent").toBe(0);
  });

  it("ascend_invite's OWN grants are untouched by provisioning", async () => {
    // Provisioning reconciles the LOGIN. It must not have altered what the role it can assume may do.
    const cols = await db.query<{ t: string; c: string; p: string }>(
      `SELECT table_name AS t, column_name AS c, privilege_type AS p
         FROM information_schema.column_privileges WHERE grantee = 'ascend_invite'
        ORDER BY t, c, p`);
    expect(cols.rows.map((r) => `${r.t}.${r.c}:${r.p}`)).toEqual([
      "invitations.consumed_at:SELECT", "invitations.consumed_at:UPDATE",
      "invitations.expires_at:SELECT", "invitations.id:SELECT",
      "invitations.token_hash:SELECT", "invitations.user_id:SELECT",
      "users.id:SELECT",
      "users.password_algo:UPDATE", "users.password_hash:UPDATE", "users.password_set_at:UPDATE",
    ]);
  });

  it("PRODUCTION DATA IS UNCHANGED — provisioning moved no rows", async () => {
    const n = async (t: string) =>
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    expect({ users: await n("users"), memberships: await n("memberships"),
             prospects: await n("prospects"), invitations: await n("invitations") })
      .toEqual({ users: 1, memberships: 1, prospects: 6, invitations: 0 });
  });
});

// ─── THE QUESTION MEMBERSHIP ACTUALLY ANSWERS ──────────────────────────────────────────────────

const APP = process.env.ASCEND_VERIFY_APP_URL;
const describeIfApp = APP ? describe : describe.skip;

describeIfApp("PRODUCTION 2G.2 — the app login can ASSUME ascend_invite (read-only)", () => {
  let pool: Pool;

  beforeAll(() => { pool = new Pool({ ...connectionConfigFor(APP!, "app"), max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  it("connects AS ascend_app and successfully assumes ascend_invite", async () => {
    // Not "is it a member" read from a catalogue — the actual statement the acceptance transaction
    // runs, over the connection the application actually uses. This is the exact thing that would
    // have failed with "permission denied to set role" before the fix.
    const c = await pool.connect();
    try {
      const who = await c.query<{ u: string }>("SELECT current_user AS u");
      expect(who.rows[0].u).toMatch(/^ascend_app/);
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE ascend_invite");
      const now = await c.query<{ u: string }>("SELECT current_user AS u");
      expect(now.rows[0].u, "SET LOCAL ROLE did not take").toBe("ascend_invite");
      await c.query("ROLLBACK");
    } finally { c.release(); }
  }, 60_000);

  it("and still cannot read credential material while assuming it", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE ascend_invite");
      let denied = false;
      try { await c.query("SELECT password_hash FROM users LIMIT 1"); }
      catch { denied = true; }
      expect(denied, "ascend_invite read password_hash on production").toBe(true);
      await c.query("ROLLBACK");
    } finally { c.release(); }
  }, 60_000);
});
