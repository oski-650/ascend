// Layer A — cognition / propagation (N3) contract tests. See docs/COGNITION-N3.md.
//
// N3 learns nothing new. It takes what the business structurally IS and what cognition has already
// LEARNED, and asks what becomes reachable — while preserving exactly WHY it is reachable.
//
// The invariant every test below defends:
//
//     Propagation may traverse both channels only while their provenance stays distinguishable.
//
// So there is no combined activation scalar anywhere in the output, and the two channels report
// different kinds of number on purpose.

import { describe, expect, it } from "vitest";
import { propagate } from "@/cognition/propagation";
import {
  MAX_PATHS_EXPLORED,
  MAX_PATHS_PER_NODE,
  MAX_PROPAGATION_HOPS,
} from "@/cognition/bounds";
import type {
  Association,
  AssociationState,
  CognitiveNodeRef,
  InjectedRelationship,
  PropagationInput,
} from "@/cognition/contract";
import type { EntityKind } from "@/domain";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const ref = (entity: EntityKind, id: string): CognitiveNodeRef => ({ entity, entity_id: id });

const rel = (
  source: CognitiveNodeRef,
  target: CognitiveNodeRef,
  kind: string
): InjectedRelationship => ({ source, target, kind });

const assoc = (
  source: CognitiveNodeRef,
  target: CognitiveNodeRef,
  relevance: number,
  state: AssociationState = "active"
): Association => ({
  id: `${source.entity}/${source.entity_id}->${target.entity}/${target.entity_id}`,
  source,
  target,
  strength: Math.max(relevance, 0.5),
  confidence: 0.5,
  relevance,
  observationCount: 2,
  firstObservedAt: "2026-01-01T00:00:00.000Z",
  lastObservedAt: "2026-08-01T00:00:00.000Z",
  structurallyExplained: false,
  state,
  epistemics: "learned",
  provenance: { contributingEventIds: ["e1", "e2"], derivedBy: "cooccurrence.v1", computedAt: "x" },
});

const input = (over: Partial<PropagationInput> = {}): PropagationInput => ({
  seed: ref("client", "acme"),
  relationships: [],
  associations: [],
  now: NOW,
  ...over,
});

const at = (result: ReturnType<typeof propagate>, entity: EntityKind, id: string) =>
  result.reached.find((r) => r.node.entity === entity && r.node.entity_id === id);

// The delivery hierarchy, exactly as relationships/ produces it.
const HIERARCHY: InjectedRelationship[] = [
  rel(ref("prospect", "lead"), ref("client", "acme"), "promoted_to"),
  rel(ref("client", "acme"), ref("project", "acme"), "has_project"),
  rel(ref("project", "acme"), ref("phase", "acme:design"), "has_phase"),
  rel(ref("phase", "acme:design"), ref("task", "acme:design:0"), "has_task"),
];

describe("propagation · structural channel", () => {
  const result = () => propagate(input({ relationships: HIERARCHY }));

  it("reports exact hop distance, never an attenuated magnitude", () => {
    expect(at(result(), "project", "acme")?.structuralDistance).toBe(1);
    expect(at(result(), "phase", "acme:design")?.structuralDistance).toBe(2);
    expect(at(result(), "task", "acme:design:0")?.structuralDistance).toBe(3);
  });

  it("traverses against the grain, and records that it did", () => {
    // Reachability is symmetric — a task must lead back to its client — but the claim is not, so
    // direction survives into the provenance rather than being erased.
    const fromTask = propagate(input({ seed: ref("task", "acme:design:0"), relationships: HIERARCHY }));
    const client = at(fromTask, "client", "acme");
    expect(client?.structuralDistance).toBe(3);
    const steps = client?.paths[0].steps ?? [];
    expect(steps.every((s) => s.via === "structural" && s.direction === "reverse")).toBe(true);
  });

  it("reaches the whole hierarchy within the hop limit and no further", () => {
    // prospect → client → project → phase → task is exactly MAX_PROPAGATION_HOPS edges.
    const fromProspect = propagate(input({ seed: ref("prospect", "lead"), relationships: HIERARCHY }));
    expect(at(fromProspect, "task", "acme:design:0")?.structuralDistance).toBe(MAX_PROPAGATION_HOPS);

    const tooFar = propagate(
      input({
        seed: ref("prospect", "lead"),
        relationships: [...HIERARCHY, rel(ref("task", "acme:design:0"), ref("audit", "a1"), "measured_by")],
      })
    );
    expect(at(tooFar, "audit", "a1")).toBeUndefined();
  });

  it("carries no learned resonance when only structure connects two nodes", () => {
    const project = at(result(), "project", "acme");
    expect(project?.learnedResonance).toBe(0);
    expect(project?.relevance).toBeNull();
  });
});

