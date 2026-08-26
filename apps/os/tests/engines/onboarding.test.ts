// Layer A — RETROACTIVE ONBOARDING ACCEPTANCE GATES.
//
// Two clients Oscar confirmed in the H0 inventory have no vault presence. Recording them is
// legitimate; recording a *history* for them is not. These gates hold that line.
//
//   O1 DRY RUN      planning writes nothing; applying requires explicit confirmation
//   O2 §19          operator business events before === after
//   O3 NO HISTORY   entity existence is created, business activity is not
//   O4 UNKNOWN      everything unevidenced stays unknown — never zero, defaulted, or invented
//   O5 IDEMPOTENCE  a second run creates nothing
//   O6 GRAPH        the structural substrate picks them up with provenance
//
// A temp vault per test; the real readers, writers, emitter and event log run.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planOnboarding, applyOnboarding, verifyOnboarding, renderOnboardingManifest, ONBOARDING_SUBJECTS } from "@/onboarding";
import { readEvents, emitEvent } from "@/core/events";
import { reconcileVault } from "@/core/reconciler";
import { listProductionStates } from "@/core/production";
import { getClientRevenue } from "@/core/finance";
import { detectOpportunities } from "@/lib/opportunities";
import { buildStructuralContext } from "@/relationships";
import { computeHealthScore } from "@/engines/health-engine";

let vaultDir: string;
let saved: string | undefined;
const CRM = "01 - CRM & Clients";

async function seedMinimalVault(): Promise<void> {
  // One pre-existing client, so the vault is not empty and counts are meaningful.
  const dir = path.join(vaultDir, CRM, "existing-co");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "structural_meta.json"), JSON.stringify({ client_id: "existing-co", status: "active" }), "utf8");
  await fs.writeFile(path.join(dir, "business_context.md"), "---\nname: Existing Co\n---\n", "utf8");
  await fs.writeFile(
    path.join(dir, "production_state.md"),
    "---\nphases:\n  onboarding:\n    status: complete\n---\n\n## Phase: Onboarding\n- [x] Kickoff\n",
    "utf8"
  );
}

async function operatorBusinessEvents(): Promise<number> {
  return (await readEvents()).filter((e) => e.actor === "operator" && e.type !== "observation.captured").length;
}

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-onboard-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
  await seedMinimalVault();
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

// ─── O1 ────────────────────────────────────────────────────────────────────────────────────────
describe("O1 · dry run is the default", () => {
  it("planning creates no client and emits no event", async () => {
    const m = await planOnboarding();
    expect(m.entries).toHaveLength(2);
    expect(await fs.readdir(path.join(vaultDir, CRM))).toEqual(["existing-co"]);
    expect(await readEvents()).toEqual([]);
  });

  it("applying without confirmation throws before touching anything", async () => {
    const m = await planOnboarding();
    await expect(applyOnboarding(m, { confirm: false })).rejects.toThrow(/confirm/);
    expect(await fs.readdir(path.join(vaultDir, CRM))).toEqual(["existing-co"]);
  });

  it("the manifest states its actor and that no historical event is proposed", async () => {
    const rendered = renderOnboardingManifest(await planOnboarding());
    expect(rendered).toContain("actor:              system");
    expect(rendered).toContain("historical events:  none");
    expect(rendered).toMatch(/UNKNOWN\s+revenue_usd/);
  });
});

// ─── O2 ────────────────────────────────────────────────────────────────────────────────────────
describe("O2 · §19 adoption measurement is untouched", () => {
  it("operator business events before === after", async () => {
    // A real operator action exists, so the assertion is not vacuously about zero.
    await emitEvent({
      type: "project.checklist_toggled",
      subject: { entity: "project", entity_id: "existing-co" },
      data: { phase: "onboarding", item_index: 0, done: true },
    });
    const before = await operatorBusinessEvents();
    expect(before).toBe(1);

    await applyOnboarding(await planOnboarding(), { confirm: true });

    expect(await operatorBusinessEvents()).toBe(before);
  });

  it("every event onboarding causes is actor=system", async () => {
    const seen = new Set((await readEvents()).map((e) => e.event_id));
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const added = (await readEvents()).filter((e) => !seen.has(e.event_id));

    expect(added.length).toBeGreaterThan(0);
    for (const e of added) expect(e.actor).toBe("system");
    // The events themselves are TRUE: Ascend really is creating these records now.
    expect([...new Set(added.map((e) => e.type))].sort()).toEqual(["client.created", "project.created"]);
  });
});

