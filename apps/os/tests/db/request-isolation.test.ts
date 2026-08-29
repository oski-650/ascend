// Layer A — THE CONCURRENCY PROOF (2F step 7.3). THE CRITICAL GATE.
//
// ─── WHAT IS BEING PROVEN, AND WHY IT NEEDS THREE PARTS ────────────────────────────────────────
//
// Step 7.2 replaced a module-level principal with an `AsyncLocalStorage` request context. That is a
// SECURITY mechanism, and a security test that cannot detect the mechanism's removal is not a
// security test. So this file proves three things, in order, and the middle one is what makes the
// other two mean anything:
//
//   1. REAL OVERLAP        — owner and sales requests are genuinely in flight at the same time,
//                            enforced by a BARRIER rather than assumed from `Promise.all()`.
//   2. MUTATION SENSITIVITY— with the request-scoped store replaced by a module-level principal,
//                            these same requests leak authority ACROSS requests, observably.
//   3. CORRECT BEHAVIOUR   — with the real store, repeated interleaved rounds show zero crossover.
//
//       the requests overlap → the broken architecture demonstrably leaks →
//       the intended architecture prevents the leak
//
// ─── WHY A BARRIER AND NOT `Promise.all` ───────────────────────────────────────────────────────
//
// `Promise.all([a(), b()])` guarantees nothing about interleaving. If the awaits happen to
// serialise, or the pool hands out one connection at a time, nothing overlapped and the test
// measures nothing — which is precisely the vacuity trap that has bitten this project three times
// (a Stage 1 gate comparing `[]` to `[]`; a 2C filter on `.type` where the shape had `.entity`; a
// parity ledger that omitted `body`).
//
// The barrier removes the assumption. Every request enters its context, arrives at the barrier, and
// BLOCKS until all participants have arrived. The round cannot complete unless every request was
// simultaneously inside its own context. Overlap is therefore a PRECONDITION OF THE TEST PASSING,
// not an assertion about it: if the requests serialise, this file times out instead of lying.
//
// ─── WHY THE MUTANT IS THE HONEST ONE ──────────────────────────────────────────────────────────
//
// The mutant below is SEQUENTIALLY CORRECT. Run one request at a time and it behaves identically to
// the real implementation — which is exactly how the original defect survived: one operator, one
// request at a time, and a shared slot that never visibly held the wrong value. It leaks ONLY under
// genuine overlap. So if the overlap in part 1 were fake, the mutation would survive, and the
// assertion `crossover > 0` would fail and expose this file as vacuous.
//
// ─── WHAT IS REAL HERE ─────────────────────────────────────────────────────────────────────────
//
// Real Postgres, real Supavisor pool, the real `ascend_app` login, real `SET LOCAL ROLE`, real RLS,
// real signed session tokens, the real `withRequestContext` trust boundary, and the real
// `listProspects()` consumer. The only thing stubbed anywhere in this file is, in part 2, the
// context module itself — because replacing it IS the mutation.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { adaptPoolClient, asPrincipal, connectionConfigFor, type DbPrincipal, type SqlClient } from "@/core/db";
import { requirePrincipal } from "@/core/auth/context";
import { requireProspectDb } from "@/core/crm/source";
import { withRequestContext } from "@/lib/request-context";
import { registerAppDb, clearAppDb, type ConnectionLease } from "@/core/auth/connection";
import { createSessionToken, readAuthConfig } from "@/lib/auth";
import { requireAdminConnection } from "./introspect";
import type { OrganizationId, UserId } from "@/domain";

const ADMIN = process.env.ASCEND_TEST_DATABASE_URL;
const APP = process.env.ASCEND_DATABASE_URL;
const describeIfDb = ADMIN && APP ? describe : describe.skip;

