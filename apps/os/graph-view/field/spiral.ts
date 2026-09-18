// graph-view/field/spiral — THE GALAXY ITSELF (brief §5).
//
// ─── DO NOT DRAW A SPIRAL ──────────────────────────────────────────────────────────────────────
//
// The obvious construction is to scatter points along a logarithmic spiral and add noise. It always
// looks like a drawn swirl, and §16.10 names it as the last of the ten ways this gets wrecked. The
// tell is that the arms SHEAR: stars at different radii orbit at different rates, so within a few
// turns the arms wind themselves into a smear, and the usual fix — freezing the arms and rotating
// the whole thing rigidly — produces a pinwheel, which is not what a galaxy does either.
//
// What real grand-design spirals do, and what this file implements, is the DENSITY WAVE:
//
//   • every star travels a fixed ellipse centred on the core
//   • the ellipses are progressively rotated with radius — `tilt = a · ANGULAR_OFFSET`
//   • their crowding at the turning points IS the arm
//
// The ellipses never move. Stars move along them at any speed you like, pass THROUGH the arms, and
// the arms stay put — because an arm is not a set of stars, it is a traffic jam. That is both the
// physics and the reason this is the only construction that survives being animated.
//
// ─── WHAT IS AND IS NOT COMPUTED HERE ──────────────────────────────────────────────────────────
//
// This file produces, once, the per-star constants of an orbit: semi-major axis, axis ratio, tilt,
// initial phase, angular rate, height. **It does not produce positions.** The position at time t is
// a closed form over those constants, evaluated in the vertex shader — which is the same
// arrangement as rotating a `<group>` and letting three.js multiply the matrices, one layer further
// down. At t = 0 the shader reproduces the rest position this file also writes into `position`, and
// that equivalence is asserted rather than assumed (see tests/graph/galaxy-spiral.test.ts).
//
// The consequence worth stating: **this layer is still the only authority on where a star is.**
// Stop the clock and the arrangement is exactly what was computed here.
//
// PURE: no three.js, no DOM, no React. It returns typed arrays, so the whole construction is
// provable in plain Node at full strength — which matters, because nothing inside a `<Canvas>` is.

import { CORE_RADIUS, GALAXY_RADIUS, THICKNESS } from "./scale";
import { gaussian, lerp, seedFrom, valueNoise2D } from "./seed";

// ─── THE SHAPE OF THE SPIRAL ───────────────────────────────────────────────────────────────────

/**
 * How far the arms wind, in full turns from the centre to the rim.
 *
 * ─── STATED IN TURNS, AND THE BRIEF'S NUMBER IS WHY ──────────────────────────────────────────
 *
 * §5 gives `ANGULAR_OFFSET ≈ 0.00085 rad/unit` with a tuning range of 0.0006–0.0012. At §4's galaxy
 * radius of 1400 that is **0.19 turns — sixty-eight degrees of sweep across the entire disk**,
 * which is not a spiral. It is a two-armed oval. The number is internally consistent with itself
 * and inconsistent with the radius it is applied to: rad-per-unit is a scale-DEPENDENT quantity, so
 * a value calibrated against a galaxy of radius 15,000 under-winds by an order of magnitude here.
 *
 * Measured, at 40,000 stars, azimuthal peak-to-mean contrast in the 520–760 band:
 *
 *     0.00085 → 0.19 turns    0.00337 → 0.75 turns    0.00449 → 1.00 turns
 *
 * So the quantity is stated in TURNS, which is scale-free and survives a change to the radius, and
 * the rad-per-unit figure is derived. 0.55 turns is about what NGC 1300 shows — each arm sweeping
 * roughly 180° out of the bar — which is the reference §15's Phase 3 names.
 *
 * §5's instruction "higher = tighter winding" is unchanged; only the unit is.
 */
export const ARM_WINDING_TURNS = 0.55;

/** Radians of ellipse rotation per world unit of radius. Derived, not tuned directly. */
export const ANGULAR_OFFSET = (ARM_WINDING_TURNS * 2 * Math.PI) / GALAXY_RADIUS;

