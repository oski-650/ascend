// components/galaxy/celestial — THE CELESTIAL PRESENTATION MODEL (Slice 15).
//
//     SceneModel  →  celestial descriptors  →  R3F meshes
//
// Every decision the 3D renderer makes lives here, as a pure function over the scene: which sphere,
// what colour, what size, where. The renderer maps descriptors to `<mesh>` elements and decides
// nothing — the same split that has held between `scene.ts` and `GalaxyCanvas`, and between
// `traversal.ts` and both surfaces.
//
// That split is why this file exists rather than the logic living in the R3F component. WebGL cannot
// run in the test environment, so anything decided inside a `<Canvas>` is untestable; anything
// decided here is testable in plain Node at full strength, with no rendering dependency at all.
//
// PURE: no React, no three, no WebGL, no DOM, no clock, no randomness, no I/O.
//
// ─── TWO INDEPENDENT AXES, AND KEEPING THEM APART IS THE WHOLE DESIGN ──────────────────────────
//
//     ASCEND OS      the galaxy
//     the core       the centre of the galaxy — chrome, never an object; see AscendCore
//
//   WHAT A BODY LOOKS LIKE  ← its TYPE, via taxonomy's CELESTIAL_ROLE
//
//     a project      a SUN — a project is a solar system, and this is its star
//     a client       a CLUSTER of the solar systems it owns
//     a task, phase  a PLANET
//     a SOP, doc,    a MOON
//     invoice, audit
//     a prospect     a STAR in the field — thousands of them, the dust of the galaxy
//
//   WHAT A BODY DOES        ← its CONTAINMENT, via SceneNode.anchorId
//
//     what it orbits, whether it travels, and whether anything shines on it
//
// This file used to derive the first axis from the second: depth 0 with children was a sun, depth 1
// a planet, depth 2 a moon. It was elegant, and it answered a question nobody had asked. "How deep
// is this in the tree" is not "what does a project look like" — and no depth rule could ever have
// made a SOP a moon, because a SOP has no parent at all.
//
// So appearance is declared per type in `graph-view/taxonomy`, beside colour and shape, where every
// other per-type visual decision already lives. NO TYPE NAME APPEARS IN THIS FILE: the role is
// looked up by `visualType` exactly as the colour is, which is why F66's ban still holds and still
// means something.
//
// The second axis stays with containment and is not negotiable, because it is about where things
// actually are. A SOP drawn as a moon still orbits the galactic centre like every other parentless
// object; it does not acquire an invented parent to justify the word. That separation is what lets
// the vocabulary above be chosen freely without any of it becoming a claim about the business.

import { CELESTIAL_ROLE, NODE_VISUAL, type CelestialRole } from "@/graph-view/taxonomy";
import type { Scene, SceneNode } from "./scene";
import { relationshipsOf } from "./traversal";

/** Re-exported so the surfaces have one import for the celestial model. Owned by taxonomy. */
export type { CelestialRole };

/**
 * How much each role scales the radius its owner already computed.
 *
 * A PRESENTATION MULTIPLIER, applied downstream of `SceneNode.radius` — which taxonomy's
 * `nodeRadius` produced from base size and structural weight. It is deliberately restrained: the
 * hierarchy must read as sun > planet > moon at a glance without a sun swallowing its own system.
 * It encodes no business meaning, and nothing may read a sphere's size as a metric.
 */