const SCHEMA_NAME = "ascend_request_test";
const MIGRATIONS = [
  "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql",
  "004_schema_migrations.sql", "005_user_credentials.sql",
];
const SCHEMA_SQL = MIGRATIONS
  .map((f) => readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8"))
  .join("\n");

// ─── A barrier ─────────────────────────────────────────────────────────────────────────────────
/**
 * Blocks every arriving party until `parties` have arrived.
 *
 * The timeout is what turns "the requests did not overlap" into a NAMED FAILURE rather than a
 * mysterious hang: if fewer parties arrive than expected, every waiter rejects with a message
 * saying how many made it.
 */
class Barrier {
  private arrived = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly parties: number, private readonly timeoutMs = 20_000) {}
  async arriveAndWait(): Promise<void> {
    this.arrived++;
    if (this.arrived >= this.parties) {
      const w = this.waiters; this.waiters = [];
      for (const release of w) release();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        `requests did NOT overlap: only ${this.arrived}/${this.parties} reached the barrier. ` +
        "Nothing was concurrent, so this file proved nothing."
      )), this.timeoutMs);
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }
}

// ─── The wiring under test ─────────────────────────────────────────────────────────────────────
/**
 * The four functions a request path is made of.
 *
 * Part 3 supplies the REAL ones; part 2 supplies the same ones re-imported over a mutated context
 * module. The driver code below is identical for both, so the ONLY difference between a passing run
 * and a leaking run is the mechanism being tested.
 */
type Wiring = {
  withRequestContext: typeof withRequestContext;
  requirePrincipal: () => { role: string; userId: string | null; organizationId: string };
  requireProspectDb: () => { client: SqlClient; principal: DbPrincipal };
  listProspects: () => Promise<{ slug: string }[]>;
};

type Identity = { label: string; role: string; org: string; user: string; dbRole: string; backendPid: number; slugs: string[] };

