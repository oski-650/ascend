// Layer A — STAGE 1 ACCEPTANCE GATES (docs/STAGE1-PROSPECT-IDENTITY.md).
//
// The backfill writes ONE LINE per file. These gates exist because that is exactly the kind of
// change nobody reviews properly: too small to seem risky, and applied to every record at once.
//
// THE PROPERTY UNDER TEST, stated once:
//
//   > Writing `prospect_id` establishes "this file represents this stable identity".
//   > It must establish nothing else — no date, no contact, no website, no judgement, no history.
//
// Every gate below is a way of failing that property. Gate I (business fields) and gate G/J (events)
// are the direct assertions; the rest close the routes by which it could be violated indirectly.
//
// NOTHING HERE TOUCHES THE LIVE VAULT. `ASCEND_VAULT_PATH` is redirected to a temp fixture in
// beforeEach and restored in afterEach, the same seam every other Layer A suite uses.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyIdentityBackfill,
  IdentityBackfillRefused,
  planIdentityBackfill,
  renderIdentityManifest,
  snapshotHitList,
  validateIdentityManifest,
  verifyIdentityBackfill,
  withoutIdentityLine,
  DECLARED_HOLDS,
} from "@/identity-backfill";
import { listProspects } from "@/core/crm";
import { readEvents } from "@/core/events";
import { reconcileVault } from "@/core/reconciler";
import { buildStructuralContext } from "@/relationships";
import { routeForEntity } from "@/navigation/routing";
import { graphNodeIdFor } from "@/graph-view/contract";
import type { ProspectId } from "@/domain";

const HIT_LIST = "02 - Sales & Hit List";

let vaultDir: string;
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-identity-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, HIT_LIST), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "01 - CRM & Clients"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "04 - Documents"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

const file = (slug: string) => path.join(vaultDir, HIT_LIST, `${slug}.md`);
const write = (slug: string, body: string) => fs.writeFile(file(slug), body, "utf8");
const read = (slug: string) => fs.readFile(file(slug), "utf8");

/** A deterministic id factory, so a manifest is byte-comparable across runs. */
function counterMint(): () => ProspectId {
  let n = 0;
  return () => `01900000-0000-7000-8000-${String(++n).padStart(12, "0")}` as ProspectId;
}

/** A realistic prospect: business facts a backfill must never touch. */
const prospect = (over: Record<string, string> = {}) => {
  const fm = {
    name: "Valley Roofing Pros",
    status: "lead",
    website: "https://valleyroofing.test",
    website_quality: "outdated",
    decision_maker_access: "true",
    project_urgency: "high",
    niche_alignment: "true",
    contact_name: "Dana Reyes",
    contact_phone: "(209) 555-0143",
    contact_email: "dana@valleyroofing.test",
    source: "Referral",
    first_contact: '"2026-06-10"',
    last_contact: '"2026-06-14"',
    ...over,
  };
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n## Call Log\n- 2026-06-10 — Intro call.\n\n## Friction / Notes\n- Peak season objection.\n`;
};

/**
 * A promoted client, so the ONE relationship that crosses the sales boundary actually exists.
 *
 * Without this the structural context is empty and gate H compares `[]` to `[]` — a vacuous pass.
 * `promoted_to` is the only edge in `relationships/derive` whose SOURCE is a prospect, and it is
 * addressed by SLUG (`structural_meta.promoted_from_prospect`), which is precisely the addressing
 * the backfill must leave alone. The live vault has exactly this shape:
 * `bay-area-custom-shirts-inc` carries `promoted_from_prospect: "bay-area-custom-shirts-inc"`.
 */
async function seedPromotedClient(slug: string, fromProspect: string): Promise<void> {
  const dir = path.join(vaultDir, "01 - CRM & Clients", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "business_context.md"), `---\nname: ${slug}\n---\n\n## Overview\n`, "utf8");
  await fs.writeFile(
    path.join(dir, "structural_meta.json"),
    JSON.stringify({ client_id: slug, organization_id: "ascend", status: "active", promoted_from_prospect: fromProspect }, null, 2),
    "utf8"
  );
}

