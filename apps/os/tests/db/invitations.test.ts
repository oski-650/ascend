// Layer A — F53 · INVITATION TOKENS ARE HASHED, SINGLE-USE, AND ATOMIC (2G.2, STAGE2G §27).
//
// Against a REAL Postgres (PGlite, Postgres 18 in WASM) carrying the FULL migration set — DERIVED
// from `MIGRATIONS`, so it grows with the schema — and therefore the grants, policies and
// constraints under test are the ones production runs, not a mock of them.
//
// The shared `tests/db/pglite` harness applies only 001–003, which means every other local substrate
// test runs several migrations behind production. That is a real finding and is NOT fixed here: this
// suite builds its own database rather than changing infrastructure the whole run depends on.
//
// ─── THE PROPERTY ──────────────────────────────────────────────────────────────────────────────
//
//   > Invitation acceptance is an explicit unauthenticated capability, not a disguised
//   > authenticated request.
//
// So the negatives matter more than the happy path, and most of them are refusals BY GRANT — the
// database saying no, demonstrated, rather than the application promising it in prose.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { asPrincipal, MIGRATIONS, type SqlClient, type SqlValue } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { verifyPassword } from "@/core/auth/credentials";
import {
  InvitationRefused, InvitationTargetRefused, acceptInvitation, createInvitation, digestOf,
  mintInvitationToken,
} from "@/core/auth/invitations";
import { ASSUMABLE_ROLES } from "@/core/db/provision";
import type { OrganizationId, UserId } from "@/domain";

// DERIVED from MIGRATIONS, never a hardcoded list — see backup-restore.test.ts: a fixture that must
// be edited whenever the schema grows is a fixture that will eventually be edited wrongly.
const SCHEMA = MIGRATIONS
  .map((f) => readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8"))
  .join("\n");

const PASSWORD = "a-sufficiently-long-partner-password";
const HOUR = 3_600_000;

let pg: PGlite;
let db: SqlClient;
let org: string;
let owner: string;
let partner: string;

function adapt(instance: PGlite): SqlClient {
  const client: SqlClient = {
    async query(sql, params) {
      const res = await instance.query(sql, params ? [...(params as SqlValue[])] : undefined);
      return { rows: (res.rows ?? []) as never[], affected: res.affectedRows ?? 0 };
    },
    async exec(sql) { await instance.exec(sql); },
    async transaction(fn) {
      await instance.exec("BEGIN");
      try { const out = await fn(client); await instance.exec("COMMIT"); return out; }
      catch (e) { await instance.exec("ROLLBACK"); throw e; }
    },
  };
  return client;
}

/** Issuing is an AUTHORIZED act — it runs as the owner, unlike accepting. */
const asOwner = <T>(fn: (tx: SqlClient) => Promise<T>) =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org as OrganizationId, owner as UserId), fn);

/** Run a statement as the acceptance capability, to demonstrate what it cannot do. */
async function asInvite<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE ascend_invite");
    return fn(tx);
  });
}

const refused = async (p: Promise<unknown>) => {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  return err;
};

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  db = adapt(pg);
}, 60_000);

afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec("TRUNCATE invitations, memberships, users, organizations CASCADE");
  const o = await pg.query<{ id: string }>(
    "INSERT INTO organizations (slug, name) VALUES ('ascend','Ascend') RETURNING id");
  org = o.rows[0].id;
  const u1 = await pg.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ('owner@test','Owner') RETURNING id");
  owner = u1.rows[0].id;
  const u2 = await pg.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ('partner@test','Partner') RETURNING id");
  partner = u2.rows[0].id;
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner')",
    [owner, org]);
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
    [partner, org]);
});

const issue = (ttlMs = HOUR) => asOwner((tx) =>
  createInvitation(tx, { organizationId: org, userId: partner, createdBy: owner, ttlMs }));

const credentialOf = async (userId: string) => (await pg.query<{ password_hash: string | null }>(
  "SELECT password_hash FROM users WHERE id = $1", [userId])).rows[0].password_hash;

const consumedAt = async (id: string) => (await pg.query<{ consumed_at: Date | null }>(
  "SELECT consumed_at FROM invitations WHERE id = $1", [id])).rows[0]?.consumed_at ?? null;

// ─── THE TOKEN AT REST ─────────────────────────────────────────────────────────────────────────

describe("F53 · the token is never stored", () => {
  it("only a digest reaches the table — the token itself appears nowhere", async () => {
    const { token, id } = await issue();
    const { rows } = await pg.query<{ token_hash: string }>(
      "SELECT token_hash FROM invitations WHERE id = $1", [id]);
    expect(rows[0].token_hash).toBe(digestOf(token));
    expect(rows[0].token_hash).not.toBe(token);
    // Nothing anywhere in the row carries it. A database disclosure yields no live token.
    const all = await pg.query("SELECT * FROM invitations WHERE id = $1", [id]);
    expect(JSON.stringify(all.rows)).not.toContain(token);
  });

  it("two mints never collide, and the digest is deterministic", () => {
    const a = mintInvitationToken();
    const b = mintInvitationToken();
    expect(a.token).not.toBe(b.token);
    expect(digestOf(a.token)).toBe(a.digest);
  });
});

// ─── THE MATRIX ────────────────────────────────────────────────────────────────────────────────

