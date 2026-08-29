// Layer A — THE APPLICATION LOGIN GATE (2D.1).
//
// Everything above this file verified the SCHEMA. This one verifies the CREDENTIAL the application
// will actually hold, because a correct schema reached through an over-privileged login is not a
// secure system — it is a secure system with the door propped open.
//
// ─── THE FAILURE MODE BEING REMOVED ────────────────────────────────────────────────────────────
//
// While the application connected as `postgres`, which holds BYPASSRLS, tenant isolation existed
// ONLY inside `asPrincipal`. A query that skipped the wrapper did not error — it returned every
// organization's rows, silently. The security boundary depended on developers remembering.
//
// `ascend_app` inverts that. It holds no table privilege of its own, so a query outside a principal
// binding is REFUSED rather than over-answered. The intended shape:
//
//   human identity → session → organization/user context → RLS → canonical reader
//
// ─── HOW FIXTURES WORK HERE, AND WHY THEY DIFFER FROM THE OTHER SUITES ─────────────────────────
//
// `production-authorization.test.ts` seeds inside a rolled-back transaction, which works because it
// runs on an admin connection. This suite cannot: `ascend_app` may not INSERT an organization, and
// granting it that ability would be weakening the model to make the test convenient.
//
// So fixtures are COMMITTED by an admin connection, exercised by the application connection, and
// deleted in `afterAll` — with the deletion also verified. Nothing here inserts events: the event
// log is append-only by trigger and by grant, and a test must not need an exception to that.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { assertVerifiedTls, connectionConfigFor } from "@/core/db";

const APP = process.env.ASCEND_DATABASE_URL;
const ADMIN = process.env.ASCEND_DATABASE_URL_DIRECT;
const describeIfDb = APP && ADMIN ? describe : describe.skip;

const PREFIX = "applogin";

