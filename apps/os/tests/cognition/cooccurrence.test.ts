// Layer A — cognition / co-occurrence (N1) contract tests. See docs/COGNITION-N1.md.
//
// Frozen contract: a PURE fold from an activation stream to a CognitiveState. Answers "what tends
// to co-occur?" — never "what is connected?" (structural), "what is currently salient?"
// (propagation, N5), or "what should we do?" (Decision). `now` is INJECTED. No clock, no
// randomness, no fs, no writes, no events.
//
// The headline assertion is the golden test: on the real corpus this mechanism must produce ONE
// association, structurally explained, and ZERO discoveries. An honestly sparse result is the
// successful one, and no heuristic may be added to inflate the count.

import { describe, expect, it } from "vitest";
import { foldCognitiveState, nodeKey, sessionize } from "@/cognition/cooccurrence";
import {
  CONFIDENCE_MAX,
  MAX_SESSION_ACTIVATIONS,
  SESSION_GAP_MS,
  S_MAX,
} from "@/cognition/bounds";
import type { Activation, CognitiveInput, StructuralPair } from "@/cognition/contract";
import type { EntityKind } from "@/domain";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const activation = (
  entity: EntityKind,
  entityId: string,
  at: string,
  ordinal: number,
  over: Partial<Activation> = {}
): Activation => ({
  subject: { entity, entity_id: entityId },
  at,
  ordinal,
  intensity: 1,
  provenance: { source: "event", eventId: `e${ordinal}` },
  ...over,
});

const input = (over: Partial<CognitiveInput> = {}): CognitiveInput => ({
  activations: [],
  structuralPairs: [],
  excludedCount: 0,
  sourceName: "test",
  now: NOW,
  ...over,
});

// ─── The real corpus ──────────────────────────────────────────────────────────
//
// The exact retained stream from the live vault as measured on 2026-08-19: 27 events in the spine,
// 17 emitted by the reconciler (actor "system") and therefore excluded, leaving these 10.

const REAL_STREAM: Activation[] = [
  activation("project", "tapia-tile-marble", "2026-07-17T21:53:17.905Z", 0),
  activation("project", "tapia-tile-marble", "2026-07-17T21:53:17.905Z", 1),
  activation("project", "tapia-tile-marble", "2026-07-17T21:53:30.905Z", 2),
  activation("project", "tapia-tile-marble", "2026-07-17T21:53:31.905Z", 3),
  activation("project", "tapia-tile-marble", "2026-07-18T07:46:48.000Z", 4),
  activation("project", "tapia-tile-marble", "2026-07-18T07:46:49.000Z", 5),
  activation("project", "decoraciones-pilar", "2026-08-13T19:38:10.000Z", 6),
  activation("project", "decoraciones-pilar", "2026-08-13T19:38:28.000Z", 7),
  activation("client", "elite-vac-service", "2026-08-17T11:35:06.000Z", 8),
  activation("project", "elite-vac-service", "2026-08-17T11:35:06.000Z", 9),
];

const REAL_STRUCTURAL: StructuralPair[] = [
  { a: "client/tapia-tile-marble", b: "project/tapia-tile-marble" },
  { a: "client/decoraciones-pilar", b: "project/decoraciones-pilar" },
  { a: "client/elite-vac-service", b: "project/elite-vac-service" },
];

const realState = () =>
  foldCognitiveState(
    input({ activations: REAL_STREAM, structuralPairs: REAL_STRUCTURAL, excludedCount: 17 })
  );

