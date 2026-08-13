// Layer A — Decision / ranking (Part V §V.3) contract tests.
//
// Frozen contract: Decision owns the COMPLETE ranking strategy end-to-end. Weighting, ordering, and
// whether/how signals collapse per subject are INTERNAL implementation details, never part of the
// contract. It computes NO business facts (no health scoring, opportunity detection, finance metrics,
// EHR, invoice/project status). `priorityScore` is a RANKING WEIGHT, not a business metric.
// PURE: no fs, no reads, no writes, no events, no cache.
//
// These tests deliberately assert OBSERVABLE contract behaviour (one item per subject, dense 1-based
// ranks, deterministic tie-break, evidence preserved) rather than specific weight numbers, which the
// contract explicitly reserves as private.

import { describe, expect, it } from "vitest";
import { rank, type RankableSignal } from "@/engines/decision-engine";
import type { Severity } from "@/domain";

const signal = (over: Partial<RankableSignal> & { subjectId: string }): RankableSignal => ({
  source: "opportunity",
  subject: { entity: "client", id: over.subjectId, name: over.subjectId },
  kind: "test_kind",
  evidence: { source: "opportunity", detail: `detail for ${over.subjectId}` },
  ...over,
});

describe("decision-engine · empty", () => {
  it("returns an empty ranking for no signals", () => {
    expect(rank([])).toEqual([]);
  });
});

describe("decision-engine · rank numbering", () => {
  it("produces dense, 1-based, ascending ranks", () => {
    const items = rank([
      signal({ subjectId: "a", severity: "urgent" as Severity }),
      signal({ subjectId: "b", severity: "suggest" as Severity }),
      signal({ subjectId: "c", severity: "info" as Severity }),
    ]);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
  });
});

describe("decision-engine · per-subject collapse (observable behaviour)", () => {
  it("emits exactly one item per distinct subject", () => {
    const items = rank([
      signal({ subjectId: "acme", source: "health", tier: "at_risk" }),
      signal({ subjectId: "acme", source: "opportunity", severity: "suggest" as Severity }),
      signal({ subjectId: "other", source: "health", tier: "healthy" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.subject.id).sort()).toEqual(["acme", "other"]);
  });

  it("treats the same id under different entity types as distinct subjects", () => {
    const items = rank([
      { ...signal({ subjectId: "x" }), subject: { entity: "client", id: "x", name: "X" } },
      { ...signal({ subjectId: "x" }), subject: { entity: "prospect", id: "x", name: "X" } },
    ]);
    expect(items).toHaveLength(2);
  });

  it("accumulates evidence from every collapsed signal", () => {
    const items = rank([
      signal({ subjectId: "acme", evidence: { source: "health", detail: "first" } }),
      signal({ subjectId: "acme", evidence: { source: "opportunity", detail: "second" } }),
    ]);
    expect(items[0].evidence).toHaveLength(2);
    const details = items[0].evidence.map((e) => e.detail);
    expect(details).toContain("first");
    expect(details).toContain("second");
  });
});

describe("decision-engine · deterministic ordering", () => {
  it("breaks a weight tie by subject name ascending", () => {
    // Identical source+severity ⇒ identical internal weight ⇒ name decides.
    const items = rank([
      { ...signal({ subjectId: "z" }), subject: { entity: "client", id: "z", name: "Zeta" }, severity: "urgent" as Severity },
      { ...signal({ subjectId: "a" }), subject: { entity: "client", id: "a", name: "Alpha" }, severity: "urgent" as Severity },
    ]);
    expect(items.map((i) => i.subject.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("is stable across input permutations of equally weighted signals", () => {
    const a = { ...signal({ subjectId: "a" }), subject: { entity: "client" as const, id: "a", name: "Alpha" }, severity: "suggest" as Severity };
    const b = { ...signal({ subjectId: "b" }), subject: { entity: "client" as const, id: "b", name: "Beta" }, severity: "suggest" as Severity };
    expect(rank([a, b]).map((i) => i.subject.name)).toEqual(rank([b, a]).map((i) => i.subject.name));
  });

  it("ranks a higher-severity subject above a lower-severity one", () => {
    const items = rank([
      { ...signal({ subjectId: "low" }), subject: { entity: "client", id: "low", name: "AAA-low" }, severity: "info" as Severity },
      { ...signal({ subjectId: "high" }), subject: { entity: "client", id: "high", name: "ZZZ-high" }, severity: "urgent" as Severity },
    ]);
    // Name order would put AAA-low first; severity must dominate.
    expect(items[0].subject.id).toBe("high");
  });
});

describe("decision-engine · unknown producers degrade safely", () => {
  it("ranks a signal from an unrecognised source without crashing", () => {
    const items = rank([signal({ subjectId: "a", source: "some-future-engine" })]);
    expect(items).toHaveLength(1);
    expect(items[0].rank).toBe(1);
  });
});

describe("decision-engine · ownership: computes no business facts", () => {
  it("exposes only ranking fields on a PriorityItem", () => {
    const items = rank([signal({ subjectId: "acme", source: "health", tier: "at_risk", score: 12 })]);
    // `recommendedActionRef` is always keyed (undefined when the producer supplied no actionRef);
    // the contract point is that NO business-fact field appears alongside these.
    expect(Object.keys(items[0]).sort()).toEqual(
      ["evidence", "explanation", "priorityScore", "rank", "recommendedActionRef", "subject"].sort()
    );
  });

  it("does not surface a producer's business score as its own output field", () => {
    const items = rank([signal({ subjectId: "acme", source: "health", tier: "at_risk", score: 12 })]);
    // The health score (12) must not leak out as a Decision-owned metric.
    expect(items[0]).not.toHaveProperty("score");
    expect(items[0]).not.toHaveProperty("tier");
    expect(items[0]).not.toHaveProperty("health");
  });

  it("carries a recommendedActionRef only as an opaque reference, never an executed action", () => {
    const items = rank([
      signal({ subjectId: "acme", actionRef: { source: "opportunity", ref: "opp-1" } }),
    ]);
    expect(items[0].recommendedActionRef).toEqual({ source: "opportunity", ref: "opp-1" });
  });
});

describe("decision-engine · purity", () => {
  it("does not mutate its input array or signals", () => {
    const input = [signal({ subjectId: "a" }), signal({ subjectId: "b" })];
    const snapshot = structuredClone(input);
    rank(input);
    expect(input).toEqual(snapshot);
  });

  it("produces identical output for identical input (no hidden cache/state)", () => {
    const input = [signal({ subjectId: "a", severity: "urgent" as Severity }), signal({ subjectId: "b" })];
    expect(rank(input)).toEqual(rank(input));
  });
});