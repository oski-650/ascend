// graph-view/galaxy — the GALAXY LAYOUT layer (UI-REDESIGN-PROPOSAL §2.8, §3.2, Slice 3).
//
//     GraphProjection  →  SpatialModel  →  GalaxyLayout  →  Renderer
//                                          ^^^^^^^^^^^^
//
// SpatialModel says what each object IS. This layer says WHERE IT GOES, and it is the first layer
// permitted to say so: F62 keeps coordinates out of business truth, F63 keeps them out of
// presentation space, and here they are the entire output. A coordinate remains an OUTPUT of the
// pipeline and never an input to a business fact — nothing above this file may import it, and F64
// enforces that.
//
// ─── NOT AN EXTRACTION, AND THAT MAKES IT DIFFERENT FROM SLICES 1 AND 2 ────────────────────────
//
// Slice 1 found GraphProjection already present as `GraphModel`; Slice 2 found SpatialModel fused
// into `SimNode`. Both were named rather than built. This layer is not in that position. A 2D layout
// DOES exist — components/graph/simulation.ts — but it answers the question by a different method:
// iterative force relaxation (repulsion, springs, velocity integration, alpha cooling). The proposal
// asks for the opposite: *"Orbital hierarchy is deterministic… Physics are constrained (no chaotic
// Newtonian instability)."* Closed-form orbital placement and iterative relaxation are two answers
// to one question, so this file reuses the simulation's INPUTS — the band table, the seed, the
// golden-angle idea — and none of its integrator.
//
// **There is no second integrator here.** No velocity, no acceleration, no damping, no convergence
// loop, no repulsion pass. Every position is computed in one pass from `id`, `visualType` and
// `parent`. F64 asserts the absence in source, and a test asserts it behaviourally: one call places
// every node, and calling twice changes nothing.
//
// ─── INERT BY DECISION (Slice 3, D1) ───────────────────────────────────────────────────────────
//
// Nothing imports this yet. Wiring it into the existing 2D canvas would replace the seeding the
// running graph settles from and move every node on screen, and the proposal puts the 3D renderer in
// a later slice anyway. So the layer is established, proven and left unconsumed on purpose. That is
// a deliberate difference from F63's rule that SpatialModel must have a live consumer: the consumer
// witness for THIS layer belongs to the slice that wires it.
//
// ─── WHAT THIS LAYER MUST NOT KNOW ─────────────────────────────────────────────────────────────
//
//   size, colour, shape, glyph       SpatialModel and taxonomy own them. Layout must not read `size`
//                                    at all — see the weight-independence rule below.
//   camera, fit, bounds, zoom        graph-view/viewport owns framing (D4).
//   DetailLevel, isVisibleAt         taxonomy owns level-of-detail (D4).
//   pinned, glow, hover, selection   interaction and renderer state (D4).
//   orbitSpeed                       STILL OMITTED. It is animation, and nothing requires orbital
//                                    motion yet.
//
// `z` AND `orbitInclination` ARRIVED IN SLICE 14. The note here used to omit them for want of "a
// renderer that could display them"; the ratified direction supplies one — the Galaxy is a genuinely
// three-dimensional galaxy of spheres, not a network diagram with a depth axis. Nothing renders them
// yet: this layer produces depth and stops, exactly as Slice 3 produced placement and stopped.
//
// ─── THE CELESTIAL HIERARCHY IS THE CONTAINMENT HIERARCHY ──────────────────────────────────────
//
// Sun, planet and moon are SPATIAL ROLES, not domain entities, and this layer invents none of them.
// An object orbits its `parent`, which `graph-view/spatial` derived from stored `has_*` foreign
// keys; a parentless object orbits the centre. Nesting therefore comes entirely from containment
// that an operator actually recorded.
//
// Two consequences worth stating rather than discovering later. The containment forest is exactly
// client → project → phase → task, so everything else — invoices, documents, approvals, audits,
// care plans, SOPs, prospects, opportunities — is parentless and orbits the centre directly. And the
// centre is an ANCHOR POINT, not an object: no node represents Ascend itself, and this layer will
// not fabricate one to complete a metaphor.
//
// ─── WEIGHT INDEPENDENCE, AND WHY IT IS A RULE RATHER THAN AN ACCIDENT ─────────────────────────
//
// Layout reads `id`, `visualType` and `parent`. It never reads `size`, and therefore never reads the
// `weight` that produced it, nor `state`, `label` or `meta`. If a coordinate moved because an
// invoice got larger or a project became at-risk, a business fact would have become readable from
// the picture — and §3.2 forbids exactly that: *"no business question may be answerable only by
// asking the renderer."* Spacing that widened a ring to fit bigger nodes would breach it, which is
// why spacing below is a function of COUNT and never of size.
//
// PURE: no fs, no env, no network, no database, no clock, no randomness, no events, no React, no
// Three.js, no mutable module state, and no mutation of the SpatialModel it is given.

