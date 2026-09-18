// graph-view/field/blackhole — THE GALACTIC CORE (brief §7).
//
// Ascend itself, as a supermassive black hole. It is the visual anchor of the whole scene and the
// one object in it that has to survive being looked at closely, so the geometry, the kinematics and
// the two optical effects that sell it are worked out HERE, in plain numbers, where they can be
// checked — rather than inside a `<Canvas>`, where nothing can.
//
// ─── EVERY DIMENSION IS A MULTIPLE OF ONE NUMBER ───────────────────────────────────────────────
//
// The Schwarzschild radius. Real black holes have exactly one free parameter, and stating the
// assembly the same way means it rescales coherently: the shadow cannot drift off the horizon, the
// photon ring cannot drift off the shadow, and the disk cannot creep inside the last stable orbit.
// A collection of independently-tuned radii looks fine until somebody changes one of them.
//
// ─── THE THREE THINGS THAT SEPARATE THIS FROM A BLACK CIRCLE ───────────────────────────────────
//
// 1. **The shadow is bigger than the horizon, by a factor of 2.6.** Light passing near the hole is
//    captured even when it misses, so what a viewer sees is not the horizon — it is a dark disc
//    almost three times wider, with a bright hairline at its edge. Drawing the horizon at its own
//    radius and stopping is the single most common tell.
//
// 2. **The near side of the disk is dramatically brighter than the far side.** Matter orbits at a
//    good fraction of light speed, so the side coming towards the viewer is beamed and blue-shifted
//    and the receding side is dimmed. §7 calls skipping this "the most common tell of a fake black
//    hole" and it is the cheapest of the three to get right.
//
// 3. **The disk shears.** Inner bands orbit faster than outer ones, so the structure is constantly
//    being wound; that differential is what makes it read as plasma rather than as a texture on a
//    ring.
//
// PURE. No three.js, no React, no DOM — typed numbers only.

import { SCHWARZSCHILD_RADIUS as RS } from "./scale";

// ─── GEOMETRY ──────────────────────────────────────────────────────────────────────────────────

/** The horizon itself. Nothing inside it, and it is the only true black in the scene. */
export const HORIZON_RADIUS = RS;

/**
 * The SHADOW: the dark disc a distant observer actually sees, at √27/2 ≈ 2.598 Schwarzschild radii.
 *
 * Not a chosen value. It is the impact parameter below which a photon aimed past the hole is
 * captured anyway, and it is why the dark region is nearly three times wider than the horizon.
 */
export const SHADOW_RADIUS = Math.sqrt(27) / 2 * RS;

/**
 * How far the AMBIENT darkening reaches past the shadow's edge.
 *
 * The shadow does not end at a hard line in a real image, and it must not here: light skimming just
 * outside the capture radius is deflected away and dimmed rather than removed, so the surroundings
 * fade INTO the shadow over a band roughly its own width again. This is the difference between a
 * hole punched in the starfield and something that looks like it is bending what is behind it.
 */
export const AMBIENT_RADIUS = SHADOW_RADIUS * 2.6;

/** The photon ring: a razor-thin hairline sitting exactly on the shadow's edge. */
export const PHOTON_RING_RADIUS = SHADOW_RADIUS;
export const PHOTON_RING_THICKNESS = 0.012 * RS;

/**
 * The accretion disk, inner to outer.
 *
 * §7 gives 3·rs → 16·rs. The inner edge is kept: 3 rs is roughly the innermost stable orbit, and
 * moving it inside the shadow would put the disk somewhere matter cannot be. The OUTER edge is
 * pulled in to 10·rs, because 16 puts a 416-unit ring around a bulge of 190 — the accretion
 * structure would be twice the size of the galactic core it lives in, and the galaxy would read as
 * an accessory to it. At 10 it dominates the core, which is the intent, and the spiral survives.
 */
export const DISK_INNER = 3 * RS;
export const DISK_OUTER = 10 * RS;

