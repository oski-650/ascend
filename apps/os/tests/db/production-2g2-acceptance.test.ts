// PRODUCTION 2G.2 — ROLLBACK-SCOPED ACCEPTANCE. AUTHORIZED, RUN AND PASSED against production
// on 2026-08-30 (contract §27.17). It remains gated: it runs only when both variables below are
// supplied deliberately, so re-running it is an explicit operational act, never a side effect of
// running the suite.
//
// ─── WHAT IT PROVES, AND WHAT IT CANNOT ────────────────────────────────────────────────────────
//
//   PROVES        the REAL `acceptInvitation`, unmodified, executes correctly against the REAL
//                 production schema, roles, RLS policies, grants and constraints
//   DOES NOT      that a COMMITTED acceptance survives the transaction boundary · anything about the
//                 running service · that `ascend_app` rather than the migrating identity drives it
//                 (proven separately in production-2g2-provision)
//
// That limitation is stated here, before the test exists in a passing state, so it cannot quietly
// evaporate the moment it goes green.
//
// ─── WHY A FIXTURE AT ALL ──────────────────────────────────────────────────────────────────────
//
// `users = 1` and that user is the owner. Acceptance SETS A PASSWORD on a user, so using the real
// owner as the subject would overwrite his own credential. Measured: no application role can create
// a user — every grant on `users` is SELECT except `ascend_invite`'s three UPDATE columns — so the
// fixture is created administratively, inside the outer transaction, and never committed.
//
// ─── NOTHING PERSISTS, AND THAT IS VERIFIED FROM ELSEWHERE ─────────────────────────────────────
//
// The outer transaction is rolled back, and cleanliness is then checked over a SEPARATE CONNECTION.
// Asking the connection that just rolled back whether it left anything behind is asking the
// transaction to grade itself.
//
// The savepoint adapter this depends on is proven independently in `savepoint-client.test.ts`,
// including a control that it contains no COMMIT — because if that wrapper were wrong, this test
// could pass while having actually committed, which is the worst failure available to it.
//
// ─── GATED, AND CONSTRUCTIBLE WITHOUT PRODUCTION ───────────────────────────────────────────────
//
// `ASCEND_ACCEPT_TEST_URL` (direct, performs the work) and `ASCEND_ACCEPT_VERIFY_URL` (separate
// connection, read-only). Absent either, everything skips: this file typechecks, lints and runs
// locally without a production credential and without opening a production connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, asPrincipal, connectionConfigFor, type SqlClient } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { verifyPassword } from "@/core/auth/credentials";
import { acceptInvitation, createInvitation, digestOf } from "@/core/auth/invitations";
import { savepointClient } from "./savepoint-client";
import type { OrganizationId, UserId } from "@/domain";

const WORK = process.env.ASCEND_ACCEPT_TEST_URL;
const VERIFY = process.env.ASCEND_ACCEPT_VERIFY_URL;
const describeIfAccepting = WORK && VERIFY ? describe : describe.skip;

/** Unmistakably a fixture, and unique per run so a leak is attributable to the run that made it. */
const FIXTURE_EMAIL = `2g2-acceptance-fixture-${Date.now()}@invalid.test`;
const FIXTURE_PASSWORD = "a-sufficiently-long-fixture-password";

