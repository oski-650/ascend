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
 * EDGE_VISUAL's rest lengths are.
 *
 * ─── IT WAS 26, AND 26 WAS STATED IN THE WRONG UNITS ───────────────────────────────────────────
 *
 * The original justification read: "deliberately larger than the biggest node any taxonomy radius
 * can produce, so a ring never has to consult a node's size to stay legible." Taxonomy's radii run
 * 3.2 to 9.5, so 26 cleared the largest of them comfortably — and those are PIXEL radii for the 2D
 * painter, while ORBITAL_BAND's distances are WORLD units. The floor was compared against a number
 * from a different unit system, and it read as generous while being roughly a quarter of what it
 * needed to be. Measured on a representative graph, two suns interpenetrated.
 *
 * This layer must not know the presentation scale — that decision belongs downstream and moves
 * without asking. So the floor is set with HEADROOM over what any plausible renderer scales the
 * largest taxonomy radius to, and the actual clearance is asserted where both numbers are visible:
 * `galaxy-celestial.test.ts` measures real surface gaps on a realistic graph and fails if anything
 * overlaps. A constant chosen by argument, and a bound enforced by measurement.
 */
const MIN_ORBIT_ARC = 300;

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

/**
 * The root field is a DISC, and its size grows with the square root of how much is in it.
 *
 * ─── WHAT WAS MEASURED, AND WHY THE RING HAD TO GO ─────────────────────────────────────────────
 *
 * Every root shared one ring, whose radius was `count × MIN_ORBIT_ARC / 2π` — LINEAR in the number
 * of objects. That is correct for six siblings around a phase and absurd for a business: the real
 * console holds 3,226 objects and 3,204 of them are parentless, which put the ring at radius 49,000
 * and every object outside the camera's far plane. The surface rendered pure black, threw nothing,
 * and logged nothing. It had been designed against a fixture of 83.
 *
 * A ring is the wrong shape for a population. Spreading N points over an AREA instead of a
 * circumference makes the extent grow as √N — 3,226 objects land at radius 4,266 instead of 49,000,
 * and six roots still sit comfortably apart. The spacing floor is preserved exactly: area per point
 * is `π·span²/N`, so a nearest-neighbour distance of at least MIN_ORBIT_ARC needs
 * `span ≥ ARC·√(N/π)`, which is what this computes. One expression, no solver, no iteration.
 *
 * SEPARATION is what that nearest-neighbour distance should BE. It is not MIN_ORBIT_ARC: two roots
 * are not two siblings on a ring, they are two independent systems, and the gap between them has to
 * hold whatever orbits each of them. Sized against a system's full extent, with margin.
 */
const ROOT_SEPARATION = 3400;

/**
 * How much of its type's ORBITAL_BAND a SYSTEM actually uses.
 *
 * ─── A SOLAR SYSTEM IS TINY COMPARED TO THE GAP BETWEEN STARS ──────────────────────────────────
 *
 * The bands run 240 to 560, which was chosen when every object orbited the core and the bands WERE
 * the arrangement. Once objects orbit their parents, the same numbers make a single client's system
 * about 700 units across — wider than the distance to the next root — so projects and phases were
 * measured sitting inside unrelated documents, and a system was not distinguishable from the field
 * it was drawn in.
 *
 * Scaling the bands down for systems only is what makes a system read as a SYSTEM: a tight cluster
 * with clear space around it, orbiting inside a much larger field. The relative order of the bands
 * is untouched — a phase still sits outside its project — so taxonomy's decision survives intact and
 * only its magnitude is reinterpreted for a nested arrangement it predates.
 *
 * MIN_ORBIT_ARC still overrides this whenever a system has enough members to need the room, so a
 * crowded ring still widens rather than packing tighter.
 *
 * IT WENT UP FROM 0.3 WHEN THE METAPHOR CHANGED, and the measurement is why. A project became a
 * SOLAR SYSTEM rather than a planet, so the body at the centre of a client's cluster grew — and its
 * own grandchildren, held out at the arc floor rather than at the child cap, began touching it. A
 * system needs room for what orbits inside it, and widening the system is the lever that gives it
 * room; shrinking the bodies to fit would have been tuning the symptom.
 */
const SYSTEM_SCALE = 2.6;

/**
 * The most of its anchor's own orbit that a child's orbit may occupy.
 *
 * Nesting reads as nesting only when each level is decisively smaller than the one above it. A moon
 * whose orbit rivals its planet's distance from the sun does not look like a moon; it looks like a
 * collision, and it was one — measured at 24 units between a phase and a client of radius 36.
 */
