// Layer A — THE HISTORICAL MIGRATION'S ACCEPTANCE GATES.
//
// docs/HISTORICAL-BACKFILL-H5.md §11. Like the reconciler's STOP conditions these are gates, not
// coverage: the migration rewrites the OS's account of its own past, so the failure mode is not a
// bug but a fabricated history no later increment can distinguish from a real one.
//
//   G1 DRY RUN         planning writes nothing; applying requires explicit confirmation
//   G2 DETERMINISM     identical vault ⇒ byte-identical manifest
//   G3 NO HISTORY      seeded → unknown creates no business event
//   G4 SYNTHETIC       test artifacts are REMOVED, never demoted to unknown
//   G5 IDEMPOTENCE     running twice ⇒ same vault, same events, empty second plan
//   G6 PARTIAL FAILURE crash after the write, and crash after the baseline, both recover
//   G7 §19             operator business events before === after
//   G8 EXCLUSION       Bay Area Custom Shirts is never touched
//
// NO PRODUCTION SEAM. A temp vault is built per test and ASCEND_VAULT_PATH points at it, so the
// real readers, the real emitter and the real event log run. The operator's vault is never
// addressed — H6 verifies against a SNAPSHOT, never live.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planMigration,
  applyMigration,
  validateManifest,
  verifyMigration,
  countOperatorBusinessEvents,
  renderManifest,
} from "@/migration";
import { reconcileVault } from "@/core/reconciler";
import { readEvents } from "@/core/events";
import { emitEvent } from "@/core/events";

let vaultDir: string;
let saved: string | undefined;

const CRM = "01 - CRM & Clients";
const DOCS = "04 - Documents";
const SIDE = ".ascend-os";

async function write(rel: string, contents: string): Promise<void> {
  const abs = path.join(vaultDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
}

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(vaultDir, rel), "utf8");
}

/**
 * A vault shaped like the real one: a scaffold-seeded client, an evidenced client, an excluded
 * lead-promoted-in-error, seeded and synthetic documents, and seeded/synthetic sidecar rows.
 */
