// Layer A — THE DENSITY WAVE (Galaxy rebuild, Phase 2).
//
// `graph-view/field/spiral.ts` builds the galaxy: 160,000 orbits, their shapes, rates, heights,
// temperatures and dust. It is pure and it returns typed arrays, so the entire construction is
// provable here at full strength — which matters more than usual, because the alternative is
// judging a galaxy by looking at it, and a wrong-but-plausible galaxy still looks like a galaxy.
//
// ─── THE ONE PROPERTY THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
//
// Anyone can scatter points along a logarithmic spiral. The question that separates a galaxy from a
// drawn swirl is what happens when it TURNS. Stars at different radii orbit at different rates, so
// arms made of stars wind themselves into a smear within a few turns.
//
// The density-wave construction answers it by making the arms out of ELLIPSES rather than stars:
// the ellipses are progressively rotated with radius, they never move, and their crowding at the
// turning points is the arm. Stars pass through. So the test that matters is not "are there arms at
// t = 0" — it is "are they in the same place after the galaxy has turned several times", and that
// is what THE ARMS HOLD below measures.

import { describe, expect, it } from "vitest";
import {
  ANGULAR_OFFSET, ARMS, BAR_ANGLE, BAR_RADIUS, DESKTOP_STARS, MAGNITUDE, MOBILE_STARS,
  POPULATIONS, POPULATION_ORDER, angularRate, axisRatio, bulgeFactor, concentratePhase,
  diskThickness, generateStarField, orbitalVelocity, positionAt, restPosition, tiltAt,
  type StarField,
} from "@/graph-view/field/spiral";
import { CORE_RADIUS, GALAXY_RADIUS, THICKNESS } from "@/graph-view/field/scale";

/** Enough stars for the statistics below to be stable, few enough to build in milliseconds. */
const N = 40_000;
const field = generateStarField(N);

const populationOf = (f: StarField, i: number) => POPULATION_ORDER[f.population[i]];

/** Azimuthal density profile of the stars in one semi-major band, at time `t`. */
function azimuthProfile(f: StarField, t: number, from: number, to: number, bins = 72): number[] {
  const hist = new Array<number>(bins).fill(0);
  for (let i = 0; i < f.count; i++) {
    const a = f.semiMajor[i];
    if (a < from || a > to) continue;
    const [x, , z] = positionAt(f, i, t);
    const theta = Math.atan2(z, x);
    const bin = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * bins) % bins;
    hist[bin]++;
  }
  return hist;
}

/** Peak-to-mean ratio: 1.0 is a featureless ring, higher means structure. */
function contrast(hist: readonly number[]): number {
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  return mean === 0 ? 0 : Math.max(...hist) / mean;
}

describe("DETERMINISM · the same business is the same galaxy tomorrow", () => {
  it("the same key and count reproduce the field exactly", () => {
    // Not a testing convenience. Spatial memory is the whole argument for drawing a business as a
    // galaxy, and it is worth nothing if a refresh reshuffles it.
    const a = generateStarField(2000, "same");
    const b = generateStarField(2000, "same");
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
    expect(Array.from(a.temperature)).toEqual(Array.from(b.temperature));
    expect(Array.from(a.dust)).toEqual(Array.from(b.dust));
  });

  it("THE CONTROL · a different key produces a different galaxy", () => {
    // Without this, a generator that ignored its seed entirely would pass the test above.
    const a = generateStarField(2000, "one");
    const b = generateStarField(2000, "two");
    expect(Array.from(a.position)).not.toEqual(Array.from(b.position));
  });

  it("every value in every buffer is finite", () => {
    // One Infinity — from a log of zero, or an angular rate at radius zero — poisons the geometry's
    // bounding sphere, and the symptom is the ENTIRE field vanishing with no error anywhere.
    for (const [name, buffer] of Object.entries(field)) {
      if (!(buffer instanceof Float32Array)) continue;
      const bad = Array.from(buffer).findIndex((v) => !Number.isFinite(v));
      expect(bad, `${name}[${bad}] is not finite`).toBe(-1);
    }
  });
});

