// Layer A — Sales Pipeline Funnel (Phase 11) contract tests.
//
// Frozen contract: funnel STRUCTURE only. Consumes the pre-derived Prospect score/tier and NEVER
// re-scores (computeScore stays the authority). Computes NO weighted-$ projection (that is
// Forecast). No ranking/priority/recommendation. Clock-free and deterministic.

import { describe, expect, it } from "vitest";
import { buildPipelineDigest, type PipelineProspectInput } from "@/engines/pipeline-engine";

const p = (status: string | undefined, score: number, tier: string): PipelineProspectInput => ({
  status,
  score,
  tier,
});

/** The five known funnel stages, in the engine's fixed presentation order. */
const KNOWN_STAGES = ["lead", "contacted", "proposal", "closed-won", "closed-lost"];

describe("pipeline-engine · gap visibility", () => {
  it("always emits all five known stages, even with no prospects at all", () => {
    const digest = buildPipelineDigest([]);
    expect(digest.stages.map((s) => s.status)).toEqual(KNOWN_STAGES);
    expect(digest.totalCount).toBe(0);
    expect(digest.openCount).toBe(0);
  });

  it("keeps an empty stage visible at count 0 rather than omitting it", () => {
    const digest = buildPipelineDigest([p("lead", 50, "warm")]);
    const proposal = digest.stages.find((s) => s.status === "proposal");
    expect(proposal).toBeDefined();
    expect(proposal?.count).toBe(0);
  });
});

describe("pipeline-engine · no fabricated values", () => {
  it("reports avgScore as null for an empty stage — never a fabricated 0", () => {
    const digest = buildPipelineDigest([p("lead", 80, "hot")]);
    expect(digest.stages.find((s) => s.status === "proposal")?.avgScore).toBeNull();
    expect(digest.stages.find((s) => s.status === "lead")?.avgScore).toBe(80);
  });

  it("reports share 0 rather than NaN when there are no prospects", () => {
    for (const stage of buildPipelineDigest([]).stages) {
      expect(stage.share).toBe(0);
      expect(Number.isNaN(stage.share)).toBe(false);
    }
  });
});

describe("pipeline-engine · PL-5 unknown status preservation", () => {
  it("preserves an unrecognised status as its own appended bucket", () => {
    const digest = buildPipelineDigest([p("negotiating", 60, "warm")]);
    expect(digest.stages.map((s) => s.status)).toContain("negotiating");
    // Known stages keep their fixed order first; unknowns are appended after them.
    expect(digest.stages.slice(0, 5).map((s) => s.status)).toEqual(KNOWN_STAGES);
  });

  it("maps a missing or blank status to the 'unknown' bucket without dropping the prospect", () => {
    const digest = buildPipelineDigest([p(undefined, 40, "cold"), p("   ", 20, "cold")]);
    expect(digest.totalCount).toBe(2);
    expect(digest.stages.find((s) => s.status === "unknown")?.count).toBe(2);
  });

  it("sorts multiple unknown buckets deterministically", () => {
    const digest = buildPipelineDigest([p("zeta", 1, "cold"), p("alpha", 1, "cold")]);
    const extra = digest.stages.slice(5).map((s) => s.status);
    expect(extra).toEqual([...extra].sort());
  });
});

describe("pipeline-engine · ownership: consumes score, never derives it", () => {
  it("passes the supplied score through untouched — proving no re-scoring occurs", () => {
    // A score computeScore could never produce. If the engine re-scored, this would change.
    const digest = buildPipelineDigest([p("lead", 4242, "hot")]);
    expect(digest.stages.find((s) => s.status === "lead")?.avgScore).toBe(4242);
  });

  it("treats a non-finite score as 0 contribution without crashing", () => {
    const digest = buildPipelineDigest([p("lead", Number.NaN, "hot"), p("lead", 100, "hot")]);
    expect(digest.stages.find((s) => s.status === "lead")?.avgScore).toBe(50);
  });

  it("emits no weighted-$ / projection field — that is Forecast's ownership", () => {
    const serialized = JSON.stringify(buildPipelineDigest([p("proposal", 90, "hot")])).toLowerCase();
    for (const forbidden of ["usd", "amount", "value", "weighted", "project", "revenue", "priority", "rank"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("pipeline-engine · counting", () => {
  it("counts only lead/contacted/proposal as open", () => {
    const digest = buildPipelineDigest([
      p("lead", 10, "cold"),
      p("contacted", 20, "warm"),
      p("proposal", 30, "hot"),
      p("closed-won", 40, "hot"),
      p("closed-lost", 50, "cold"),
    ]);
    expect(digest.openCount).toBe(3);
    expect(digest.totalCount).toBe(5);
  });

  it("counts hot and priority tiers as hot", () => {
    const digest = buildPipelineDigest([
      p("lead", 10, "hot"),
      p("lead", 10, "priority"),
      p("lead", 10, "cold"),
    ]);
    expect(digest.stages.find((s) => s.status === "lead")?.hotCount).toBe(2);
  });
});

describe("pipeline-engine · determinism", () => {
  it("produces identical output for identical input", () => {
    const input = [p("lead", 10, "cold"), p("weird", 20, "hot"), p(undefined, 30, "warm")];
    expect(buildPipelineDigest(input)).toEqual(buildPipelineDigest(input));
  });
});