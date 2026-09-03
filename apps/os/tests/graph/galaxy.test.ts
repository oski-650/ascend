// SLICE 3 — the GalaxyLayout transformation.
//
// This layer is the first one allowed to produce coordinates, so the tests cannot ask "are there
// coordinates here" the way F62 and F63 do. They ask the harder question instead: are these the
// SAME coordinates every time, do they come only from identity and structure, and can a business
// fact move them? The last of those is the one with a consequence — a layout that shifted when an
// invoice grew would make a business fact readable from the picture, which §3.2 forbids.
//
// The fixture is built through `toSpatialModel` rather than hand-written, so the containment rules
// under test are the real ones. Hand-built SpatialModels appear only where a shape the projection
// cannot produce is needed — a dangling parent, a containment cycle.

import { describe, expect, it } from "vitest";
import { computeGalaxyLayout, type LayoutModel } from "@/graph-view/galaxy";
import { toSpatialModel, spatialSeed, type SpatialModel } from "@/graph-view/spatial";
import { ORBITAL_BAND } from "@/graph-view/taxonomy";
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

const edge = (type: GraphEdge["type"], source: string, target: string): GraphEdge =>
  ({ id: `${type}:${source}->${target}`, type, source, target });

// A client with a project, that project with a phase, that phase with SIX sibling tasks — enough
// siblings that spacing is a real question — plus a lateral invoice and a second client.
const TASKS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

const NODES: GraphNode[] = [
  node("client", "acme", 0.9),
  node("client", "borden", 0.3),
  node("project", "rebuild", 0.7),
  node("phase", "discovery", 0.4),
  node("invoice", "inv-1", 0.6),
  ...TASKS.map((t) => node("task", t, 0.1)),
];

const EDGES: GraphEdge[] = [
  edge("has_project", "client:acme", "project:rebuild"),
  edge("has_phase", "project:rebuild", "phase:discovery"),
  ...TASKS.map((t) => edge("has_task", "phase:discovery", `task:${t}`)),
  edge("billed", "client:acme", "invoice:inv-1"),
];

