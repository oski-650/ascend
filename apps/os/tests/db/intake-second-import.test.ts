// Layer A — 2E · THE SECOND-IMPORT CONTRACT (§7.3(d), §7.3(e)).
//
// §7.3's original warning was that "the second import is where it stops being reversible", and it
// is the reason the storage decision needed sign-off at all. This file walks every case the amended
// §7.3(d) defines and asserts the resulting state against it.
//
// THE SHAPE OF EVERY ASSERTION HERE IS THE SAME, and it is deliberate: prove the NEGATIVE the
// contract forbids, not merely the positive it allows. "Unchanged ≠ silently suppressed" is a claim
// about what did NOT happen, and a test that only counts prospects would pass while the evidence
// was being discarded.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import { asPrincipal, createOrganization, createUser, addMembership, createProspect, listProspects } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { importSheet } from "@/core/intake/import";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { EventEnvelope, OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;

const MAP = { name: "Business", website: "Site", location: "City", status: "Status" };
const as = <T>(fn: (tx: Parameters<typeof listProspects>[0]) => Promise<T>) =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org, owner), fn);
const run = (csv: string, label: string) =>
  as((tx) => importSheet(tx, org, { csv, label, sourceKind: "csv_paste", sourceName: "p",
                                    columnMap: MAP, createdBy: owner }));
const evidence = () => as((tx) =>
  readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] }));
const cellsOf = (e: EventEnvelope) => (e.data as { cells: Record<string, string> }).cells;

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
});
afterEach(async () => { await handle.close(); });

describe("§7.3(d) case 1 · UNCHANGED ROW ≠ silently suppressed", () => {
  it("the identical row imported twice records TWICE, under two different batches", async () => {
    const csv = 'Business,Site\nAcme,https://acme.example\n';
    const b1 = await run(csv, "B1");
    const b2 = await run(csv, "B2");

    const rows = (await evidence()).filter((e) => e.type === "prospect.row_received");
    expect(rows.length, "the second identical row was suppressed as a duplicate").toBe(2);
    expect(rows[0].correlation_id).toBe(b1.batch.batch_id);
    expect(rows[1].correlation_id).toBe(b2.batch.batch_id);
    // §1.2 — same bytes, same hash, different batch. "A fact worth recording, not a duplicate."
    expect(b1.batch.file_sha256).toBe(b2.batch.file_sha256);
    expect(b1.batch.batch_id).not.toBe(b2.batch.batch_id);
    // The PROJECTION is unchanged — one business, not two.
    expect(await as((tx) => listProspects(tx))).toHaveLength(1);
  });
});

describe("§7.3(d) case 2 · CHANGED ROW ≠ overwrite of historical evidence", () => {
  it("both versions remain readable, in order", async () => {
    await run('Business,Site,City\nAcme,https://acme.example,Modesto\n', "B1");
    const before = JSON.stringify(await evidence());
    await run('Business,Site,City\nAcme,https://acme.example,Turlock\n', "B2");

    const after = await evidence();
    expect(JSON.stringify(after.slice(0, 2)), "batch 1's evidence was rewritten").toBe(before);
    const cities = after.filter((e) => e.type === "prospect.row_received").map((e) => cellsOf(e).City);
    expect(cities, "the two batches' claims are not both recoverable").toEqual(["Modesto", "Turlock"]);
  });
});

describe("§7.3(d) case 3 · NEW PROSPECT", () => {
  it("an unrelated row in batch 2 is created, and batch 1 is untouched", async () => {
    await run('Business,Site\nAcme,https://acme.example\n', "B1");
    await run('Business,Site\nBeta,https://beta.example\n', "B2");
    const names = (await as((tx) => listProspects(tx))).map((p) => p.name).sort();
    expect(names).toEqual(["Acme", "Beta"]);
  });
});