/**
 * Inside this radius the ellipses are forced towards a single angle, which is what a BAR is.
 *
 * Most spirals have one, and it does more work than its size suggests: without it the centre is a
 * fuzzy ball and the arms appear to come from nowhere. With it the core reads as a structure that
 * the arms are attached to.
 */
export const BAR_RADIUS = 210;
export const BAR_ANGLE = 0.42;

/** Flat rotation curve — the dark-matter-like one real galaxies have. Units per second at 1× time. */
export const V0 = 26;

/** Two arms, not four. Grand-design spirals are more legible and more photogenic. */
export const ARMS = 2;

/** Star counts by tier (§13). */
export const DESKTOP_STARS = 160_000;
export const MOBILE_STARS = 45_000;

// ─── POPULATIONS ───────────────────────────────────────────────────────────────────────────────

export type Population = "bulge" | "disk" | "arm" | "halo";

/** Index into the typed `population` array, and the order shares are accumulated in. */
export const POPULATION_ORDER: readonly Population[] = ["bulge", "disk", "arm", "halo"];

/**
 * The four populations, their shares, and what each contributes to the picture.
 *
 * `concentration` is how hard a population's phases are pulled towards the two arm angles. It is
 * the whole mechanism behind "arms with contrast": uniform phases give a smooth disk, and it is the
 * DIFFERENCE between a concentrated young population and a diffuse old one that the eye reads as
 * structure. Zero in the halo, highest in the arms, exactly as §5 describes.
 */
export const POPULATIONS: Readonly<Record<Population, {
  readonly share: number;
  readonly minK: number;
  readonly maxK: number;
  readonly concentration: number;
  readonly brightness: number;
}>> = {
  // ─── BRIGHTNESS IS WHERE THE FIRST RENDER WENT WRONG ─────────────────────────────────────────
  //
  // The bulge is 30% of the stars inside a radius of 190, and light ADDS. At the brightness this
  // row first carried it stacked into a featureless white disc that swallowed the bar, the inner
  // arms and its own colour — the one part of the galaxy that is supposed to be amber came out
  // pure white. Lowering it does not make the core dimmer on screen, because overlap does that job;
  // it makes the core a GLOW with structure in it instead of a blown-out hole in the picture.
  bulge: { share: 0.30, minK: 3200, maxK: 5200, concentration: 0.12, brightness: 0.42 },
  // The background wash. Most of the light, almost none of the structure.
  disk: { share: 0.42, minK: 3000, maxK: 7500, concentration: 0.5, brightness: 0.8 },
  // Young, hot, clumped. A fifth of the stars carrying most of what anyone would call "the spiral".
  arm: { share: 0.22, minK: 7500, maxK: 30000, concentration: 1.4, brightness: 1.9 },
  // Very dim, very sparse, spherical. Its job is to stop the disk having an edge.
  halo: { share: 0.06, minK: 3000, maxK: 4500, concentration: 0, brightness: 0.55 },
};

/** Exponential scale length of the disk, in world units. */
export const DISK_SCALE_LENGTH = 340;

/**
 * The arm population sits FURTHER OUT than the disk it belongs to, and starts outside the bulge.
 *
 * §5 says "disk dist, phase-concentrated", and taken literally that puts most of the young blue
 * stars inside 340 units — underneath the bulge, where nothing can be seen. Star formation is an
 * outer-disk phenomenon in real spirals for exactly the reason it matters here: the arms are only
 * legible where there is room for them.
 *
 * A longer scale length and a floor at the bulge edge, so the blue population lands where the eye
 * can read it as structure rather than as part of the core.
 */
export const ARM_SCALE_LENGTH = DISK_SCALE_LENGTH * 1.8;
export const ARM_INNER_RADIUS = CORE_RADIUS * 1.1;

/**
 * Point-size range before perspective, and the exponent that makes bright stars RARE.
 *
 * A uniform magnitude distribution is the second way this reads as dust: every point the same size
 * is a texture, not a sky. The power law puts about 1% of stars conspicuously above the rest, and
 * those few carry the colour while the remaining 99% carry the structure as a haze.
 */
