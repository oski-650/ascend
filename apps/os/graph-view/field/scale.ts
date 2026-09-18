// graph-view/field/scale — THE WORLD'S DIMENSIONS (brief §4, §10).
//
// Real scale is impossible. The Sun is a hundred Earths across and the nearest star is thirty
// million solar diameters away; drawn honestly, a solar system is one pixel and everything else is
// empty. So the brief specifies a COMPRESSED but STRICTLY MONOTONIC scale, and this file is that
// table — nothing derived, nothing improvised.
//
// ─── WHY THE NUMBERS ARE A MODULE AND NOT LITERALS IN THE RENDERER ─────────────────────────────
//
// Two reasons, and the second is the load-bearing one.
//
// First, they are shared: the camera bands in §10 are stated in terms of the body radii in §4, and
// a galaxy radius that disagrees with the camera distance that frames it produces a scene that is
// correct in every file and wrong on screen.
//
// Second, F65 bans coordinates below this layer. `components/galaxy` may not compute a position,
// which means it may not own the numbers a position is computed FROM either — the ban would be
// decorative if the renderer held the scale and merely avoided the arithmetic.
//
// ─── MONOTONICITY IS A PROPERTY, NOT A COMMENT ─────────────────────────────────────────────────
//
// "Bigger always means bigger" is the one thing this table promises the viewer, and it is the one
// thing a later tuning pass can silently break: raise a moon's ceiling by a tenth and a large moon
// outgrows a small planet, and the encoding stops being readable without anyone noticing. The
// ordering is asserted in tests/graph/galaxy-field.test.ts against these exports, so a number cannot
// move across a boundary without the gate saying so.
//
// Prospects are the sharpest case and the brief states it outright: they are "deliberately smaller
// than any moon". `PROSPECT_RADIUS.max < MOON_RADIUS.min`, not merely smaller on average.

/** An inclusive range. Both ends are used — `min` is not a floor to be ignored. */
export type Span = { readonly min: number; readonly max: number };

const span = (min: number, max: number): Span => ({ min, max });

// ─── THE FIELD ─────────────────────────────────────────────────────────────────────────────────

/** Outer edge of the disk. The halo extends past it; nothing else does. */
export const GALAXY_RADIUS = 1400;

/** The bulge: dense, old, warm, and thick in Y where the disk is thin. */
export const CORE_RADIUS = 190;

// ─── THE BLACK HOLE ────────────────────────────────────────────────────────────────────────────

/**
 * Schwarzschild radius — the ONE free parameter of the galactic core.
 *
 * Every other black-hole dimension is stated as a multiple of it in `graph-view/field/blackhole`,
 * so the whole assembly rescales from this number and the photon ring cannot drift off the shadow.
 *
 * ─── §4 SAYS 6, AND 6 IS INVISIBLE ───────────────────────────────────────────────────────────
 *
 * At 6, the shadow is 15.6 units. Seen from §10's galaxy-level camera at 3400 that is **four pixels
 * across**, buried inside a bulge 190 units wide — so the object §7 calls "the visual anchor" of
 * the entire scene rendered as a speck that nothing could distinguish from a bright star, and the
 * centre of the galaxy stayed a solid gold blob with no black in it at all.
 *
 * At 26 the shadow is 67.6 units and the ambient band reaches 176 — which lands, without being
 * aimed at it, almost exactly on the bulge radius of 190. The hole's influence covers the bulge's
 * bright heart: stars fade out as they approach it and the middle of the galaxy is genuinely black.
 * That is what the assembly is for, and no amount of tuning the shadow's shader substitutes for
 * making it big enough to see.
 */
export const SCHWARZSCHILD_RADIUS = 26;

// ─── BODIES ────────────────────────────────────────────────────────────────────────────────────

/** Where client stars live. Inside the bulge is the black hole's; outside is the belt's. */
export const STAR_ORBIT_BAND = span(260, 1280);

/** The outer belt. Prospects are outsiders until they are not. */
export const PROSPECT_BELT = span(1420, 1620);

export const STAR_RADIUS = span(6, 11);
export const PLANET_RADIUS = span(0.55, 2.1);
export const MOON_RADIUS = span(0.12, 0.42);
export const PROSPECT_RADIUS = span(0.05, 0.1);

/**
 * Planet orbital radii, roughly Titius–Bode spaced, taken in order and jittered per seed.
 *
 * Stated as a LIST rather than a formula because the brief states it as a list, and because the
 * gaps matter more than the law: each ring has to clear the last by more than the largest planet's
 * diameter or two projects overlap, which is the failure the old layout spent four rounds on.
 */
export const PLANET_ORBITS: readonly number[] = [22, 34, 47, 62, 79, 98, 119, 142];

/** Moon orbital radii, innermost to outermost. */
export const MOON_ORBITS = span(2.6, 6.4);

// ─── THICKNESS ─────────────────────────────────────────────────────────────────────────────────

/**
 * Half-thickness in Y. The galactic pole is +Y.
 *
 * The disk THINS with radius — ±9 near the centre falling to ±4 at the rim — which is a real
 * property of real disks and is most of why a galaxy seen at an angle looks like an object rather
 * than a sprinkle. The bulge is four times thicker than the disk it sits in, and the halo is
 * spherical rather than flattened at all.
 */
export const THICKNESS = {
  bulge: 38,
  diskInner: 9,
  diskRim: 4,
  halo: 420,
} as const;

// ─── THE CAMERA (§10) ──────────────────────────────────────────────────────────────────────────

/** Every level the camera can rest at, outermost first. Order is meaningful: it is the drill path. */
export const FOCUS_LEVELS = ["galaxy", "system", "planet", "moon"] as const;
export type FocusLevel = (typeof FOCUS_LEVELS)[number];

/**
 * Per-level camera rails. There is no free-fly: distance and polar angle are CLAMPED to these, so
 * the scene cannot get away from the operator and every level has a composition somebody chose.
 *
 * Polar angles are radians from +Y. 0 is straight down the pole, π/2 is edge-on in the disk plane.
 */
export const CAMERA_RAILS: Readonly<Record<FocusLevel, { distance: Span; polar: Span }>> = {
  galaxy: { distance: span(1900, 3400), polar: span(0.2094, 1.0821) }, // 12° – 62°
  system: { distance: span(55, 240), polar: span(0.1396, 1.3614) },    //  8° – 78°
  planet: { distance: span(5, 22), polar: span(0, Math.PI / 2) },      //  0° – 90°
  moon: { distance: span(1, 4.5), polar: span(0, Math.PI / 2) },       //  0° – 90°
};

/** Vertical field of view at the reference aspect, in degrees. See `lockHorizontalFov`. */
export const BASE_FOV = 55;

/**
 * The aspect the FOV was composed at. Wider than this and the galaxy would crop at the sides, so
 * §14 locks the HORIZONTAL field instead and lets the vertical one narrow. 16:9.
 */
export const BASE_ASPECT = 16 / 9;

/**
 * Near and far planes. The scene spans roughly 0.15 (a moon's surface) to 3000 (the halo's far
 * edge) — four decades — which is exactly the range a 24-bit depth buffer cannot resolve linearly.
 * `logarithmicDepthBuffer` is not optional at this ratio; without it moons z-fight with their
 * planets while the halo stipples.
 */
export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR = 12000;
