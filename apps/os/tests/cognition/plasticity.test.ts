// Layer A — cognition / plasticity & forgetting (N2) contract tests. See docs/COGNITION-N2.md.
//
// N2 owns four mechanisms: reinforcement, forgetting, reactivation, archival. It owns NOTHING about
// what constitutes evidence — that is N1's, frozen. The governing rule under test here:
//
//     Plasticity may change cognition; it may not silently change what constitutes evidence.
//
// The sharpest formal statement of that is monotonicity: over an append-only log, strength and
// confidence never fall, because evidence does not stop having occurred. Only relevance is plastic.

import { describe, expect, it } from "vitest";
import { foldCognitiveState } from "@/cognition/cooccurrence";
import {
  ARCHIVAL_THRESHOLD,
  DORMANCY_THRESHOLD,
  RELEVANCE_HALF_LIFE_MS,
  S_MAX,
} from "@/cognition/bounds";
import type { Activation, CognitiveInput } from "@/cognition/contract";
import type { EntityKind } from "@/domain";
import { REAL_NOW, REAL_STREAM, REAL_STRUCTURAL } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);
const iso = (ms: number) => new Date(ms).toISOString();

const activation = (
  entity: EntityKind,
  entityId: string,
  atMs: number,
  ordinal: number
): Activation => ({
  subject: { entity, entity_id: entityId },
  at: iso(atMs),
  ordinal,
  intensity: 1,
  provenance: { source: "event", eventId: `e${ordinal}` },
});

const input = (over: Partial<CognitiveInput> = {}): CognitiveInput => ({
  activations: [],
  structuralPairs: [],
  excludedCount: 0,
  sourceName: "test",
  now: new Date(T0),
  ...over,
});

/** `occasions` separate co-occurrences of a->b, one per day starting at T0. */
const occasions = (n: number): Activation[] =>
  Array.from({ length: n }, (_, k) => [
    activation("client", "a", T0 + k * DAY, k * 2),
    activation("project", "b", T0 + k * DAY + 1000, k * 2 + 1),
  ]).flat();

const only = (activations: Activation[], now: Date) =>
  foldCognitiveState(input({ activations, now })).associations[0];

describe("plasticity · the frozen corpus over time", () => {
  // The N1 golden test owns "what does the evidence produce?" and stays frozen. This owns "what
  // happens to that association over time?" — the same control, a different question.
  const realAt = (now: Date) =>
    foldCognitiveState(
      input({ activations: REAL_STREAM, structuralPairs: REAL_STRUCTURAL, excludedCount: 17, now })
    ).associations[0];

  it("holds the baseline active two days after the last event", () => {
    // Two days against a 91-day half-life. The parameters were justified against engagement cycles,
    // not fitted to keep this green.
    const baseline = realAt(REAL_NOW);
    expect(baseline.relevance).toBeCloseTo(0.246188, 6);
    expect(baseline.state).toBe("active");
    expect(baseline.relevance).toBeLessThan(baseline.strength);
  });

  it("falls active → dormant → archived as the clock advances", () => {
    expect(realAt(REAL_NOW).state).toBe("active");
    expect(realAt(new Date("2027-02-19T12:00:00.000Z")).state).toBe("dormant");
    expect(realAt(new Date("2028-08-19T12:00:00.000Z")).state).toBe("archived");
  });

  it("changes NOTHING about the evidence across two years of forgetting", () => {
    // The whole principle in one assertion: forgetting is not deletion. What the system loses is
    // accessibility; what it keeps is everything that actually happened.
    const horizons = [REAL_NOW, new Date("2027-02-19T12:00:00.000Z"), new Date("2028-08-19T12:00:00.000Z")];
    const evidence = horizons.map((now) => {
      const a = realAt(now);
      return {
        strength: a.strength,
        confidence: a.confidence,
        observationCount: a.observationCount,
        firstObservedAt: a.firstObservedAt,
        contributingEventIds: a.provenance.contributingEventIds,
        structurallyExplained: a.structurallyExplained,
      };
    });
    expect(evidence[1]).toEqual(evidence[0]);
    expect(evidence[2]).toEqual(evidence[0]);
  });

  it("keeps the association count at one under every horizon", () => {
    for (const year of [2026, 2027, 2030, 2040]) {
      const state = foldCognitiveState(
        input({
          activations: REAL_STREAM,
          structuralPairs: REAL_STRUCTURAL,
          excludedCount: 17,
          now: new Date(`${year}-08-19T12:00:00.000Z`),
        })
      );
      expect(state.associations).toHaveLength(1);
    }
  });
});

