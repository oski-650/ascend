// Layer A — 2G.4.1 · THE PROVISIONED PARTNER (STAGE2G §29.3 Ruling 1, §29.6 slice 2G.4.1).
//
// ─── WHAT THIS DISCHARGES ──────────────────────────────────────────────────────────────────────
//
//   row 5  local    cross-organization isolation is default-deny, not an error
//   row 11 local    ascend_sales cannot read any credential column
//   row 9           a plaintext password reaches no captured log sink, with a positive control
//   row 7           `disabled_at` denies a session that is still validly signed and unexpired
//
// Every principal below is a database row, obtained by the same chain production runs for a human
// signing in — no step simulated, and nothing here declares a role. See
// `tests/support/provisioned-partner.ts` for the chain itself and why it is built the way it is.
//
// This suite changes NO production code. If a property here seemed to require one, that would mean
// the design was wrong, not this test.
//
// Against a REAL Postgres (PGlite, Postgres 18 in WASM) carrying the FULL migration set — the same
// discipline `tests/db/invitations.test.ts` uses, and for the same reason: the shared
// `tests/db/pglite` harness applies only 001–003, several migrations behind what this suite needs.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asPrincipal, type SqlClient } from "@/core/db";
import { acceptInvitation } from "@/core/auth/invitations";
import { resolvePrincipal } from "@/core/auth/principal";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import {
  CapabilityDenied, NoAuthority, clearAuthorityResolver, requireCapability,
} from "@/core/auth/authority";
import { readAuthConfig, verifySessionToken } from "@/lib/auth";
import {
  SESSION_SECRET, bindPartnerAuthority, bootDatabase, captureLogs, issueInvitationAsOwner,
  loginPartner, provisionPartner, seedOperationalWorld,
} from "@/tests/support/provisioned-partner";

const PASSWORD = "a-sufficiently-long-partner-password";

let pg: PGlite;
let db: SqlClient;
let savedSecret: string | undefined;

const refused = async (p: Promise<unknown>) => {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  return err;
};

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  ({ pg, db } = await bootDatabase());
}, 60_000);

afterAll(async () => {
  await pg.close();
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

beforeEach(async () => {
  await pg.exec("TRUNCATE invitations, prospects, memberships, users, organizations CASCADE");
  registerAppDb((fn) => fn(db));
});

afterEach(() => {
  clearAppDb();
  clearAuthorityResolver();
});

// ─── THE CHAIN ITSELF ──────────────────────────────────────────────────────────────────────────

describe("THE CHAIN · a real provisioned partner (§29.3 Ruling 1)", () => {
  it("operational INSERT → createInvitation → acceptInvitation → POST login → verifySessionToken " +
     "→ resolvePrincipal → registerAuthorityResolver, no step simulated", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "chain-org", ownerEmail: "chain-owner@test", partnerEmail: "chain-partner@test",
      password: PASSWORD,
    });

    expect(partner.login.response.status, "the real login route refused a genuinely accepted partner")
      .toBe(200);
    expect(partner.principal.role).toBe("sales");
    expect(partner.principal.organizationId).toBe(partner.world.organizationId);
    expect(partner.principal.userId).toBe(partner.world.partnerId);

    // The data-access boundary, bound the same way `lib/authority.ts` binds it for a real request —
    // from the session TOKEN itself, verified on every call, reading the SAME database row the chain
    // above just wrote rather than a value carried over in memory.
    bindPartnerAuthority(db, partner.login.sessionToken!);
    const resolved = await requireCapability("prospects:read");
    expect(resolved).toEqual(partner.principal);
  });
});

// ─── F1 · A NESTED TRANSACTION CANNOT DROP THE BOUND PRINCIPAL ────────────────────────────────
//
// MEASURED (adversarial pass on this harness, 2026-09-01): `adapt()`'s `transaction()` used to be a
// bare BEGIN/COMMIT on the shared PGlite instance, so calling anything that opens its OWN
// transaction inside an `asPrincipal(...)` block — `resolvePrincipal` is exactly such a call —
// committed the OUTER transaction from underneath it. `current_user` fell from `ascend_sales` to
// `postgres` mid-callback, and the same callback went on to read both organizations and durably
// INSERT a row into a foreign one with no error. None of the rows above nest a call this way, so
// nothing above depended on the defect — but this module is the declared substrate for 2G.4.2 and
// 2G.4.3, which will.