/** The default fixture: three clean prospects plus the known duplicate pair. */
async function seedFixture(): Promise<void> {
  await write("alpha-roofing", prospect({ name: "Alpha Roofing", website: "https://alpha.test", contact_phone: '"209-555-0001"', contact_email: "a@alpha.test" }));
  await write("beta-hvac", prospect({ name: "Beta HVAC", website: "https://beta.test", contact_phone: '"209-555-0002"', contact_email: "b@beta.test" }));
  await write("gamma-cleaning", prospect({ name: "Gamma Cleaning", website: '""', contact_phone: '"209-555-0003"', contact_email: "g@gamma.test" }));
  // The Tapia shape, reproduced: two files, one website.
  await write("tapia-tile-amp-marble-co", prospect({ name: '"Tapia Tile &amp; Marble Co."', website: '"https://tapiatilemarbleco.com/"', contact_phone: '""', contact_email: '""' }));
  await write("tile-amp-marble-installation-in-bay-area", prospect({ name: '"Tile &amp; Marble Installation in Bay Area"', website: '"https://tapiatilemarbleco.com/"', contact_phone: '""', contact_email: '""' }));
}

// ═══ A ═════════════════════════════════════════════════════════════════════════════════════════

describe("A · every prospect receives a stable UUIDv7, but only when it is safe to name one", () => {
  it("assigns to unambiguous prospects and holds the duplicate pair", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });

    expect(m.summary).toEqual({ total: 5, assign: 3, held: 2, alreadyAnchored: 0 });
    expect(m.entries.filter((e) => e.decision === "assign").map((e) => e.slug)).toEqual([
      "alpha-roofing",
      "beta-hvac",
      "gamma-cleaning",
    ]);
    expect(m.entries.filter((e) => e.decision === "held").map((e) => e.slug)).toEqual([
      "tapia-tile-amp-marble-co",
      "tile-amp-marble-installation-in-bay-area",
    ]);
  });

  it("mints real UUIDv7s in production (version 7, variant 8-b)", async () => {
    await seedFixture();
    const m = await planIdentityBackfill(); // no injected factory
    for (const e of m.entries.filter((x) => x.decision === "assign")) {
      expect(e.proposedProspectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("a held prospect proposes NO id — silence, not a placeholder", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    for (const e of m.entries.filter((x) => x.decision === "held")) {
      expect(e.proposedProspectId).toBeNull();
      expect(e.holdReason).toBeTruthy();
    }
  });

  it("the manifest surfaces the identity fields a reviewer needs", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    const alpha = m.entries.find((e) => e.slug === "alpha-roofing")!;
    expect(alpha.identityFields).toEqual({
      name: "Alpha Roofing",
      website: "https://alpha.test",
      contact_phone: "209-555-0001",
      contact_email: "a@alpha.test",
    });
  });

  it("discovery is mechanical — templates, READMEs and dotfiles are not prospects", async () => {
    await seedFixture();
    await write("_template", prospect({ name: "New Prospect LLC" }));
    await fs.writeFile(path.join(vaultDir, HIT_LIST, "README.md"), "# Hit list\n", "utf8");
    const m = await planIdentityBackfill({ mintId: counterMint() });
    expect(m.entries.map((e) => e.slug)).not.toContain("_template");
    expect(m.entries.map((e) => e.slug)).not.toContain("README");
    expect(m.summary.total).toBe(5);
  });
});

// ═══ B ═════════════════════════════════════════════════════════════════════════════════════════

describe("B · re-planning is deterministic", () => {
  it("is byte-identical across runs with a pinned id factory", async () => {
    await seedFixture();
    const a = renderIdentityManifest(await planIdentityBackfill({ mintId: counterMint() }));
    const b = renderIdentityManifest(await planIdentityBackfill({ mintId: counterMint() }));
    expect(a).toBe(b);
  });

  it("the DECISIONS are identical even when the ids are freshly minted", async () => {
    await seedFixture();
    const strip = (m: Awaited<ReturnType<typeof planIdentityBackfill>>) =>
      m.entries.map((e) => `${e.slug}|${e.decision}|${e.holdReason ?? ""}|${e.duplicateOf.join("+")}`);
    expect(strip(await planIdentityBackfill())).toEqual(strip(await planIdentityBackfill()));
  });

  it("ordering does not depend on filesystem enumeration order", async () => {
    // Written in reverse; the plan must still come back sorted by slug.
    await write("zeta-co", prospect({ name: "Zeta", website: "https://zeta.test", contact_phone: '"209-555-9001"', contact_email: "z@zeta.test" }));
    await write("alpha-co", prospect({ name: "Alpha", website: "https://alphaco.test", contact_phone: '"209-555-9002"', contact_email: "a@alphaco.test" }));
    const m = await planIdentityBackfill({ mintId: counterMint() });
    expect(m.entries.map((e) => e.slug)).toEqual(["alpha-co", "zeta-co"]);
  });
});

