// SLICE 15 — THE CELESTIAL PRESENTATION MODEL.
//
// Every decision the 3D renderer makes is made here, so every decision is testable here — in plain
// Node, with no WebGL, at the same strength as the 2D witnesses that preceded it.
//
// ─── WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT ──────────────────────────────────────────────
//
// They prove the DESCRIPTORS: which spheres exist, what colour and size they are, what celestial
// role they carry, where they sit, and which relationships are drawn. That is the whole of the
// renderer's judgment.
//
// They do NOT prove that a ray intersects a sphere. Raycasting is three.js's, it needs a GPU, and
// there is no honest way to assert it here — so it is not asserted. What IS assertable is that a
// pick resolves to a real SceneNode id, and that is where the boundary is drawn.
//
// The fixture is adversarial on purpose: a three-level containment chain so depth is real, a lateral
// edge that must NOT create a role, two objects sharing a label stem and an id prefix with no edge
// between them, and one object placed at another's coordinates so proximity cannot be mistaken for
// hierarchy.

import { describe, expect, it } from "vitest";
import { toCelestialModel } from "@/components/galaxy/celestial";
import { buildScene, type Scene } from "@/components/galaxy/scene";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
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

const NODES: GraphNode[] = [
  node("client", "acme", 0.9),           // cluster — owns a solar system
  node("client", "acme-holdings", 0.8),  // star — same label stem and id prefix, NO edge
  node("project", "rebuild", 0.7),       // sun — a project IS a solar system
  node("phase", "discovery", 0.4),       // planet
  node("task", "alpha", 0.1),            // moon, depth 3
  node("invoice", "inv-1", 0.6),         // moon by type; lateral edge only, so no orbital parent
  node("sop", "handbook", 0.3),          // moon by type, and NOTHING anchors it — the unlit case
  node("prospect", "lead", 0.2),         // star — the field
];
const EDGES: GraphEdge[] = [
  edge("has_project", "client:acme", "project:rebuild"),
  edge("has_phase", "project:rebuild", "phase:discovery"),
  edge("has_task", "phase:discovery", "task:alpha"),
  edge("billed", "client:acme", "invoice:inv-1"),
];

const projectionOf = (nodes: GraphNode[], edges: GraphEdge[]): GraphProjection => ({
  nodes, edges, activity: [],
  source: { name: "test", builtAt: "2026-09-04T00:00:00Z", nodeCount: nodes.length, edgeCount: edges.length },
});

const PROJECTION = projectionOf(NODES, EDGES);
const SPATIAL = toSpatialModel(PROJECTION);
const LAYOUT = computeGalaxyLayout(SPATIAL);
const SCENE: Scene = buildScene({ projection: PROJECTION, spatial: SPATIAL, layout: LAYOUT, detail: "full" });

const model = () => toCelestialModel(SCENE);
const bodyOf = (id: string) => model().bodies.find((b) => b.id === id);

describe("TOTAL · one body per SceneNode, and no body without one", () => {
  it("the id sets are equal", () => {
    const m = model();
    expect(m.bodies.map((b) => b.id).sort()).toEqual(SCENE.nodes.map((n) => n.id).sort());
    expect(new Set(m.bodies.map((b) => b.id)).size, "an object was rendered twice")
      .toBe(SCENE.nodes.length);
  });

  it("NO FABRICATED SPHERE · every body traces to a scene node", () => {
    const real = new Set(SCENE.nodes.map((n) => n.id));
    for (const b of model().bodies) expect(real.has(b.id), `${b.id} was invented`).toBe(true);
  });

  it("THE ASCEND CORE IS NOT A BODY · it is chrome and never enters the model", () => {
    // The centre marker is drawn by the renderer at the origin. If it were ever a body it would
    // enter counts, picking and — through the same model — the operator's sense of what exists.
    const m = model();
    expect(m.bodies.map((b) => b.id).some((id) => /core|ascend|centre|center/i.test(id)),
      "a centre marker appeared in the body set").toBe(false);
    expect(m.bodies).toHaveLength(SCENE.nodes.length);
  });
});