const CHILD_RATIO = 0.55;

/**
 * The clear zone at the centre, as a fraction of the disc's own span.
 *
 * ─── WHY IT IS A FRACTION AND NOT A DISTANCE ───────────────────────────────────────────────────
 *
 * The centre of the galaxy lives in this hole, and the renderer sizes it from the hole — so this
 * constant is what ultimately decides how big the galactic core is drawn.
 *
 * It was a fixed 1,500 units, which is a fixed distance against a disc whose span grows as √N. At
 * thirty bodies that was a quarter of the galaxy and the core was grand; at three thousand it was
 * three percent and the core was a marble at the middle of a huge field. Expressed as a fraction,
 * the hole — and therefore the core — keeps the same proportion at any size of business.
 *
 * The `ROOT_SEPARATION` floor keeps a small graph from having no hole at all.
 */
const ROOT_DISC_HOLE = 0.20;

/**
 * The golden angle, and the reason the root disc has no visible structure.
 *
 * Successive slots placed `2π/count` apart trace a ring; placed a GOLDEN ANGLE apart with a √slot
 * radius they fill a disc with no spokes, no rings and no clumps — the arrangement a sunflower head
 * uses, for the same reason. Any rational fraction of a turn produces visible arms; this is the
 * least rational number there is, so it produces none.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How far a root's orbital plane may tilt, in radians (~7.5°).
 *
 * MUCH smaller than MAX_INCLINATION, and that is what makes the field read as a galaxy rather than
 * as a ball. Depth is `planeY × sin(tilt)`, so a tilt that is modest for a 240-unit orbit is
 * enormous for a 4,000-unit one: at MAX_INCLINATION the root field would be 4,800 units thick and
 * perfectly spherical. At this bound the disc is about 12% as thick as it is wide, which is roughly
 * the proportion of an actual spiral galaxy.
 */
const ROOT_DISC_TILT = 0.13;

/**
 * Angular rate constant, in world-units^(1/2) per second.
 *
 * A LAYOUT CONSTANT, and the last one this layer owes a renderer that wants to show an orbit
 * TRAVELLED rather than frozen: `ω = ORBIT_RATE / √radius`.
 *
 * ─── WHY THE ROTATION CURVE IS FLAT AND NOT KEPLERIAN ──────────────────────────────────────────
 *
 * `ω ∝ 1/radius` is Kepler, and it was the first form here. Across a disc spanning 420 to 4,266
 * units it makes the inner objects turn ten times faster than the outer ones, and within a minute
 * the field visibly shears into a spiral smear — legible as physics, illegible as a picture of a
 * business.
 *
 * `ω ∝ 1/√radius` compresses that to about three times, which reads as one structure turning
 * together while still making inner objects faster — the property that stops the whole thing
 * looking like a rigid decal. It is also, incidentally, closer to how real galaxies rotate than
 * Kepler is: observed rotation curves are flat, not Keplerian.
 *
 * It is a RATE, NOT A POSITION AND NOT A CLOCK. Nothing here reads the time, and this layer's output
 * is still a complete static arrangement — `orbitPhase` is where the body is at θ = 0 and remains
 * the only answer to "where is it".
 */
const ORBIT_RATE = 7.6;

/** Floor on the angular rate, so an outermost body still visibly moves. Radians per second. */
const MIN_ORBIT_SPEED = 0.02;

/**
 * Ceiling on the angular rate. Radians per second — about eighteen seconds for a full turn.
 *
 * `ω ∝ 1/√radius` has no upper bound, and the tightest orbits in the graph are the deepest ones: a
 * phase around a project came out at 1.27 rad/s, five seconds a revolution, which reads as a
 * spinning gear rather than as an orbit. The cap costs nothing anywhere else — only the innermost
 * few percent of bodies reach it.
 */
const MAX_ORBIT_SPEED = 0.35;

/** Where a node with no parent orbits. The Ascend Core sits at the origin (§2.7). */
const ORIGIN = { x: 0, y: 0, z: 0 } as const;

/** Group key for the root system, kept distinct from any real node id. */
const ROOT_SYSTEM = "«core»";