// ═══ C ═════════════════════════════════════════════════════════════════════════════════════════

describe("C · applying twice is idempotent", () => {
  it("a second apply of a re-plan anchors nothing further", async () => {
    await seedFixture();
    const first = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(first, { confirm: true });
    const afterFirst = await Promise.all(["alpha-roofing", "beta-hvac", "gamma-cleaning"].map(read));

    const second = await planIdentityBackfill({ mintId: counterMint() });
    expect(second.summary.assign).toBe(0);
    expect(second.summary.alreadyAnchored).toBe(3);

    const report = await applyIdentityBackfill(second, { confirm: true });
    expect(report.anchored).toEqual([]);
    expect(await Promise.all(["alpha-roofing", "beta-hvac", "gamma-cleaning"].map(read))).toEqual(afterFirst);
  });

  it("re-applying the ORIGINAL manifest is refused as drift, not silently re-run", async () => {
    // The file now differs from the snapshot the manifest was reviewed against.
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const again = await applyIdentityBackfill(m, { confirm: true });
    expect(again.anchored).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining("changed since the plan"),
      expect.stringContaining("changed since the plan"),
      expect.stringContaining("changed since the plan"),
    ]);
  });

  it("dry run is the default — apply without confirm writes nothing", async () => {
    await seedFixture();
    const before = await read("alpha-roofing");
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await expect(applyIdentityBackfill(m, { confirm: false })).rejects.toThrow(IdentityBackfillRefused);
    expect(await read("alpha-roofing")).toBe(before);
    expect(await readEvents()).toEqual([]);
  });
});

// ═══ D ═════════════════════════════════════════════════════════════════════════════════════════

describe("D · an existing prospect_id is never replaced", () => {
  it("an already-anchored prospect is classified, not re-minted", async () => {
    const existing = "01888888-0000-7000-8000-000000000001";
    await write("anchored-co", prospect({ prospect_id: existing, name: "Anchored Co", website: "https://anchored.test", contact_phone: '"209-555-7001"', contact_email: "x@anchored.test" }));
    const m = await planIdentityBackfill({ mintId: counterMint() });
    const entry = m.entries.find((e) => e.slug === "anchored-co")!;
    expect(entry.decision).toBe("already-anchored");
    expect(entry.existingProspectId).toBe(existing);
    expect(entry.proposedProspectId).toBeNull();
  });

  it("apply leaves an anchored file byte-identical", async () => {
    await write("anchored-co", prospect({ prospect_id: "01888888-0000-7000-8000-000000000001", name: "Anchored Co", website: "https://anchored.test", contact_phone: '"209-555-7001"', contact_email: "x@anchored.test" }));
    const before = await read("anchored-co");
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    expect(await read("anchored-co")).toBe(before);
  });

  it("validation rejects a manifest that would overwrite an identity", async () => {
    const m = {
      version: 1 as const,
      duplicates: [],
      summary: { total: 1, assign: 1, held: 0, alreadyAnchored: 0 },
      entries: [
        {
          slug: "x-co",
          decision: "assign" as const,
          proposedProspectId: "01900000-0000-7000-8000-000000000001" as ProspectId,
          existingProspectId: "01888888-0000-7000-8000-000000000009" as ProspectId,
          holdReason: null,
          duplicateOf: [],
          identityFields: { name: null, website: null, contact_phone: null, contact_email: null },
          contentSha256: "x",
          identitylessSha256: "y",
          businessEvent: "none" as const,
        },
      ],
    };
    expect(validateIdentityManifest(m).map((i) => i.problem)).toContain(
      "assign would replace an existing identity"
    );
    await expect(applyIdentityBackfill(m, { confirm: true })).rejects.toThrow(IdentityBackfillRefused);
  });
});