describe("ROLE · declared per TYPE by taxonomy, and read from nothing else", () => {
  // ─── THIS BLOCK ASSERTED THE OPPOSITE, AND THE INVERSION IS THE RECORD ──────────────────────
  //
  // Role was derived from CONTAINMENT DEPTH until the vocabulary was stated plainly: projects are
  // suns, tasks are planets, SOPs are moons. Every one of those is a statement about a TYPE, and no
  // depth rule could ever have produced the third — a SOP has no parent at all, so it had no depth
  // to be read from. The old derivation was elegant and it answered a question nobody had asked.
  //
  // What did NOT change is the thing the old tests were really protecting: the role must not be
  // inferred from geometry, from a label, or from an edge that is not containment. Those cases are
  // all still here, inverted where the expected value moved and intact where it did not.
  //
  // Nor did the ban on type names in `celestial.ts` change. The role is LOOKED UP by `visualType`
  // from `CELESTIAL_ROLE`, exactly as the colour is looked up from `NODE_VISUAL` — one table in
  // taxonomy, where per-type visual decisions already live. F66 still asserts that ban and still
  // means something.
  it("project → SUN, task → PLANET, SOP → MOON — the vocabulary, stated by type", () => {
    expect(bodyOf("project:rebuild")?.role).toBe("sun");
    expect(bodyOf("task:alpha")?.role).toBe("planet");
    expect(bodyOf("sop:handbook")?.role).toBe("moon");
    expect(bodyOf("client:acme")?.role).toBe("cluster");
    expect(bodyOf("prospect:lead")?.role).toBe("star");
  });

  it("THE TABLE IS TOTAL · every node type has a body, and the model never invents one", () => {
    // A type added to the taxonomy without a role would fall out as `undefined` and be drawn at
    // NaN size. The table is typed `Record<GraphNodeType, …>` so this cannot compile wrong — this
    // asserts it cannot RUN wrong either, across every type the fixture can reach.
    for (const b of model().bodies) {
      expect(["cluster", "sun", "planet", "moon", "star"], `${b.id} has no body kind`)
        .toContain(b.role);
    }
  });

  it("A LATERAL RELATIONSHIP STILL CREATES NO ORBIT · the invoice hangs off the core", () => {
    // `billed` is a real foreign key joining a client to an invoice. It is not containment, and
    // treating it as such would make an invoice orbit the client that paid it. The invoice is drawn
    // as a moon because of its TYPE — and it still orbits the galactic centre, not the client,
    // which is the half that stayed with containment where it belongs.
    expect(bodyOf("invoice:inv-1")?.role, "the type vocabulary was not applied").toBe("moon");
    expect(bodyOf("invoice:inv-1")?.orbit?.anchorId, "a lateral edge produced an orbital parent")
      .toBeNull();
  });

  it("A CHILDLESS CLIENT IS STILL A CLUSTER · appearance does not depend on what it owns", () => {
    // `client:acme-holdings` is a client with no projects. Under the depth rule it was a lone STAR,
    // which meant one customer looked like a different kind of thing from another purely because
    // of how much work happened to be recorded against it — a business fact leaking into the
    // silhouette. Appearance follows the type, so both clients look alike.
    expect(bodyOf("client:acme-holdings")?.role).toBe("cluster");
    expect(bodyOf("client:acme")?.role).toBe("cluster");
    // And the one WITH a project still owns an orbit that the childless one does not.
    expect(bodyOf("project:rebuild")?.orbit?.anchorId).toBe("client:acme");
  });

  it("PROXIMITY CREATES NO ROLE · two bodies at identical coordinates stay unrelated", () => {
    // The invoice is moved exactly onto the phase. If position influenced hierarchy, one would
    // become the other's moon.
    const collided: Scene = {
      ...SCENE,
      nodes: SCENE.nodes.map((n) =>
        n.id === "invoice:inv-1"
          ? { ...n, ...(() => { const p = SCENE.nodes.find((x) => x.id === "phase:discovery")!;
                                return { x: p.x, y: p.y, z: p.z }; })() }
          : n),
    };
    const m = toCelestialModel(collided);
    expect(m.bodies.find((b) => b.id === "invoice:inv-1")?.role,
      "a body acquired a role by being drawn near another").toBe("moon");
  });

  it("the fixture exercises every role — otherwise the mapping is untested", () => {
    expect(new Set(model().bodies.map((b) => b.role)))
      .toEqual(new Set(["cluster", "sun", "planet", "moon", "star"]));
  });
});

