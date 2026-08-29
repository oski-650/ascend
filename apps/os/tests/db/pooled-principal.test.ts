// Layer A — POOLED PRINCIPAL ISOLATION. The gate PGlite could not close.
//
// THE INVARIANT:
//
//   > Principal context is request-local, never connection-global.
//
// `asPrincipal` binds identity with `SET LOCAL role` and `set_config(..., true)`, both scoped to the
// surrounding transaction. That is the CORRECT mechanism, and until now it has been an unproven
// claim: PGlite is single-connection, so it cannot demonstrate that a connection RETURNED TO A POOL
// carries nothing into the next request.
//
// The failure being excluded is the one that matters most in a multi-user system:
//
//   Request A   Oscar,   org=ascend   → connection returned to pool
//   Request B   Partner, org=ascend   → same connection, inherits Oscar's role or GUCs
//
// A leak here is not a bug that shows up as wrong data; it shows up as one person acting with
// another person's authority, silently, under load.
//
// SKIPPED WITHOUT A REAL DATABASE, deliberately and loudly. This suite must never appear to pass by
// running against something that cannot prove the property — that is exactly the mistake that let
// PGlite stand in for a pool in the first place.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { Pool } from "pg";
import {
  asPrincipal, adaptPoolClient, connectionConfigFor, tlsSocketOf, assertVerifiedTls, chainRootOf,
  SUPABASE_ROOT_2021_CA, SUPABASE_ROOT_2021_CA_SHA256, anchorValidTo,
  type SqlClient,
} from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { requireAdminConnection } from "./introspect";
import type { OrganizationId, UserId } from "@/domain";

const CONNECTION = process.env.ASCEND_TEST_DATABASE_URL;
const describeIfDb = CONNECTION ? describe : describe.skip;

const MIGRATIONS = ["001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql"];
const SCHEMA = MIGRATIONS.map((f) =>
  readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8")
).join("\n");

/**
 * The adapter under test is the PRODUCTION one.
 *
 * This file previously carried its own copy of it. A gate that proves isolation for a look-alike
 * proves nothing about the code that ships — the same class of mistake as letting PGlite stand in
 * for a pool.
 */
const adapt = adaptPoolClient;