/**
 * Global body scale, bridging two unit systems that were never reconciled.
 *
 * `SceneNode.radius` comes from taxonomy's `nodeRadius`, whose base values (3.2–9.5) were PIXEL
 * radii for the 2D painter. `ORBITAL_BAND`'s distances (240–560) are WORLD units. In 2D the mismatch
 * was invisible: `computeFitCamera` zoomed it away and a 1.5px floor caught the rest.
 *
 * ─── WHY THIS WENT DOWN AND NOT UP ───────────────────────────────────────────────────────────
 *
 * The first correction multiplied by 4, reasoning that a sun rendering at twelve pixels was too
 * small. It was measured afterwards: with a ring spacing of 26 world units — calibrated when radii
 * were about ten — neighbouring bodies interpenetrated by 103 units. Big matte spheres jammed into
 * each other, which is the "old 90s 3D" the result was fairly called.
 *
 * A luminous body does not read by its geometry. It reads by its GLOW, and the glow is produced by
 * `emissiveStrength` below driving a bloom pass — so the sphere can be small enough to never collide
 * and still dominate the frame. Small core, large light. That is what the reference actually is, and
 * it is why the scale went down rather than up.
 *
 * This multiplies radius only. It touches no distance, no band and no coordinate: the spatial
 * arrangement upstream is unchanged and this stays a presentation decision downstream of it.
 */
const BODY_SCALE = 2.6;

/**
 * How much each role scales the radius its owner already computed.
 *
 * Restrained on purpose: the hierarchy must read as sun > planet > moon at a glance without a sun
 * swallowing its own system. It encodes no business meaning, and nothing may read a body's size as
 * a metric.
 */
const ROLE_SCALE: Record<CelestialRole, number> = {
  sun: 10.8,
  cluster: 7.2,
  planet: 1.0,
  moon: 0.5,
  star: 0.62,
};

/**
 * How hard each role burns.
 *
 * Emissive intensity above 1 is what pushes a body over the bloom threshold, so this is the control
 * that decides what the eye is drawn to — and it follows the same hierarchy the size does, for the
 * same reason. It is a BRIGHTNESS, not a severity: it varies with spatial role only, and never with
 * health, attention, weight or type, so a bright body never means an urgent one.
 *
 * A SUN burns hardest of all, and it is not the largest body. That is the metaphor doing real work:
 * a project is a solar system, so its star should be the brightest thing in its neighbourhood even
 * though the cluster that owns it is physically bigger.
 *
 * Isolated stars burn hot too. They have no system to belong to and no size to be read by, and
 * dimming them to match their radius made them vanish. Brightness is the thing that says they are
 * there — and their colour still says what they are, because it is unchanged.
 */
const EMISSIVE_STRENGTH: Record<CelestialRole, number> = {
  sun: 4.2,
  cluster: 3.0,
  planet: 1.5,
  moon: 1.1,
  star: 2.4,
};

/**
 * How far each role's glow reaches, as a multiple of its own radius.
 *
 * ─── WHY THIS IS PER-ROLE AND NOT ONE CONSTANT ─────────────────────────────────────────────────
 *
 * The renderer floors the drawn halo at a fixed number of SCREEN units, so the smallest bodies stay
 * visible when the galaxy is scaled down to fit — and after the prospect import there are three
 * thousand of the smallest bodies. Measured at that size with a single spread: a client's halo came
 * out at 17 screen units against a floor of 18, so the floor became the size of everything and the
 * hierarchy inverted — three thousand prospects drawn LARGER than the clients they surround.
 *
 * Lowering the floor instead made the swarm disappear entirely, which was worse: the field is the
 * galaxy. The fix is that a star's glow should reach much further than a speck's in the first place,
 * so it clears the floor on its own merits. A sun's corona is not a scaled-up version of a distant
 * point of light, and it should not be drawn as one.
 *
 * ─── A RIM, NOT A CLOUD ────────────────────────────────────────────────────────────────────────
 *
 * These were more than twice the body radius, and once the SPHERE gained a screen floor that became
 * a problem: a sun's glow reached further than the distance to its own client, and additive
 * blending laid yellow over azure until the client simply was not there any more. Neighbours were
 * being erased by their neighbours' light.
 *
 * The sphere is the object now and the glow is its edge. Field stars keep a wider spread because
 * they are the one role small enough that the glow is all there is to see.
 */
const HALO_SPREAD: Record<CelestialRole, number> = {
  sun: 1.55,
  cluster: 1.5,
  planet: 1.4,
  moon: 1.35,
  star: 1.9,
};