describe("F1 · a nested transaction cannot drop the bound principal", () => {
  it("resolvePrincipal, called from inside an asPrincipal block, leaves current_user, ascend.org_id, " +
     "and cross-organization refusal exactly as they were before the nested call", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "f1-org-a", ownerEmail: "f1-owner-a@test", partnerEmail: "f1-partner-a@test",
      password: PASSWORD,
    });
    const orgB = (await db.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('f1-org-b','F1 B') RETURNING id")).rows[0].id;

    const result = await asPrincipal(db, partner.principal, async (tx) => {
      const before = await tx.query<{ u: string }>("SELECT current_user AS u");
      // THE NESTED CALL — resolvePrincipal opens its own transaction (as `ascend_auth`) while this
      // one, bound to `ascend_sales`, is still open around it.
      const nested = await resolvePrincipal(tx, partner.world.partnerId);
      const after = await tx.query<{ u: string }>("SELECT current_user AS u");
      const orgGuc = await tx.query<{ v: string }>(
        "SELECT current_setting('ascend.org_id', true) AS v");
      const crossOrgWrite = await refused(tx.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
         VALUES ($1, gen_random_uuid(), 'anchored', 'hostile', 'Hostile')`, [orgB]));
      return {
        before: before.rows[0].u, nestedOk: nested.ok, after: after.rows[0].u,
        orgGuc: orgGuc.rows[0].v, crossOrgWrite,
      };
    });

    expect(result.before, "the harness itself was not bound to ascend_sales — this measures nothing")
      .toBe("ascend_sales");
    expect(result.nestedOk, "the nested resolvePrincipal call itself failed").toBe(true);
    expect(result.after,
      "current_user changed after the nested call returned — the outer transaction was dropped, " +
      "or the nested call's own role switch leaked upward past it").toBe("ascend_sales");
    expect(result.orgGuc, "ascend.org_id did not survive the nested call")
      .toBe(partner.world.organizationId);
    expect(result.crossOrgWrite,
      "a cross-organization write SUCCEEDED after the nested call — the bound principal was dropped")
      .toBeTruthy();
  });
});

// ─── HARNESS SELF-CONTROLS — BOTH REQUIRED ────────────────────────────────────────────────────
//
// Without these, a defect in this harness could silently fabricate a principal and every row below
// would still pass, having measured nothing.

describe("HARNESS SELF-CONTROLS · this harness cannot fabricate a principal", () => {
  it("SKIP ACCEPTANCE · an invitation that is never accepted leaves no credential, and login FAILS",
    async () => {
    const world = await seedOperationalWorld(db, {
      orgSlug: "control-skip", ownerEmail: "control-skip-owner@test",
      partnerEmail: "control-skip-partner@test",
    });
    await issueInvitationAsOwner(db, world); // minted, deliberately never accepted

    const login = await loginPartner("control-skip-partner@test", PASSWORD);
    expect(login.response.status,
      "login succeeded for a partner who never accepted an invitation — no credential should exist")
      .toBe(401);
    expect(login.sessionToken, "a session cookie was issued with no credential ever set").toBeNull();
  });

  it("DELETE THE MEMBERSHIP · a membership no invitation names resolves to NO-MEMBERSHIP once removed",
    async () => {
    const world = await seedOperationalWorld(db, {
      orgSlug: "control-delete", ownerEmail: "control-delete-owner@test",
      partnerEmail: "control-delete-partner@test",
    });
    // A THIRD user — BINDING: 007's ON DELETE RESTRICT blocks deleting a membership an invitation
    // names, so this control deletes one that no invitation ever named.
    const bystander = (await db.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ($1,'Bystander') RETURNING id",
      ["control-delete-bystander@test"])).rows[0].id;
    await db.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
      [bystander, world.organizationId]);

    await db.query("DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [bystander, world.organizationId]);

    const resolution = await resolvePrincipal(db, bystander);
    expect(resolution).toEqual({ ok: false, reason: "no-membership" });
  });
});

// ─── ROW 5 LOCAL — CROSS-ORGANIZATION ISOLATION IS DEFAULT-DENY, NOT AN ERROR ─────────────────
//
// §29.5's contradiction resolved: a query under a BOUND-BUT-FOREIGN principal is default deny — zero
// rows — where a query with no principal bound at all errors. This is the bound case.

describe("ROW 5 LOCAL · cross-organization isolation, under a real resolved principal", () => {
  it("a SELECT under a bound-but-foreign principal returns ZERO ROWS from the other organization, " +
     "not an error", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "row5-org-a", ownerEmail: "row5-owner-a@test", partnerEmail: "row5-partner-a@test",
      password: PASSWORD,
    });
    const orgB = (await db.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('row5-org-b','Row5 B') RETURNING id")).rows[0].id;
    await db.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'b-one', 'B One')`, [orgB]);
    await db.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'a-one', 'A One')`, [partner.world.organizationId]);

    const seen = await asPrincipal(db, partner.principal,
      (tx) => tx.query<{ organization_id: string }>("SELECT organization_id FROM prospects"));

    expect(seen.rows.length, "org A's own legitimate prospect was not visible either — vacuous")
      .toBeGreaterThan(0);
    expect(seen.rows.every((r) => r.organization_id === partner.world.organizationId),
      "a sales principal bound to org A saw a row belonging to org B").toBe(true);
  });

  it("a cross-tenant WRITE is refused", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "row5-org-a2", ownerEmail: "row5-owner-a2@test", partnerEmail: "row5-partner-a2@test",
      password: PASSWORD,
    });
    const orgB = (await db.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('row5-org-b2','Row5 B2') RETURNING id")).rows[0].id;

    const err = await refused(asPrincipal(db, partner.principal, (tx) => tx.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'hostile', 'Hostile')`, [orgB])));
    expect(err, "a sales principal bound to org A wrote a row claiming org B").toBeTruthy();

    const rows = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM prospects WHERE organization_id = $1", [orgB]);
    expect(Number(rows.rows[0].n), "a refused cross-tenant insert still wrote a row").toBe(0);
  });
});