describe("F53 · acceptance, and every way it must be refused", () => {
  it("VALID → the password is established AND the invitation consumed", async () => {
    const { token, id } = await issue();
    expect(await credentialOf(partner)).toBeNull();

    const { userId } = await acceptInvitation(db, token, PASSWORD);

    expect(userId).toBe(partner);
    const hash = await credentialOf(partner);
    expect(hash, "no credential was written").toBeTruthy();
    expect(await verifyPassword(PASSWORD, hash!), "the stored credential does not verify").toBe(true);
    expect(await consumedAt(id), "the token was not burned").not.toBeNull();
  });

  it("THE SAME TOKEN AGAIN → refused, and the credential is untouched by the replay", async () => {
    const { token } = await issue();
    await acceptInvitation(db, token, PASSWORD);
    const after = await credentialOf(partner);

    expect(await refused(acceptInvitation(db, token, "a-different-long-password-x"))).
      toBeInstanceOf(InvitationRefused);
    expect(await credentialOf(partner), "a replay rewrote the credential").toBe(after);
  });

  it("EXPIRED → refused, even though the row exists and is unconsumed", async () => {
    // The CHECK forbids issuing an already-expired invitation, which is correct — so it is issued
    // live and then aged, moving created_at back too so the constraint still holds.
    const { token, id } = await issue();
    await pg.query(
      `UPDATE invitations SET created_at = now() - interval '2 hours',
                              expires_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    expect(await refused(acceptInvitation(db, token, PASSWORD))).toBeInstanceOf(InvitationRefused);
    expect(await credentialOf(partner)).toBeNull();
  });

  it("UNKNOWN → refused", async () => {
    await issue();
    const stranger = mintInvitationToken().token;
    expect(await refused(acceptInvitation(db, stranger, PASSWORD))).toBeInstanceOf(InvitationRefused);
    expect(await credentialOf(partner)).toBeNull();
  });

  it("MALFORMED → refused, by the same path as everything else", async () => {
    await issue();
    for (const junk of ["", "not-a-token", "../../etc/passwd", "%00", "a".repeat(4096)]) {
      expect(await refused(acceptInvitation(db, junk, PASSWORD)),
        `malformed input ${junk.slice(0, 12)} was not refused`).toBeInstanceOf(InvitationRefused);
    }
    expect(await credentialOf(partner)).toBeNull();
  });

  it("REFUSALS ARE INDISTINGUISHABLE — one class, one message, no discriminating field", async () => {
    // The enumeration oracle this forbids: a caller learning WHICH of the four it was, and therefore
    // whether a token or a user exists. The database makes it structural — 006's SELECT policy hides
    // consumed and expired rows from `ascend_invite`, so all four are one lookup miss.
    const { token, id } = await issue();
    await acceptInvitation(db, token, PASSWORD);                       // now consumed
    const { token: live } = await issue();
    await pg.query(
      `UPDATE invitations SET created_at = now() - interval '2 hours',
                              expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
      [digestOf(live)]);                                               // now expired
    void id;

    const errors = [
      await refused(acceptInvitation(db, token, PASSWORD)),            // consumed
      await refused(acceptInvitation(db, live, PASSWORD)),             // expired
      await refused(acceptInvitation(db, mintInvitationToken().token, PASSWORD)), // unknown
      await refused(acceptInvitation(db, "malformed", PASSWORD)),      // malformed
    ];
    const shapes = new Set(errors.map((e) => `${(e as Error).constructor.name}:${(e as Error).message}`));
    expect(shapes.size, `four refusals produced ${shapes.size} distinguishable shapes`).toBe(1);
    expect([...shapes][0]).toBe("InvitationRefused:invitation refused");
  });
});

// ─── ATOMICITY, BOTH DIRECTIONS ────────────────────────────────────────────────────────────────

describe("F53 · the two writes share ONE transaction, in both failure directions", () => {
  it("CONSUMPTION FAILS after the credential write → the WHOLE transaction rolls back", async () => {
    // Forced by burning the row underneath the acceptance, so its own UPDATE affects 0 rows. Without
    // one transaction this would leave a credential written against a token still marked live.
    const { token, id } = await issue();
    const err = await refused(db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE ascend_invite");
      const found = await tx.query<{ id: string; user_id: string }>(
        "SELECT id, user_id FROM invitations WHERE token_hash = $1 FOR UPDATE", [digestOf(token)]);
      const cred = await tx.query(
        `UPDATE users SET password_hash='x', password_algo='scrypt', password_set_at=now()
          WHERE id=$1`, [found.rows[0].user_id]);
      expect(cred.affected).toBe(1);                       // the credential write DID succeed
      const burned = await tx.query(
        "UPDATE invitations SET consumed_at = now() WHERE id = $1 AND consumed_at IS NOT NULL", [id]);
      if (burned.affected !== 1) throw new InvitationRefused();
      return null;
    }));
    expect(err).toBeInstanceOf(InvitationRefused);
    expect(await credentialOf(partner), "a credential survived a rolled-back acceptance").toBeNull();
    expect(await consumedAt(id), "the token was burned by a rolled-back acceptance").toBeNull();
  });

  it("CONSUMING FIRST makes the credential write REFUSED BY THE DATABASE — order is schema-enforced", async () => {
    // 006's `invite_sets_credential` policy permits the credential write only WHILE a live
    // invitation exists. Burning first removes the row it depends on, so an implementation that
    // reordered the two writes cannot half-accept — it is refused outright.
    const { token, id } = await issue();
    const err = await refused(db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE ascend_invite");
      const found = await tx.query<{ id: string; user_id: string }>(
        "SELECT id, user_id FROM invitations WHERE token_hash = $1 FOR UPDATE", [digestOf(token)]);
      await tx.query("UPDATE invitations SET consumed_at = now() WHERE id = $1", [found.rows[0].id]);
      const cred = await tx.query(
        `UPDATE users SET password_hash='x', password_algo='scrypt', password_set_at=now()
          WHERE id=$1`, [found.rows[0].user_id]);
      // The policy no longer matches: zero rows updated, nothing written.
      expect(cred.affected, "the credential write was permitted after the token was burned").toBe(0);
      throw new InvitationRefused();
    }));
    expect(err).toBeInstanceOf(InvitationRefused);
    expect(await credentialOf(partner)).toBeNull();
    expect(await consumedAt(id)).toBeNull();
  });

  it("the consumption guard refuses a second burn — the concurrent loser's path", async () => {
    // PGlite is single-connection, so TRUE simultaneity cannot be demonstrated here. What is
    // demonstrated is the guard the losing transaction hits: `consumed_at IS NULL` matching zero
    // rows. The genuinely concurrent case needs real Postgres and is recorded, not claimed.
    const { token, id } = await issue();
    await acceptInvitation(db, token, PASSWORD);
    const second = await pg.query(
      "UPDATE invitations SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL", [id]);
    expect(second.affectedRows ?? 0).toBe(0);
  });
});