// ═══ E ═════════════════════════════════════════════════════════════════════════════════════════

describe("E · duplicate prospect_ids are rejected", () => {
  it("validation catches two entries proposing one id", async () => {
    const dup = "01900000-0000-7000-8000-000000000001" as ProspectId;
    const entry = (slug: string) => ({
      slug,
      decision: "assign" as const,
      proposedProspectId: dup,
      existingProspectId: null,
      holdReason: null,
      duplicateOf: [],
      identityFields: { name: null, website: null, contact_phone: null, contact_email: null },
      contentSha256: "x",
      identitylessSha256: "y",
      businessEvent: "none" as const,
    });
    const issues = validateIdentityManifest({
      version: 1,
      duplicates: [],
      summary: { total: 2, assign: 2, held: 0, alreadyAnchored: 0 },
      entries: [entry("a-co"), entry("b-co")],
    });
    expect(issues.map((i) => i.problem)).toContain("proposed id collides with a-co");
  });

  it("the writer refuses an id already claimed by another file", async () => {
    const taken = "01888888-0000-7000-8000-000000000001";
    await write("holder-co", prospect({ prospect_id: taken, name: "Holder", website: "https://holder.test", contact_phone: '"209-555-6001"', contact_email: "h@holder.test" }));
    await write("thief-co", prospect({ name: "Thief", website: "https://thief.test", contact_phone: '"209-555-6002"', contact_email: "t@thief.test" }));

    const m = await planIdentityBackfill({ mintId: () => taken as ProspectId });
    const report = await applyIdentityBackfill(m, { confirm: true });
    expect(report.anchored).toEqual([]);
    expect(report.skipped).toEqual([{ slug: "thief-co", reason: "duplicate_prospect_id" }]);
    // The holder keeps its identity; the thief gains none.
    expect(await read("thief-co")).not.toMatch(/prospect_id/);
  });
});

// ═══ F ═════════════════════════════════════════════════════════════════════════════════════════

describe("F · duplicate businesses are detected and never merged", () => {
  it("reports the pair with the evidence that matched", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    expect(m.duplicates).toHaveLength(1);
    expect(m.duplicates[0].matchedOn).toBe("website");
    expect(m.duplicates[0].slugs).toEqual([
      "tapia-tile-amp-marble-co",
      "tile-amp-marble-installation-in-bay-area",
    ]);
  });

  it("both records survive apply, untouched and unanchored", async () => {
    await seedFixture();
    const before = await Promise.all(DECLARED_HOLDS.map((h) => read(h.slug)));
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    expect(await Promise.all(DECLARED_HOLDS.map((h) => read(h.slug)))).toEqual(before);
    for (const h of DECLARED_HOLDS) expect(await read(h.slug)).not.toMatch(/prospect_id/);
    // Neither deleted, neither renamed.
    const files = await fs.readdir(path.join(vaultDir, HIT_LIST));
    expect(files).toContain("tapia-tile-amp-marble-co.md");
    expect(files).toContain("tile-amp-marble-installation-in-bay-area.md");
  });

  it("a NEW duplicate pair is held by the detector, without being declared", async () => {
    // The generalisation: holds.ts names the pair we know about; the rule catches the ones we don't.
    await write("new-a", prospect({ name: "New A", website: "https://shared.test", contact_phone: '""', contact_email: '""' }));
    await write("new-b", prospect({ name: "New B", website: "https://shared.test", contact_phone: '""', contact_email: '""' }));
    const m = await planIdentityBackfill({ mintId: counterMint() });
    expect(m.entries.every((e) => e.decision === "held")).toBe(true);
    expect(m.entries[0].holdReason).toContain("would assert they are independent businesses");
  });

  it("the module exposes no merge, delete or rename path", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    const report = await applyIdentityBackfill(m, { confirm: true });
    // The report can hold, skip and anchor. There is no vocabulary for resolving a duplicate.
    expect(Object.keys(report).sort()).toEqual([
      "anchored",
      "eventsAfter",
      "eventsBefore",
      "held",
      "skipped",
    ]);
    expect(report.held.map((h) => h.slug)).toEqual(DECLARED_HOLDS.map((h) => h.slug));
  });
});

// ═══ G + J ═════════════════════════════════════════════════════════════════════════════════════