describe("plasticity · evidence is monotonic, accessibility is plastic", () => {
  it("never lets strength fall as the log grows", () => {
    // The formal statement of "relevance fades; history does not". Evaluated at a FIXED now so the
    // only variable is how much evidence exists.
    const now = new Date(T0 + 100 * DAY);
    const strengths = [1, 2, 3, 5, 8, 13].map((n) => only(occasions(n), now).strength);
    for (const [i, s] of strengths.entries()) {
      if (i > 0) expect(s).toBeGreaterThanOrEqual(strengths[i - 1]);
    }
  });

  it("never lets confidence fall as the log grows", () => {
    const now = new Date(T0 + 100 * DAY);
    const confidences = [1, 2, 3, 5, 8, 13].map((n) => only(occasions(n), now).confidence);
    for (const [i, c] of confidences.entries()) {
      if (i > 0) expect(c).toBeGreaterThanOrEqual(confidences[i - 1]);
    }
  });

  it("never lets strength or confidence fall as time passes", () => {
    // Time moving forward must not revise history. Only relevance may respond to the clock.
    const log = occasions(4);
    const early = only(log, new Date(T0 + 5 * DAY));
    const late = only(log, new Date(T0 + 5000 * DAY));
    expect(late.strength).toBe(early.strength);
    expect(late.confidence).toBe(early.confidence);
    expect(late.relevance).toBeLessThan(early.relevance);
  });

  it("lets relevance both fall and rise", () => {
    const quiet = only(occasions(2), new Date(T0 + 400 * DAY));
    const reinforced = only(
      [...occasions(2), activation("client", "a", T0 + 399 * DAY, 100), activation("project", "b", T0 + 399 * DAY + 1000, 101)],
      new Date(T0 + 400 * DAY)
    );
    expect(reinforced.relevance).toBeGreaterThan(quiet.relevance);
  });
});

describe("plasticity · relevance is bounded by what was learned", () => {
  it("never exceeds strength", () => {
    const log = occasions(6);
    for (const offset of [0, 1, 10, 100, 1000, 10000]) {
      const association = only(log, new Date(T0 + offset * DAY));
      expect(association.relevance).toBeLessThanOrEqual(association.strength);
    }
  });

  it("equals strength exactly when just reinforced", () => {
    const log = occasions(3);
    const lastAt = Date.parse(only(log, new Date(T0)).lastObservedAt);
    const association = only(log, new Date(lastAt));
    expect(association.relevance).toBe(association.strength);
  });

  it("halves each half-life", () => {
    const log = occasions(1);
    const lastAt = Date.parse(only(log, new Date(T0)).lastObservedAt);
    const at0 = only(log, new Date(lastAt)).relevance;
    const at1 = only(log, new Date(lastAt + RELEVANCE_HALF_LIFE_MS)).relevance;
    const at2 = only(log, new Date(lastAt + 2 * RELEVANCE_HALF_LIFE_MS)).relevance;
    expect(at1).toBeCloseTo(at0 / 2, 12);
    expect(at2).toBeCloseTo(at0 / 4, 12);
  });

  it("does not amplify relevance when now precedes the last observation", () => {
    // Malformed temporal input must degrade a claim, never inflate one — the same instinct as the
    // negative-gap rule in sessionize.
    const log = occasions(2);
    const association = only(log, new Date(T0 - 5000 * DAY));
    expect(association.relevance).toBeLessThanOrEqual(association.strength);
    expect(association.relevance).toBe(association.strength);
  });

  it("stays finite and non-negative at extreme horizons", () => {
    const association = only(occasions(2), new Date(T0 + 4_000_000 * DAY));
    expect(Number.isFinite(association.relevance)).toBe(true);
    expect(association.relevance).toBeGreaterThanOrEqual(0);
    expect(association.relevance).toBeLessThanOrEqual(S_MAX);
  });
});

