// PRODUCTION 2G.4 — apply 007 and PROVE what it enforces. A one-shot operational gate.
//
// ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
//
// §28.14 item 7 named it: *"applying `007` to a database at 006 needs the filtered call `006`'s own
// gate uses. Ruled out of scope; it belongs to the production gate, which remains REQUIRED and
// UNBUILT."* This is that gate, built on the `006` precedent
// (`tests/db/production-2g2-invitations.test.ts`) statement for statement.
//
// ─── WHY A GATED TEST AND NOT A SCRIPT ─────────────────────────────────────────────────────────
//
// A script writes DDL and prints "done". This applies the migration and then INTERROGATES THE
// SERVER — the constraint's own catalog definition, its delete action, the recreated policy's
// expression and role scope — and then makes the database DEMONSTRATE the invariant in both
// directions. "Migration completed successfully" would pass while a recreated policy came back
// subtly wider, which is precisely the failure that does not announce itself.
//
// ─── GATED ON ITS OWN VARIABLE ─────────────────────────────────────────────────────────────────
//
// `ASCEND_MIGRATE_007_URL`. Its own, for the reason every writing gate has one: this file MUTATES
// PRODUCTION. It deliberately does NOT reuse `ASCEND_MIGRATE_DATABASE_URL`, which already triggers
// the 2D bootstrap gate — one variable that fires two different production mutations is the exact
// hazard the per-gate variable convention exists to prevent, even though the bootstrap gate is inert
// against a live schema (it refuses over existing tables).
//
// DIRECT CONNECTION ONLY. DDL under a transaction pooler is not reliably session-consistent, and
// 007 DROPs and recreates a LIVE policy.
//
// ─── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────
//
// It writes no invitation, provisions nobody, and issues no credential. Every behavioural witness
// below runs inside a transaction that is ROLLED BACK — including the ones that succeed — so the
// gate proves what production enforces without leaving a row behind.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor, type SqlClient } from "@/core/db";
import { applyMigrations, currentVersion, loadMigrations } from "@/core/db/migrate";

const DIRECT = process.env.ASCEND_MIGRATE_007_URL;
const describeIfMigrating = DIRECT ? describe : describe.skip;

/**
 * Verification is gated SEPARATELY, and read-only.
 *
 * Welding it to the one-shot apply would mean the security definition could never be re-checked
 * after the day it was applied — the opposite of what these assertions are for. Same split `006`
 * uses. `ASCEND_VERIFY_007_URL` may point at any admin connection; it commits nothing.
 */
const VERIFY = process.env.ASCEND_VERIFY_007_URL ?? DIRECT;
const describeIfVerifying = VERIFY ? describe : describe.skip;

/** Thrown to force a rollback on a transaction that SUCCEEDED. Never an assertion failure. */
class Rollback extends Error {
  constructor() { super("probe rollback — not a failure"); }
}