describe("cooccurrence · golden result on the real corpus", () => {
  it("segments the retained stream into exactly four sessions", () => {
    const state = realState();
    expect(state.source).toEqual({
      name: "test",
      activationCount: 10,
      excludedCount: 17,
      sessionCount: 4,
    });
  });

  it("produces exactly one association, and it is the onboarding pair", () => {
    const state = realState();
    expect(state.associations).toHaveLength(1);
    const [only] = state.associations;
    expect(only.id).toBe("client/elite-vac-service->project/elite-vac-service");
    expect(nodeKey(only.source)).toBe("client/elite-vac-service");
    expect(nodeKey(only.target)).toBe("project/elite-vac-service");
  });

  it("makes ZERO discoveries — the one association is structurally explained", () => {
    // The whole layer exists to avoid rediscovering the schema and calling it insight. Clients and
    // projects co-occur because a foreign key binds them; that is confirmation the mechanism runs,
    // never a finding.
    const state = realState();
    const discoveries = state.associations.filter((a) => !a.structurallyExplained);
    expect(discoveries).toEqual([]);
    expect(state.associations[0].structurallyExplained).toBe(true);
  });

  it("reports confidence at the floor after a single occasion", () => {
    const [only] = realState().associations;
    expect(only.observationCount).toBe(1);
    expect(only.confidence).toBe(0);
  });

  it("carries the evidence for the association it formed", () => {
    const [only] = realState().associations;
    expect(only.provenance.contributingEventIds).toEqual(["e8", "e9"]);
    expect(only.provenance.derivedBy).toBe("cooccurrence.v1");
  });

  it("learns nothing at all from the checklist bursts", () => {
    // 6 of 9 adjacent pairs in the corpus are one project toggled repeatedly. Self-pairs carry no
    // relational information and must not become associations.
    const bursts = REAL_STREAM.slice(0, 8);
    const state = foldCognitiveState(input({ activations: bursts }));
    expect(state.associations).toEqual([]);
    expect(state.source.sessionCount).toBe(3);
  });

  it("produces no patterns, predictions, or hypotheses — N1 has no producer for them", () => {
    const state = realState();
    expect(state.patterns).toEqual([]);
    expect(state.predictions).toEqual([]);
    expect(state.hypotheses).toEqual([]);
  });
});

describe("cooccurrence · reproducibility", () => {
  it("is byte-identical across runs, not merely equivalent", () => {
    // The invariant every later mechanism depends on: decay, consolidation, checkpoints,
    // prediction and any AI adapter all assume the substrate cannot drift.
    const a = realState();
    const b = realState();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stamps computedAt from the injected now, not the system clock", () => {
    const state = realState();
    expect(state.computedAt).toBe(NOW.toISOString());
    for (const association of state.associations) {
      expect(association.provenance.computedAt).toBe(NOW.toISOString());
    }
  });

  it("orders by ordinal, not by array position or timestamp", () => {
    const shuffled = [...REAL_STREAM].reverse();
    const ordered = foldCognitiveState(
      input({ activations: REAL_STREAM, structuralPairs: REAL_STRUCTURAL })
    );
    const fromShuffled = foldCognitiveState(
      input({ activations: shuffled, structuralPairs: REAL_STRUCTURAL })
    );
    expect(JSON.stringify(fromShuffled)).toBe(JSON.stringify(ordered));
  });

  it("is order-sensitive in what it MEANS — swapping causal order reverses direction", () => {
    // Associations are directed. If swapping which event came first produced the same association,
    // the asymmetry would be decorative.
    const forward = [
      activation("client", "a", "2026-01-01T00:00:00.000Z", 0),
      activation("project", "b", "2026-01-01T00:00:05.000Z", 1),
    ];
    const backward = [
      activation("project", "b", "2026-01-01T00:00:00.000Z", 0),
      activation("client", "a", "2026-01-01T00:00:05.000Z", 1),
    ];
    expect(foldCognitiveState(input({ activations: forward })).associations[0].id).toBe(
      "client/a->project/b"
    );
    expect(foldCognitiveState(input({ activations: backward })).associations[0].id).toBe(
      "project/b->client/a"
    );
  });

  it("breaks the session when ordinal order and timestamp order disagree", () => {
    // The adapter never produces such a stream, but the fold is a public pure function. A negative
    // gap must FAIL TOWARD FEWER PAIRS: chaining it would collapse a malformed stream into one
    // enormous session and manufacture a fully-connected graph, which is the single worst failure
    // this layer could have.
    const incoherent = [
      activation("client", "a", "2026-06-01T00:00:00.000Z", 0),
      activation("project", "b", "2026-01-01T00:00:00.000Z", 1),
    ];
    const state = foldCognitiveState(input({ activations: incoherent }));
    expect(state.source.sessionCount).toBe(2);
    expect(state.associations).toEqual([]);
  });

  it("sorts associations and evidence by a total order", () => {
    const ids = realState().associations.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    for (const association of realState().associations) {
      const evidence = association.provenance.contributingEventIds;
      expect(evidence).toEqual([...evidence].sort());
    }
  });
});

