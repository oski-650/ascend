// Layer A — PARTNER PROVISIONING. A one-shot operational gate, not a feature.
//
// ─── WHY THIS IS A GATED TEST AND NOT A SCRIPT ─────────────────────────────────────────────────
//
// Because provisioning a person is exactly the kind of act that should have to prove it worked. A
// script writes rows and prints "done"; this writes the rows and then VERIFIES, against the live
// server, that the partner resolves to `sales`, holds exactly one membership, cannot read anyone's
// credential material, and cannot reach an owner-only capability. Same posture as the 2D.1
// hardening gate.
//
// ─── GATED ON ITS OWN VARIABLE ─────────────────────────────────────────────────────────────────
//
// `ASCEND_PROVISION_PARTNER_URL`, plus the partner's email and an initial password. Its own
// variable, for the reason the migration and hardening gates each have one: this file WRITES to
// production, and sharing a variable with a read-only suite would mean that running the test suite
// provisions a human being.
//
// DIRECT CONNECTION ONLY. `ascend_auth` deliberately holds no INSERT or UPDATE anywhere — it
// authenticates and never writes — so this cannot run as the application even by accident.
//
// ─── WHAT 2F DELIBERATELY DOES NOT BUILD ───────────────────────────────────────────────────────
//
// No invite UI, no password-set page, no email. §12 decision 4 is that the owner invites and the
// partner sets their own password through a single-use token — and that flow, with the UI it has to
// live in, is 2G. Until then the initial password is chosen by the owner and handed over out of
// band, which is why it arrives here as an environment variable and never appears in the repository.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor, type SqlClient } from "@/core/db";
import { setUserCredential, verifyPassword } from "@/core/auth/credentials";
import { credentialFor, resolvePrincipal } from "@/core/auth/principal";
import { CAPABILITIES, can, capabilitiesForRole, type Capability } from "@/core/auth/capabilities";

const DIRECT = process.env.ASCEND_PROVISION_PARTNER_URL;
const EMAIL = process.env.ASCEND_PARTNER_EMAIL;
const PASSWORD = process.env.ASCEND_PARTNER_PASSWORD;
const DISPLAY = process.env.ASCEND_PARTNER_NAME ?? "Partner";
const describeIfProvisioning = DIRECT && EMAIL && PASSWORD ? describe : describe.skip;

// ─── THE PARTNER'S BOUNDARY, READ FROM THE TABLE (PARTNER-GATE-FIX-001) ─────────────────────────
//
// This file first carried hand-typed held/denied lists from 2F, when the partner was a narrow
// salesperson. 2G.4.7 and 2A.1c (owner decisions) made the partner the owner minus exactly `admin:*`
// and `prospects:manage`, and the lists were never brought along: run unmodified, this gate would
// have committed the user, the membership and the credential and only then failed on `finance:*`.
// The expectation is now derived from `core/auth/capabilities.ts`, and it is checked in `beforeAll`
// BEFORE the pool opens, so a wrong expectation fails the suite with nothing written.
const WITHHELD: readonly Capability[] = ["admin:*", "prospects:manage"];
const SALES = capabilitiesForRole("sales");
const OWNER = capabilitiesForRole("owner");
const withheldFrom = (all: readonly Capability[], held: readonly Capability[]) =>
  all.filter((c) => !held.includes(c)).sort();

