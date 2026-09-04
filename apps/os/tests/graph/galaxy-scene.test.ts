// RENDERER SLICE 4 — the draw model, and the pipeline that produces it.
//
// The renderer's decisions live in `buildScene`, so they are a VALUE and can be asserted on. Pixels
// are not tested here and should not be: a test that inspected canvas bytes would be measuring the
// browser, and the properties this slice must establish — that positions are consumed rather than
// recomputed, that nothing is fabricated, that a business fact changes only appearance — are all
// statements about the scene.
//
// The final block is the one that matters most. Every other test could pass against a hand-built
// fixture that merely LOOKS like a LayoutModel; the pipeline witness starts from a GraphProjection,
// runs the real `toSpatialModel` and the real `computeGalaxyLayout`, and proves the scene carries
// what those two actually produced.

import { describe, expect, it } from "vitest";
import { buildScene, type Scene } from "@/components/galaxy/scene";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout, type LayoutModel } from "@/graph-view/galaxy";
import { healthColor, NODE_VISUAL } from "@/graph-view/taxonomy";
import type { GraphEdge, GraphNode, GraphNodeType, GraphProjection } from "@/graph-view/contract";
import type { EntityKind } from "@/domain";

function node(type: GraphNodeType, entityId: string, weight = 0.5): GraphNode {
  return {
    id: `${type}:${entityId}`, type, label: `${type} ${entityId}`, entityId,
    entity: type as EntityKind, weight,
    state: { health: null, status: null, attention: false }, meta: [],
  };
}
const edge = (type: GraphEdge["type"], source: string, target: string): GraphEdge =>
  ({ id: `${type}:${source}->${target}`, type, source, target });

const TASKS = ["alpha", "beta", "gamma", "delta"];

const NODES: GraphNode[] = [
  node("client", "acme", 0.9),
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

const projectionOf = (nodes: GraphNode[], edges: GraphEdge[]): GraphProjection => ({
  nodes, edges, activity: [],
  source: { name: "test", builtAt: "2026-09-03T00:00:00Z", nodeCount: nodes.length, edgeCount: edges.length },
});

const PROJECTION = projectionOf(NODES, EDGES);
const SPATIAL = toSpatialModel(PROJECTION);
const LAYOUT = computeGalaxyLayout(SPATIAL);

const scene = (over: Partial<Parameters<typeof buildScene>[0]> = {}): Scene =>
  buildScene({ projection: PROJECTION, spatial: SPATIAL, layout: LAYOUT, detail: "full", ...over });

const find = (s: Scene, id: string) => s.nodes.find((n) => n.id === id);

describe("TOTAL · every LayoutNode is drawn exactly once, and nothing else is", () => {
  it("the scene's ids equal the layout's ids", () => {
    const s = scene();
    expect(s.nodes.map((n) => n.id).sort()).toEqual(LAYOUT.nodes.map((n) => n.id).sort());
    expect(new Set(s.nodes.map((n) => n.id)).size, "an object was drawn twice").toBe(LAYOUT.nodes.length);
  });

  it("FABRICATION · a layout node the upstream layers do not describe is dropped, not invented", () => {
    // The renderer has no defaults to fill in with. If it did, something would appear on screen that
    // no authorized reader produced — a business object created by the renderer.
    const ghost: LayoutModel = {
      nodes: [...LAYOUT.nodes, { id: "client:phantom", x: 5, y: 5, orbitRadius: 1, orbitPhase: 0, parent: null }],
    };
    const s = scene({ layout: ghost });
    expect(s.nodes.map((n) => n.id), "the renderer invented an object").not.toContain("client:phantom");
    expect(s.nodes).toHaveLength(LAYOUT.nodes.length);
  });

  it("every edge traces to a relationship the projection asserted — none is reconstructed", () => {
    const asserted = new Set(PROJECTION.edges.map((e) => e.id));
    for (const e of scene().edges) expect(asserted.has(e.id), `${e.id} was invented`).toBe(true);
    expect(scene().edges.length, "no edges drawn — the assertion above is vacuous").toBeGreaterThan(0);
  });
});

describe("POSITIONS ARE CONSUMED, NEVER COMPUTED", () => {
  it("every drawn position is the layout's position, verbatim", () => {
    const s = scene();
    for (const placed of LAYOUT.nodes) {
      expect(find(s, placed.id)?.x).toBe(placed.x);
      expect(find(s, placed.id)?.y).toBe(placed.y);
    }
  });

  it("moving a node in the LayoutModel moves it in the scene", () => {
    const moved: LayoutModel = {
      nodes: LAYOUT.nodes.map((n) =>
        n.id === "client:acme" ? { ...n, x: -777, y: 333 } : n),
    };
    const s = scene({ layout: moved });
    expect(find(s, "client:acme")?.x).toBe(-777);
    expect(find(s, "client:acme")?.y).toBe(333);
  });

  it("THE DISCRIMINATING CASE · x/y win over orbitRadius and orbitPhase when they disagree", () => {
    // A renderer that recomputed `cos(phase) * radius` would land on (5, 0) and ignore the x/y it
    // was handed. Only a renderer that COPIES the position passes this. No other test in this file
    // can tell the two implementations apart.
    const contradictory: LayoutModel = {
      nodes: [{ id: "client:acme", x: 1000, y: 2000, orbitRadius: 5, orbitPhase: 0, parent: null }],
    };
    const s = scene({ layout: contradictory });
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].x, "the renderer recomputed the position from orbital parameters").toBe(1000);
    expect(s.nodes[0].y).toBe(2000);
  });

  it("radius comes from SpatialModel, not from anything the renderer decides", () => {
    const s = scene();
    for (const sp of SPATIAL.nodes) expect(find(s, sp.id)?.radius).toBe(sp.size);
  });
});