describe("APPEARANCE · type colour is authoritative; size is presentation over the scene's radius", () => {
  it("colour is NODE_VISUAL's, for the node's own type", () => {
    for (const n of SCENE.nodes) {
      expect(bodyOf(n.id)?.color, `${n.id} has a colour taxonomy did not assign`)
        .toBe(NODE_VISUAL[n.visualType].color);
    }
  });

  it("SIZE SCALES THE SCENE'S RADIUS BY THE ROLE, deterministically", () => {
    const m = model();
    for (const b of m.bodies) {
      const scene = SCENE.nodes.find((n) => n.id === b.id)!;
      const ratio = b.radius / scene.radius;
      // Role multiplier x the global body scale, which bridges taxonomy's pixel-derived radii and
      // the layout's world distances.
      //
      // THE SHARED FACTOR WENT DOWN, AND THAT IS THE CORRECTION. It was raised to 4 on the reasoning
      // that a sun at twelve pixels was too small; measured afterwards, neighbouring bodies then
      // interpenetrated by 103 world units, because the ring spacing was calibrated when radii were
      // about ten. A luminous body reads by its GLOW, not its geometry, so the sphere shrinks and
      // `emissiveStrength` does the work — small core, large light.
      expect(ratio, `${b.id}'s scale is not a clean multiple of its scene radius`)
        .toBeCloseTo({ sun: 10.8, cluster: 7.2, planet: 1.0, moon: 0.5, star: 0.62 }[b.role] * 2.6, 9);
    }
  });

  it("THE HIERARCHY READS sun > cluster > planet > moon, and the GAPS are astronomical", () => {
    // A SUN IS THE LARGEST BODY, above the cluster that owns it. The only thing larger is the
    // centre of the galaxy, which is chrome and not a body at all.
    const sun = bodyOf("project:rebuild")!;
    const cluster = bodyOf("client:acme")!;
    const planet = bodyOf("task:alpha")!;
    const moon = bodyOf("sop:handbook")!;
    expect(sun.radius).toBeGreaterThan(cluster.radius);
    expect(cluster.radius).toBeGreaterThan(planet.radius);
    expect(planet.radius).toBeGreaterThan(moon.radius);
    // Ordering alone passed on the old flat scale, where a sun was 1.7x a planet and the whole
    // system read as beads of similar size. The GAP is the property, so the gap is asserted.
    expect(sun.radius / planet.radius, "a sun does not dominate its planets").toBeGreaterThan(4);
    expect(planet.radius / moon.radius, "a planet does not dominate its moons").toBeGreaterThan(2.5);
  });

  it("LIGHT NEEDS BOTH HALVES · a reflecting body AND something near it to reflect", () => {
    // The one place the two axes combine, and the combination is the point. A star shines whatever
    // is around it. A planet or a moon reflects — but only if there is a system to reflect; alone
    // in the field there is nothing shining on it, and drawing it lit would render it near-black.
    expect(bodyOf("project:rebuild")?.lit, "a sun is lit from outside").toBe(false);
    expect(bodyOf("client:acme")?.lit, "a cluster is lit from outside").toBe(false);
    expect(bodyOf("prospect:lead")?.lit, "a field star is lit from outside").toBe(false);
    // Inside a system: reflects, and there is something to reflect.
    expect(bodyOf("phase:discovery")?.lit, "a planet inside a system is not lit").toBe(true);
    expect(bodyOf("task:alpha")?.lit).toBe(true);
    // THE DISCRIMINATING CASE. Same type vocabulary as the invoice above — a MOON — but with no
    // anchor on screen. Role alone would light it; role plus containment correctly does not.
    expect(bodyOf("sop:handbook")?.role, "the fixture lost its unanchored moon").toBe("moon");
    expect(bodyOf("sop:handbook")?.lit, "a moon alone in the field was lit by nothing").toBe(false);
  });

  it("A SUN IS ALSO THE BRIGHTEST THING IN ITS NEIGHBOURHOOD", () => {
    expect(bodyOf("project:rebuild")!.emissiveStrength)
      .toBeGreaterThan(bodyOf("client:acme")!.emissiveStrength);
  });

  it("size carries no business meaning · a changed weight moves it only through taxonomy", () => {
    // `radius` came from taxonomy's nodeRadius; the role multiplier is applied on top and is the
    // same for every object of that role. Nothing here reads a business field.
    const m = model();
    const moons = m.bodies.filter((b) => b.role === "moon");
    expect(moons.length, "the fixture has no moons — this test is vacuous").toBeGreaterThan(0);
    for (const b of moons) {
      const scene = SCENE.nodes.find((n) => n.id === b.id)!;
      expect(b.radius).toBeCloseTo(scene.radius * 0.5 * 2.6, 9);
    }
  });
});

