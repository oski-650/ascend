// Layer A — Production-Template Compliance (Phase 7) contract tests.
//
// Frozen contract: a FACTUAL structural diff of a project's checklist against its canonical template.
// Reports only; never executes, never writes status, never recommends (no score/priority/ranking —
// that would be Decision). Step matching is deterministic mechanical normalization (case +
// whitespace) ONLY — no fuzzy, no NLP, no AI. Clock-free.

import { describe, expect, it } from "vitest";
import { compareToTemplate, type ProjectComplianceInput, type TemplateComplianceInput } from "@/engines/sop-engine";
import { PHASE_KEYS, type ChecklistItem, type PhaseKey } from "@/domain";

const item = (text: string, done = false): ChecklistItem => ({ text, done });

const project = (phases: Partial<Record<PhaseKey, ChecklistItem[]>>): ProjectComplianceInput => ({
  clientSlug: "acme",
  industryTemplate: "generic",
  phases: PHASE_KEYS.map((key) => ({ key, checklist: phases[key] ?? [] })),
});

const template = (steps: Partial<Record<PhaseKey, ChecklistItem[]>>): TemplateComplianceInput => ({
  industryTemplate: "generic",
  steps: Object.fromEntries(PHASE_KEYS.map((k) => [k, steps[k] ?? []])) as Record<
    PhaseKey,
    ChecklistItem[]
  >,
});

describe("sop-engine · no fabricated coverage", () => {
  it("returns hasTemplate:false and NULL coverage when no template exists", () => {
    const report = compareToTemplate(project({}), null);
    expect(report.hasTemplate).toBe(false);
    // Critical: null, never 0 — a missing template is not 0% compliance.
    expect(report.overallCoverage).toBeNull();
    expect(report.phases).toEqual([]);
  });

  it("preserves the project's identity even with no template", () => {
    const report = compareToTemplate(project({}), null);
    expect(report.clientSlug).toBe("acme");
    expect(report.industryTemplate).toBe("generic");
  });
});

describe("sop-engine · empty template arithmetic", () => {
  it("reports 100% coverage for an empty template rather than dividing by zero", () => {
    const report = compareToTemplate(project({}), template({}));
    expect(report.hasTemplate).toBe(true);
    expect(report.overallCoverage).toBe(100);
    expect(Number.isNaN(report.overallCoverage)).toBe(false);
  });

  it("reports a phase with no template steps as 100% covered", () => {
    const report = compareToTemplate(project({ dev: [item("anything")] }), template({}));
    const dev = report.phases.find((p) => p.phase === "dev");
    expect(dev?.coverage).toBe(100);
    expect(dev?.templateStepCount).toBe(0);
  });
});

describe("sop-engine · mechanical normalization ONLY", () => {
  it("matches steps differing only by case and surrounding whitespace", () => {
    const report = compareToTemplate(
      project({ dev: [item("  REPO + Scaffold  ")] }),
      template({ dev: [item("Repo + scaffold")] })
    );
    const dev = report.phases.find((p) => p.phase === "dev");
    expect(dev?.presentCount).toBe(1);
    expect(dev?.missingSteps).toEqual([]);
  });

  it("collapses internal whitespace runs when matching", () => {
    const report = compareToTemplate(
      project({ dev: [item("Repo    +     scaffold")] }),
      template({ dev: [item("Repo + scaffold")] })
    );
    expect(report.phases.find((p) => p.phase === "dev")?.presentCount).toBe(1);
  });

  it("does NOT fuzzy-match a near-identical step — no NLP, no similarity scoring", () => {
    const report = compareToTemplate(
      project({ dev: [item("Repo and scaffold")] }),
      template({ dev: [item("Repo + scaffold")] })
    );
    const dev = report.phases.find((p) => p.phase === "dev");
    expect(dev?.presentCount).toBe(0);
    expect(dev?.missingSteps).toEqual(["Repo + scaffold"]);
    expect(dev?.extraSteps).toEqual(["Repo and scaffold"]);
  });
});

describe("sop-engine · missing / extra step accounting", () => {
  it("reports missing and extra steps as complementary sets", () => {
    const report = compareToTemplate(
      project({ launch: [item("Pre-launch QA"), item("Custom extra step")] }),
      template({ launch: [item("Pre-launch QA"), item("DNS cutover")] })
    );
    const launch = report.phases.find((p) => p.phase === "launch");
    expect(launch?.presentCount).toBe(1);
    expect(launch?.missingSteps).toEqual(["DNS cutover"]);
    expect(launch?.extraSteps).toEqual(["Custom extra step"]);
    expect(launch?.coverage).toBe(50);
  });

  it("reports the ORIGINAL template text for missing steps, not the normalized form", () => {
    const report = compareToTemplate(project({}), template({ dev: [item("  Mixed CASE Step  ")] }));
    expect(report.phases.find((p) => p.phase === "dev")?.missingSteps).toEqual(["  Mixed CASE Step  "]);
  });

  it("ignores the `done` flag — compliance is structural, not progress", () => {
    const a = compareToTemplate(
      project({ dev: [item("Step", true)] }),
      template({ dev: [item("Step")] })
    );
    const b = compareToTemplate(
      project({ dev: [item("Step", false)] }),
      template({ dev: [item("Step")] })
    );
    expect(a.phases).toEqual(b.phases);
  });
});

describe("sop-engine · full phase coverage", () => {
  it("emits a row for every PHASE_KEY even when the project omits phases", () => {
    const report = compareToTemplate(
      { clientSlug: "acme", industryTemplate: "generic", phases: [] },
      template({ dev: [item("Step")] })
    );
    expect(report.phases.map((p) => p.phase)).toEqual([...PHASE_KEYS]);
    expect(report.phases.find((p) => p.phase === "dev")?.missingSteps).toEqual(["Step"]);
  });

  it("computes overall coverage across all phases, not per-phase averaged", () => {
    // 1 of 2 dev steps + 0 of 2 launch steps = 1/4 = 25%
    const report = compareToTemplate(
      project({ dev: [item("A")] }),
      template({ dev: [item("A"), item("B")], launch: [item("C"), item("D")] })
    );
    expect(report.overallCoverage).toBe(25);
  });
});

describe("sop-engine · ownership boundary", () => {
  it("emits no score, priority, ranking, or recommendation field", () => {
    const report = compareToTemplate(project({ dev: [item("A")] }), template({ dev: [item("A")] }));
    const serialized = JSON.stringify(report).toLowerCase();
    for (const forbidden of ["score", "priority", "rank", "recommend", "severity", "action"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("sop-engine · determinism", () => {
  it("produces identical output for identical input", () => {
    const p = project({ dev: [item("A")], launch: [item("B")] });
    const t = template({ dev: [item("A"), item("C")] });
    expect(compareToTemplate(p, t)).toEqual(compareToTemplate(p, t));
  });
});