async function seedVault(): Promise<void> {
  // Seeded phase history + seeded launch target (Tapia's shape).
  await write(
    `${CRM}/tapia-tile-marble/structural_meta.json`,
    JSON.stringify({ client_id: "tapia-tile-marble", status: "active", tier: "growth" }, null, 2)
  );
  await write(
    `${CRM}/tapia-tile-marble/business_context.md`,
    `---\nname: Tapia Tile & Marble Co.\nwebsite: https://tapiatilemarbleco.com\n---\n\n## Overview\n`
  );
  await write(
    `${CRM}/tapia-tile-marble/production_state.md`,
    `---
industry_template: contractor
launch_target: "2026-08-15"
phases:
  onboarding:
    status: complete
    started: "2026-06-01"
  strategy:
    status: complete
  design:
    status: in_progress
  dev:
    status: not_started
  launch:
    status: not_started
---

## Phase: Design
- [x] Homepage mockup v1
`
  );

  // Evidenced launch, unknown pre-launch phases (Elite Vac's shape), wrong canonical domain.
  await write(
    `${CRM}/elite-vac-service/structural_meta.json`,
    JSON.stringify({ client_id: "elite-vac-service", status: "maintenance" }, null, 2)
  );
  await write(
    `${CRM}/elite-vac-service/business_context.md`,
    `---\nname: Elite Vac Service\nwebsite: 'https://elitevacservice.com'\n---\n\n## Overview\n`
  );
  await write(
    `${CRM}/elite-vac-service/production_state.md`,
    `---
industry_template: generic
launch_target: ""
phases:
  onboarding:
    status: not_started
  strategy:
    status: not_started
  design:
    status: not_started
  dev:
    status: not_started
  launch:
    status: complete
    completed: "2022-03-01"
---

## Phase: Launch
- [x] DNS cutover
`
  );

  // EXCLUDED — a lead promoted in error. The migration must not touch it.
  await write(
    `${CRM}/bay-area-custom-shirts-inc/structural_meta.json`,
    JSON.stringify({ client_id: "bay-area-custom-shirts-inc", status: "active", tier: "growth" }, null, 2)
  );
  await write(
    `${CRM}/bay-area-custom-shirts-inc/business_context.md`,
    `---\nname: Bay Area Custom Shirts Inc.\nwebsite: 'https://www.bayareacustomshirts.com/'\n---\n`
  );
  await write(
    `${CRM}/bay-area-custom-shirts-inc/production_state.md`,
    `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: not_started\n---\n`
  );

  // Documents: one seeded, one synthetic (UUID + plausible timestamp, inside a test session).
  await write(
    `${DOCS}/decoraciones-pilar/contracts/website-build-contract-v1.md`,
    `---\ndoc_id: seed-doc-pilar-contract-v1\ntype: contract\nclient: decoraciones-pilar\nversion: 1\nstatus: superseded\namount_usd: 2497\ncreated_at: '2025-05-14T00:00:00.000Z'\n---\n# Contract\n`
  );
  await write(
    `${DOCS}/tapia-tile-marble/sows/phase-2-sow-v1.md`,
    `---\ndoc_id: babed1df-2536-4e30-a80c-59227ae67c1d\ntype: sow\nclient: tapia-tile-marble\nversion: 1\nstatus: draft\namount_usd: 625\ncreated_at: '2026-06-20T23:27:17.155Z'\n---\n# SOW\n`
  );

  // Sidecars: seeded rows, a synthetic 2s row, and one genuine row that must survive.
  await write(
    `${SIDE}/time_log.jsonl`,
    [
      JSON.stringify({ id: "seed-pilar-01", client: "decoraciones-pilar", duration_seconds: 3600 }),
      JSON.stringify({
        id: "87f366b4-d499-4cca-908e-0391f95f88ac",
        client: "tapia-tile-marble",
        duration_seconds: 2,
        started: "2026-06-20T23:26:42.170Z",
      }),
      JSON.stringify({ id: "real-entry-01", client: "tapia-tile-marble", duration_seconds: 5400 }),
    ].join("\n") + "\n"
  );
  await write(
    `${SIDE}/invoices.jsonl`,
    [
      JSON.stringify({ id: "seed-inv-tapia-01", client: "tapia-tile-marble", amount_usd: 1248, label: "Initial deposit" }),
      JSON.stringify({ id: "0c3c1b03-real", client: "tapia-tile-marble", amount_usd: 1249, label: "Final payment" }),
    ].join("\n") + "\n"
  );
  await write(
    `${SIDE}/audits.jsonl`,
    JSON.stringify({ id: "seed-aud-pilar-01", url: "https://decorpilar.com", client: "decoraciones-pilar" }) + "\n"
  );
}

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-migrate-"));
  await fs.mkdir(path.join(vaultDir, SIDE), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
  await seedVault();
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

async function businessEvents() {
  return (await readEvents()).filter((e) => e.type !== "observation.captured");
}

/** Snapshot every vault file, so "same final state" can be asserted byte-for-byte. */
async function vaultSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const ent of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(vaultDir, abs);
      if (ent.isDirectory()) await walk(abs);
      // The event log grows by design; its content is asserted separately.
      else if (!rel.endsWith(".events.jsonl")) out[rel] = await fs.readFile(abs, "utf8");
    }
  }
  await walk(vaultDir);
  return out;
}

// ─── G1 ────────────────────────────────────────────────────────────────────────────────────────
describe("G1 · dry run is the default", () => {
  it("planning changes no file and emits no event", async () => {
    const before = await vaultSnapshot();
    const m = await planMigration();
    expect(m.entries.length).toBeGreaterThan(0); // the plan is worthless if it finds nothing
    expect(await vaultSnapshot()).toEqual(before);
    expect(await readEvents()).toEqual([]);
  });

  it("applying without explicit confirmation throws before touching anything", async () => {
    const m = await planMigration();
    const before = await vaultSnapshot();
    await expect(applyMigration(m, { confirm: false })).rejects.toThrow(/confirm/);
    expect(await vaultSnapshot()).toEqual(before);
  });

  it("a manifest that fails validation is refused, and nothing is written", async () => {
    const m = await planMigration();
    const corrupted = { ...m, entries: [{ ...m.entries[0], evidence: "" }] };
    const before = await vaultSnapshot();
    await expect(applyMigration(corrupted, { confirm: true })).rejects.toThrow(/validation/);
    expect(await vaultSnapshot()).toEqual(before);
  });

  it("the plan validates clean and every entry names its evidence", async () => {
    const m = await planMigration();
    expect(validateManifest(m)).toEqual([]);
    for (const e of m.entries) expect(e.evidence.trim().length).toBeGreaterThan(0);
    expect(renderManifest(m)).toContain("business event:  none");
  });
});