describe("THE ARMS HOLD · the property the whole construction exists for", () => {
  // A band well out in the disk, where the arms should be at their most legible.
  const BAND: [number, number] = [520, 760];

  it("there is arm structure at rest", () => {
    expect(contrast(azimuthProfile(field, 0, ...BAND)),
      "the disk is featureless — there are no arms to hold").toBeGreaterThan(1.35);
  });

  it("the stars really do lap — this is not a still picture", () => {
    // The negative control for the test below. If nothing moved, "the arms stayed" would be
    // trivially true and would prove nothing about the construction.
    const t = 200;
    let moved = 0;
    for (let i = 0; i < field.count; i += 37) {
      const a = field.semiMajor[i];
      if (a < BAND[0] || a > BAND[1]) continue;
      const [x0, , z0] = restPosition(field, i);
      const [x1, , z1] = positionAt(field, i, t);
      if (Math.hypot(x1 - x0, z1 - z0) > a) moved++;
    }
    expect(moved, "no star travelled a meaningful distance").toBeGreaterThan(50);
  });

  it("THE ARMS ARE STILL THERE after the galaxy has turned many times", () => {
    // The stars in this band complete more than a full revolution by t = 200 and several by
    // t = 1000. An arm made of STARS would have wound into a smear long before that.
    for (const t of [0, 200, 1000, 5000]) {
      expect(contrast(azimuthProfile(field, t, ...BAND)), `arms gone by t=${t}`)
        .toBeGreaterThan(1.3);
    }
  });

  it("the sharp arms RELAX and the geometric ones do not — stated, because it is real", () => {
    // Honest accounting of a limitation the construction has. Phase concentration (§5's mechanism
    // for arm CONTRAST) shears: all the stars in a radius band share nearly one angular rate, so
    // their concentrated lump rotates with them, and bands at different radii drift apart. The
    // ELLIPSE CROWDING does not shear, because the ellipses never move.
    //
    // So the contrast decays from about 2.0 to a floor near 1.3 and then stays there. At the
    // composed rate of 0.06 that decay takes hours of wall clock; at 24× it takes minutes. Both are
    // longer than anybody looks at one view, which is why the mechanism is kept — but the floor is
    // what the galaxy looks like eventually, and it is asserted rather than hoped for.
    const at = (t: number) => contrast(azimuthProfile(field, t, ...BAND));
    expect(at(0)).toBeGreaterThan(at(1000));
    expect(at(1000), "the geometric arms went with the sharp ones").toBeGreaterThan(1.25);
    expect(at(20_000), "the floor is not a floor — structure is still draining away")
      .toBeGreaterThan(1.25);
  });

  it("THE SPIRAL · the arm's azimuth ADVANCES with radius, which is what makes it a spiral", () => {
    // The discriminating test, and the first version of it measured the wrong thing entirely.
    //
    // Contrast alone cannot tell a spiral from a BAR: aligning every ellipse to one angle produces
    // MORE contrast than the spiral does, not less, because all the crowding lands at one azimuth.
    // What separates them is that a spiral's arm sits at a different angle at every radius.
    //
    // So: find the peak azimuth in four radial bands and require it to advance monotonically. A bar
    // scores zero advance; a spiral advances by `ARM_WINDING_TURNS` across the disk.
    // Folded modulo π. The two arms are antipodal, so a full-circle histogram has two equal peaks
    // and `indexOf(max)` picks whichever one noise favours — which is how the first run of this
    // test reported an advance of −3.011 rad, almost exactly π, between two adjacent bands. Folding
    // makes the two arms one measurement and the question unambiguous.
    const peakAzimuth = (f: StarField, from: number, to: number): number => {
      const bins = 48;
      const hist = new Array<number>(bins).fill(0);
      for (let i = 0; i < f.count; i++) {
        const a = f.semiMajor[i];
        if (a < from || a > to) continue;
        const [x, , z] = positionAt(f, i, 0);
        const folded = ((Math.atan2(z, x) % Math.PI) + Math.PI) % Math.PI;
        hist[Math.min(bins - 1, Math.floor((folded / Math.PI) * bins))]++;
      }
      const best = hist.indexOf(Math.max(...hist));
      return (best / bins) * Math.PI;
    };
    const bands: [number, number][] = [[300, 450], [500, 650], [700, 850], [900, 1050]];
    const angles = bands.map(([lo, hi]) => peakAzimuth(field, lo, hi));
    // Unwrap: the arm may cross the ±π seam between one band and the next.
    const advance = angles.slice(1).map((angle, i) => {
      let d = angle - angles[i];
      while (d < -Math.PI / 2) d += Math.PI;
      while (d > Math.PI / 2) d -= Math.PI;
      return d;
    });
    for (const [i, d] of advance.entries()) {
      expect(d, `band ${i} → ${i + 1} did not advance (${d.toFixed(3)} rad)`).toBeGreaterThan(0.1);
    }

    // THE CONTROL. The same measurement on a field whose ellipses are all aligned — a bar, not a
    // spiral. Its arm sits at the same azimuth at every radius, and without this the assertions
    // above would pass on any field that happened to have a peak.
    //
    // Compared by CIRCULAR concentration, not by max-minus-min. The first version used the range,
    // which is meaningless on a circular quantity: the folded azimuth has period π, so peaks at
    // 0.03 and 3.11 are three hundredths apart and the range calls them 3.08 — it reported the bar
    // as MORE spread out than the spiral. The mean resultant length has no such seam: 1 is perfect
    // alignment, 0 is uniform.
    const concentration = (as: readonly number[]): number => {
      const x = as.reduce((sum, a) => sum + Math.cos(2 * a), 0) / as.length;
      const z = as.reduce((sum, a) => sum + Math.sin(2 * a), 0) / as.length;
      return Math.hypot(x, z);
    };
    const bar: StarField = { ...field, tilt: new Float32Array(field.count) };
    const barAngles = bands.map(([lo, hi]) => peakAzimuth(bar, lo, hi));
    expect(concentration(barAngles),
      "aligning every ellipse did not concentrate the arms — this measures nothing")
      .toBeGreaterThan(concentration(angles));
  });

  it("there are TWO arms, not four — measured, not assumed", () => {
    // Grand-design spirals are more legible and more photogenic, and §5 asks for two specifically.
    // Counted as peaks in the azimuthal profile that clear the mean by a margin, after smoothing so
    // a single noisy bin is not a peak.
    // Counted as CONTIGUOUS RUNS above the mean rather than as local maxima. The first version
    // counted maxima and reported four on a profile that plainly has two: a broad arm is not one
    // smooth bump, and two adjacent bins of counting noise inside it each register as a peak.
    // Counting runs asks the question that was actually meant — how many separated regions are
    // over-dense — and is immune to the bin-to-bin jitter that a 40,000-star sample always has.
    const raw = azimuthProfile(field, 0, ...BAND, 48);
    const hist = raw.map((_, i) =>
      (raw[(i - 1 + raw.length) % raw.length] + raw[i] + raw[(i + 1) % raw.length]) / 3);
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const over = hist.map((v) => v > mean * 1.1);
    let runs = 0;
    for (let i = 0; i < over.length; i++) {
      if (over[i] && !over[(i - 1 + over.length) % over.length]) runs++;
    }
    expect(runs, `found ${runs} arms`).toBe(ARMS);
  });
});