// ─── PRIVILEGE, DEMONSTRATED RATHER THAN PROMISED ──────────────────────────────────────────────

describe("F53 · ascend_invite can do its one job and nothing else", () => {
  const denied = async (sql: string, params: unknown[] = []) => {
    const err = await refused(asInvite((tx) => tx.query(sql, params as SqlValue[])));
    expect(err, `NOT refused: ${sql.slice(0, 60)}`).toBeDefined();
    return String((err as Error).message);
  };

  it("cannot READ credential material — it writes credentials and cannot read them", async () => {
    expect(await denied("SELECT password_hash FROM users")).toMatch(/permission denied|not permitted/i);
  });

  it("cannot touch memberships — it grants no authority and cannot see any", async () => {
    await denied("SELECT * FROM memberships");
    await denied("UPDATE memberships SET role = 'owner'");
  });

  it("cannot INSERT or DELETE invitations — it accepts them, it does not issue or erase them", async () => {
    await denied(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1,$2,'x',$3, now() + interval '1 h')`, [org, partner, owner]);
    await denied("DELETE FROM invitations");
  });

  it("cannot change anything about a user except the three credential columns", async () => {
    await denied("UPDATE users SET email = 'attacker@test'");
    await denied("UPDATE users SET disabled_at = NULL");
  });

  it("cannot reach business data at all", async () => {
    await denied("SELECT * FROM prospects");
    await denied("SELECT * FROM organizations");
  });

  it("sees dead invitations but they yield nothing — the bound on what widening the policy cost", () => {
    // 006's header records why the SELECT policy is `true`: a policy hiding consumed rows made
    // consuming them impossible. This asserts the BOUND on that concession rather than pretending
    // it was not made — the role reads a digest and two timestamps, and no token, issuer or
    // organization. Uniform refusal is preserved by the acceptance query's single predicate, which
    // the F53 matrix above proves behaviourally.
    const granted = ["id", "user_id", "token_hash", "expires_at", "consumed_at"];
    expect(granted).not.toContain("organization_id");
    expect(granted).not.toContain("created_by");
  });

  it("cannot read the columns it was never granted, even on a live invitation", async () => {
    await issue();
    await denied("SELECT organization_id FROM invitations");
    await denied("SELECT created_by FROM invitations");
  });
});

// ─── THE NON-SUPERUSER BOUNDARY ────────────────────────────────────────────────────────────────
//
// 001's header records the defect that made the whole Stage 2A/2B suite green against a schema that
// was unusable on managed Postgres: superusers may assume ANY role unconditionally, PGlite runs as
// one, and nothing noticed until the roles met a real login.
//
// THAT WAS NEVER A LIMIT OF PGlite. `SET SESSION AUTHORIZATION` changes `session_user`, and role
// assumption is checked against `session_user` — so a non-superuser login is representable here
// exactly, and the question simply had not been asked. It is asked now.
//
// This block exists because 006 originally granted `ascend_invite` TO `current_user` — copied from
// 001, whose grant targets the MIGRATING identity. The application connects as `ascend_app`, which
// receives its assumable roles from `ASSUMABLE_ROLES` in core/db/provision. `ascend_invite` was not
// in that list, so every acceptance in production would have failed `permission denied to set role`
// while all eighteen tests above passed.

describe("F53 · the application login can actually ASSUME the acceptance role", () => {
  /** A login shaped exactly as `provisionAppLogin` shapes `ascend_app`. */
  const PROBE = "probe_app_login";

  /**
   * ITS OWN DATABASE, and that is forced rather than tidy.
   *
   * MEASURED: in PGlite, session authorization is a ONE-WAY DOOR. After `SET SESSION AUTHORIZATION`,
   * none of `RESET SESSION AUTHORIZATION`, `SET SESSION AUTHORIZATION DEFAULT`, or a multi-statement
   * `exec` restores `session_user` — it stays as the probe. Sharing the suite's database would
   * therefore poison every later test, which it did: the first symptom was "permission denied for
   * table invitations" from the shared TRUNCATE, three tests away from the cause.
   *
   * So this block boots a disposable instance, becomes the probe freely, and throws it away.
   */
  let probePg: PGlite;
  let riOrgA: string;
  let riUserA: string;
  let riUserB: string;

  beforeAll(async () => {
    probePg = new PGlite();
    await probePg.exec(SCHEMA);
    await probePg.exec(`DO $$ BEGIN CREATE ROLE ${PROBE} LOGIN NOCREATEDB NOCREATEROLE NOINHERIT
                          NOBYPASSRLS NOREPLICATION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await probePg.exec(`DO $$ BEGIN CREATE ROLE never_granted NOLOGIN;
                          EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Exactly what provisioning grants — the list itself, never a hand-written copy of it.
    await probePg.exec(`GRANT ${ASSUMABLE_ROLES.join(", ")} TO ${PROBE} WITH INHERIT FALSE, SET TRUE`);

    // ─── A SECOND, UNRELATED ROLE — for the REAL RI-bypasses-RLS measurement below ────────────────
    //
    // Deliberately NOT `${PROBE}` and NOT any `ASSUMABLE_ROLES` member. Granting `${PROBE}` a direct
    // privilege would stop it mirroring what `provisionAppLogin` actually shapes — a login with NO
    // privileges of its own — and reusing an `ascend_*` role would measure THAT role's own org-keyed
    // policy, not an arbitrary low-privilege writer's. `NOSUPERUSER`/`NOBYPASSRLS` are `CREATE ROLE`
    // defaults; stated anyway so the construction is legible without consulting `pg_roles`.
    await probePg.exec(`DO $$ BEGIN CREATE ROLE probe_ri_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
                          EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // A non-org-keyed grant: nothing here stops a cross-organization row at the RLS layer, so if one
    // is still refused below, the refusal can only be the foreign key.
    await probePg.exec(`GRANT INSERT ON invitations TO probe_ri_writer`);
    await probePg.exec(`CREATE POLICY probe_ri_writer_inserts ON invitations
                          FOR INSERT TO probe_ri_writer WITH CHECK (true)`);
    // Deliberately absent: any grant on `memberships`, to anyone named `probe_ri_writer`. Absence of
    // a grant is a stronger construction than mere invisibility (§28.13 v2, F3).

    const orgA = await probePg.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('probe-ri-a','Probe RI A') RETURNING id");
    riOrgA = orgA.rows[0].id;
    const orgB = await probePg.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('probe-ri-b','Probe RI B') RETURNING id");
    const ua = await probePg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('probe-ri-a@test','Probe RI A') RETURNING id");
    riUserA = ua.rows[0].id;
    const ub = await probePg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('probe-ri-b@test','Probe RI B') RETURNING id");
    riUserB = ub.rows[0].id;
    await probePg.query(
      "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner')",
      [riUserA, riOrgA]);
    // riUserB is a member of orgB ONLY — the pairing that makes a (riOrgA, riUserB) insert cross-org.
    await probePg.query(
      "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner')",
      [riUserB, orgB.rows[0].id]);
  }, 60_000);

  afterAll(async () => { await probePg.close(); });

  /** Can a NON-SUPERUSER login become this role? The question production actually asks. */
  async function canAssume(role: string): Promise<boolean> {
    try {
      await probePg.query(`SET SESSION AUTHORIZATION ${PROBE}`);
      await probePg.query(`SET ROLE ${role}`);
      return true;
    } catch {
      return false;
    } finally {
      // Best effort only — see above. Correctness here comes from the instance being disposable,
      // not from the reset working.
      try { await probePg.query("RESET ROLE"); } catch { /* already not permitted */ }
    }
  }

  // ─── THE REAL MEASUREMENT — F3, §28.13 (v2) ────────────────────────────────────────────────────
  //
  // The renamed test in the §28.13 describe block below runs on the suite's plain PGlite connection
  // — a superuser — and a superuser bypasses row security on its own terms. It proves the constraint
  // does not accidentally require a session organization; it proves nothing about whether RI ITSELF
  // ignores a genuine restriction, because nothing was restricting that writer to begin with.
  //
  // `probe_ri_writer` is the non-vacuous writer: NOSUPERUSER, NOBYPASSRLS, not the owner of either
  // table, holding INSERT on `invitations` under a policy that is NOT keyed on `organization_id`,
  // and holding NO PRIVILEGE WHATSOEVER on `memberships`. If a cross-organization row is still
  // refused under it, the refusal can only be the foreign key — there is no policy left to credit it
  // to, and no visibility into `memberships` from which the writer could have checked itself.
  //
  // PLACED BEFORE "CONTROL", DELIBERATELY. `probePg`'s `session_user` is a ONE-WAY DOOR once any test
  // calls `SET SESSION AUTHORIZATION` (see the block header) — every test below this point runs that
  // call. `SET ROLE probe_ri_writer` needs no grant only while this connection is still superuser,
  // so this measurement has to run first. Every query below is wrapped in its own transaction with
  // `SET LOCAL ROLE`, so `session_user` and the ambient role are untouched once it commits — the
  // tests below still meet the same superuser connection they always did.

  /** Runs `fn` as `probe_ri_writer`, inside its own transaction, `SET LOCAL` — never session-scoped. */
  async function asRiWriter<T>(fn: () => Promise<T>): Promise<T> {
    await probePg.query("BEGIN");
    try {
      await probePg.query("SET LOCAL ROLE probe_ri_writer");
      const out = await fn();
      await probePg.query("COMMIT");
      return out;
    } catch (e) {
      await probePg.query("ROLLBACK");
      throw e;
    }
  }

  /**
   * Every assertion below depends on these holding. Asserted and FAILED, never skipped — a test that
   * silently no-ops when its precondition is false is the exact defect this closes.
   *
   * Wrapped in its own SAVEPOINT because the `memberships` probe is EXPECTED to error, and an error
   * mid-transaction aborts every later statement in it until a ROLLBACK — including the real
   * measurement that follows this call.
   */
  async function assertRiWriterPreconditions(): Promise<void> {
    const who = await probePg.query<{ u: string }>("SELECT current_user AS u");
    expect(who.rows[0].u, "not acting as the role this measurement depends on")
      .toBe("probe_ri_writer");

    const attrs = await probePg.query<{ su: boolean; brls: boolean }>(
      "SELECT rolsuper AS su, rolbypassrls AS brls FROM pg_roles WHERE rolname = current_user");
    expect(attrs.rows[0].su, "probe_ri_writer is a superuser — this measurement would be vacuous")
      .toBe(false);
    expect(attrs.rows[0].brls,
      "probe_ri_writer bypasses RLS directly — this measurement would be vacuous").toBe(false);

    const orgSetting = await probePg.query<{ v: string | null }>(
      "SELECT current_setting('ascend.org_id', true) AS v");
    expect(orgSetting.rows[0].v, "a session organization is set — this must be the unscoped case")
      .toBeFalsy();

    await probePg.query("SAVEPOINT membership_probe");
    let membershipsErr: unknown;
    try { await probePg.query("SELECT 1 FROM memberships"); }
    catch (e) { membershipsErr = e; }
    finally { await probePg.query("ROLLBACK TO SAVEPOINT membership_probe"); }
    expect(membershipsErr, "probe_ri_writer could read memberships — it must hold no privilege there")
      .toBeDefined();
    expect(String(membershipsErr)).toMatch(/permission denied/i);
  }

  it("PRECONDITIONS · probe_ri_writer is genuinely low-privilege, or nothing below measures anything",
    () => asRiWriter(assertRiWriterPreconditions));

  it("THE REAL MEASUREMENT · a low-privilege writer with no visibility into memberships still " +
     "inserts a legitimate row with no session organization set", () =>
    asRiWriter(async () => {
      await assertRiWriterPreconditions();
      // NO `RETURNING id`, DELIBERATELY: `id` is DEFAULT-generated, not one of the inserted columns,
      // so returning it needs SELECT on that column — a privilege this writer was deliberately not
      // given. MEASURED while writing this test: with `RETURNING id`, this failed with "permission
      // denied for table invitations", which is Postgres enforcing the read half of RETURNING rather
      // than any refusal this test is about. `affectedRows` is enough to prove the write happened.
      const ins = await probePg.query(
        `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
        [riOrgA, riUserA, digestOf("probe-ri-writer-legit"), riUserA]);
      expect(ins.affectedRows,
        "the constraint refused a legitimate row for a genuinely low-privilege writer").toBe(1);
    }));

  it("…and the SAME writer is refused a cross-organization row — by the FOREIGN KEY, not a " +
     "permission it never held", () =>
    asRiWriter(async () => {
      await assertRiWriterPreconditions();
      let err: unknown;
      try {
        await probePg.query(
          `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
          [riOrgA, riUserB, digestOf("probe-ri-writer-cross-org"), riUserA]);
      } catch (e) { err = e; }
      expect(err, "a cross-organization insert was not refused").toBeDefined();
      // THE CLASS IS PART OF THE ASSERTION. 23503 is foreign_key_violation; 42501 would mean the
      // refusal came from a permission this writer never had a chance to exercise, which would prove
      // nothing about referential integrity.
      expect((err as { code?: string }).code,
        `refused for the wrong reason: ${String(err)}`).toBe("23503");
      // THE CONSTRAINT IS PART OF THE ASSERTION TOO. `invitations` carries three foreign keys —
      // pinning only the code would still pass if a future fixture change hit
      // `invitations_user_id_fkey` or `invitations_organization_id_fkey` instead, never reaching the
      // constraint this test is about. The driver populates `err.constraint`; its three sibling tests
      // already match this by message.
      expect((err as { constraint?: string }).constraint,
        `refused by the wrong constraint: ${String(err)}`).toBe("invitation_targets_a_member");
    }));

  it("CONTROL · the probe is genuinely non-superuser, and the check discriminates", async () => {
    // Without both halves the assertions below could pass because EVERYTHING is assumable — which
    // is precisely how the Stage 2A/2B suite stayed green against an unusable schema.
    const su = await probePg.query<{ s: boolean }>(
      "SELECT rolsuper AS s FROM pg_roles WHERE rolname = $1", [PROBE]);
    expect(su.rows[0].s, "the probe login is a superuser — it would assume anything").toBe(false);
    expect(await canAssume("never_granted"),
      "an UNGRANTED role was assumable — this check cannot detect a missing grant").toBe(false);
  });

  it("every role the provisioning model declares is assumable by the login", async () => {
    const cannot: string[] = [];
    for (const role of ASSUMABLE_ROLES) if (!(await canAssume(role))) cannot.push(role);
    expect(cannot, "ASSUMABLE_ROLES names a role the login cannot become").toEqual([]);
  });

  it("ascend_invite is one of them — the acceptance path is inert without it", async () => {
    // THE REGRESSION. 006 first granted ascend_invite TO current_user — copied from 001, whose grant
    // targets the MIGRATING identity. The application connects as ascend_app, which takes its
    // assumable roles from ASSUMABLE_ROLES. Before the fix this is RED with "permission denied to
    // set role", which is exactly what production would have answered on every acceptance while all
    // eighteen tests above passed.
    expect(ASSUMABLE_ROLES as readonly string[],
      "ascend_invite is not in the provisioning model, so a reprovisioned login cannot assume it")
      .toContain("ascend_invite");
    expect(await canAssume("ascend_invite"),
      "the application login cannot become ascend_invite — acceptance fails in production").toBe(true);
  });

  // ─── THE LOGIN ITSELF, NOT JUST WHAT IT CAN ASSUME — §28.13 (v2) EXTENDED ──────────────────────
  //
  // P1.1/P1.2 below iterate `ASSUMABLE_ROLES` only. `ascend_app` is not a member of that list — it is
  // the login the roles are granted TO — and it is the role that actually opens the connection, so it
  // is the one most likely to receive a stray grant directly rather than through a role. That gap is
  // DEMONSTRATED, not theoretical: `GRANT SET ON PARAMETER session_replication_role TO <login>` names
  // none of TABLES, SEQUENCES, or FUNCTIONS, so `provision.ts`'s blanket `REVOKE ALL PRIVILEGES` on
  // those three object kinds does not touch it and it would survive re-provisioning silently. Add that
  // one grant to a login shaped exactly as `provisionAppLogin` shapes `ascend_app` and it can suppress
  // the FK, write a cross-organization invitation, then `SET LOCAL ROLE ascend_invite` and set the
  // victim's credential — while every DIRECT attempt at the same harm (`UPDATE users SET
  // password_hash`, `INSERT INTO memberships`, `DROP CONSTRAINT`) still refuses with 42501. That is
  // ESCALATION through the login itself, which is exactly what §28.15's exclusion argument claims
  // cannot happen for an ordinary writer.
  //
  // PROBE, above, is already shaped exactly that way: LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, no
  // direct grant on any table, `ASSUMABLE_ROLES` granted WITH INHERIT FALSE — so nothing below is a
  // third PGlite or a new login, only a new question asked of the one already provisioned.
  //
  // `SET SESSION AUTHORIZATION`, not `SET ROLE` — a grant made to the LOGIN, not to a role it assumes,
  // is what this measures. Placed last: it is the same one-way door documented at the top of this
  // block, and by this point every earlier test here has already crossed it.
  async function asProbeItself<T>(fn: () => Promise<T>): Promise<T> {
    await probePg.query(`SET SESSION AUTHORIZATION ${PROBE}`);
    return fn();
  }

  it("P1.1(app login) · ascend_app itself cannot SET session_replication_role", () =>
    asProbeItself(async () => {
      const err = await refused(probePg.query("SET session_replication_role = replica"));
      expect(err, `${PROBE} itself was able to suppress trigger firing`).toBeDefined();
      // The right reason: a permission refusal, not an incidental artefact of a login that cannot
      // even log in or was never granted the roles it is supposed to hold.
      expect(String(err), `refused for the wrong reason: ${String(err)}`).toMatch(/permission denied/i);
    }));

  it("P1.2(app login) · ascend_app itself cannot disable triggers on invitations", () =>
    asProbeItself(async () => {
      const err = await refused(probePg.query("ALTER TABLE invitations DISABLE TRIGGER ALL"));
      expect(err, `${PROBE} itself was able to disable triggers on invitations`).toBeDefined();
      expect(String(err), `refused for the wrong reason: ${String(err)}`)
        .toMatch(/permission denied|must be owner/i);
    }));

  it("P1.2(app login) · ascend_app itself cannot drop invitation_targets_a_member", () =>
    asProbeItself(async () => {
      const err = await refused(
        probePg.query("ALTER TABLE invitations DROP CONSTRAINT invitation_targets_a_member"));
      expect(err, `${PROBE} itself was able to drop invitation_targets_a_member`).toBeDefined();
      expect(String(err), `refused for the wrong reason: ${String(err)}`)
        .toMatch(/permission denied|must be owner/i);
    }));
});