describeIfProvisioning("2F PARTNER PROVISIONING (requires ASCEND_PROVISION_PARTNER_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    // A failing hook runs none of the tests below: the boundary is proven before any connection.
    expect(withheldFrom(CAPABILITIES, SALES), "sales is not CAPABILITIES minus the recorded two")
      .toEqual([...WITHHELD].sort());
    expect(withheldFrom(OWNER, SALES), "sales is not the owner minus the recorded two")
      .toEqual([...WITHHELD].sort());
    expect(SALES.every((c) => OWNER.includes(c)), "sales holds something the owner does not").toBe(true);
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("the capability boundary is the recorded one, asserted FIRST and writing nothing", () => {
    // Also enforced by beforeAll above, which stops every test; this makes the check a reported result.
    expect(withheldFrom(CAPABILITIES, SALES)).toEqual([...WITHHELD].sort());
    expect(withheldFrom(OWNER, SALES)).toEqual([...WITHHELD].sort());
  });

  it("the organization exists, and it is the one the owner already belongs to", async () => {
    // Never created here. Provisioning a partner must not be able to invent a tenant — that would
    // put the partner in an organization with no owner, which no policy anywhere anticipates.
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = 'ascend'`);
    expect(rows, "no 'ascend' organization — refusing to create one from a provisioning gate")
      .toHaveLength(1);
    orgId = rows[0].id;
  });

  it("provisions the user IDEMPOTENTLY — re-running does not create a second person", async () => {
    await db.query(
      `INSERT INTO users (email, display_name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [EMAIL!, DISPLAY]
    );
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [EMAIL!]);
    expect(rows).toHaveLength(1);
    userId = rows[0].id;
  });

  it("grants exactly ONE membership, and its role is sales", async () => {
    await db.query(
      `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'sales'`,
      [userId, orgId]
    );
    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM memberships WHERE user_id = $1`, [userId]);
    // More than one would make `resolvePrincipal` refuse — deliberately, since 2F is single-org.
    expect(rows, "the partner holds more than one membership").toHaveLength(1);
    expect(rows[0].role).toBe("sales");
  });

  it("sets the initial credential, and it verifies", async () => {
    await setUserCredential(db, EMAIL!, PASSWORD!);
    const credential = await credentialFor(db, EMAIL!);
    expect(credential, "no credential was stored").toBeTruthy();
    expect(await verifyPassword(PASSWORD!, credential!.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD! + "x", credential!.passwordHash)).toBe(false);
    expect(credential!.disabled).toBe(false);
  });

  it("RESOLVES to a sales principal — the database's answer, not ours", async () => {
    const resolution = await resolvePrincipal(db, userId);
    expect(resolution.ok, `resolution failed: ${resolution.ok ? "" : resolution.reason}`).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.principal.role).toBe("sales");
    expect(resolution.principal.organizationId).toBe(orgId);
    expect(resolution.principal.userId).toBe(userId);
  });

  it("and that principal holds EXACTLY the sales row: the owner minus admin:* and prospects:manage", async () => {
    const resolution = await resolvePrincipal(db, userId);
    if (!resolution.ok) throw new Error("resolution failed");
    const p = resolution.principal;
    for (const denied of WITHHELD) expect(can(p, denied), `partner holds ${denied}`).toBe(false);
    for (const c of CAPABILITIES) {
      expect(can(p, c), `partner ${SALES.includes(c) ? "lacks" : "holds"} ${c}`).toBe(SALES.includes(c));
    }
  });

  it("ascend_sales cannot read ANY credential material, including its own", async () => {
    // The column grant, verified on the live server rather than assumed from the migration text.
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE ascend_sales");
        return tx.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      })
    ).rejects.toThrow(/permission denied/i);
  });

  it("REVOCATION works without deleting the person", async () => {
    // Proven and then undone. `disabled_at` is the mechanism a mid-session revocation uses, and it
    // must be demonstrated on the real row rather than trusted.
    await db.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [userId]);
    const disabled = await resolvePrincipal(db, userId);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.reason).toBe("disabled");

    await db.query(`UPDATE users SET disabled_at = NULL WHERE id = $1`, [userId]);
    expect((await resolvePrincipal(db, userId)).ok).toBe(true);
  });
});

describe("partner provisioning — guard", () => {
  it("announces loudly when the partner has NOT been provisioned", () => {
    if (!DIRECT || !EMAIL || !PASSWORD) {
      console.warn(
        "\n  ⚠️  PARTNER NOT PROVISIONED — ASCEND_PROVISION_PARTNER_URL / _EMAIL / _PASSWORD unset.\n" +
        "      The authorization boundary is built and proven; no second human can log in until\n" +
        "      this gate is run with the partner's own email and an owner-chosen initial password.\n"
      );
    }
    expect(true).toBe(true);
  });
});