describe("POSITION · consumed, never recomputed", () => {
  it("every body sits exactly where the scene put it", () => {
    for (const n of SCENE.nodes) {
      const b = bodyOf(n.id)!;
      expect([b.x, b.y, b.z], `${n.id} was repositioned by the renderer`).toEqual([n.x, n.y, n.z]);
    }
  });

  it("the fixture has real depth — otherwise 'consumed' is trivially satisfiable", () => {
    expect(SCENE.nodes.some((n) => Math.abs(n.z) > 1), "the scene is flat").toBe(true);
  });
});

describe("RELATIONSHIPS · carried from the scene, never invented", () => {
  it("one link per scene edge, with the stored direction and classification", () => {
    const m = model();
    expect(m.links.map((l) => l.id).sort()).toEqual(SCENE.edges.map((e) => e.id).sort());
    for (const l of m.links) {
      const source = SCENE.edges.find((e) => e.id === l.id)!;
      expect(l.source).toBe(source.source);
      expect(l.target).toBe(source.target);
      expect(l.containment).toBe(source.containment);
    }
  });

  it("both classes are present — the styling distinction is testable", () => {
    const m = model();
    expect(m.links.some((l) => l.containment)).toBe(true);
    expect(m.links.some((l) => !l.containment)).toBe(true);
  });
});

describe("PURE · deterministic and non-mutating", () => {
  it("the same scene yields the same model", () => {
    expect(model()).toEqual(model());
  });

  it("does not mutate the scene it is given", () => {
    const before = JSON.stringify(SCENE);
    toCelestialModel(SCENE);
    expect(JSON.stringify(SCENE)).toBe(before);
  });

  it("an empty scene yields an empty model", () => {
    const empty = projectionOf([], []);
    const s = buildScene({
      projection: empty, spatial: toSpatialModel(empty),
      layout: computeGalaxyLayout(toSpatialModel(empty)), detail: "full",
    });
    expect(toCelestialModel(s)).toEqual({ bodies: [], links: [] });
  });
});

// ─── THE ORBIT ─────────────────────────────────────────────────────────────────────────────────
//
// The Galaxy moves, and this block is what stops that from becoming a second answer to where an
// object is. Everything the renderer needs to advance an orbit is carried here as values, and the
// composition it performs is stated once so it can be checked against the layout's own arithmetic:
//
//     world = anchor + rotateX(tilt) . rotateZ(theta) . (planeX, planeY, 0)
//
// At `theta = 0` that must land EXACTLY on the absolute position — otherwise the frame the operator
// sees is not the arrangement GalaxyLayout computed, and nothing else in this suite would notice.