/**
 * Roles that are their own light source, whatever else is near them.
 *
 * A star shines; a planet and a moon reflect. This half is a property of the VOCABULARY — a sun is
 * luminous by definition — and it is combined at the mapper below with the containment half, which
 * decides whether there is actually anything nearby to do the shining.
 */
/**
 * The smallest the BODY may be drawn, in SCREEN units — a floor the renderer applies after scaling.
 *
 * ─── IT FLOORS THE SPHERE, NOT THE GLOW, AND THAT IS THE WHOLE POINT ───────────────────────────
 *
 * The galaxy is normalised to one size however much is in it, so a graph of three thousand bodies
 * draws each one a hundred times smaller than a graph of thirty. Without a floor the small ones
 * vanish.
 *
 * The floor used to be on the HALO. That kept every object visible and made the small ones stop
 * looking like objects: the sphere shrank to a fraction of a pixel inside a glow twenty times its
 * size, so what the eye actually saw was a flat additive sprite. A planet and a moon had a lit side
 * and a dark side and neither was ever more than a pixel across — all the shading in the world does
 * nothing when the shaded thing is invisible.
 *
 * Flooring the BODY and scaling its glow by the same factor keeps the two in proportion at every
 * zoom: a sphere always big enough to show a terminator, wearing a glow that always looks like its
 * glow. Zoom in and the real radii take over; zoom out and the ranking between roles survives,
 * because the floors are ordered the way the bodies are.
 *
 * THEY ARE DELIBERATELY COMPRESSED against the true radii. A planet is a fifth of a sun in reality
 * and half of one here, because a body that resolves into a sphere has a lower bound in PIXELS and
 * the true ratio would put planets and moons under it. The ordering is preserved and the spread is
 * not, which is the honest trade: at the wide view the hierarchy is still readable, and zooming in
 * restores the real proportions.
 *
 * ─── AND THERE IS A CEILING, SET BY THE ARRANGEMENT ITSELF ─────────────────────────────────────
 *
 * Magnifying a body does not magnify the distance to its neighbours. A project orbits its client at
 * about 129 screen units at the whole-galaxy framing, so once a sun reached 90 and a cluster 72
 * they INTERSECTED — every client disappeared inside its own project's sphere and the six
 * client/project pairs rendered as six yellow blobs. Six bodies where there were twelve.
 *
 * These are sized to stay under that: 58 + 44 = 102 against 129, so the pair reads as two touching
 * spheres rather than one. A body that resolves fully into a sphere at the whole-galaxy view is not
 * achievable here — the galaxy is bigger than its parts, which is what makes it a galaxy — so the
 * wide view shows small shaded spheres and zooming in is what resolves them properly.
 */
const MIN_SCREEN_BODY: Record<CelestialRole, number> = {
  sun: 58,
  cluster: 44,
  planet: 30,
  moon: 24,
  star: 12,
};

const SELF_LUMINOUS: Record<CelestialRole, boolean> = {
  sun: true,
  cluster: true,
  star: true,
  planet: false,
  moon: false,
};

/** Additional burn for an object an owner already flagged. Subordinate, and deliberately small. */
const EMPHASIS_BOOST = 0.9;