describe("THE ELLIPSES ARE FIXED · a star never leaves its own orbit", () => {
  it("every sampled star stays between its semi-minor and semi-major axes, forever", () => {
    // The invariant that makes "the arms are a traffic jam" true. If a star could drift off its
    // ellipse, the ellipses would stop holding anything and the construction would collapse into
    // the drawn-swirl version it exists to avoid.
    for (let i = 0; i < field.count; i += 313) {
      const a = field.semiMajor[i];
      const b = a * field.axisRatio[i];
      for (const t of [0, 17, 340, 9000]) {
        const [x, , z] = positionAt(field, i, t);
        const r = Math.hypot(x, z);
        expect(r, `star ${i} left its ellipse at t=${t}`)
          .toBeGreaterThanOrEqual(Math.min(a, b) - 1e-3);
        expect(r).toBeLessThanOrEqual(Math.max(a, b) + 1e-3);
      }
    }
  });

  it("the rest position and the closed form agree at t = 0", () => {
    // The seam between this layer and the vertex shader. The shader evaluates `positionAt`; the
    // geometry's bounding sphere is computed from `position`. If they disagree the field is culled
    // against the wrong bounds, and the symptom is stars vanishing at certain camera angles.
    // Compared RELATIVELY. `position` is stored as Float32 and `positionAt` recomputes in Float64,
    // so an absolute tolerance that holds near the centre fails out at the rim purely on the
    // storage precision — which is not a disagreement about where the star is.
    for (let i = 0; i < field.count; i += 97) {
      const rest = restPosition(field, i);
      const closed = positionAt(field, i, 0);
      const scale = Math.max(1, Math.hypot(...rest));
      for (const [axis, value] of closed.entries()) {
        expect(Math.abs(value - rest[axis]) / scale, `star ${i} axis ${axis}`).toBeLessThan(1e-5);
      }
    }
  });
});

