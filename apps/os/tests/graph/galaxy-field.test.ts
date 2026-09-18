// Layer A — THE WORLD'S DIMENSIONS AND HOW IT IS FRAMED (Galaxy rebuild, Phase 1).
//
// `graph-view/field/scale.ts` is a table of constants and `graph-view/field/framing.ts` is four
// functions. Neither needs a GPU, a DOM or a browser, which is the entire reason they are up here
// rather than inside the Canvas: the acceptance criteria for Phase 1 are geometric claims about
// four specific viewport widths, and a geometric claim is either proved against a function or
// remembered from a browser window somebody resized once.
//
// ─── WHY MONOTONICITY IS TESTED AND NOT TRUSTED ────────────────────────────────────────────────
//
// The scale table promises the viewer exactly one thing — bigger always means bigger — and it is
// the one thing a later tuning pass breaks silently. Raise a moon's ceiling by a tenth and a large
// document outgrows a small project; nothing errors, nothing looks obviously wrong, and the
// encoding has stopped being readable. So the ORDERING is asserted rather than the numbers: a
// number may move, and it may not move across a boundary.

import { describe, expect, it } from "vitest";
import {
  CAMERA_FAR, CAMERA_NEAR, CAMERA_RAILS, CORE_RADIUS, FOCUS_LEVELS,
  GALAXY_RADIUS, MOON_ORBITS, MOON_RADIUS, PLANET_ORBITS, PLANET_RADIUS,
  PROSPECT_BELT, PROSPECT_RADIUS, STAR_ORBIT_BAND, STAR_RADIUS, THICKNESS,
  BASE_ASPECT, BASE_FOV,
} from "@/graph-view/field/scale";
import {
  DEFAULT_GALAXY_CAMERA, DEFAULT_GALAXY_DISTANCE, DPR_RANGE, MOBILE_DPR_MAX,
  DEFAULT_GALAXY_POLAR, FRAME_MARGIN, MIN_GALAXY_FOV, galaxyVerticalHalfExtent,
  horizontalFillAt, horizontalFov, lockHorizontalFov, verticalFillAt, overviewCameraForAspect,
} from "@/graph-view/field/framing";

/** The four displays §14 names, as aspect ratios. */
const TEST_WIDTHS = [
  { name: "1440x900", aspect: 1440 / 900 },
  { name: "1920x1080", aspect: 1920 / 1080 },
  { name: "2560x1440", aspect: 2560 / 1440 },
  { name: "3440x1440", aspect: 3440 / 1440 },
] as const;

describe("THE SCALE IS STRICTLY MONOTONIC · bigger always means bigger", () => {
  it("a star is larger than any planet, a planet than any moon, a moon than any prospect", () => {
    // Stated as a CHAIN over the ceilings and floors rather than as four independent comparisons,
    // because the property is about the boundaries touching, not about the numbers individually.
    expect(STAR_RADIUS.min, "the smallest star is not larger than the largest planet")
      .toBeGreaterThan(PLANET_RADIUS.max);
    expect(PLANET_RADIUS.min, "the smallest planet is not larger than the largest moon")
      .toBeGreaterThan(MOON_RADIUS.max);
    // The brief states this one outright and it is the strongest of the four: prospects are
    // "deliberately smaller than any moon", so the comparison is against the moon FLOOR.
    expect(PROSPECT_RADIUS.max, "a prospect can be as large as a small moon")
      .toBeLessThan(MOON_RADIUS.min);
  });

  it("every span is non-degenerate — a min that equals its max encodes nothing", () => {
    // A collapsed span passes every ordering assertion above while silently removing a whole
    // encoding: every client would be the same size, and `metrics.value` would stop being visible.
    for (const [name, span] of Object.entries({
      STAR_RADIUS, PLANET_RADIUS, MOON_RADIUS, PROSPECT_RADIUS,
      STAR_ORBIT_BAND, PROSPECT_BELT, MOON_ORBITS,
    })) {
      expect(span.max, `${name} has collapsed to a single value`).toBeGreaterThan(span.min);
    }
  });
});