describe("ORBIT · motion is a transform over the layout's answer, never a second answer", () => {
  it("THETA ZERO IS THE LAYOUT POSITION · the composition reproduces x/y/z exactly", () => {
    const m = model();
    const byId = new Map(m.bodies.map((b) => [b.id, b]));
    let checked = 0;
    for (const b of m.bodies) {
      if (!b.orbit) continue;
      const anchor = b.orbit.anchorId !== null ? byId.get(b.orbit.anchorId) : null;
      const ax = anchor?.x ?? 0;
      const ay = anchor?.y ?? 0;
      const az = anchor?.z ?? 0;
      expect(ax + b.orbit.planeX, `${b.id} x`).toBeCloseTo(b.x, 9);
      expect(ay + b.orbit.planeY * Math.cos(b.orbit.tilt), `${b.id} y`).toBeCloseTo(b.y, 9);
      expect(az + b.orbit.planeY * Math.sin(b.orbit.tilt), `${b.id} z`).toBeCloseTo(b.z, 9);
      checked++;
    }
    expect(checked, "no body in the fixture has an orbit — this test is vacuous").toBeGreaterThan(3);
  });

  it("MUTATION · a plane pair swapped for the absolute offset would fail the line above", () => {
    // The anti-vacuity control. `(x - ax, y - ay)` is the WORLD offset — the obvious wrong thing to
    // carry, and identical to the plane pair whenever the tilt is zero. It must differ here, or the
    // assertion above cannot tell a correct decomposition from a plausible one.
    const m = model();
    const byId = new Map(m.bodies.map((b) => [b.id, b]));
    const tilted = m.bodies.filter((b) => b.orbit && Math.abs(b.orbit.tilt) > 0.05);
    expect(tilted.length, "every orbit in the fixture is coplanar — the control proves nothing")
      .toBeGreaterThan(0);
    for (const b of tilted) {
      const anchor = b.orbit!.anchorId !== null ? byId.get(b.orbit!.anchorId) : null;
      expect(b.orbit!.planeY, `${b.id}: the plane pair equals the world offset`)
        .not.toBeCloseTo(b.y - (anchor?.y ?? 0), 6);
    }
  });

  it("EVERY VALUE IS COPIED from the scene — none is recomputed here", () => {
    for (const b of model().bodies) {
      const n = SCENE.nodes.find((x) => x.id === b.id)!;
      if (!b.orbit) continue;
      expect(b.orbit.planeX).toBe(n.orbitPlaneX);
      expect(b.orbit.planeY).toBe(n.orbitPlaneY);
      expect(b.orbit.tilt).toBe(n.orbitInclination);
      expect(b.orbit.speed).toBe(n.orbitSpeed);
      expect(b.orbit.anchorId).toBe(n.anchorId);
    }
  });

  it("AN UNANCHORED BODY GETS NO ORBIT · it cannot circle something that is not drawn", () => {
    // The honest case. A body's plane coordinates are measured against its anchor, so if the anchor
    // is not on screen there is nothing for the travel to be around — showing it circling an
    // invisible point would draw a relationship to somewhere the viewer cannot see. It is placed
    // where the layout put it and stays there.
    //
    // Constructed by REMOVING one node from a real scene rather than by reaching for a detail level
    // that happens to produce the shape. `core` does not orphan anything in this fixture — it drops
    // parents and children together — and a test that depended on which level orphans what would be
    // asserting the taxonomy's membership table, not this rule.
    const gap = "project:rebuild";
    const orphaned: Scene = {
      ...SCENE,
      nodes: SCENE.nodes.filter((n) => n.id !== gap),
      edges: SCENE.edges.filter((e) => e.source !== gap && e.target !== gap),
    };
    const stranded = orphaned.nodes.filter((n) => n.anchorId === gap);
    expect(stranded.length, "removing the project stranded nothing — this test is vacuous")
      .toBeGreaterThan(0);

    const m = toCelestialModel(orphaned);
    for (const o of stranded) {
      const body = m.bodies.find((b) => b.id === o.id)!;
      expect(body.orbit, `${o.id} orbits an object nobody can see`).toBeNull();
      // Still drawn, and still exactly where the layout put it. Losing the orbit must not lose the
      // object, and must not move it.
      expect(body.x, `${o.id} moved when it lost its anchor`).toBe(o.x);
      expect(body.y).toBe(o.y);
      expect(body.z).toBe(o.z);
    }

    // And a body whose anchor IS drawn keeps its orbit, so this is a discrimination rather than a
    // blanket "an incomplete scene does not move".
    const anchored = m.bodies.filter((b) => b.id !== gap && !stranded.some((o) => o.id === b.id));
    expect(anchored.length).toBeGreaterThan(0);
    for (const a of anchored) {
      expect(a.orbit, `${a.id} lost an orbit it should have kept`).not.toBeNull();
    }
  });
});

