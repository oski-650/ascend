// Layer A — STELLAR COLOUR (Galaxy rebuild, Phase 2).
//
// Colour is the single biggest reason a rendered galaxy reads as a photograph or as a particle
// demo. §16.1 puts "rendering all stars with the same colour and size" at the top of the list of
// things that wreck this, and the fix is not a palette — it is that a star's colour IS its surface
// temperature, so the spread across a population comes out right for free.
//
// These assertions are about ORDERING and MONOTONICITY rather than about exact triples. A table of
// ten anchors will be retuned; what must not change is that hotter is bluer, that dust reddens
// rather than merely dims, and that the interpolation happens in linear light.

import { describe, expect, it } from "vitest";
import {
  EXTINCTION, MAX_TEMPERATURE, MIN_TEMPERATURE, REDDENING, blackbodyRGB, redden,
} from "@/components/galaxy/lib/blackbody";

/** Blue minus red, in linear light. Positive is a hot star, negative is a cool one. */
const coolness = (rgb: readonly [number, number, number]) => rgb[2] - rgb[0];

describe("HOTTER IS BLUER · monotonically, across the whole table", () => {
  it("the blue-red balance falls as temperature falls, with no reversals", () => {
    // A single reversal anywhere would put a band of stars at the wrong end of the colour ramp, and
    // it would look like an artistic choice rather than a bug.
    const samples = [30000, 20000, 14000, 10000, 8500, 7500, 7000, 6800, 6200, 5800, 5400, 5000,
      4500, 4000, 3600, 3200, 2900, 2600];
    const values = samples.map((k) => coolness(blackbodyRGB(k)));
    for (const [i, v] of values.entries()) {
      if (i === 0) continue;
      expect(v, `${samples[i]}K is not cooler-looking than ${samples[i - 1]}K`)
        .toBeLessThanOrEqual(values[i - 1] + 1e-9);
    }
    expect(values[0], "the hottest star is not blue").toBeGreaterThan(0);
    expect(values[values.length - 1], "the coolest star is not red").toBeLessThan(0);
  });

  it("the Sun's temperature comes out very nearly white", () => {
    // The anchor a viewer's eye is calibrated against without knowing it. If 5800 K is not neutral,
    // every other colour in the scene is being judged against a tinted reference.
    const [r, g, b] = blackbodyRGB(5800);
    expect(Math.abs(r - g)).toBeLessThan(0.12);
    expect(Math.abs(g - b)).toBeLessThan(0.2);
  });

  it("out-of-range temperatures clamp instead of extrapolating into imaginary colour", () => {
    expect(blackbodyRGB(1e6)).toEqual(blackbodyRGB(MAX_TEMPERATURE));
    expect(blackbodyRGB(0)).toEqual(blackbodyRGB(MIN_TEMPERATURE));
    expect(blackbodyRGB(-500)).toEqual(blackbodyRGB(MIN_TEMPERATURE));
  });

  it("every channel stays in gamut at every temperature", () => {
    for (let k = MIN_TEMPERATURE; k <= MAX_TEMPERATURE; k += 137) {
      for (const channel of blackbodyRGB(k)) {
        expect(channel, `${k}K produced ${channel}`).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("interpolation is CONTINUOUS across an anchor", () => {
    // A discontinuity at an anchor shows up as a visible band in the population — a ring of stars
    // one colour and its neighbour another, at whatever radius that temperature happens to fall.
    for (const anchor of [20000, 10000, 7500, 6800, 5800, 5000, 4000, 3200]) {
      const below = blackbodyRGB(anchor - 1);
      const above = blackbodyRGB(anchor + 1);
      for (const [i, v] of below.entries()) {
        expect(Math.abs(v - above[i]), `discontinuity at ${anchor}K`).toBeLessThan(0.01);
      }
    }
  });

  it("INTERPOLATION IS IN LINEAR LIGHT · the midpoint is not the sRGB average", () => {
    // The discriminating control. Mixing two sRGB triples numerically mixes the ENCODING, and the
    // midpoints come out muddy in exactly the range this table spends most of its time in. If this
    // ever stops failing, the conversion has been dropped somewhere.
    const hot = blackbodyRGB(10000);
    const cool = blackbodyRGB(5000);
    const mid = blackbodyRGB(7500);
    const naive = hot.map((v, i) => (v + cool[i]) / 2);
    const distance = mid.reduce((sum, v, i) => sum + Math.abs(v - naive[i]), 0);
    expect(distance, "the ramp behaves like a plain numeric average — linearisation is gone")
      .toBeGreaterThan(0.02);
  });
});

describe("DUST REDDENS · it does not merely dim", () => {
  it("no dust leaves the colour exactly alone", () => {
    const rgb = blackbodyRGB(9000);
    expect(redden(rgb, 0)).toEqual([...rgb]);
  });

  it("blue is attenuated hardest, then green, then red — which is what reddening MEANS", () => {
    // The ordering is the whole effect. Attenuating all three equally is a brightness change, and
    // a galaxy whose dust only dims looks synthetic immediately.
    const rgb = blackbodyRGB(12000);
    const dusty = redden(rgb, 1);
    const kept = rgb.map((v, i) => dusty[i] / v);
    expect(kept[2], "blue survived dust better than red").toBeLessThan(kept[1]);
    expect(kept[1], "green survived dust better than red").toBeLessThan(kept[0]);
  });

  it("a dusty star is dimmer overall as well as redder", () => {
    const rgb = blackbodyRGB(6000);
    const sum = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);
    expect(sum(redden(rgb, 1))).toBeLessThan(sum(rgb));
    expect(sum(redden(rgb, 1))).toBeLessThan(sum(redden(rgb, 0.4)));
  });

  it("reddening is monotonic in the column, and never produces a negative channel", () => {
    const rgb = blackbodyRGB(20000);
    let previous = Number.POSITIVE_INFINITY;
    for (let column = 0; column <= 1; column += 0.05) {
      const out = redden(rgb, column);
      expect(out[2]).toBeLessThanOrEqual(previous + 1e-12);
      previous = out[2];
      for (const channel of out) expect(channel).toBeGreaterThanOrEqual(0);
    }
  });

  it("the coefficients are the brief's, and extinction is the smaller effect", () => {
    // Reddening should dominate dimming. If extinction grew past it, dust would read as fog.
    expect(REDDENING).toBe(0.4);
    expect(EXTINCTION).toBeLessThan(REDDENING);
  });
});
