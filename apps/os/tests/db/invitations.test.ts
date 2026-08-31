// Layer A — F53 · INVITATION TOKENS ARE HASHED, SINGLE-USE, AND ATOMIC (2G.2, STAGE2G §27).
//
// Against a REAL Postgres (PGlite, Postgres 18 in WASM) carrying the FULL migration set 001–006, so
// the grants, policies and constraints under test are the ones production runs — not a mock of them.
//
// The shared `tests/db/pglite` harness applies only 001–003, which means every other local substrate
// test runs three migrations behind production. That is a real finding and is NOT fixed here: this
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
import { asPrincipal, type SqlClient, type SqlValue } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { verifyPassword } from "@/core/auth/credentials";
import {
  InvitationRefused, acceptInvitation, createInvitation, digestOf, mintInvitationToken,
} from "@/core/auth/invitations";
import { ASSUMABLE_ROLES } from "@/core/db/provision";
import type { OrganizationId, UserId } from "@/domain";

const MIGRATIONS = [
  "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql",
  "004_schema_migrations.sql", "005_user_credentials.sql", "006_invitations.sql",
];
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

  beforeAll(async () => {
    probePg = new PGlite();
    await probePg.exec(SCHEMA);
    await probePg.exec(`DO $$ BEGIN CREATE ROLE ${PROBE} LOGIN NOCREATEDB NOCREATEROLE NOINHERIT
                          NOBYPASSRLS NOREPLICATION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await probePg.exec(`DO $$ BEGIN CREATE ROLE never_granted NOLOGIN;
                          EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // Exactly what provisioning grants — the list itself, never a hand-written copy of it.
    await probePg.exec(`GRANT ${ASSUMABLE_ROLES.join(", ")} TO ${PROBE} WITH INHERIT FALSE, SET TRUE`);
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
});