// ─── G2 ────────────────────────────────────────────────────────────────────────────────────────
describe("G2 · determinism", () => {
  it("produces a byte-identical manifest across runs over an identical vault", async () => {
    const a = await planMigration();
    const b = await planMigration();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries no clock-derived value", async () => {
    // Timestamps DO appear in the manifest — an entry quotes the vault's own `created_at` as its
    // evidence, which is read data and perfectly deterministic. The property that matters is that
    // none of them was produced by reading the clock, so the test is "no timestamp is near now"
    // rather than "no timestamps at all", which would forbid citing evidence.
    const serialized = JSON.stringify(await planMigration());
    const now = Date.now();
    const stamps = serialized.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? [];
    expect(stamps.length).toBeGreaterThan(0); // the guard would be vacuous otherwise
    for (const s of stamps) {
      expect(Math.abs(now - Date.parse(s))).toBeGreaterThan(60_000);
    }
  });
});

// ─── G3 ────────────────────────────────────────────────────────────────────────────────────────
describe("G3 · seeded → unknown creates no business history", () => {
  it("emits only observation baselines, all actor=system", async () => {
    await reconcileVault(); // establish the pre-migration baseline, as the real sequence does
    const m = await planMigration();
    const report = await applyMigration(m, { confirm: true });

    expect(report.businessEvents).toBe(0);
    expect(await businessEvents()).toEqual([]);
    const baselines = (await readEvents()).filter((e) => e.type === "observation.captured");
    expect(baselines.every((e) => e.actor === "system")).toBe(true);
    expect(report.baselines).toBeGreaterThan(0);
  });

  it("a later sync reports zero transitions — the baselines actually took", async () => {
    await reconcileVault();
    await applyMigration(await planMigration(), { confirm: true });
    const sync = await reconcileVault();
    expect(sync.transitions).toEqual([]);
    expect(await businessEvents()).toEqual([]);
  });

  it("writes `unknown` into the vault for seeded phases", async () => {
    await applyMigration(await planMigration(), { confirm: true });
    const src = await read(`${CRM}/tapia-tile-marble/production_state.md`);
    expect(src).toContain("status: unknown");
    expect(src).not.toContain("status: in_progress");
    // The seeded launch target demotes too — a date is not more objective for being well-formed.
    expect(src).toMatch(/launch_target:\s*""/);
  });

  it("rewrites INLINE-map phase frontmatter as well as block form", async () => {
    // REGRESSION. Elite Vac's file (written by the quarantined intake route) uses
    // `onboarding: { status: not_started }`; the seeded clients use block form. Both parse
    // identically, so a rewriter handling only block form skips four phases invisibly — which is
    // exactly what happened on the first snapshot run against the real vault.
    await write(
      `${CRM}/elite-vac-service/production_state.md`,
      `---\nindustry_template: generic\nlaunch_target: ""\nphases:\n  onboarding: { status: not_started }\n  strategy: { status: not_started }\n  design: { status: not_started }\n  dev: { status: not_started }\n  launch:\n    status: complete\n    completed: "2022-03-01"\n---\n\n## Phase: Launch\n- [x] DNS cutover\n`
    );

    const report = await applyMigration(await planMigration(), { confirm: true });
    expect(report.skipped).toEqual([]); // a skipped entry is a failure, not a note

    const src = await read(`${CRM}/elite-vac-service/production_state.md`);
    expect(src).toContain("onboarding: { status: unknown }");
    expect(src).not.toContain("status: not_started");
    expect(src).toMatch(/launch:\s*\n\s*status: complete/); // the evidenced phase is untouched
    expect((await planMigration()).entries).toEqual([]);
  });

  it("leaves an evidenced phase alone", async () => {
    await applyMigration(await planMigration(), { confirm: true });
    const src = await read(`${CRM}/elite-vac-service/production_state.md`);
    // Elite Vac's launch is derived from a portfolio entry; only the pre-launch phases are unknown.
    expect(src).toMatch(/launch:\s*\n\s*status: complete/);
    expect(src).toContain('completed: "2022-03-01"');
  });

  it("does not reformat lines it was not asked to change", async () => {
    const before = await read(`${CRM}/tapia-tile-marble/production_state.md`);
    await applyMigration(await planMigration(), { confirm: true });
    const after = await read(`${CRM}/tapia-tile-marble/production_state.md`);
    expect(after).toContain('started: "2026-06-01"'); // sibling key untouched
    expect(after).toContain("- [x] Homepage mockup v1"); // body untouched
    expect(after.split("\n").length).toBe(before.split("\n").length);
  });
});

