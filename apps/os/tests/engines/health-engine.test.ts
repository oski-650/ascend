// Layer A — Health scoring contract tests.
//
// Frozen contract: a pure transform ProductionState + hours → HealthScore. No fs, no writes, no
// events, no recommendations, no cross-client ranking.
//
// ─── THIS FILE IS THE SPECIFICATION OF THE UNKNOWN-SAFE SEMANTICS ───────────────────────────────
// docs/HISTORICAL-BACKFILL-H4.md §1 and §5. `null` means "insufficient evidence to calculate" —
// never 0, never "fine". The previous suite asserted the OPPOSITE in two places, and those
// assertions were the defect rather than a description of it:
//
//   • `breakdown.schedule` was expected to be 100 when no launchTarget existed — a project with no
//     deadline scored full marks for being on schedule. It was two-thirds of Elite Vac's score.
//   • a project with no progress and no hours was expected to score 20 rather than refuse to score.
//
// ─── D2 RULING: DOCUMENTED COVERAGE GAP ─────────────────────────────────────────────────────────
// computeHealthScore reads `new Date()` INTERNALLY. Per the D2 ruling the signature is NOT changed
// and global time is NOT faked. Fixtures needing a live target therefore compute it RELATIVE to now
// (never a hardcoded date, which would encode today as a contract and rot). The genuinely
// clock-dependent thresholds stay in the skip block below, unchanged in scope by this work.

import { describe, expect, it } from "vitest";
import { computeHealthScore } from "@/engines/health-engine";
import type { Phase, ProductionState } from "@/core/production";
import { PHASE_KEYS, PHASE_LABEL, type PhaseKey, type PhaseStatus } from "@/domain";

const phasesWith = (status: PhaseStatus, progress: number | null): Phase[] =>
  PHASE_KEYS.map((key: PhaseKey) => ({
    key,
    label: PHASE_LABEL[key],
    status,
    checklist: [],
    progress,
  }));

/** Default fixture: no launchTarget, so the schedule branch never reads the clock. */
const state = (over: Partial<ProductionState> = {}): ProductionState => ({
  clientSlug: "acme",
  clientName: "Acme",
  industryTemplate: "generic",
  launchTarget: undefined,
  phases: phasesWith("not_started", 0),
  overallProgress: 0,
  activePhaseIndex: 0,
  phaseState: "in_flight",
  rawBody: "",
  ...over,
});

/** A launch target N days out, derived from the live clock so the fixture cannot rot. */
const targetInDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// ─── The repair ────────────────────────────────────────────────────────────────────────────────

describe("health-engine · no schedule is not on schedule", () => {
  it("scores schedule null — not 100 — when no launchTarget exists", () => {
    const health = computeHealthScore(state({ launchTarget: undefined }), 0);
    expect(health.breakdown.schedule).toBeNull();
    expect(health.daysToLaunch).toBeNull();
  });

  it("refuses to score at all when there is no schedule to judge against", () => {
    const health = computeHealthScore(state({ overallProgress: 0 }), 0);
    expect(health.score).toBeNull();
    expect(health.tier).toBeNull();
  });

  it("treats an unparseable launchTarget as absent rather than producing NaN", () => {
    const health = computeHealthScore(state({ launchTarget: "not-a-date" }), 0);
    expect(health.breakdown.schedule).toBeNull();
    expect(health.daysToLaunch).toBeNull();
    expect(health.score).toBeNull();
  });
});

describe("health-engine · unknown progress propagates as null", () => {
  const unknownProgress = state({
    phases: phasesWith("unknown", null),
    overallProgress: null,
    activePhaseIndex: null,
    phaseState: "indeterminate",
    launchTarget: targetInDays(30),
  });

  it("passes a null overallProgress through as a null progress subscore", () => {
    expect(computeHealthScore(unknownProgress, 0).breakdown.progress).toBeNull();
  });

  it("nulls the score and tier rather than coercing unknown progress to zero", () => {
    const health = computeHealthScore(unknownProgress, 0);
    expect(health.score).toBeNull();
    expect(health.tier).toBeNull();
  });

  it("nulls schedule when progress is unknown, even with a live launch target", () => {
    // "past target and incomplete" is indistinguishable from "past target and delivered".
    expect(computeHealthScore(unknownProgress, 0).breakdown.schedule).toBeNull();
  });

  it("never reports at_risk for a project it cannot score", () => {
    expect(computeHealthScore(unknownProgress, 0).tier).not.toBe("at_risk");
  });
});

describe("health-engine · independent evidence survives unknown history", () => {
  const unknown = state({
    phases: phasesWith("unknown", null),
    overallProgress: null,
    activePhaseIndex: null,
    phaseState: "indeterminate",
    launchTarget: targetInDays(30),
  });

  it("keeps momentum — it reads the time log, which does not depend on phase history", () => {
    expect(computeHealthScore(unknown, 3).breakdown.momentum).toBe(100);
    expect(computeHealthScore(unknown, 1.5).breakdown.momentum).toBe(50);
    expect(computeHealthScore(unknown, 0).breakdown.momentum).toBe(0);
  });

  it("keeps daysToLaunch — pure date arithmetic against the target", () => {
    expect(computeHealthScore(unknown, 0).daysToLaunch).not.toBeNull();
  });
});

// ─── Weighting, exercised where a score is legitimately computable ─────────────────────────────

