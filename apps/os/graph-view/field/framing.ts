// graph-view/field/framing — KEEPING THE GALAXY IN FRAME ON EVERY DISPLAY (brief §14).
//
// A perspective camera is specified by its VERTICAL field of view, and every renderer therefore
// widens the horizontal field as the window gets wider. That is the right default for a game and
// the wrong one for an object: on a 3440×1440 ultrawide the galaxy does not get MORE visible, it
// gets cropped top and bottom while empty space fills the sides.
//
// So the horizontal field is what gets locked, and the vertical one narrows to hold it:
//
//     tan(hfov/2) = aspect · tan(vfov/2)        — the relation a perspective camera obeys
//     lock hfov   ⇒  tan(vfov/2) = tan(vfov₀/2) · aspect₀ / aspect
//
// Below the reference aspect nothing happens. A 4:3 or a portrait window keeps the composed
// vertical field and simply shows less to the sides, which is the behaviour that keeps the subject
// the same size as the window narrows.
//
// ─── THE AMENDMENT: THE LOCK HAS A FLOOR, AND THE BRIEF'S NUMBERS ARE WHY ──────────────────────
//
// §14 asks for two things that its own constants cannot both deliver, and the test suite found it
// rather than a browser did. Take the brief exactly as written —
//
//     galaxy radius 1400 (§4) · vertical FOV 55° (§1) · galaxy camera 1900–3400 (§10)
//
// — and lock the horizontal field on a 3440×1440 display. The vertical field narrows from 55° to
// 42.4°, the half-height at the outer rail falls to about 1317 units, and the galaxy's projected
// vertical extent is about 1384. **It crops**, which is the exact failure §14 exists to prevent,
// and backing off far enough to fit needs ~3800 units — outside the band §10 states.
//
// The lock is a means and "the galaxy does not crop" is the end, so the means acquires a floor:
// **lock the horizontal field, but never narrow the vertical field past what frames the subject.**
// Beyond that aspect the display shows a little MORE to the sides than the reference does — about
// 7% wider at 3440×1440 — which is a far better outcome than cutting the top and bottom off the
// galaxy, and it keeps every one of the brief's stated numbers intact.
//
// ─── WHY THIS LIVES HERE AND NOT IN THE CANVAS COMPONENT ───────────────────────────────────────
//
// F65 bans `Math.tan` under `components/galaxy` — the renderer computes no position, and framing
// arithmetic is the thinnest end of the same wedge. Keeping it here also makes it testable in plain
// Node, which matters more than the rule does: the acceptance criterion for Phase 1 is four
// specific viewport widths, and asserting them against a function is evidence, while eyeballing
// four browser windows is a memory.
//
// PURE. No React, no DOM, no state.

import {
  BASE_ASPECT, BASE_FOV, CAMERA_RAILS, GALAXY_RADIUS, THICKNESS,
} from "./scale";

const DEG = Math.PI / 180;

/** Breathing room between the subject's edge and the edge of the frame. */
export const FRAME_MARGIN = 0.94;

// ─── THE DEFAULT VIEW ──────────────────────────────────────────────────────────────────────────

/**
 * Default camera distance at galaxy level: the outer rail.
 *
 * §4 and §10 are explicit numbers and §14's "~72%" carries a tilde, so where they disagree the
 * explicit ones hold. Hitting 72% exactly would need ~3734 units, which is outside the band §10
 * states — and a default that starts outside its own rails is a scene that snaps on first touch.
 */
export const DEFAULT_GALAXY_DISTANCE = CAMERA_RAILS.galaxy.distance.max;

/**
 * Polar angle of the default view, in radians from the pole.
 *
 * Mid-band rather than at either rail: overhead flattens the spiral into a diagram and edge-on
 * hides it, and the arms read best from somewhere around thirty-five degrees off the pole.
 */
export const DEFAULT_GALAXY_POLAR = 0.62;

/** Azimuth of the default view. The composition seed §7 asks for, so the core lands off-centre. */
export const DEFAULT_GALAXY_AZIMUTH = 0.9;

/**
 * The default galaxy-level camera position, in world units.
 *
 * Stated here rather than in the Canvas because turning a distance and a polar angle into a
 * position is trigonometry, and F65 bans trigonometry below this layer — the renderer receives a
 * position the same way a body does.
 */
export const DEFAULT_GALAXY_CAMERA: readonly [number, number, number] = [
  DEFAULT_GALAXY_DISTANCE * Math.sin(DEFAULT_GALAXY_POLAR) * Math.sin(DEFAULT_GALAXY_AZIMUTH),
  DEFAULT_GALAXY_DISTANCE * Math.cos(DEFAULT_GALAXY_POLAR),
  DEFAULT_GALAXY_DISTANCE * Math.sin(DEFAULT_GALAXY_POLAR) * Math.cos(DEFAULT_GALAXY_AZIMUTH),
];