/** One sphere to place. Every value is copied or looked up; none is computed from a business fact. */
export type CelestialBody = {
  /** SceneNode.id, unchanged. The join key for picking and for selection. */
  id: string;
  /** Absolute position, copied verbatim from the scene. The renderer never recomputes a coordinate. */
  x: number;
  y: number;
  z: number;
  /**
   * How to place this body so its orbit can be TRAVELLED, or `null` when it cannot be.
   *
   * `null` has one meaning and it is an honest one: this body's anchor is not on screen. The detail
   * filter dropped it, so its plane coordinates are measured against something the viewer cannot
   * see. Such a body is placed at its absolute position and does not move — showing it circling an
   * invisible point would be drawing a relationship to an object that is not there. Bodies anchored
   * to the core always have an orbit, because the core is always drawn.
   *
   * Every value here is COPIED. Nothing in this file evaluates a trigonometric function or composes
   * a transform; the decomposition was done once, upstream, by the layer that owns placement.
   */
  orbit: CelestialOrbit | null;
  /** Drawn radius: the scene's radius scaled by the role. Small — the glow does the work. */
  radius: number;
  /**
   * Emissive multiplier. Above 1 it crosses the bloom threshold and the body becomes a light source.
   *
   * A BRIGHTNESS, NOT A SEVERITY. Derived from the spatial role and from `emphasis`, which an owner
   * set by hand — never from health, weight or type. A viewer may read this as "large" or "flagged",
   * and must never be able to read it as "urgent".
   */
  emissiveStrength: number;
  /**
   * Whether this body is lit from outside rather than being its own light.
   *
   * Presentation only, and derived from the spatial role alone — never from a business field. A
   * viewer may read it as "this thing is inside a system"; nothing may read it as a fact.
   */
  lit: boolean;
  /** How far the glow reaches, in the same units as `radius`. */
  halo: number;
  /**
   * The smallest this body's SPHERE may be drawn, in SCREEN units.
   *
   * The renderer divides this by the normalising scale, and magnifies the body AND its glow by
   * whatever factor is needed to reach it — so the two never fall out of proportion and a body is
   * never a flat sprite with an invisible sphere inside it.
   */
  minBody: number;
  /** The spatial role. Presentation only. */
  role: CelestialRole;
  /** Type identity, from taxonomy's authoritative per-type colour. Dominant signal. */
  color: string;
  /** Carried so a label can be drawn without a second lookup. */
  label: string;
  /** Subordinate treatments, copied. They must never overpower the type colour. */
  health: SceneNode["health"];
  emphasis: boolean;
};

/**
 * Everything needed to advance one orbit, copied from the scene.
 *
 * The composition the renderer performs, stated once so it can be checked:
 *
 *     world = anchor + rotateX(tilt) . rotateZ(theta) . (planeX, planeY, 0)
 *
 * At `theta = 0` this reproduces the body's absolute `x`/`y`/`z` exactly — same numbers, one
 * evaluation, done upstream. So a surface that never advances theta draws the arrangement the layout
 * produced, and one that advances it draws that same arrangement in motion. Motion is a TRANSFORM
 * over the layout's answer, never a second answer.
 */
export type CelestialOrbit = {
  planeX: number;
  planeY: number;
  /** Tilt of the orbital plane, radians. */
  tilt: number;
  /** Radians per second. Inner bodies are faster; everything co-rotates. */
  speed: number;
  /** The body this one orbits, or `null` for the core. Present in the scene whenever this is set. */
  anchorId: string | null;
};

/** One relationship to draw. Endpoints are ids; the renderer resolves them from the bodies. */
export type CelestialLink = {
  id: string;
  source: string;
  target: string;
  containment: boolean;
};

export type CelestialModel = {
  bodies: CelestialBody[];
  links: CelestialLink[];
};

/**
 * How deep an object sits in the containment hierarchy, and whether anything orbits it.
 *
 * ASKED, NOT DERIVED. `SceneNode` carries no `parent`, and scanning `scene.edges` here would make
 * this a second place deciding what is connected to what — which F65 forbids and which is how the
 * accessible surface and the canvas would eventually disagree. So it goes through
 * `traversal.relationshipsOf`, the one authority both surfaces already use.
 *
 * Reading it: a relationship that is CONTAINMENT and INCOMING means this object is the target of a
 * stored `has_*` edge, so the thing at the other end is its parent. Outgoing containment means
 * something orbits it. Lateral relationships are ignored entirely — `billed` does not make an
 * invoice a moon of its client.
 *
 * The walk is memoised with a cycle guard mirroring GalaxyLayout's: an object already being resolved
 * is treated as a root rather than recursing forever. A totality guarantee, not an expectation.
 */