const SPATIAL = (): SpatialModel => toSpatialModel({ nodes: NODES, edges: EDGES });
const build = (): LayoutModel => computeGalaxyLayout(SPATIAL());
const at = (m: LayoutModel, id: string) => m.nodes.find((n) => n.id === id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const sorted = (m: LayoutModel) => m.nodes.slice().sort((a, b) => a.id.localeCompare(b.id));

describe("the fixture is real — the control that keeps every assertion below meaningful", () => {
  it("has a multi-level chain, a crowded sibling ring, and a lateral relationship", () => {
    const s = SPATIAL();
    expect(s.nodes.filter((n) => n.parent === "phase:discovery")).toHaveLength(6);
    expect(s.nodes.find((n) => n.id === "phase:discovery")?.parent).toBe("project:rebuild");
    expect(s.nodes.find((n) => n.id === "project:rebuild")?.parent).toBe("client:acme");
    expect(s.nodes.find((n) => n.id === "invoice:inv-1")?.parent,
      "the lateral edge produced a parent — the discriminating case is gone").toBeNull();
  });
});

describe("TOTAL · every SpatialNode produces exactly one LayoutNode", () => {
  it("the counts match and the id sets are equal", () => {
    const m = build();
    expect(m.nodes).toHaveLength(NODES.length);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(NODES.map((n) => n.id).sort());
    expect(new Set(m.nodes.map((n) => n.id)).size).toBe(NODES.length);
  });

  it("invents no node — every laid-out id came from the input", () => {
    const given = new Set(SPATIAL().nodes.map((n) => n.id));
    for (const n of build().nodes) expect(given.has(n.id), `${n.id} was invented by layout`).toBe(true);
  });

  it("filters nothing — layout is not a visibility authority", () => {
    const lonely = node("sop", "orphan", 0);
    const m = computeGalaxyLayout(toSpatialModel({ nodes: [...NODES, lonely], edges: EDGES }));
    expect(m.nodes.map((n) => n.id)).toContain("sop:orphan");
  });
});

describe("DETERMINISTIC · one input, one layout", () => {
  it("two calls are deeply equal", () => {
    expect(build()).toEqual(build());
  });

  it("a SHUFFLED input yields identical positions", () => {
    const shuffled = toSpatialModel({ nodes: [...NODES].reverse(), edges: [...EDGES].reverse() });
    expect(sorted(computeGalaxyLayout(shuffled))).toEqual(sorted(build()));
  });

  it("a sibling's slot depends on WHICH siblings exist, not on arrival order", () => {
    // The reason siblings are sorted by id before slotting. Without it, the same six tasks arriving
    // in a different order would each land on a different phase and the graph would reshuffle on
    // every rebuild — deterministic per call, unstable across them, which is the worse failure.
    const rotated = [...NODES.slice(3), ...NODES.slice(0, 3)];
    const m = computeGalaxyLayout(toSpatialModel({ nodes: rotated, edges: EDGES }));
    for (const t of TASKS) {
      expect(at(m, `task:${t}`)?.orbitPhase).toBe(at(build(), `task:${t}`)?.orbitPhase);
    }
  });
});

describe("PHASE · seed-derived, and independently recomputable", () => {
  it("equals the documented closed form — rotation from the system's seed, plus an even slot", () => {
    // Recomputed here from first principles. If the formula drifted, this is where it shows.
    const members = TASKS.map((t) => `task:${t}`).sort();
    const rotation = spatialSeed("phase:discovery");
    const m = build();
    members.forEach((id, slot) => {
      const expected = ((rotation + slot / members.length) % 1) * Math.PI * 2;
      expect(at(m, id)?.orbitPhase).toBe(expected);
    });
  });

  it("every phase is a real angle in [0, 2π)", () => {
    for (const n of build().nodes) {
      expect(Number.isFinite(n.orbitPhase)).toBe(true);
      expect(n.orbitPhase).toBeGreaterThanOrEqual(0);
      expect(n.orbitPhase).toBeLessThan(Math.PI * 2);
    }
  });

  it("MUTATION · a Math.random-derived phase fails the equality the block above relies on", () => {
    // The vacuity gate. If a randomised layout compared equal, every determinism assertion here
    // would be decorative.
    const mutant = () => ({ nodes: NODES.map((n) => ({ id: n.id, orbitPhase: Math.random() })) });
    expect(mutant(), "a randomised layout compared equal — determinism is not being measured")
      .not.toEqual(mutant());
  });
});

describe("ORBIT · containment places a child around its parent", () => {
  it("a child sits exactly its orbitRadius from its parent's position", () => {
    const m = build();
    const pairs: [string, string][] = [
      ["project:rebuild", "client:acme"],
      ["phase:discovery", "project:rebuild"],
      ...TASKS.map((t) => [`task:${t}`, "phase:discovery"] as [string, string]),
    ];
    for (const [child, parent] of pairs) {
      const c = at(m, child)!;
      const p = at(m, parent)!;
      expect(dist(c, p), `${child} is not in orbit around ${parent}`).toBeCloseTo(c.orbitRadius, 9);
    }
  });

  it("orbitRadius is the type's band unless the ring had to widen for its siblings", () => {
    const m = build();
    expect(at(m, "project:rebuild")?.orbitRadius).toBe(ORBITAL_BAND.project);
    expect(at(m, "task:alpha")?.orbitRadius).toBe(ORBITAL_BAND.task);
  });

  it("a LATERAL-only node gets no orbital parent and anchors to the core", () => {
    // `billed` is a real foreign key. It is not containment, and an invoice must not become a moon
    // of the client that paid it. If the containment rule ever widened, this is the red.
    const m = build();
    const inv = at(m, "invoice:inv-1")!;
    expect(inv.parent, "a lateral relationship produced an orbital parent").toBeNull();
    expect(dist(inv, { x: 0, y: 0 }), "an unparented node is not in a core orbit")
      .toBeCloseTo(inv.orbitRadius, 9);
  });

  it("roots orbit the core, not each other", () => {
    for (const id of ["client:acme", "client:borden"]) {
      const n = at(build(), id)!;
      expect(n.parent).toBeNull();
      expect(dist(n, { x: 0, y: 0 })).toBeCloseTo(n.orbitRadius, 9);
    }
  });
});

describe("SPACING · deterministic, closed-form, and actually separating", () => {
  it("six siblings on one ring are evenly spaced and none overlap", () => {
    const m = build();
    const ring = TASKS.map((t) => at(m, `task:${t}`)!);
    const gaps: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 1; j < ring.length; j++) gaps.push(dist(ring[i], ring[j]));
    }
    expect(Math.min(...gaps), "two siblings landed closer than the documented 26-unit floor")
      .toBeGreaterThan(26);
    // Evenly spaced: every adjacent phase difference is the same 1/6 turn.
    const phases = ring.map((n) => n.orbitPhase).sort((a, b) => a - b);
    const deltas = phases.slice(1).map((p, i) => p - phases[i]);
    for (const d of deltas) expect(d).toBeCloseTo((Math.PI * 2) / 6, 9);
  });

  it("a crowded ring widens instead of packing tighter — closed form, not iteration", () => {
    // 200 siblings cannot fit on the task band at 26 units apart, so the radius grows to
    // count × arc / 2π. One expression; no solver ran.
    const many = Array.from({ length: 200 }, (_, i) => node("task", `t${i}`));
    const m = computeGalaxyLayout(toSpatialModel({
      nodes: [node("phase", "big"), ...many],
      edges: many.map((t) => edge("has_task", "phase:big", t.id)),
    }));
    const ring = many.map((t) => at(m, t.id)!);
    expect(ring[0].orbitRadius, "the ring did not widen for 200 siblings")
      .toBeGreaterThan(ORBITAL_BAND.task);
    expect(ring[0].orbitRadius).toBeCloseTo((200 * 26) / (Math.PI * 2), 9);
    const gaps: number[] = [];
    for (let i = 1; i < ring.length; i++) gaps.push(dist(ring[i - 1], ring[i]));
    expect(Math.min(...gaps), "the widened ring still overlaps").toBeGreaterThan(20);
  });
});