describe("health-engine · weighting", () => {
  const scorable = (overallProgress: number) =>
    state({
      overallProgress,
      phases: phasesWith("in_progress", overallProgress),
      launchTarget: targetInDays(60), // > 14 days out ⇒ schedule 100, no crunch branch
    });

  it("applies the fixed 50/30/20 weighting", () => {
    expect(computeHealthScore(scorable(100), 3).score).toBe(100);
    expect(computeHealthScore(scorable(100), 0).score).toBe(70);
  });

  it("passes overallProgress through as the progress subscore unchanged", () => {
    expect(computeHealthScore(scorable(37), 0).breakdown.progress).toBe(37);
  });

  it("does NOT renormalise the weights when a term is missing", () => {
    // Renormalising progress+momentum over 0.8 would yield a number here. A missing term makes the
    // whole sum missing — otherwise the metric silently changes meaning (H2 §4, rejected option C).
    const health = computeHealthScore(
      state({ overallProgress: null, phases: phasesWith("unknown", null), launchTarget: targetInDays(60) }),
      3
    );
    expect(health.breakdown.momentum).toBe(100);
    expect(health.score).toBeNull();
  });

  it("caps momentum at 100 no matter how many hours are logged", () => {
    expect(computeHealthScore(scorable(50), 100).breakdown.momentum).toBe(100);
  });
});

describe("health-engine · tier thresholds", () => {
  const scorable = (overallProgress: number) =>
    state({
      overallProgress,
      phases: phasesWith("in_progress", overallProgress),
      launchTarget: targetInDays(60),
    });

  it("uses >=70 healthy, >=40 on_track, else at_risk at exact boundaries", () => {
    // score = progress*0.5 + 20 (momentum 0, schedule 100)
    expect(computeHealthScore(scorable(100), 0).score).toBe(70);
    expect(computeHealthScore(scorable(100), 0).tier).toBe("healthy");

    expect(computeHealthScore(scorable(40), 0).score).toBe(40);
    expect(computeHealthScore(scorable(40), 0).tier).toBe("on_track");

    expect(computeHealthScore(scorable(38), 0).score).toBe(39);
    expect(computeHealthScore(scorable(38), 0).tier).toBe("at_risk");
  });
});

// ─── The H4 §8 acceptance fixtures, from real vault state ──────────────────────────────────────

describe("health-engine · acceptance fixtures (docs/HISTORICAL-BACKFILL-H4.md §8)", () => {
  it("Elite Vac: launch complete, four phases unknown, no target ⇒ nothing asserted", () => {
    // BEFORE the repair this scored 30 / at_risk: progress 20 (four not_started phases counted as
    // genuine zeros) + schedule 100 (no launch target counted as on schedule).
    const eliteVac = state({
      clientSlug: "elite-vac-service",
      clientName: "Elite Vac Service",
      phases: PHASE_KEYS.map((key) => {
        const launched = key === "launch";
        return {
          key,
          label: PHASE_LABEL[key],
          status: (launched ? "complete" : "unknown") as PhaseStatus,
          checklist: [],
          progress: launched ? 100 : null,
        };
      }),
      overallProgress: null,
      activePhaseIndex: null,
      phaseState: "indeterminate",
      launchTarget: "",
    });

    const health = computeHealthScore(eliteVac, 0);
    expect(health.score).toBeNull();
    expect(health.tier).toBeNull();
    expect(health.breakdown.progress).toBeNull();
    expect(health.breakdown.schedule).toBeNull();
    expect(health.breakdown.momentum).toBe(0); // true statement about the time log
  });

  it("Tapia: all phases seeded-then-unknown, seeded target removed ⇒ nothing asserted", () => {
    // BEFORE the repair this scored 25 / at_risk and drove two URGENT signals about a delivered,
    // fully-paid site. The launch target was itself scaffold-authored, so it demotes too.
    const tapia = state({
      clientSlug: "tapia-tile-marble",
      clientName: "Tapia Tile & Marble Co.",
      phases: phasesWith("unknown", null),
      overallProgress: null,
      activePhaseIndex: null,
      phaseState: "indeterminate",
      launchTarget: undefined,
    });

    const health = computeHealthScore(tapia, 0);
    expect(health.score).toBeNull();
    expect(health.tier).toBeNull();
    expect(health.daysToLaunch).toBeNull();
  });
});

// ─── Boundaries preserved ──────────────────────────────────────────────────────────────────────

describe("health-engine · ownership boundary", () => {
  it("returns only scoring fields — no recommendation, action, or cross-client rank", () => {
    const health = computeHealthScore(state({ overallProgress: 50 }), 1);
    expect(Object.keys(health).sort()).toEqual(["breakdown", "daysToLaunch", "score", "tier"].sort());
    const serialized = JSON.stringify(health).toLowerCase();
    for (const forbidden of ["recommend", "action", "priority", "rank", "opportunity"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not mutate the ProductionState it is given", () => {
    const input = state({ overallProgress: 50 });
    const snapshot = structuredClone(input);
    computeHealthScore(input, 2);
    expect(input).toEqual(snapshot);
  });
});

describe("health-engine · determinism on the clock-independent surface", () => {
  it("produces identical output for identical input when no launchTarget is set", () => {
    const input = state({ overallProgress: 60 });
    expect(computeHealthScore(input, 2)).toEqual(computeHealthScore(input, 2));
  });
});

// ─── Explicitly uncovered: requires an architectural ruling to inject a clock (D2) ──────────────
describe.skip("health-engine · clock-dependent branches [COVERAGE GAP — needs clock injection]", () => {
  it.skip("computes daysToLaunch relative to an injected now", () => {});
  it.skip("scores schedule 0 when past the launch target and incomplete", () => {});
  it.skip("scores schedule 50 inside the 14-day crunch window", () => {});
  it.skip("scores schedule 100 when overallProgress is 100 despite an overdue target", () => {});
});