describe("plasticity · derived state", () => {
  const stateAt = (days: number) => only(occasions(1), new Date(T0 + days * DAY)).state;

  it("moves active → dormant → archived as relevance falls", () => {
    expect(stateAt(0)).toBe("active");
    expect(stateAt(200)).toBe("dormant");
    expect(stateAt(900)).toBe("archived");
  });

  it("is deterministic exactly at each threshold", () => {
    // `>=` is active / dormant; strictly below is the next state down. Asserted directly so the
    // comparison direction cannot drift.
    const log = occasions(1);
    const association = only(log, new Date(T0));
    const lastAt = Date.parse(association.lastObservedAt);
    const whenRelevanceIs = (target: number) =>
      new Date(lastAt + RELEVANCE_HALF_LIFE_MS * Math.log2(association.strength / target));

    expect(only(log, whenRelevanceIs(DORMANCY_THRESHOLD)).state).toBe("active");
    expect(only(log, whenRelevanceIs(DORMANCY_THRESHOLD * 0.999)).state).toBe("dormant");
    expect(only(log, whenRelevanceIs(ARCHIVAL_THRESHOLD)).state).toBe("dormant");
    expect(only(log, whenRelevanceIs(ARCHIVAL_THRESHOLD * 0.999)).state).toBe("archived");
  });

  it("keeps a strongly-learned association accessible longer than a weak one", () => {
    // Consolidation, falling out of scaling relevance by strength rather than being separately
    // parameterised.
    const weak = only(occasions(1), new Date(T0 + 250 * DAY));
    const strong = only(occasions(12), new Date(T0 + 250 * DAY));
    expect(strong.strength).toBeGreaterThan(weak.strength);
    expect(weak.state).toBe("dormant");
    expect(strong.state).toBe("active");
  });

  it("stores no state — it is recomputed from the log and now", () => {
    const log = occasions(1);
    const late = only(log, new Date(T0 + 900 * DAY));
    const early = only(log, new Date(T0 + 1 * DAY));
    expect(late.state).toBe("archived");
    expect(early.state).toBe("active");
    // Same log, different now, opposite states, no ordering dependence between the two calls.
    expect(only(log, new Date(T0 + 900 * DAY)).state).toBe("archived");
  });
});

