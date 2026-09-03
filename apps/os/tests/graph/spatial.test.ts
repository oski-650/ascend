// SLICE 2 — the SpatialModel transformation.
//
// Every assertion here is about a PROPERTY of the transformation, not about a value it happens to
// produce today. The distinction is the one this project has been bitten by repeatedly: a test that
// pins `size === 7.7` measures arithmetic and goes red when taxonomy is retuned; a test that says
// "size comes from taxonomy and nothing else" states the boundary and survives it.
//
// The fixture is deliberately not minimal. It carries four node types, a THREE-LEVEL containment
// chain (client → project → phase → task), a lateral edge that must NOT create a parent, a dangling
// edge, and one node with two competing containment parents. A one-node fixture would satisfy
// "total" and "deterministic" while proving nothing about either.

import { describe, expect, it } from "vitest";
import { toSpatialModel, spatialSeed, type SpatialModel } from "@/graph-view/spatial";
import { nodeRadius } from "@/graph-view/taxonomy";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/graph-view/contract";
import type { EntityKind } from "@/domain";

function node(type: GraphNodeType, entityId: string, weight = 0.5): GraphNode {
  return {
    id: `${type}:${entityId}`,
    type,
    label: `${type} ${entityId}`,
    entityId,
    entity: type as EntityKind,
    weight,
    state: { health: null, status: null, attention: false },
    meta: [],
  };
}

function edge(type: GraphEdge["type"], source: string, target: string): GraphEdge {
  return { id: `${type}:${source}->${target}`, type, source, target };
}

const NODES: GraphNode[] = [
  node("client", "acme", 0.9),
  node("project", "rebuild", 0.7),
  node("phase", "discovery", 0.4),
  node("task", "audit-forms", 0.1),
  node("invoice", "inv-1", 0.5),
  node("client", "borden", 0.8),
];

const EDGES: GraphEdge[] = [
  edge("has_project", "client:acme", "project:rebuild"),
  edge("has_phase", "project:rebuild", "phase:discovery"),
  edge("has_task", "phase:discovery", "task:audit-forms"),
  // LATERAL. A client is billed by an invoice; the invoice is not PART OF the client.
  edge("billed", "client:acme", "invoice:inv-1"),
  // DANGLING — the target is not in NODES.
  edge("owns_document", "client:acme", "document:ghost"),
];

const build = (): SpatialModel => toSpatialModel({ nodes: NODES, edges: EDGES });
const byId = (m: SpatialModel, id: string) => m.nodes.find((n) => n.id === id);

describe("the fixture is real — the control that keeps every assertion below meaningful", () => {
  it("carries several node types and a genuine multi-level containment chain", () => {
    expect(new Set(NODES.map((n) => n.type)).size,
      "a single-type fixture cannot show that visualType is carried per node").toBeGreaterThan(3);
    const kinds = EDGES.map((e) => e.type);
    expect(kinds, "no containment edge — every parent assertion below would be vacuous")
      .toContain("has_task");
    expect(kinds, "no lateral edge — the parent rule could admit everything and still pass")
      .toContain("billed");
  });
});

describe("TOTAL · every projection node produces exactly one SpatialNode", () => {
  it("the counts match and no id is lost, added or duplicated", () => {
    const m = build();
    expect(m.nodes).toHaveLength(NODES.length);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(NODES.map((n) => n.id).sort());
    expect(new Set(m.nodes.map((n) => n.id)).size, "a node was emitted twice").toBe(NODES.length);
  });

  it("SpatialModel is not a filter — nothing is dropped for being small, weightless or unlinked", () => {
    // D3: DetailLevel/isVisibleAt stay in taxonomy. If this layer ever started filtering it would be
    // a second visibility authority, which is the defect F61 was opened to remove one layer up.
    const lonely = node("sop", "orphan", 0);
    const m = toSpatialModel({ nodes: [...NODES, lonely], edges: EDGES });
    expect(m.nodes.map((n) => n.id), "an unlinked zero-weight node was filtered out")
      .toContain("sop:orphan");
  });
});

describe("DETERMINISTIC · the same projection yields the same model", () => {
  it("two calls are deeply equal", () => {
    expect(build()).toEqual(build());
  });

  it("a SHUFFLED input yields the same content", () => {
    // Input ORDER is preserved by design (reordering would change the renderer's draw order), so the
    // property is about content. Sorting both sides is what makes that precise rather than lenient.
    const shuffled = [...NODES].reverse();
    const shuffledEdges = [...EDGES].reverse();
    const a = build().nodes.slice().sort((x, y) => x.id.localeCompare(y.id));
    const b = toSpatialModel({ nodes: shuffled, edges: shuffledEdges })
      .nodes.slice().sort((x, y) => x.id.localeCompare(y.id));
    expect(b).toEqual(a);
  });

  it("the two-parent tie-break does not depend on edge order", () => {
    // A node reached by two containment edges must land on the same parent whichever order the
    // edges arrive in. Without the lexicographic rule this passes half the time, which is worse
    // than failing.
    const contested = [...NODES, node("project", "shared")];
    const e1 = edge("has_project", "client:acme", "project:shared");
    const e2 = edge("has_project", "client:borden", "project:shared");
    const forward = toSpatialModel({ nodes: contested, edges: [...EDGES, e1, e2] });
    const backward = toSpatialModel({ nodes: contested, edges: [...EDGES, e2, e1] });
    expect(byId(forward, "project:shared")?.parent).toBe(byId(backward, "project:shared")?.parent);
    expect(byId(forward, "project:shared")?.parent).toBe("client:acme");
  });
});

