// components/galaxy/lib/starColors — TEMPERATURE AND DUST INTO A COLOUR BUFFER.
//
// The seam between the layout layer and the picture. `graph-view/field/spiral` emits a TEMPERATURE
// per star, because how hot a star is belongs to the model; what a temperature LOOKS like belongs
// here. Keeping the two apart is what lets the palette be retuned without regenerating the galaxy,
// and it is why the field's buffers carry kelvin rather than RGB.
//
// Takes plain typed arrays rather than a `StarField` so it is testable without building one, and so
// it has no reason to know what a star is.

import { blackbodyRGB, redden } from "./blackbody";

/**
 * Linear RGB for every star, as a flat `count * 3` buffer ready for a geometry attribute.
 *
 * Linear, NOT sRGB: the shader's output passes through the colour-space chunk on its way to the
 * framebuffer, so converting here would apply the transfer function twice and wash the whole field
 * out — the mistake looks like "the galaxy is too pale" rather than like an error.
 */
export function starColors(temperature: Float32Array, dust: Float32Array): Float32Array {
  const out = new Float32Array(temperature.length * 3);
  for (let i = 0; i < temperature.length; i++) {
    const [r, g, b] = redden(blackbodyRGB(temperature[i]), dust[i]);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}