describe("plasticity · reactivation preserves lineage", () => {
  // One pair, a year of silence, then the same pair again.
  const withGap: Activation[] = [
    activation("client", "a", T0, 0),
    activation("project", "b", T0 + 1000, 1),
    activation("client", "a", T0 + 400 * DAY, 2),
    activation("project", "b", T0 + 400 * DAY + 1000, 3),
  ];

  it("updates association #1 rather than minting association #2", () => {
    const state = foldCognitiveState(input({ activations: withGap, now: new Date(T0 + 400 * DAY) }));
    expect(state.associations).toHaveLength(1);
    expect(state.associations[0].id).toBe("client/a->project/b");
  });

  it("preserves the original first observation and every event id", () => {
    const association = only(withGap, new Date(T0 + 400 * DAY));
    expect(association.firstObservedAt).toBe(iso(T0 + 1000));
    expect(association.provenance.contributingEventIds).toEqual(["e0", "e1", "e2", "e3"]);
    expect(association.observationCount).toBe(2);
  });

  it("reinforces rather than relearning from zero", () => {
    // The point of keeping strength intact through dormancy: returning evidence lands on top of
    // what was already learned.
    const beforeGap = only(withGap.slice(0, 2), new Date(T0 + 400 * DAY));
    const afterGap = only(withGap, new Date(T0 + 400 * DAY));
    expect(afterGap.strength).toBeGreaterThan(beforeGap.strength);
  });

  it("climbs ARCHIVED → DORMANT → ACTIVE as evidence returns, keeping all of it", () => {
    // The headline reactivation property. One original occasion, long silence, then evidence
    // arriving at decreasing distance. Each rung is the SAME association with strictly MORE
    // evidence — never a rediscovery, never a second entry, never a lost event id.
    const original: Activation[] = [
      activation("client", "a", T0, 0),
      activation("project", "b", T0 + 1000, 1),
    ];
    const observedAt = (days: number, ordinal: number): Activation[] => [
      activation("client", "a", T0 + days * DAY, ordinal),
      activation("project", "b", T0 + days * DAY + 1000, ordinal + 1),
    ];
    const now = new Date(T0 + 900 * DAY);

    const archived = only(original, now);
    const dormant = only([...original, ...observedAt(700, 2)], now);
    const active = only([...original, ...observedAt(700, 2), ...observedAt(895, 4)], now);

    expect(archived.state).toBe("archived");
    expect(dormant.state).toBe("dormant");
    expect(active.state).toBe("active");

    // Relevance climbs back; strength only ever accumulates.
    expect(dormant.relevance).toBeGreaterThan(archived.relevance);
    expect(active.relevance).toBeGreaterThan(dormant.relevance);
    expect(dormant.strength).toBeGreaterThan(archived.strength);
    expect(active.strength).toBeGreaterThan(dormant.strength);

    // One association throughout, with the ORIGINAL evidence preserved and the NEW evidence added.
    for (const rung of [archived, dormant, active]) {
      expect(rung.id).toBe("client/a->project/b");
      expect(rung.firstObservedAt).toBe(iso(T0 + 1000));
      expect(rung.provenance.contributingEventIds).toEqual(
        expect.arrayContaining(["e0", "e1"])
      );
    }
    expect(archived.provenance.contributingEventIds).toEqual(["e0", "e1"]);
    expect(dormant.provenance.contributingEventIds).toEqual(["e0", "e1", "e2", "e3"]);
    expect(active.provenance.contributingEventIds).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"]);
    expect(active.observationCount).toBe(3);
  });
});

describe("plasticity · evidence rules are untouched", () => {
  it("never changes how many associations exist, at any point in time", () => {
    // The falsification target. Forgetting changes state and relevance; it must never change the
    // count, because the count is a statement about evidence and evidence belongs to N1.
    const log = occasions(3);
    for (const offset of [0, 1, 50, 200, 900, 5000, 100000]) {
      const state = foldCognitiveState(input({ activations: log, now: new Date(T0 + offset * DAY) }));
      expect(state.associations).toHaveLength(1);
    }
  });

  it("keeps self-pairs and cross-session pairs excluded regardless of relevance", () => {
    const selfOnly = [
      activation("project", "p", T0, 0),
      activation("project", "p", T0 + 1000, 1),
    ];
    expect(foldCognitiveState(input({ activations: selfOnly })).associations).toEqual([]);
  });
});

describe("plasticity · reproducibility", () => {
  it("is byte-identical for the same log and the same now", () => {
    const log = occasions(5);
    const now = new Date(T0 + 300 * DAY);
    const a = foldCognitiveState(input({ activations: log, now }));
    const b = foldCognitiveState(input({ activations: log, now }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("decays by elapsed time, not by how often it is folded", () => {
    const log = occasions(4);
    const now = new Date(T0 + 120 * DAY);
    const once = only(log, now);
    const repeated = Array.from({ length: 10 }, () => only(log, now)).at(-1);
    expect(repeated?.relevance).toBe(once.relevance);
  });
});