// ─── ROW 11 LOCAL — ascend_sales CANNOT READ CREDENTIAL MATERIAL ──────────────────────────────
//
// Preconditions asserted FIRST and FAILED, never skipped (§28.15's rule): if the session were not
// genuinely `ascend_sales`, or were superuser or bypassrls, this measures nothing.

async function assertSalesPreconditions(tx: SqlClient): Promise<void> {
  const who = await tx.query<{ u: string }>("SELECT current_user AS u");
  expect(who.rows[0].u, "not bound to ascend_sales — this measurement would be vacuous")
    .toBe("ascend_sales");
  const attrs = await tx.query<{ su: boolean; brls: boolean }>(
    "SELECT rolsuper AS su, rolbypassrls AS brls FROM pg_roles WHERE rolname = current_user");
  expect(attrs.rows[0].su, "ascend_sales is a superuser in this session — the measurement would be vacuous")
    .toBe(false);
  expect(attrs.rows[0].brls,
    "ascend_sales bypasses RLS in this session — the measurement would be vacuous").toBe(false);
}

describe("ROW 11 LOCAL · ascend_sales is refused every credential column", () => {
  it("PRECONDITIONS · the resolved principal genuinely binds to ascend_sales, non-superuser, " +
     "non-bypassrls — or nothing below measures anything", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "row11-org", ownerEmail: "row11-owner@test", partnerEmail: "row11-partner@test",
      password: PASSWORD,
    });
    await asPrincipal(db, partner.principal, (tx) => assertSalesPreconditions(tx));
  });

  it("THE REAL MEASUREMENT · SELECT is refused on password_hash, password_algo and password_set_at",
    async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "row11-org2", ownerEmail: "row11-owner2@test", partnerEmail: "row11-partner2@test",
      password: PASSWORD,
    });
    for (const column of ["password_hash", "password_algo", "password_set_at"]) {
      const err = await refused(asPrincipal(db, partner.principal, async (tx) => {
        await assertSalesPreconditions(tx);
        return tx.query(`SELECT ${column} FROM users`);
      }));
      expect(err, `ascend_sales was able to read users.${column}`).toBeTruthy();
      expect(String(err), `refused for the wrong reason: ${String(err)}`).toMatch(/permission denied/i);
    }

    // R7 (2G.4.1 review): the refusals above are consistent with column-level grants AND with a
    // table-level revocation of `users` from `ascend_sales` entirely — a future migration could
    // revoke the whole table and this test would stay green while measuring something much weaker.
    // 005_user_credentials.sql grants `ascend_sales` SELECT on (id, email, display_name, created_at,
    // disabled_at) after revoking the table grant, so the positive half — a granted column succeeds,
    // in the SAME block, under the SAME principal — is what pins this to column-level isolation.
    const granted = await asPrincipal(db, partner.principal, async (tx) => {
      await assertSalesPreconditions(tx);
      return tx.query<{ id: string }>("SELECT id FROM users WHERE id = $1", [partner.world.partnerId]);
    });
    expect(granted.rows[0]?.id, "ascend_sales was refused a column 005 explicitly grants it")
      .toBe(partner.world.partnerId);
  });
});