import { spatialSeed, type SpatialModel, type SpatialNode } from "./spatial";
import { ORBITAL_BAND } from "./taxonomy";

/**
 * Minimum arc, in world units, between two objects sharing one orbit.
 *
 * A LAYOUT CONSTANT — chosen here, owned here, and the only kind of value this layer is allowed to
 * invent. It encodes no business meaning: it is a spacing floor, in the same sense that
 * EDGE_VISUAL's rest lengths are. Deliberately larger than the biggest node any taxonomy radius can
 * produce, so a ring never has to consult a node's size to stay legible.
 */
const MIN_ORBIT_ARC = 26;

/**
 * How far a system's orbital plane may tilt out of the reference plane, in radians (~34°).
 *
 * A LAYOUT CONSTANT, like MIN_ORBIT_ARC — chosen here, owned here, carrying no business meaning.
 * Without it every orbit is coplanar and the result is a disc seen edge-on: a 2D diagram with a
 * depth axis nobody uses. With it, each system sits on its own plane and the arrangement reads as a
 * galaxy. The bound is deliberately modest: a full ±90° would let systems stand on edge and cross
 * each other, which is noise rather than structure.
 */
const MAX_INCLINATION = 0.6;

/** Where a node with no parent orbits. The Ascend Core sits at the origin (§2.7). */
const ORIGIN = { x: 0, y: 0, z: 0 } as const;

/** Group key for the root system, kept distinct from any real node id. */
const ROOT_SYSTEM = "«core»";

export type LayoutNode = {
  /** SpatialNode.id, unchanged. */
  id: string;
  /** Absolute world X — the anchor's position plus this node's orbital offset. */
  x: number;
  /** Absolute world Y. */
  y: number;
  /** Absolute world Z. Depth, from the tilt of the system this object belongs to. */
  z: number;
  /** Distance from the ANCHOR (the parent, or the core), not from the origin. */
  orbitRadius: number;
  /** Angle in radians, [0, 2π), around the anchor. */
  orbitPhase: number;
  /**
   * The tilt of the orbital plane this object travels on, in radians.
   *
   * A PROPERTY OF THE SYSTEM, not of the object. Every child of one parent shares it, which is what
   * makes a system a system: its members lie on one plane, and that plane is angled differently from
   * its neighbours'. Derived per system from `spatialSeed`, so it is as stable and as reproducible
   * as the phase rotation beside it.
   */
  orbitInclination: number;
  /** SpatialNode.parent, carried so a consumer can draw the orbit it belongs to. */
  parent: string | null;
};

/**
 * No bounds, no camera, no extents. Framing is `graph-view/viewport`'s property (D4) and computing
 * it here would give it two owners — the mistake D2 and D3 avoided one layer up.
 */
export type LayoutModel = {
  nodes: LayoutNode[];
};

/**
 * SpatialModel → LayoutModel. Pure, total, deterministic, single-pass.
 *
 * Every SpatialNode yields exactly one LayoutNode. Nothing is filtered — filtering is a visibility
 * decision and this layer is no more a visibility authority than SpatialModel is.
 *
 * Input ORDER is preserved rather than canonicalised, matching SpatialModel. Determinism under a
 * shuffled input is therefore a property of the CONTENT, and the tests assert it that way. Only
 * `nodes` is read: `parent` is already resolved by SpatialModel, so edges cannot influence a
 * position here — lateral relationships are structurally incapable of creating an orbit.
 */