function depthsAndParenthood(scene: Scene): {
  depthOf: Map<string, number>;
  hasChildren: Set<string>;
  present: Set<string>;
} {
  const present = new Set(scene.nodes.map((n) => n.id));
  const parentOf = new Map<string, string | null>();
  const hasChildren = new Set<string>();

  for (const n of scene.nodes) {
    const containment = relationshipsOf(n.id, scene.edges, present).filter((r) => r.containment);
    const up = containment.find((r) => !r.outgoing);
    parentOf.set(n.id, up ? up.targetId : null);
    if (containment.some((r) => r.outgoing)) hasChildren.add(n.id);
  }

  const depthOf = new Map<string, number>();
  const resolving = new Set<string>();
  const depth = (id: string): number => {
    const cached = depthOf.get(id);
    if (cached !== undefined) return cached;
    const parent = parentOf.get(id) ?? null;
    let d = 0;
    if (parent !== null && present.has(parent) && !resolving.has(id)) {
      resolving.add(id);
      d = depth(parent) + 1;
      resolving.delete(id);
    }
    depthOf.set(id, d);
    return d;
  };
  for (const n of scene.nodes) depth(n.id);
  return { depthOf, hasChildren, present };
}



/**
 * SceneModel → celestial descriptors. Pure, total, deterministic.
 *
 * TOTAL: every SceneNode yields exactly one body, and every body corresponds to a SceneNode. The
 * renderer therefore cannot show an object the scene does not contain, and cannot omit one it does.
 * The central Ascend marker is deliberately NOT here — it is renderer chrome, never a body, and so
 * it can never enter a count, a selection, or the accessible surface.
 */
export function toCelestialModel(scene: Scene): CelestialModel {
  const { present } = depthsAndParenthood(scene);

  const bodies: CelestialBody[] = scene.nodes.map((n) => {
    const role = CELESTIAL_ROLE[n.visualType];
    // An orbit is offered only when the thing it is measured against is on screen. `anchorId === null`
    // means the core, which always is; any other anchor has to be found among the drawn nodes.
    const anchored = n.anchorId === null || present.has(n.anchorId);
    // ANCHORED IS NOT THE SAME AS INSIDE A SYSTEM. Every parentless body is "anchored" — it orbits
    // the galactic centre — but there is no star beside it out in the field. Lighting needs the
    // stricter question, and conflating the two lit every SOP and invoice in the graph.
    const insideSystem = n.anchorId !== null && present.has(n.anchorId);
    return {
      id: n.id,
      x: n.x,
      y: n.y,
      z: n.z,
      orbit: anchored
        ? {
            planeX: n.orbitPlaneX,
            planeY: n.orbitPlaneY,
            tilt: n.orbitInclination,
            speed: n.orbitSpeed,
            anchorId: n.anchorId,
          }
        : null,
      radius: n.radius * ROLE_SCALE[role] * BODY_SCALE,
      emissiveStrength: EMISSIVE_STRENGTH[role] + (n.emphasis ? EMPHASIS_BOOST : 0),
      // ─── LIGHT NEEDS BOTH HALVES: A BODY THAT REFLECTS, AND SOMETHING TO REFLECT ────────────
      //
      // A planet inside a system is lit by the galaxy and gains a terminator, which is the whole
      // difference between a sphere and a flat disc. A body of the same TYPE sitting alone in the
      // field has nothing shining on it, and drawing it lit would render it very nearly black — so
      // an unanchored body falls back to being its own faint light.
      //
      // It is also a COST split, which is why it is decided here rather than in the renderer: a lit
      // material is meaningfully more expensive per body, and the lit bodies are the few dozen
      // inside systems. The thousands of field bodies — every imported prospect among them — stay
      // on the cheap path.
      lit: !SELF_LUMINOUS[role] && insideSystem,
      halo: n.radius * ROLE_SCALE[role] * BODY_SCALE * HALO_SPREAD[role],
      minBody: MIN_SCREEN_BODY[role],
      role,
      color: NODE_VISUAL[n.visualType].color,
      label: n.label,
      health: n.health,
      emphasis: n.emphasis,
    };
  });

  // Relationships are carried, never invented: one link per scene edge, endpoints by id.
  const links: CelestialLink[] = scene.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    containment: e.containment,
  }));

  return { bodies, links };
}