describe("BRIGHTNESS IS NOT SEVERITY · what makes a body burn, and what may not", () => {
  it("strength follows the ROLE, and every body of a role burns the same", () => {
    const byRole = new Map<string, number[]>();
    for (const b of model().bodies) {
      if (b.emphasis) continue;   // emphasis is a separate, declared addition — tested below
      const seen = byRole.get(b.role);
      if (seen) seen.push(b.emissiveStrength);
      else byRole.set(b.role, [b.emissiveStrength]);
    }
    expect(byRole.size, "the fixture exercises too few roles").toBeGreaterThan(2);
    for (const [role, values] of byRole) {
      expect(new Set(values).size, `${role} bodies burn at different strengths`).toBe(1);
    }
  });

  it("A BRIGHT BODY IS NEVER AN URGENT ONE · health cannot move it at all", () => {
    // The property the whole field exists under. `emissiveStrength` is what the eye is drawn to, so
    // if health could reach it, a red-flagged object would light up and the neutral colour rules
    // upstream would be defeated by the one channel nobody was policing.
    const alarming = NODES.map((n) => ({
      ...n,
      state: { health: "at_risk" as const, status: "overdue", attention: false },
    }));
    const projection = projectionOf(alarming, EDGES);
    const spatial = toSpatialModel(projection);
    const loud = toCelestialModel(buildScene({
      projection, spatial, layout: computeGalaxyLayout(spatial), detail: "full",
    }));
    for (const b of model().bodies) {
      const other = loud.bodies.find((x) => x.id === b.id)!;
      expect(other.emissiveStrength, `${b.id} burned brighter because it is at risk`)
        .toBe(b.emissiveStrength);
    }
    // The fixture really did carry the health through, so the equality above is a measurement.
    expect(loud.bodies.every((b) => b.health === "at_risk"), "the alarming fixture is not alarming")
      .toBe(true);
  });

  it("EMPHASIS DOES lift it — an owner's own flag, and it is declared", () => {
    const flagged = NODES.map((n) => ({
      ...n, state: { health: null, status: null, attention: true },
    }));
    const projection = projectionOf(flagged, EDGES);
    const spatial = toSpatialModel(projection);
    const lit = toCelestialModel(buildScene({
      projection, spatial, layout: computeGalaxyLayout(spatial), detail: "full",
    }));
    for (const b of model().bodies) {
      const other = lit.bodies.find((x) => x.id === b.id)!;
      expect(other.emissiveStrength, `${b.id} ignored an owner's flag`)
        .toBeGreaterThan(b.emissiveStrength);
    }
  });
});

// ─── NOTHING TOUCHES ───────────────────────────────────────────────────────────────────────────
//
// The one property that spans two layers, and therefore the one no single layer can assert.
//
// GalaxyLayout owns the SPACING (`MIN_ORBIT_ARC`, a world-unit floor between ring neighbours) and is
// deliberately blind to how big anything is drawn. This file owns the SIZE (`BODY_SCALE` times the
// role multiplier) and is deliberately blind to where anything is placed. That separation is right,
// and it means neither file can tell whether the bodies fit in the space.
//
// Both times this went wrong, it went wrong exactly there. `BODY_SCALE` was raised to 4 against a
// spacing floor calibrated for taxonomy's pixel radii, and neighbours interpenetrated by 103 world
// units. The floor was then raised and the root scatter was still pulling bodies inward, shrinking
// the arc it had just guaranteed, and two suns overlapped by 16. Every test in both files passed
// through both, because every test in both files looks at one layer.
//
// So the clearance is measured HERE, on a graph shaped like the real console, end to end.