describe("DETERMINISTIC · the same inputs draw the same scene", () => {
  it("two builds are deeply equal", () => {
    expect(scene()).toEqual(scene());
  });

  it("the input is not mutated", () => {
    const before = JSON.stringify({ p: PROJECTION, s: SPATIAL, l: LAYOUT });
    scene();
    expect(JSON.stringify({ p: PROJECTION, s: SPATIAL, l: LAYOUT })).toBe(before);
  });
});

describe("A3 · the renderer says how a fact LOOKS, never what it MEANS", () => {
  it("health and attention become presentation, through taxonomy's existing map", () => {
    const sick = NODES.map((n) => n.id === "client:acme"
      ? { ...n, state: { health: "at_risk" as const, status: "overdue", attention: true } } : n);
    const s = scene({ projection: projectionOf(sick, EDGES) });
    expect(find(s, "client:acme")?.ring).toBe(healthColor("at_risk"));
    expect(find(s, "client:acme")?.emphasis).toBe(true);
  });

  it("a business fact changes APPEARANCE ONLY — never identity, position or the object set", () => {
    // The rule with the consequence. If a health band moved a node or added one, the picture would
    // be asserting something the business never said.
    const sick = NODES.map((n) => ({
      ...n, weight: 1,
      state: { health: "at_risk" as const, status: "overdue", attention: true },
      meta: [{ label: "Value", value: "$99,000" }],
    }));
    const loud = scene({ projection: projectionOf(sick, EDGES) });
    const calm = scene();
    expect(loud.nodes.map((n) => n.id)).toEqual(calm.nodes.map((n) => n.id));
    expect(loud.nodes.map((n) => [n.x, n.y])).toEqual(calm.nodes.map((n) => [n.x, n.y]));
    expect(loud.edges).toEqual(calm.edges);
    expect(loud.nodes.map((n) => n.ring), "the control failed — appearance did not change either")
      .not.toEqual(calm.nodes.map((n) => n.ring));
  });

  it("the scene carries no field that is not a copy or a taxonomy lookup", () => {
    // A classification the business never made would have to arrive as a NEW field. Pinning the key
    // set is what makes adding one a decision instead of a drift.
    expect(Object.keys(scene().nodes[0]).sort()).toEqual(
      ["color", "emphasis", "entity", "entityId", "glyph", "health", "id", "label", "meta",
       "radius", "ring", "shape", "visualType", "x", "y"]);
    expect(find(scene(), "client:acme")?.color).toBe(NODE_VISUAL.client.color);
  });
});

