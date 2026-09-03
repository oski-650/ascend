// Layer A — STAGE 2B ACCEPTANCE GATES.
//
// The claim under test is not "six rows were copied". It is that the shared substrate can take
// ownership of the prospect universe WITHOUT CHANGING WHAT THE OS MEANS — and the decisive evidence
// is a behavioural ledger computed identically from both stores.
//
// A FIXTURE VAULT, NOT THE LIVE ONE. `ASCEND_VAULT_PATH` is redirected to a temp directory seeded to
// the live vault's exact shape: four anchored prospects, two held Tapia records sharing a website,
// and a spine whose only prospect events are reconciler baselines. That last detail is the point of
// gate 7 and is reproduced faithfully, because it is the condition under which "unknown origin"
// could be silently converted into "created at migration time".

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDb, type TestDb } from "./pglite";
import {
  addMembership, asPrincipal, createOrganization, createUser, listProspects as listDbProspects,
  readEvents as readDbEvents,
} from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import {
  applySubstrateMigration, MigrationRefused, planSubstrateMigration, renderManifest,
  validateManifest, verifySubstrateMigration, vaultLedger, dbLedger,
} from "@/substrate-migration";
import type { OrganizationId, UserId } from "@/domain";

const HIT_LIST = "02 - Sales & Hit List";
let vaultDir: string;
let savedVault: string | undefined;
let db: TestDb;
let org: OrganizationId;
let oscar: UserId;

const ANCHORS = {
  bay: "01a0429d-d996-76fc-9f19-a398696472df",
  central: "01a0429d-d996-7455-a203-410f2985237a",
  modesto: "01a0429d-d996-7ada-aa49-518599c77f6c",
  valley: "01a0429d-d996-7a63-aa77-8c0f3594ea46",
};

const prospectFile = (fm: Record<string, string>) =>
  `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n## Call Log\n- 2026-06-10 — Intro call.\n\n## Friction / Notes\n- notes\n`;

async function seedVault(): Promise<void> {
  const dir = path.join(vaultDir, HIT_LIST);
  await fs.mkdir(dir, { recursive: true });
  const base = (over: Record<string, string>) => ({
    name: "X", business_type: "", location: "", status: "lead", website: '""',
    website_quality: "acceptable", decision_maker_access: "false", project_urgency: "low",
    niche_alignment: "false", contact_name: '""', contact_phone: '""', contact_email: '""',
    source: '""', first_contact: '""', last_contact: '""', ...over,
  });

  await fs.writeFile(path.join(dir, "bay-area-custom-shirts-inc.md"), prospectFile(base({
    prospect_id: ANCHORS.bay, name: "Bay Area Custom Shirts Inc.", status: "closed-won",
    website: "https://www.bayareacustomshirts.com/", contact_phone: '"(650) 261-0722"',
    niche_alignment: "true",
  })));
  await fs.writeFile(path.join(dir, "central-coast-cleaning.md"), prospectFile(base({
    prospect_id: ANCHORS.central, name: "Central Coast Cleaning",
    website: "https://example-cccleaning.com", contact_phone: '"(805) 555-0119"', niche_alignment: "true",
  })));
  await fs.writeFile(path.join(dir, "modesto-hvac-co.md"), prospectFile(base({
    prospect_id: ANCHORS.modesto, name: "Modesto HVAC Co", status: "contacted",
    website: "https://example-modestohvac.com", website_quality: "outdated",
    decision_maker_access: "true", project_urgency: "medium", niche_alignment: "true",
    contact_email: "linda@modestohvac.example", first_contact: '"2026-06-10"',
  })));
  await fs.writeFile(path.join(dir, "valley-roofing-pros.md"), prospectFile(base({
    prospect_id: ANCHORS.valley, name: "Valley Roofing Pros", website_quality: "none",
    decision_maker_access: "true", project_urgency: "high", niche_alignment: "true",
  })));
  // The held pair — no prospect_id, sharing every corroborating signal.
  for (const [slug, name] of [
    ["tapia-tile-amp-marble-co", '"Tapia Tile &amp; Marble Co."'],
    ["tile-amp-marble-installation-in-bay-area", '"Tile &amp; Marble Installation in Bay Area"'],
  ]) {
    await fs.writeFile(path.join(dir, `${slug}.md`), prospectFile(base({
      name, website: '"https://tapiatilemarbleco.com/"', contact_phone: '"+16503648038"',
      contact_email: "tapiatileandmarble@gmail.com",
    })));
  }

  // The spine: reconciler baselines only for prospects, plus operator/system events about other
  // entities. NO prospect.created anywhere — the live vault's actual shape.
  const side = path.join(vaultDir, ".ascend-os");
  await fs.mkdir(side, { recursive: true });
  const ev = (o: Record<string, unknown>) => JSON.stringify({ organization_id: "ascend", ...o });
  const slugs = ["bay-area-custom-shirts-inc", "central-coast-cleaning", "modesto-hvac-co",
    "tapia-tile-amp-marble-co", "tile-amp-marble-installation-in-bay-area", "valley-roofing-pros"];
  await fs.writeFile(path.join(side, "intelligence.events.jsonl"),
    slugs.map((s, i) => ev({
      event_id: `00000000-0000-7000-8000-0000000000${String(i + 10)}`,
      type: "observation.captured", occurred_at: `2026-08-17T09:59:0${i}.000Z`,
      actor: "system", subject: { entity: "prospect", entity_id: s },
      data: { baseline: true },
    })).join("\n") + "\n");
  await fs.writeFile(path.join(side, "crm.events.jsonl"),
    [ev({ event_id: "00000000-0000-7000-8000-000000000020", type: "client.created",
          occurred_at: "2026-06-22T10:27:22.280Z", actor: "operator",
          subject: { entity: "client", entity_id: "bay-area-custom-shirts-inc" } })].join("\n") + "\n");
  await fs.writeFile(path.join(side, "production.events.jsonl"),
    [ev({ event_id: "00000000-0000-7000-8000-000000000021", type: "project.checklist_toggled",
          occurred_at: "2026-06-22T11:00:00.000Z", actor: "operator",
          subject: { entity: "project", entity_id: "bay-area-custom-shirts-inc" } })].join("\n") + "\n");
}