export const MAGNITUDE = { min: 0.55, max: 4.2, exponent: 6 } as const;

// ─── THE CONSTRUCTION ──────────────────────────────────────────────────────────────────────────

/**
 * Semi-minor over semi-major, by radius.
 *
 * Circular at the very centre, most eccentric at the bulge edge, returning to circular at the rim
 * and staying circular in the halo. The eccentric middle band is where the crowding happens, so
 * this function is where the arms come from — flatten it and the spiral disappears entirely.
 */
export function axisRatio(a: number): number {
  if (a < CORE_RADIUS) return lerp(1.0, 0.78, a / CORE_RADIUS);
  if (a < GALAXY_RADIUS) return lerp(0.78, 1.0, (a - CORE_RADIUS) / (GALAXY_RADIUS - CORE_RADIUS));
  return 1.0;
}

/** Ellipse orientation at radius `a`, pulled towards the bar angle inside `BAR_RADIUS`. */
export function tiltAt(a: number): number {
  const free = a * ANGULAR_OFFSET;
  const bar = Math.max(0, 1 - a / BAR_RADIUS);
  return lerp(free, BAR_ANGLE, bar);
}

/** Orbital speed at radius `a`: rises through the core, then flattens. */
export function orbitalVelocity(a: number): number {
  return (V0 * a) / (a + CORE_RADIUS * 0.35);
}

/**
 * Angular rate at radius `a`, in radians per unit time.
 *
 * A flat velocity curve means angular rate falls as 1/a, so the inner galaxy laps the outer one.
 * That differential rotation is the thing the density wave has to survive, and it is the reason the
 * ellipses — rather than the stars — hold the arms.
 */
export function angularRate(a: number): number {
  // At the exact centre the rate is the limit of V(a)/a, which is finite; guarding it keeps one
  // star from carrying an Infinity into the buffer and poisoning the bounding sphere.
  if (a < 1e-6) return V0 / (CORE_RADIUS * 0.35);
  return orbitalVelocity(a) / a;
}

/** Half-thickness of the disk at radius `a`. Thins outward, exactly as real disks do. */
export function diskThickness(a: number): number {
  if (a >= GALAXY_RADIUS) return THICKNESS.diskRim;
  return lerp(THICKNESS.diskInner, THICKNESS.diskRim, a / GALAXY_RADIUS);
}

/** How much of the bulge's extra height applies at radius `a`. 1 at the centre, 0 past the bulge. */
export function bulgeFactor(a: number): number {
  return Math.max(0, 1 - a / CORE_RADIUS);
}

/**
 * Pull a uniform phase towards the nearest arm angle.
 *
 * `concentration` 0 returns the phase untouched. Higher values push it towards the nearest multiple
 * of `2π / ARMS`, which for two arms is 0 and π — the turning points of the ellipses, where the
 * crowding is. Deliberately a SQUEEZE of a uniform sample rather than a rejection-sampled von
 * Mises: it is branchless, exactly reproducible, and the difference is invisible at 160,000 points.
 */
export function concentratePhase(phase: number, concentration: number): number {
  if (concentration <= 0) return phase;
  const sector = (2 * Math.PI) / ARMS;
  const index = Math.floor(phase / sector);
  const t = (phase - index * sector) / sector;   // 0..1 within this arm's sector
  // Map t towards both ENDS of the sector, which are the two arm angles bounding it.
  const centred = 2 * t - 1;                      // -1..1
  const pushed = Math.sign(centred) * Math.pow(Math.abs(centred), 1 / (1 + concentration));
  return (index + (pushed + 1) / 2) * sector;
}

// ─── THE FIELD ─────────────────────────────────────────────────────────────────────────────────

