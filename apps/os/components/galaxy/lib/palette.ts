// components/galaxy/lib/palette — THE ENVIRONMENT COLOURS (brief §6).
//
// Presentation, not layout: these are the colours of the SPACE the bodies sit in, and they carry no
// business meaning at all. Body colour is a different question and a different authority — it comes
// from stellar temperature, which comes from the entity's own metrics, and it is derived rather than
// listed.
//
// Space stays true black. Depth comes from local light, dust and parallax inside the galaxy,
// never from a screen-wide gradient or noise over the empty background.
export const DEEP_SPACE = "#000000";
export const INTERGALACTIC_HAZE = "#000000";

/**
 * The environment, as one table.
 *
 * Grouped rather than exported as twenty constants because these are read together — a change to
 * the accretion ramp that leaves the rim behind produces a disk with a visible seam, and the ramp
 * is legible as a ramp only when its four stops sit on consecutive lines.
 */
export const ENVIRONMENT = {
  deepSpace: DEEP_SPACE,
  haze: INTERGALACTIC_HAZE,

  /** Dark umber absorption. Drawn with NORMAL blending — dust subtracts light, it does not add. */
  dustLane: "#2a160e",

  /** Star-forming knots in the arms: H-alpha pink through to the cooler ionised edge. */
  hAlpha: ["#ff4d7e", "#c3459b"] as const,

  /** Blue haze around hot young clusters — starlight scattered off dust rather than emitted. */
  reflectionNebula: "#4a7dff",

  /** Broad warm halo over the bulge, additive. The single biggest contributor to "this is a galaxy". */
  bulgeGlow: "#ffbe72",

  /** Accretion disk ramp, inner to outer. White-hot through to nothing. */
  accretion: ["#fffaf0", "#ffb454", "#d1552a", "#7a2412"] as const,

  /** True black; the surrounding ring separates it from empty space. */
  eventHorizon: "#000000",

  /** The photon ring. Overdriven past 1.0 at use so bloom blows it out into a hairline. */
  photonRing: "#fff8ee",
} as const;

/**
 * How far past 1.0 the photon ring is driven before tone mapping.
 *
 * Emissive overdrive is the mechanism the whole look rests on: values above 1.0 are what the bloom
 * pass selects on, and ACES is what rolls them off to white instead of clipping them into flat
 * blobs. An 8-bit framebuffer destroys both, which is why the composer runs at half-float.
 */
export const PHOTON_RING_INTENSITY = 4;
