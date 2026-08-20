// The retrospective utility experiment — docs/COGNITION-OBSERVATION.md §15.
//
// These tests assert the HARNESS is sound: eligibility matches what was pre-registered, both
// rankers see an identical candidate universe, and the whole thing is deterministic. They
// deliberately do NOT assert that cognition wins, because the pre-registration forbids the
// experiment having a required answer.
//
// The result itself is reported by `reportUtilityHarness` and read by a human. Three trials cannot
// validate cognition; this is harness validation.

import { describe, expect, it } from "vitest";
import { runUtilityHarness, K_VALUES } from "./utility-harness";
import { REAL_STREAM } from "./fixtures";
import { REAL_STRUCTURAL_RELATIONSHIPS } from "./fixtures-structural";

const report = () => runUtilityHarness(REAL_STREAM, REAL_STRUCTURAL_RELATIONSHIPS);

describe("utility harness · eligibility matches the pre-registration", () => {
  it("finds exactly the three genuine transitions recorded before the harness existed", () => {
    const result = report();
    expect(result.totalConsecutivePairs).toBe(9);
    expect(result.eligibleTrials).toBe(3);
    expect(result.excluded).toHaveLength(6);
  });

  it("excludes only self-repeats, and says so", () => {
    for (const excluded of report().excluded) {
      expect(excluded.from).toBe(excluded.to);
      expect(excluded.reason).toBe("self-repeat (subject unchanged)");
    }
  });

  it("never sets the truth equal to the seed on an eligible trial", () => {
    for (const trial of report().trials) expect(trial.truth).not.toBe(trial.seed);
  });

  it("does not expand the trial set — three is three", () => {
    // Widening eligibility after seeing the corpus would turn a pre-registered experiment into a
    // moving target. If three trials cannot distinguish anything, the answer is "inconclusive".
    expect(report().trials.map((t) => `${t.seed}->${t.truth}`)).toEqual([
      "project/tapia-tile-marble->project/decoraciones-pilar",
      "project/decoraciones-pilar->client/elite-vac-service",
      "client/elite-vac-service->project/elite-vac-service",
    ]);
  });
});

describe("utility harness · the comparison is fair", () => {
  it("gives every ranker an identical candidate universe", () => {
    // Otherwise cognition could win by retrieving a different candidate set rather than by ranking
    // a shared one better.
    for (const trial of report().trials) {
      const ranks = trial.rankers.map((r) => r.rankOfTruth);
      // Every ranker either places the truth somewhere, or none of them can.
      expect(new Set(ranks.map((r) => r === null)).size).toBe(1);
      expect(trial.candidateUniverse).toBeGreaterThan(0);
    }
  });

  it("never lets a ranker score a truth that is outside the universe", () => {
    for (const trial of report().trials) {
      if (trial.truthInUniverse) continue;
      for (const ranker of trial.rankers) {
        expect(ranker.rankOfTruth).toBeNull();
        for (const k of K_VALUES) expect(ranker.hitAtK[k]).toBe(false);
      }
    }
  });

  it("excludes the seed from the universe for every ranker equally", () => {
    for (const trial of report().trials) {
      for (const ranker of trial.rankers) expect(ranker.topFive).not.toContain(trial.seed);
    }
  });

  it("reports ties, so a hit inside a large tie is not mistaken for a ranking", () => {
    for (const trial of report().trials) {
      for (const ranker of trial.rankers) {
        expect(ranker.tiedWithTruth).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("runs all three pre-declared rankers, including two cognitive ones", () => {
    // Cognition emits no combined scalar by design, so a single "cognitive ranking" does not exist.
    // Both orderings were declared in advance; neither is selected after the fact.
    for (const trial of report().trials) {
      expect(trial.rankers.map((r) => r.ranker)).toEqual([
        "COG-A structural-first",
        "COG-B learned-first",
        "BASELINE recency",
      ]);
    }
  });
});

describe("utility harness · determinism", () => {
  it("is byte-identical across runs", () => {
    expect(JSON.stringify(report())).toBe(JSON.stringify(report()));
  });

  it("evaluates each trial as of the seed event, never as of today", () => {
    // Folding with today's clock would leak the future into a retrospective prediction.
    const result = report();
    expect(result.trials.every((t) => t.associationsAtTime >= 0)).toBe(true);
    expect(result.trials[0].associationsAtTime).toBe(0);
  });

  it("produces exactly one of the three legitimate outcomes", () => {
    expect(["fails", "beats", "inconclusive"]).toContain(report().outcome);
    expect(report().killConditionTriggered).toBe(report().outcome === "fails");
  });
});