export interface StarField {
  readonly count: number;
  /** Rest position at t = 0. Also what the geometry's bounding sphere is computed from. */
  readonly position: Float32Array;
  readonly semiMajor: Float32Array;
  readonly axisRatio: Float32Array;
  readonly tilt: Float32Array;
  readonly phase: Float32Array;
  readonly omega: Float32Array;
  readonly y: Float32Array;
  readonly magnitude: Float32Array;
  /** Kelvin. Converted to colour by the presentation layer, which owns what a temperature looks like. */
  readonly temperature: Float32Array;
  /** Dimensionless 0–1 dust column along the line of sight. Drives reddening and extinction. */
  readonly dust: Float32Array;
  /** Index into POPULATION_ORDER. Present so the composition can be asserted, not for drawing. */
  readonly population: Uint8Array;
}

/**
 * An exponential distribution restricted to `[lo, hi]`, inverted from a uniform sample.
 *
 * ─── A TRUNCATED EXPONENTIAL, NOT A CLAMPED ONE ────────────────────────────────────────────────
 *
 * The obvious form is to sample the unbounded exponential and clamp with `Math.min(r, hi)`. It
 * draws a RING. About 1.1% of disk stars land past the rim, and a clamp does not discard them — it
 * stacks every one of them on the rim exactly. At 102,000 disk stars that is roughly 1,150 points
 * on a circle of zero width, and it rendered as a razor-thin bright arc around the galaxy, plainly
 * visible in the first screenshot of this phase.
 *
 * Inverting the truncated distribution maps the whole unit interval into `[lo, hi]` with no pile-up
 * at either end. Same shape, same scale length, no edge — and it gives the arm population its inner
 * cut for free, which a `Math.max` would have turned into the same ring at the other end.
 */
function truncatedExponential(rand: () => number, scale: number, lo: number, hi: number): number {
  const low = Math.exp(-lo / scale);
  const high = Math.exp(-hi / scale);
  return -scale * Math.log(low - rand() * (low - high));
}

/** Radial sample for one population. Each is the distribution §5 states for it. */
function sampleRadius(population: Population, rand: () => number): number {
  switch (population) {
    case "bulge":
      // ─── THE BULGE HAS NO EDGE EITHER ────────────────────────────────────────────────────────
      //
      // `CORE_RADIUS * pow(u, 0.55)` is the obvious form and has the same defect as the clamped
      // disk, one step subtler: its maximum is exactly `CORE_RADIUS`, so the population stops dead
      // at that radius. It does not pile up into a ring, but it renders as a hard-edged disc — a
      // circle of gold with a visible rim, which is what the second screenshot of this phase showed
      // and which nothing in nature looks like.
      //
      // Real bulges fall off exponentially with a long tail. A short scale length keeps the
      // concentration, and letting it run out past the nominal core radius removes the rim.
      return truncatedExponential(rand, CORE_RADIUS * 0.42, 0, CORE_RADIUS * 2.6);
    case "halo":
      // Starts at the rim and trails off well past it, so the disk fades rather than stopping.
      return GALAXY_RADIUS * (1 + Math.pow(rand(), 2) * 0.9);
    case "arm":
      return truncatedExponential(rand, ARM_SCALE_LENGTH, ARM_INNER_RADIUS, GALAXY_RADIUS);
    default:
      return truncatedExponential(rand, DISK_SCALE_LENGTH, 0, GALAXY_RADIUS);
  }
}

/**
 * Build the whole field, deterministically.
 *
 * One PRNG stream for everything, so the same `count` and `key` always produce the identical galaxy
 * — including which stars are bright and where the dust falls. Changing the count changes the
 * galaxy, which is acceptable because the count is a property of the machine, not of the business.
 */
