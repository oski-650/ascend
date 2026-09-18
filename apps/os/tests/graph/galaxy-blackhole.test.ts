// Layer A — THE GALACTIC CORE (Galaxy rebuild, Phase 4).
//
// `graph-view/field/blackhole.ts` is the whole black hole as numbers: six nested radii, a Keplerian
// shear law, Doppler beaming, and a lensing profile. It is pure, so all of it is provable here —
// which matters more for this object than for anything else in the scene, because the three things
// that separate a black hole from a glowing ring are all quantitative and all invisible to a test
// that only checks the picture is not blank.
//
// ─── THE FAMILY RESCALES FROM ONE NUMBER ───────────────────────────────────────────────────────
//
// Real black holes have exactly one free parameter. Stating the assembly the same way is what stops
// the photon ring drifting off the shadow when somebody changes a radius — so the assertions below
// are almost all about RELATIONSHIPS between radii, not about the radii themselves. A number may
// move; the nesting may not.

import { describe, expect, it } from "vitest";
import {
  AMBIENT_RADIUS, ARC_BOTTOM_INTENSITY, ARC_INNER, ARC_OUTER, ARC_TOP_INTENSITY, BEAMING,
  DISK_ANGULAR_SPEED, DISK_FALLOFF, DISK_INNER, DISK_INTENSITY, DISK_OUTER, DISK_TILT,
  HORIZON_RADIUS, LENS_FALLOFF, LENS_STRENGTH, PHOTON_RING_RADIUS, PHOTON_RING_THICKNESS, SHADOW_RADIUS,
  approachAngle, bandAngularSpeed, beamingAt, lensDeflection,
} from "@/graph-view/field/blackhole";
import {
  CORE_RADIUS, GALAXY_RADIUS, SCHWARZSCHILD_RADIUS,
} from "@/graph-view/field/scale";
import { DEFAULT_GALAXY_CAMERA, DEFAULT_GALAXY_DISTANCE } from "@/graph-view/field/framing";

describe("THE NESTING · six radii, in the only order that is physically possible", () => {
  it("horizon < shadow < ambient, and the photon ring sits exactly on the shadow", () => {
    expect(HORIZON_RADIUS).toBeLessThan(SHADOW_RADIUS);
    expect(SHADOW_RADIUS).toBeLessThan(AMBIENT_RADIUS);
    // The hairline separates the shadow from everything else, so it IS the shadow's edge. A photon
    // ring at any other radius is a decorative circle near a black disc.
    expect(PHOTON_RING_RADIUS).toBe(SHADOW_RADIUS);
    expect(PHOTON_RING_THICKNESS).toBeLessThan(SHADOW_RADIUS * 0.02);
  });

  it("THE SHADOW IS √27/2 · not 2.6, and not a chosen value", () => {
    // The impact parameter below which a photon aimed PAST the hole is captured anyway. It is the
    // reason the dark disc is nearly three times wider than the horizon, and rounding it to 2.6 is
    // the kind of thing that looks identical and quietly stops being the physics.
    expect(SHADOW_RADIUS / SCHWARZSCHILD_RADIUS).toBeCloseTo(Math.sqrt(27) / 2, 12);
    expect(SHADOW_RADIUS / HORIZON_RADIUS).toBeGreaterThan(2.5);
  });

  it("matter never orbits inside the capture radius", () => {
    // The disk's inner edge is roughly the innermost stable orbit. Inside the shadow there is
    // nothing to draw, because nothing can stay there.
    expect(DISK_INNER).toBeGreaterThan(SHADOW_RADIUS);
    expect(DISK_INNER).toBeLessThan(DISK_OUTER);
  });

  it("the ambient band reaches the bulge, and the disk stays inside the galaxy", () => {
    // The two relationships that decide whether this object belongs to the picture or sits on top
    // of it. The darkening has to cover the bulge's bright heart — otherwise the middle of the
    // galaxy stays a solid gold blob with a speck in it, which is exactly what rs = 6 produced.
    expect(AMBIENT_RADIUS).toBeGreaterThan(CORE_RADIUS * 0.7);
    expect(AMBIENT_RADIUS).toBeLessThan(CORE_RADIUS * 1.2);
    // And the accretion structure must not out-scale the galaxy it lives in.
    expect(DISK_OUTER).toBeLessThan(GALAXY_RADIUS * 0.25);
  });

  it("the lensed arcs start outside the photon ring and stay inside the disk", () => {
    // They are the SAME disk seen bent over the hole, so they may not appear to come from inside
    // the shadow, and they may not extend past the material they are an image of.
    expect(ARC_INNER).toBeGreaterThan(PHOTON_RING_RADIUS);
    expect(ARC_OUTER).toBeLessThan(DISK_OUTER);
    expect(ARC_INNER).toBeLessThan(ARC_OUTER);
    // The upper arc is the near face seen over the top, so it is the brighter of the two.
    expect(ARC_TOP_INTENSITY).toBeGreaterThan(ARC_BOTTOM_INTENSITY);
    // Both are DIMMER than the disk they are an image of — a lensed arc brighter than its source
    // reads as two separate objects rather than as one seen twice.
    expect(ARC_TOP_INTENSITY).toBeLessThan(DISK_INTENSITY);
    expect(DISK_INTENSITY, "the disk cannot outshine forty-eight thousand bulge stars")
      .toBeGreaterThan(1);
  });

  it("THE WHOLE ASSEMBLY IS VISIBLE FROM THE DEFAULT CAMERA", () => {
    // The assertion that would have caught the original scale immediately, stated in the units that
    // matter: pixels. At §10's galaxy distance, with §1's field of view, the shadow must be large
    // enough to read as a black disc rather than as a dead pixel.
    //
    // The half-height of the view in world units, from the framing module, against a 900px-tall
    // viewport — the shortest of §14's four test displays.
    const halfHeightWorld = DEFAULT_GALAXY_DISTANCE * Math.tan((55 * Math.PI) / 360);
    const pixelsPerUnit = 450 / halfHeightWorld;
    expect(SHADOW_RADIUS * 2 * pixelsPerUnit,
      "the shadow is smaller than a UI icon at the default view").toBeGreaterThan(24);
    expect(DISK_OUTER * 2 * pixelsPerUnit,
      "the accretion disk fills the frame at the default view").toBeLessThan(450);
  });
});