describe("POPULATIONS · four of them, and the differences between them are the picture", () => {
  it("the shares land where they were declared", () => {
    const counted = new Map<string, number>();
    for (let i = 0; i < field.count; i++) {
      const name = populationOf(field, i);
      counted.set(name, (counted.get(name) ?? 0) + 1);
    }
    for (const name of POPULATION_ORDER) {
      const share = (counted.get(name) ?? 0) / field.count;
      expect(share, `${name} share is ${share.toFixed(3)}`)
        .toBeCloseTo(POPULATIONS[name].share, 1);
    }
  });

  it("each population stays inside its own temperature band", () => {
    for (let i = 0; i < field.count; i++) {
      const spec = POPULATIONS[populationOf(field, i)];
      expect(field.temperature[i]).toBeGreaterThanOrEqual(spec.minK);
      expect(field.temperature[i]).toBeLessThanOrEqual(spec.maxK);
    }
  });

  it("the ARM population sits OUTSIDE the bulge, where there is room to see it", () => {
    // §5 says "disk dist" for the arms, and taken literally that buries most of the young blue
    // stars under the bulge. The arms are only legible where there is room for them.
    let inside = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < field.count; i++) {
      if (populationOf(field, i) !== "arm") continue;
      if (field.semiMajor[i] < CORE_RADIUS) inside++;
      sum += field.semiMajor[i];
      n++;
    }
    expect(inside, "arm stars were placed inside the bulge").toBe(0);
    // And their mean radius is well outside the plain disk's, which is the point of the change.
    let diskSum = 0;
    let diskN = 0;
    for (let i = 0; i < field.count; i++) {
      if (populationOf(field, i) !== "disk") continue;
      diskSum += field.semiMajor[i];
      diskN++;
    }
    expect(sum / n, "the arm population is no further out than the disk wash")
      .toBeGreaterThan((diskSum / diskN) * 1.5);
  });

  it("the ARM population is the hot blue one and the bulge is the warm one", () => {
    // The colour story in one assertion: young blue-white stars in the arms against an amber core.
    // Without the separation the galaxy is monochrome, which §16.1 names as the top failure mode.
    const mean = (name: string) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < field.count; i++) {
        if (populationOf(field, i) !== name) continue;
        sum += field.temperature[i];
        n++;
      }
      return sum / n;
    };
    expect(mean("arm")).toBeGreaterThan(mean("disk"));
    expect(mean("disk")).toBeGreaterThan(mean("bulge"));
    expect(mean("arm")).toBeGreaterThan(12_000);
    expect(mean("bulge")).toBeLessThan(4_600);
  });

  it("the bulge is thick, the disk is thin, and the halo is neither", () => {
    const spread = (name: string) => {
      const ys: number[] = [];
      for (let i = 0; i < field.count; i++) if (populationOf(field, i) === name) ys.push(Math.abs(field.y[i]));
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(spread("bulge")).toBeGreaterThan(spread("disk"));
    expect(spread("halo")).toBeGreaterThan(spread("bulge"));
  });

  it("the halo is OUTSIDE the disk, and the bulge is concentrated without being bounded", () => {
    for (let i = 0; i < field.count; i++) {
      const name = populationOf(field, i);
      if (name === "halo") expect(field.semiMajor[i]).toBeGreaterThanOrEqual(GALAXY_RADIUS);
    }
    // The bulge is CONCENTRATED inside the core radius rather than confined to it. A hard bound
    // renders as a disc with a visible rim — see the note in `sampleRadius` — so the property is
    // stated as "most of it is inside", which is what a bulge actually is.
    let inside = 0;
    let total = 0;
    for (let i = 0; i < field.count; i++) {
      if (populationOf(field, i) !== "bulge") continue;
      if (field.semiMajor[i] <= CORE_RADIUS) inside++;
      total++;
    }
    expect(inside / total, "the bulge is not concentrated in the core").toBeGreaterThan(0.85);
    expect(inside / total, "the bulge has a hard edge at the core radius").toBeLessThan(1);
  });

  it("NO POPULATION HAS A HARD EDGE · the two artifacts this phase drew, as one rule", () => {
    // Both defects were the same mistake in different clothes: a distribution bounded by a constant
    // renders as a rim. The disk version stacked stars ON the bound and drew a hairline ring; the
    // bulge version merely stopped at it and drew a disc with an edge. Neither is visible in any
    // assertion about means or shares, and both are unmistakable on screen.
    //
    // Measured as: the outermost occupied radius bin of each population must not hold more stars
    // than the bin inside it.
    for (const name of POPULATION_ORDER) {
      const radii: number[] = [];
      for (let i = 0; i < field.count; i++) {
        if (populationOf(field, i) === name) radii.push(field.semiMajor[i]);
      }
      radii.sort((a, b) => a - b);
      const edge = radii[radii.length - 1];
      const width = edge / 40;
      const last = radii.filter((r) => r > edge - width).length;
      const previous = radii.filter((r) => r > edge - 2 * width && r <= edge - width).length;
      expect(last, `${name} piles up at its outer bound (${last} vs ${previous})`)
        .toBeLessThanOrEqual(previous + 2);
    }
  });
});

