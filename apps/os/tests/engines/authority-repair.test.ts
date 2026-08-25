// Layer A — STEP 5 ACCEPTANCE GATES (docs/STEP5-AUTHORITY-REPAIR.md §8).
//
// The repair moved behaviour onto the fields the reconciler observes, and severed the catalog from
// contract value. These are gates, not coverage: a regression here restores a state where editing
// the vault changes what the OS tells the operator to do while emitting no event.
//
// THE THREE-WAY PROTOCOL (§7). Every repointed fact is proven while BOTH representations still
// exist, because that is the only moment the distinction is observable:
//
//   1  change the OLD field only   →  nothing happens
//   2  change the NEW field only   →  expected behaviour AND provenance
//   3  both agree (today's vault)  →  behaviour identical to before the repair   ← the control
//
// Test 3 is what catches a repair that silently changed behaviour while the duplicates agreed —
// the failure most likely to reach production unnoticed. Test 1 is what proves Step 6's retirement
// is safe: a field with no behavioural effect can be removed without a behavioural migration.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getClientRevenue, listCareClients, CARE_INVOICE_IMPLIES_ACTIVE_DAYS } from "@/core/finance";
import { detectRevenueOpportunities } from "@/engines/opportunity-engine";
import { detectOpportunities } from "@/lib/opportunities";
import { reconcileVault } from "@/core/reconciler";
import { readEvents } from "@/core/events";

let vaultDir: string;
let saved: string | undefined;
const CRM = "01 - CRM & Clients";
const SIDE = ".ascend-os";

async function write(rel: string, contents: string): Promise<void> {
  const abs = path.join(vaultDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
}

/** A launched client, with BOTH representations present and agreeing — the real vault's shape. */
async function seedClient(over: { metaStatus?: string; scopeStatus?: string; pkg?: string; revenue?: string } = {}) {
  const metaStatus = over.metaStatus ?? "maintenance";
  const scopeStatus = over.scopeStatus ?? "maintenance";
  await write(
    `${CRM}/acme-co/structural_meta.json`,
    JSON.stringify({ client_id: "acme-co", status: metaStatus, tier: "growth" }, null, 2)
  );
  await write(`${CRM}/acme-co/business_context.md`, `---\nname: Acme Co\nwebsite: https://acme.test\n---\n`);
  await write(
    `${CRM}/acme-co/project_scope.md`,
    `---\nphase: launched\npackage: ${over.pkg ?? "growth"}\nlaunch_target: "2025-01-01"\nstatus: ${scopeStatus}\n` +
      (over.revenue !== undefined ? `revenue_usd: ${over.revenue}\n` : "") +
      `deliverables:\n  - Marketing site\n---\n\n## Scope Summary\n`
  );
  await write(
    `${CRM}/acme-co/production_state.md`,
    `---\nindustry_template: generic\nlaunch_target: ""\nphases:\n  onboarding:\n    status: complete\n  strategy:\n    status: complete\n  design:\n    status: complete\n  dev:\n    status: complete\n  launch:\n    status: complete\n---\n\n## Phase: Launch\n- [x] DNS\n`
  );
}

const kinds = async () => (await detectOpportunities()).map((o) => `${o.kind}:${o.target?.slug ?? "-"}`);

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-auth-"));
  await fs.mkdir(path.join(vaultDir, SIDE), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

// ─── A · Authority ─────────────────────────────────────────────────────────────────────────────
describe("A · lifecycle behaviour follows the observed field", () => {
  it("3 · CONTROL — with both fields agreeing, behaviour is what it always was", async () => {
    await seedClient();
    expect(await kinds()).toContain("launched_no_retainer:acme-co");
  });

  it("1 · changing project_scope.status ALONE changes no behaviour and emits no event", async () => {
    await seedClient();
    await reconcileVault();
    const before = await kinds();
    const settled = (await readEvents()).length;

    // The retired copy says the client is no longer in maintenance. Nothing may depend on it.
    await write(
      `${CRM}/acme-co/project_scope.md`,
      `---\nphase: launched\npackage: growth\nlaunch_target: "2025-01-01"\nstatus: active\ndeliverables:\n  - Marketing site\n---\n`
    );

    expect(await kinds()).toEqual(before);
    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await readEvents()).length).toBe(settled); // scope file is not observed at all
  });

  it("2 · changing structural_meta.status changes behaviour AND emits provenance", async () => {
    await seedClient();
    await reconcileVault();
    expect(await kinds()).toContain("launched_no_retainer:acme-co");

    await write(
      `${CRM}/acme-co/structural_meta.json`,
      JSON.stringify({ client_id: "acme-co", status: "active", tier: "growth" }, null, 2)
    );

    // Behaviour changed …
    expect(await kinds()).not.toContain("launched_no_retainer:acme-co");
    // … and the change was witnessed.
    const report = await reconcileVault();
    expect(report.transitions.map((t) => t.type)).toEqual(["client.status_changed"]);
  });

  it("the two representations may now disagree without the OS becoming incoherent", async () => {
    // Before the repair this was the H7 failure: two authoritative-looking sources, no reconciler.
    await seedClient({ metaStatus: "active", scopeStatus: "maintenance" });
    expect(await kinds()).not.toContain("launched_no_retainer:acme-co"); // meta wins
  });
});