// ─── O3 ────────────────────────────────────────────────────────────────────────────────────────
describe("O3 · existence is recorded, business activity is not", () => {
  it("emits no historical business event — no phase transition, no launch, no invoice", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const types = (await readEvents()).map((e) => e.type);
    for (const forbidden of ["project.phase_completed", "project.phase_started", "project.launched", "invoice.created", "invoice.paid"]) {
      expect(types).not.toContain(forbidden);
    }
  });

  it("a later sync reports zero transitions — no phantom history on first observation", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const report = await reconcileVault();
    // First sighting of the new objects: baseline only, never a fabricated birth.
    expect(report.transitions).toEqual([]);
    expect(report.baseline).toBeGreaterThan(0);
  });

  it("records no client status — an inference must not become an actionable claim", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const meta = JSON.parse(
      await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "structural_meta.json"), "utf8")
    );
    expect(meta.status).toBeUndefined();
    expect(meta.tier).toBe("growth"); // confirmed facts still land
  });

  it("raises no lifecycle signal, because `maintenance` was never asserted", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const kinds = (await detectOpportunities()).map((o) => `${o.kind}:${o.target?.slug ?? "-"}`);
    expect(kinds).not.toContain("launched_no_retainer:bedollas-landscaping");
    expect(kinds).not.toContain("launched_checkin:bedollas-landscaping");
  });

  it("the reconciler SKIPS a statusless client rather than inventing one", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const report = await reconcileVault();
    expect(report.skipped.map((s) => s.key)).toContain("client:bedollas-landscaping");
    // The PROJECT is still observed — its phases block is present and says `unknown`.
    expect(report.transitions).toEqual([]);
  });

  it("recording a status LATER yields a baseline, not a fabricated status change", async () => {
    // The reason `status` is omitted rather than written as "unknown". The client path in
    // core/reconciler has no epistemic guard, so an observed `unknown -> maintenance` would emit
    // client.status_changed and claim the business changed when Ascend merely learned.
    await applyOnboarding(await planOnboarding(), { confirm: true });
    await reconcileVault(); // client skipped; nothing observed for it

    const metaPath = path.join(vaultDir, CRM, "bedollas-landscaping", "structural_meta.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    await fs.writeFile(metaPath, JSON.stringify({ ...meta, status: "maintenance" }), "utf8");

    const report = await reconcileVault();
    expect(report.transitions.map((t) => t.type)).not.toContain("client.status_changed");
    expect(report.baseline).toBeGreaterThan(0); // first sighting of this client's state
  });

  it("records repository dates as evidence prose, never as project dates", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const scope = await fs.readFile(path.join(vaultDir, CRM, "the-best-house-cleaning-team", "project_scope.md"), "utf8");
    expect(scope).toContain("2026-05-12"); // present as evidence
    expect(scope).toMatch(/Does NOT prove the client relationship began in May/);
    // and NOT as a launch target or phase date
    expect(scope).not.toMatch(/^launch_target:/m);
    const prod = await fs.readFile(path.join(vaultDir, CRM, "the-best-house-cleaning-team", "production_state.md"), "utf8");
    expect(prod).not.toContain("2026-05");
  });
});