describe("SEED · stable identity, derived from the id and nothing else", () => {
  it("is the FNV-1a the simulation already placed nodes with — the extraction changed no value", () => {
    // Recomputed independently here. If `spatialSeed` were re-implemented rather than lifted, the
    // settled layout would silently move on every existing graph.
    const fnv = (key: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0) / 0xffffffff;
    };
    for (const n of NODES) expect(spatialSeed(n.id)).toBe(fnv(n.id));
  });

  it("is stable across calls and inside the model", () => {
    expect(spatialSeed("client:acme")).toBe(spatialSeed("client:acme"));
    expect(byId(build(), "client:acme")?.seed).toBe(spatialSeed("client:acme"));
  });

  it("distinguishes different ids — a constant seed would satisfy determinism and be useless", () => {
    expect(new Set(build().nodes.map((n) => n.seed)).size).toBe(NODES.length);
  });

  it("MUTATION · a Math.random-seeded model fails the equality the tests above rely on", () => {
    // The vacuity gate for the determinism block. If this mutant did NOT differ, `toEqual` would be
    // incapable of detecting non-determinism and every assertion above would be decorative.
    const mutant = () => ({ nodes: NODES.map((n) => ({ id: n.id, seed: Math.random() })) });
    expect(mutant(), "a randomised model compared equal — the determinism assertions prove nothing")
      .not.toEqual(mutant());
  });
});

describe("PARENT · derived from stored containment, never invented", () => {
  it("the containment chain produces the stored direction — source is the container", () => {
    const m = build();
    expect(byId(m, "project:rebuild")?.parent).toBe("client:acme");
    expect(byId(m, "phase:discovery")?.parent).toBe("project:rebuild");
    expect(byId(m, "task:audit-forms")?.parent).toBe("phase:discovery");
  });

  it("a LATERAL edge creates no parent — the discriminating half", () => {
    // `billed` is a real foreign key and a real edge. It is not containment, and if the rule ever
    // widened to "any structural edge", this is the assertion that goes red.
    expect(byId(build(), "invoice:inv-1")?.parent,
      "a lateral relationship was read as containment — the hierarchy is being invented").toBeNull();
  });

  it("a node with no containment edge has a null parent, not a fabricated root", () => {
    expect(byId(build(), "client:acme")?.parent).toBeNull();
    expect(byId(build(), "client:borden")?.parent).toBeNull();
  });

  it("a parent is always a node that exists in the model", () => {
    const m = build();
    const ids = new Set(m.nodes.map((n) => n.id));
    for (const n of m.nodes) if (n.parent) expect(ids.has(n.parent), `${n.id} → absent parent`).toBe(true);
  });
});

describe("EDGES · carried from the projection, never created", () => {
  it("dangling edges are skipped rather than fabricated into nodes", () => {
    const m = build();
    expect(m.edges.map((e) => e.target), "an edge to a non-existent node survived")
      .not.toContain("document:ghost");
    expect(m.nodes.map((n) => n.id), "a dangling endpoint was fabricated into a node")
      .not.toContain("document:ghost");
    expect(m.edges).toHaveLength(EDGES.length - 1);
  });

  it("every edge is one the projection already asserted — no new business relationships", () => {
    const projected = new Set(EDGES.map((e) => e.id));
    for (const e of build().edges) expect(projected.has(e.id), `${e.id} was invented`).toBe(true);
  });

  it("containment is flagged consistently with the parents derived from it", () => {
    const m = build();
    for (const e of m.edges) {
      if (e.containment) expect(byId(m, e.target)?.parent).not.toBeNull();
    }
    expect(m.edges.filter((e) => e.containment), "no edge was flagged — the flag is vacuous")
      .not.toHaveLength(0);
    expect(m.edges.find((e) => e.kind === "billed")?.containment).toBe(false);
  });
});

describe("SIZE · taxonomy remains the owner (D2)", () => {
  it("size equals taxonomy.nodeRadius for every node — this layer computes no sizing of its own", () => {
    const m = build();
    for (const n of NODES) expect(byId(m, n.id)?.size).toBe(nodeRadius(n));
  });

  it("the fixture actually varies size — otherwise the equality above is trivially satisfiable", () => {
    expect(new Set(build().nodes.map((n) => n.size)).size).toBeGreaterThan(3);
  });
});

describe("VISUAL TYPE · contract vocabulary, carried unchanged", () => {
  it("every node keeps the projection's type", () => {
    const m = build();
    for (const n of NODES) expect(byId(m, n.id)?.visualType).toBe(n.type);
  });
});

describe("NO COORDINATES · SpatialModel says what an object IS, never where it goes", () => {
  it("no emitted node or edge carries a positional key", () => {
    const m = build();
    const keys = new Set([...m.nodes.flatMap((n) => Object.keys(n)), ...m.edges.flatMap((e) => Object.keys(e))]);
    for (const forbidden of ["x", "y", "z", "vx", "vy", "position", "angle", "orbitRadius", "radius"]) {
      expect(keys.has(forbidden), `SpatialModel emitted \`${forbidden}\` — that is GalaxyLayout's output`)
        .toBe(false);
    }
    expect(keys.size, "no keys were read — the check is broken, not the model clean").toBeGreaterThan(5);
  });
});
