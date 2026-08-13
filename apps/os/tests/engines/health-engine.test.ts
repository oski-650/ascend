// Layer A — Health scoring (Phase 2.5) contract tests.
//
// Frozen contract: a pure transform ProductionState + hours → HealthScore. No fs, no writes, no
// events, no recommendations, no cross-client ranking.
//
// ─── D2 RULING: DOCUMENTED COVERAGE GAP ─────────────────────────────────────────────────────────
// computeHealthScore(state, hoursLast7Days) reads `new Date()` INTERNALLY (index.ts, the
// daysToLaunch branch). It is the only engine without an injected clock.
//
// Per the D2 ruling the frozen signature is NOT changed and global time is NOT faked. Consequently
// every assertion below is restricted to the CLOCK-INDEPENDENT surface. The clock-dependent
// branches — daysToLaunch arithmetic, the `< 0` overdue case and the `< 14` crunch window — are
// deliberately left untested rather than asserted against a moving system clock, which would either
// be flaky or would silently encode today's date as a contract.
//
// The gap is instead defended two ways:
//   • the `describe.skip` block below names each uncovered branch explicitly, so the hole is visible
//     in test output rather than merely absent;
//   • Layer B rule F2/F6 prevents the engine's dependencies from expanding while it stays untested.
// Closing this gap properly requires an architectural ruling to inject a clock. Recorded as an
// open architectural-review item.

import { describe, expect, it } from "vitest";
import { computeHealthScore } from "@/engines/health-engine";
import type { ProductionState } from "@/core/production";
import { PHASE_KEYS, PHASE_LABEL, type PhaseKey, type PhaseStatus } from "@/domain";

/** Build a ProductionState with no launchTarget — keeping every case clock-independent. */
const state = (over: Partial<ProductionState> = {}): ProductionState => ({
  clientSlug: "acme",
  clientName: "Acme",
  industryTemplate: "generic",
  launchTarget: undefined, // absent ⇒ the schedule branch never reads the clock
  phases: PHASE_KEYS.map((key: PhaseKey) => ({
    key,
    label: PHASE_LABEL[key],
    status: "not_started" as PhaseStatus,
    checklist: [],
    progress: 0,
  })),
  overallProgress: 0,
  activePhaseIndex: 0,
  rawBody: "",
  ...over,
});

describe("health-engine · weighting (clock-independent)", () => {
  it("returns 0 for a project with no progress and no logged hours", () => {
    // progress 0 · momentum 0 · schedule 100 (no launchTarget) ⇒ 0*0.5 + 0*0.3 + 100*0.2 = 20
    const health = computeHealthScore(state({ overallProgress: 0 }), 0);
    expect(health.score).toBe(20);
    expect(health.breakdown).toEqual({ progress: 0, momentum: 0, schedule: 100 });
  });

  it("applies the fixed 50/30/20 weighting", () => {
    // progress 100 · momentum 100 (3h) · schedule 100 ⇒ 100
    expect(computeHealthScore(state({ overallProgress: 100 }), 3).score).toBe(100);
    // progress 100 only ⇒ 100*0.5 + 0*0.3 + 100*0.2 = 70
    expect(computeHealthScore(state({ overallProgress: 100 }), 0).score).toBe(70);
  });

  it("passes overallProgress through as the progress subscore unchanged", () => {
    expect(computeHealthScore(state({ overallProgress: 37 }), 0).breakdown.progress).toBe(37);
  });
});

describe("health-engine · momentum (clock-independent)", () => {
  it("awards full momentum at exactly the 3-hour threshold", () => {
    expect(computeHealthScore(state(), 3).breakdown.momentum).toBe(100);
  });

  it("scales momentum linearly below the threshold", () => {
    expect(computeHealthScore(state(), 1.5).breakdown.momentum).toBe(50);
    expect(computeHealthScore(state(), 0).breakdown.momentum).toBe(0);
  });

  it("caps momentum at 100 no matter how many hours are logged", () => {
    expect(computeHealthScore(state(), 100).breakdown.momentum).toBe(100);
  });
});

describe("health-engine · tier thresholds (clock-independent)", () => {
  it("uses ≥70 healthy, ≥40 on_track, else at_risk at exact boundaries", () => {
    // Drive the score purely via progress with no launchTarget and no hours.
    // score = progress*0.5 + 20
    expect(computeHealthScore(state({ overallProgress: 100 }), 0).score).toBe(70);
    expect(computeHealthScore(state({ overallProgress: 100 }), 0).tier).toBe("healthy");

    expect(computeHealthScore(state({ overallProgress: 40 }), 0).score).toBe(40);
    expect(computeHealthScore(state({ overallProgress: 40 }), 0).tier).toBe("on_track");

    expect(computeHealthScore(state({ overallProgress: 38 }), 0).score).toBe(39);
    expect(computeHealthScore(state({ overallProgress: 38 }), 0).tier).toBe("at_risk");
  });
});

describe("health-engine · schedule branch reachable without the clock", () => {
  it("scores schedule 100 and daysToLaunch null when no launchTarget exists", () => {
    const health = computeHealthScore(state({ launchTarget: undefined }), 0);
    expect(health.breakdown.schedule).toBe(100);
    expect(health.daysToLaunch).toBeNull();
  });

  it("ignores an unparseable launchTarget rather than producing NaN", () => {
    const health = computeHealthScore(state({ launchTarget: "not-a-date" }), 0);
    expect(health.breakdown.schedule).toBe(100);
    expect(health.daysToLaunch).toBeNull();
    expect(Number.isNaN(health.score)).toBe(false);
  });
});

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
  it.skip("scores schedule 100 with more than 14 days of runway", () => {});
});