// ─── G4 ────────────────────────────────────────────────────────────────────────────────────────
describe("G4 · synthetic artifacts are removed, never demoted", () => {
  it("removes a UUID-bearing document created inside a test session", async () => {
    const m = await planMigration();
    const synthetic = m.entries.find((e) => e.entity.id === "babed1df-2536-4e30-a80c-59227ae67c1d");
    expect(synthetic).toBeDefined();
    expect(synthetic?.classification).toBe("synthetic");
    expect(synthetic?.disposition).toBe("removed"); // NOT "unknown" — no fact underlies it
    expect(synthetic?.evidence).toMatch(/test session/);

    await applyMigration(m, { confirm: true });
    await expect(read(`${DOCS}/tapia-tile-marble/sows/phase-2-sow-v1.md`)).rejects.toThrow();
  });

  it("removes seeded rows and a 2-second timer entry, keeping the genuine ones", async () => {
    await applyMigration(await planMigration(), { confirm: true });

    const times = await read(`${SIDE}/time_log.jsonl`);
    expect(times).not.toContain("seed-pilar-01");
    expect(times).not.toContain("87f366b4"); // 2s = a start/stop click pair
    expect(times).toContain("real-entry-01"); // 5400s survives

    const invoices = await read(`${SIDE}/invoices.jsonl`);
    expect(invoices).not.toContain("seed-inv-tapia-01");
    expect(invoices).toContain("0c3c1b03-real"); // the one real payment survives
  });

  it("classifies by temporal clustering, not by id shape", async () => {
    // The synthetic document carries a UUID and a plausible 2026 timestamp — indistinguishable from
    // a genuine record by id format alone. This is the trap the classifier must not fall into.
    const m = await planMigration();
    const e = m.entries.find((x) => x.entity.id === "babed1df-2536-4e30-a80c-59227ae67c1d");
    expect(e?.evidence).not.toMatch(/seed-/);
    expect(e?.confidence).toBe("high"); // never "certain" — clustering is strong, not proof
  });
});

// ─── G5 ────────────────────────────────────────────────────────────────────────────────────────
describe("G5 · idempotence", () => {
  it("running twice produces the same vault, and the second plan is empty", async () => {
    await reconcileVault();
    await applyMigration(await planMigration(), { confirm: true });
    const afterFirst = await vaultSnapshot();
    const eventsAfterFirst = (await readEvents()).length;

    const second = await planMigration();
    expect(second.entries).toEqual([]);

    await applyMigration(second, { confirm: true });
    expect(await vaultSnapshot()).toEqual(afterFirst);
    // An empty manifest has no baseline targets, so it emits nothing at all.
    expect((await readEvents()).length).toBe(eventsAfterFirst);
    expect(await businessEvents()).toEqual([]);
  });

  it("verifyMigration passes on the migrated vault", async () => {
    const before = await countOperatorBusinessEvents();
    await reconcileVault();
    await applyMigration(await planMigration(), { confirm: true });
    const result = await verifyMigration({ operatorEventsBefore: before });
    expect(result.checks.map((c) => `${c.name}: ${c.detail}`)).toBeDefined();
    expect(result.ok).toBe(true);
  });
});

