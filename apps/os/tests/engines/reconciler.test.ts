// Layer A — THE RECONCILER'S FOUR STOP CONDITIONS.
//
// These are gates, not coverage. The reconciler observes a vault Ascend does not control and turns
// differences into permanent history, so the failure mode is not a bug — it is a fabricated past
// that no later increment can distinguish from a real one. Each describe block below is one of the
// four conditions the increment was approved against.
//
//   1 BASELINE HONESTY   fresh vault ⇒ N observations, ZERO business transitions
//   2 IDEMPOTENCY        sync twice unchanged ⇒ second run emits nothing
//   3 EXTERNAL CHANGE    edit the vault outside Ascend ⇒ exactly the truthful transition
//   4 MALFORMED / iCLOUD skip, emit nothing, preserve the prior observation
//
// NO PRODUCTION SEAM (D4). `vaultPath()` reads ASCEND_VAULT_PATH at call time, so a temp directory
// exercises the real readers, the real emitter and the real event log. The operator's vault is never
// addressed.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reconcileVault } from "@/core/reconciler";
import { readEvents } from "@/core/events";
import { routeForEntity } from "@/navigation/routing";
import type { EventEnvelope } from "@/domain";

let vaultDir: string;
let saved: string | undefined;

const CRM = "01 - CRM & Clients";
const HIT = "02 - Sales & Hit List";