describe("§7.3(d) case 4 · ABSENT ≠ DELETED — the §7.3(e) principle", () => {
  it("a row missing from batch 2 leaves the prospect and batch 1's evidence intact", async () => {
    // "Absence from a later Sheet is not evidence of absence from the business or prospect
    // universe." A row the operator filtered out of a re-export must not remove a business.
    await run('Business,Site\nAcme,https://acme.example\nBeta,https://beta.example\n', "B1");
    expect(await as((tx) => listProspects(tx))).toHaveLength(2);

    await run('Business,Site\nAcme,https://acme.example\n', "B2");

    const rows = await as((tx) => listProspects(tx));
    expect(rows.length, "a prospect was deleted because a later sheet omitted it").toBe(2);
    expect(rows.map((p) => p.name).sort()).toEqual(["Acme", "Beta"]);
    // Nothing marked, either — no status change, no flag.
    expect(rows.find((p) => p.name === "Beta")?.status,
      "the absent row's prospect was marked rather than left alone").toBeNull();
    // Batch 1 still records that Beta arrived; absence is INFERABLE, never asserted.
    const b1Rows = (await evidence()).filter((e) => e.type === "prospect.row_received").slice(0, 2);
    expect(b1Rows.map((e) => cellsOf(e).Business)).toEqual(["Acme", "Beta"]);
  });
});

describe("§7.3(d) case 5 · DUPLICATE ≠ discarded evidence", () => {
  it("the duplicate row is refused projection and still recorded verbatim", async () => {
    await run('Business,Site\nAcme,https://acme.example\n', "B1");
    const result = await run('Business,Site\nAcme Duplicate,https://www.acme.example/\n', "B2");

    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a refusal");
    expect(result.outcomes[0].reason).toBe("matched");
    expect(await as((tx) => listProspects(tx)), "the duplicate created a second record").toHaveLength(1);

    const rows = (await evidence()).filter((e) => e.type === "prospect.row_received");
    expect(rows, "the refused row's evidence was discarded").toHaveLength(2);
    expect(cellsOf(rows[1]).Business, "the refused row was not stored verbatim").toBe("Acme Duplicate");
    expect((rows[1].data as { prospect_id: string | null }).prospect_id).toBeNull();
  });
});

describe("§7.3(d) case 6 · CONFLICT ≠ normalised away", () => {
  it("an ambiguous row creates nothing, names both candidates, and keeps its evidence", async () => {
    await run('Business,City\nValley Roofing,Modesto\n', "B1");
    // A second, genuinely distinct business sharing the site — constructed so batch 3's row
    // corroborates BOTH by website.
    const other = await as((tx) => createProspect(tx, org,
      { name: "Other Roofing", website: "https://valley.example" }, { kind: "system" }));
    const first = (await as((tx) => listProspects(tx))).find((p) => p.name === "Valley Roofing")!;
    await as((tx) => tx.query(`UPDATE prospects SET website = 'https://valley.example' WHERE id = $1`,
      [first.id]));

    const result = await run('Business,Site\nSomebody,https://valley.example\n', "B3");
    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a refusal");
    expect(result.outcomes[0].reason, "a conflict was resolved rather than surfaced").toBe("ambiguous");
    expect([...(result.outcomes[0].refs ?? [])].sort()).toEqual([first.id, other.id].sort());
    expect(await as((tx) => listProspects(tx))).toHaveLength(2);
    // The conflicting row is still evidence.
    const rows = (await evidence()).filter((e) => e.type === "prospect.row_received");
    expect(cellsOf(rows[rows.length - 1]).Business).toBe("Somebody");
  });
});

describe("§7.3(d) case 7 · EXISTING HUMAN JUDGMENT ≠ overwritten", () => {
  it("a re-import over an assessed prospect leaves the judgment and its provenance intact", async () => {
    await run('Business,Site,Status\nAcme,https://acme.example,lead\n', "B1");
    const [p] = await as((tx) => listProspects(tx));

    // A HUMAN JUDGED — written through the only path that can, with its provenance.
    await as((tx) => tx.query(
      `UPDATE prospects SET website_opportunity = 'green', assessed_by = $2, assessed_at = now()
        WHERE id = $1`, [p.id, owner]));

    await run('Business,Site,Status\nAcme,https://acme.example,contacted\n', "B2");

    const { rows } = await db.query<{ website_opportunity: string | null; assessed_by: string | null }>(
      `SELECT website_opportunity, assessed_by FROM prospects WHERE id = $1`, [p.id]);
    expect(rows[0].website_opportunity, "the import overwrote a human judgment").toBe("green");
    expect(rows[0].assessed_by, "the import erased the judgment's author").toBe(owner);

    // Non-vacuity: the second batch DID record what it said, so this is not passing because the
    // import silently did nothing at all.
    const cells = (await evidence()).filter((e) => e.type === "prospect.row_received");
    expect(cells.map((e) => cellsOf(e).Status)).toEqual(["lead", "contacted"]);
  });
});
