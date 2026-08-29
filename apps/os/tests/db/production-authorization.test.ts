// Layer A — THE PRODUCTION AUTHORIZATION GATE.
//
// Everything Stage 2A asserted against PGlite, re-asserted against the REAL managed database, over
// the REAL application connection (the transaction pooler), against the REAL migrated tables.
//
// ─── WHY THIS RUNS AGAINST `public` AND STILL LEAVES NOTHING BEHIND ────────────────────────────
//
// A scratch schema would have been easier and would have proved less: it would verify that the
// migration FILES describe a correct schema, not that the schema PRODUCTION IS RUNNING enforces it.
// Those differ whenever a migration half-applies, a policy fails to attach, or a grant is altered
// by hand afterwards.
//
// So these tests use the live `public` tables — and every one of them runs inside a transaction
// that is ALWAYS rolled back, by throwing a sentinel through the real `asPrincipal`, whose own
// rollback path then unwinds the work. Nothing is committed, including the rows a test inserts to
// have something to act on.
//
// The one trace left behind is sequence advancement: `events_seq_seq` is a bigserial, and sequences
// do not roll back. Gaps in `seq` are normal and carry no meaning — `seq` is an ORDERING signal,
// never a count — but it is a real, if harmless, side effect and is named here rather than hidden.
//
// ─── DEMONSTRATE, DO NOT ASSERT ────────────────────────────────────────────────────────────────
//
// "The policy exists" is what `pg_policies` says; the migration gate already checks that. This file
// exists to show that PROHIBITED OPERATIONS ACTUALLY FAIL. Every negative control below issues the
// forbidden statement and requires the database to refuse it. A rule that has never been observed
// refusing anything is a rule nobody has tested.
//
// ─── THE PRIVILEGE FACT THAT SHAPES ALL OF THIS ───────────────────────────────────────────────
//
// The login role (`postgres`) has **BYPASSRLS**; `ascend_owner`, `ascend_sales` and
// `ascend_automation` do not. So row-level security protects nothing on a bare connection and
// everything inside `asPrincipal`, which switches to a non-bypassing role. That is why seeding
// below happens before the role switch, and why F43's "one canonical reader" is a SECURITY rule
// rather than a tidiness rule.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, assertVerifiedTls, connectionConfigFor } from "@/core/db";
import { requireAdminConnection } from "./introspect";

const CONNECTION = process.env.ASCEND_TEST_DATABASE_URL;
const describeIfDb = CONNECTION ? describe : describe.skip;

type Ids = { orgA: string; orgB: string; oscar: string; partner: string; anchored: string; held: string; eventId: string };

const ROLE = { owner: "ascend_owner", sales: "ascend_sales", automation: "ascend_automation" } as const;