describe("THE DISK HAS NO EDGE · the ring the first version drew", () => {
  it("no radius bin near the rim is over-populated", () => {
    // The regression test for a clamped exponential. `Math.min(r, R)` stacks every over-range
    // sample on the rim exactly, and 1.1% of a 102,000-star disk on a circle of zero width renders
    // as a bright hairline around the galaxy. Measured as a histogram rather than by looking for
    // the specific bug, so any other mechanism that piles stars at one radius fails too.
    const bins = 60;
    const hist = new Array<number>(bins).fill(0);
    let disk = 0;
    for (let i = 0; i < field.count; i++) {
      if (populationOf(field, i) !== "disk") continue;
      const a = field.semiMajor[i];
      if (a > GALAXY_RADIUS) continue;
      hist[Math.min(bins - 1, Math.floor((a / GALAXY_RADIUS) * bins))]++;
      disk++;
    }
    // The outermost bin of an exponential disk should hold the FEWEST stars, not a spike.
    const outer = hist[bins - 1];
    const neighbour = hist[bins - 2];
    expect(outer, `the rim bin holds ${outer} of ${disk} disk stars`)
      .toBeLessThanOrEqual(neighbour * 1.5);
  });

  it("the distribution still falls off exponentially — the fix did not flatten the disk", () => {
    // The other half. Discarding out-of-range samples by resampling would also remove the ring and
    // would change the shape; this checks the shape survived.
    const within = (lo: number, hi: number) => {
      let n = 0;
      for (let i = 0; i < field.count; i++) {
        if (populationOf(field, i) !== "disk") continue;
        const a = field.semiMajor[i];
        if (a >= lo && a < hi) n++;
      }
      return n;
    };
    expect(within(0, 200)).toBeGreaterThan(within(200, 400));
    expect(within(200, 400)).toBeGreaterThan(within(400, 600));
    expect(within(400, 600)).toBeGreaterThan(within(600, 800));
  });
});