/**
 * A well-mixed 0-1 value for `key`. `spatialSeed` with a final avalanche, and it is not optional.
 *
 * ─── THE DEFECT THIS EXISTS FOR, WHICH A TEST FOUND AFTER THE FIRST FIX ────────────────────────
 *
 * `spatialSeed` is FNV-1a and FNV-1a has NO FINAL MIXING STEP. Its output therefore still carries
 * the shape of the input's leading characters, so two keys sharing a long prefix land close
 * together. `SpatialNode.id` is `${type}:${entityId}`, which is exactly that shape — a long shared
 * prefix per type. Measured directly:
 *
 *     slot:client:r00   0.927      slot:invoice:r10   0.367
 *     slot:client:r01   0.931      slot:invoice:r11   0.363
 *     slot:client:r02   0.919      slot:invoice:r12   0.359
 *
 * Twelve roots of four types produced four tight clusters. So replacing the alphabetical slot order
 * with `spatialSeed` order did NOT remove the type banding it was written to remove — it replaced
 * one type ordering with a different one, and the ring came out banded exactly as before. The fix
 * looked right, read right, and changed nothing about the picture.
 *
 * The avalanche (the finalizer from MurmurHash3) makes one input bit change roughly half the output
 * bits, which is the property "seeded" was assuming all along and did not have.
 *
 * `spatialSeed` itself is deliberately NOT changed. It is shared with `components/graph/simulation`,
 * where it seeds breathing phases whose stability across runs is its own contract, and re-mixing it
 * would silently move every one of them. This is a layout-local strengthening of a shared function,
 * which is why it lives here.
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
  /**
   * The rest position within this object's own orbital plane, before the plane is tilted.
   *
   * ALREADY-EVALUATED TRIGONOMETRY, and that is the entire point. `x`/`y`/`z` are absolute and are
   * what a still picture needs. A surface that wants to show the orbit TRAVELLED needs the same
   * placement decomposed into the frame the travel happens in, because advancing an orbit is a
   * rotation of that frame and nothing else:
   *
   *     world = anchor + rotateX(orbitInclination) · rotateZ(theta) · (orbitPlaneX, orbitPlaneY, 0)
   *
   * At theta = 0 that is EXACTLY the absolute position beside it — same numbers, same arithmetic,
   * one evaluation. A consumer that never advances theta sees precisely the arrangement Slice 14
   * drew, which is why this is an addition to the contract and not a change to it.
   *
   * Decomposed HERE rather than downstream for the reason F65 exists: `cos(orbitPhase) * radius` in
   * a renderer is a second placement authority, and the moment the two disagree the picture stops
   * being the layout's answer while every test still passes.
   */
  orbitPlaneX: number;
  orbitPlaneY: number;
  /**
   * Angular rate around the anchor, in radians per second, all bodies co-rotating.
   *
   * A RATE, NOT A POSITION AND NOT A CLOCK. Nothing here reads the time, and this layer's output is
   * still a complete static arrangement — `orbitPhase` is where the body is at t=0 and stays the
   * only answer to "where is it". A consumer that ignores this field sees precisely what Slice 14
   * drew. One that advances it sees the same arrangement in motion.
   *
   * Inner bodies are faster (`ORBIT_RATE / orbitRadius`), which is the one property that makes a
   * moving system read as bound rather than as a rigid disc rotating in one piece. The variance is
   * seed-derived per node so two siblings on one ring drift apart instead of marching in lockstep.
   *
   * One direction for everything. Counter-rotating orbits are physically ordinary and visually
   * unreadable at this density — the eye loses the sense of a single structure the moment half of it
   * turns the other way.
   */
  orbitSpeed: number;
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
  // ─── SLOT ORDER IS SEEDED, NOT ALPHABETICAL ────────────────────────────────────────────────
  //
  // Sorting by id was correct about the property that mattered — a slot must depend on WHICH
  // siblings exist and never on the order they arrived in — and wrong about a consequence nobody
  // looked for. `SpatialNode.id` is formatted `${type}:${entityId}`, so sorting by id sorts by TYPE
  // FIRST, and every renderer downstream colours by type. Alphabetical slots therefore lay the
  // colours down in contiguous arcs: all the audits together, then all the clients, then all the
  // documents. Measured on a representative graph, the ring came out perfectly type-sorted.
  //
  // That is a picture of the alphabet, not of the business. Ordering by a seed derived from the id
  // keeps determinism, keeps the dependence on the membership set, and destroys the correlation
  // between a slot and a type — so a ring reads as a population rather than as a sorted list.
  //
  // The id is the tiebreak, so two ids that seed identically still order stably.
  for (const members of systems.values()) {
    members.sort((a, b) => scatter(`slot:${a}`) - scatter(`slot:${b}`) || (a < b ? -1 : a > b ? 1 : 0));
  }

  const slotOf = (n: SpatialNode): { slot: number; count: number } => {
    const members = systems.get(systemOf(n)) ?? [n.id];
    return { slot: members.indexOf(n.id), count: members.length };
  };

  /**
   * Where in the ROOT DISC a body sits, as opposed to which way round it sits.
   *
   * ─── THE DISC HAS TWO INDEPENDENT ORDERINGS, AND THAT IS THE WHOLE TRICK ───────────────────
   *
   * ANGLE comes from the seeded slot, so the types are completely interleaved around the disc and
   * no arc is one colour. RADIUS comes from this, which sorts by the type's ORBITAL_BAND first —
   * so a type still has a home DISTANCE even though the bands no longer set the radius directly.
   *
   * The two together give concentric type zones with fully mixed angles: prospects swarm the core
   * because their band is the innermost, clients sit further out, artifacts further still. That
   * reads as a galaxy with a dense nucleus rather than as a sorted list, and it is what makes room
   * for a bulk CSV import — ten thousand prospects thicken the core instead of burying the business.
   *
   * The seed is the tiebreak within a band, so a type's own members are not alphabetical either.
   */
  const radialRank = new Map<string, number>();
  {
    const roots = systems.get(ROOT_SYSTEM) ?? [];
    const bandOf = (id: string) => {
      const node = byId.get(id);
      return node ? ORBITAL_BAND[node.visualType] : 0;
    };
    const ordered = [...roots].sort((a, b) =>
      bandOf(a) - bandOf(b) || scatter(`reach:${a}`) - scatter(`reach:${b}`) || (a < b ? -1 : 1));
    ordered.forEach((id, i) => radialRank.set(id, i));
  }

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
  //
  // WITH ONE EXCEPTION, AND IT IS THE EXCEPTION THAT MAKES THE PICTURE. The root group is not a
  // system — its members share no parent, so the argument for one plane ("a parent and its children
  // lie on ONE plane") has nothing to apply to. Keying the root group on the group meant all of its
  // members shared a single tilt: measured, twenty-seven root bodies all at -0.500, which is a
  // circle standing at an angle. A galaxy's field is volumetric; its SYSTEMS are flat. Roots are
  // therefore tilted per BODY and everything else per SYSTEM, which is the distinction the word
  // "system" was always making and the code was not.
  const inclinationOf = (n: SpatialNode): number => {
    const system = systemOf(n);
    if (system === ROOT_SYSTEM) return (scatter(`${n.id}:tilt`) - 0.5) * 2 * ROOT_DISC_TILT;
    return (scatter(`${system}:tilt`) - 0.5) * 2 * MAX_INCLINATION;
  };

  const phaseOf = (n: SpatialNode): number => {
    const { slot, count } = slotOf(n);
    const rotation = spatialSeed(systemOf(n));
    // A SYSTEM is a ring: its members orbit one body, so they are spread evenly around it.
    // The ROOT GROUP is a disc: its members orbit nothing in particular and there may be thousands
    // of them, so successive slots step by the golden angle instead. Even spacing on a disc would
    // put every slot on the same spoke.
    if (systemOf(n) === ROOT_SYSTEM) {
      const angle = rotation * Math.PI * 2 + slot * GOLDEN_ANGLE;
      return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    }
    return ((rotation + slot / count) % 1) * Math.PI * 2;
  };

  /**
   * The type's home band, widened only far enough that `count` objects fit at MIN_ORBIT_ARC apart.
   *
   * Closed form: circumference = count × arc, so radius = count × arc / 2π. One expression, no
   * iteration, no solver. It depends on the type and on how many siblings there are — never on any
   * node's size, and therefore never on `weight`.
   */
  const sizing = new Set<string>();
  const radiusOf = (n: SpatialNode): number => {
    const { count } = slotOf(n);
    // ── A SYSTEM: one ring around one body, widened only enough that its members fit on it, and
    // capped so a child's orbit stays well inside its parent's.
    //
    // THE CAP IS NOT DECORATION. Without it a phase's ring (114) was WIDER than its project's orbit
    // around the client (90), so the phase swung to within 24 units of a client with a radius of 36
    // — a moon passing through its own sun. Nesting only reads as nesting when each level is
    // decisively smaller than the one above it, which is the single relation this enforces.
    if (systemOf(n) !== ROOT_SYSTEM) {
      const anchor = n.parent !== null ? byId.get(n.parent) : undefined;
      // A root anchor is measured by its personal space in the disc, not by how far out it happens
      // to sit — otherwise a system's size would depend on where in the galaxy its owner landed.
      //
      // THE CYCLE GUARD IS NOT OPTIONAL, and it was missing for one commit. This walks UP the
      // containment chain exactly as `positionOf` does, so it inherits the same hazard: a cycle
      // recurses until the stack is gone. SpatialModel's parents come from directed foreign keys
      // and should never cycle — this is a totality guarantee, not an expectation, and the suite
      // has a case for it precisely because "should never" is not a mechanism.
      const cycled = anchor !== undefined && sizing.has(n.id);
      const reference = !cycled && anchor && anchor.parent !== null && byId.has(anchor.parent)
        ? (() => { sizing.add(n.id); const r = radiusOf(anchor); sizing.delete(n.id); return r; })()
        : ROOT_SEPARATION;
      const band = Math.min(ORBITAL_BAND[n.visualType] * SYSTEM_SCALE, reference * CHILD_RATIO);
      return Math.max(band, (count * MIN_ORBIT_ARC) / (Math.PI * 2));
    }
    // ── THE ROOT GROUP: a disc, sized so that `count` bodies spread over its AREA are still
    // MIN_ORBIT_ARC apart. `√slot` is what makes the density even — a linear radius would crowd
    // everything into the rim. ORBITAL_BAND is deliberately NOT consulted here: with thousands of
    // roots the difference between two type bands is a rounding error against the disc the count
    // requires, and type identity is carried by COLOUR, which no distance can express as well. The
    // bands still govern where they mean something, which is inside a system.
    const span = ROOT_SEPARATION * Math.sqrt(count / Math.PI);
    const inner = Math.max(ROOT_SEPARATION, span * ROOT_DISC_HOLE);
    const rank = radialRank.get(n.id) ?? 0;
    return inner + span * Math.sqrt((rank + 0.5) / count);
  };

  /**
   * How fast this body travels its orbit, in radians per second.
   *
   * `ORBIT_RATE / radius` — inner bodies faster than outer ones. The seeded factor spreads two
   * siblings on one ring apart over time instead of letting them march in lockstep, and the floor
   * keeps the outermost bodies from appearing frozen. No clock is read; this is a rate.
   */
  const speedOf = (n: SpatialNode): number => {
    const variance = 0.86 + scatter(`${n.id}:rate`) * 0.28;
    const rate = (ORBIT_RATE / Math.sqrt(radiusOf(n))) * variance;
    return Math.min(MAX_ORBIT_SPEED, Math.max(MIN_ORBIT_SPEED, rate));
  };

  // ── Absolute positions. A child orbits its parent's position, so the walk is up the containment
  // chain, memoised. A containment cycle cannot loop forever: a node already being resolved anchors
  // to the core instead. SpatialModel's parents come from directed foreign keys and should never
  // cycle — this is a totality guarantee, not an expectation.
  const placed = new Map<string, { x: number; y: number; z: number }>();
  const plane = new Map<string, { x: number; y: number }>();
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
    // The rest position within the orbital plane, and then that plane tilted about the anchor's X
    // axis. Written in two steps rather than one so the plane-local pair can be CARRIED rather than
    // reconstructed downstream — see LayoutNode.orbitPlaneX. The composition is unchanged: at zero
    // tilt this still reduces exactly to the 2D placement Slice 3 produced.
    const planeX = Math.cos(phase) * radius;
    const planeY = Math.sin(phase) * radius;
    const offset = { x: planeX, y: planeY * Math.cos(tilt), z: planeY * Math.sin(tilt) };
    plane.set(n.id, { x: planeX, y: planeY });
    // The absolute position IS the anchor plus the offset, written once so the two can never
    // disagree. The offset is kept rather than reconstructed downstream: a renderer that wants to
    // turn the orbit needs the placement relative to what is being orbited, and re-deriving it from
    // `orbitPhase` would put a second placement authority in the renderer.
    const position = { x: anchor.x + offset.x, y: anchor.y + offset.y, z: anchor.z + offset.z };
    placed.set(n.id, position);
    return position;
  };

  const nodes: LayoutNode[] = model.nodes.map((n) => {
    const { x, y, z } = positionOf(n);
    const local = plane.get(n.id) ?? ORIGIN;
    return {
      id: n.id, x, y, z,
      orbitRadius: radiusOf(n),
      orbitPhase: phaseOf(n),
      orbitInclination: inclinationOf(n),
      orbitPlaneX: local.x, orbitPlaneY: local.y,
      orbitSpeed: speedOf(n),
      parent: n.parent,
    };
  });

  return { nodes };
}