export function generateStarField(count: number, key = "ascend-galaxy"): StarField {
  const rand = seedFrom(key);
  const dustSeed = Math.floor(rand() * 0xffffffff);

  const position = new Float32Array(count * 3);
  const semiMajor = new Float32Array(count);
  const ratio = new Float32Array(count);
  const tilt = new Float32Array(count);
  const phase = new Float32Array(count);
  const omega = new Float32Array(count);
  const y = new Float32Array(count);
  const magnitude = new Float32Array(count);
  const temperature = new Float32Array(count);
  const dust = new Float32Array(count);
  const population = new Uint8Array(count);

  // Cumulative shares, computed once rather than per star.
  const cumulative: number[] = [];
  let running = 0;
  for (const name of POPULATION_ORDER) {
    running += POPULATIONS[name].share;
    cumulative.push(running);
  }

  for (let i = 0; i < count; i++) {
    const pick = rand() * running;
    let index = 0;
    while (index < cumulative.length - 1 && pick > cumulative[index]) index++;
    const name = POPULATION_ORDER[index];
    const spec = POPULATIONS[name];
    population[i] = index;

    const a = sampleRadius(name, rand);
    const b = axisRatio(a);
    const t = tiltAt(a);
    const p = concentratePhase(rand() * Math.PI * 2, spec.concentration);

    semiMajor[i] = a;
    ratio[i] = b;
    tilt[i] = t;
    phase[i] = p;
    omega[i] = angularRate(a);

    // Height. The bulge is four times the disk's thickness and the halo is spherical, so the same
    // Gaussian is scaled by three different things depending on where the star landed.
    const thickness = name === "halo"
      ? THICKNESS.halo
      : diskThickness(a) * (1 + 3 * bulgeFactor(a));
    y[i] = gaussian(rand) * thickness;

    // The rest position. Also what the shader must reproduce at t = 0.
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x0 = a * Math.cos(p);
    const z0 = a * b * Math.sin(p);
    const x = x0 * ct - z0 * st;
    const z = x0 * st + z0 * ct;
    position[i * 3] = x;
    position[i * 3 + 1] = y[i];
    position[i * 3 + 2] = z;

    temperature[i] = lerp(spec.minK, spec.maxK, rand());
    magnitude[i] =
      (MAGNITUDE.min + (MAGNITUDE.max - MAGNITUDE.min) * Math.pow(rand(), MAGNITUDE.exponent)) *
      spec.brightness;

    // ─── DUST ────────────────────────────────────────────────────────────────────────────────
    //
    // Two octaves of value noise at the star's own position, weighted by how close its phase is to
    // an arm — dust lives in the arms, which is why arms have warm edges and cool cores — and faded
    // out past the rim, because the halo is above the disk and has nothing in front of it.
    const armProximity = Math.abs(Math.cos(p * (ARMS / 2)));
    const noise =
      0.62 * valueNoise2D(x / 210, z / 210, dustSeed) +
      0.38 * valueNoise2D(x / 70, z / 70, dustSeed ^ 0x9e3779b9);
    const inDisk = name === "halo" ? 0.1 : Math.max(0, 1 - a / (GALAXY_RADIUS * 1.1));
    dust[i] = Math.min(1, noise * (0.3 + 0.9 * armProximity) * (0.35 + 0.65 * inDisk));
  }

  return {
    count, position, semiMajor, axisRatio: ratio, tilt, phase, omega, y,
    magnitude, temperature, dust, population,
  };
}

/**
 * The rest position of star `i`, recomputed on demand.
 *
 * Exists so the shader's closed form can be checked against this layer's arithmetic at t = 0 rather
 * than trusted. If the two ever disagree the picture stops being the model, which is the failure
 * the whole layering exists to prevent — and it is invisible, because a wrong-but-plausible galaxy
 * still looks like a galaxy.
 */
export function restPosition(field: StarField, i: number): [number, number, number] {
  return [field.position[i * 3], field.position[i * 3 + 1], field.position[i * 3 + 2]];
}

/** Where star `i` is at time `t`. The same closed form the vertex shader evaluates. */
export function positionAt(field: StarField, i: number, t: number): [number, number, number] {
  const a = field.semiMajor[i];
  const b = a * field.axisRatio[i];
  const phi = field.phase[i] + field.omega[i] * t;
  const ct = Math.cos(field.tilt[i]);
  const st = Math.sin(field.tilt[i]);
  const x0 = a * Math.cos(phi);
  const z0 = b * Math.sin(phi);
  return [x0 * ct - z0 * st, field.y[i], x0 * st + z0 * ct];
}