describe("propagation · learned channel", () => {
  it("resonance is the product of relevance along the route", () => {
    const result = propagate(
      input({
        associations: [
          assoc(ref("client", "acme"), ref("document", "d1"), 0.8),
          assoc(ref("document", "d1"), ref("invoice", "i1"), 0.5),
        ],
      })
    );
    expect(at(result, "document", "d1")?.learnedResonance).toBeCloseTo(0.8, 12);
    expect(at(result, "invoice", "i1")?.learnedResonance).toBeCloseTo(0.4, 12);
  });

  it("carries no structural distance when only learning connects two nodes", () => {
    const result = propagate(
      input({ associations: [assoc(ref("client", "acme"), ref("document", "d1"), 0.8)] })
    );
    expect(at(result, "document", "d1")?.structuralDistance).toBeNull();
    expect(at(result, "document", "d1")?.learnedResonance).toBeCloseTo(0.8, 12);
  });

  it("aggregates competing routes by MAX, never by sum", () => {
    // Summing would breach the bound and would let density itself become an amplifier — a
    // well-connected node would look important merely for having more routes.
    const result = propagate(
      input({
        associations: [
          assoc(ref("client", "acme"), ref("document", "d1"), 0.6),
          assoc(ref("client", "acme"), ref("phase", "p"), 0.9),
          assoc(ref("phase", "p"), ref("document", "d1"), 0.9),
        ],
      })
    );
    const doc = at(result, "document", "d1");
    expect(doc?.pathCount).toBeGreaterThan(1);
    expect(doc?.learnedResonance).toBeCloseTo(0.81, 12); // max(0.6, 0.9×0.9), not their sum
    expect(doc?.learnedResonance).toBeLessThanOrEqual(1);
  });

  it("never lets resonance exceed 1, or grow with depth", () => {
    const chain = [
      assoc(ref("client", "acme"), ref("project", "p"), 1),
      assoc(ref("project", "p"), ref("phase", "ph"), 1),
      assoc(ref("phase", "ph"), ref("task", "t"), 0.5),
    ];
    const result = propagate(input({ associations: chain }));
    expect(at(result, "project", "p")?.learnedResonance).toBeLessThanOrEqual(1);
    expect(at(result, "task", "t")?.learnedResonance).toBeLessThanOrEqual(
      at(result, "phase", "ph")?.learnedResonance ?? 0
    );
  });
});

describe("propagation · accessibility drives traversal", () => {
  it("archived associations carry nothing", () => {
    // The payoff of N2's split: an archived association keeps every event id and can reactivate,
    // but it is cognitively inactive, so it carries no activation. No special case — it simply is
    // not traversable.
    const result = propagate(
      input({ associations: [assoc(ref("client", "acme"), ref("document", "d1"), 0.9, "archived")] })
    );
    expect(at(result, "document", "d1")).toBeUndefined();
    expect(result.source.traversableAssociations).toBe(0);
  });

  it("dormant associations remain traversable and simply contribute little", () => {
    const result = propagate(
      input({ associations: [assoc(ref("client", "acme"), ref("document", "d1"), 0.05, "dormant")] })
    );
    const doc = at(result, "document", "d1");
    expect(doc).toBeDefined();
    expect(doc?.learnedResonance).toBeCloseTo(0.05, 12);
    expect(result.source.traversableAssociations).toBe(1);
  });

  it("reactivating an association restores its reach", () => {
    const archived = propagate(
      input({ associations: [assoc(ref("client", "acme"), ref("document", "d1"), 0.9, "archived")] })
    );
    const active = propagate(
      input({ associations: [assoc(ref("client", "acme"), ref("document", "d1"), 0.9, "active")] })
    );
    expect(at(archived, "document", "d1")).toBeUndefined();
    expect(at(active, "document", "d1")?.learnedResonance).toBeCloseTo(0.9, 12);
  });
});