describe("THE DISK SHEARS · which is what makes it plasma rather than a texture", () => {
  it("bands are Keplerian — speed falls as r^-1.5", () => {
    const inner = bandAngularSpeed(DISK_INNER);
    const doubled = bandAngularSpeed(DISK_INNER * 2);
    expect(doubled / inner).toBeCloseTo(Math.pow(2, -1.5), 6);
    expect(inner).toBeCloseTo(DISK_ANGULAR_SPEED, 12);
  });

  it("speed falls monotonically across the whole disk, and never reverses", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let r = DISK_INNER; r <= DISK_OUTER; r += (DISK_OUTER - DISK_INNER) / 60) {
      const speed = bandAngularSpeed(r);
      expect(speed).toBeLessThanOrEqual(previous + 1e-12);
      previous = speed;
    }
  });

  it("the inner edge laps the rim several times over — the shear is LARGE", () => {
    // A small differential produces a ring that rotates rigidly and reads as a texture. The
    // property is that neighbouring bands visibly pull apart, so the ratio is asserted as a floor
    // rather than the exponent alone.
    const ratio = bandAngularSpeed(DISK_INNER) / bandAngularSpeed(DISK_OUTER);
    expect(ratio, `inner laps outer only ${ratio.toFixed(1)}×`).toBeGreaterThan(5);
  });

  it("inside the inner edge the law clamps instead of diverging", () => {
    // r^-1.5 goes to infinity at the centre. Nothing is drawn there, but a NaN or an Infinity in a
    // uniform poisons the whole material, and the symptom is the disk vanishing with no error.
    expect(bandAngularSpeed(0)).toBe(bandAngularSpeed(DISK_INNER));
    expect(Number.isFinite(bandAngularSpeed(-5))).toBe(true);
  });

  it("the radial brightness falloff is steep enough to make an inner edge", () => {
    expect(DISK_FALLOFF).toBeGreaterThan(1.5);
    // Measured at 0.071 — the rim is a fourteenth of the inner edge's brightness. The threshold is
    // set where the measurement is rather than at a round number: pulling the outer edge in from
    // 16 rs to 10 rs raised this from 0.026, and a stale bound would have hidden that.
    const contrast = Math.pow(DISK_INNER / DISK_OUTER, DISK_FALLOFF);
    expect(contrast, `rim is ${(contrast * 100).toFixed(1)}% of the inner edge`).toBeLessThan(0.1);
  });
});