export function computeGalaxyLayout(model: SpatialModel): LayoutModel {
  const byId = new Map<string, SpatialNode>();
  for (const n of model.nodes) byId.set(n.id, n);

  // ── Systems: the set of nodes sharing one anchor. A parent that is not itself in the model is a
  // dangling reference — the node falls back to the core system rather than anchoring to something
  // absent. Nothing is fabricated to receive it; SpatialModel's own rule, applied one layer down.
  const systemOf = (n: SpatialNode): string =>
    n.parent !== null && byId.has(n.parent) ? n.parent : ROOT_SYSTEM;

  const systems = new Map<string, string[]>();
  for (const n of model.nodes) {
    const key = systemOf(n);
    const members = systems.get(key);
    if (members) members.push(n.id);
    else systems.set(key, [n.id]);
  }
  // Sorted by id so a slot depends on WHICH siblings exist, never on the order they arrived in.
  for (const members of systems.values()) members.sort();

  const slotOf = (n: SpatialNode): { slot: number; count: number } => {
    const members = systems.get(systemOf(n)) ?? [n.id];
    return { slot: members.indexOf(n.id), count: members.length };
  };

  /**
   * Even distribution around the anchor, rotated by a seed derived from the SYSTEM.
   *
   * Even spacing is what makes siblings non-overlapping without an iterative solver; the rotation is
   * what stops every system in the galaxy lining up on the same axis. Using the system's seed rather
   * than the node's own is deliberate — a per-node phase would collide, and resolving the collision
   * is precisely the iterative work D5 rules out.
   */
  /**
   * The tilt of a system's orbital plane.
   *
   * Keyed on the SYSTEM, from the same `spatialSeed` the phase rotation uses, under a different
   * key — so it is deterministic, reproducible across machines, and introduces no randomness. Per
   * system rather than per node is the whole point: a parent and its children lie on ONE plane, so a
   * system holds together as a system instead of scattering its members through space.
   */
  const inclinationOf = (n: SpatialNode): number =>
    (spatialSeed(`${systemOf(n)}:tilt`) - 0.5) * 2 * MAX_INCLINATION;

  const phaseOf = (n: SpatialNode): number => {
    const { slot, count } = slotOf(n);
    const rotation = spatialSeed(systemOf(n));
    return ((rotation + slot / count) % 1) * Math.PI * 2;
  };

  /**
   * The type's home band, widened only far enough that `count` objects fit at MIN_ORBIT_ARC apart.
   *
   * Closed form: circumference = count × arc, so radius = count × arc / 2π. One expression, no
   * iteration, no solver. It depends on the type and on how many siblings there are — never on any
   * node's size, and therefore never on `weight`.
   */
  const radiusOf = (n: SpatialNode): number => {
    const { count } = slotOf(n);
    return Math.max(ORBITAL_BAND[n.visualType], (count * MIN_ORBIT_ARC) / (Math.PI * 2));
  };

  // ── Absolute positions. A child orbits its parent's position, so the walk is up the containment
  // chain, memoised. A containment cycle cannot loop forever: a node already being resolved anchors
  // to the core instead. SpatialModel's parents come from directed foreign keys and should never
  // cycle — this is a totality guarantee, not an expectation.
  const placed = new Map<string, { x: number; y: number; z: number }>();
  const resolving = new Set<string>();

  const positionOf = (n: SpatialNode): { x: number; y: number; z: number } => {
    const cached = placed.get(n.id);
    if (cached) return cached;

    let anchor: { x: number; y: number; z: number } = ORIGIN;
    if (n.parent !== null && !resolving.has(n.id)) {
      const parent = byId.get(n.parent);
      if (parent) {
        resolving.add(n.id);
        anchor = positionOf(parent);
        resolving.delete(n.id);
      }
    }

    // A circle of `radius` around the anchor, on a plane tilted by the SYSTEM's inclination. The
    // tilt is a rotation about the anchor's X axis, so `x` is untouched while `y` and `z` share the
    // orbit between them: at zero tilt this reduces exactly to the 2D placement Slice 3 produced.
    //
    // Depth is inherited, not recomputed. A child's anchor is its parent's full 3D position, so a
    // moon sits on its planet's system, and the planet sits on its sun's — which is what makes the
    // nesting read as nested rather than as three unrelated clouds.
    const phase = phaseOf(n);
    const radius = radiusOf(n);
    const tilt = inclinationOf(n);
    const position = {
      x: anchor.x + Math.cos(phase) * radius,
      y: anchor.y + Math.sin(phase) * radius * Math.cos(tilt),
      z: anchor.z + Math.sin(phase) * radius * Math.sin(tilt),
    };
    placed.set(n.id, position);
    return position;
  };

  const nodes: LayoutNode[] = model.nodes.map((n) => {
    const { x, y, z } = positionOf(n);
    return {
      id: n.id, x, y, z,
      orbitRadius: radiusOf(n),
      orbitPhase: phaseOf(n),
      orbitInclination: inclinationOf(n),
      parent: n.parent,
    };
  });

  return { nodes };
}
