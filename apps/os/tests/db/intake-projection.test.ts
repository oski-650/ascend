// Layer A — 2C · THE PROJECTION, THROUGH THE EXISTING WRITER (§7.3(c)).
//
// The property: Sheet rows become prospects via `core/db.createProspect` and nothing else. No second
// prospect representation, no markdown, no judgment — asserted against a real Postgres because the
// claims are the schema's.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import { freshDb, type TestDb } from "./pglite";
import { asPrincipal, createOrganization, createUser, addMembership, listProspects } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { importSheet } from "@/core/intake/import";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;

const MAP = { name: "Business", website: "Site", location: "City", status: "Status" };
const run = (csv: string, label = "B1") =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org, owner), (tx) =>
    importSheet(tx, org, { csv, label, sourceKind: "csv_paste", sourceName: "paste",
                           columnMap: MAP, createdBy: owner }));
const read = <T>(fn: (tx: Parameters<typeof listProspects>[0]) => Promise<T>) =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org, owner), fn);

/**
 * The intake suites read the EVENT SPINE to verify their own evidence, and the spine now resolves
 * its caller and fails closed. Declaring one is the boundary working — a test is a caller like any
 * other. `owner` so the suite sees the whole corpus it wrote; a narrower principal would filter out
 * its own fixtures and go red for a reason unrelated to what it measures.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
});
afterEach(async () => { await handle.close(); });

describe("a legitimate row is projected through the EXISTING writer", () => {
  it("creates a prospect row and returns its id", async () => {
    const result = await run('Business,City\nAcme Roofing,Modesto\n');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].kind).toBe("projected");

    const rows = await read((tx) => listProspects(tx));
    expect(rows, "no prospect reached the store").toHaveLength(1);
    expect(rows[0].name).toBe("Acme Roofing");
    expect(rows[0].location).toBe("Modesto");
    // Created through the canonical writer, so it carries an identity and its birth event.
    expect(rows[0].prospectId, "the writer did not mint an identity").not.toBeNull();
    expect(rows[0].identityState).toBe("anchored");
  });

  it("the writer's own birth event fired — this is not a bespoke insert", async () => {
    // The discriminating witness that `createProspect` was used rather than a hand-rolled INSERT:
    // only the canonical writer emits prospect.created, atomically with the row.
    await run('Business\nAcme\n');
    const created = await read((tx) => readEvents(tx, { types: ["prospect.created"] }));
    expect(created, "prospect.created is missing — the projection bypassed the writer").toHaveLength(1);
    expect(created[0].actor, "the import claimed an operator authored the birth").toBe("system");
  });

  it("a row that names nothing is RECORDED but not projected", async () => {
    const result = await run('Business,City\n,Modesto\nAcme,Modesto\n');
    expect(result.outcomes.map((o) => o.kind)).toEqual(["recorded", "projected"]);
    expect(await read((tx) => listProspects(tx))).toHaveLength(1);
    // §1.3 — the row is still evidence.
    const rows = await read((tx) => readEvents(tx, { types: ["prospect.row_received"] }));
    expect(rows, "the unprojected row lost its evidence").toHaveLength(2);
    expect((rows[0].data as { prospect_id: string | null }).prospect_id).toBeNull();
  });
});

describe("projection and evidence stay separate", () => {
  it("re-import adds evidence and does not destroy the first batch's", async () => {
    await run('Business,City\nAcme,Modesto\n', "B1");
    const before = JSON.stringify(await read((tx) =>
      readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] })));

    await run('Business,City\nAcme,Turlock\n', "B2");
    const after = await read((tx) =>
      readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] }));

    expect(after.length, "the second import recorded nothing").toBe(4);
    expect(JSON.stringify(after.slice(0, 2)), "the first batch's evidence changed").toBe(before);
    // Both cities are recoverable from evidence, whatever the projection now holds.
    const cities = after.filter((e) => e.type === "prospect.row_received")
      .map((e) => (e.data as { cells: Record<string, string> }).cells.City);
    expect(cities).toEqual(["Modesto", "Turlock"]);
  });

  it("evidence rows carry the prospect_id the projection produced", async () => {
    const result = await run('Business\nAcme\n');
    const projected = result.outcomes[0];
    if (projected.kind !== "projected") throw new Error("expected a projection");
    const [row] = await read((tx) => readEvents(tx, { types: ["prospect.row_received"] }));
    expect((row.data as { prospect_id: string | null }).prospect_id).toBe(projected.prospectId);
  });
});

describe("A HUMAN JUDGED is untouched by any import", () => {
  it("no judgment field is set on a projected prospect", async () => {
    await run('Business,Site,Status\nAcme,https://acme.example,lead\n');
    const [p] = await read((tx) => listProspects(tx));
    expect(p.websiteOpportunity, "the import wrote a judgment").toBeNull();
    const { rows } = await db.query<{ assessed_by: string | null; assessed_at: string | null }>(
      `SELECT assessed_by, assessed_at FROM prospects`);
    expect(rows[0].assessed_by, "the import attributed a judgment to somebody").toBeNull();
    expect(rows[0].assessed_at).toBeNull();
    // Non-vacuity: the import DID write the things it may.
    expect(p.status).toBe("lead");
    expect(p.website).toBe("https://acme.example");
  });
});