describe("DOPPLER BEAMING · §7 calls skipping this the most common tell", () => {
  it("the approach angle names the azimuth moving MOST DIRECTLY at the camera", () => {
    // Derived rather than asserted from a remembered formula: matter at azimuth θ sits at
    // (cos θ, sin θ) and moves along (−sin θ, cos θ), so its approach speed towards a camera at
    // (cx, cy) is that dot product. The returned angle must maximise it.
    for (const [cx, cy] of [[1, 0], [0, 1], [-1, 0], [0.6, -0.8], [-0.3, -0.95]]) {
      const best = approachAngle(cx, cy);
      const speedAt = (theta: number) => -Math.sin(theta) * cx + Math.cos(theta) * cy;
      const peak = speedAt(best);
      for (let t = 0; t < Math.PI * 2; t += Math.PI / 60) {
        expect(speedAt(t), `camera (${cx}, ${cy}) — azimuth ${t.toFixed(2)} beats the peak`)
          .toBeLessThanOrEqual(peak + 1e-9);
      }
      expect(peak).toBeCloseTo(Math.hypot(cx, cy), 9);
    }
  });

  it("THE SIGN IS RIGHT · the bright side is the approaching side, not the receding one", () => {
    // The mistake this catches is invisible: put the beaming on the wrong side and the picture
    // looks equally plausible and is exactly wrong. Asserted by checking that the azimuth the
    // beaming peaks at is the one whose matter is moving towards the camera.
    const camera: [number, number] = [0.8, 0.6];
    const approach = approachAngle(...camera);
    const receding = approach + Math.PI;
    const towards = -Math.sin(approach) * camera[0] + Math.cos(approach) * camera[1];
    const away = -Math.sin(receding) * camera[0] + Math.cos(receding) * camera[1];
    expect(towards).toBeGreaterThan(0);
    expect(away).toBeLessThan(0);
    expect(beamingAt(approach, approach)).toBeGreaterThan(beamingAt(receding, approach));
  });

  it("the two edges differ by the full declared range, and nothing leaves it", () => {
    const approach = 1.3;
    expect(beamingAt(approach, approach)).toBeCloseTo(BEAMING.toward, 9);
    expect(beamingAt(approach + Math.PI, approach)).toBeCloseTo(BEAMING.away, 9);
    expect(BEAMING.toward / BEAMING.away, "the beaming is too subtle to see").toBeGreaterThan(4);
    for (let t = 0; t < Math.PI * 2; t += 0.05) {
      const b = beamingAt(t, approach);
      expect(b).toBeGreaterThanOrEqual(BEAMING.away - 1e-12);
      expect(b).toBeLessThanOrEqual(BEAMING.toward + 1e-12);
    }
  });

  it("it depends on the CAMERA, so it changes as the view moves", () => {
    // A beamed side baked into the geometry would be a painted highlight. Two different viewpoints
    // must produce two different bright edges.
    expect(approachAngle(1, 0)).not.toBeCloseTo(approachAngle(0, 1), 3);
  });
});

describe("THE DISK IS SEEN OBLIQUELY FROM THE DEFAULT CAMERA", () => {
  it("the default view is near edge-on, so the arcs have something to arc over", () => {
    // §7 asks for an oblique view and gives 17°, which at §10's camera angle is nearly FACE-on:
    // the disk presents its face, the lensed arcs have nothing to sweep over, and the silhouette
    // collapses into a flat ring. This asserts the geometry that was actually wanted.
    const [cx, cy, cz] = DEFAULT_GALAXY_CAMERA;
    const length = Math.hypot(cx, cy, cz);
    const dir = [cx / length, cy / length, cz / length] as const;
    // Disk normal is +Y rotated by DISK_TILT about Z.
    const normal = [-Math.sin(DISK_TILT), Math.cos(DISK_TILT), 0] as const;
    const alignment = Math.abs(
      normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2]);
    // 0 is exactly edge-on, 1 is exactly face-on. The window is narrow at BOTH ends and both ends
    // have been hit: 17° (§7's figure) lands near 0.8 and shows the disk's face with nothing for
    // the arcs to arc over; 0.92 rad lands near 0.13 and projects the disk to a line a few pixels
    // thick. 0.456 is about 27° above the disk plane — the angle the reference images are shot at.
    expect(alignment, "the disk is face-on and the arcs have nothing to sweep over")
      .toBeLessThan(0.62);
    expect(alignment, "the disk is edge-on and renders as a line").toBeGreaterThan(0.3);
  });
});