describeIfDb("pooled principal isolation (requires ASCEND_TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let org: OrganizationId;
  let otherOrg: OrganizationId;
  let oscar: UserId;
  let partner: UserId;

  /** Run `fn` on a POOLED connection, releasing it afterwards — the reuse this suite exists to test. */
  async function withPooled<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(adapt(client));
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    // Built through the PRODUCTION factory, so this suite certifies the connection path the
    // application actually uses — TLS, pinned CA and all. A bare `connectionString` here would
    // verify isolation over a connection nothing in production will ever open.
    //
    // max:1 forces EVERY request onto the SAME physical connection. If identity leaks between
    // requests at all, it leaks here — a larger pool could hide the defect behind luck.
    //
    // SCHEMA ISOLATION VIA THE STARTUP PACKET, not via `SET search_path`. The obvious version of
    // this setup issues `SET search_path TO ascend_pool_test` on the setup connection. Measured
    // against Supavisor, that actually WORKS — session state does persist on a checked-out client —
    // and that is precisely why it must not be used here: the suite would be resting on session
    // persistence through a pooler, which is the property it exists to prove absent. It would also
    // make every later connection's search_path a matter of luck, and a miss would create these
    // tables in `public` ON THE PRODUCTION DATABASE.
    //
    // `options` travels in the startup packet, so EVERY connection this pool opens begins in the
    // test schema regardless of pooling behaviour. Verified to pass through Supavisor.
    pool = new Pool({
      ...connectionConfigFor(CONNECTION!),
      max: 1,
      options: "-c search_path=ascend_pool_test",
    });
    const setup = await pool.connect();
    try {
      await requireAdminConnection(adaptPoolClient(setup), "pooled principal isolation");
      await setup.query(`DROP SCHEMA IF EXISTS ascend_pool_test CASCADE`);
      await setup.query(`CREATE SCHEMA ascend_pool_test`);
      await setup.query(SCHEMA);
      // Schema-level USAGE, which production does not need and this harness does. The migration
      // grants TABLE privileges, but those are unreachable without USAGE on the containing schema —
      // and Postgres reports the shortfall as "relation does not exist", not as a permission error.
      // In production these tables live in `public`, where USAGE is granted to PUBLIC by default;
      // only the isolation of this suite into its own schema makes the grant necessary.
      await setup.query(`GRANT USAGE ON SCHEMA ascend_pool_test
                         TO ascend_owner, ascend_sales, ascend_automation`);
      const o = await setup.query(`INSERT INTO organizations (slug,name) VALUES ('ascend','Ascend') RETURNING id`);
      const o2 = await setup.query(`INSERT INTO organizations (slug,name) VALUES ('other','Other') RETURNING id`);
      const u1 = await setup.query(`INSERT INTO users (email) VALUES ('oscar@test') RETURNING id`);
      const u2 = await setup.query(`INSERT INTO users (email) VALUES ('partner@test') RETURNING id`);
      org = o.rows[0].id; otherOrg = o2.rows[0].id;
      oscar = u1.rows[0].id; partner = u2.rows[0].id;
      await setup.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'owner')`, [oscar, org]);
      await setup.query(`INSERT INTO memberships (user_id,organization_id,role) VALUES ($1,$2,'sales')`, [partner, org]);
    } finally {
      setup.release();
    }
  }, 60_000);

  afterAll(async () => {
    const c = await pool.connect();
    try { await c.query(`DROP SCHEMA IF EXISTS ascend_pool_test CASCADE`); } finally { c.release(); }
    await pool.end();
  });

  const identity = async (c: SqlClient) =>
    (await c.query<{ role: string; org: string | null; usr: string | null }>(
      `SELECT current_user AS role,
              nullif(current_setting('ascend.org_id',  true),'') AS org,
              nullif(current_setting('ascend.user_id', true),'') AS usr`
    )).rows[0];

  it("SEQUENTIAL REUSE: request B does not inherit request A's principal", async () => {
    const a = await withPooled((c) =>
      asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), identity));
    const b = await withPooled((c) =>
      asPrincipal(c, __unsafePrincipalForTests("sales", org, partner), identity));

    expect(a.role).toBe("ascend_owner");
    expect(a.usr).toBe(oscar);
    expect(b.role).toBe("ascend_sales");
    expect(b.usr).toBe(partner);
    expect(b.usr).not.toBe(a.usr);
  });

  it("AFTER RELEASE: the connection carries NO principal at all", async () => {
    await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), identity));
    // Same physical connection (max:1), no asPrincipal wrapper. SET LOCAL is transaction-scoped, so
    // nothing may survive. A session-scoped SET would fail exactly here.
    const bare = await withPooled((c) => identity(c));
    expect(bare.org).toBeNull();
    expect(bare.usr).toBeNull();
    expect(bare.role).not.toBe("ascend_owner");
  });

  it("CONCURRENT: interleaved requests keep their own identity", async () => {
    const results = await Promise.all([
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), identity)),
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("sales", org, partner), identity)),
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), identity)),
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("sales", org, partner), identity)),
    ]);
    expect(results.map((r) => r.usr)).toEqual([oscar, partner, oscar, partner]);
    expect(results.map((r) => r.role)).toEqual(["ascend_owner", "ascend_sales", "ascend_owner", "ascend_sales"]);
  });

  it("ROW VISIBILITY follows the request, not the connection", async () => {
    await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar),
      (tx) => tx.query(`INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
                        VALUES ($1, gen_random_uuid(), 'anchored', 'ours', 'Ours')`, [org])));
    await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", otherOrg, oscar),
      (tx) => tx.query(`INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
                        VALUES ($1, gen_random_uuid(), 'anchored', 'theirs', 'Theirs')`, [otherOrg])));

    const ours = await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar),
      (tx) => tx.query<{ slug: string }>(`SELECT slug FROM prospects`)));
    const theirs = await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", otherOrg, oscar),
      (tx) => tx.query<{ slug: string }>(`SELECT slug FROM prospects`)));

    expect(ours.rows.map((r) => r.slug)).toEqual(["ours"]);
    expect(theirs.rows.map((r) => r.slug)).toEqual(["theirs"]);
  });

  it("A FAILED REQUEST returns a CLEAN connection to the pool", async () => {
    await expect(
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), async () => {
        throw new Error("boom");
      }))
    ).rejects.toThrow("boom");

    // The rollback must also unwind the role and the GUCs. If it does not, the NEXT request inherits
    // the identity of a request that FAILED — the worst version of this bug.
    const after = await withPooled((c) => identity(c));
    expect(after.org).toBeNull();
    expect(after.usr).toBeNull();
    expect(after.role).not.toBe("ascend_owner");
  });

  it("A ROLLED-BACK write leaves nothing, and leaks no identity", async () => {
    const before = await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar),
      (tx) => tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM prospects`)));

    await expect(
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar), async (tx) => {
        await tx.query(`INSERT INTO prospects (organization_id, prospect_id, identity_state, slug)
                        VALUES ($1, gen_random_uuid(), 'anchored', 'doomed')`, [org]);
        throw new Error("rollback");
      }))
    ).rejects.toThrow("rollback");

    const after = await withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("owner", org, oscar),
      (tx) => tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM prospects`)));
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("A MISSING principal is refused, not defaulted", async () => {
    await expect(
      withPooled((c) => asPrincipal(c, __unsafePrincipalForTests("nope" as never, org, oscar), identity))
    ).rejects.toThrow(/unknown principal role/);
  });

  it("AN UNKNOWN organization sees nothing — default deny, not an error", async () => {
    const rows = await withPooled((c) => asPrincipal(c,
      __unsafePrincipalForTests("owner", "00000000-0000-0000-0000-000000000000" as OrganizationId, oscar),
      (tx) => tx.query<{ slug: string }>(`SELECT slug FROM prospects`)));
    expect(rows.rows).toEqual([]);
  });

  // ─── TLS ─────────────────────────────────────────────────────────────────────────────────────
  //
  // THE DEFECT THIS REPLACES. The previous version of this gate asserted
  //
  //     SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()   →   expect(ssl).toBe(true)
  //
  // and it was measuring the wrong hop. Through Supavisor, `pg_stat_ssl` describes the
  // POOLER→POSTGRES connection, which is internal to the provider. It reports FALSE for a session
  // whose client link is fully encrypted — so this gate would have failed against the pooler for a
  // bogus reason, and, far worse, a plaintext client link could have PASSED it had the provider's
  // internal hop been encrypted. The gate did not measure the thing it claimed to.
  //
  // The property that actually matters is about the socket in THIS process: the link carrying our
  // credentials across the public internet. Only the socket can answer that, and it answers both
  // halves — `encrypted` (confidentiality) and `authorized` (the peer is who it claims to be).

  it("TLS: the CLIENT SOCKET is encrypted — not pg_stat_ssl, which measures the wrong hop", async () => {
    const c = await pool.connect();
    try {
      const socket = tlsSocketOf(c);
      expect(socket, "the connection is plaintext").not.toBeNull();
      expect(socket!.encrypted).toBe(true);
      expect(socket!.getProtocol()).toMatch(/^TLSv1\.[23]$/);

      // Demonstrate the discrepancy rather than assert on it, so the reasoning above stays visible
      // to whoever reads this next instead of being folklore in a comment.
      const { rows } = await c.query(`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`);
      console.info(
        `      client socket TLS=${socket!.getProtocol()}  |  pg_stat_ssl (provider-internal hop)=${rows[0]?.ssl}`
      );
    } finally { c.release(); }
  });

  it("TLS: the server is AUTHENTICATED against the pinned Supabase root, not merely encrypted", async () => {
    // Encryption without authentication is a session that is confidential to WHOEVER ANSWERED.
    // This is the assertion that makes the pinned CA load-bearing.
    const c = await pool.connect();
    try {
      const socket = assertVerifiedTls(c);
      expect(socket.authorized).toBe(true);
      expect(socket.authorizationError).toBeFalsy();

      const root = chainRootOf(socket);
      expect(root?.fingerprint256, "chain does not terminate at the pinned root")
        .toBe(SUPABASE_ROOT_2021_CA_SHA256);
    } finally { c.release(); }
  });

  it("TLS: verification is CONFIGURED, not inherited — a weakened config would be refused", async () => {
    // Controls. Each one must FAIL, or the guarantee above is accidental.

    // 1 — a URL that speaks about SSL is refused rather than merged, because pg assigns parsed
    //     connection-string values over the explicit ssl config (see core/db/pool.ts).
    expect(() => connectionConfigFor(`${CONNECTION}?sslmode=require`)).toThrow(/sslmode/);
    expect(() => connectionConfigFor(`${CONNECTION}?sslmode=disable`)).toThrow(/refused/);

    // 2 — what the factory actually produces.
    const ssl = connectionConfigFor(CONNECTION!).ssl as { ca: string; rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain("BEGIN CERTIFICATE");

    // 3 — the anchor is the one that was corroborated out-of-band.
    expect(new X509Certificate(SUPABASE_ROOT_2021_CA).fingerprint256).toBe(SUPABASE_ROOT_2021_CA_SHA256);

    // 4 — and it has not expired. Discovered by a test, not by an outage.
    expect(anchorValidTo().getTime()).toBeGreaterThan(Date.now());
  });

  it("TLS: the server ACCEPTS PLAINTEXT — so enforcement is ours, and this proves it is not the server's", async () => {
    // Supabase does not refuse unencrypted sessions. That is the finding that makes every assertion
    // above necessary: a connection which simply forgets to configure TLS does not fail, it
    // succeeds. If this control ever starts failing, the provider began enforcing TLS server-side —
    // good news, and still no reason to relax the client.
    const plaintext = new Pool({ connectionString: CONNECTION, ssl: false, max: 1 });
    try {
      const c = await plaintext.connect();
      try {
        expect(tlsSocketOf(c), "server refused plaintext (provider now enforces TLS)").toBeNull();
        console.warn(
          "\n  ⚠️  The database ACCEPTS PLAINTEXT connections. TLS is enforced by core/db/pool.ts, " +
          "not by the server.\n"
        );
      } finally { c.release(); }
    } finally { await plaintext.end(); }
  });
});

describe("pooled principal isolation — guard", () => {
  it("announces loudly when the real-database gate has NOT run", () => {
    if (!CONNECTION) {
      // Not a silent skip. The property this suite proves is a SECURITY property, and "the tests
      // passed" must never be read as "isolation was verified" when this file did nothing.
      expect(process.env.ASCEND_TEST_DATABASE_URL).toBeUndefined();
      console.warn(
        "\n  ⚠️  POOLED PRINCIPAL ISOLATION NOT VERIFIED — ASCEND_TEST_DATABASE_URL is unset.\n" +
        "      PGlite cannot prove this property. Deployment is gated on this suite running.\n"
      );
    }
    expect(true).toBe(true);
  });
});