describe("LOD · presentation only, and structurally incapable of scoping", () => {
  it("a coarser level draws strictly FEWER objects — it can never widen", () => {
    const full = new Set(scene({ detail: "full" }).nodes.map((n) => n.id));
    const core = new Set(scene({ detail: "core" }).nodes.map((n) => n.id));
    expect(core.size, "the fixture does not exercise LOD").toBeLessThan(full.size);
    for (const id of core) expect(full.has(id), `${id} appears at core but not at full — LOD widened`).toBe(true);
  });

  it("it hides by TYPE, and the underlying authorized data is untouched", () => {
    const core = scene({ detail: "core" });
    expect(core.nodes.every((n) => n.visualType !== "task"), "a task survived the core level").toBe(true);
    // The inputs are unchanged: LOD narrows what is DRAWN, never what was READ.
    expect(SPATIAL.nodes.some((n) => n.visualType === "task")).toBe(true);
    expect(LAYOUT.nodes.some((n) => n.id.startsWith("task:"))).toBe(true);
  });

  it("an edge survives only when both of its endpoints are drawn", () => {
    for (const e of scene({ detail: "core" }).edges) {
      const ids = new Set(scene({ detail: "core" }).nodes.map((n) => n.id));
      const link = SPATIAL.edges.find((l) => l.id === e.id)!;
      expect(ids.has(link.source) && ids.has(link.target)).toBe(true);
    }
  });
});