describeIfMigrating("PRODUCTION 2G.4 — apply 007 (requires ASCEND_MIGRATE_007_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("PRE · production is at 006 and carries no composite membership constraint", async () => {
    expect(await currentVersion(db)).toBe("006_invitations.sql");
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint
        WHERE conrelid = 'invitations'::regclass AND conname = 'invitation_targets_a_member'`);
    expect(rows[0].n, "007 has already been applied — this gate has run before").toBe(0);
  });

  it("PRE · invitations is EMPTY, which is what the lock argument assumes", async () => {
    // 007's header argues the ACCESS EXCLUSIVE lock is acceptable because "production is expected to
    // hold zero rows in `invitations` when this applies, so the scan under the stronger lock is as
    // trivial as the scan under the weaker one would have been". Asserted rather than assumed: if
    // rows exist, that argument no longer holds AND the FK's validation scan could refuse a row that
    // predates the constraint.
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM invitations`);
    expect(rows[0].n, "invitations is not empty — re-read 007's lock argument before proceeding")
      .toBe(0);
  });

  it("PRE · the policy is still 006's — one conjunct, no created_by binding", async () => {
    const { rows } = await db.query<{ with_check: string }>(
      `SELECT pg_get_expr(polwithcheck, polrelid) AS with_check
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'invitations' AND p.polname = 'invitations_owner_issues'`);
    expect(rows, "invitations_owner_issues is missing before 007").toHaveLength(1);
    expect(rows[0].with_check).toMatch(/current_org\(\)/);
    expect(rows[0].with_check, "created_by is already bound — 007 may have partially applied")
      .not.toMatch(/created_by/);
  });

  it("APPLIES 007, and only 007, in ONE transaction", async () => {
    // The filtered call §28.14 item 7 names. `applyMigrations` defaults to the full list and refuses
    // on the first already-applied file, so the filter is what makes this reach 007 at all.
    const only = loadMigrations().filter((m) => m.name === "007_invitation_membership.sql");
    expect(only, "007 is not in the migration set").toHaveLength(1);
    const applied = await applyMigrations(db, only);
    expect(applied.map((a) => a.name)).toEqual(["007_invitation_membership.sql"]);
    expect(await currentVersion(db)).toBe("007_invitation_membership.sql");
  }, 120_000);

  it("the ledger recorded the checksum of the file AS APPLIED", async () => {
    // Editing a migration after the fact is detectable instead of invisible — the whole reason the
    // ledger stores a checksum. Compared against the file on disk, not a literal, so this stays true
    // if the file is legitimately revised before it is ever applied.
    const [only] = loadMigrations().filter((m) => m.name === "007_invitation_membership.sql");
    const { rows } = await db.query<{ checksum: string }>(
      `SELECT checksum FROM schema_migrations WHERE version = '007_invitation_membership.sql'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].checksum).toBe(only.checksum);
  });
});

describeIfVerifying("PRODUCTION 2G.4 — what 007 enforces (read-only, re-runnable)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(VERIFY!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  // ─── THE CATALOG: what the server says it will enforce ───────────────────────────────────────

  it("the composite foreign key exists, with ON DELETE RESTRICT", async () => {
    const { rows } = await db.query<{ def: string; confdeltype: string }>(
      `SELECT pg_get_constraintdef(oid) AS def, confdeltype
         FROM pg_constraint
        WHERE conrelid = 'invitations'::regclass AND conname = 'invitation_targets_a_member'`);
    expect(rows, "invitation_targets_a_member is missing").toHaveLength(1);
    expect(rows[0].def).toMatch(/FOREIGN KEY \(user_id, organization_id\)/);
    expect(rows[0].def).toMatch(/REFERENCES memberships\(user_id, organization_id\)/);
    // 'r' = RESTRICT. Asserted as the catalog code, not by string-matching the pretty-printed def:
    // CASCADE here would silently let a membership deletion erase historical evidence, which is the
    // exact ruling §28.15 records.
    expect(rows[0].confdeltype, "the delete action is not RESTRICT").toBe("r");
  });

  it("the two ORIGINAL foreign keys survived — 007 adds, it does not replace", async () => {
    // 007's header: they are "partially redundant" and KEPT, because they carry ON DELETE CASCADE
    // and dropping them would silently change what happens when a user or organization is deleted.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint
        WHERE conrelid = 'invitations'::regclass AND contype = 'f' AND confdeltype = 'c'`);
    expect(rows[0].n, "a CASCADE foreign key on invitations disappeared").toBe(2);
  });

  it("the supporting index exists", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_indexes
        WHERE tablename = 'invitations' AND indexname = 'invitations_member'`);
    expect(rows[0].n).toBe(1);
  });

  it("invitations_owner_issues came back with BOTH conjuncts, INSERT-only, owner-scoped", async () => {
    // The riskiest statement in the file: a live policy dropped and recreated. A policy that returns
    // subtly wider is a quieter failure than a missing constraint — the same reasoning 006's gate
    // applies to `users_same_org`.
    const { rows } = await db.query<{ cmd: string; with_check: string; roles: string[] }>(
      `SELECT polcmd AS cmd, pg_get_expr(polwithcheck, polrelid) AS with_check,
              (SELECT array_agg(rolname::text ORDER BY rolname::text)
                 FROM pg_roles WHERE oid = ANY(polroles)) AS roles
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'invitations' AND p.polname = 'invitations_owner_issues'`);
    expect(rows, "invitations_owner_issues is missing after 007").toHaveLength(1);
    expect(rows[0].cmd, "it is no longer INSERT-only").toBe("a");
    expect(rows[0].roles, "the policy is no longer scoped to ascend_owner").toEqual(["ascend_owner"]);
    expect(rows[0].with_check).toMatch(/current_org\(\)/);
    expect(rows[0].with_check, "created_by is NOT bound to the acting principal")
      .toMatch(/created_by/);
    expect(rows[0].with_check).toMatch(/current_user_id\(\)/);
  });

  // ─── THE BEHAVIOUR: the database demonstrating it, both directions ───────────────────────────
  //
  // A constraint that only ever ACCEPTS proves nothing. Each pair below writes inside a transaction
  // that is rolled back, so production keeps zero invitation rows either way.

  it("LEGITIMATE PATH · the ORDINARY WRITER inserts a real membership pair — ACCEPTED", async () => {
    // Run as `ascend_owner`, not as the connecting superuser. 007's claim is about "every ORDINARY
    // writer — the `ascend_app` login and every role in ASSUMABLE_ROLES"; the superuser is
    // explicitly EXCLUDED by the file's own "WHAT IT DOES NOT BIND" section. A witness gathered as
    // postgres would be measuring the wrong population — the same defect §28.15's own CORRECTION
    // records, where two tests "ran as a PostgreSQL superuser" and the claim was true while the
    // evidence for it was vacuous.
    await expect(db.transaction(async (tx) => {
      const { rows: member } = await tx.query<{ user_id: string; organization_id: string }>(
        `SELECT user_id, organization_id FROM memberships LIMIT 1`);
      expect(member, "no membership exists — this witness would be vacuous").toHaveLength(1);

      await tx.query(`SELECT set_config('ascend.org_id', $1, true)`, [member[0].organization_id]);
      await tx.query(`SELECT set_config('ascend.user_id', $1, true)`, [member[0].user_id]);
      await tx.query(`SET LOCAL ROLE ascend_owner`);

      const { rows } = await tx.query<{ n: number }>(
        `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
         VALUES ($1::uuid, $2::uuid, 'probe-007-legit', $3::uuid, now() + interval '1 hour')
         RETURNING 1 AS n`,
        [member[0].organization_id, member[0].user_id, member[0].user_id]);
      expect(rows, "the ordinary writer was refused a legitimate invitation").toHaveLength(1);
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
  });

  it("CROSS-BOUNDARY PATH · the SAME writer, a POLICY-SATISFYING row, still REFUSED by the FK", async () => {
    // The discriminating witness, and the whole of §28.13. The row is constructed so the RLS policy
    // PASSES — `organization_id = current_org()` and `created_by = current_user_id()` both hold,
    // because the session is bound to the probe organization — and yet the pair (user, probe-org) is
    // not a membership. Before 007 this INSERT SUCCEEDED. It must now be refused by the constraint,
    // not by the policy: if the policy caught it, this would prove nothing about the FK.
    //
    // The probe organization is created as the connecting role (ascend_owner holds no INSERT on
    // organizations) and rolled back with everything else.
    await expect(db.transaction(async (tx) => {
      const { rows: member } = await tx.query<{ user_id: string }>(
        `SELECT user_id FROM memberships LIMIT 1`);
      expect(member, "no membership exists — this witness would be vacuous").toHaveLength(1);
      const { rows: org } = await tx.query<{ id: string }>(
        `INSERT INTO organizations (slug, name) VALUES ('probe-007-foreign', 'probe') RETURNING id`);

      await tx.query(`SELECT set_config('ascend.org_id', $1, true)`, [org[0].id]);
      await tx.query(`SELECT set_config('ascend.user_id', $1, true)`, [member[0].user_id]);
      await tx.query(`SET LOCAL ROLE ascend_owner`);

      await tx.query(
        `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
         VALUES ($1::uuid, $2::uuid, 'probe-007-cross', $3::uuid, now() + interval '1 hour')`,
        [org[0].id, member[0].user_id, member[0].user_id]);
      throw new Rollback();   // unreachable if the constraint works
    })).rejects.toThrow(/invitation_targets_a_member/);
  });

  it("RESTRICT · a membership named by an invitation cannot be deleted", async () => {
    // The other half of the delete action, and the cost §28.15 records: once any invitation names a
    // (user_id, organization_id) pair, that membership can no longer be removed. Asserted so the
    // cost is demonstrated rather than described. Rolled back.
    await expect(db.transaction(async (tx) => {
      const { rows: member } = await tx.query<{ user_id: string; organization_id: string }>(
        `SELECT user_id, organization_id FROM memberships LIMIT 1`);
      expect(member).toHaveLength(1);
      await tx.query(
        `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
         VALUES ($1::uuid, $2::uuid, 'probe-007-restrict', $2::uuid, now() + interval '1 hour')`,
        [member[0].organization_id, member[0].user_id]);
      await tx.query(`DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2`,
        [member[0].user_id, member[0].organization_id]);
      throw new Rollback();   // unreachable if RESTRICT works
    })).rejects.toThrow(/invitation_targets_a_member|violates foreign key/);
  });
});