/** Portrait views back away until the disk fits their width, keeping the composed perspective. */
export function overviewCameraForAspect(aspect: number): [number, number, number] {
  const scale = Number.isFinite(aspect) && aspect > 0 ? Math.max(1, 1 / aspect) : 1;
  return DEFAULT_GALAXY_CAMERA.map((value) => value * scale) as [number, number, number];
}

// ─── HOW TALL THE GALAXY IS ON SCREEN ──────────────────────────────────────────────────────────

/**
 * Half the galaxy's vertical extent in world units, seen at a given polar angle.
 *
 * A disk seen from `polar` radians off its pole projects to `R·cos(polar)` tall, and the halo adds
 * its own half-thickness turned edge-on. Face-on is the WORST case for vertical extent, not the
 * best — which is counter-intuitive enough to be worth stating, because it means the framing gets
 * tighter as the view gets more attractive.
 */
export function galaxyVerticalHalfExtent(polar: number = DEFAULT_GALAXY_POLAR): number {
  return GALAXY_RADIUS * Math.cos(polar) + THICKNESS.halo * Math.sin(polar);
}

/** The vertical FOV, in degrees, that just contains `halfExtent` at `distance`, with margin. */
export function fovToContain(
  halfExtent: number,
  distance: number,
  margin: number = FRAME_MARGIN,
): number {
  return (2 * Math.atan(halfExtent / (margin * distance))) / DEG;
}

/**
 * The floor the lock may not narrow past: the vertical field that still frames the whole galaxy at
 * the default distance. See the amendment note at the top of this file.
 */
export const MIN_GALAXY_FOV = fovToContain(galaxyVerticalHalfExtent(), DEFAULT_GALAXY_DISTANCE);

// ─── THE LOCK ──────────────────────────────────────────────────────────────────────────────────

/**
 * The vertical FOV, in degrees, that holds the horizontal field constant at `BASE_ASPECT` — floored
 * so the subject never leaves the frame.
 *
 * Returns `baseFov` unchanged at or below the reference aspect: the lock is a ceiling on width, not
 * a general rescaling, and applying it to narrow windows would zoom the subject out as the window
 * got taller.
 */
export function lockHorizontalFov(
  aspect: number,
  baseFov: number = BASE_FOV,
  baseAspect: number = BASE_ASPECT,
  floor: number = MIN_GALAXY_FOV,
): number {
  // A zero-width or zero-height container is a real transient — panels animate, and ResizeObserver
  // reports the frame in between. Framing it as a division by zero produces a NaN camera that never
  // recovers, so the composed value is the honest answer until there is a box to frame into.
  if (!Number.isFinite(aspect) || aspect <= 0) return baseFov;
  if (aspect <= baseAspect) return baseFov;
  const locked = (2 * Math.atan(Math.tan((baseFov * DEG) / 2) * (baseAspect / aspect))) / DEG;
  return Math.max(locked, Math.min(floor, baseFov));
}

/**
 * The horizontal field the camera actually presents, in degrees. Exists so the lock can be checked
 * by its PROPERTY — "this number does not change" — rather than by restating its own formula, which
 * is a test that passes whatever the formula becomes.
 */
export function horizontalFov(verticalFov: number, aspect: number): number {
  return (2 * Math.atan(aspect * Math.tan((verticalFov * DEG) / 2))) / DEG;
}

/**
 * What fraction of the viewport's SHORTER dimension the galaxy's vertical extent covers.
 *
 * The measure §14 states its "~72%" against. It is reported rather than forced: the brief's own
 * constants put it near 0.8 at the reference aspect, and chasing the stated figure would mean
 * moving a number §4 or §10 gives explicitly.
 */
export function verticalFillAt(
  aspect: number,
  distance: number = DEFAULT_GALAXY_DISTANCE,
  polar: number = DEFAULT_GALAXY_POLAR,
): number {
  const halfHeight = distance * Math.tan((lockHorizontalFov(aspect) * DEG) / 2);
  // The shorter dimension is the height whenever the viewport is landscape, which all four test
  // widths are. In portrait the half-width is the smaller of the two and becomes the divisor.
  const halfShorter = aspect >= 1 ? halfHeight : halfHeight * aspect;
  return galaxyVerticalHalfExtent(polar) / halfShorter;
}

/** The same fraction, measured across the frame rather than down it. */
export function horizontalFillAt(
  aspect: number,
  distance: number = DEFAULT_GALAXY_DISTANCE,
  radius: number = GALAXY_RADIUS,
): number {
  const halfHeight = distance * Math.tan((lockHorizontalFov(aspect) * DEG) / 2);
  return radius / (halfHeight * aspect);
}

// ─── PIXEL BUDGET ──────────────────────────────────────────────────────────────────────────────

/**
 * Device pixel ratio the surface may render at, capped at 2.
 *
 * 3× on a 5K display buys nothing a person can see and costs 2.25× the fill rate, and this scene is
 * fill-bound — bloom, the accretion shader and a 160k-point additive field all pay per pixel.
 */
export const DPR_RANGE: readonly [number, number] = [1, 2];

/** DPR cap for the reduced tier: half the fill rate, on the machines least able to afford it. */
export const MOBILE_DPR_MAX = 1.5;