/**
 * Obliquity of the disk relative to the galactic plane, in radians.
 *
 * §7 says ~17° "so the user sees it obliquely from the default camera", and at 17° it is not
 * oblique — it is nearly face-on. The default camera sits 35.5° off the galactic pole, so a disk
 * lying almost IN that plane presents its face, the lensed arcs have nothing to arc over, and the
 * whole silhouette collapses into a flat ring.
 *
 * Solving `normal · cameraDirection = 0` for the default view gives exactly edge-on at 1.06 rad,
 * and 0.92 — seven degrees off it — was the first correction. It went too far the other way: at
 * that angle the disk projects to a line a few pixels thick, the far side never passes behind the
 * shadow, and the lensed arcs have nothing to sweep over. On screen it was a faint wisp entering
 * the hole from one side.
 *
 * 0.55 puts the view about 27° above the disk plane. That is the angle the reference images are
 * shot from, and it is the one that shows the structure: a clear ellipse, the far side passing
 * behind the shadow, and room above and below for the arcs.
 *
 * Real accretion disks are frequently strongly misaligned with their host galaxy, so this is not a
 * licence taken for the picture — it is the ordinary case.
 */
export const DISK_TILT = 0.55;

/**
 * The lensed arcs: the far side of the disk, bent up over the hole and down under it.
 *
 * A real one is the same disk seen through a gravitational lens. Faking it with two camera-facing
 * bands gets most of the silhouette for almost none of the cost, and the numbers below are what
 * make it read as the SAME disk rather than as two decorative rings — it starts just outside the
 * photon ring, it is radially compressed, and the upper arc is brighter than the lower one because
 * the upper one is the disk's near face seen over the top.
 */
export const ARC_INNER = SHADOW_RADIUS * 1.04;
export const ARC_OUTER = DISK_OUTER * 0.86;
export const ARC_TOP_INTENSITY = 0.8;
export const ARC_BOTTOM_INTENSITY = 0.5;

/**
 * Overall brightness of the disk itself.
 *
 * Above 1 because the disk competes with forty-eight thousand bulge stars occupying the same part
 * of the frame, all of them additive. At 1.0 the accretion structure was a wisp; it has to be the
 * brightest thing at the galactic centre, which is what it is.
 */
export const DISK_INTENSITY = 1.9;

// ─── KINEMATICS ────────────────────────────────────────────────────────────────────────────────

/** Angular speed of the innermost band, in radians per unit time. Everything else is relative to it. */
export const DISK_ANGULAR_SPEED = 0.52;

/**
 * How fast a band at radius `r` turns.
 *
 * `∝ r^-1.5` is Keplerian, which is what an accretion disk actually is, and the SHEAR between
 * neighbouring bands is the whole effect: at these radii the inner edge laps the outer one roughly
 * eight times, so the noise structure is continuously stretched into filaments instead of rotating
 * as a rigid picture.
 */
export function bandAngularSpeed(radius: number): number {
  return DISK_ANGULAR_SPEED * Math.pow(DISK_INNER / Math.max(radius, DISK_INNER), 1.5);
}

/** Radial brightness falloff exponent. Steep: the inner edge is far hotter than the rim. */
export const DISK_FALLOFF = 2.2;

/** Doppler beaming range: the receding side is dimmed to 0.3, the approaching side lifted to 2.6. */
export const BEAMING = { away: 0.3, toward: 2.6 } as const;

/**
 * The disk azimuth whose matter is moving most directly TOWARDS the camera.
 *
 * Both arguments are the camera's direction from the hole, projected into the disk's own plane.
 * Matter at azimuth θ sits at (cos θ, sin θ) and moves along (−sin θ, cos θ), so its approach speed
 * is `−sin θ · cx + cos θ · cy`, which peaks at `atan2(−cx, cy)`.
 *
 * It is a function of the CAMERA, so it is recomputed as the view moves — the bright side of a real
 * disk is not painted on, it depends on where you stand. Getting this backwards puts the bright side
 * on the receding edge, which looks equally plausible and is exactly wrong.
 */