describeIfDb("PRODUCTION APPLICATION LOGIN (requires ASCEND_DATABASE_URL + _DIRECT)", () => {
  let app: Pool;
  let admin: Pool;
  const ids = { orgA: "", orgB: "", oscar: "", anchored: "", held: "" };

  beforeAll(async () => {
    // max:1 on the application pool so principal switches share one physical connection — a larger
    // pool could hide an identity leak behind luck.
    app = new Pool({ ...connectionConfigFor(APP!), max: 1 });
    admin = new Pool({ ...connectionConfigFor(ADMIN!, "migration"), max: 1 });

    const c = await admin.connect();
    try {
      await cleanup(c);
      const one = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];
      ids.orgA = (await one(`INSERT INTO organizations (slug,name) VALUES ($1,'A') RETURNING id`, [`${PREFIX}-a`])).id;
      ids.orgB = (await one(`INSERT INTO organizations (slug,name) VALUES ($1,'B') RETURNING id`, [`${PREFIX}-b`])).id;
      ids.oscar = (await one(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${PREFIX}@test`])).id;
      await c.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'owner')`, [ids.oscar, ids.orgA]);
      ids.anchored = (await one(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
         VALUES ($1, gen_random_uuid(), 'anchored', $2, 'Anchored') RETURNING id`,
        [ids.orgA, `${PREFIX}-anchored`])).id;
      ids.held = (await one(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name)
         VALUES ($1, NULL, 'held', 'duplicate candidate', $2, 'Held') RETURNING id`,
        [ids.orgA, `${PREFIX}-held`])).id;
      await c.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
         VALUES ($1, gen_random_uuid(), 'anchored', $2, 'Other')`, [ids.orgB, `${PREFIX}-other`]);
    } finally { c.release(); }
  }, 60_000);

  afterAll(async () => {
    const c = await admin.connect();
    try { await cleanup(c); } finally { c.release(); }
    await app.end();
    await admin.end();
  });

  async function cleanup(c: PoolClient) {
    // Organizations cascade to prospects and memberships; users are independent.
    await c.query(`DELETE FROM organizations WHERE slug LIKE $1`, [`${PREFIX}-%`]);
    await c.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`]);
  }

  /** Run on the APPLICATION connection, always rolling back. */
  async function asApp<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      try { return await fn(c); } finally { await c.query("ROLLBACK"); }
    } finally { c.release(); }
  }

  async function actAs(c: PoolClient, role: string, org: string, user: string | null) {
    await c.query("SET LOCAL ROLE NONE");
    await c.query("SELECT set_config('ascend.org_id', $1, true)", [org]);
    await c.query("SELECT set_config('ascend.user_id', $1, true)", [user ?? ""]);
    await c.query(`SET LOCAL ROLE ${role}`);
  }

  async function mustFail(c: PoolClient, sql: string, params: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT p");
    try {
      await c.query(sql, params);
      await c.query("ROLLBACK TO SAVEPOINT p");
      throw new Error(`EXPECTED REFUSAL, but it was ALLOWED: ${sql.trim().split("\n")[0]}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/EXPECTED REFUSAL/.test(msg)) throw e;
      await c.query("ROLLBACK TO SAVEPOINT p");
      return msg;
    }
  }

  // ─── Who the application is ──────────────────────────────────────────────────────────────────

  it("connects as ascend_app — not postgres, and not a superuser", async () => {
    const c = await app.connect();
    try {
      const [row] = (await c.query<{ usr: string; su: boolean; brls: boolean }>(
        `SELECT current_user AS usr,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS brls`)).rows;
      expect(row.usr).toBe("ascend_app");
      expect(row.su).toBe(false);
      expect(row.brls, "the application login can bypass row-level security").toBe(false);
    } finally { c.release(); }
  });

  it("A BARE CONNECTION IS REFUSED, not merely filtered — the strongest form of the guarantee", async () => {
    // The heart of this gate. Under the old `postgres` login this query returned every row in the
    // table across every tenant. Now it does not return a smaller answer; it returns no answer.
    await asApp(async (c) => {
      const msg = await mustFail(c, `SELECT * FROM prospects`);
      expect(msg).toMatch(/permission denied/i);
      // Same for the event spine and the tenancy tables.
      expect(await mustFail(c, `SELECT * FROM events`)).toMatch(/permission denied/i);
      expect(await mustFail(c, `SELECT * FROM organizations`)).toMatch(/permission denied/i);
      // …and the migration ledger, which is not the application's business at all.
      expect(await mustFail(c, `SELECT * FROM schema_migrations`)).toMatch(/permission denied/i);
    });
  });

  it("holds no ambient authority — privileges arrive only by assuming a role", async () => {
    await asApp(async (c) => {
      // NOINHERIT: being a MEMBER of ascend_owner grants nothing until the role is assumed.
      expect(await mustFail(c, `SELECT * FROM prospects`)).toMatch(/permission denied/i);
      await actAs(c, "ascend_owner", ids.orgA, ids.oscar);
      const rows = await c.query(`SELECT slug FROM prospects`);
      expect(rows.rowCount).toBeGreaterThan(0);
    });
  });

  // ─── Tenant isolation, now enforced by the database rather than by discipline ────────────────

  it("sees ONLY its own organization's rows", async () => {
    await asApp(async (c) => {
      await actAs(c, "ascend_owner", ids.orgA, ids.oscar);
      const a = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      expect(a.rows.map((r) => r.slug)).toEqual([`${PREFIX}-anchored`, `${PREFIX}-held`]);

      await actAs(c, "ascend_owner", ids.orgB, ids.oscar);
      const b = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      expect(b.rows.map((r) => r.slug)).toEqual([`${PREFIX}-other`]);
    });
  });

  it("SWITCHING PRINCIPAL does not leak the previous one", async () => {
    await asApp(async (c) => {
      await actAs(c, "ascend_owner", ids.orgA, ids.oscar);
      const first = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      await actAs(c, "ascend_sales", ids.orgB, ids.oscar);
      const second = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      const who = await c.query<{ r: string }>(`SELECT current_user AS r`);

      expect(second.rows.map((r) => r.slug)).toEqual([`${PREFIX}-other`]);
      expect(second.rows).not.toEqual(first.rows);
      expect(who.rows[0].r).toBe("ascend_sales");
    });
  });

  it("A RELEASED POOLED CONNECTION carries neither user nor organization", async () => {
    // max:1, so the next checkout is the same physical connection. `SET LOCAL` is transaction
    // scoped; anything surviving here would be one request inheriting another's authority.
    await asApp(async (c) => { await actAs(c, "ascend_owner", ids.orgA, ids.oscar); });

    const c = await app.connect();
    try {
      const [row] = (await c.query<{ r: string; org: string | null; usr: string | null }>(
        `SELECT current_user AS r,
                nullif(current_setting('ascend.org_id',  true),'') AS org,
                nullif(current_setting('ascend.user_id', true),'') AS usr`)).rows;
      expect(row.r).toBe("ascend_app");
      expect(row.org).toBeNull();
      expect(row.usr).toBeNull();
      // And with no principal, it can read nothing at all.
      await expect(c.query(`SELECT * FROM prospects`)).rejects.toThrow(/permission denied/i);
    } finally { c.release(); }
  });

  // ─── The application cannot change the rules it operates under ───────────────────────────────

  it("cannot alter policies, drop triggers, or create tables", async () => {
    await asApp(async (c) => {
      expect(await mustFail(c,
        `ALTER POLICY prospects_read ON prospects USING (true)`)).toMatch(/must be owner|permission denied/i);
      expect(await mustFail(c,
        `DROP TRIGGER events_no_delete ON events`)).toMatch(/must be owner|permission denied/i);
      expect(await mustFail(c,
        `CREATE TABLE smuggled (id int)`)).toMatch(/permission denied/i);
      expect(await mustFail(c,
        `ALTER TABLE prospects DISABLE ROW LEVEL SECURITY`)).toMatch(/must be owner|permission denied/i);
      expect(await mustFail(c,
        `ALTER TABLE prospects DROP CONSTRAINT anchored_iff_identified`)).toMatch(/must be owner|permission denied/i);
    });
  });

  it("cannot escalate to a role it was not granted", async () => {
    await asApp(async (c) => {
      expect(await mustFail(c, `SET ROLE postgres`)).toMatch(/permission denied/i);
    });
  });

  // ─── The rules still hold through the new login ──────────────────────────────────────────────

  it("HELD prospects stay readable and stay unwritable", async () => {
    await asApp(async (c) => {
      for (const role of ["ascend_owner", "ascend_sales", "ascend_automation"]) {
        await actAs(c, role, ids.orgA, role === "ascend_automation" ? null : ids.oscar);
        const seen = await c.query<{ slug: string }>(
          `SELECT slug FROM prospects WHERE identity_state = 'held'`);
        expect(seen.rows.map((r) => r.slug), `${role} cannot see held`).toEqual([`${PREFIX}-held`]);
      }
      for (const role of ["ascend_sales", "ascend_automation"]) {
        await actAs(c, role, ids.orgA, role === "ascend_automation" ? null : ids.oscar);
        const res = await c.query(`UPDATE prospects SET name = 'HIJACKED' WHERE id = $1`, [ids.held]);
        expect(res.rowCount, `${role} mutated a held prospect`).toBe(0);
      }
    });
  });

  it("AUTOMATION still cannot write judgment or provenance", async () => {
    await asApp(async (c) => {
      await actAs(c, "ascend_automation", ids.orgA, null);
      expect(await mustFail(c,
        `UPDATE prospects SET website_opportunity = 'green' WHERE id = $1`, [ids.anchored]))
        .toMatch(/permission denied/i);
      // …but may still record what it observed.
      const ok = await c.query(
        `UPDATE prospects SET website_quality = 'outdated' WHERE id = $1`, [ids.anchored]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it("a cross-tenant write is still refused", async () => {
    await asApp(async (c) => {
      await actAs(c, "ascend_owner", ids.orgA, ids.oscar);
      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, gen_random_uuid(), 'anchored', 'smuggled')`, [ids.orgB]))
        .toMatch(/row-level security/i);
    });
  });

  it("TLS: the application connection is encrypted and CA-verified", async () => {
    const c = await app.connect();
    try {
      const socket = assertVerifiedTls(c);
      expect(socket.authorized).toBe(true);
      expect(socket.remotePort, "the application must use the pooler").toBe(6543);
    } finally { c.release(); }
  });

  it("RESIDUE: this suite's fixtures are the only rows it added, and it wrote no event", async () => {
    // SCOPED, not absolute. This assertion used to read "production is empty", which was true
    // before 2E and is now false by design: production holds the six real prospects and their 41
    // events. An absolute check would fail forever, and deleting it would stop noticing if this
    // suite ever leaked a row.
    const c = await admin.connect();
    try {
      const [{ mine }] = (await c.query<{ mine: string }>(
        `SELECT count(*)::text AS mine FROM prospects WHERE slug LIKE $1`, [`${PREFIX}-%`])).rows;
      expect(Number(mine), "this suite's fixtures are missing").toBe(3);

      // The six migrated prospects are untouched by anything this suite did.
      const [{ real }] = (await c.query<{ real: string }>(
        `SELECT count(*)::text AS real FROM prospects WHERE slug NOT LIKE $1`, [`${PREFIX}-%`])).rows;
      expect(Number(real), "this suite disturbed the migrated prospects").toBe(6);

      // Events are append-only and cannot be cleaned up, so writing one would be permanent.
      const [{ e }] = (await c.query<{ e: string }>(`SELECT count(*)::text AS e FROM events`)).rows;
      expect(Number(e), "this suite wrote an event, which cannot be removed").toBe(41);
    } finally { c.release(); }
  });
});

describe("application login — guard", () => {
  it("announces when the application-login gate has NOT run", () => {
    if (!APP || !ADMIN) {
      console.warn("\n  ⚠️  APPLICATION LOGIN NOT VERIFIED — ASCEND_DATABASE_URL / _DIRECT unset.\n");
    }
    expect(true).toBe(true);
  });
});
