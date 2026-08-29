// Layer A — STAGE 2A SCALE GATE.
//
// The vault's `createProspect` called `buildProspectIdIndex()`, which read EVERY prospect file, so
// importing N rows cost O(N²) reads. Measured on a local SSD with no iCloud:
//
//   N= 50   3.4 ms/row      N=200   7.1 ms/row
//   N=100   4.0 ms/row      N=400  14.3 ms/row     ← ms/row doubles as N doubles
//
// Fitting T = kN² (k ≈ 0.0358 ms) projects ~13 s at 600, ~52 s at 1,200 and ~15 min at 5,000.
//
// The architectural correction is not "build the index once per batch" — that is correct only while
// exactly one process writes, and two users make that assumption false. The correction is that
// uniqueness stops being a SCAN and becomes an INDEX CONSTRAINT: one probe per insert, and
// race-safe, which no filesystem version could be at any cost.
//
// This test asserts the SHAPE (linear, not quadratic), not a wall-clock number, because absolute
// timings vary by machine and would make the gate flaky.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import { addMembership, asPrincipal, createOrganization, createProspect, createUser } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

let db: TestDb;
let org: OrganizationId;
let owner: UserId;

beforeEach(async () => {
  db = await freshDb();
  org = await createOrganization(db.client, "ascend", "Ascend");
  owner = await createUser(db.client, "oscar@ascend.test", "Oscar");
  await addMembership(db.client, owner, org, "owner");
});
afterEach(async () => db.close());

async function importRows(n: number): Promise<number> {
  const started = Date.now();
  await asPrincipal(db.client, __unsafePrincipalForTests("owner", org, owner), async (tx) => {
    for (let i = 0; i < n; i++) {
      await createProspect(tx, org, { name: `Co ${i}`, website: `https://co-${i}.test` }, { kind: "system" });
    }
  });
  return Date.now() - started;
}

describe("scale — the O(N²) import path is gone", () => {
  it("cost per row does NOT grow with N", async () => {
    const small = await importRows(100);
    db = await freshDb();
    org = await createOrganization(db.client, "ascend", "Ascend");
    owner = await createUser(db.client, "oscar@ascend.test", "Oscar");
    await addMembership(db.client, owner, org, "owner");
    const large = await importRows(400);

    const perRowSmall = small / 100;
    const perRowLarge = large / 400;

    // Quadratic would make per-row cost ~4x at 4x the size (the vault measured 3.4 → 14.3 ms/row).
    // Linear keeps it flat. A generous 2x ceiling absorbs machine noise while still failing loudly
    // if the scan ever comes back.
    expect(perRowLarge).toBeLessThan(perRowSmall * 2);
  });

  it("400 prospects import with 400 distinct identities and 400 events", async () => {
    await importRows(400);
    const { rows: p } = await db.client.query<{ n: string }>(
      "SELECT count(DISTINCT prospect_id)::text AS n FROM prospects"
    );
    const { rows: e } = await db.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE type = 'prospect.created'"
    );
    expect(Number(p[0].n)).toBe(400);
    expect(Number(e[0].n)).toBe(400);
  });

  it("uniqueness is enforced by a UNIQUE INDEX, not by reading every row", async () => {
    // NOT an EXPLAIN assertion. An earlier version of this test asserted the planner would avoid a
    // Seq Scan, and it failed correctly: at 50 rows a sequential scan genuinely IS cheaper, so that
    // assertion tested Postgres's cost model rather than this schema. What matters is that the
    // constraint EXISTS and is enforced by an index — the planner will use it once size makes it
    // worthwhile, and the guarantee holds at every size regardless.
    const { rows } = await db.client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'prospects'`
    );
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/CREATE UNIQUE INDEX.*\(prospect_id\)/i);
    // And the corroboration keys the matcher uses are indexed too, so identity matching at 5,000
    // rows is a probe per signal rather than a table scan per row.
    expect(defs).toMatch(/prospects_website_idx/);
    expect(defs).toMatch(/prospects_phone_idx/);
    expect(defs).toMatch(/prospects_email_idx/);
  });

  it("the unique constraint rejects a duplicate identity regardless of table size", async () => {
    await importRows(200);
    const { rows } = await db.client.query<{ prospect_id: string }>(
      "SELECT prospect_id FROM prospects LIMIT 1"
    );
    await expect(
      db.client.query(
        `INSERT INTO prospects (organization_id, prospect_id, identity_state) VALUES ($1,$2,'anchored')`,
        [org, rows[0].prospect_id]
      )
    ).rejects.toThrow(/unique|duplicate key/i);
  });

  it("a bulk import produces ZERO operator events at any size", async () => {
    await importRows(200);
    const { rows } = await db.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE actor = 'operator'"
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
