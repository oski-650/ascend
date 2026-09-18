// graph-view/field/seed — DETERMINISTIC RANDOMNESS (brief §3).
//
// ─── WHY THIS MATTERS MORE THAN IT LOOKS ───────────────────────────────────────────────────────
//
// Every orbital angle, inclination, phase offset, planet spacing and moon spacing in the galaxy is
// drawn from here, seeded by an entity's id. Never `Math.random()`, and never a counter.
//
// The reason is not reproducible tests. It is that **a client's star must be in the same place
// tomorrow.** Spatial memory is the entire argument for drawing a business as a galaxy rather than
// listing it: the operator learns that Tapia is the amber star out past the second arm, and that
// knowledge is worth something only if it survives a refresh. A layout that reshuffles is a layout
// nobody can navigate, however pretty each individual frame is.
//
// ─── FNV-1a, THEN MULBERRY32, AND WHY BOTH ─────────────────────────────────────────────────────
//
// FNV-1a turns a string into a 32-bit integer. It is fast and it is NOT well-distributed at the top
// end: ids sharing a prefix — which every id in this system does, being `client:…`, `project:…` —
// produce hashes that share high bits. A previous layout seeded slot order directly from a hash
// like this and the result was visibly banded BY TYPE, because the hash had never been avalanched.
//
// Mulberry32 is what fixes that. Its first act is to add a large odd constant and mix, so two seeds
// differing in one bit produce unrelated streams. Hash for identity, PRNG for distribution — using
// either alone is how the banding came back the second time.

/** FNV-1a, 32-bit. Identity only: this value is a seed, never a coordinate and never an ordering. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A mulberry32 generator. Returns numbers in [0, 1).
 *
 * Stateful BY DESIGN, and the state is local to the returned closure — F17's ban is on module-level
 * mutable state, which this is not. Two calls to `seedFrom` with the same id produce two independent
 * generators yielding identical sequences.
 */
export function seedFrom(id: string): () => number {
  let state = hashId(id);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A standard normal deviate, by Box–Muller.
 *
 * Disk thickness is Gaussian rather than uniform because real ones are: a uniform slab has a hard
 * edge, and the hard edge is visible from every angle but straight down. Takes the generator rather
 * than an id so a caller can draw many values from one deterministic stream.
 */
export function gaussian(rand: () => number): number {
  // `1 - rand()` moves the domain to (0, 1]: `Math.log(0)` is -Infinity, and one infinite star
  // ruins the geometry's bounding sphere for every other star in the buffer.
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Linear interpolation, clamped. Used everywhere below; stated once. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(Math.max(t, 0), 1);
}

/**
 * Smooth 2-D value noise, deterministic in its integer seed.
 *
 * Exists for the DUST COLUMN — how much interstellar material sits between a star and the viewer,
 * which reddens and dims it. A texture lookup would be the obvious implementation and is the wrong
 * one twice over: it would need a rasteriser (F66 bans browser-rasterised textures outright, for a
 * Safari bug that cost four rounds), and the field is sampled once per star at build time rather
 * than per pixel, so there is nothing to gain from a texture anyway.
 */
export function valueNoise2D(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  // Smoothstep on the fractional part. Without it the field is piecewise-linear and the seams
  // between cells read as a grid, which on a galaxy looks like graph paper.
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const corner = (cx: number, cz: number): number => {
    let h = Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cz, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x2545f491);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  return lerp(
    lerp(corner(xi, zi), corner(xi + 1, zi), u),
    lerp(corner(xi, zi + 1), corner(xi + 1, zi + 1), u),
    v,
  );
}