describeIfDb("REQUEST ISOLATION under genuine concurrency (requires ASCEND_TEST_DATABASE_URL + ASCEND_DATABASE_URL)", () => {
  let appPool: Pool;
  let orgA: OrganizationId, orgB: OrganizationId;
  let oscar: UserId, partner: UserId;
  let ownerToken: string, salesToken: string;
  let savedSecret: string | undefined, savedSource: string | undefined;

  /** The lease the trust boundary uses: one connection per request, released when it ends. */
  const lease: ConnectionLease = async (fn) => {
    const c = await appPool.connect();
    try { return await fn(adaptPoolClient(c)); } finally { c.release(); }
  };

  beforeAll(async () => {
    savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
    savedSource = process.env.ASCEND_PROSPECT_SOURCE;
    process.env.ASCEND_OS_SESSION_SECRET ??= "request-isolation-test-secret";
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";

    // SCHEMA ISOLATION VIA THE STARTUP PACKET, never `SET search_path` — the same reasoning as
    // tests/db/pooled-principal.test.ts. A `SET` would rest on session persistence through a
    // pooler, which is the property under test, and a miss would create these tables in `public`
    // ON THE PRODUCTION DATABASE.
    const adminPool = new Pool({
      ...connectionConfigFor(ADMIN!), max: 1, options: `-c search_path=${SCHEMA_NAME}`,
    });
    const setup = await adminPool.connect();
    try {
      await requireAdminConnection(adaptPoolClient(setup), "request isolation");
      await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
      await setup.query(`CREATE SCHEMA ${SCHEMA_NAME}`);
      await setup.query(SCHEMA_SQL);
      // In production these tables live in `public`, where USAGE is granted to PUBLIC by default.
      // Only the isolation of this suite into its own schema makes the grant necessary — and
      // ascend_auth needs it too, because principal resolution reads users and memberships.
      await setup.query(`GRANT USAGE ON SCHEMA ${SCHEMA_NAME}
                         TO ascend_owner, ascend_sales, ascend_automation, ascend_auth`);

      const a = await setup.query(`INSERT INTO organizations (slug,name) VALUES ('req-a','A') RETURNING id`);
      const b = await setup.query(`INSERT INTO organizations (slug,name) VALUES ('req-b','B') RETURNING id`);
      orgA = a.rows[0].id; orgB = b.rows[0].id;

      const u1 = await setup.query(`INSERT INTO users (email) VALUES ('oscar@req.test') RETURNING id`);
      const u2 = await setup.query(`INSERT INTO users (email) VALUES ('partner@req.test') RETURNING id`);
      oscar = u1.rows[0].id; partner = u2.rows[0].id;

      // DIFFERENT ORGANIZATIONS ON PURPOSE. Within one organization a sales principal legitimately
      // sees the same prospects an owner does (a hold is a write barrier, not an information
      // barrier), so a role leak there would be invisible in the DATA. Splitting the two users
      // across organizations makes any crossover show up as the strongest possible signal: rows
      // that RLS must never have returned.
      await setup.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'owner')`, [oscar, orgA]);
      await setup.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'sales')`, [partner, orgB]);

      for (const [org, slug] of [[orgA, "alpha-one"], [orgA, "alpha-two"], [orgB, "bravo-one"]] as const) {
        await setup.query(
          `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
           VALUES ($1, gen_random_uuid(), 'anchored', $2, $2)`, [org, slug]);
      }
    } finally { setup.release(); await adminPool.end(); }

    // The application login, pooled — the connection path a deployed request actually takes.
    // max is comfortably above the round size: a pool that hands out one connection at a time would
    // serialise the requests, and the barrier would (correctly) report that nothing overlapped.
    appPool = new Pool({ ...connectionConfigFor(APP!), max: 8, options: `-c search_path=${SCHEMA_NAME}` });
    registerAppDb(lease);

    const config = readAuthConfig();
    ownerToken = (await createSessionToken(config, oscar))!;
    salesToken = (await createSessionToken(config, partner))!;
    expect(ownerToken && salesToken, "could not mint session tokens").toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    clearAppDb();
    const adminPool = new Pool({ ...connectionConfigFor(ADMIN!), max: 1 });
    const c = await adminPool.connect();
    try { await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`); }
    finally { c.release(); await adminPool.end(); }
    await appPool?.end();
    if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
    else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
    if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
    else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
  }, 60_000);

  const realWiring = (): Wiring => ({ withRequestContext, requirePrincipal, requireProspectDb, listProspects: async () => {
    const { listProspects } = await import("@/core/crm");
    return listProspects();
  } });

  /**
   * One request, driven through the REAL trust boundary, observing itself AFTER the barrier.
   *
   * Everything observed is read back through the request context — never from the local variables
   * this function already has. Asserting on what we passed in would prove only that JavaScript
   * closures work.
   */
  async function request(w: Wiring, label: string, token: string, barrier: Barrier): Promise<Identity> {
    const outcome = await w.withRequestContext(token, async () => {
      // Inside the context, before anyone else may have entered.
      await barrier.arriveAndWait();
      // Every request is now provably in flight simultaneously. Anything read from here on is read
      // while the other requests are also inside their own contexts.
      const p = w.requirePrincipal();
      const { client, principal } = w.requireProspectDb();
      const row = await asPrincipal(client, principal, (tx) =>
        tx.query<{ db_role: string; org: string | null; usr: string | null; pid: number }>(
          `SELECT current_user AS db_role,
                  nullif(current_setting('ascend.org_id',  true),'') AS org,
                  nullif(current_setting('ascend.user_id', true),'') AS usr,
                  pg_backend_pid() AS pid`));
      const slugs = (await w.listProspects()).map((x) => x.slug).sort();
      return {
        label, role: p.role, org: String(p.organizationId), user: String(p.userId),
        dbRole: row.rows[0].db_role, backendPid: row.rows[0].pid, slugs,
      };
    });
    if (!outcome.ok) throw new Error(`${label}: the request established no context (${outcome.reason})`);
    return outcome.value;
  }

  /** What each participant MUST see. Anything else is crossover. */
  const expected = (kind: "owner" | "sales") => kind === "owner"
    ? { role: "owner", org: String(orgA), user: String(oscar), dbRole: "ascend_owner", slugs: ["alpha-one", "alpha-two"] }
    : { role: "sales", org: String(orgB), user: String(partner), dbRole: "ascend_sales", slugs: ["bravo-one"] };

  /** Every way an observation can disagree with the identity that request was made under. */
  function crossoverIn(seen: Identity[]): string[] {
    const out: string[] = [];
    for (const s of seen) {
      const want = expected(s.label.startsWith("owner") ? "owner" : "sales");
      if (s.role !== want.role) out.push(`${s.label}: role ${want.role} → ${s.role}`);
      if (s.org !== want.org) out.push(`${s.label}: organization crossed`);
      if (s.user !== want.user) out.push(`${s.label}: user crossed`);
      if (s.dbRole !== want.dbRole) out.push(`${s.label}: database role ${want.dbRole} → ${s.dbRole}`);
      if (s.slugs.join(",") !== want.slugs.join(",")) out.push(`${s.label}: READ ANOTHER TENANT'S ROWS [${s.slugs}]`);
    }
    return out;
  }

  /** One interleaved round. Every participant blocks until all of them are inside a context. */
  async function round(w: Wiring, kinds: ("owner" | "sales")[]): Promise<Identity[]> {
    const barrier = new Barrier(kinds.length);
    return Promise.all(kinds.map((k, i) =>
      request(w, `${k}#${i}`, k === "owner" ? ownerToken : salesToken, barrier)));
  }

  /** After a round: the connections went back to the pool carrying nothing. */
  async function poolCarriesNothing(): Promise<void> {
    const c = await appPool.connect();
    try {
      const { rows } = await c.query(
        `SELECT current_user AS db_role,
                nullif(current_setting('ascend.org_id',  true),'') AS org,
                nullif(current_setting('ascend.user_id', true),'') AS usr`);
      expect(rows[0].org, "a released connection still carries an organization").toBeNull();
      expect(rows[0].usr, "a released connection still carries a user").toBeNull();
      expect(["ascend_owner", "ascend_sales"]).not.toContain(rows[0].db_role);
    } finally { c.release(); }
  }

  // ─── PART 1 — the requests genuinely overlap ─────────────────────────────────────────────────

  it("PART 1 · four requests are inside their contexts SIMULTANEOUSLY — proven by a barrier", async () => {
    // The barrier is the proof. Completing it is only possible if all four requests had entered a
    // context and none had left. Distinct backend pids are corroborating evidence that they are
    // also four distinct database sessions rather than one connection used four times.
    const seen = await round(realWiring(), ["owner", "sales", "owner", "sales"]);
    expect(seen).toHaveLength(4);
    expect(new Set(seen.map((s) => s.backendPid)).size,
      "the requests shared a database session — the pool serialised them").toBe(4);
  }, 120_000);

  it("PART 1 · the barrier FAILS LOUDLY when the requests do not overlap — the control", async () => {
    // Without this, a barrier that silently let a single party through would make part 1 vacuous.
    const barrier = new Barrier(2, 1_000);
    await expect(barrier.arriveAndWait()).rejects.toThrow(/did NOT overlap: only 1\/2/);
  });

  // ─── PART 3 — the real implementation, repeated ──────────────────────────────────────────────
  //
  // Stated before part 2 because it is the claim; part 2 is what makes it credible.

  it("PART 3 · repeated interleaved rounds produce ZERO crossover", async () => {
    const patterns: ("owner" | "sales")[][] = [
      ["owner", "sales", "owner", "sales"],
      ["owner", "owner", "sales", "sales"],
      ["sales", "owner", "sales", "owner"],
      ["owner", "sales", "sales", "owner"],
      ["sales", "sales", "owner", "owner"],
    ];
    const found: string[] = [];
    for (const p of patterns) {
      found.push(...crossoverIn(await round(realWiring(), p)));
      // "plus pooled-connection reuse after each" — the connections are back in the pool and clean.
      await poolCarriesNothing();
    }
    expect(found, "authority crossed between concurrent requests").toEqual([]);
  }, 300_000);

  it("PART 3 · a request that THROWS leaves no principal behind for the next one", async () => {
    await expect(withRequestContext(ownerToken, async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
    await poolCarriesNothing();
    const after = await round(realWiring(), ["sales", "sales"]);
    expect(crossoverIn(after)).toEqual([]);
  }, 120_000);

  // ─── PART 2 — MUTATION SENSITIVITY ───────────────────────────────────────────────────────────

  describe("PART 2 · MUTATION — a module-level principal must leak, observably", () => {
    afterAll(() => { vi.doUnmock("@/core/auth/context"); vi.resetModules(); });

    it("with the request-scoped store replaced by ONE SHARED SLOT, requests cross over", async () => {
      // The mutant is the architecture Step 7.2 removed, written faithfully: one module-level slot,
      // written on entry, read by whoever asks. Note that it is SEQUENTIALLY CORRECT — that is the
      // whole reason the original defect survived a year of single-operator use.
      vi.resetModules();
      vi.doMock("@/core/auth/context", () => {
        let slot: { principal: DbPrincipal; db: SqlClient } | undefined;
        class OutsideRequestContext extends Error {}
        return {
          OutsideRequestContext,
          runInRequestContext: async <T>(ctx: typeof slot, fn: () => Promise<T>) => { slot = ctx; return fn(); },
          peekRequestContext: () => slot,
          inRequestContext: () => slot !== undefined,
          requirePrincipal: () => {
            if (!slot) throw new OutsideRequestContext("no principal");
            return slot.principal;
          },
          requireRequestDb: () => {
            if (!slot) throw new OutsideRequestContext("no connection");
            return slot.db;
          },
        };
      });

      // Re-import the REAL request path over the mutated context module. Everything else —
      // the trust boundary, principal resolution, the prospect seam, RLS — is unchanged.
      const conn = await import("@/core/auth/connection");
      conn.registerAppDb(lease);
      const mutant: Wiring = {
        withRequestContext: (await import("@/lib/request-context")).withRequestContext,
        requirePrincipal: (await import("@/core/auth/context")).requirePrincipal as Wiring["requirePrincipal"],
        requireProspectDb: (await import("@/core/crm/source")).requireProspectDb,
        listProspects: async () => (await import("@/core/crm")).listProspects(),
      };

      const seen = await round(mutant, ["owner", "sales", "owner", "sales"]);
      const leaks = crossoverIn(seen);

      // THE GATE. If this is empty, the mutation survived — which would mean these requests do not
      // actually overlap, or that nothing here reads the context, and part 3 proves nothing.
      expect(leaks.length,
        "THE MUTATION SURVIVED. A module-level principal produced no observable crossover, so this " +
        "suite is not measuring request isolation. Do not weaken the assertion — fix the test."
      ).toBeGreaterThan(0);

      // And specifically: it must be an AUTHORIZATION failure, not merely a mislabelled field.
      // One tenant's rows in another tenant's response is the incident this whole stage prevents.
      expect(leaks.some((l) => /READ ANOTHER TENANT'S ROWS/.test(l)),
        `the mutant leaked, but not as cross-tenant data: ${leaks.join(" | ")}`).toBe(true);

      console.info(`\n      MUTATION DETECTED — ${leaks.length} crossings:\n        ${leaks.join("\n        ")}\n`);

      // Clean up: the mutant module holds a principal in module state, by construction.
      conn.clearAppDb();
      registerAppDb(lease);
    }, 300_000);
  });
});

describe("request isolation — guard", () => {
  it("announces loudly when the real-database gate has NOT run", () => {
    if (!ADMIN || !APP) {
      console.warn(
        "\n  ⚠️  REQUEST ISOLATION NOT VERIFIED — ASCEND_TEST_DATABASE_URL / ASCEND_DATABASE_URL unset.\n" +
        "      Nothing else in the suite proves that concurrent requests keep separate authority.\n"
      );
    }
    expect(true).toBe(true);
  });
});