describe("cooccurrence · sessions", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

  it("chains activations while each gap stays under the threshold", () => {
    const stream = [
      activation("client", "a", at(0), 0),
      activation("client", "b", at(SESSION_GAP_MS - 1), 1),
      activation("client", "c", at(2 * SESSION_GAP_MS - 2), 2),
    ];
    expect(sessionize(stream)).toHaveLength(1);
  });

  it("breaks when a single gap reaches the threshold", () => {
    const stream = [
      activation("client", "a", at(0), 0),
      activation("client", "b", at(SESSION_GAP_MS), 1),
    ];
    expect(sessionize(stream)).toHaveLength(2);
  });

  it("forms no pair across a session boundary — not even a weak one", () => {
    const stream = [
      activation("client", "a", at(0), 0),
      activation("client", "b", at(SESSION_GAP_MS), 1),
    ];
    expect(foldCognitiveState(input({ activations: stream })).associations).toEqual([]);
  });

  it("caps session length so pair formation stays bounded", () => {
    const stream = Array.from({ length: MAX_SESSION_ACTIVATIONS + 10 }, (_, i) =>
      activation("client", `c${i}`, at(i * 1000), i)
    );
    const sessions = sessionize(stream);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.length).toBeLessThanOrEqual(MAX_SESSION_ACTIVATIONS);
    }
  });

  it("treats the threshold choice as insensitive on the real corpus", () => {
    // The observed gap distribution is a chasm: within-burst gaps top out at 18s, the smallest
    // between-burst gap is 9.9h. Any threshold inside that range segments identically, which is the
    // justification for SESSION_GAP_MS rather than a tuned value.
    const baseline = JSON.stringify(sessionize(REAL_STREAM).map((s) => s.length));
    for (const candidate of [60_000, 600_000, 1_800_000, 10_800_000]) {
      expect(candidate).toBeGreaterThan(18_000);
      expect(candidate).toBeLessThan(35_595_000);
    }
    expect(baseline).toBe(JSON.stringify([4, 2, 2, 2]));
  });
});