export function approachAngle(cameraX: number, cameraY: number): number {
  return Math.atan2(-cameraX, cameraY);
}

/** Beaming multiplier at azimuth `theta`, given the approach angle. The shader mirrors this. */
export function beamingAt(theta: number, approach: number): number {
  const t = 0.5 + 0.5 * Math.cos(theta - approach);
  return BEAMING.away + (BEAMING.toward - BEAMING.away) * t;
}

// ─── OPTICS ────────────────────────────────────────────────────────────────────────────────────

/**
 * Screen-space lensing strength. §7's value, and it is deliberately small.
 *
 * The effect is a deflection of what is ALREADY on screen towards the hole. Turned up it looks like
 * a fisheye lens sitting in front of the galaxy; at this strength it is barely nameable and does
 * the thing it is for — the starfield appears to bend around the shadow instead of being occluded
 * by it.
 */
export const LENS_STRENGTH = 0.035;

/**
 * How far out the lensing falls off, as a multiple of the shadow's screen radius.
 *
 * Bounded because the pass samples the scene buffer with an offset: an unbounded falloff pulls the
 * entire frame towards the core, and the corners smear.
 */
export const LENS_FALLOFF = 7;

/**
 * The deflection applied at screen distance `r` from the hole's centre.
 *
 * `k ∝ 1/r²` is the weak-field deflection, and it diverges at the centre — which is why the caller
 * clamps and why everything inside the shadow is painted black rather than sampled. Exposed as a
 * pure function so the profile can be checked without a GPU: it must fall monotonically, reach
 * essentially nothing by the falloff radius, and never exceed the distance it is displacing.
 */
export function lensDeflection(r: number, shadowRadius: number, strength = LENS_STRENGTH): number {
  if (r <= 0) return 0;
  const k = (strength * shadowRadius * shadowRadius) / Math.max(r * r, 1e-5);
  // Smooth cutoff between the falloff radius and just outside the shadow, so the deflection is
  // gone before it reaches anything that is not obviously near the hole.
  const outer = shadowRadius * LENS_FALLOFF;
  const inner = shadowRadius * 1.2;
  const t = Math.min(Math.max((outer - r) / (outer - inner), 0), 1);
  const eased = t * t * (3 - 2 * t);
  // ─── NOTHING IS EVER DEFLECTED INTO THE SHADOW ─────────────────────────────────────────────
  //
  // The deflection is strongest exactly where the photon ring is, so without this the pass drags
  // the ring inward by about a fifth of the shadow's radius and the black disc clips it — the
  // hairline that defines the object came out as a broken sliver.
  //
  // It is also the physics. The shadow is the set of directions from which no light arrives; an
  // image displaced to appear inside it would be light arriving from where there is none. So the
  // deflection may bring an image up to the shadow's edge and no further, which puts the photon
  // ring exactly where it belongs and keeps it whole.
  return Math.min(k * eased, r, Math.max(r - shadowRadius, 0) * 0.18);
}

/**
 * The on-screen radius of a sphere of `worldRadius`, at `distance`, in NORMALISED DEVICE units.
 *
 * Lives here rather than in the lensing pass because turning a world size into a screen size is
 * trigonometry, and F65 bans that below this layer. It is also the number that decides whether the
 * effect is visible at all, so it is worth being able to check without a GPU.
 *
 * Returns half-height-relative units: 1.0 means the radius spans from the centre of the frame to
 * its top edge.
 */
export function screenRadius(worldRadius: number, distance: number, fovDegrees: number): number {
  if (distance <= worldRadius) return 1;
  const halfHeight = distance * Math.tan((fovDegrees * Math.PI) / 360);
  return worldRadius / halfHeight;
}

/** Apparent accretion plane tilt within the shared shadow frame. */
export const DISK_VIEW_TILT = 1.08;