describe("CLEARANCE · the bodies fit in the space the layout left them", () => {
  const DENSE = (() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let c = 0; c < 6; c++) {
      nodes.push(node("client", `c${c}`));
      for (let p = 0; p < 2; p++) {
        nodes.push(node("project", `p${c}${p}`));
        edges.push(edge("has_project", `client:c${c}`, `project:p${c}${p}`));
        for (let h = 0; h < 3; h++) {
          nodes.push(node("phase", `h${c}${p}${h}`));
          edges.push(edge("has_phase", `project:p${c}${p}`, `phase:h${c}${p}${h}`));
        }
      }
    }
    for (const [type, count] of [["invoice", 9], ["document", 7], ["prospect", 8]] as const)
      for (let i = 0; i < count; i++) nodes.push(node(type as GraphNodeType, `${type}${i}`));
    // ATTACHED artifacts. These are LATERAL edges that nonetheless place their target beside the
    // client (see ATTACHMENT in graph-view/spatial), so they land INSIDE a system rather than in the
    // open field — which is a clearance case the loose-artifact fixture above never exercised.
    for (let c = 0; c < 6; c++) {
      for (let a = 0; a < 3; a++) {
        nodes.push(node("audit", `a${c}${a}`));
        edges.push(edge("measured_by", `client:c${c}`, `audit:a${c}${a}`));
        nodes.push(node("approval", `v${c}${a}`));
        edges.push(edge("awaits_approval", `client:c${c}`, `approval:v${c}${a}`));
      }
    }
    const projection = projectionOf(nodes, edges);
    const spatial = toSpatialModel(projection);
    return toCelestialModel(buildScene({
      projection, spatial, layout: computeGalaxyLayout(spatial), detail: "full",
    }));
  })();

  const gap = (a: { x: number; y: number; z: number; radius: number },
               b: { x: number; y: number; z: number; radius: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - (a.radius + b.radius);

  it("the fixture is dense enough to be a test — many bodies, several rings, real nesting", () => {
    expect(DENSE.bodies.length).toBeGreaterThan(70);
    // The attached artifacts really did land inside a system rather than in the field — otherwise
    // the interpenetration check below is only measuring the loose-body case it already covered.
    const attached = DENSE.bodies.filter((b) => b.id.startsWith("audit:") || b.id.startsWith("approval:"));
    expect(attached.length, "no attached artifacts in the fixture").toBeGreaterThan(20);
    expect(attached.every((b) => b.orbit?.anchorId !== null),
      "an attached artifact is orbiting the core, not its client").toBe(true);
    expect(new Set(DENSE.bodies.map((b) => b.role)).size, "the fixture misses a role").toBe(5);
  });

  it("NO TWO BODIES INTERPENETRATE, anywhere in the graph", () => {
    let worst = Infinity;
    let pair = "";
    for (let i = 0; i < DENSE.bodies.length; i++) {
      for (let j = i + 1; j < DENSE.bodies.length; j++) {
        const d = gap(DENSE.bodies[i], DENSE.bodies[j]);
        if (d < worst) { worst = d; pair = `${DENSE.bodies[i].id} <-> ${DENSE.bodies[j].id}`; }
      }
    }
    expect(worst, `${pair} overlap by ${(-worst).toFixed(1)} world units`).toBeGreaterThan(0);
  });

  it("THE CONTROL · the measurement WOULD report an overlap", () => {
    // Without this, "worst > 0" passes on a gap function that cannot go negative — and the two
    // regressions this block exists for both produced a number this exact expression would have
    // caught, had anything been computing it.
    expect(gap({ x: 0, y: 0, z: 0, radius: 40 }, { x: 50, y: 0, z: 0, radius: 40 })).toBe(-30);
    expect(gap({ x: 0, y: 0, z: 0, radius: 10 }, { x: 50, y: 0, z: 0, radius: 10 })).toBe(30);
  });

  it("A BODY IS SMALL AGAINST THE FIELD · the glow carries it, not the geometry", () => {
    // The other half of the size decision, and the reason the clearance above is achievable at all.
    // If a future hand raises BODY_SCALE to make bodies "visible", this fails before the overlap
    // does — and the answer is emissive strength, which costs no space.
    const span = Math.max(...DENSE.bodies.map((b) => Math.hypot(b.x, b.y, b.z))) * 2;
    const biggest = Math.max(...DENSE.bodies.map((b) => b.radius));
    expect(span / biggest, "the bodies have grown large enough to crowd the field")
      .toBeGreaterThan(30);
  });
});