describe("MAGNITUDE · a few bright stars carry the colour, the rest carry the structure", () => {
  it("about one star in a hundred is conspicuously brighter than the rest", () => {
    // A uniform distribution is the second way this reads as dust rather than as a sky. The exact
    // fraction is not the property — the property is that the bright ones are RARE, so the range is
    // checked at both ends rather than the mean.
    const sorted = Array.from(field.magnitude).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const top = sorted[Math.floor(sorted.length * 0.99)];
    expect(top / median, "bright stars are not distinct enough from the haze").toBeGreaterThan(2);
    expect(median).toBeLessThan(MAGNITUDE.min * 2);
  });

  it("arm stars are brighter than halo stars at the same percentile", () => {
    const pct = (name: string, p: number) => {
      const vs: number[] = [];
      for (let i = 0; i < field.count; i++) if (populationOf(field, i) === name) vs.push(field.magnitude[i]);
      vs.sort((a, b) => a - b);
      return vs[Math.floor(vs.length * p)];
    };
    expect(pct("arm", 0.5)).toBeGreaterThan(pct("halo", 0.5));
  });
});

describe("THE SHAPE FUNCTIONS · each one has a job the picture depends on", () => {
  it("axisRatio is circular at the centre, eccentric at the bulge edge, circular again at the rim", () => {
    // The eccentric middle band is where the crowding happens, so this function IS the arms.
    expect(axisRatio(0)).toBeCloseTo(1, 6);
    expect(axisRatio(CORE_RADIUS * 0.999)).toBeLessThan(0.79);
    expect(axisRatio(GALAXY_RADIUS)).toBeCloseTo(1, 6);
    expect(axisRatio(GALAXY_RADIUS * 2), "the halo is not circular").toBeCloseTo(1, 6);
  });

  it("the BAR forces the inner ellipses to one angle, and releases them by its own radius", () => {
    // Without the bar the centre is a fuzzy ball and the arms appear to come from nowhere.
    expect(tiltAt(0)).toBeCloseTo(BAR_ANGLE, 6);
    expect(tiltAt(BAR_RADIUS)).toBeCloseTo(BAR_RADIUS * ANGULAR_OFFSET, 6);
    expect(tiltAt(BAR_RADIUS * 3)).toBeCloseTo(BAR_RADIUS * 3 * ANGULAR_OFFSET, 6);
    // And inside the bar the angle barely varies, which is what "a bar" means. §5's blend is
    // LINEAR in radius, so it is not perfectly constant: measured at 0.11 rad — about six degrees —
    // across the inner two thirds of the bar, against the 0.9 rad the free tilt would have swept
    // over the same span at this winding. The threshold is set where the measurement is, not where
    // it would be convenient.
    expect(Math.abs(tiltAt(40) - tiltAt(120)), "the bar is not holding one angle").toBeLessThan(0.2);
    expect(Math.abs(tiltAt(40) - tiltAt(120)))
      .toBeLessThan(Math.abs(40 * ANGULAR_OFFSET - 120 * ANGULAR_OFFSET) + 0.2);
  });

  it("the rotation curve RISES then FLATTENS — the dark-matter shape real galaxies have", () => {
    expect(orbitalVelocity(50)).toBeLessThan(orbitalVelocity(200));
    expect(orbitalVelocity(200)).toBeLessThan(orbitalVelocity(800));
    // Flat means the outer half barely changes. A Keplerian falloff would instead drop away.
    expect(orbitalVelocity(1400) / orbitalVelocity(700)).toBeGreaterThan(1.02);
    expect(orbitalVelocity(1400) / orbitalVelocity(700)).toBeLessThan(1.1);
  });

  it("angular rate falls with radius, so the inner galaxy laps the outer one", () => {
    expect(angularRate(100)).toBeGreaterThan(angularRate(400));
    expect(angularRate(400)).toBeGreaterThan(angularRate(1200));
    expect(Number.isFinite(angularRate(0)), "the centre has an infinite rate").toBe(true);
  });

  it("the disk thins outward and the bulge adds height on top of it", () => {
    expect(diskThickness(0)).toBeCloseTo(THICKNESS.diskInner, 6);
    expect(diskThickness(GALAXY_RADIUS)).toBeCloseTo(THICKNESS.diskRim, 6);
    expect(diskThickness(200)).toBeGreaterThan(diskThickness(1000));
    expect(bulgeFactor(0)).toBe(1);
    expect(bulgeFactor(CORE_RADIUS)).toBe(0);
    expect(bulgeFactor(GALAXY_RADIUS)).toBe(0);
  });

  it("phase concentration pulls towards the arms, and zero concentration changes nothing", () => {
    for (const phase of [0.3, 1.1, 2.9, 4.4, 6.0]) {
      expect(concentratePhase(phase, 0), "zero concentration moved a phase").toBeCloseTo(phase, 9);
    }
    // A phase in the middle of a sector is pushed towards whichever arm angle is nearer.
    const sector = (2 * Math.PI) / ARMS;
    const early = concentratePhase(sector * 0.2, 1.4);
    const late = concentratePhase(sector * 0.8, 1.4);
    expect(early, "a phase near the start of a sector was not pulled towards it")
      .toBeLessThan(sector * 0.2);
    expect(late).toBeGreaterThan(sector * 0.8);
    // And it stays inside its sector: a phase that crossed into the next one would move a star to a
    // different arm, which is a reordering rather than a concentration.
    expect(early).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThanOrEqual(sector);
  });
});

