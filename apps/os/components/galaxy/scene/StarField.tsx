"use client";

// components/galaxy/scene/StarField — the galaxy, as one draw call.
//
// ─── WHAT THIS COMPONENT DECIDES: NOTHING ──────────────────────────────────────────────────────
//
// Every orbit arrives from `graph-view/field/spiral` and every colour from
// `components/galaxy/lib/starColors`. This file uploads them and writes one float a frame. That is
// not minimalism for its own sake — anything decided inside a `<Canvas>` is untestable without a
// GPU, and the two modules above are provable in plain Node at full strength.
//
// ─── THE FRAME LOOP IS ONE LINE, AND THAT IS THE ACCEPTANCE CRITERION ──────────────────────────
//
// §15's Phase 2 asks for "zero CPU cost per frame (verify: `useFrame` body is one uniform write)".
// Moving 160,000 points from JavaScript would mean 480,000 float writes and a full buffer upload
// every frame, which is the entire budget spent before anything is drawn. The orbits go up ONCE and
// the clock advances; the positions are evaluated on the GPU.
//
// `uTime` ACCUMULATES rather than reading the clock, so changing the rate — including to zero —
// changes the speed from here on instead of teleporting the whole galaxy to where it would have
// been had that rate always applied.
//
// ─── IT IS NOT PICKABLE, AND THE RULE REQUIRES THAT ────────────────────────────────────────────
//
// `raycast = () => null`. §16.3 names raycasting the star field as the classic frame-rate killer,
// and the fitness rule that permits a decorative population at all requires it: a point of light
// nobody can select cannot be mistaken for a business object by clicking on it, which is half of
// what "distinguishable" has to mean here.
//
// `frustumCulled = false` because the positions are computed in the vertex shader, so three.js's
// bounding sphere — built from the t = 0 rest positions — stops describing the object the moment
// the clock advances. Culling against a stale volume makes the field blink out at certain angles.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_GALAXY_DISTANCE } from "@/graph-view/field/framing";
import type { StarField as Field } from "@/graph-view/field/spiral";
import { starColors } from "../lib/starColors";
import { STAR_FRAGMENT, STAR_VERTEX } from "../shaders/star";

/**
 * Global multiplier on every point size.
 *
 * One knob for "the field is too sparse / too milky", kept separate from per-star magnitude so that
 * tuning the look does not disturb the power-law distribution that makes bright stars rare.
 */
export const SIZE_SCALE = 1.25;

export function StarField({
  field,
  pixelRatio,
  timeScale,
  fade = 1,
}: {
  field: Field;
  pixelRatio: number;
  /** Orbital rate. Zero holds the galaxy still without stopping the frame loop. */
  timeScale: number;
  /** Dims the whole field when a system is focused. 1 is the galaxy level. */
  fade?: number;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // `position` is the rest arrangement at t = 0. The shader ignores it and computes its own, but
    // three.js needs it to know how many points there are, and it makes the bounding sphere mean
    // something for anything that asks.
    g.setAttribute("position", new THREE.BufferAttribute(field.position, 3));
    g.setAttribute("aSemiMajor", new THREE.BufferAttribute(field.semiMajor, 1));
    g.setAttribute("aAxisRatio", new THREE.BufferAttribute(field.axisRatio, 1));
    g.setAttribute("aTilt", new THREE.BufferAttribute(field.tilt, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(field.phase, 1));
    g.setAttribute("aOmega", new THREE.BufferAttribute(field.omega, 1));
    g.setAttribute("aY", new THREE.BufferAttribute(field.y, 1));
    g.setAttribute("aMagnitude", new THREE.BufferAttribute(field.magnitude, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(starColors(field.temperature, field.dust), 3));
    return g;
  }, [field]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: pixelRatio },
          uSizeScale: { value: SIZE_SCALE },
          uMaxPointSize: { value: 26 },
          // The distance the composition was framed at, so a magnitude reads in CSS pixels at the
          // default galaxy view. See the note in the vertex shader.
          uReferenceDistance: { value: DEFAULT_GALAXY_DISTANCE },
          uFade: { value: fade },
        },
        transparent: true,
        // Light ADDS. Two stars behind one another are brighter than either, which is both true and
        // the reason the core glows without a single light in the scene.
        blending: THREE.AdditiveBlending,
        // Depth is TESTED so stars go behind bodies, and not WRITTEN so they do not occlude each
        // other — 160,000 additive quads fighting over the depth buffer is sort thrash, and §16.7
        // names it.
        depthTest: true,
        depthWrite: false,
      }),
    // Built once. The two values below are pushed into uniforms by the effect rather than rebuilding
    // the material, which would recompile the shader on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.uniforms.uPixelRatio.value = pixelRatio;
    material.uniforms.uFade.value = fade;
  }, [material, pixelRatio, fade]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  // Synced through an effect rather than assigned during render: a ref written while rendering is
  // a value React may discard, and the lint rule that catches it is right to. The ref exists so the
  // frame callback below never has to be rebuilt when the rate changes.
  const rate = useRef(timeScale);
  useEffect(() => { rate.current = timeScale; }, [timeScale]);

  useFrame((_, delta) => {
    material.uniforms.uTime.value += Math.min(delta, 0.1) * rate.current;
  });

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      raycast={() => null}
      renderOrder={3}
    />
  );
}