// ─── B · Commercial ────────────────────────────────────────────────────────────────────────────
describe("B · a catalog is not a contract", () => {
  it("revenue is null when no contract value is recorded, even with a package", async () => {
    await seedClient({ pkg: "growth" });
    expect(await getClientRevenue("acme-co")).toBeNull(); // was 2497
  });

  it("revenue is the recorded value when one exists", async () => {
    await seedClient({ revenue: "1800" });
    expect(await getClientRevenue("acme-co")).toBe(1800);
  });

  it("changing package ALONE changes no revenue", async () => {
    await seedClient({ pkg: "growth" });
    const before = await getClientRevenue("acme-co");
    await seedClient({ pkg: "ascend-pro" });
    expect(await getClientRevenue("acme-co")).toBe(before);
  });

  it("changing structural_meta.tier never produces contract revenue", async () => {
    await seedClient();
    await write(
      `${CRM}/acme-co/structural_meta.json`,
      JSON.stringify({ client_id: "acme-co", status: "maintenance", tier: "ascend-pro" }, null, 2)
    );
    expect(await getClientRevenue("acme-co")).toBeNull();
  });

  it("null revenue is not zero — low_ehr cannot fire on an unknown contract value", async () => {
    await seedClient();
    expect(await kinds()).not.toContain("low_ehr:acme-co");
  });
});

// ─── C · Historical launch ─────────────────────────────────────────────────────────────────────
describe("C · launched_checkin reads the authoritative launch date only", () => {
  const targets = (v: string | undefined) => new Map<string, string | undefined>([["acme-co", v]]);

  it("cannot fire when the authoritative launch target is unknown", async () => {
    // project_scope.md still carries launch_target: "2025-01-01" — a fabricated date the rule must
    // no longer see. production_state.launch_target is "", so the age is unknown.
    await seedClient();
    const opps = await detectRevenueOpportunities(targets(undefined));
    expect(opps.map((o) => o.kind)).not.toContain("launched_checkin");
    expect(opps.map((o) => o.kind)).toContain("launched_no_retainer"); // the other rule is unaffected
  });

  it("fires when the authoritative launch target IS known and old enough", async () => {
    await seedClient();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const opps = await detectRevenueOpportunities(targets(old));
    expect(opps.map((o) => o.kind)).toContain("launched_checkin");
  });

  it("does not fire for a recent launch — the 90-day threshold is untouched", async () => {
    await seedClient();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const opps = await detectRevenueOpportunities(targets(recent));
    expect(opps.map((o) => o.kind)).not.toContain("launched_checkin");
  });

  it("an unparseable target yields no day count rather than a fabricated one", async () => {
    await seedClient();
    const opps = await detectRevenueOpportunities(targets("not-a-date"));
    expect(opps.map((o) => o.kind)).not.toContain("launched_checkin");
  });
});