describe("THE GLOW REACHES IN PROPORTION TO THE BODY, not to a floor", () => {
  it("a star's glow reaches further than a field speck's, by a wide margin", () => {
    // The renderer floors the DRAWN halo at a fixed screen size so the smallest bodies survive the
    // scale-down. That floor becomes the size of everything unless the larger bodies clear it on
    // their own — which is exactly what happened after the prospect import, with three thousand
    // specks drawn larger than the clients around them. The margin is the property, not the order.
    const sun = bodyOf("project:rebuild")!;
    const cluster = bodyOf("client:acme")!;
    const speck = bodyOf("invoice:inv-1")!;
    expect(sun.halo).toBeGreaterThan(cluster.halo);
    expect(cluster.halo / speck.halo, "a field body's glow rivals a cluster's").toBeGreaterThan(3);
  });

  it("the glow always exceeds the body it surrounds — a halo inside its own sphere is invisible", () => {
    for (const b of model().bodies) {
      expect(b.halo, `${b.id}'s glow is smaller than its own radius`).toBeGreaterThan(b.radius);
    }
  });
});

describe("THE HIERARCHY SURVIVES BEING SCALED DOWN", () => {
  it("every role has its own screen floor, and they are ordered like the bodies are", () => {
    // ─── WHAT A SINGLE FLOOR DID, MEASURED ─────────────────────────────────────────────────────
    //
    // The galaxy is normalised to one size however much is in it, so a graph of three thousand
    // bodies draws each one about a hundred times smaller than a graph of thirty. A single floor
    // stops the smallest vanishing — and draws EVERYTHING that falls under it at the same size. On
    // the real graph a SUN fell under it, so suns, clusters and prospects came out as identical
    // specks and the entire size hierarchy collapsed at exactly the zoom where it matters most.
    const floorOf = (id: string) => bodyOf(id)!.minBody;
    expect(floorOf("project:rebuild"), "a sun's floor does not beat a cluster's")
      .toBeGreaterThan(floorOf("client:acme"));
    expect(floorOf("client:acme")).toBeGreaterThan(floorOf("task:alpha"));
    expect(floorOf("task:alpha")).toBeGreaterThan(floorOf("sop:handbook"));
    expect(floorOf("sop:handbook")).toBeGreaterThan(floorOf("prospect:lead"));
    // And the ranking is wide enough to SEE, not merely to sort by.
    expect(floorOf("project:rebuild") / floorOf("prospect:lead"),
      "a sun and a prospect are within a whisker of each other on screen").toBeGreaterThan(3);
  });

  it("the floor never shrinks a body that is already larger than it", () => {
    // The floor is a minimum, not a size. If it ever exceeded a body's own glow at close range it
    // would flatten the hierarchy in the other direction — every body drawn at its floor.
    for (const b of model().bodies) {
      expect(b.halo, `${b.id} has no glow to floor`).toBeGreaterThan(0);
      expect(b.minBody, `${b.id} has no screen floor`).toBeGreaterThan(0);
    }
  });
});
