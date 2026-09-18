// components/galaxy/lib/blackbody — STELLAR COLOUR (brief §6).
//
// ─── COLOUR IS PHYSICS HERE, NOT PALETTE ───────────────────────────────────────────────────────
//
// A star's colour is its surface temperature and nothing else. That is why this file is a table of
// ten measured anchors rather than a set of chosen hues, and it is the single biggest reason a
// rendered galaxy reads as a photograph or as a particle demo: uniform-coloured points look like
// dust, and the SPREAD of blue-white through amber across a population is what the eye recognises.
//
// The anchors run O (30000 K, blue-white) to L (2600 K, deep orange). Interpolation happens in
// LINEAR space, not in sRGB — mixing two sRGB triples numerically is mixing the encoding rather
// than the light, and the midpoints come out muddy in exactly the range this table spends most of
// its time in.
//
// ─── INTERSTELLAR REDDENING DOES AN ENORMOUS AMOUNT OF WORK FOR ALMOST NOTHING ─────────────────
//
// Light crossing dust loses its blue end first, which is why a sunset is red. Applied here as a
// per-star attenuation of the blue channel by `exp(-0.4 · column)`, plus an overall dimming. It is
// subtle per star and structural in aggregate: the arms acquire warm dusty edges against cool blue
// cores, and the bulge glows amber through the material in front of it. Nobody looking at the
// result can name the effect, and removing it makes the galaxy look synthetic immediately.
//
// PURE. No three.js, no DOM. It returns plain numbers so the generation pass can run in a test.

/** Linear-RGB anchors, hottest first. Hex values are the brief's §6 table, converted on use. */
const ANCHORS: readonly (readonly [kelvin: number, hex: string])[] = [
  [30000, "#9bb2ff"], // O
  [20000, "#a7bdff"], // B
  [10000, "#c3d0ff"], // B/A
  [7500, "#dfe4ff"],  // A
  [6800, "#f6f4ff"],  // F
  [5800, "#fff3e8"],  // G  — the Sun
  [5000, "#ffd9b0"],  // K
  [4000, "#ffbd7a"],  // K/M
  [3200, "#ffa85c"],  // M
  [2600, "#ff8a4a"],  // L
];

/** sRGB channel → linear. The standard transfer function, not the 2.2 approximation. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function parseLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [
    toLinear(((n >> 16) & 0xff) / 255),
    toLinear(((n >> 8) & 0xff) / 255),
    toLinear((n & 0xff) / 255),
  ];
}

/** The table, converted once. */
const LINEAR: readonly (readonly [number, readonly [number, number, number]])[] =
  ANCHORS.map(([k, hex]) => [k, parseLinear(hex)] as const);

export const MIN_TEMPERATURE = ANCHORS[ANCHORS.length - 1][0];
export const MAX_TEMPERATURE = ANCHORS[0][0];

/**
 * Linear RGB for a blackbody temperature in kelvin.
 *
 * Clamped at both ends rather than extrapolated: past 30000 K the anchors would run off into
 * imaginary colour, and past 2600 K into black. A star outside the table is drawn as the nearest
 * one in it, which is wrong by a degree nobody can see and right in every way that matters.
 */
export function blackbodyRGB(kelvin: number): [number, number, number] {
  if (kelvin >= MAX_TEMPERATURE) return [...LINEAR[0][1]];
  if (kelvin <= MIN_TEMPERATURE) return [...LINEAR[LINEAR.length - 1][1]];
  for (let i = 0; i < LINEAR.length - 1; i++) {
    const [hotK, hot] = LINEAR[i];
    const [coolK, cool] = LINEAR[i + 1];
    if (kelvin <= hotK && kelvin >= coolK) {
      const t = (kelvin - coolK) / (hotK - coolK);
      return [
        cool[0] + (hot[0] - cool[0]) * t,
        cool[1] + (hot[1] - cool[1]) * t,
        cool[2] + (hot[2] - cool[2]) * t,
      ];
    }
  }
  return [...LINEAR[LINEAR.length - 1][1]];
}

/** How hard dust bites the blue channel. The brief's §6 coefficient. */
export const REDDENING = 0.4;

/** How much dust dims a star overall, independent of colour. */
export const EXTINCTION = 0.22;

/**
 * Apply interstellar reddening to a linear colour.
 *
 * `column` is a dimensionless 0–1 dust density along the line of sight, produced by the field
 * generator. Blue is attenuated hardest, green a third as hard, red barely at all — the ordering is
 * what makes it read as reddening rather than as a brightness change.
 */
export function redden(
  rgb: readonly [number, number, number],
  column: number,
): [number, number, number] {
  const dim = 1 - EXTINCTION * column;
  return [
    rgb[0] * dim,
    rgb[1] * Math.exp((-REDDENING / 3) * column) * dim,
    rgb[2] * Math.exp(-REDDENING * column) * dim,
  ];
}
