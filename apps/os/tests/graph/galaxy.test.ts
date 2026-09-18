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

/**
 * GalaxyLayout's `scatter`, reimplemented from its documented definition rather than imported.
 *
 * It is module-private on purpose, and a test that imported it would be checking that a function
 * equals itself. This is `spatialSeed` followed by MurmurHash3's finalizer, written out here so the
 * closed-form assertion below is an INDEPENDENT recomputation — if the layout's mixing drifted, this
 * is where it shows.
 *
 * The avalanche is not cosmetic. FNV-1a has no final mixing step, so keys sharing a long prefix land
 * close together — and every `SpatialNode.id` shares a long prefix with every other id of its type.
 * See the `scatter` header in graph-view/galaxy for the measurements.
 */
function scatter(key: string): number {
  let h = Math.round(spatialSeed(key) * 0xffffffff) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}
/**
 * TRUE distance, in three dimensions.
 *
 * It measured `hypot(dx, dy)` until Slice 14, and every orbital-distance witness below went red the
 * moment depth arrived — correctly: a child is its orbitRadius from its parent in SPACE, and a 2D
 * measurement of a tilted orbit reads short by exactly the depth it ignores.
 */
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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
    // The reason siblings are put in a canonical order before slotting. Without it, the same six
    // tasks arriving in a different order would each land on a different phase and the graph would
    // reshuffle on every rebuild — deterministic per call, unstable across them, the worse failure.
    // The ORDER changed in the reference rebuild (alphabetical to seeded); this property did not,
    // and it is the property that mattered.
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
    //
    // ─── THE ORDER IS SEEDED, AND THIS TEST HAS TO KNOW WHY ────────────────────────────────────
    //
    // Slots were assigned in ALPHABETICAL id order until the reference rebuild. That was correct
    // about the property it was defending — a slot must depend on which siblings exist and never on
    // arrival order — and wrong about a consequence nobody measured: `id` is `${type}:${entityId}`,
    // so alphabetical order is TYPE order, and every renderer downstream colours by type. Measured
    // on a representative graph, the resulting ring was perfectly sorted by type: the picture was of
    // the alphabet. Ordering by a seed keeps determinism and the membership dependence, and breaks
    // the correlation. The control below is what makes this test able to tell the two apart.
    const members = TASKS.map((t) => `task:${t}`)
      .sort((a, b) => scatter(`slot:${a}`) - scatter(`slot:${b}`) || (a < b ? -1 : a > b ? 1 : 0));
    expect(members, "the seeded order equals the alphabetical one — this fixture cannot tell them apart")
      .not.toEqual(TASKS.map((t) => `task:${t}`).sort());
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

  it("orbitRadius is a FRACTION of the type's band, unless the ring had to widen for its siblings", () => {
    // ─── SYSTEM_SCALE, AND WHY THE BANDS ARE NO LONGER TAKEN LITERALLY ────────────────────────
    //
    // The bands (240–560) were chosen when every object orbited the core and they WERE the
    // arrangement. Once objects orbit their parents, those same numbers make one client's system
    // wider than the distance to the next root — measured: a phase sitting inside an unrelated
    // document, and a project ring wider than its own client's personal space. The ORDER of the
    // bands still decides which type sits outside which; only the magnitude is reinterpreted.
    const m = build();
    expect(at(m, "project:rebuild")?.orbitRadius).toBeCloseTo(ORBITAL_BAND.project * 2.6, 9);
    // Six tasks cannot fit on the scaled phase band, so this one is the ARC FLOOR, not the band —
    // which is the "unless" in the title, and the reason both halves are asserted.
    expect(at(m, "task:alpha")?.orbitRadius).toBeCloseTo((6 * 300) / (Math.PI * 2), 9);
    // The band it overrode is the CAPPED one: a task's ring may not exceed 0.3 of its phase's own
    // orbit, so the cap proposes 8 and the arc floor raises it to 92. Both limits are exercised
    // here, which is the point of naming them separately rather than asserting one number.
    const phaseRing = at(m, "phase:discovery")!.orbitRadius;
    expect(at(m, "task:alpha")!.orbitRadius, "the arc floor did not override the band")
      .toBeGreaterThan(Math.min(ORBITAL_BAND.task * 2.6, phaseRing * 0.55));
  });

  it("a LATERAL-only node gets no orbital parent and anchors to the core", () => {
    // `billed` is a real foreign key. It is not containment, and an invoice must not become a moon
    // of the client that paid it. If the containment rule ever widened, this is the red.
    const m = build();
    const inv = at(m, "invoice:inv-1")!;
    expect(inv.parent, "a lateral relationship produced an orbital parent").toBeNull();
    expect(dist(inv, { x: 0, y: 0, z: 0 }), "an unparented node is not in a core orbit")
      .toBeCloseTo(inv.orbitRadius, 9);
  });

  it("roots orbit the core, not each other", () => {
    for (const id of ["client:acme", "client:borden"]) {
      const n = at(build(), id)!;
      expect(n.parent).toBeNull();
      expect(dist(n, { x: 0, y: 0, z: 0 })).toBeCloseTo(n.orbitRadius, 9);
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
    // ─── THE FLOOR IS AN ARC; THIS MEASURES A CHORD ───────────────────────────────────────────
    //
    // MIN_ORBIT_ARC is arc length, and the straight-line distance between two points on a circle is
    // always shorter than the arc between them — for six siblings, by about 4.5%. Asserting the
    // chord against the arc was passing only because ORBITAL_BAND used to dominate this ring; the
    // moment the arc floor actually bound, it went red at 91.7 against 96, and it was RIGHT to.
    //
    // So this asserts the property the floor exists to produce, which is not an arc length at all:
    // no two bodies on a ring may touch. The largest drawn body is 9.5 (taxonomy) x 2.6 (sun role)
    // x 1.55 (body scale) = 38.3 in radius, so 77 in diameter, and `galaxy-celestial.test.ts`
    // measures the real clearance end to end. The exact spacing is pinned by the closed form below.
    // ─── AGAINST THE BODIES ON *THIS* RING, NOT THE BIGGEST IN THE GRAPH ─────────────────────
    //
    // This compared the chord to the largest drawn body anywhere, which was fine while every role
    // was within a factor of four — and became nonsense once a sun grew to ten times a task. A ring
    // of six TASKS has to clear a task, and holding it to a sun's diameter would have demanded a
    // ring twenty-seven times larger than anything needs.
    //
    // The end-to-end guarantee — that NO two bodies anywhere interpenetrate, across roles, systems
    // and the field — is measured in `galaxy-celestial.test.ts`, which is the only layer that can
    // see both the spacing and the sizes.
    const TASK_DIAMETER = 4.2 * (0.72 + 1 * 0.42) * 1.0 * 2.6 * 2;  // base x weight x role x scale
    expect(Math.min(...gaps), "two siblings on one ring are close enough to touch")
      .toBeGreaterThan(TASK_DIAMETER);
    // And the chord is exactly what the closed form says, so the floor itself has not drifted.
    const r = ring[0].orbitRadius;
    expect(Math.min(...gaps)).toBeCloseTo(2 * r * Math.sin(Math.PI / 6), 6);
    // Evenly spaced: every adjacent phase difference is the same 1/6 turn.
    const phases = ring.map((n) => n.orbitPhase).sort((a, b) => a - b);
    const deltas = phases.slice(1).map((p, i) => p - phases[i]);
    for (const d of deltas) expect(d).toBeCloseTo((Math.PI * 2) / 6, 9);
  });

  it("a crowded ring widens instead of packing tighter — closed form, not iteration", () => {
    // 200 siblings cannot fit on the task band at MIN_ORBIT_ARC apart, so the radius grows to
    // count × arc / 2π. One expression; no solver ran. The arc moved from 26 to 96 in the reference
    // rebuild — it had been stated in taxonomy's pixel units against ORBITAL_BAND's world units, and
    // bodies overlapped. The closed form is what this test is about and it did not change.
    const many = Array.from({ length: 200 }, (_, i) => node("task", `t${i}`));
    const m = computeGalaxyLayout(toSpatialModel({
      nodes: [node("phase", "big"), ...many],
      edges: many.map((t) => edge("has_task", "phase:big", t.id)),
    }));
    const ring = many.map((t) => at(m, t.id)!);
    expect(ring[0].orbitRadius, "the ring did not widen for 200 siblings")
      .toBeGreaterThan(ORBITAL_BAND.task);
    expect(ring[0].orbitRadius).toBeCloseTo((200 * 300) / (Math.PI * 2), 9);
    const gaps: number[] = [];
    for (let i = 1; i < ring.length; i++) gaps.push(dist(ring[i - 1], ring[i]));
    // The CHORD between neighbours, which is always a shade under the arc — by 0.004% at 200
    // siblings. Asserted against the arc with that tolerance rather than against a round number,
    // because a bare `> 300` fails on 299.99 for a reason that has nothing to do with spacing.
    expect(Math.min(...gaps), "the widened ring still overlaps").toBeGreaterThan(300 * 0.999);
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
    // ─── THIS MOVED FROM A ROOT TO A SYSTEM MEMBER, AND THE REASON IS THE TEST ─────────────────
    //
    // It used to retype `client:borden`, a ROOT, and assert its band changed. Roots no longer take
    // their radius from ORBITAL_BAND at all: with thousands of them the difference between two
    // bands is a rounding error against the disc the count requires, so the band became a RADIAL
    // ORDERING for roots and a DISTANCE only inside a system. The property this test exists for —
    // that the layout reads type at all, so the weight-independence above is not vacuous — is
    // unchanged, and is now asserted where the band still sets a distance.
    const retyped = NODES.map((n) => (n.id === "project:rebuild" ? { ...n, type: "sop" as const } : n));
    const m = computeGalaxyLayout(toSpatialModel({ nodes: retyped, edges: EDGES }));
    expect(at(m, "project:rebuild")?.orbitRadius, "type does not affect the band — ORBITAL_BAND is unused")
      .not.toBe(at(build(), "project:rebuild")?.orbitRadius);
  });

  it("and a ROOT's band sets its RANK in the disc, not its distance", () => {
    // The other half, so "roots ignore ORBITAL_BAND" cannot quietly become "roots ignore type".
    // A type with an inner band lands nearer the core than one with an outer band — which is how
    // thousands of prospects become a dense nucleus instead of a shell around everything else.
    const inner = ORBITAL_BAND.prospect;
    const outer = ORBITAL_BAND.sop;
    expect(inner, "the fixture's two bands are not ordered — this test proves nothing")
      .toBeLessThan(outer);
    const roots = [
      ...Array.from({ length: 6 }, (_, i) => node("prospect", `p${i}`)),
      ...Array.from({ length: 6 }, (_, i) => node("sop", `s${i}`)),
    ];
    const m = computeGalaxyLayout(toSpatialModel({ nodes: roots, edges: [] }));
    const mean = (prefix: string) => {
      const rs = m.nodes.filter((n) => n.id.startsWith(prefix)).map((n) => n.orbitRadius);
      return rs.reduce((a, b) => a + b, 0) / rs.length;
    };
    expect(mean("prospect:"), "the inner-banded type did not land nearer the core")
      .toBeLessThan(mean("sop:"));
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
    // `z` and `orbitInclination` left this list in Slice 14 — they are now what the layer produces.
    //
    // ─── `orbitSpeed` LEFT IT IN THE REFERENCE REBUILD, AND THE BAN IT LEFT IS INTACT ──────────
    //
    // It was banned here with the note "it is animation, and no layer owns it". The first half was a
    // conflation and the second stopped being true. A RATE is not animation: animation needs a
    // clock, and there is still no clock in this layer, in SpatialModel, in the scene, or in the
    // celestial model — `PURITY` above and F65's one-clock rule both still hold, unweakened.
    //
    // What this list is actually defending is that no INTEGRATOR state appears: no velocity, no
    // force, no accumulated alpha, no pin, nothing whose value depends on how many times the layer
    // has been run. `orbitSpeed` is none of those. It is a closed form of `orbitRadius`, it is
    // emitted identically on every call, and `is settled on the first call` below proves exactly
    // that by deep-equalling two independent runs — the property the ban existed to protect.
    //
    // `vx`/`vy`/`alpha`/`pinned`/`glow` stay banned, and they are the whole of the original point.
    for (const k of ["vx", "vy", "alpha", "pinned", "glow", "size", "degree"]) {
      expect(keys.has(k), `GalaxyLayout emitted \`${k}\``).toBe(false);
    }
    expect([...keys].sort()).toEqual(
      ["id", "orbitInclination", "orbitPhase", "orbitPlaneX", "orbitPlaneY", "orbitRadius",
       "orbitSpeed", "parent", "x", "y", "z"]);
  });

  it("NO CLOCK · a rate is emitted, and nothing in this layer can read the time", () => {
    // The distinction the entry above turns on, asserted rather than argued. If a clock ever entered
    // this layer, two runs a millisecond apart would differ — and the module would have stopped
    // being a pure function of its input while still returning plausible numbers.
    const a = computeGalaxyLayout(SPATIAL());
    const b = computeGalaxyLayout(SPATIAL());
    expect(a).toEqual(b);
    for (const n of a.nodes) {
      expect(Number.isFinite(n.orbitSpeed), `${n.id} has no finite rate`).toBe(true);
      expect(n.orbitSpeed, `${n.id} is frozen`).toBeGreaterThan(0);
    }
  });

  it("THE DECOMPOSITION IS THE POSITION · anchor + rotateX(tilt)·(planeX, planeY, 0) === x/y/z", () => {
    // The invariant every moving surface downstream depends on, and the one that would rot in
    // silence. A renderer nests three groups and lets three.js multiply the matrices; at theta = 0
    // that composition must land EXACTLY where this layer says the object is. If the plane pair and
    // the absolute triple ever disagree, the picture stops being the layout's answer and no other
    // test in this file would notice — every position would still be finite, stable and plausible.
    const m = build();
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    for (const n of m.nodes) {
      const anchor = n.parent !== null ? byId.get(n.parent) : undefined;
      const ax = anchor?.x ?? 0;
      const ay = anchor?.y ?? 0;
      const az = anchor?.z ?? 0;
      // rotateX(tilt) applied to (planeX, planeY, 0).
      expect(ax + n.orbitPlaneX, `${n.id} x`).toBeCloseTo(n.x, 9);
      expect(ay + n.orbitPlaneY * Math.cos(n.orbitInclination), `${n.id} y`).toBeCloseTo(n.y, 9);
      expect(az + n.orbitPlaneY * Math.sin(n.orbitInclination), `${n.id} z`).toBeCloseTo(n.z, 9);
    }
  });

  it("MUTATION · a plane pair that ignored the phase would be caught by the line above", () => {
    // The anti-vacuity control for the invariant. Recomputing the composition from `orbitPhase` and
    // `orbitRadius` — the form the plane pair replaced — must land in the same place. If it did not,
    // the two would already be disagreeing and the assertion above would be measuring nothing.
    for (const n of build().nodes) {
      expect(Math.cos(n.orbitPhase) * n.orbitRadius, `${n.id} planeX`).toBeCloseTo(n.orbitPlaneX, 9);
      expect(Math.sin(n.orbitPhase) * n.orbitRadius, `${n.id} planeY`).toBeCloseTo(n.orbitPlaneY, 9);
    }
  });

  it("INNER BODIES ARE FASTER · the rate falls with the radius, which is what reads as bound", () => {
    // A constant rate would make the whole field turn as one rigid piece — a spinning decal, not a
    // system. The relation is the only property asserted; the constant is not, so retuning it is
    // free and breaking the relation is not.
    const nodes = [...build().nodes].sort((a, b) => a.orbitRadius - b.orbitRadius);
    const inner = nodes[0];
    const outer = nodes[nodes.length - 1];
    expect(outer.orbitRadius, "the fixture has no radius spread — this test is vacuous")
      .toBeGreaterThan(inner.orbitRadius * 1.5);
    expect(inner.orbitSpeed, "an inner body is not faster than an outer one")
      .toBeGreaterThan(outer.orbitSpeed);
  });

  it("EVERYTHING CO-ROTATES · no body travels against the field", () => {
    for (const n of build().nodes) {
      expect(n.orbitSpeed, `${n.id} counter-rotates`).toBeGreaterThan(0);
    }
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
    expect(dist(m.nodes[0], { x: 0, y: 0, z: 0 })).toBeCloseTo(m.nodes[0].orbitRadius, 9);
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

// ─── SLICE 14 · DEPTH ──────────────────────────────────────────────────────────────────────────
//
// Depth is what turns a disc into a galaxy, and the ways it can go wrong are specific: it can be
// random (unreproducible), degenerate (a depth axis nobody uses), per-node (systems scatter instead
// of holding together), or derived from a business field (a coordinate encoding a fact). Each has a
// witness, and the fixture is built so a wrong implementation reads differently rather than not at
// all — several systems, so inclinations must differ; a three-level chain, so inheritance shows.

describe("DEPTH · deterministic, seed-derived, and non-degenerate", () => {
  it("the same projection yields the same z, exactly", () => {
    const a = build().nodes.map((n) => n.z);
    const b = build().nodes.map((n) => n.z);
    expect(b).toEqual(a);
  });

  it("z is NOT all zero and NOT all equal — the depth axis is actually used", () => {
    // The degenerate failure: a `z` field that exists and is always 0 satisfies every determinism
    // assertion and leaves the galaxy flat.
    const zs = build().nodes.map((n) => n.z);
    expect(zs.some((z) => Math.abs(z) > 1), "every object lies on one plane — there is no depth")
      .toBe(true);
    expect(new Set(zs.map((z) => z.toFixed(6))).size, "every object shares one depth")
      .toBeGreaterThan(1);
  });

  it("INCLINATION IS A PROPERTY OF THE SYSTEM · siblings share it, and it is not per node", () => {
    // The discriminating case. Six tasks orbit one phase: a per-node inclination would give each its
    // own plane and the system would scatter. They must share one value exactly.
    const m = build();
    const siblings = TASKS.map((t) => m.nodes.find((n) => n.id === `task:${t}`)!);
    for (const s of siblings) {
      expect(s.orbitInclination, "siblings do not share their system's plane")
        .toBe(siblings[0].orbitInclination);
    }
  });

  it("different systems tilt differently — otherwise every orbit is coplanar", () => {
    const m = build();
    const taskPlane = m.nodes.find((n) => n.id === "task:alpha")!.orbitInclination;
    const rootPlane = m.nodes.find((n) => n.id === "client:acme")!.orbitInclination;
    expect(taskPlane, "the task system and the root system share one plane").not.toBe(rootPlane);
  });

  it("DEPTH IS INHERITED · a child's system sits on its parent's position, in all three axes", () => {
    // A moon on its planet, a planet on its sun. Measured as true 3D distance: a child is exactly
    // its orbitRadius from its parent in space, which only holds if depth was carried down the
    // chain rather than recomputed from the origin.
    const m = build();
    for (const [child, parent] of [
      ["project:rebuild", "client:acme"],
      ["phase:discovery", "project:rebuild"],
      ["task:alpha", "phase:discovery"],
    ] as [string, string][]) {
      const c = m.nodes.find((n) => n.id === child)!;
      const p = m.nodes.find((n) => n.id === parent)!;
      expect(dist(c, p), `${child} is not in a 3D orbit around ${parent}`).toBeCloseTo(c.orbitRadius, 9);
    }
  });

  it("a system's plane is stable across a shuffled input", () => {
    const shuffled = computeGalaxyLayout(
      toSpatialModel({ nodes: [...NODES].reverse(), edges: [...EDGES].reverse() })
    );
    for (const n of build().nodes) {
      const other = shuffled.nodes.find((x) => x.id === n.id)!;
      expect(other.z).toBe(n.z);
      expect(other.orbitInclination).toBe(n.orbitInclination);
    }
  });

  it("inclination stays inside the declared bound", () => {
    for (const n of build().nodes) {
      expect(Math.abs(n.orbitInclination), "a system tilted past the bound").toBeLessThanOrEqual(0.6);
    }
  });

  it("MUTATION · a Math.random depth fails the equality the block above relies on", () => {
    const mutant = () => ({ nodes: NODES.map((n) => ({ id: n.id, z: Math.random() })) });
    expect(mutant(), "a randomised depth compared equal — determinism is not being measured")
      .not.toEqual(mutant());
  });

  it("BUSINESS FIELDS STILL DO NOT REACH THE COORDINATES · z included", () => {
    // Slice 3's rule, extended to the axis it did not have. If depth moved because an invoice grew,
    // a business fact would be readable from the picture.
    const loud = NODES.map((n) => ({
      ...n, weight: 1,
      state: { health: "at_risk" as const, status: "overdue", attention: true },
      meta: [{ label: "Value", value: "$99,000" }],
    }));
    const shifted = computeGalaxyLayout(toSpatialModel({ nodes: loud, edges: EDGES }));
    for (const n of build().nodes) {
      const other = shifted.nodes.find((x) => x.id === n.id)!;
      expect(other.z, `${n.id}'s depth moved with a business field`).toBe(n.z);
      expect(other.orbitInclination).toBe(n.orbitInclination);
    }
  });
});

// ─── THE ROOT FIELD ────────────────────────────────────────────────────────────────────────────
//
// Three defects were MEASURED on a representative graph before this block existed, and each one was
// invisible to every test that already passed:
//
//   1. all twenty-seven root bodies shared one inclination, -0.500 — a hoop standing at an angle
//   2. all of them sat at one radius — the same hoop, perfectly circular
//   3. the ring was sorted by type, because slots were alphabetical and ids begin with the type
//
// None of them is a correctness failure and all three are visible from across the room. They are
// here because "deterministic, bounded and reproducible" was the whole of what the layout was asked
// to prove, and a hoop satisfies every word of it.
//
// The fixture is deliberately larger than the file's shared one: twelve roots of four types. Three
// roots can differ by accident; twelve cannot, and four types are enough for a type-sorted ring to
// be distinguishable from an unsorted one.

describe("THE ROOT FIELD · parentless objects are a volume, not a hoop", () => {
  const ROOT_TYPES = ["client", "invoice", "document", "prospect"] as const;
  const ROOTS: GraphNode[] = ROOT_TYPES.flatMap((type, t) =>
    [0, 1, 2].map((i) => node(type, `r${t}${i}`, 0.5))
  );
  const field = () => computeGalaxyLayout(toSpatialModel({ nodes: ROOTS, edges: [] }));

  it("the fixture is what it claims — twelve roots, four types, no parents", () => {
    const m = field();
    expect(m.nodes).toHaveLength(12);
    expect(m.nodes.every((n) => n.parent === null)).toBe(true);
    expect(new Set(ROOTS.map((n) => n.type)).size).toBe(4);
  });

  it("DEFECT 1 · roots do NOT share one orbital plane", () => {
    // A tilt is a property of a SYSTEM: a parent and its children lie on one plane, which is what
    // makes a system read as a system. Roots share no parent, so there is no system for them to be
    // a property of — and keying them on the group gave twelve bodies one tilt and one flat ring.
    const tilts = new Set(field().nodes.map((n) => n.orbitInclination));
    expect(tilts.size, "every root shares one plane — the root field is a flat ring").toBeGreaterThan(6);
  });

  it("DEFECT 2 · roots do NOT all sit at one distance", () => {
    const radii = new Set(field().nodes.map((n) => Number(n.orbitRadius.toFixed(6))));
    expect(radii.size, "every root sits at one radius — the root field is a circle").toBeGreaterThan(6);
  });

  it("the scatter is BOUNDED · nothing lands on the core and nothing escapes the band", () => {
    // The other half of defect 2. A scatter with no bound would fix the picture by destroying the
    // thing the bands exist for, and a spread of 1.0 would put a body at the origin, inside the core
    // marker. Stated as a ratio against the unscattered band so retuning the bands cannot break it.
    //
    // Measured against EACH TYPE'S OWN BAND rather than against a pooled median. The first version
    // of this test used the median of all twelve radii, which conflated two different things: four
    // types sit on four different `ORBITAL_BAND` distances, so a body one band out looked like a
    // body that had escaped its own. A bound has to be stated against the thing it bounds.
    // ─── THE BOUND IS ON THE DISC, NOT ON A BAND ─────────────────────────────────────────────
    //
    // This asserted a ratio against ORBITAL_BAND while roots still sat on a ring. They now fill a
    // DISC whose extent comes from the COUNT, so the two bounds that matter are: nothing lands in
    // the core's clear zone, and the disc is no bigger than the spacing its population needs.
    const radii = field().nodes.map((n) => n.orbitRadius);
    for (const r of radii) {
      expect(r, "a root landed inside the core's clear zone").toBeGreaterThanOrEqual(3400);
    }
    // √N growth, stated as the closed form rather than as a magic number: N bodies at SEPARATION
    // apart need a disc of `SEPARATION·√(N/π)`. A ring would be linear in N and would fail this by
    // a factor of six at twelve roots, and by fifty at three thousand.
    const span = 3400 * Math.sqrt(field().nodes.length / Math.PI);
    expect(Math.max(...radii), "the disc is larger than its population needs")
      .toBeLessThanOrEqual(3400 + span + 1e-9);
    // And it really is a spread, not twelve bodies stacked on the inner edge.
    expect(Math.max(...radii) - Math.min(...radii), "the disc has no radial extent")
      .toBeGreaterThan(span * 0.5);
  });

  it("DEFECT 3 · the ring is NOT ordered by type", () => {
    // Ids are `${type}:${entityId}` and every renderer downstream colours by type, so an
    // alphabetical slot order lays the colours down in contiguous arcs. The assertion is on the
    // ARRANGEMENT, not on the ordering function: sort the roots by where they were actually placed
    // and check that the types are interleaved rather than grouped.
    const byPhase = [...field().nodes].sort((a, b) => a.orbitPhase - b.orbitPhase);
    const types = byPhase.map((n) => ROOTS.find((r) => r.id === n.id)!.type);
    const runs = types.filter((t, i) => i === 0 || t !== types[i - 1]).length;
    // Four types perfectly grouped give four runs. Anything materially above that is interleaved.
    expect(runs, `the ring is banded by type: ${types.join(" ")}`).toBeGreaterThan(6);
  });

  it("THE CONTROL · the run counter would REPORT a type-banded ring", () => {
    // Without this, `runs > 6` passes on a counter that cannot count. Same shape as the assertion
    // above, applied to the arrangement the old alphabetical order produced.
    const banded = ["client", "client", "client", "document", "document", "document",
                    "invoice", "invoice", "invoice", "prospect", "prospect", "prospect"];
    expect(banded.filter((t, i) => i === 0 || t !== banded[i - 1]).length).toBe(4);
  });

  it("STILL DETERMINISTIC · the whole field is reproducible under a shuffled input", () => {
    // Everything above trades a regular arrangement for an irregular one. None of it may be bought
    // with randomness: the scatter, the tilts and the slots are all seed-derived, so a shuffled
    // input must produce an identical field down to the last digit.
    const shuffled = computeGalaxyLayout(toSpatialModel({ nodes: [...ROOTS].reverse(), edges: [] }));
    const sorted = (m: LayoutModel) => [...m.nodes].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted(shuffled)).toEqual(sorted(field()));
  });
});