// ─── F4 · ROWS 5 AND 11 MEASURE A DATABASE ROW, NOT THE FIXTURE ───────────────────────────────
//
// MEASURED (adversarial pass): skipping invitation, acceptance, password and login entirely and
// writing only the `INSERT INTO memberships` the harness's own `seedOperationalWorld` performs
// yields IDENTICAL row-5 and row-11 results — nothing above depends on the chain that precedes it.
// The control the invariant actually implies is a MUTATION of the provisioned partner's own row,
// observed through the SAME already-bound resolver `bindPartnerAuthority` installs — proving the
// authority a request holds is re-read from `memberships`, not fixed at provisioning time.

describe("F4 · mutating the provisioned partner's own membership changes what the bound resolver answers",
  () => {
  it("UPDATE memberships SET role='owner' for the provisioned partner is observed by the SAME " +
     "already-bound resolver on its very next call", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "f4-org", ownerEmail: "f4-owner@test", partnerEmail: "f4-partner@test",
      password: PASSWORD,
    });
    bindPartnerAuthority(db, partner.login.sessionToken!);

    const before = await requireCapability("prospects:read");
    expect(before.role, "the provisioned partner did not start as sales — this measures nothing")
      .toBe("sales");

    // THE MUTATION — an UPDATE to the PROVISIONED partner's own membership, not a bystander's and
    // not a DELETE: 007's ON DELETE RESTRICT blocks deleting a membership an invitation names, so an
    // UPDATE is the control that isolates "this measures a database row" from "this measures the
    // fixture the harness wrote" without touching that FK.
    await db.query("UPDATE memberships SET role = 'owner' WHERE user_id = $1 AND organization_id = $2",
      [partner.world.partnerId, partner.world.organizationId]);

    const after = await requireCapability("prospects:read");
    expect(after.role,
      "the SAME already-bound resolver did not observe an UPDATE to the partner's own membership row " +
      "— rows 5 and 11 would then rest on the fixture the harness wrote, not on the database")
      .toBe("owner");

    // R4 (2G.4.1 review): the assertions above exercise `bindPartnerAuthority`/`requireCapability` —
    // NOT the mechanism rows 5 and 11 actually use, which is `asPrincipal(db, partner.principal, …)`
    // called directly on the snapshot `provisionPartner` returned. Proving the bound resolver tracks
    // the mutated row says nothing about that other call shape. So: re-resolve off the SAME mutated
    // row, then re-run row 5's own isolation assertion under THAT freshly resolved principal — not
    // under `partner.principal`, which `provisionPartner` returned before the UPDATE ever ran.
    const reresolved = await resolvePrincipal(db, partner.world.partnerId);
    if (!reresolved.ok) throw new Error(`re-resolution after the UPDATE failed (${reresolved.reason})`);
    expect(reresolved.principal.role, "resolvePrincipal itself did not see the UPDATE either")
      .toBe("owner");

    const orgB = (await db.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ('f4-org-b', 'F4 B') RETURNING id")).rows[0].id;
    await db.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'b-one', 'B One')`, [orgB]);
    await db.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name)
       VALUES ($1, gen_random_uuid(), 'anchored', 'a-one', 'A One')`, [partner.world.organizationId]);

    const seen = await asPrincipal(db, reresolved.principal,
      (tx) => tx.query<{ organization_id: string }>("SELECT organization_id FROM prospects"));
    expect(seen.rows.length,
      "the freshly resolved principal's own organization's row was not visible — vacuous")
      .toBeGreaterThan(0);
    expect(seen.rows.every((r) => r.organization_id === partner.world.organizationId),
      "row 5's own isolation assertion, re-run under a principal RE-RESOLVED off the mutated " +
      "membership row rather than under the frozen `partner.principal` snapshot, still held — the " +
      "thing that changed between the two calls is the DATABASE ROW, which is what ties rows 5 and " +
      "11 to it rather than to the fixture this harness wrote").toBe(true);
  });
});

// ─── ROW 9 — A PLAINTEXT PASSWORD REACHES NO LOG SINK, WITH A POSITIVE CONTROL ────────────────
//
// The capture wraps acceptance AND login — the two places a plaintext password is ever in scope —
// and the SAME capture instance is proven live by a sentinel this test emits itself. Without the
// sentinel, "the password never appeared" would be indistinguishable from "the capture was never
// wired to anything".

