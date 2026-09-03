// Layer A — 2D · §2.1's FIVE OUTCOMES, and the evidence that survives all of them.
//
// Each case gets a DISCRIMINATING witness: a stored universe constructed so exactly one outcome is
// correct, and an assertion that fails if a different one were reached. The most important is
// `blocked`, which §2.1 calls "the single most important line in this document".

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import { asPrincipal, createOrganization, createUser, addMembership, createProspect, listProspects } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { importSheet } from "@/core/intake/import";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;

const MAP = { name: "Business", website: "Site", contact_phone: "Phone", location: "City" };
const as = <T>(fn: (tx: Parameters<typeof listProspects>[0]) => Promise<T>) =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org, owner), fn);
const run = (csv: string, label = "B") =>
  as((tx) => importSheet(tx, org, { csv, label, sourceKind: "csv_paste", sourceName: "p",
                                    columnMap: MAP, createdBy: owner }));

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
});
afterEach(async () => { await handle.close(); });

async function seed(input: Parameters<typeof createProspect>[2], held = false) {
  return as((tx) => createProspect(tx, org, held ? { ...input, hold: { reason: "stage-1 hold" } } : input,
    { kind: "system" }));
}
const rowEvents = () => as((tx) => readEvents(tx, { types: ["prospect.row_received"] }));

describe("§2.1 outcome 1 · BLOCKED — a held prospect stays visible to matching", () => {
  it("a row corroborating a HELD record creates nothing and names the blocker", async () => {
    // P4 of STAGE1-GATING. Collapsing this into `new` "creates a third Tapia record — the
    // quarantine manufacturing the duplicate it exists to prevent".
    const heldRow = await seed({ name: "Tapia Tile", website: "https://tapiatilemarbleco.com/" }, true);
    expect(heldRow.identityState, "the fixture is not actually held").toBe("held");
    expect(heldRow.prospectId, "a held record must carry NO identity").toBeNull();

    const before = (await as((tx) => listProspects(tx))).length;
    const result = await run('Business,Site\nTapia Tile & Marble,https://tapiatilemarbleco.com\n');

    expect(result.outcomes[0].kind).toBe("recorded");
    if (result.outcomes[0].kind === "recorded") {
      expect(result.outcomes[0].reason, "a held corroboration did not block").toBe("blocked");
      expect(result.outcomes[0].refs).toEqual([heldRow.id]);
    }
    expect((await as((tx) => listProspects(tx))).length,
      "the import created a record despite a held blocker").toBe(before);

    // §1.3 — the evidence survives the refusal, with prospect_id null.
    const [row] = await rowEvents();
    expect((row.data as { prospect_id: string | null }).prospect_id).toBeNull();
    expect((row.data as { cells: Record<string, string> }).cells.Business).toBe("Tapia Tile & Marble");
  });

  it("BLOCKED is checked BEFORE matched — the row corroborates BOTH, and blocked wins", async () => {
    // ─── THIS TEST WAS VACUOUS AND WAS REBUILT ────────────────────────────────────────────────
    //
    // Its first version seeded a held record the row corroborated and an anchored record it did
    // NOT, so `anchored.length` was 0 and the row reached `blocked` whichever order the resolver
    // used. MEASURED: moving the held check to LAST — the exact P4 collapse — left all 8 tests
    // green. An ordering test whose subject corroborates only one side is not testing an ordering.
    //
    // Rebuilt so the row corroborates BOTH: the held record by PHONE, the anchored one by WEBSITE.
    // Now `blocked` and `matched` are both available and only the order decides. Under the collapse
    // this returns "matched" and the quarantine is bypassed silently.
    const heldRow = await seed({ name: "Tapia Held", contactPhone: "+1 650-364-8038" }, true);
    const anchoredRow = await seed({ name: "Tapia Anchored", website: "https://tapiatilemarbleco.com" });

    const result = await run('Business,Site,Phone\nTapia Tile,https://tapiatilemarbleco.com,650 364 8038\n');
    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a refusal");
    expect(result.outcomes[0].reason,
      "matched was evaluated before blocked — P4's collapse, and a third Tapia record follows")
      .toBe("blocked");
    expect(result.outcomes[0].refs).toEqual([heldRow.id]);

    // Non-vacuity, asserted rather than assumed: the anchored record really was corroborated too,
    // so `matched` was genuinely available and lost on ORDER rather than on absence.
    const { corroborates } = await import("@/core/intake/identity");
    const stored = (await as((tx) => listProspects(tx))).find((r) => r.id === anchoredRow.id)!;
    expect(corroborates({ name: "Tapia Tile", website: "https://tapiatilemarbleco.com",
                          contactPhone: "650 364 8038" }, stored),
      "the anchored record was not corroborated — this test is vacuous again").toBe(true);
  });
});