describeIfDb("PRODUCTION AUTHORIZATION (requires ASCEND_TEST_DATABASE_URL)", () => {
  let pool: Pool;
  /** Events present before this suite ran. Everything it does must roll back to exactly this. */
  let eventBaseline = 0;

  beforeAll(async () => {
    // Transaction pooler, TLS-verified, built by the production factory.
    //
    // ADMIN, not the application login. This suite verifies the SCHEMA — it seeds organizations and
    // switches between all three roles, neither of which `ascend_app` can do. The application
    // login's own behaviour is verified separately, in production-app-login.test.ts.
    pool = new Pool({ ...connectionConfigFor(CONNECTION!), max: 2 });
    const c = await pool.connect();
    try {
      await requireAdminConnection(adaptPoolClient(c), "production authorization");
      const [{ e }] = (await c.query<{ e: string }>(`SELECT count(*)::text AS e FROM events`)).rows;
      eventBaseline = Number(e);
    } finally { c.release(); }
  });
  afterAll(async () => { await pool.end(); });

  /**
   * Run `fn` in a transaction on the live tables, then ALWAYS roll back.
   *
   * The rollback is unconditional and is issued in `finally`, so a test that throws, passes, or
   * fails an assertion mid-transaction still leaves the database untouched.
   */
  async function inRolledBackTx<T>(fn: (c: PoolClient, ids: Ids) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      try {
        const ids = await seed(c);
        return await fn(c, ids);
      } finally {
        // Unconditional. Nothing this file does is ever committed.
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
  }

  /** Tenancy + fixtures, inserted as the login role (which bypasses RLS) before any role switch. */
  async function seed(c: PoolClient): Promise<Ids> {
    const one = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];
    const orgA = (await one(`INSERT INTO organizations (slug,name) VALUES ('gate-a','Gate A') RETURNING id`)).id;
    const orgB = (await one(`INSERT INTO organizations (slug,name) VALUES ('gate-b','Gate B') RETURNING id`)).id;
    const oscar = (await one(`INSERT INTO users (email) VALUES ('gate-oscar@test') RETURNING id`)).id;
    const partner = (await one(`INSERT INTO users (email) VALUES ('gate-partner@test') RETURNING id`)).id;
    await c.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'owner')`, [oscar, orgA]);
    await c.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'sales')`, [partner, orgA]);

    const anchored = (await one(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, website)
       VALUES ($1, gen_random_uuid(), 'anchored', 'gate-anchored', 'Anchored Co', 'https://anchored.test')
       RETURNING id`, [orgA])).id;
    // A held prospect: no identity, and a stated reason. Both halves are constraint-enforced.
    const held = (await one(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name)
       VALUES ($1, NULL, 'held', 'duplicate candidate of gate-anchored', 'gate-held', 'Held Co')
       RETURNING id`, [orgA])).id;
    // Org B's row exists so cross-tenant visibility is a real question, not a vacuous one.
    await c.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'gate-other', 'Other Org Co')`, [orgB]);

    const eventId = (await one(
      `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                           subject_entity, subject_entity_id, data)
       VALUES (gen_random_uuid(), $1, 'prospect.created', now(), 'operator', $2, 'prospect', $3, '{}'::jsonb)
       RETURNING event_id`, [orgA, oscar, anchored])).event_id;

    return { orgA, orgB, oscar, partner, anchored, held, eventId };
  }

  /** Assume a principal for the remainder of the transaction — the same mechanism `asPrincipal` uses. */
  async function actAs(c: PoolClient, role: keyof typeof ROLE, org: string, user: string | null) {
    await c.query("SET LOCAL ROLE NONE");
    await c.query("SELECT set_config('ascend.org_id', $1, true)", [org]);
    await c.query("SELECT set_config('ascend.user_id', $1, true)", [user ?? ""]);
    await c.query(`SET LOCAL ROLE ${ROLE[role]}`);
  }

  /**
   * Issue a statement that MUST be refused, inside a savepoint.
   *
   * The savepoint is not optional: in PostgreSQL a failed statement aborts the whole transaction,
   * so without `ROLLBACK TO` the first negative control would poison every assertion after it and
   * the suite would report a cascade of failures with one real cause.
   */
  async function mustFail(c: PoolClient, sql: string, params: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT probe");
    try {
      await c.query(sql, params);
      await c.query("ROLLBACK TO SAVEPOINT probe");
      throw new Error(`EXPECTED REFUSAL, but the database ALLOWED it:\n    ${sql.trim().split("\n")[0]}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/EXPECTED REFUSAL/.test(msg)) throw e;
      await c.query("ROLLBACK TO SAVEPOINT probe");
      return msg;
    }
  }

  // ─── Row-level security ──────────────────────────────────────────────────────────────────────

  it("RLS: an organization sees only its own prospects, on real managed Postgres", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "owner", ids.orgA, ids.oscar);
      const a = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      expect(a.rows.map((r) => r.slug)).toEqual(["gate-anchored", "gate-held"]);

      await actAs(c, "owner", ids.orgB, ids.oscar);
      const b = await c.query<{ slug: string }>(`SELECT slug FROM prospects ORDER BY slug`);
      expect(b.rows.map((r) => r.slug)).toEqual(["gate-other"]);
    });
  });

  it("RLS: an unset organization sees NOTHING — default deny, not an error", async () => {
    await inRolledBackTx(async (c, ids) => {
      await c.query("SET LOCAL ROLE NONE");
      await c.query("SELECT set_config('ascend.org_id', '', true)");
      await c.query("SELECT set_config('ascend.user_id', '', true)");
      await c.query(`SET LOCAL ROLE ${ROLE.owner}`);
      const rows = await c.query(`SELECT slug FROM prospects`);
      expect(rows.rows).toEqual([]);
      void ids;
    });
  });

  it("RLS: a cross-tenant write is REFUSED by WITH CHECK", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "owner", ids.orgA, ids.oscar);
      const msg = await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, gen_random_uuid(), 'anchored', 'gate-smuggled')`, [ids.orgB]);
      expect(msg).toMatch(/row-level security/i);
    });
  });

  it("RLS: the login role BYPASSES it — which is why every read must go through asPrincipal", async () => {
    // Not a defect, and not something to leave undocumented. `postgres` holds BYPASSRLS so that
    // migrations and provisioning work. It means a query issued OUTSIDE a principal binding sees
    // every organization's rows, so the canonical-reader rule is load-bearing for tenancy.
    //
    // SCOPED TO THIS SUITE'S OWN ROWS. The three still span TWO organizations, so the cross-tenant
    // claim is unchanged — but asserting on the whole table made this depend on no other suite
    // holding committed fixtures, and vitest runs files in parallel. A test that fails because a
    // sibling is doing its job is measuring the scheduler, not the database.
    await inRolledBackTx(async (c) => {
      const all = await c.query<{ slug: string }>(
        `SELECT slug FROM prospects WHERE slug LIKE 'gate-%' ORDER BY slug`);
      expect(all.rows.map((r) => r.slug)).toEqual(["gate-anchored", "gate-held", "gate-other"]);
    });
  });

  // ─── Held prospects: a write barrier, not an information barrier ─────────────────────────────

  it("HELD prospects are READABLE by every role — the matcher must still see them", async () => {
    // If a hold hid the row, an import would create a third copy of exactly the business a human
    // flagged as already duplicated. This is the single most consequential policy in the schema.
    await inRolledBackTx(async (c, ids) => {
      for (const role of ["owner", "sales", "automation"] as const) {
        await actAs(c, role, ids.orgA, role === "automation" ? null : ids.oscar);
        const rows = await c.query<{ slug: string; identity_state: string }>(
          `SELECT slug, identity_state FROM prospects WHERE identity_state = 'held'`);
        expect(rows.rows.map((r) => r.slug), `${role} cannot see held prospects`).toEqual(["gate-held"]);
      }
    });
  });

  it("HELD prospects cannot be mutated by sales or automation", async () => {
    await inRolledBackTx(async (c, ids) => {
      for (const role of ["sales", "automation"] as const) {
        await actAs(c, role, ids.orgA, role === "sales" ? ids.partner : null);
        // The UPDATE policy's USING clause excludes held rows, so this matches nothing rather than
        // erroring. Zero rows affected IS the refusal.
        const res = await c.query(`UPDATE prospects SET name = 'HIJACKED' WHERE id = $1`, [ids.held]);
        expect(res.rowCount, `${role} mutated a held prospect`).toBe(0);
      }
      // And the row is untouched.
      await actAs(c, "owner", ids.orgA, ids.oscar);
      const row = await c.query<{ name: string }>(`SELECT name FROM prospects WHERE id = $1`, [ids.held]);
      expect(row.rows[0].name).toBe("Held Co");
    });
  });

  it("A prospect cannot be moved INTO held as a way around the write barrier", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "automation", ids.orgA, null);
      // WITH CHECK stops the row leaving 'anchored'. Without it, automation could park a record in
      // held and then claim the barrier does not apply to it.
      const res = await c.query(
        `UPDATE prospects SET identity_state = 'held', hold_reason = 'self-declared', prospect_id = NULL
         WHERE id = $1`, [ids.anchored]).catch((e) => e as Error);
      if (res instanceof Error) expect(res.message).toMatch(/row-level security|permission denied/i);
      else expect(res.rowCount).toBe(0);
    });
  });

  // ─── Automation may observe, never judge ─────────────────────────────────────────────────────

  it("AUTOMATION cannot write judgment or its provenance — refused by column GRANT", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "automation", ids.orgA, null);
      for (const col of ["website_opportunity = 'green'", "assessed_by = NULL", "assessed_at = now()"]) {
        const msg = await mustFail(c, `UPDATE prospects SET ${col} WHERE id = $1`, [ids.anchored]);
        expect(msg, `automation was allowed to write ${col}`).toMatch(/permission denied/i);
      }
    });
  });

  it("AUTOMATION may still write what it OBSERVES — the grant is narrow, not total", async () => {
    // The complement, and it matters: a rule that forbade everything would be trivially satisfied
    // and would also break the research engine this substrate exists to support.
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "automation", ids.orgA, null);
      const res = await c.query(
        `UPDATE prospects SET website = 'https://observed.test', website_quality = 'outdated'
         WHERE id = $1`, [ids.anchored]);
      expect(res.rowCount).toBe(1);
    });
  });

  it("AN OWNER may record judgment — provenance is required, not optional", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "owner", ids.orgA, ids.oscar);
      const ok = await c.query(
        `UPDATE prospects SET website_opportunity = 'green', assessed_by = $2, assessed_at = now()
         WHERE id = $1`, [ids.anchored, ids.oscar]);
      expect(ok.rowCount).toBe(1);

      // …and a judgment with no author is refused by CHECK, whoever is asking.
      const msg = await mustFail(c,
        `UPDATE prospects SET website_opportunity = 'red', assessed_by = NULL, assessed_at = NULL
         WHERE id = $1`, [ids.anchored]);
      expect(msg).toMatch(/assessment_has_provenance/);
    });
  });

  // ─── The event spine is append-only ──────────────────────────────────────────────────────────

  it("EVENTS cannot be updated or deleted — the trigger fires even for the table owner", async () => {
    await inRolledBackTx(async (c, ids) => {
      // As the login role: owner-equivalent, BYPASSRLS, every table privilege. If append-only rested
      // on grants alone this would succeed. The trigger is what makes it structural.
      const up = await mustFail(c, `UPDATE events SET type = 'rewritten' WHERE event_id = $1`, [ids.eventId]);
      expect(up).toMatch(/append-only/);
      const del = await mustFail(c, `DELETE FROM events WHERE event_id = $1`, [ids.eventId]);
      expect(del).toMatch(/append-only/);
    });
  });

  it("EVENTS: no application role even holds the grant to try", async () => {
    await inRolledBackTx(async (c, ids) => {
      for (const role of ["owner", "sales", "automation"] as const) {
        await actAs(c, role, ids.orgA, role === "automation" ? null : ids.oscar);
        const msg = await mustFail(c, `DELETE FROM events WHERE event_id = $1`, [ids.eventId]);
        expect(msg, `${role} reached the trigger instead of being stopped by GRANT`)
          .toMatch(/permission denied|append-only/i);
      }
    });
  });

  it("EVENTS may be appended by every role, within their own organization", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "sales", ids.orgA, ids.partner);
      const res = await c.query(
        `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                             subject_entity, subject_entity_id)
         VALUES (gen_random_uuid(), $1, 'prospect.contacted', now(), 'operator', $2, 'prospect', $3)`,
        [ids.orgA, ids.partner, ids.anchored]);
      expect(res.rowCount).toBe(1);
    });
  });

  // ─── CHECK constraints, each demonstrated refusing ───────────────────────────────────────────

  it("CHECK: an anchored prospect must carry an identity, and a held one must state a reason", async () => {
    await inRolledBackTx(async (c, ids) => {
      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, NULL, 'anchored', 'gate-nameless')`, [ids.orgA])).toMatch(/anchored_iff_identified/);

      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, NULL, 'held', 'gate-unexplained')`, [ids.orgA])).toMatch(/held_states_its_reason/);

      // A held record may not smuggle in an identity either — the constraint is an equivalence.
      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug)
         VALUES ($1, gen_random_uuid(), 'held', 'why', 'gate-held-identified')`, [ids.orgA]))
        .toMatch(/anchored_iff_identified/);
    });
  });

  it("CHECK: one identity cannot be claimed by two records", async () => {
    await inRolledBackTx(async (c, ids) => {
      const [{ prospect_id }] = (await c.query<{ prospect_id: string }>(
        `SELECT prospect_id FROM prospects WHERE id = $1`, [ids.anchored])).rows;
      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, $2, 'anchored', 'gate-impostor')`, [ids.orgA, prospect_id]))
        .toMatch(/duplicate key|unique/i);
    });
  });

  it("CHECK: an operator event must name its human, and a system event must not", async () => {
    // §19's adoption metric counts operator-caused events per human. An operator event with no
    // human, or a system event claiming one, silently corrupts a pre-registered measurement.
    await inRolledBackTx(async (c, ids) => {
      expect(await mustFail(c,
        `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                             subject_entity, subject_entity_id)
         VALUES (gen_random_uuid(), $1, 't', now(), 'operator', NULL, 'prospect', $2)`,
        [ids.orgA, ids.anchored])).toMatch(/operator_events_name_their_human/);

      expect(await mustFail(c,
        `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                             subject_entity, subject_entity_id)
         VALUES (gen_random_uuid(), $1, 't', now(), 'system', $2, 'prospect', $3)`,
        [ids.orgA, ids.oscar, ids.anchored])).toMatch(/system_events_name_no_human/);
    });
  });

  it("CHECK: absence stays absence — invalid enum values are refused, not coerced", async () => {
    await inRolledBackTx(async (c, ids) => {
      expect(await mustFail(c,
        `UPDATE prospects SET status = 'maybe' WHERE id = $1`, [ids.anchored])).toMatch(/status/);
      expect(await mustFail(c,
        `UPDATE prospects SET website_quality = 'meh' WHERE id = $1`, [ids.anchored]))
        .toMatch(/website_quality/);
    });
  });

  // ─── Atomicity, isolation, transport ─────────────────────────────────────────────────────────

  it("ATOMICITY: a failed transaction leaves nothing, on the real server", async () => {
    const before = await countProspects();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const ids = await seed(c);
      await c.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, gen_random_uuid(), 'anchored', 'gate-doomed')`, [ids.orgA]);
      await c.query("ROLLBACK");
    } finally { c.release(); }
    expect(await countProspects()).toBe(before);
  });

  it("TRANSPORT: the application connects through the POOLER, TLS-verified", async () => {
    const c = await pool.connect();
    try {
      const socket = assertVerifiedTls(c);
      expect(socket.authorized).toBe(true);
      expect(socket.getProtocol()).toMatch(/^TLSv1\.[23]$/);
      // 6543 is Supavisor. The direct endpoint is for migrations only.
      //
      // MEASURED FROM THE SOCKET, for the same reason TLS is. `inet_server_port()` returns 5432
      // through the pooler: like `pg_stat_ssl`, it describes the POOLER→POSTGRES hop and knows
      // nothing about the endpoint this process actually dialled. Only the client socket does.
      expect(socket.remotePort).toBe(6543);
      const [{ port }] = (await c.query<{ port: number }>(`SELECT inet_server_port() AS port`)).rows;
      expect(port, "inet_server_port() should report the provider-internal backend, not ours").toBe(5432);
    } finally { c.release(); }
  });

  it("RESIDUE: this suite committed nothing", async () => {
    // The claim the whole file rests on, checked rather than asserted in a comment.
    const c = await pool.connect();
    try {
      // Scoped to what THIS suite creates, for the same reason as above.
      const [{ n }] = (await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM organizations WHERE slug LIKE 'gate-%'`)).rows;
      expect(Number(n), "seed organizations were committed to production").toBe(0);
      const [{ p }] = (await c.query<{ p: string }>(
        `SELECT count(*)::text AS p FROM prospects WHERE slug LIKE 'gate-%'`)).rows;
      expect(Number(p), "seed prospects were committed to production").toBe(0);
      const [{ u }] = (await c.query<{ u: string }>(
        `SELECT count(*)::text AS u FROM users WHERE email LIKE 'gate-%'`)).rows;
      expect(Number(u), "seed users were committed to production").toBe(0);
      // Events carry no slug, and this suite is the only thing that appends them here: an
      // append-only log cannot be cleaned up, so committing one would be permanent.
      // Compared against the BASELINE captured before this suite ran, not against zero: production
      // legitimately holds the 41 migrated events since 2E. An append-only log cannot be cleaned
      // up, so a committed event would be permanent.
      const [{ e }] = (await c.query<{ e: string }>(`SELECT count(*)::text AS e FROM events`)).rows;
      expect(Number(e), "an event was committed to production and cannot be removed").toBe(eventBaseline);
    } finally { c.release(); }
  });

  // ─── Mutation controls ───────────────────────────────────────────────────────────────────────
  //
  // Every assertion above shows a prohibited operation being refused. That is necessary and not
  // sufficient: an operation can fail for the wrong reason, and a control can be redundant with
  // another without anyone noticing. These tests REMOVE the specific protection and require the
  // previously-refused operation to succeed — which is the only way to show that THIS control, and
  // not something incidental, is what enforces the rule.
  //
  // PostgreSQL takes DDL transactionally, so each mutation is applied and rolled back inside the
  // surrounding transaction. The weakened schema is never committed and never visible to any other
  // connection: at no point does production run without these protections.

  it("MUTATION: without the trigger, events become deletable — the trigger is what enforces append-only", async () => {
    await inRolledBackTx(async (c, ids) => {
      expect(await mustFail(c, `DELETE FROM events WHERE event_id = $1`, [ids.eventId])).toMatch(/append-only/);

      await c.query(`DROP TRIGGER events_no_delete ON events`);
      const res = await c.query(`DELETE FROM events WHERE event_id = $1`, [ids.eventId]);
      expect(res.rowCount, "deleting still failed with the trigger gone — something else was refusing it").toBe(1);
    });
  });

  it("MUTATION: narrowing the read policy hides held prospects — its breadth is load-bearing", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "automation", ids.orgA, null);
      const before = await c.query(`SELECT slug FROM prospects WHERE identity_state = 'held'`);
      expect(before.rows).toHaveLength(1);

      await c.query("SET LOCAL ROLE NONE");
      await c.query(`ALTER POLICY prospects_read ON prospects
                     USING (organization_id = current_org() AND identity_state = 'anchored')`);
      await actAs(c, "automation", ids.orgA, null);

      // This is the duplicate-creating failure, demonstrated: the matcher can no longer see the very
      // record that exists to stop it creating a third copy of the same business.
      const after = await c.query(`SELECT slug FROM prospects WHERE identity_state = 'held'`);
      expect(after.rows, "the read policy was already hiding held rows").toHaveLength(0);
    });
  });

  it("MUTATION: granting the column lets automation write judgment — the GRANT is what stops it", async () => {
    await inRolledBackTx(async (c, ids) => {
      await actAs(c, "automation", ids.orgA, null);
      expect(await mustFail(c,
        `UPDATE prospects SET website_opportunity = 'green', assessed_by = $2, assessed_at = now()
         WHERE id = $1`, [ids.anchored, ids.oscar])).toMatch(/permission denied/i);

      await c.query("SET LOCAL ROLE NONE");
      await c.query(`GRANT UPDATE (website_opportunity, assessed_by, assessed_at) ON prospects TO ascend_automation`);
      await actAs(c, "automation", ids.orgA, null);

      const res = await c.query(
        `UPDATE prospects SET website_opportunity = 'green', assessed_by = $2, assessed_at = now()
         WHERE id = $1`, [ids.anchored, ids.oscar]);
      expect(res.rowCount, "automation was blocked by something other than the column grant").toBe(1);
    });
  });

  it("MUTATION: dropping the CHECK admits an anchored prospect with no identity", async () => {
    await inRolledBackTx(async (c, ids) => {
      expect(await mustFail(c,
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, NULL, 'anchored', 'gate-nameless')`, [ids.orgA])).toMatch(/anchored_iff_identified/);

      await c.query(`ALTER TABLE prospects DROP CONSTRAINT anchored_iff_identified`);
      const res = await c.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
         VALUES ($1, NULL, 'anchored', 'gate-nameless')`, [ids.orgA]);
      expect(res.rowCount, "the CHECK was not what refused it").toBe(1);
    });
  });

  it("MUTATION: the rollbacks above left production intact", async () => {
    // The mutations are only safe because they never commit. This verifies that directly, rather
    // than trusting that four separate ROLLBACKs all did their job.
    const c = await pool.connect();
    try {
      const trig = await c.query(`SELECT tgname FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
                                  WHERE r.relname = 'events' AND NOT t.tgisinternal ORDER BY tgname`);
      expect(trig.rows.map((r) => r.tgname)).toEqual(["events_no_delete", "events_no_update"]);

      const pol = await c.query<{ qual: string }>(
        `SELECT qual FROM pg_policies WHERE tablename = 'prospects' AND policyname = 'prospects_read'`);
      expect(pol.rows[0].qual).not.toMatch(/identity_state/);

      const con = await c.query(`SELECT conname FROM pg_constraint WHERE conname = 'anchored_iff_identified'`);
      expect(con.rows).toHaveLength(1);

      const grant = await c.query(
        `SELECT 1 FROM information_schema.column_privileges
         WHERE table_name = 'prospects' AND grantee = 'ascend_automation'
           AND column_name IN ('website_opportunity','assessed_by','assessed_at') AND privilege_type = 'UPDATE'`);
      expect(grant.rows, "a mutation's GRANT survived the rollback").toHaveLength(0);
    } finally { c.release(); }
  });

  async function countProspects(): Promise<number> {
    const c = await pool.connect();
    try {
      const [{ n }] = (await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM prospects WHERE slug LIKE 'gate-%'`)).rows;
      return Number(n);
    } finally { c.release(); }
  }
});

describe("production authorization — guard", () => {
  it("announces loudly when the production gate has NOT run", () => {
    if (!CONNECTION) {
      expect(process.env.ASCEND_TEST_DATABASE_URL).toBeUndefined();
      console.warn(
        "\n  ⚠️  PRODUCTION AUTHORIZATION NOT VERIFIED — ASCEND_TEST_DATABASE_URL is unset.\n" +
        "      PGlite runs as a superuser and cannot prove these properties.\n"
      );
    }
    expect(true).toBe(true);
  });
});