// ─── 2G.3 §28.4 — WHAT MINTING MAY AND MAY NOT DO ──────────────────────────────────────────────
//
// Added with the minting route, against the same real schema. The route's own suite proves status
// codes against a stub; these two properties are only meaningful against real policies and grants.

describe("§28.13 · an invitation may only name a member of the issuer's organization", () => {
  /** An organization and a member of it that the caller does NOT belong to. */
  async function outsider(tag: string): Promise<string> {
    const otherOrg = (await pg.query<{ id: string }>(
      `INSERT INTO organizations (slug, name) VALUES ('${tag}','${tag}') RETURNING id`)).rows[0].id;
    const user = (await pg.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ('${tag}@test','${tag}') RETURNING id`)).rows[0].id;
    await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
      [user, otherOrg]);
    return user;
  }

  // ─── THE TWO TESTS BELOW NOW AGREE. THEY DID NOT ALWAYS. ─────────────────────────────────────
  //
  // Until `007` these two disagreed ON PURPOSE, and the header here explained at length why that was
  // not a stale test beside a correct one:
  //
  //     cross-organization invitation  →  SUCCEEDED  (raw SQL, as ascend_owner)
  //     cross-organization invitation  →  REFUSED    (through createInvitation)
  //
  // That gap was §28.13. The application had a barrier; the schema had none, so the barrier bound one
  // statement rather than every writer.
  //
  // `007_invitation_membership` closed it with a composite foreign key onto the membership row that
  // makes the pair meaningful. Both layers now refuse, and the reading of the pair inverts:
  //
  //     APPLICATION   createInvitation refuses first, with a clean InvitationTargetRefused → 404
  //     DATABASE      the constraint refuses every ORDINARY writer — 007's header names the
  //                   population: the login `ascend_app` and every role in `ASSUMABLE_ROLES`, the
  //                   entire application surface. That is NARROWER than "any writer" — 007's own
  //                   "WHAT IT DOES NOT BIND" section names who escapes it (a role holding `SET
  //                   session_replication_role`, `ALTER TABLE … DISABLE TRIGGER`, or `ALTER TABLE …
  //                   DROP CONSTRAINT` — `postgres`, in production) and why excluding them costs
  //                   nothing. An earlier version of this comment claimed the unqualified "any
  //                   writer" and was RETRACTED as false; read 007's header, not this paragraph, for
  //                   the current claim.
  //
  // ─── THE APPLICATION PREDICATE WAS KEPT, DELIBERATELY ────────────────────────────────────────
  //
  // It is now redundant as a barrier and is not redundant as an INTERFACE: without it a cross-org
  // mint surfaces as a raw foreign-key violation and a 500, instead of a 404 the operator can act on.
  // Defence in depth, and a better error — not the check-then-write shape §28.13 Path B removed,
  // because the predicate lives INSIDE the write.
  //
  // ─── HOW TO READ THE FOUR COMBINATIONS, RESTATED FOR THE POST-007 WORLD ──────────────────────
  //
  //   APP refusal   DB constraint   Meaning
  //   ───────────────────────────────────────────────────────────────────────────────────────────
  //   GREEN         GREEN           Both barriers hold. This is the post-007 state.
  //   GREEN         RED             The CONSTRAINT stopped refusing — dropped, or the migration did
  //                                 not apply. The application still refuses, so nothing is
  //                                 exploitable through the supported path, but the second barrier
  //                                 is gone and §28.13 has reopened. Investigate the schema, not
  //                                 the test.
  //   RED           GREEN           The application predicate broke. The database still refuses, so
  //                                 the invariant HOLDS — but the operator now meets a 500 where a
  //                                 404 belongs, and one layer of the pair is unguarded.
  //   RED           RED             INCIDENT. Neither layer refuses. Cross-organization minting is
  //                                 live. This is the only combination that is an incident rather
  //                                 than a defect to schedule.
  //
  // Note what changed: before `007` the incident row was RED/GREEN, because the database was never
  // a barrier at all. After `007` it is RED/RED. A reader who remembers the old table and applies it
  // here will misclassify the severity of both middle rows.

  // ─── CLAIM 1 · THE DATABASE ITSELF NOW REFUSES IT ────────────────────────────────────────────
  //
  // This test did not disappear when the schema gained the constraint — it was INVERTED. Its subject
  // is unchanged: what the database does with a cross-organization invitation written by raw SQL,
  // going around every application barrier. Only the expected answer moved.
  //
  //   before 007   asserted the write SUCCEEDS   → proof the schema did not encode ownership
  //   after  007   asserts the write is REFUSED  → proof the schema now does
  it("RAW SQL as ascend_owner CANNOT create a cross-organization invitation", async () => {
    const target = await outsider("hazard");
    const digest = digestOf("raw-sql-cross-org-token");

    const err = await refused(asOwner((tx) => tx.query(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
      [org, target, digest, owner])));

    expect(err, "raw SQL still wrote a cross-organization invitation — §28.13 has reopened").toBeTruthy();
    expect(String(err), "refused for some other reason than the membership constraint")
      .toMatch(/invitation_targets_a_member/);

    const rows = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE user_id = $1", [target]);
    expect(Number(rows.rows[0].n)).toBe(0);
  });

  it("NO SESSION ORGANIZATION SET → the constraint still permits a legitimate row, and the FK " +
     "column order is confirmed, not transposed", async () => {
    // NOT a measurement of privilege: `pg` is the suite's plain PGlite connection, a superuser, and
    // a superuser bypasses row security on its own terms regardless of what RI does. What this DOES
    // show, honestly: the constraint's lookup does not accidentally depend on `current_org()` being
    // set, so a migration, a fixture, or administrative repair — none of which run under a resolved
    // principal — still write a legitimate row; and because the values are (user_id=partner,
    // organization_id=org) in that order against `REFERENCES memberships (user_id,
    // organization_id)`, a transposed FK would have refused this same call, so its passing is also a
    // control on the column order.
    //
    // The genuine non-superuser measurement — a low-privilege writer with no visibility into
    // `memberships` at all — is below, in "the application login can actually ASSUME the acceptance
    // role", where a real non-superuser login already exists to run it against.
    const legit = await pg.query<{ id: string }>(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour') RETURNING id`,
      [org, partner, digestOf("no-session-org-token"), owner]);
    expect(legit.rows.length,
      "the constraint refused a legitimate row when no organization was set").toBe(1);
  });

  it("…and it still refuses a cross-organization row in that same unscoped context", async () => {
    // The other half. If the bypass simply disabled the check, the test above would pass for the
    // wrong reason and the constraint would be decorative outside a principal-scoped session.
    const target = await outsider("unscoped");
    const err = await refused(pg.query(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
      [org, target, digestOf("unscoped-cross-org"), owner]));
    expect(String(err)).toMatch(/invitation_targets_a_member/);
  });

  // ─── ON DELETE RESTRICT — the ruling of 2026-08-31, demonstrated ─────────────────────────────

  it("a membership with NO invitations can still be deleted", async () => {
    // The permissive half. Without it, RESTRICT could be refusing everything and the test below
    // would pass for the wrong reason.
    const spare = (await pg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('spare@test','Spare') RETURNING id")).rows[0].id;
    await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
      [spare, org]);
    await expect(pg.query("DELETE FROM memberships WHERE user_id = $1", [spare])).resolves.toBeTruthy();
  });

  it("a membership WITH an invitation is REFUSED, rather than silently erasing the record", async () => {
    // Why RESTRICT and not CASCADE: an invitation is historical business evidence — who was invited
    // into which organization, by whom, and whether they accepted. CASCADE would let a membership
    // deletion destroy that quietly.
    await issue();
    const err = await refused(pg.query(
      "DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2", [partner, org]));
    expect(err, "the membership was deleted and took the invitation history with it").toBeTruthy();
    expect(String(err)).toMatch(/invitation_targets_a_member/);

    const survived = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE user_id = $1", [partner]);
    expect(Number(survived.rows[0].n), "the invitation record did not survive").toBe(1);
  });

  it("REVOCATION is unaffected — it disables the user, it does not delete the membership", async () => {
    // The reason RESTRICT costs little in practice (005/2F): the supported revocation path sets
    // `users.disabled_at`, which principal resolution reads on every request. It never reaches this
    // constraint, so a live invitation cannot block an operator from revoking access.
    await issue();
    await expect(pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [partner]))
      .resolves.toBeTruthy();
    await pg.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [partner]);
  });

  it("DELETING THE USER still cascades — RESTRICT on memberships does not deadlock it", async () => {
    // The edge case worth measuring rather than reasoning about: deleting a user cascades to BOTH
    // `memberships` and `invitations` through their own ON DELETE CASCADE keys, while the new
    // constraint says memberships may not be deleted while an invitation references them. Whether
    // that conflicts depends on the order Postgres processes the cascades.
    const doomed = (await pg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('doomed@test','Doomed') RETURNING id")).rows[0].id;
    await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
      [doomed, org]);
    await asOwner((tx) => createInvitation(tx,
      { organizationId: org, userId: doomed, createdBy: owner, ttlMs: HOUR }));

    await expect(pg.query("DELETE FROM users WHERE id = $1", [doomed])).resolves.toBeTruthy();
    const left = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE user_id = $1", [doomed]);
    expect(Number(left.rows[0].n), "invitation rows outlived the user they name").toBe(0);
  });

  // ─── CLAIM 2 · THE APPLICATION WRITE REFUSES IT, ATOMICALLY ──────────────────────────────────
  //
  // §28.13 Path B. The membership predicate lives INSIDE the INSERT, so there is no check-then-write
  // window: the row either matches a membership in `current_org()` at write time or no row exists.
  it("createInvitation REFUSES a target outside the issuer's organization", async () => {
    const target = await outsider("refused");
    const err = await refused(asOwner((tx) =>
      createInvitation(tx, { organizationId: org, userId: target, createdBy: owner, ttlMs: HOUR })));
    expect(err, "createInvitation minted across organizations").toBeInstanceOf(InvitationTargetRefused);

    const rows = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE user_id = $1", [target]);
    expect(Number(rows.rows[0].n), "a refused mint still wrote a row").toBe(0);
  });

  it("createInvitation REFUSES a user with no membership at all", async () => {
    const nobody = (await pg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('nobody@test','Nobody') RETURNING id")).rows[0].id;
    const err = await refused(asOwner((tx) =>
      createInvitation(tx, { organizationId: org, userId: nobody, createdBy: owner, ttlMs: HOUR })));
    expect(err).toBeInstanceOf(InvitationTargetRefused);
  });

  it("THE CONTROL · the same call for a REAL member still succeeds", async () => {
    // Without this, a predicate that refused everything would pass both tests above while breaking
    // the feature entirely.
    const issued = await issue();
    expect(issued.id, "the predicate refuses legitimate members too").toBeTruthy();
  });

  it("the predicate reads `current_org()`, not the caller's argument", async () => {
    // The organization the caller PASSES is used for the row; the organization the predicate matches
    // against comes from the session `asPrincipal` established. An issuer therefore cannot widen
    // their reach by passing a different organizationId — the membership lookup ignores it.
    const otherOrg = (await pg.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('claimed','Claimed') RETURNING id")).rows[0].id;
    const err = await refused(asOwner((tx) =>
      createInvitation(tx, { organizationId: otherOrg, userId: partner, createdBy: owner, ttlMs: HOUR })));
    // `partner` IS a member of `org` but the row would claim `otherOrg`; RLS refuses the row itself.
    expect(err, "an issuer minted a row for an organization they do not act in").toBeTruthy();
  });
});

// ─── F2 §28.15 — created_by IS BOUND TO THE ACTING PRINCIPAL, NOT MERELY SUPPLIED ────────────────
//
// 007's composite FK fixes who a row NAMES. It says nothing about who is CREDITED with having sent
// it: an owner could write a row that is perfectly legitimate by the FK's own standard while
// `created_by` names somebody else entirely. `invitations_owner_issues` now closes that too — the
// WITH CHECK requires `created_by = current_user_id()`, so the issuer field is WITNESSED by the
// session rather than merely accepted from whatever the caller passed in.

describe("§28.15 · created_by is bound to the acting principal, not to a membership", () => {
  it("issuance through createInvitation still writes created_by as the resolved principal", async () => {
    const { id } = await issue();
    const row = await pg.query<{ created_by: string }>(
      "SELECT created_by FROM invitations WHERE id = $1", [id]);
    expect(row.rows[0].created_by, "createInvitation's own created_by argument was not written")
      .toBe(owner);
  });

  it("a forged created_by naming an IN-ORG PEER is refused, even though the peer is a real member",
    async () => {
    // `partner` IS a member of `org` — satisfies 007's FK, and satisfies the OLD `organization_id =
    // current_org()` half of this same policy, on its own. Only the NEW clause distinguishes this
    // from a legitimate row.
    const digest = digestOf("forged-created-by-peer");
    const err = await refused(asOwner((tx) => tx.query(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
      [org, partner, digest, partner])));
    expect(err, "an owner forged created_by to a different in-org member and the row was written")
      .toBeTruthy();
    expect(String(err)).toMatch(/permission denied|row-level security/i);

    const rows = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE token_hash = $1", [digest]);
    expect(Number(rows.rows[0].n), "a refused forgery still wrote a row").toBe(0);
  });

  it("a forged created_by naming an OUT-OF-ORG stranger is refused", async () => {
    const stranger = (await pg.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ('created-by-stranger@test','Stranger') " +
      "RETURNING id")).rows[0].id;
    const err = await refused(asOwner((tx) => tx.query(
      `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
      [org, partner, digestOf("forged-created-by-stranger"), stranger])));
    expect(err,
      "an owner forged created_by to a user with no membership at all and the row was written")
      .toBeTruthy();
    expect(String(err)).toMatch(/permission denied|row-level security/i);
  });
});

// ─── F1 §28.13 (v2) — WHAT THE CONSTRAINT DOES NOT BIND, MEASURED RATHER THAN LEFT IN PROSE ──────
//
// 007's header names three suppression capabilities and excludes the actor holding them from its
// claim. This is the premise that exclusion depends on: none of `ASSUMABLE_ROLES` — the entire
// application surface — holds any of them. DERIVED from `ASSUMABLE_ROLES`, never a hand-typed
// literal, so a role added later is covered automatically.

describe("§28.13 (v2) · no assumable role can suppress or remove constraint enforcement", () => {
  const asRole = <T>(role: string, fn: (tx: SqlClient) => Promise<T>) =>
    db.transaction(async (tx) => { await tx.query(`SET LOCAL ROLE ${role}`); return fn(tx); });

  it("P1.1 · no assumable role can SET session_replication_role", async () => {
    for (const role of ASSUMABLE_ROLES) {
      const err = await refused(asRole(role, (tx) => tx.query("SET session_replication_role = replica")));
      expect(err, `${role} was able to suppress trigger firing`).toBeDefined();
    }
  });

  it("P1.2 · no assumable role can disable triggers on invitations", async () => {
    for (const role of ASSUMABLE_ROLES) {
      const err = await refused(asRole(role, (tx) => tx.query("ALTER TABLE invitations DISABLE TRIGGER ALL")));
      expect(err, `${role} was able to disable triggers on invitations`).toBeDefined();
    }
  });

  it("P1.2 · no assumable role can drop invitation_targets_a_member", async () => {
    for (const role of ASSUMABLE_ROLES) {
      const err = await refused(asRole(role,
        (tx) => tx.query("ALTER TABLE invitations DROP CONSTRAINT invitation_targets_a_member")));
      expect(err, `${role} was able to drop invitation_targets_a_member`).toBeDefined();
    }
  });
});

describe("2G.3 · re-minting leaves the earlier invitation live — the documented behaviour", () => {
  it("two live invitations coexist, and the FIRST still works after the second is issued", async () => {
    // §28.3: `ascend_owner` holds SELECT and INSERT on `invitations` and NO UPDATE, so a live
    // invitation cannot be revoked without a migration — which 2G.3 may not add. This is therefore
    // the contracted behaviour rather than an oversight, and the UI says so in plain words.
    const first = await issue();
    const second = await issue();
    expect(first.id).not.toBe(second.id);

    const live = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invitations WHERE user_id = $1 AND consumed_at IS NULL", [partner]);
    expect(Number(live.rows[0].n), "the second mint silently invalidated the first").toBe(2);

    await acceptInvitation(db, first.token, PASSWORD);
    expect(await consumedAt(first.id), "the first token was not burned").not.toBeNull();
    expect(await consumedAt(second.id), "issuing a second link burned it too").toBeNull();
  });

  it("the OTHER link remains usable until it expires — stated, because it is a real exposure", async () => {
    // Not a defect and not hidden: an operator who mints twice has created two password-setting
    // secrets, and the TTL is the only thing that ends the unused one. That is exactly why the panel
    // tells them so, and why the TTL is short.
    const first = await issue();
    const second = await issue();
    await acceptInvitation(db, first.token, PASSWORD);
    await expect(acceptInvitation(db, second.token, "a-different-sufficiently-long-password"))
      .resolves.toMatchObject({ userId: partner });
  });

  it("the owner CANNOT revoke one — the grant that would make it possible is absent", async () => {
    const { id } = await issue();
    const err = await refused(asOwner((tx) =>
      tx.query("UPDATE invitations SET consumed_at = now() WHERE id = $1", [id])));
    expect(err, "ascend_owner was able to update invitations — 006's grant has widened").toBeTruthy();
    expect(String(err)).toMatch(/permission denied/i);
  });
});