describe("G+J · the backfill emits nothing and creates no operator activity", () => {
  it("THE HEADLINE GATE: the event spine is byte-for-byte untouched", async () => {
    await seedFixture();
    const before = await readEvents();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    const report = await applyIdentityBackfill(m, { confirm: true });

    expect(report.anchored).toHaveLength(3);
    expect(await readEvents()).toEqual(before);
    expect(report.eventsAfter).toBe(report.eventsBefore);
  });

  it("no prospect.created is emitted for a file that already existed", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    expect((await readEvents()).filter((e) => e.type === "prospect.created")).toEqual([]);
  });

  it("no event of ANY kind is attributed to the operator", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    expect((await readEvents()).filter((e) => e.actor === "operator")).toEqual([]);
  });

  it("§19's operator-event count is identical before and after", async () => {
    await seedFixture();
    const count = async () =>
      (await readEvents()).filter((e) => e.actor === "operator" && e.type !== "observation.captured").length;
    const before = await count();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    expect(await count()).toBe(before);
  });

  it("planning alone never writes or emits", async () => {
    await seedFixture();
    const filesBefore = await Promise.all(["alpha-roofing", "beta-hvac", "gamma-cleaning"].map(read));
    await planIdentityBackfill({ mintId: counterMint() });
    await snapshotHitList();
    expect(await Promise.all(["alpha-roofing", "beta-hvac", "gamma-cleaning"].map(read))).toEqual(filesBefore);
    expect(await readEvents()).toEqual([]);
  });
});

// ═══ H + K ═════════════════════════════════════════════════════════════════════════════════════

describe("H+K · relationships and event addressing still use the slug", () => {
  it("the structural context is unchanged, and still addresses the prospect by slug", async () => {
    await seedFixture();
    await seedPromotedClient("alpha-roofing-client", "alpha-roofing");

    const at = new Date("2026-08-27T00:00:00Z");
    const before = await buildStructuralContext(at);

    // NOT VACUOUS: prove the edge under test actually exists before asserting it survived.
    const promotedBefore = before.relationships.filter((r) => r.kind === "promoted_to");
    expect(promotedBefore).toHaveLength(1);
    expect(promotedBefore[0].source).toEqual({ entity: "prospect", entity_id: "alpha-roofing" });

    const m = await planIdentityBackfill({ mintId: counterMint() });
    const report = await applyIdentityBackfill(m, { confirm: true });
    expect(report.anchored.map((a) => a.slug)).toContain("alpha-roofing");

    const after = await buildStructuralContext(at);
    expect(after.relationships).toEqual(before.relationships);
    expect(after.subjects).toEqual(before.subjects);

    // The decisive half: the edge still points at the SLUG, not the freshly minted anchor.
    const promotedAfter = after.relationships.filter((r) => r.kind === "promoted_to");
    expect(promotedAfter[0].source.entity_id).toBe("alpha-roofing");
    expect(promotedAfter[0].source.entity_id).not.toBe(m.entries.find((e) => e.slug === "alpha-roofing")!.proposedProspectId);
  });

  it("the reconciler still keys prospects by slug, and reports no transition", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    // Baselines are addressed by slug — the anchor has not become the addressing key.
    const observed = (await readEvents({ types: ["observation.captured"] })).map((e) => e.subject.entity_id);
    expect(observed).toContain("alpha-roofing");
    expect(observed.some((id) => /^[0-9a-f]{8}-/.test(id))).toBe(false);
  });

  it("routing and graph identity still resolve from the slug", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    expect(routeForEntity("prospect", "alpha-roofing")).toBe("/sales/alpha-roofing");
    expect(graphNodeIdFor("prospect", "alpha-roofing")).toBe("prospect:alpha-roofing");
  });
});

// ═══ I ═════════════════════════════════════════════════════════════════════════════════════════