// ─── G6 ────────────────────────────────────────────────────────────────────────────────────────
//
// Where the procedural protection earns its keep. The reconciler's STOP 5 proves the PHASE
// dimension is safe in either order; these prove the migration as a whole recovers.
describe("G6 · partial failure and restart", () => {
  it("crash AFTER the vault write, before the baseline — restart converges, no history", async () => {
    await reconcileVault();
    const m = await planMigration();

    // Simulate the crash: mutate exactly as apply would, then die before writing any baseline.
    const src = await read(`${CRM}/tapia-tile-marble/production_state.md`);
    await write(
      `${CRM}/tapia-tile-marble/production_state.md`,
      src.replace(/status: in_progress/, "status: unknown").replace(/status: complete/g, "status: unknown")
    );

    // A sync in the crash window must still claim nothing (H4's epistemic guard).
    expect((await reconcileVault()).transitions).toEqual([]);

    // Restart: re-plan against the half-migrated vault and apply.
    await applyMigration(await planMigration(), { confirm: true });

    expect((await planMigration()).entries).toEqual([]);
    expect((await reconcileVault()).transitions).toEqual([]);
    expect(await businessEvents()).toEqual([]);
    void m;
  });

  it("crash AFTER the baseline, before the write — restart converges, no history", async () => {
    await reconcileVault();

    // Baseline first, vault unchanged: the baseline is now ahead of the file.
    const obsBefore = (await readEvents()).length;
    await emitEvent({
      type: "observation.captured",
      actor: "system",
      subject: { entity: "project", entity_id: "tapia-tile-marble" },
      data: {
        state_fingerprint: "stale-fingerprint-from-a-crashed-run",
        observed_state: { onboarding: "unknown", strategy: "unknown", design: "unknown", dev: "unknown", launch: "unknown" },
        baseline: true,
        source: "historical_migration",
      },
    });
    expect((await readEvents()).length).toBe(obsBefore + 1);

    // A sync now compares unknown-baseline against the still-seeded vault. Every comparison has
    // `unknown` on one side, so nothing may be claimed.
    expect((await reconcileVault()).transitions).toEqual([]);

    await applyMigration(await planMigration(), { confirm: true });
    expect((await planMigration()).entries).toEqual([]);
    expect((await reconcileVault()).transitions).toEqual([]);
    expect(await businessEvents()).toEqual([]);
  });

  it("re-running after a crash does not duplicate anything in the vault", async () => {
    await reconcileVault();
    await applyMigration(await planMigration(), { confirm: true });
    const snapshot = await vaultSnapshot();

    await applyMigration(await planMigration(), { confirm: true });
    await applyMigration(await planMigration(), { confirm: true });
    expect(await vaultSnapshot()).toEqual(snapshot);
  });
});

// ─── G7 ────────────────────────────────────────────────────────────────────────────────────────
describe("G7 · §19 adoption measurement is untouched", () => {
  it("operator business events before === after", async () => {
    // A real operator action exists in the log, so the assertion is not vacuously about zero.
    await emitEvent({
      type: "project.checklist_toggled",
      subject: { entity: "project", entity_id: "tapia-tile-marble" },
      data: { phase: "design", item_index: 0, done: true },
    });
    const before = await countOperatorBusinessEvents();
    expect(before).toBe(1);

    await reconcileVault();
    await applyMigration(await planMigration(), { confirm: true });

    expect(await countOperatorBusinessEvents()).toBe(before);
  });

  it("every event the migration emits is actor=system and observation.captured", async () => {
    const before = new Set((await readEvents()).map((e) => e.event_id));
    await applyMigration(await planMigration(), { confirm: true });
    const added = (await readEvents()).filter((e) => !before.has(e.event_id));

    expect(added.length).toBeGreaterThan(0);
    for (const e of added) {
      expect(e.type).toBe("observation.captured");
      expect(e.actor).toBe("system");
    }
  });
});

// ─── G8 ────────────────────────────────────────────────────────────────────────────────────────
describe("G8 · declared exclusions are never touched", () => {
  it("the plan contains no entry for Bay Area Custom Shirts", async () => {
    const m = await planMigration();
    expect(m.entries.filter((e) => e.entity.id.includes("bay-area"))).toEqual([]);
    expect(m.baselineTargets.filter((t) => t.id.includes("bay-area"))).toEqual([]);
  });

  it("its files are byte-identical after a full migration", async () => {
    const before = await read(`${CRM}/bay-area-custom-shirts-inc/production_state.md`);
    const metaBefore = await read(`${CRM}/bay-area-custom-shirts-inc/structural_meta.json`);
    await applyMigration(await planMigration(), { confirm: true });
    expect(await read(`${CRM}/bay-area-custom-shirts-inc/production_state.md`)).toBe(before);
    expect(await read(`${CRM}/bay-area-custom-shirts-inc/structural_meta.json`)).toBe(metaBefore);
  });

  it("validation rejects a manifest that targets an exclusion", async () => {
    const m = await planMigration();
    const bad = {
      ...m,
      entries: [
        {
          ...m.entries[0],
          entity: { kind: "project" as const, id: "bay-area-custom-shirts-inc" },
        },
      ],
    };
    expect(validateManifest(bad).some((i) => /exclusion/.test(i.problem))).toBe(true);
  });
});