/**
 * `planSubstrateMigration` reads the EVENT SPINE, which since the per-domain visibility model
 * resolves its caller and fails closed. This suite therefore declares one — the boundary working,
 * not an obstacle: administrative tooling runs under an operator in production too.
 *
 * Bound at file scope rather than inside the plan call, because the migration reads the spine from
 * several entry points and a per-call wrapper would be four places to forget.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-2b-"));
  process.env.ASCEND_VAULT_PATH = vaultDir;
  await seedVault();
  db = await freshDb();
  org = await createOrganization(db.client, "ascend", "Ascend");
  oscar = await createUser(db.client, "oscar@ascend.test", "Oscar");
  await addMembership(db.client, oscar, org, "owner");
});

afterEach(async () => {
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  await fs.rm(vaultDir, { recursive: true, force: true });
  await db.close();
});

const run = <T>(fn: Parameters<typeof asPrincipal<T>>[2]) =>
  asPrincipal(db.client, __unsafePrincipalForTests("owner", org, oscar), fn);

async function migrate() {
  const manifest = await planSubstrateMigration(oscar);
  const report = await run((tx) => applySubstrateMigration(tx, org, manifest, { confirm: true }));
  return { manifest, report };
}

// ═══ The twelve checks ═════════════════════════════════════════════════════════════════════════

describe("Stage 2B · the twelve verification checks", () => {
  it("all twelve pass on a correctly applied migration", async () => {
    const { manifest } = await migrate();
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, {
      operatorUserId: oscar, vaultShaBefore: "fixture",
    }));
    const failed = v.checks.filter((c) => !c.ok);
    expect(failed.map((c) => `${c.n}. ${c.name}: ${c.detail}`)).toEqual([]);
    expect(v.checks).toHaveLength(12);
    expect(v.ok).toBe(true);
  });

  it("1 · six prospects, exactly once", async () => {
    await migrate();
    expect(await run(listDbProspects)).toHaveLength(6);
  });

  it("2 · the four anchors are preserved EXACTLY, never re-minted", async () => {
    await migrate();
    const ids = (await run(listDbProspects)).map((p) => p.prospectId).filter(Boolean).sort();
    expect(ids).toEqual(Object.values(ANCHORS).sort());
  });

  it("3 · both Tapia records remain held, unidentified, and MATCHABLE", async () => {
    await migrate();
    const rows = await run(listDbProspects);
    const held = rows.filter((p) => p.identityState === "held");
    expect(held).toHaveLength(2);
    expect(held.every((h) => h.prospectId === null)).toBe(true);
    expect(held.every((h) => h.holdReason && h.holdReason.length > 0)).toBe(true);
    // The write barrier is not an information barrier: they still corroborate.
    expect(held.every((h) => h.website === "https://tapiatilemarbleco.com/")).toBe(true);
  });

  it("4 · all 8 historical events, exactly once", async () => {
    const { manifest } = await migrate();
    const events = await run(readDbEvents);
    expect(events).toHaveLength(manifest.summary.events);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(events.length);
  });

  it("5 · historical operator events are explicitly attributed to Oscar", async () => {
    await migrate();
    const events = await run(readDbEvents);
    const operator = events.filter((e) => e.actor === "operator");
    expect(operator.length).toBeGreaterThan(0);
    expect(operator.every((e) => e.actor_user_id === oscar)).toBe(true);
  });

  it("6 · the migration authored no event of its own", async () => {
    const { manifest, report } = await migrate();
    expect(report.eventsAuthoredByMigration).toBe(0);
    const known = new Set(manifest.events.map((e) => e.eventId));
    expect((await run(readDbEvents)).filter((e) => !known.has(e.event_id))).toEqual([]);
  });

  it("7 · THE HISTORICAL BOUNDARY: unknown origin stays unknown", async () => {
    const { manifest } = await migrate();
    // No prospect.created exists in the vault, and none is created by the move.
    expect(manifest.summary.birthEventsForProspects).toBe(0);
    expect((await run(readDbEvents)).filter((e) => e.type === "prospect.created")).toEqual([]);

    const ledger = await run(dbLedger);
    expect(ledger.origins).toHaveLength(6);
    expect(ledger.origins.every((o) => o.birthWitnessed === false)).toBe(true);
  });

  it("7b · created_at is audit metadata and is documented as such IN the database", async () => {
    // The subtle failure this guards: a reader querying created_at and concluding the prospect was
    // created on the migration date. The column comment is queryable, so the warning travels with
    // the data rather than living only in a repository nobody reading SQL will open.
    const { rows } = await db.client.query<{ d: string }>(
      `SELECT col_description('prospects'::regclass, ordinal_position) AS d
         FROM information_schema.columns
        WHERE table_name='prospects' AND column_name='created_at'`
    );
    expect(rows[0].d).toMatch(/NOT A BUSINESS FACT/);
    expect(rows[0].d).toMatch(/origin is UNKNOWN/);
  });

  it("8 · no prospect field changed during serialization", async () => {
    const before = await vaultLedger();
    await migrate();
    const after = await run(dbLedger);
    for (const v of before.prospects) {
      const d = after.prospects.find((p) => p.key === v.key)!;
      expect(d.fields, v.key).toEqual(v.fields);
      expect(d.score, `${v.key} score`).toBe(v.score);
    }
  });

  it("9 · the database refuses what Stages 0.5 and 1 prohibited", async () => {
    await migrate();
    await expect(db.client.query(
      `INSERT INTO prospects (organization_id, identity_state) VALUES ($1,'anchored')`, [org]
    )).rejects.toThrow(/anchored_iff_identified/);
    await expect(db.client.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state)
       VALUES ($1,$2,'anchored')`, [org, ANCHORS.bay]
    )).rejects.toThrow(/unique|duplicate key/i);
    await expect(db.client.query(`UPDATE events SET type='x'`)).rejects.toThrow(/append-only/);
  });

  it("10 · the migration is deterministic and idempotent", async () => {
    const a = renderManifest(await planSubstrateMigration(oscar));
    const b = renderManifest(await planSubstrateMigration(oscar));
    expect(a).toBe(b); // mints nothing, so byte-identical

    const { manifest } = await migrate();
    const second = await run((tx) => applySubstrateMigration(tx, org, manifest, { confirm: true }));
    expect(second.prospectsInserted).toBe(0);
    expect(second.eventsInserted).toBe(0);
    expect(await run(listDbProspects)).toHaveLength(6);
  });

  it("11 · the vault is never written to", async () => {
    const dir = path.join(vaultDir, HIT_LIST);
    const before = await Promise.all((await fs.readdir(dir)).sort().map((f) => fs.readFile(path.join(dir, f), "utf8")));
    await migrate();
    const after = await Promise.all((await fs.readdir(dir)).sort().map((f) => fs.readFile(path.join(dir, f), "utf8")));
    expect(after).toEqual(before);
  });

  it("12 · THE DECISIVE CHECK: both stores produce the same behavioural ledger", async () => {
    const before = await vaultLedger();
    await migrate();
    const after = await run(dbLedger);
    expect(after).toEqual(before);
  });

  it("dry run is the default — apply without confirm writes nothing", async () => {
    const manifest = await planSubstrateMigration(oscar);
    await expect(
      run((tx) => applySubstrateMigration(tx, org, manifest, { confirm: false }))
    ).rejects.toThrow(MigrationRefused);
    expect(await run(listDbProspects)).toHaveLength(0);
  });
});

// ═══ Mutation gates ════════════════════════════════════════════════════════════════════════════

describe("Stage 2B · mutation gates — verification must FAIL on tampering", () => {
  it("MUTATION: removing a Tapia hold is caught", async () => {
    const { manifest } = await migrate();
    // Release one hold behind the migration's back, as owner (the only role that can).
    await run((tx) => tx.query(
      `UPDATE prospects SET identity_state='anchored', hold_reason=NULL, prospect_id=$1
        WHERE identity_state='held' AND slug='tapia-tile-amp-marble-co'`,
      ["01a0429d-0000-7000-8000-00000000dead"]
    ));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.n === 3)!.ok).toBe(false);   // no longer held
    expect(v.checks.find((c) => c.n === 12)!.ok).toBe(false);  // and the ledgers diverge
  });

  it("MUTATION: changing a prospect identity is caught", async () => {
    const { manifest } = await migrate();
    await run((tx) => tx.query(
      `UPDATE prospects SET prospect_id=$1 WHERE prospect_id=$2`,
      ["01a0429d-0000-7000-8000-00000000beef", ANCHORS.modesto]
    ));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.n === 2)!.ok).toBe(false);
    expect(v.checks.find((c) => c.n === 12)!.ok).toBe(false);
  });

  it("MUTATION: duplicating an event is caught", async () => {
    const { manifest } = await migrate();
    await run((tx) => tx.query(
      `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, subject_entity, subject_entity_id)
       VALUES (gen_random_uuid(), $1, 'observation.captured', now(), 'system', 'prospect', 'modesto-hvac-co')`,
      [org]
    ));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.n === 4)!.ok).toBe(false);  // count differs
    expect(v.checks.find((c) => c.n === 6)!.ok).toBe(false);  // and it is a foreign event
  });

  it("MUTATION: a fabricated prospect birth is caught by the boundary check", async () => {
    // The specific failure gate 7 exists for: converting "never witnessed" into "created".
    const { manifest } = await migrate();
    await run((tx) => tx.query(
      `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, subject_entity, subject_entity_id)
       VALUES (gen_random_uuid(), $1, 'prospect.created', now(), 'system', 'prospect', 'modesto-hvac-co')`,
      [org]
    ));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.n === 7)!.ok).toBe(false);
  });

  it("MUTATION: a dropped scoring field is caught even though every row still exists", async () => {
    // The quiet one. Six rows, six identities, right counts — and a changed score, because a boolean
    // was lost in serialisation. Only the behavioural ledger sees this.
    const { manifest } = await migrate();
    await run((tx) => tx.query(`UPDATE prospects SET decision_maker_access = NULL WHERE slug='modesto-hvac-co'`));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.checks.find((c) => c.n === 1)!.ok).toBe(true);   // counts still fine
    expect(v.checks.find((c) => c.n === 2)!.ok).toBe(true);   // identities still fine
    expect(v.checks.find((c) => c.n === 8)!.ok).toBe(false);  // the field diff
    expect(v.checks.find((c) => c.n === 12)!.ok).toBe(false); // and the score changed
    expect(v.ok).toBe(false);
  });

  it("MUTATION: a dropped BODY is caught — the gap that slipped through 2B", async () => {
    // THE REGRESSION CONTROL FOR MY OWN MISS. Stage 2B's ledger compared frontmatter and scores,
    // reported parity, and was wrong: the markdown body was never carried and never compared, while
    // two modules read it (the prospect page and compileTargetContext). Six rows, six identities,
    // right counts, right scores — and every call log silently deleted.
    const { manifest } = await migrate();
    await run((tx) => tx.query(`UPDATE prospects SET notes = NULL WHERE slug='modesto-hvac-co'`));
    const v = await run((tx) => verifySubstrateMigration(tx, manifest, { operatorUserId: oscar, vaultShaBefore: "x" }));
    expect(v.checks.find((c) => c.n === 1)!.ok).toBe(true);   // counts fine
    expect(v.checks.find((c) => c.n === 2)!.ok).toBe(true);   // identities fine
    expect(v.checks.find((c) => c.n === 8)!.ok).toBe(false);  // the body diff
    expect(v.checks.find((c) => c.n === 12)!.ok).toBe(false); // ledgers diverge
    expect(v.ok).toBe(false);
  });

  it("the body actually arrives — call log and friction notes both survive", async () => {
    await migrate();
    const rows = await run(listDbProspects);
    expect(rows.every((r) => (r.notes ?? "").includes("## Call Log"))).toBe(true);
    expect(rows.every((r) => (r.notes ?? "").includes("## Friction / Notes"))).toBe(true);
  });

  it("the validator refuses a manifest proposing a prospect birth", async () => {
    const manifest = await planSubstrateMigration(oscar);
    const tampered = {
      ...manifest,
      summary: { ...manifest.summary, birthEventsForProspects: 1 },
    };
    expect(validateManifest(tampered).map((i) => i.problem)).toContain(
      "proposes a prospect birth event; origin is unknown and must stay unknown"
    );
  });
});