describe("I · no business fact changes", () => {
  it("THE DECISIVE GATE: stripping the identity line restores the original bytes exactly", async () => {
    await seedFixture();
    const before = await read("alpha-roofing");
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    const after = await read("alpha-roofing");

    expect(after).not.toBe(before);
    expect(withoutIdentityLine(after)).toBe(withoutIdentityLine(before));
    // And the change really is exactly one added line.
    expect(after.split("\n").length).toBe(before.split("\n").length + 1);
  });

  it("every scoring-relevant field and the score itself are unchanged", async () => {
    await seedFixture();
    const before = Object.fromEntries(
      (await listProspects()).map((p) => [p.slug, { fm: { ...p.frontmatter }, score: p.score.score, body: p.body }])
    );
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    for (const p of await listProspects()) {
      const was = before[p.slug];
      expect(p.score.score, p.slug).toBe(was.score);
      expect(p.body, p.slug).toBe(was.body);
      // Identical frontmatter apart from the anchor that was just added.
      const rest = { ...p.frontmatter };
      delete rest.prospect_id;
      expect(rest, p.slug).toEqual(was.fm);
    }
  });

  it("no website, quality, contact or status value is invented for a blank field", async () => {
    await write("sparse-co", "---\nname: Sparse Co\nstatus: lead\n---\n\n## Notes\n");
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    const after = await read("sparse-co");
    for (const key of ["website", "website_quality", "contact_phone", "contact_email", "first_contact"]) {
      expect(after, key).not.toMatch(new RegExp(`^${key}:`, "m"));
    }
    expect((await listProspects())[0].score.score).toBe(0);
  });

  it("the body — call log and operator notes — is never touched", async () => {
    await seedFixture();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });
    const after = await read("alpha-roofing");
    expect(after).toContain("## Call Log\n- 2026-06-10 — Intro call.");
    expect(after).toContain("## Friction / Notes\n- Peak season objection.");
  });
});

// ═══ L ═════════════════════════════════════════════════════════════════════════════════════════

describe("L · the result is verifiable against the snapshot taken before it", () => {
  it("verification passes on a correctly applied backfill, and reports every check", async () => {
    await seedFixture();
    const before = await snapshotHitList();
    const eventCountBefore = (await readEvents()).length;
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const v = await verifyIdentityBackfill({
      before,
      manifest: m,
      eventCountBefore,
      operatorEventsBefore: 0,
    });
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.checks).toHaveLength(9);
  });

  it("verification FAILS when a business fact changed alongside the identity", async () => {
    // The control: a verifier that cannot detect contamination is decoration.
    await seedFixture();
    const before = await snapshotHitList();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const tampered = (await read("alpha-roofing")).replace("website_quality: outdated", "website_quality: modern");
    await write("alpha-roofing", tampered);

    const v = await verifyIdentityBackfill({ before, manifest: m, eventCountBefore: 0, operatorEventsBefore: 0 });
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name.includes("apart from the identity line"))!.ok).toBe(false);
  });

  it("verification FAILS when a held prospect was anchored", async () => {
    await seedFixture();
    const before = await snapshotHitList();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const held = DECLARED_HOLDS[0].slug;
    await write(held, (await read(held)).replace("---\n", "---\nprospect_id: 01900000-0000-7000-8000-000000000099\n"));

    const v = await verifyIdentityBackfill({ before, manifest: m, eventCountBefore: 0, operatorEventsBefore: 0 });
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name.includes("held prospects"))!.ok).toBe(false);
  });

  it("verification FAILS when an event was appended", async () => {
    await seedFixture();
    const before = await snapshotHitList();
    const m = await planIdentityBackfill({ mintId: counterMint() });
    await applyIdentityBackfill(m, { confirm: true });

    const v = await verifyIdentityBackfill({
      before,
      manifest: m,
      eventCountBefore: -1, // pretend the spine had a different length
      operatorEventsBefore: 0,
    });
    expect(v.checks.find((c) => c.name.includes("event spine"))!.ok).toBe(false);
  });

  it("the snapshot is a pure read — taking one twice yields identical fingerprints", async () => {
    await seedFixture();
    const a = await snapshotHitList();
    const b = await snapshotHitList();
    expect(b).toEqual(a);
  });

  it("the rendered dry run states the change, the hold and the duplicate", async () => {
    await seedFixture();
    const text = renderIdentityManifest(await planIdentityBackfill({ mintId: counterMint() }));
    expect(text).toContain("would be anchored      3");
    expect(text).toContain("held for review        2");
    expect(text).toContain("business events        none");
    expect(text).toContain("REQUIRES HUMAN DECISION");
    expect(text).toContain("change   none — this file is not touched");
  });
});