describe("THE FIELD NESTS · each band sits where the one outside it leaves room", () => {
  it("stars orbit outside the bulge and inside the disk", () => {
    expect(STAR_ORBIT_BAND.min).toBeGreaterThan(CORE_RADIUS);
    expect(STAR_ORBIT_BAND.max).toBeLessThan(GALAXY_RADIUS);
  });

  it("the prospect belt is OUTSIDE the disk — outsiders until they are not", () => {
    // Not decoration. §9 makes the belt visibly not part of the ordered disk, and a belt that
    // overlapped the star band would put planetesimals among the clients they are not yet.
    expect(PROSPECT_BELT.min).toBeGreaterThan(GALAXY_RADIUS);
    expect(PROSPECT_BELT.min).toBeGreaterThan(STAR_ORBIT_BAND.max);
  });

  // The black hole's own dimensions moved to graph-view/field/blackhole and are asserted in
  // tests/graph/galaxy-blackhole.test.ts — they are a family that rescales from one number, and
  // splitting them across two files is how the photon ring drifts off the shadow.

  it("planet orbits increase, and each clears the last by more than a planet's diameter", () => {
    // The failure this prevents took four rounds to find in the previous renderer: rings spaced by
    // a rule that ignored the bodies ON them, so two projects overlapped at the largest radius.
    for (const [i, r] of PLANET_ORBITS.entries()) {
      if (i === 0) continue;
      const gap = r - PLANET_ORBITS[i - 1];
      expect(gap, `orbit ${i} does not clear orbit ${i - 1}`).toBeGreaterThan(2 * PLANET_RADIUS.max);
    }
  });

  it("moons orbit clear of their planet and inside the innermost planet gap", () => {
    expect(MOON_ORBITS.min).toBeGreaterThan(PLANET_RADIUS.max);
    // A moon system wider than the gap between two planet orbits would put one project's documents
    // inside another project's ring.
    expect(MOON_ORBITS.max).toBeLessThan(PLANET_ORBITS[1] - PLANET_ORBITS[0]);
  });

  it("the disk thins with radius and the bulge is thicker than the disk it sits in", () => {
    expect(THICKNESS.diskRim).toBeLessThan(THICKNESS.diskInner);
    expect(THICKNESS.bulge).toBeGreaterThan(THICKNESS.diskInner);
    expect(THICKNESS.halo).toBeGreaterThan(THICKNESS.bulge);
  });
});