describe("LENSING · a deflection, not a fisheye", () => {
  const SHADOW_PX = 0.06; // shadow radius in screen units, a plausible mid value

  it("THE PROFILE · zero at the shadow's edge, a peak just outside it, then falling to nothing", () => {
    // The first version of this asserted a single monotonic falloff, and it was right about the
    // OLD profile and wrong about the physics. Clamping the deflection so nothing is pulled inside
    // the shadow necessarily makes it rise from zero at the edge — which is the correct shape and
    // is why the photon ring stays whole.
    //
    // So the property is the shape: one rise, one peak, one fall, and zero at both ends.
    const samples: { r: number; d: number }[] = [];
    for (let r = SHADOW_PX; r <= SHADOW_PX * LENS_FALLOFF; r += SHADOW_PX / 40) {
      samples.push({ r, d: lensDeflection(r, SHADOW_PX) });
    }
    const peak = samples.reduce((best, s) => (s.d > best.d ? s : best), samples[0]);
    expect(peak.r, "the peak is not just outside the shadow")
      .toBeLessThan(SHADOW_PX * 2.5);
    expect(peak.d, "there is no deflection to speak of anywhere").toBeGreaterThan(1e-4);

    for (const [i, s] of samples.entries()) {
      if (i === 0) continue;
      const previous = samples[i - 1];
      if (s.r <= peak.r) {
        expect(s.d, `dips before the peak at r=${s.r.toFixed(4)}`)
          .toBeGreaterThanOrEqual(previous.d - 1e-12);
      } else {
        expect(s.d, `rises after the peak at r=${s.r.toFixed(4)}`)
          .toBeLessThanOrEqual(previous.d + 1e-12);
      }
    }
  });

  it("it is gone by the falloff radius, so the corners of the frame do not smear", () => {
    expect(lensDeflection(SHADOW_PX * LENS_FALLOFF, SHADOW_PX)).toBeCloseTo(0, 9);
    expect(lensDeflection(SHADOW_PX * 20, SHADOW_PX)).toBeCloseTo(0, 9);
  });

  it("NOTHING IS DEFLECTED INTO THE SHADOW · the clamp that saved the photon ring", () => {
    // The deflection peaks exactly where the photon ring sits. Without this clamp the pass pulled
    // the ring about a fifth of the shadow's radius inward, the black disc clipped it, and the one
    // hairline that defines the object rendered as a broken sliver.
    //
    // Stated as: an image at radius r is never moved to a radius below the shadow.
    for (let r = SHADOW_PX; r < SHADOW_PX * LENS_FALLOFF; r += SHADOW_PX / 20) {
      const landed = r - lensDeflection(r, SHADOW_PX);
      expect(landed, `an image at ${r.toFixed(4)} was pulled inside the shadow`)
        .toBeGreaterThanOrEqual(SHADOW_PX - 1e-9);
    }
    // And exactly at the edge it does not move at all, which is what keeps the ring whole.
    expect(lensDeflection(SHADOW_PX, SHADOW_PX)).toBeCloseTo(0, 12);
  });

  it("THE CONTROL · without the clamp, the ring WOULD be dragged inside", () => {
    // Otherwise the assertion above could pass on a deflection that was simply too weak to matter,
    // and the clamp could be deleted with nothing going red. Recomputes the unclamped profile.
    const r = SHADOW_PX * 1.02;
    const unclamped = (LENS_STRENGTH * SHADOW_PX * SHADOW_PX) / (r * r);
    expect(r - unclamped, "the raw deflection never reached the shadow — this proves nothing")
      .toBeLessThan(SHADOW_PX);
  });

  it("it NEVER displaces further than the distance it is displacing", () => {
    // The 1/r² law diverges at the centre. Unclamped it would sample the scene buffer from the far
    // side of the frame and the hole would be surrounded by a smeared copy of the galaxy.
    for (let r = 1e-4; r < 1; r *= 1.3) {
      expect(lensDeflection(r, SHADOW_PX), `runaway deflection at r=${r}`).toBeLessThanOrEqual(r);
    }
    expect(lensDeflection(0, SHADOW_PX)).toBe(0);
  });

  it("the strength is subtle — it is a bend, not a lens sitting in front of the galaxy", () => {
    expect(LENS_STRENGTH).toBeLessThan(0.1);
    const peak = lensDeflection(SHADOW_PX * 1.3, SHADOW_PX);
    expect(peak, "the deflection is imperceptible").toBeGreaterThan(1e-4);
    expect(peak, "the deflection is a fisheye").toBeLessThan(SHADOW_PX);
  });
});


it("lensing preserves separate samples near the rim instead of smearing the ring into a band", () => {
  for (const radius of [0.008, 0.04, 0.12]) {
    let previous = radius;
    const step = radius / 100;
    for (let i = 1; i <= 300; i++) {
      const r = radius + step * i;
      const sample = r - lensDeflection(r, radius);
      expect(sample - previous).toBeGreaterThan(step * 0.8);
      previous = sample;
    }
  }
});