describeIfAccepting("PRODUCTION 2G.2 — rollback-scoped acceptance (ASCEND_ACCEPT_TEST_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;
  let ownerId = "";
  let orgId = "";
  let ownerPasswordSetAtBefore: string | null = null;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(WORK!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);

    // BEFORE anything: the real owner's credential timestamp. The fixture touches the same three
    // columns on the same table the owner lives in, so this is the invariant most worth pinning.
    const o = await db.query<{ id: string; password_set_at: string | null }>(
      `SELECT u.id, u.password_set_at FROM users u
         JOIN memberships m ON m.user_id = u.id WHERE m.role = 'owner' LIMIT 1`);
    ownerId = o.rows[0].id;
    ownerPasswordSetAtBefore = o.rows[0].password_set_at;
    orgId = (await db.query<{ id: string }>(`SELECT id FROM organizations LIMIT 1`)).rows[0].id;
  }, 60_000);

  /** Idempotent: the test closes the work connection itself, before the observer opens. */
  async function closeWorkConnection(): Promise<void> {
    if (!raw) return;
    raw.release();
    raw = undefined as unknown as PoolClient;
    await pool.end();
    pool = undefined as unknown as Pool;
  }

  afterAll(async () => { await closeWorkConnection(); });

  it("accepts an invitation END TO END, then leaves nothing behind", async () => {
    let fixtureUserId = "";
    let invitationId = "";

    await db.query("BEGIN");
    try {
      // ── the fixture, administratively, because no application role may create a user ──────────
      const u = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1, '2G.2 acceptance fixture') RETURNING id`,
        [FIXTURE_EMAIL]);
      fixtureUserId = u.rows[0].id;
      await db.query(
        `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')`,
        [fixtureUserId, orgId]);
      expect(await credentialOf(db, fixtureUserId), "the fixture starts with no credential").toBeNull();

      const sp = savepointClient(db);

      // ── issuing is an AUTHORIZED act: through the owner, so the RLS policy is genuinely used ──
      const owner = __unsafePrincipalForTests("owner", orgId as OrganizationId, ownerId as UserId);
      const { token, id } = await asPrincipal(sp, owner, (tx) =>
        createInvitation(tx, { organizationId: orgId, userId: fixtureUserId, createdBy: ownerId,
                               ttlMs: 3_600_000 }));
      invitationId = id;
      // `SET LOCAL` is transaction-scoped, not savepoint-scoped, so the assumed role outlives the
      // released savepoint. Reset before the next phase rather than inheriting it.
      await db.query("RESET ROLE");

      const stored = await db.query<{ token_hash: string }>(
        `SELECT token_hash FROM invitations WHERE id = $1`, [invitationId]);
      expect(stored.rows[0].token_hash, "the token itself reached the table").toBe(digestOf(token));

      // ── THE REAL ACCEPTANCE PATH, UNMODIFIED ──────────────────────────────────────────────────
      const { userId } = await acceptInvitation(sp, token, FIXTURE_PASSWORD);
      await db.query("RESET ROLE");
      expect(userId).toBe(fixtureUserId);

      const hash = await credentialOf(db, fixtureUserId);
      expect(hash, "no credential was written").toBeTruthy();
      expect(await verifyPassword(FIXTURE_PASSWORD, hash!), "the credential does not verify").toBe(true);

      const inv = await db.query<{ consumed_at: string | null }>(
        `SELECT consumed_at FROM invitations WHERE id = $1`, [invitationId]);
      expect(inv.rows[0].consumed_at, "the token was not burned").not.toBeNull();

      // Replay, against production, inside the same transaction.
      let replayRefused = false;
      try { await acceptInvitation(sp, token, "another-sufficiently-long-password"); }
      catch { replayRefused = true; }
      await db.query("RESET ROLE");
      expect(replayRefused, "a consumed token was accepted a second time").toBe(true);

      // The owner is untouched WHILE the transaction is still open.
      const ownerNow = await db.query<{ p: string | null }>(
        `SELECT password_set_at AS p FROM users WHERE id = $1`, [ownerId]);
      expect(ownerNow.rows[0].p ?? null, "the fixture altered the OWNER's credential")
        .toEqual(ownerPasswordSetAtBefore);
    } finally {
      // Unconditional. The safety argument does not depend on the assertions above passing.
      await db.query("ROLLBACK");
    }

    // THE WORK CONNECTION IS CLOSED FIRST. A separate connection could never see another's
    // uncommitted rows anyway, but closing removes the question entirely: the observer below cannot
    // be sharing session state with the transaction it is auditing.
    await closeWorkConnection();

    // ── verified from ELSEWHERE, because a rolled-back transaction cannot grade itself ──────────
    const v = new Pool({ ...connectionConfigFor(VERIFY!, "migration"), max: 1 });
    try {
      const c = await v.connect();
      try {
        const one = async (sql: string, p: unknown[] = []) =>
          (await c.query(sql, p as never[])).rows[0] as Record<string, unknown>;
        expect(Number((await one(`SELECT count(*)::int AS n FROM users`)).n),
          "a fixture user survived the rollback").toBe(1);
        expect(Number((await one(`SELECT count(*)::int AS n FROM invitations`)).n),
          "an invitation survived the rollback").toBe(0);
        expect(Number((await one(`SELECT count(*)::int AS n FROM users WHERE email = $1`,
          [FIXTURE_EMAIL])).n), "the fixture user is still present").toBe(0);
        expect(Number((await one(`SELECT count(*)::int AS n FROM memberships`)).n),
          "a fixture membership survived").toBe(1);
        expect((await one(`SELECT password_set_at AS p FROM users WHERE id = $1`, [ownerId])).p ?? null,
          "THE OWNER'S CREDENTIAL CHANGED").toEqual(ownerPasswordSetAtBefore);
      } finally { c.release(); }
    } finally { await v.end(); }
  }, 180_000);
});

async function credentialOf(db: SqlClient, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM users WHERE id = $1`, [userId]);
  return rows[0]?.password_hash ?? null;
}

describe("production 2G.2 acceptance — guard", () => {
  it("announces loudly when the acceptance gate has NOT run", () => {
    if (!WORK || !VERIFY) {
      console.warn(
        "\n  ℹ️  PRODUCTION ACCEPTANCE NOT RUN — ASCEND_ACCEPT_TEST_URL / ASCEND_ACCEPT_VERIFY_URL unset.\n" +
        "      Acceptance against production is an explicit operational act. Nothing else in the\n" +
        "      suite proves the acceptance path against the real schema, roles and policies.\n"
      );
    }
    expect(true).toBe(true);
  });
});