describe("LAYOUT READS IDENTITY AND STRUCTURE — NEVER A BUSINESS FACT", () => {
  it("changing weight, state, label and meta moves nothing", () => {
    // THE ASSERTION WITH A CONSEQUENCE, and behavioural rather than a source scan. `weight` reaches
    // SpatialModel as `size`; if layout consulted it, a coordinate would encode a business fact and
    // §3.2's "no business question may be answerable only by asking the renderer" would be broken.
    const loud = NODES.map((n) => ({
      ...n,
      weight: 1,
      label: `RENAMED ${n.label}`,
      state: { health: "at_risk" as const, status: "overdue", attention: true },
      meta: [{ label: "Value", value: "$99,000" }],
    }));
    const shifted = computeGalaxyLayout(toSpatialModel({ nodes: loud, edges: EDGES }));
    expect(sorted(shifted), "a business field moved a coordinate").toEqual(sorted(build()));
  });

  it("the fixture's weights really do differ — otherwise the test above proves nothing", () => {
    const base = SPATIAL();
    const loud = toSpatialModel({ nodes: NODES.map((n) => ({ ...n, weight: 1 })), edges: EDGES });
    expect(base.nodes.map((n) => n.size), "sizes are identical; weight-independence is untested")
      .not.toEqual(loud.nodes.map((n) => n.size));
  });

  it("but changing the TYPE does move it — the control proving layout reads structure at all", () => {
    const retyped = NODES.map((n) => (n.id === "client:borden" ? { ...n, type: "sop" as const } : n));
    const m = computeGalaxyLayout(toSpatialModel({ nodes: retyped, edges: EDGES }));
    expect(at(m, "client:borden")?.orbitRadius, "type does not affect the band — ORBITAL_BAND is unused")
      .not.toBe(at(build(), "client:borden")?.orbitRadius);
  });
});

describe("PURITY · the input is not touched, and no integrator runs", () => {
  it("does not mutate the SpatialModel it is given", () => {
    const model = SPATIAL();
    const before = JSON.stringify(model);
    computeGalaxyLayout(model);
    expect(JSON.stringify(model), "GalaxyLayout wrote into SpatialModel").toBe(before);
  });

  it("emits no velocity, no force and no simulation state", () => {
    const keys = new Set(build().nodes.flatMap((n) => Object.keys(n)));
    for (const k of ["vx", "vy", "z", "orbitSpeed", "orbitInclination", "alpha", "pinned", "glow", "size"]) {
      expect(keys.has(k), `GalaxyLayout emitted \`${k}\``).toBe(false);
    }
    expect([...keys].sort()).toEqual(["id", "orbitPhase", "orbitRadius", "parent", "x", "y"]);
  });

  it("is settled on the first call — running it again changes nothing (no relaxation)", () => {
    // A force integrator converges over repeated application. This does not: one pass is final.
    const first = build();
    expect(computeGalaxyLayout(SPATIAL())).toEqual(first);
  });
});

describe("DEGENERATE SHAPES · total, never fabricating", () => {
  it("an empty model yields an empty layout", () => {
    expect(computeGalaxyLayout({ nodes: [], edges: [] }).nodes).toEqual([]);
  });

  it("a DANGLING parent anchors to the core and fabricates no node", () => {
    const orphan: SpatialModel = {
      nodes: [{ id: "task:lost", visualType: "task", size: 4, seed: 0.5, parent: "phase:ghost" }],
      edges: [],
    };
    const m = computeGalaxyLayout(orphan);
    expect(m.nodes.map((n) => n.id), "a missing parent was fabricated into a node")
      .toEqual(["task:lost"]);
    expect(dist(m.nodes[0], { x: 0, y: 0 })).toBeCloseTo(m.nodes[0].orbitRadius, 9);
  });

  it("a containment CYCLE terminates instead of recursing forever", () => {
    const cycle: SpatialModel = {
      nodes: [
        { id: "a:1", visualType: "project", size: 8, seed: 0.1, parent: "a:2" },
        { id: "a:2", visualType: "project", size: 8, seed: 0.2, parent: "a:1" },
      ],
      edges: [],
    };
    const m = computeGalaxyLayout(cycle);
    expect(m.nodes).toHaveLength(2);
    for (const n of m.nodes) {
      expect(Number.isFinite(n.x), "a cycle produced a non-finite coordinate").toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});