describe("propagation · provenance never collapses", () => {
  const both = () =>
    propagate(
      input({
        relationships: [rel(ref("client", "acme"), ref("project", "acme"), "has_project")],
        associations: [assoc(ref("client", "acme"), ref("project", "acme"), 0.7)],
      })
    );

  it("reports a node reached BOTH ways with both signals and both kinds of path", () => {
    const project = at(both(), "project", "acme");
    expect(project?.structuralDistance).toBe(1);
    expect(project?.learnedResonance).toBeCloseTo(0.7, 12);
    const mechanisms = project?.paths.map((p) => p.steps[0].via) ?? [];
    expect(mechanisms).toContain("structural");
    expect(mechanisms).toContain("learned");
  });

  it("emits NO combined activation scalar", () => {
    // The single most important assertion in this file. A fused number would answer no question.
    for (const reached of both().reached) {
      expect(reached).not.toHaveProperty("activation");
      expect(reached).not.toHaveProperty("score");
      expect(reached).not.toHaveProperty("weight");
      expect(reached).not.toHaveProperty("priority");
    }
  });

  it("labels every step with the mechanism that carried it", () => {
    for (const reached of both().reached) {
      for (const path of reached.paths) {
        for (const step of path.steps) {
          expect(["structural", "learned"]).toContain(step.via);
          if (step.via === "structural") expect(typeof step.kind).toBe("string");
          else expect(typeof step.associationId).toBe("string");
        }
      }
    }
  });

  it("keeps structural distance to ALL-structural routes — a mixed route says something else", () => {
    const result = propagate(
      input({
        relationships: [rel(ref("client", "acme"), ref("project", "acme"), "has_project")],
        associations: [assoc(ref("project", "acme"), ref("document", "d1"), 0.9)],
      })
    );
    // document is reachable only via structural-then-learned, so it has no structural distance.
    const doc = at(result, "document", "d1");
    expect(doc).toBeDefined();
    expect(doc?.structuralDistance).toBeNull();
    expect(doc?.learnedResonance).toBeCloseTo(0.9, 12);
  });

  it("carries no epistemics above `learned`", () => {
    for (const reached of both().reached) expect(reached.epistemics).toBe("learned");
  });
});