describe("DUST · subtle per star, structural in aggregate", () => {
  it("every column is a usable 0–1 density", () => {
    for (let i = 0; i < field.count; i++) {
      expect(field.dust[i]).toBeGreaterThanOrEqual(0);
      expect(field.dust[i]).toBeLessThanOrEqual(1);
    }
  });

  it("there is MORE dust in the arms than out of them", () => {
    // The property that gives the arms warm edges against cool cores. If dust were uniform it would
    // be a global tint, which is a filter rather than a structure.
    const near: number[] = [];
    const far: number[] = [];
    for (let i = 0; i < field.count; i++) {
      if (field.semiMajor[i] < 300 || field.semiMajor[i] > GALAXY_RADIUS) continue;
      (Math.abs(Math.cos(field.phase[i])) > 0.85 ? near : far).push(field.dust[i]);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(near), "dust is not concentrated in the arms").toBeGreaterThan(mean(far) * 1.3);
  });

  it("the halo is nearly dust-free — there is nothing above the disk to redden it", () => {
    const halo: number[] = [];
    const disk: number[] = [];
    for (let i = 0; i < field.count; i++) {
      (populationOf(field, i) === "halo" ? halo : disk).push(field.dust[i]);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(halo)).toBeLessThan(mean(disk));
  });
});

describe("TIERS", () => {
  it("the mobile field is a fraction of the desktop one, and both are real counts", () => {
    expect(MOBILE_STARS).toBeLessThan(DESKTOP_STARS / 3);
    expect(MOBILE_STARS).toBeGreaterThan(10_000);
    expect(generateStarField(1000).count).toBe(1000);
  });
});