describe("THE CAMERA RAILS · there is no free-fly, and no level puts the camera inside a body", () => {
  it("every rail is ordered and every polar angle is a real angle from the pole", () => {
    for (const level of FOCUS_LEVELS) {
      const rail = CAMERA_RAILS[level];
      expect(rail.distance.max, `${level} distance band is inverted`).toBeGreaterThan(rail.distance.min);
      expect(rail.polar.min, `${level} polar starts behind the pole`).toBeGreaterThanOrEqual(0);
      expect(rail.polar.max, `${level} polar passes the equator`).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it("the levels nest — drilling in always moves the camera closer", () => {
    // The drill path is only a drill path if each level is strictly inside the last. Overlapping
    // bands would let "descend" leave the camera further away than it started.
    for (const [i, level] of FOCUS_LEVELS.entries()) {
      if (i === 0) continue;
      expect(CAMERA_RAILS[level].distance.max, `${level} can sit further out than ${FOCUS_LEVELS[i - 1]}`)
        .toBeLessThan(CAMERA_RAILS[FOCUS_LEVELS[i - 1]].distance.min);
    }
  });

  it("the nearest rail at each level clears the largest body it frames", () => {
    // Otherwise the closest approach puts the camera inside the thing it is focused on, and the
    // view fills with the inside of a sphere.
    expect(CAMERA_RAILS.system.distance.min).toBeGreaterThan(STAR_RADIUS.max);
    expect(CAMERA_RAILS.planet.distance.min).toBeGreaterThan(PLANET_RADIUS.max);
    expect(CAMERA_RAILS.moon.distance.min).toBeGreaterThan(MOON_RADIUS.max);
  });

  it("the depth range spans four decades, which is why the buffer must be logarithmic", () => {
    // The justification for `logarithmicDepthBuffer` in the Canvas, kept next to the numbers that
    // make it necessary. If this ratio ever drops below ~10^4 the setting becomes a cost rather
    // than a requirement, and the comment claiming otherwise should go with it.
    expect(CAMERA_FAR / CAMERA_NEAR).toBeGreaterThan(1e4);
    expect(CAMERA_NEAR).toBeLessThan(MOON_RADIUS.min);
    expect(CAMERA_FAR).toBeGreaterThan(PROSPECT_BELT.max * 2);
  });

  it("the default camera sits ON the galaxy rail, at the distance it claims", () => {
    const d = Math.hypot(...DEFAULT_GALAXY_CAMERA);
    expect(d).toBeCloseTo(DEFAULT_GALAXY_DISTANCE, 6);
    expect(d).toBeGreaterThanOrEqual(CAMERA_RAILS.galaxy.distance.min);
    expect(d).toBeLessThanOrEqual(CAMERA_RAILS.galaxy.distance.max);
    // Above the disk plane, not in it — a galaxy seen edge-on is a line.
    expect(DEFAULT_GALAXY_CAMERA[1]).toBeGreaterThan(0);
  });
});

describe("THE HORIZONTAL FIELD IS LOCKED · the galaxy does not crop on an ultrawide", () => {
  it("the composed vertical field survives unchanged at and below the reference aspect", () => {
    // The lock is a CEILING ON WIDTH, not a general rescaling. Applying it to narrow windows would
    // zoom the subject out as the window got taller, which is the opposite of what it is for.
    expect(lockHorizontalFov(BASE_ASPECT)).toBeCloseTo(BASE_FOV, 10);
    expect(lockHorizontalFov(4 / 3)).toBeCloseTo(BASE_FOV, 10);
    expect(lockHorizontalFov(0.75)).toBeCloseTo(BASE_FOV, 10);
  });

  it("THE PROPERTY · the horizontal field is identical on every display the lock can serve", () => {
    // Asserted as an INVARIANT rather than by restating the formula. A test that recomputes
    // `2·atan(tan(fov/2)·a₀/a)` passes whatever that formula becomes, including a wrong one.
    //
    // The sampled range stops where the FLOOR takes over, which is the amendment this phase made
    // and which the next block is about. Inside it the lock is exact.
    const reference = horizontalFov(BASE_FOV, BASE_ASPECT);
    for (const aspect of [1.8, 1.9, 2.0, 2.05]) {
      expect(lockHorizontalFov(aspect), `${aspect} is already past the floor; sample narrower`)
        .toBeGreaterThan(MIN_GALAXY_FOV);
      expect(horizontalFov(lockHorizontalFov(aspect), aspect), `aspect ${aspect} shows a different width`)
        .toBeCloseTo(reference, 8);
    }
  });

  it("THE NEGATIVE CONTROL · without the lock, the same displays diverge", () => {
    // If this did NOT diverge there would be nothing for the lock to do, and every assertion above
    // would be passing for a reason other than the mechanism it names.
    const reference = horizontalFov(BASE_FOV, BASE_ASPECT);
    const unlocked = horizontalFov(BASE_FOV, 3440 / 1440);
    expect(Math.abs(unlocked - reference),
      "an unlocked camera already shows the same width — this suite is not measuring the lock")
      .toBeGreaterThan(10);
  });

  it("the vertical field narrows monotonically as the display gets wider", () => {
    const fovs = TEST_WIDTHS.map((w) => lockHorizontalFov(w.aspect));
    for (const [i, fov] of fovs.entries()) {
      if (i === 0) continue;
      expect(fov, `${TEST_WIDTHS[i].name} widened the vertical field`)
        .toBeLessThanOrEqual(fovs[i - 1] + 1e-9);
    }
    expect(fovs[3], "the ultrawide did not narrow at all").toBeLessThan(BASE_FOV - 5);
  });

  it("a degenerate container returns the composed field instead of NaN", () => {
    // Panels animate, and ResizeObserver reports the frame in between. A NaN here produces a camera
    // that never recovers, with no error anywhere.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lockHorizontalFov(bad), `aspect ${bad} produced a non-finite field`).toBe(BASE_FOV);
    }
  });
});

describe("THE FLOOR · the amendment the brief's own numbers forced", () => {
  // Take §14 exactly as written and a 3440×1440 display crops the galaxy top and bottom. This block
  // is the proof of that claim AND of the fix, because a design note asserting a geometry stops
  // being true the first time somebody changes a constant, and says nothing when it does.

  it("THE DEFECT · an UNFLOORED lock crops the galaxy on an ultrawide", () => {
    // `floor: 0` reproduces the brief's literal §14. Kept as a live measurement rather than a
    // number in a comment: if a future change to the radius, the FOV or the rails makes the plain
    // lock safe again, this goes red and the floor can go with it.
    const ultrawide = 3440 / 1440;
    const unfloored = lockHorizontalFov(ultrawide, BASE_FOV, BASE_ASPECT, 0);
    const halfHeight = DEFAULT_GALAXY_DISTANCE * Math.tan((unfloored * Math.PI) / 360);
    expect(galaxyVerticalHalfExtent(),
      "the plain lock already frames the galaxy — the floor is dead code")
      .toBeGreaterThan(halfHeight);
  });

  it("THE FIX · the floored lock frames the whole galaxy on all four displays", () => {
    for (const { name, aspect } of TEST_WIDTHS) {
      expect(verticalFillAt(aspect), `${name} crops the galaxy top and bottom`)
        .toBeLessThanOrEqual(1);
      expect(horizontalFillAt(aspect), `${name} crops the galaxy at the sides`).toBeLessThan(1);
    }
    // At the widest display the fit is exactly the margin, which is what "floored" means: it stops
    // narrowing at the last field that still contains the subject.
    expect(verticalFillAt(3440 / 1440)).toBeCloseTo(FRAME_MARGIN, 6);
  });

  it("THE COST · the ultrawide shows slightly MORE to the sides, rather than less from the top", () => {
    // The trade the amendment makes, named. Beyond the floor the horizontal field grows again, so
    // the lock's guarantee ends there — and a view that is a few per cent wider is a better outcome
    // than one with the galaxy's top and bottom cut off.
    const reference = horizontalFov(BASE_FOV, BASE_ASPECT);
    const wide = horizontalFov(lockHorizontalFov(3440 / 1440), 3440 / 1440);
    expect(wide).toBeGreaterThan(reference);
    expect(wide / reference, "the floor widened the view far more than it should have")
      .toBeLessThan(1.15);
  });

  it("the floor is a floor, not a replacement — it never widens past the composed field", () => {
    // A floor above `BASE_FOV` would make every wide display show MORE vertically than the
    // reference one, which is the crop's mirror image and just as wrong.
    expect(lockHorizontalFov(10)).toBeLessThanOrEqual(BASE_FOV);
    expect(MIN_GALAXY_FOV).toBeLessThan(BASE_FOV);
  });
});

describe("HOW MUCH OF THE SCREEN THE GALAXY FILLS", () => {
  it("the three 16:9-or-narrower displays agree with each other exactly", () => {
    const [a, b, c] = TEST_WIDTHS.slice(0, 3).map((w) => verticalFillAt(w.aspect));
    expect(b).toBeCloseTo(c, 10);
    // 1440×900 is 1.6 — narrower than the reference, so the lock does not engage and the vertical
    // field is the composed one. Same field, same distance, same fill.
    expect(a).toBeCloseTo(b, 10);
  });

  it("the fill lands near the ~72% §14 asks for, without moving a number §4 or §10 states", () => {
    // About 0.78 rather than 0.72. Hitting 0.72 exactly needs ~3734 units of distance, and §10 caps
    // the galaxy rail at 3400 — so the explicit constant wins over the approximate target, and the
    // discrepancy is recorded here instead of being tuned away silently.
    expect(verticalFillAt(BASE_ASPECT)).toBeGreaterThan(0.7);
    expect(verticalFillAt(BASE_ASPECT)).toBeLessThan(0.85);
  });

  it("face-on is the TIGHTEST framing, which is the counter-intuitive half", () => {
    // A disk seen from its pole presents its full radius vertically; tilted towards edge-on it
    // presents less. So the most attractive view is also the one most at risk of cropping, and a
    // framing check done at an arbitrary angle proves nothing about the default one.
    expect(galaxyVerticalHalfExtent(0))
      .toBeGreaterThan(galaxyVerticalHalfExtent(DEFAULT_GALAXY_POLAR));
  });
});

describe("DEVICE PIXEL RATIO IS CAPPED", () => {
  it("2 on the full tier, 1.5 on the reduced one, and never below 1", () => {
    expect(DPR_RANGE[0]).toBe(1);
    expect(DPR_RANGE[1]).toBe(2);
    expect(MOBILE_DPR_MAX).toBeLessThan(DPR_RANGE[1]);
    expect(MOBILE_DPR_MAX).toBeGreaterThanOrEqual(DPR_RANGE[0]);
  });
});


describe("Observatory portrait framing", () => {
  it("keeps the disk inside the narrow frame without changing its viewing direction", () => {
    for (const aspect of [320 / 740, 390 / 844, 768 / 1024, 1440 / 900]) {
      const camera = overviewCameraForAspect(aspect);
      const distance = Math.hypot(...camera);
      expect(horizontalFillAt(aspect, distance)).toBeLessThan(FRAME_MARGIN);
      expect(camera[0] / camera[1]).toBeCloseTo(DEFAULT_GALAXY_CAMERA[0] / DEFAULT_GALAXY_CAMERA[1]);
    }
  });
  it("does not poison the camera during a zero-sized or unavailable layout", () => {
    for (const aspect of [0, -1, NaN, Infinity]) {
      expect(overviewCameraForAspect(aspect)).toEqual(DEFAULT_GALAXY_CAMERA);
    }
  });
});