async function writeFile(rel: string, contents: string): Promise<void> {
  const abs = path.join(vaultDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
}

/** A client with a project in mid-flight, plus one prospect. The shape a real vault has. */
async function seedVault(): Promise<void> {
  await writeFile(
    `${CRM}/acme-co/structural_meta.json`,
    JSON.stringify({ client_id: "acme-co", status: "active", tier: "growth" }, null, 2)
  );
  await writeFile(
    `${CRM}/acme-co/production_state.md`,
    `---
industry_template: generic
phases:
  onboarding:
    status: complete
  strategy:
    status: in_progress
  design:
    status: not_started
  dev:
    status: not_started
  launch:
    status: not_started
---

## Phase: Onboarding
- [x] Kickoff
`
  );
  await writeFile(
    `${HIT}/valley-roofing.md`,
    `---
name: Valley Roofing
status: lead
---

## Notes
`
  );
}

/** Rewrite one phase's status the way an operator editing in Obsidian would. */
async function setPhase(phase: string, status: string): Promise<void> {
  const abs = path.join(vaultDir, `${CRM}/acme-co/production_state.md`);
  const raw = await fs.readFile(abs, "utf8");
  const next = raw.replace(
    new RegExp(`(  ${phase}:\\n    status: )\\w+`),
    `$1${status}`
  );
  await fs.writeFile(abs, next, "utf8");
}

async function events(): Promise<EventEnvelope[]> {
  return readEvents();
}
async function businessEvents(): Promise<EventEnvelope[]> {
  return (await events()).filter((e) => e.type !== "observation.captured");
}

/**
 * These tests read the EVENT SPINE, which since the per-domain visibility model resolves its caller
 * and fails closed. Declaring the caller is the boundary working — a test is a caller like any
 * other, the same reason `tests/engines/event-emission.test.ts` already binds one.
 *
 * `owner` because these suites assert over the WHOLE spine (migration baselines, reconciler
 * observations, notification loops); a narrower principal would filter their own fixtures out and
 * they would go red for a reason unrelated to what they measure.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-recon-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

// ─── STOP 1 ────────────────────────────────────────────────────────────────────────────────────
describe("STOP 1 · baseline honesty — a first sync witnesses nothing", () => {
  it("emits one observation per object and ZERO business transitions", async () => {
    await seedVault();
    const report = await reconcileVault();

    expect(report.observed).toBe(3); // client + project + prospect
    expect(report.baseline).toBe(3);
    expect(report.updated).toBe(0);
    expect(report.transitions).toEqual([]);

    const all = await events();
    expect(all).toHaveLength(3);
    expect(all.every((e) => e.type === "observation.captured")).toBe(true);
    expect(await businessEvents()).toEqual([]);
  });

  it("does NOT claim anything was created — a baseline is not a birth", async () => {
    await seedVault();
    await reconcileVault();
    const types = (await events()).map((e) => e.type);
    expect(types).not.toContain("prospect.created");
    expect(types).not.toContain("client.created");
    expect(types).not.toContain("project.created");
  });

  it("marks baseline observations as such, so replay can tell them apart", async () => {
    await seedVault();
    await reconcileVault();
    for (const e of await events()) {
      expect((e.data as { baseline?: boolean }).baseline).toBe(true);
      expect(typeof (e.data as { state_fingerprint?: string }).state_fingerprint).toBe("string");
    }
  });

  it("an object that appears LATER is also baselined, not reported as created", async () => {
    await seedVault();
    await reconcileVault();
    // The operator adds a prospect by hand in Obsidian.
    await writeFile(`${HIT}/new-lead.md`, `---\nname: New Lead\nstatus: lead\n---\n`);
    const report = await reconcileVault();

    expect(report.baseline).toBe(1);
    expect(report.transitions).toEqual([]);
    expect(await businessEvents()).toEqual([]);
  });
});

// ─── STOP 2 ────────────────────────────────────────────────────────────────────────────────────
describe("STOP 2 · idempotency — syncing an unchanged vault is silent", () => {
  it("a second sync emits nothing at all", async () => {
    await seedVault();
    await reconcileVault();
    const afterFirst = (await events()).length;

    const second = await reconcileVault();
    expect(second.baseline).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.transitions).toEqual([]);
    expect((await events()).length).toBe(afterFirst);
  });

  it("five consecutive syncs never grow the log", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;
    for (let i = 0; i < 5; i++) await reconcileVault();
    expect((await events()).length).toBe(settled);
  });

  it("a PROSE edit moves the content fingerprint but emits nothing", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    // Body text only — no frontmatter, no business state.
    const abs = path.join(vaultDir, `${CRM}/acme-co/production_state.md`);
    await fs.writeFile(abs, (await fs.readFile(abs, "utf8")) + "\nSome notes I typed.\n", "utf8");

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect(report.updated).toBe(0);
    expect((await events()).length).toBe(settled);
  });

  it("reordering frontmatter keys is not a business change", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    await writeFile(
      `${CRM}/acme-co/structural_meta.json`,
      JSON.stringify({ tier: "growth", client_id: "acme-co", status: "active" }, null, 2)
    );
    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await events()).length).toBe(settled);
  });
});

// ─── STOP 3 ────────────────────────────────────────────────────────────────────────────────────
describe("STOP 3 · an external edit produces exactly the truthful transition", () => {
  it("in_progress → complete emits one phase_completed, nothing more", async () => {
    await seedVault();
    await reconcileVault();

    await setPhase("strategy", "complete");
    const report = await reconcileVault();

    expect(report.transitions).toHaveLength(1);
    expect(report.transitions[0]).toMatchObject({
      type: "project.phase_completed",
      entity: "project",
      entityId: "acme-co",
      from: "in_progress",
      to: "complete",
    });

    const business = await businessEvents();
    expect(business).toHaveLength(1);
    expect(business[0].data).toMatchObject({ phase: "strategy", from: "in_progress", to: "complete" });
    // Provenance is explicit: this came from watching the vault, not from an Ascend action.
    expect(business[0].data).toMatchObject({ source: "vault_observation" });
    expect(business[0].actor).toBe("system");
  });

  it("not_started → complete claims ONLY completion — no fabricated start", async () => {
    await seedVault();
    await reconcileVault();

    await setPhase("design", "complete"); // skipped straight past in_progress
    const report = await reconcileVault();

    expect(report.transitions.map((t) => t.type)).toEqual(["project.phase_completed"]);
    expect(report.transitions.map((t) => t.type)).not.toContain("project.phase_started");
  });

  it("client status change is recorded with its direction", async () => {
    await seedVault();
    await reconcileVault();

    await writeFile(
      `${CRM}/acme-co/structural_meta.json`,
      JSON.stringify({ client_id: "acme-co", status: "archived", tier: "growth" }, null, 2)
    );
    const report = await reconcileVault();

    expect(report.transitions).toHaveLength(1);
    expect(report.transitions[0]).toMatchObject({
      type: "client.status_changed",
      from: "active",
      to: "archived",
    });
  });

  it("prospect status change is recorded, and resolves to its canonical route", async () => {
    await seedVault();
    await reconcileVault();

    await writeFile(`${HIT}/valley-roofing.md`, `---\nname: Valley Roofing\nstatus: proposal\n---\n`);
    const report = await reconcileVault();

    expect(report.transitions[0]).toMatchObject({
      type: "prospect.status_changed",
      from: "lead",
      to: "proposal",
    });
    const [e] = await businessEvents();
    expect(routeForEntity(e.subject.entity, e.subject.entity_id)).toBe("/sales/valley-roofing");
  });

  it("finishing the last phase emits phase_completed AND project.launched, once", async () => {
    await seedVault();
    await reconcileVault();

    for (const p of ["strategy", "design", "dev", "launch"]) await setPhase(p, "complete");
    const report = await reconcileVault();

    const types = report.transitions.map((t) => t.type);
    expect(types.filter((t) => t === "project.phase_completed")).toHaveLength(4);
    expect(types.filter((t) => t === "project.launched")).toHaveLength(1);

    // Launch is a condition becoming true — a further sync must not re-announce it.
    const again = await reconcileVault();
    expect(again.transitions).toEqual([]);
  });

  it("a backwards phase move records no event — the domain has no type for it", async () => {
    // PINNED, not hidden. Reopening a completed phase is a real transition with no event type;
    // describing it with a forward event would misstate what happened. The observation still
    // advances, so the reopened state becomes the new baseline.
    await seedVault();
    await reconcileVault();
    await setPhase("onboarding", "in_progress"); // complete → in_progress
    const report = await reconcileVault();

    expect(report.updated).toBe(1); // the change WAS observed
    expect(report.transitions).toEqual([]); // but nothing was claimed
    expect(await businessEvents()).toEqual([]);

    // And it is now the baseline: syncing again is silent.
    expect((await reconcileVault()).transitions).toEqual([]);
  });

  it("occurred_at is the OBSERVATION time, never the vault's own dates", async () => {
    await seedVault();
    await reconcileVault();
    const before = new Date().toISOString();
    await setPhase("strategy", "complete");
    const report = await reconcileVault();
    expect(report.transitions).toHaveLength(1);

    const [e] = await businessEvents();
    // Backdating would break core/events' ordering contract: appended last, sorted into the past.
    expect(e.occurred_at >= before).toBe(true);
  });
});

// ─── STOP 4 ────────────────────────────────────────────────────────────────────────────────────
describe("STOP 4 · malformed and iCloud states are skipped, never guessed at", () => {
  it("a deleted phases block is skipped — no phantom reversals", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    // The frontmatter parses cleanly but its state carrier is gone. Read naively this looks like
    // "every phase reverted to not_started".
    await writeFile(`${CRM}/acme-co/production_state.md`, `---\nindustry_template: generic\n---\n\n## Notes\n`);

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await events()).length).toBe(settled);
    expect(report.skipped.map((s) => s.key)).toContain("project:acme-co");
  });

  it("unparseable frontmatter is skipped and the prior observation survives", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    await writeFile(`${HIT}/valley-roofing.md`, `---\nname: [unclosed\n  status: ???\n`);
    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await events()).length).toBe(settled);

    // Repair it back to its ORIGINAL state — the preserved observation means this is not a change.
    await writeFile(`${HIT}/valley-roofing.md`, `---\nname: Valley Roofing\nstatus: lead\n---\n`);
    expect((await reconcileVault()).transitions).toEqual([]);
  });

  it("iCloud placeholders and conflict copies are never read as business state", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    // What iCloud actually leaves behind: an evicted placeholder and a sync conflict copy, each
    // carrying a status that differs from the real file.
    await writeFile(`${HIT}/.valley-roofing.md.icloud`, "");
    await writeFile(`${HIT}/valley-roofing 2.md`, `---\nname: Valley Roofing\nstatus: closed-won\n---\n`);
    await writeFile(
      `${HIT}/valley-roofing (Oscar's conflicted copy 2026-08-17).md`,
      `---\nname: Valley Roofing\nstatus: closed-lost\n---\n`
    );

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await events()).length).toBe(settled);
  });

  it("a vanished file is NOT treated as a deletion", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    // Under iCloud a file can be temporarily unmaterialised, and prospects have no stable id, so a
    // rename is indistinguishable from a delete. Absence therefore proves nothing.
    await fs.rm(path.join(vaultDir, `${HIT}/valley-roofing.md`));

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await events()).length).toBe(settled);

    // And when it comes back unchanged, that is still not a change.
    await writeFile(`${HIT}/valley-roofing.md`, `---\nname: Valley Roofing\nstatus: lead\n---\n`);
    expect((await reconcileVault()).transitions).toEqual([]);
  });

  it("a client with no readable structural_meta is skipped, not defaulted", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    await writeFile(`${CRM}/acme-co/structural_meta.json`, "{ not valid json");
    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect(report.skipped.map((s) => s.key)).toContain("client:acme-co");
    expect((await events()).length).toBe(settled);
  });
});
// ─── STOP 5 ────────────────────────────────────────────────────────────────────────────────────
//
// THE EPISTEMIC BOUNDARY. Added with the unknown-safe semantics (docs/HISTORICAL-BACKFILL-H4.md
// §6) and load-bearing for the historical migration (H5 §4.2).
//
//   ONTIC      the business changed        in_progress → complete   ⇒ an event
//   EPISTEMIC  our knowledge changed       unknown     → complete   ⇒ NO event
//
// A phase leaving `unknown` means Ascend LEARNED something already true, not that it happened now.
// Emitting `project.phase_completed` there would date a years-old completion to today — the false
// memory the provenance rule exists to prevent.
//
// The migration rewrites seeded phase state to `unknown` and re-baselines. These tests pin the
// property that makes that safe EVEN IF the process dies between the two steps: with `unknown` on
// either side of the comparison, no business event can be produced in either direction. They are a
// gate on the reconciler as it stands, not a test of migration code, which does not exist.
describe("STOP 5 · epistemic change is not business history", () => {
  it("seeded → unknown emits NO business event (the migration's core write)", async () => {
    await seedVault();
    await reconcileVault();
    const settled = (await events()).length;

    // What the migration does to every scaffold-authored phase.
    await setPhase("strategy", "unknown"); // was in_progress
    await setPhase("design", "unknown"); // was not_started
    await setPhase("onboarding", "unknown"); // was complete

    const report = await reconcileVault();
    expect(report.updated).toBe(1); // the state DID change — it is observed
    expect(report.transitions).toEqual([]); // but nothing is claimed about the business
    expect(await businessEvents()).toEqual([]);
    // The observation advanced, so the new state is the baseline for future real changes.
    expect((await events()).length).toBe(settled + 1);
  });

  it("unknown → complete emits NO business event — learning a fact is not witnessing one", async () => {
    await seedVault();
    await setPhase("design", "unknown");
    await reconcileVault();

    await setPhase("design", "complete"); // evidence later establishes it
    const report = await reconcileVault();

    expect(report.transitions).toEqual([]);
    expect((await businessEvents()).map((e) => e.type)).not.toContain("project.phase_completed");
  });

  it("a project with any unknown phase never emits project.launched", async () => {
    await seedVault();
    await setPhase("design", "unknown");
    await reconcileVault();

    for (const p of ["onboarding", "strategy", "dev", "launch"]) await setPhase(p, "complete");
    const report = await reconcileVault();

    // allPhasesResolved requires every phase terminal, and `unknown` is not terminal — so a
    // historical project cannot acquire a launch the OS never witnessed.
    expect(report.transitions.map((t) => t.type)).not.toContain("project.launched");
    expect((await businessEvents()).map((e) => e.type)).not.toContain("project.launched");
  });

  it("CRASH SAFETY — vault written but never re-baselined still fabricates nothing", async () => {
    await seedVault();
    await reconcileVault(); // baseline holds the seeded state
    const settled = (await events()).length;

    // Simulate the migration dying after the vault write and before the re-baseline: a sync runs
    // against corrected state whose baseline is still the seeded one.
    await setPhase("onboarding", "unknown");
    await setPhase("strategy", "unknown");
    const first = await reconcileVault();
    expect(first.transitions).toEqual([]);

    // And the reverse ordering — baseline ahead of the vault, i.e. a crash before the write.
    await setPhase("onboarding", "complete");
    const second = await reconcileVault();
    expect(second.transitions).toEqual([]);

    expect(await businessEvents()).toEqual([]);
    expect((await events()).length).toBe(settled + 2); // observations only
  });

  it("REGRESSION — a genuine business transition is still emitted", async () => {
    // The guard must not silence real history: this is the control for the four tests above.
    await seedVault();
    await reconcileVault();

    await setPhase("strategy", "complete"); // in_progress → complete, no unknown involved
    const report = await reconcileVault();

    expect(report.transitions.map((t) => t.type)).toEqual(["project.phase_completed"]);
    expect((await businessEvents()).map((e) => e.type)).toEqual(["project.phase_completed"]);
  });
});

// ─── STOP 6 ────────────────────────────────────────────────────────────────────────────────────
//
// AN ABSENT PHASE ENTRY IS UNKNOWN, NOT not_started (docs/HISTORICAL-BACKFILL-H8.md §2).
//
// The observer read an absent entry as "not_started" while core/production read it as `unknown`.
// Because `phaseTransitionType` tests the OBSERVED value, that divergence let a phase whose history
// was never known emit `project.phase_completed` — going around the epistemic guard rather than
// through it. These gates pin both halves: the hole is closed, and real history still flows.
//
// The vault distinguishes two different silences, and only one is trustworthy:
//   phases block PRESENT, one entry absent  → unknown  (the operator wrote nothing about it)
//   phases block MISSING entirely           → skipped  (the state carrier is gone — STOP 4)
describe("STOP 6 · an absent phase entry is unknown, not not_started", () => {
  /** A project whose `phases` block exists but declares only `onboarding`. */
  async function seedPartialProject(): Promise<void> {
    await writeFile(
      `${CRM}/partial-co/structural_meta.json`,
      JSON.stringify({ client_id: "partial-co", status: "active" }, null, 2)
    );
    await writeFile(
      `${CRM}/partial-co/production_state.md`,
      `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: complete\n---\n\n## Phase: Onboarding\n- [x] Kickoff\n`
    );
  }

  it("observes an undeclared phase as unknown", async () => {
    await seedPartialProject();
    await reconcileVault();

    const baseline = (await events()).find(
      (e) => e.type === "observation.captured" && e.subject.entity_id === "partial-co" && e.subject.entity === "project"
    );
    const observed = baseline?.data?.observed_state as Record<string, string>;
    expect(observed.onboarding).toBe("complete");
    // The four the operator never wrote about.
    for (const p of ["strategy", "design", "dev", "launch"]) expect(observed[p]).toBe("unknown");
  });

  it("absent → complete emits NO business event (the hole H8 found)", async () => {
    await seedPartialProject();
    await reconcileVault();
    const settled = (await events()).length;

    // The operator fills in a phase that was never declared. Before the fix this compared as
    // not_started → complete and emitted project.phase_completed, dating an unknown completion
    // to today.
    await writeFile(
      `${CRM}/partial-co/production_state.md`,
      `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: complete\n  design:\n    status: complete\n---\n\n## Phase: Onboarding\n- [x] Kickoff\n`
    );

    const report = await reconcileVault();
    expect(report.transitions).toEqual([]);
    expect((await businessEvents()).map((e) => e.type)).not.toContain("project.phase_completed");
    expect((await events()).length).toBe(settled + 1); // the observation advanced; nothing was claimed
  });

  it("a project with undeclared phases never emits project.launched", async () => {
    await seedPartialProject();
    await reconcileVault();

    // Declaring every phase complete IS a launch; declaring one and leaving four silent is not.
    await writeFile(
      `${CRM}/partial-co/production_state.md`,
      `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: complete\n  strategy:\n    status: complete\n---\n\n## Phase: Onboarding\n- [x] Kickoff\n`
    );

    const report = await reconcileVault();
    expect(report.transitions.map((t) => t.type)).not.toContain("project.launched");
  });

  it("REGRESSION — a declared in_progress → complete still emits phase_completed", async () => {
    // The control. Without it, every assertion above would also pass if phase events had simply
    // stopped working. This is the same guard STOP 5 carries, against a partial-block project.
    await writeFile(
      `${CRM}/partial-co/structural_meta.json`,
      JSON.stringify({ client_id: "partial-co", status: "active" }, null, 2)
    );
    await writeFile(
      `${CRM}/partial-co/production_state.md`,
      `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: in_progress\n---\n\n## Phase: Onboarding\n- [ ] Kickoff\n`
    );
    await reconcileVault();

    await writeFile(
      `${CRM}/partial-co/production_state.md`,
      `---\nindustry_template: generic\nphases:\n  onboarding:\n    status: complete\n---\n\n## Phase: Onboarding\n- [x] Kickoff\n`
    );

    const report = await reconcileVault();
    expect(report.transitions.map((t) => t.type)).toEqual(["project.phase_completed"]);
    expect(report.transitions[0]).toMatchObject({ from: "in_progress", to: "complete" });
  });

  it("a MISSING phases block is still skipped, not read as five unknowns", async () => {
    // STOP 4's distinction survives: absent ENTRY is unknown, absent CARRIER is untrustworthy.
    await writeFile(
      `${CRM}/partial-co/structural_meta.json`,
      JSON.stringify({ client_id: "partial-co", status: "active" }, null, 2)
    );
    await writeFile(`${CRM}/partial-co/production_state.md`, `---\nindustry_template: generic\n---\n\n## Phase: Onboarding\n`);

    const report = await reconcileVault();
    expect(report.skipped.map((s) => s.key)).toContain("project:partial-co");
    expect(report.transitions).toEqual([]);
  });
});