describe("§2.1 outcomes 3–5 · matched, ambiguous, new", () => {
  it("MATCHED · exactly one anchored corroboration creates nothing", async () => {
    const existing = await seed({ name: "Acme Roofing", website: "https://acme.example" });
    const result = await run('Business,Site\nAcme Roofing Co,https://www.acme.example/\n');
    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a refusal");
    expect(result.outcomes[0].reason).toBe("matched");
    expect(result.outcomes[0].refs).toEqual([existing.id]);
    expect(await as((tx) => listProspects(tx))).toHaveLength(1);
  });

  it("AMBIGUOUS · two anchored corroborations create nothing and name both", async () => {
    const a = await seed({ name: "Shared Phone A", contactPhone: "209-555-0142" });
    const b = await seed({ name: "Shared Phone B", contactPhone: "(209) 555 0142" });
    const result = await run('Business,Phone\nSomebody,2095550142\n');
    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a refusal");
    expect(result.outcomes[0].reason).toBe("ambiguous");
    expect([...(result.outcomes[0].refs ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(await as((tx) => listProspects(tx))).toHaveLength(2);
  });

  it("NEW · corroborating nothing creates and mints an anchor — the non-vacuity control", async () => {
    // Without this every assertion above would be satisfied by an import that never creates.
    await seed({ name: "Unrelated", website: "https://unrelated.example" });
    const result = await run('Business,Site\nBrand New,https://brand-new.example\n');
    expect(result.outcomes[0].kind).toBe("projected");
    const rows = await as((tx) => listProspects(tx));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === "Brand New")?.identityState).toBe("anchored");
  });
});

describe("§2.2 · name ALONE is not corroboration", () => {
  it("a shared name with no locality creates a SEPARATE prospect", async () => {
    // "dozens of businesses share one". Treating name alone as corroboration would silently merge
    // two real businesses — the failure direction that costs the most.
    await seed({ name: "Valley Roofing" });
    const result = await run('Business\nValley Roofing\n');
    expect(result.outcomes[0].kind, "a bare name match suppressed a real business").toBe("projected");
    expect(await as((tx) => listProspects(tx))).toHaveLength(2);
  });

  it("name + LOCALITY does corroborate — the control that keeps the rule from being 'never'", async () => {
    const existing = await seed({ name: "Valley Roofing", location: "Modesto" });
    const result = await run('Business,City\nValley Roofing,Modesto\n');
    if (result.outcomes[0].kind !== "recorded") throw new Error("expected a match");
    expect(result.outcomes[0].reason).toBe("matched");
    expect(result.outcomes[0].refs).toEqual([existing.id]);
  });
});

describe("a duplicate WITHIN one sheet does not create two prospects", () => {
  it("the second row matches the first, created moments earlier in the same batch", async () => {
    const result = await run('Business,Site\nAcme,https://acme.example\nAcme Again,https://acme.example\n');
    expect(result.outcomes.map((o) => o.kind)).toEqual(["projected", "recorded"]);
    expect(await as((tx) => listProspects(tx))).toHaveLength(1);
    // BOTH rows are still evidence.
    expect(await rowEvents()).toHaveLength(2);
  });
});