describe("propagation · bounded behaviour", () => {
  /** A fully-connected graph of `n` nodes, every pair associated at maximum relevance. */
  const dense = (n: number): Association[] => {
    const nodes = Array.from({ length: n }, (_, i) => ref("client", `c${i}`));
    const out: Association[] = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i !== j) out.push(assoc(nodes[i], nodes[j], 1));
      }
    }
    return out;
  };

  it("terminates on a fully-connected graph at maximum relevance", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(30) }));
    expect(result.reached.length).toBeGreaterThan(0);
    expect(result.source.pathsExplored).toBeLessThanOrEqual(MAX_PATHS_EXPLORED);
  });

  it("retains at most MAX_PATHS_PER_NODE, while reporting the true count", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(12) }));
    for (const reached of result.reached) {
      expect(reached.paths.length).toBeLessThanOrEqual(MAX_PATHS_PER_NODE);
      expect(reached.pathCount).toBeGreaterThanOrEqual(reached.paths.length);
    }
    // Truncation must actually be exercised, or this proves nothing.
    expect(result.reached.some((r) => r.pathCount > r.paths.length)).toBe(true);
  });

  it("admits when it stopped looking rather than presenting a partial sweep as complete", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(40) }));
    if (result.source.explorationExhausted) {
      expect(result.source.pathsExplored).toBeGreaterThanOrEqual(MAX_PATHS_EXPLORED);
    }
    expect(typeof result.source.explorationExhausted).toBe("boolean");
  });

  it("never exceeds the hop limit", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(8) }));
    for (const reached of result.reached) {
      for (const path of reached.paths) {
        expect(path.steps.length).toBeLessThanOrEqual(MAX_PROPAGATION_HOPS);
      }
    }
  });

  it("never revisits a subject within a path", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(6) }));
    for (const reached of result.reached) {
      for (const path of reached.paths) {
        const visited = path.steps.map((s) => `${s.to.entity}/${s.to.entity_id}`);
        expect(new Set(visited).size).toBe(visited.length);
      }
    }
  });

  it("terminates on a cycle", () => {
    const ring = [
      rel(ref("client", "a"), ref("client", "b"), "promoted_to"),
      rel(ref("client", "b"), ref("client", "c"), "promoted_to"),
      rel(ref("client", "c"), ref("client", "a"), "promoted_to"),
    ];
    const result = propagate(input({ seed: ref("client", "a"), relationships: ring }));
    expect(result.reached.map((r) => r.node.entity_id).sort()).toEqual(["b", "c"]);
  });

  it("emits only finite numbers", () => {
    const result = propagate(input({ seed: ref("client", "c0"), associations: dense(10) }));
    for (const reached of result.reached) {
      expect(Number.isFinite(reached.learnedResonance)).toBe(true);
      expect(Number.isFinite(reached.pathCount)).toBe(true);
      if (reached.structuralDistance !== null) expect(Number.isFinite(reached.structuralDistance)).toBe(true);
      for (const path of reached.paths) expect(Number.isFinite(path.contribution)).toBe(true);
    }
  });
});

describe("propagation · determinism", () => {
  const mixed = () =>
    input({
      relationships: HIERARCHY,
      associations: [
        assoc(ref("client", "acme"), ref("document", "d1"), 0.6),
        assoc(ref("project", "acme"), ref("document", "d1"), 0.9),
      ],
    });

  it("is byte-identical across runs", () => {
    expect(JSON.stringify(propagate(mixed()))).toBe(JSON.stringify(propagate(mixed())));
  });

  it("is independent of input ordering", () => {
    const base = mixed();
    const shuffled: PropagationInput = {
      ...base,
      relationships: [...base.relationships].reverse(),
      associations: [...base.associations].reverse(),
    };
    expect(JSON.stringify(propagate(shuffled))).toBe(JSON.stringify(propagate(base)));
  });

  it("orders reached nodes and retained paths totally", () => {
    const result = propagate(mixed());
    const keys = result.reached.map((r) => `${r.node.entity}/${r.node.entity_id}`);
    expect(keys).toEqual([...keys].sort());
    for (const reached of result.reached) {
      const contributions = reached.paths.map((p) => p.contribution);
      expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
    }
  });

  it("stamps computedAt from the injected now", () => {
    expect(propagate(mixed()).computedAt).toBe(NOW.toISOString());
  });

  it("does not mutate its input", () => {
    const base = mixed();
    const before = JSON.stringify(base);
    propagate(base);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("propagation · honest empty states", () => {
  it("reaches nothing from an isolated seed", () => {
    const result = propagate(input());
    expect(result.reached).toEqual([]);
    expect(result.source.pathsExplored).toBe(0);
  });

  it("never returns the seed as something it reached", () => {
    const result = propagate(input({ relationships: HIERARCHY }));
    expect(at(result, "client", "acme")).toBeUndefined();
  });

  it("reaches nothing from a seed that appears nowhere in the graph", () => {
    const result = propagate(input({ seed: ref("client", "ghost"), relationships: HIERARCHY }));
    expect(result.reached).toEqual([]);
  });
});