// ─── THE PIPELINE WITNESS ──────────────────────────────────────────────────────────────────────
//
// Everything above accepts a LayoutModel as given. This block proves the renderer is wired to the
// REAL one: it starts at a GraphProjection, runs `toSpatialModel` and `computeGalaxyLayout`, and
// shows that a change made at the TOP of the pipeline arrives at the bottom in the shape those two
// functions dictate. A renderer fed a structurally similar fixture would pass every earlier test in
// this file and fail this one.
describe("END TO END · GraphProjection → SpatialModel → GalaxyLayout → Renderer", () => {
  it("the drawn positions are the ones GalaxyLayout produced for THIS projection", () => {
    const spatial = toSpatialModel(PROJECTION);
    const layout = computeGalaxyLayout(spatial);
    const s = buildScene({ projection: PROJECTION, spatial, layout, detail: "full" });
    for (const placed of layout.nodes) {
      expect(find(s, placed.id)?.x).toBe(placed.x);
      expect(find(s, placed.id)?.y).toBe(placed.y);
    }
  });

  it("the positions are NON-DEGENERATE — otherwise 'corresponds' means nothing", () => {
    const s = scene();
    expect(new Set(s.nodes.map((n) => `${n.x},${n.y}`)).size, "every object landed in the same place")
      .toBe(s.nodes.length);
    expect(s.nodes.some((n) => n.x !== 0 || n.y !== 0), "everything is at the origin").toBe(true);
  });

  it("A CHANGE AT THE TOP REACHES THE SCREEN, in the shape GalaxyLayout dictates", () => {
    // Adding a fifth sibling changes the ring's slot count, so GalaxyLayout re-phases every task on
    // it. The renderer holds no memory and computes nothing, so the scene must show the NEW layout
    // exactly — same ids, moved positions.
    const extra = node("task", "epsilon", 0.1);
    const grown = projectionOf([...NODES, extra], [...EDGES, edge("has_task", "phase:discovery", extra.id)]);
    const grownSpatial = toSpatialModel(grown);
    const grownLayout = computeGalaxyLayout(grownSpatial);
    const after = buildScene({ projection: grown, spatial: grownSpatial, layout: grownLayout, detail: "full" });

    expect(after.nodes.map((n) => n.id)).toContain("task:epsilon");
    for (const placed of grownLayout.nodes) {
      expect(find(after, placed.id)?.x, `${placed.id} does not match the recomputed layout`).toBe(placed.x);
    }
    // And the existing siblings genuinely moved — proving the scene followed the layout rather than
    // some cached or independently derived placement.
    const before = scene();
    const moved = TASKS.filter((t) => find(before, `task:${t}`)?.x !== find(after, `task:${t}`)?.x);
    expect(moved.length, "adding a sibling moved nothing — the scene is not following GalaxyLayout")
      .toBeGreaterThan(0);
  });

  it("an empty projection draws an empty scene, with honest bounds", () => {
    const empty = projectionOf([], []);
    const s = buildScene({
      projection: empty, spatial: toSpatialModel(empty),
      layout: computeGalaxyLayout(toSpatialModel(empty)), detail: "full",
    });
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

// ─── SLICE 5 · the visual vocabulary is EXPOSED, never invented ────────────────────────────────

describe("SHAPE AND GLYPH · taxonomy's vocabulary, carried through unchanged", () => {
  it("every node's shape and glyph are NODE_VISUAL's, for its own type", () => {
    const s = scene();
    for (const n of s.nodes) {
      expect(n.shape, `${n.id} has a shape taxonomy did not assign`).toBe(NODE_VISUAL[n.visualType].shape);
      expect(n.glyph).toBe(NODE_VISUAL[n.visualType].glyph);
      expect(n.color).toBe(NODE_VISUAL[n.visualType].color);
    }
  });

  it("the fixture spans several shapes — otherwise the mapping is trivially satisfied", () => {
    expect(new Set(scene().nodes.map((n) => n.shape)).size).toBeGreaterThan(2);
  });
});

describe("LABEL ORDER · significance without a threshold", () => {
  it("is every node, largest first, ties broken by id", () => {
    const s = scene();
    const expected = s.nodes.slice()
      .sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id)).map((n) => n.id);
    expect(s.labelOrder).toEqual(expected);
  });

  it("NO NODE IS CUT · ordering is not a classification", () => {
    // The legacy renderer gates labels on `weight >= 0.68`. A threshold would show up here as a
    // labelOrder shorter than the node list — every object still gets an order; the DETAIL LEVEL and
    // the pixel floor decide what is actually drawn.
    const s = scene();
    expect(s.labelOrder.slice().sort()).toEqual(s.nodes.map((n) => n.id).sort());
  });
});

describe("EDGES · relationship identity carried, never re-decided", () => {
  it("containment is SpatialModel's judgment, copied", () => {
    const s = scene();
    for (const e of s.edges) {
      const upstream = SPATIAL.edges.find((l) => l.id === e.id)!;
      expect(e.containment, `${e.id} was reclassified by the renderer`).toBe(upstream.containment);
      expect(e.kind).toBe(upstream.kind);
    }
  });

  it("the fixture holds BOTH classes — otherwise the styling rule is untestable", () => {
    const s = scene();
    expect(s.edges.some((e) => e.containment), "no containment edge").toBe(true);
    expect(s.edges.some((e) => !e.containment), "no lateral edge").toBe(true);
  });

  it("source and target trace to a real projection edge, in the stored direction", () => {
    for (const e of scene().edges) {
      const original = PROJECTION.edges.find((o) => o.id === e.id);
      expect(original, `${e.id} is not a projection edge`).toBeDefined();
      expect(e.source).toBe(original!.source);
      expect(e.target).toBe(original!.target);
    }
  });

  it("every endpoint is a node the scene actually drew", () => {
    const s = scene();
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const e of s.edges) {
      expect(ids.has(e.source) && ids.has(e.target), `${e.id} points at an object not on screen`).toBe(true);
    }
  });
});

describe("UPSTREAM IS READ-ONLY · presentation never writes back", () => {
  it("building the scene repeatedly leaves projection, spatial model and layout identical", () => {
    const before = JSON.stringify({ p: PROJECTION, s: SPATIAL, l: LAYOUT });
    scene(); scene({ detail: "core" }); scene({ detail: "full" });
    expect(JSON.stringify({ p: PROJECTION, s: SPATIAL, l: LAYOUT }),
      "a presentation pass mutated an upstream layer").toBe(before);
  });
});

// ─── SLICE 10 · BUSINESS IDENTITY, CARRIED ─────────────────────────────────────────────────────
//
// `entity` and `entityId` exist so a surface can ask `navigation/routing` where an object lives.
// They are COPIES. The alternative — splitting `SceneNode.id`, which is formatted `${type}:${id}` —
// is what these tests exist to make impossible to reach for.

describe("IDENTITY · entity and entityId are copied from the projection, never parsed", () => {
  it("every node carries the projection's own entity and entityId", () => {
    const s = scene();
    for (const n of NODES) {
      expect(find(s, n.id)?.entity, `${n.id} has the wrong entity`).toBe(n.entity);
      expect(find(s, n.id)?.entityId).toBe(n.entityId);
    }
  });

  it("AN entityId CONTAINING A COLON SURVIVES INTACT", () => {
    // The discriminating case. `${type}:${entityId}` is ambiguous the moment an entityId contains a
    // colon: `id.split(":")[1]` would return "odd" and lose ":slug", and `id.slice(id.indexOf(":")+1)`
    // would work only by accident of which colon it found. A carried field is simply right.
    const awkward: GraphNode = {
      ...node("client", "odd:slug"),
      entityId: "odd:slug",
    };
    const p = projectionOf([awkward], []);
    const s = buildScene({
      projection: p, spatial: toSpatialModel(p),
      layout: computeGalaxyLayout(toSpatialModel(p)), detail: "full",
    });
    expect(s.nodes[0].entityId, "the entityId was truncated at a colon").toBe("odd:slug");
    expect(s.nodes[0].id).toBe("client:odd:slug");
    // And the naive parse would have been wrong — stated so the test says WHY it matters.
    expect(s.nodes[0].id.split(":")[1]).not.toBe(s.nodes[0].entityId);
  });

  it("entity is copied from the projection's own entity field", () => {
    // HONEST LIMIT, RECORDED. Every `node(...)` call in graph-view/projection passes the same
    // literal for `type` and `entity` — `node("task", id, "task", …)` — so the two values coincide
    // everywhere, and NO fixture can distinguish "copied from entity" from "aliased to visualType".
    // A mutation doing the latter survives this suite, and saying so is worth more than a fixture
    // built to be invalid so a test could fail.
    //
    // They stay separate fields because their TYPES differ: `EntityKind` has 25 members and
    // `GraphNodeType` has 12, so `routeForEntity` takes the domain kind and would be wrong to take a
    // graph type. The distinction is real in the contract even where the values agree today.
    const s = scene();
    for (const n of NODES) expect(find(s, n.id)?.entity).toBe(n.entity);
  });
});

// ─── SLICE 11 · META, CARRIED VERBATIM ─────────────────────────────────────────────────────────

describe("META · copied from the projection, never composed here", () => {
  it("every node's pairs are the projection's own, identical and in order", () => {
    // Asserted at the SCENE level as well as in the DOM: a mutation reconstructing meta from
    // `state.status` reddened only the DOM suite, which meant the carrying itself had no direct
    // witness. Compared against the fixture's own objects, never against literals.
    const s = scene();
    for (const n of NODES) expect(find(s, n.id)?.meta, `${n.id}'s meta was not carried`).toEqual(n.meta);
  });

  it("the pairs are the SAME VALUES the projection holds, not a rebuilt equivalent", () => {
    const rich = { ...node("client", "acme"), meta: [
      { label: "Website", value: "https://acme.test/a?b=1" },
      { label: "Status", value: "active" },
    ] };
    const p = projectionOf([rich], []);
    const built = buildScene({
      projection: p, spatial: toSpatialModel(p),
      layout: computeGalaxyLayout(toSpatialModel(p)), detail: "full",
    });
    expect(built.nodes[0].meta).toEqual(rich.meta);
    // Order is part of the value: "Website" before "Status" is not alphabetical, so a sort anywhere
    // in the carrying path would show up here.
    expect(built.nodes[0].meta.map((m) => m.label)).toEqual(["Website", "Status"]);
  });

  it("a node with no meta carries an empty list, never a fabricated pair", () => {
    expect(find(scene(), "task:alpha")?.meta).toEqual([]);
  });
});