describe("ROW 9 · the plaintext password reaches no captured log sink", () => {
  it("acceptance and login never log the plaintext password, and the capture is proven live for both " +
     "a bare string and an object-shaped value", async () => {
    const password = "row9-plaintext-must-never-appear-anywhere";
    const sentinel = `row9-positive-control-sentinel-${Date.now()}`;
    const objectSentinel = `row9-object-control-sentinel-${Date.now()}`;

    const world = await seedOperationalWorld(db, {
      orgSlug: "row9-org", ownerEmail: "row9-owner@test", partnerEmail: "row9-partner@test",
    });
    const invitation = await issueInvitationAsOwner(db, world);

    const capture = captureLogs();
    let loginStatus = 0;
    try {
      await acceptInvitation(db, invitation.token, password);
      const login = await loginPartner("row9-partner@test", password);
      loginStatus = login.response.status;
      // CONTROL 1 — a bare string, emitted inside the SAME capture window the sensitive calls just
      // ran in, proving the capture is wired to something at all.
      console.log(sentinel);
      // CONTROL 2 (F2) — the shape a sensitive call could plausibly leak a credential through:
      // `console.error(<label>, { ...secret })`, a sink and an argument shape `password` itself never
      // actually reaches below. `String({ objectSentinel })` would collapse to the useless
      // "[object Object]", which is exactly what made this row's evidence vacuous for object-shaped
      // logging before `captureLogs` switched to `util.inspect`. A DIFFERENT marker than `password` is
      // used here on purpose — this control proves the SHAPE is visible without also manufacturing an
      // appearance of the real secret that the assertion below would then have to explain away.
      console.error("ctx", { objectSentinel });
    } finally {
      capture.restore();
    }

    expect(loginStatus, "the acceptance/login pair under test did not even succeed").toBe(200);
    expect(capture.texts.some((t) => t.includes(sentinel)),
      "the capture never saw its own bare-string sentinel — it is not wired to anything, so a clean " +
      "result below would prove nothing").toBe(true);
    expect(capture.texts.some((t) => t.includes(objectSentinel)),
      "the capture never saw its own OBJECT-SHAPED sentinel — an object-shaped leak, the most " +
      "plausible real shape a credential would appear in, would have been invisible to this suite " +
      "even if it happened").toBe(true);

    // WHAT THIS ROW DOES AND DOES NOT ESTABLISH. With both controls live, the absence asserted below
    // is meaningful across every `console.*`/stdout/stderr sink this capture patches, in both a
    // bare-string argument and an object-shaped one — the two shapes a plaintext credential could
    // plausibly reach a log call through. It does NOT establish that no channel THIS capture does not
    // patch (a request logger's own transport, a crash dump, a network trace) ever sees the password —
    // only that these captured sinks, in these two shapes, do not.
    expect(capture.texts.some((t) => t.includes(password)),
      "the plaintext password reached a captured log sink").toBe(false);
  });
});

// ─── ROW 7 STRENGTHENED — disabled_at DENIES A STILL-VALID, UNEXPIRED SESSION ─────────────────

describe("ROW 7 STRENGTHENED · disabled_at denies a real, still-valid, unexpired session", () => {
  it("a session that resolved successfully once is refused after disabled_at is set — the token " +
     "itself is untouched", async () => {
    const partner = await provisionPartner(db, {
      orgSlug: "row7-org", ownerEmail: "row7-owner@test", partnerEmail: "row7-partner@test",
      password: PASSWORD,
    });
    bindPartnerAuthority(db, partner.login.sessionToken!);

    // BEFORE: the same still-live session resolves normally.
    const before = await requireCapability("prospects:read");
    expect(before.role).toBe("sales");

    // Administrative revocation — BINDING: disabled_at, not membership deletion, and run directly
    // rather than through any application role, exactly as production's supported path does (no
    // application role holds UPDATE on this column).
    await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [partner.world.partnerId]);

    // The SIGNED SESSION ITSELF is untouched and still verifies — this is not an expiry.
    const stillSigned = await verifySessionToken(partner.login.sessionToken!, readAuthConfig());
    expect(stillSigned?.userId, "the session token stopped verifying — this must be a disabled-user " +
      "refusal, not an expired or forged one").toBe(partner.world.partnerId);

    // AFTER: the exact same registered resolver, asked again, now refuses.
    const err = await refused(requireCapability("prospects:read"));
    expect(err, "a disabled user was still granted authority by a real, unexpired session").toBeInstanceOf(NoAuthority);
    expect((err as NoAuthority).reason).toBe("disabled");
    expect(err).not.toBeInstanceOf(CapabilityDenied);
  });
});
