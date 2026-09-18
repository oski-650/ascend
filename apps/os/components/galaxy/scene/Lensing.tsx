"use client";

// components/galaxy/scene/Lensing — the lensing pass, fed the hole's screen position each frame.
//
// The shader is in `../shaders/lensing`. This file exists to answer the two questions it cannot:
// WHERE the hole is on screen, and HOW BIG its shadow is there. Both change every frame the camera
// moves, and both are projections — so the arithmetic behind them lives in `graph-view/field`, and
// what happens here is a projection call and two uniform writes.
//
// Runs on the full tier only. §7 puts it behind `quality: high` and §13 turns it off on four cores
// or fewer, because it samples the scene buffer per pixel and is the most expensive thing in the
// chain by some distance.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Effect, EffectAttribute } from "postprocessing";
import { wrapEffect } from "@react-three/postprocessing";
import * as THREE from "three";
import { LENS_FALLOFF, LENS_STRENGTH, SHADOW_RADIUS, screenRadius } from "@/graph-view/field/blackhole";
import { LENSING_FRAGMENT } from "../shaders/lensing";

class LensingEffect extends Effect {
  constructor() {
    super("Lensing", LENSING_FRAGMENT, {
      // CONVOLUTION is what makes `inputBuffer` readable at arbitrary coordinates. It also makes
      // the effect unmergeable with its neighbours, which is the cost of sampling the frame rather
      // than only transforming the pixel you were handed.
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uCentre", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ["uRadius", new THREE.Uniform(0)],
        ["uStrength", new THREE.Uniform(LENS_STRENGTH)],
        ["uFalloff", new THREE.Uniform(LENS_FALLOFF)],
        ["uAspect", new THREE.Uniform(1)],
      ]),
    });
  }
}

const LensingPass = wrapEffect(LensingEffect);

export function Lensing() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const effect = useRef<LensingEffect>(null);
  const scratch = useRef(new THREE.Vector3());

  useEffect(() => {
    const uniform = effect.current?.uniforms.get("uAspect");
    if (uniform !== undefined) uniform.value = size.width / size.height;
  }, [size]);

  useFrame(() => {
    const pass = effect.current;
    if (pass === null) return;

    // The hole sits at the world origin. Projecting it is the whole of "where is it on screen".
    const ndc = scratch.current.set(0, 0, 0).project(camera);
    const centre = pass.uniforms.get("uCentre");
    if (centre !== undefined) {
      (centre.value as THREE.Vector2).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    }

    const radius = pass.uniforms.get("uRadius");
    if (radius !== undefined) {
      // Behind the camera, or off screen: no shadow to bend light around, so the pass costs a
      // branch and nothing else.
      const behind = ndc.z > 1;
      const fov = "fov" in camera ? Number(camera.fov) : 55;
      radius.value = behind
        ? 0
        : screenRadius(SHADOW_RADIUS, camera.position.length(), fov) * 0.5;
    }
  });

  return <LensingPass ref={effect} />;
}