// ─── D · Retainer provenance ───────────────────────────────────────────────────────────────────
describe("D · retainer_active carries where it came from", () => {
  const invoice = (paidDaysAgo: number | null) =>
    JSON.stringify({
      id: "inv-care-1",
      client: "acme-co",
      amount_usd: 199,
      label: "Care plan · Jun",
      issued_at: "2026-06-01T00:00:00.000Z",
      paid_at: paidDaysAgo === null ? null : new Date(Date.now() - paidDaysAgo * 86_400_000).toISOString(),
    }) + "\n";

  it("declared → source is `declared`", async () => {
    await seedClient();
    await write(`${CRM}/acme-co/business_context.md`, `---\nname: Acme Co\nretainer_active: true\n---\n`);
    const [c] = await listCareClients();
    expect(c.retainer_active).toBe(true);
    expect(c.retainer_active_source).toBe("declared");
  });

  it("a qualifying paid care invoice → active, but source is `inferred`", async () => {
    await seedClient();
    await write(`${SIDE}/invoices.jsonl`, invoice(10));
    const [c] = await listCareClients();
    expect(c.retainer_active).toBe(true);
    expect(c.retainer_active_source).toBe("inferred"); // NOT indistinguishable from declared
    expect(c.retainer_started).toBeDefined(); // back-filled from the payment, and labelled as such
  });

  it("a payment older than the named window does not infer a retainer", async () => {
    await seedClient();
    await write(`${SIDE}/invoices.jsonl`, invoice(CARE_INVOICE_IMPLIES_ACTIVE_DAYS + 30));
    const [c] = await listCareClients();
    expect(c.retainer_active).toBe(false);
    expect(c.retainer_active_source).toBe("none");
  });

  it("an UNPAID care invoice is not evidence of a retainer", async () => {
    await seedClient();
    await write(`${SIDE}/invoices.jsonl`, invoice(null));
    const [c] = await listCareClients();
    expect(c.retainer_active).toBe(false);
    expect(c.retainer_active_source).toBe("none");
  });

  it("no evidence at all does not manufacture an active retainer", async () => {
    await seedClient();
    const [c] = await listCareClients();
    expect(c.retainer_active).toBe(false);
    expect(c.retainer_active_source).toBe("none");
  });
});
// ─── E · Prospect import — absence stays absence ───────────────────────────────────────────────
//
// The route is exercised end to end rather than its helpers, because the defect lived in the field
// ASSEMBLY, not in the parsers: `normalizedQuality` correctly returned null and the caller then
// wrote "none" anyway.
describe("E · an omitted CSV column is not evidence", () => {
  async function importCsv(csv: string): Promise<void> {
    const { POST } = await import("@/app/api/import/prospects/route");
    const res = await POST(
      new Request("http://localhost/api/import/prospects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, column_map: { name: "name" } }),
      })
    );
    expect(res.status).toBe(200);
  }

  it("omitted website_quality does not become `none` — which was worth +30", async () => {
    await importCsv("name\nOmitted Quality Co\n");
    const file = await fs.readFile(path.join(vaultDir, "02 - Sales & Hit List", "omitted-quality-co.md"), "utf8");
    expect(file).not.toMatch(/^website_quality:\s*none/m);
    expect(file).not.toMatch(/^website_quality:/m); // absent, not blanked
  });

  it("omitted status does not become `lead` — which carries a forecast probability", async () => {
    await importCsv("name\nOmitted Status Co\n");
    const file = await fs.readFile(path.join(vaultDir, "02 - Sales & Hit List", "omitted-status-co.md"), "utf8");
    expect(file).not.toMatch(/^status:\s*lead/m);
    expect(file).not.toMatch(/^status:/m);
  });

  it("stated values are still imported unchanged", async () => {
    const { POST } = await import("@/app/api/import/prospects/route");
    const res = await POST(
      new Request("http://localhost/api/import/prospects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: "name,status,website_quality\nStated Co,contacted,outdated\n",
          column_map: { name: "name", status: "status", website_quality: "website_quality" },
        }),
      })
    );
    expect(res.status).toBe(200);
    const file = await fs.readFile(path.join(vaultDir, "02 - Sales & Hit List", "stated-co.md"), "utf8");
    expect(file).toMatch(/^status: contacted/m);
    expect(file).toMatch(/^website_quality: outdated/m);
  });

  it("a prospect with no status is SKIPPED by the reconciler, not observed as a lead", async () => {
    await importCsv("name\nNo Status Co\n");
    const report = await reconcileVault();
    expect(report.skipped.map((s) => s.key)).toContain("prospect:no-status-co");
    expect(report.transitions).toEqual([]);
  });
})