// ─── O4 ────────────────────────────────────────────────────────────────────────────────────────
describe("O4 · everything unevidenced stays unknown", () => {
  beforeEach(async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
  });

  it("every phase reads unknown, and the project is indeterminate", async () => {
    const states = await listProductionStates();
    for (const slug of ["bedollas-landscaping", "the-best-house-cleaning-team"]) {
      const s = states.find((x) => x.clientSlug === slug);
      expect(s, slug).toBeDefined();
      expect(s!.phases.every((p) => p.status === "unknown")).toBe(true);
      expect(s!.phaseState).toBe("indeterminate");
      expect(s!.overallProgress).toBeNull();
      expect(s!.activePhaseIndex).toBeNull();
    }
  });

  it("health is unscoreable rather than at_risk or healthy", async () => {
    const s = (await listProductionStates()).find((x) => x.clientSlug === "bedollas-landscaping")!;
    const h = computeHealthScore(s, 0);
    expect(h.score).toBeNull();
    expect(h.tier).toBeNull();
  });

  it("contract revenue is null despite a confirmed tier", async () => {
    // The whole point of COMMERCIAL-PROVENANCE §4.1: Growth is a price list, not an agreement.
    const meta = JSON.parse(await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "structural_meta.json"), "utf8"));
    expect(meta.tier).toBe("growth");
    expect(await getClientRevenue("bedollas-landscaping")).toBeNull();
  });

  it("does not recreate the four retired scope keys", async () => {
    const scope = await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "project_scope.md"), "utf8");
    for (const key of ["phase", "status", "package", "launch_target"]) {
      expect(scope, key).not.toMatch(new RegExp(`^${key}:`, "m"));
    }
  });

  it("leaves contacts and brand empty rather than inventing plausible values", async () => {
    const business = await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "business_context.md"), "utf8");
    expect(business).not.toMatch(/^contact_name: \S/m);
    const brand = await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "brand_identity.md"), "utf8");
    expect(brand).toMatch(/voice: ''|voice: ""/);
  });

  it("names each unknown with the reason it is unknown", async () => {
    const scope = await fs.readFile(path.join(vaultDir, CRM, "bedollas-landscaping", "project_scope.md"), "utf8");
    expect(scope).toContain("## Explicitly unknown");
    expect(scope).toMatch(/a development window is not a phase history/);
    expect(scope).toMatch(/a tier is a price list, not an agreement/);
  });
});

// ─── O5 ────────────────────────────────────────────────────────────────────────────────────────
describe("O5 · idempotence", () => {
  it("a second plan is empty and a second apply creates nothing", async () => {
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const eventsAfterFirst = (await readEvents()).length;

    expect((await planOnboarding()).entries).toEqual([]);
    expect(await verifyOnboarding()).toEqual({ ok: true, remaining: 0 });

    await applyOnboarding(await planOnboarding(), { confirm: true });
    expect((await readEvents()).length).toBe(eventsAfterFirst);
  });
});

// ─── O6 ────────────────────────────────────────────────────────────────────────────────────────
describe("O6 · the structural substrate picks them up", () => {
  it("adds the entities and their relationships, each with provenance", async () => {
    const before = await buildStructuralContext();
    await applyOnboarding(await planOnboarding(), { confirm: true });
    const after = await buildStructuralContext();

    const id = (s: { entity: string; entity_id: string }) => `${s.entity}:${s.entity_id}`;
    const subjects = new Set(after.subjects.map(id));
    expect(subjects).toContain("client:bedollas-landscaping");
    expect(subjects).toContain("project:bedollas-landscaping");
    expect(subjects).toContain("client:the-best-house-cleaning-team");
    expect(after.subjects.length).toBeGreaterThan(before.subjects.length);

    const hasProject = after.relationships.find(
      (r) => r.kind === "has_project" && r.source.entity_id === "bedollas-landscaping"
    );
    expect(hasProject).toBeDefined();
    expect(hasProject!.provenance.reader).toBeTruthy(); // every claim audits back to a source
  });

  it("declares exactly the two subjects, so the universe cannot silently grow", () => {
    expect(ONBOARDING_SUBJECTS.map((s) => s.slug).sort()).toEqual([
      "bedollas-landscaping",
      "the-best-house-cleaning-team",
    ]);
  });
});