describe("cooccurrence · bounded behaviour", () => {
  const repeatedPair = (occasions: number): Activation[] =>
    Array.from({ length: occasions }, (_, k) => [
      activation("client", "a", new Date(Date.UTC(2026, 0, 1 + k)).toISOString(), k * 2),
      activation("project", "b", new Date(Date.UTC(2026, 0, 1 + k) + 1000).toISOString(), k * 2 + 1),
    ]).flat();

  it("saturates toward the ceiling and never exceeds it", () => {
    const state = foldCognitiveState(input({ activations: repeatedPair(200) }));
    const [only] = state.associations;
    expect(only.strength).toBeLessThanOrEqual(S_MAX);
    expect(only.strength).toBeGreaterThan(0);
  });

  it("shrinks the increment as strength approaches the ceiling", () => {
    // Saturation, not clamping: a clamp would hide runaway behind a min(), while a shrinking
    // derivative makes runaway structurally impossible.
    const strengthAfter = (n: number) =>
      foldCognitiveState(input({ activations: repeatedPair(n) })).associations[0].strength;
    const first = strengthAfter(1);
    const second = strengthAfter(2) - first;
    const tenth = strengthAfter(10) - strengthAfter(9);
    expect(second).toBeLessThan(first);
    expect(tenth).toBeLessThan(second);
    expect(tenth).toBeGreaterThan(0);
  });

  it("keeps confidence within its ceiling and rising with occasions", () => {
    const confidenceAfter = (n: number) =>
      foldCognitiveState(input({ activations: repeatedPair(n) })).associations[0].confidence;
    expect(confidenceAfter(1)).toBe(0);
    expect(confidenceAfter(2)).toBeGreaterThan(confidenceAfter(1));
    expect(confidenceAfter(50)).toBeLessThanOrEqual(CONFIDENCE_MAX);
  });

  it("counts occasions, not pair instances", () => {
    // A and B twice each inside ONE session yields several ordered pairs but a single occasion.
    // Counting instances would let one flurry of clicks look like repeated independent evidence.
    const burst = [
      activation("client", "a", "2026-01-01T00:00:00.000Z", 0),
      activation("project", "b", "2026-01-01T00:00:01.000Z", 1),
      activation("client", "a", "2026-01-01T00:00:02.000Z", 2),
      activation("project", "b", "2026-01-01T00:00:03.000Z", 3),
    ];
    const [only] = foldCognitiveState(input({ activations: burst })).associations;
    expect(only.observationCount).toBe(1);
    expect(only.confidence).toBe(0);
  });

  it("emits only finite numbers", () => {
    const state = foldCognitiveState(
      input({ activations: repeatedPair(40), structuralPairs: REAL_STRUCTURAL })
    );
    for (const association of state.associations) {
      expect(Number.isFinite(association.strength)).toBe(true);
      expect(Number.isFinite(association.confidence)).toBe(true);
      expect(Number.isFinite(association.observationCount)).toBe(true);
    }
  });
});

describe("cooccurrence · honest empty states", () => {
  it("returns an empty state for an empty stream", () => {
    const state = foldCognitiveState(input());
    expect(state.associations).toEqual([]);
    expect(state.workingSet).toEqual([]);
    expect(state.source.sessionCount).toBe(0);
  });

  it("forms no association from a single activation", () => {
    const state = foldCognitiveState(input({ activations: [REAL_STREAM[8]] }));
    expect(state.associations).toEqual([]);
    expect(state.source.sessionCount).toBe(1);
  });

  it("forms no association when every activation is the same subject", () => {
    const state = foldCognitiveState(input({ activations: REAL_STREAM.slice(0, 4) }));
    expect(state.associations).toEqual([]);
  });

  it("handles simultaneous activations without treating them as noise", () => {
    // Same-millisecond pairs are real: one operator action emits several events. Ordinal separates
    // them; the timestamp cannot.
    const simultaneous = [
      activation("client", "a", "2026-01-01T00:00:00.000Z", 0),
      activation("project", "b", "2026-01-01T00:00:00.000Z", 1),
    ];
    const [only] = foldCognitiveState(input({ activations: simultaneous })).associations;
    expect(only.id).toBe("client/a->project/b");
    expect(only.strength).toBeGreaterThan(0);
  });
});

describe("cooccurrence · ownership boundary", () => {
  it("never claims a fact or a witnessed event", () => {
    for (const association of realState().associations) {
      expect(association.epistemics).toBe("learned");
    }
  });

  it("carries no score, priority, or recommendation", () => {
    for (const association of realState().associations) {
      expect(association).not.toHaveProperty("priorityScore");
      expect(association).not.toHaveProperty("weight");
      expect(association).not.toHaveProperty("recommendation");
    }
  });

  it("does not mutate its input", () => {
    const activations = structuredClone(REAL_STREAM);
    const before = JSON.stringify(activations);
    foldCognitiveState(input({ activations, structuralPairs: REAL_STRUCTURAL }));
    expect(JSON.stringify(activations)).toBe(before);
  });

  it("labels nothing as structurally explained when no structure is supplied", () => {
    const state = foldCognitiveState(input({ activations: REAL_STREAM, structuralPairs: [] }));
    expect(state.associations[0].structurallyExplained).toBe(false);
  });
});
