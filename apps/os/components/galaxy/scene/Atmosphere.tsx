"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StarField } from "@/graph-view/field/spiral";
import { DEFAULT_GALAXY_DISTANCE } from "@/graph-view/field/framing";
import { STAR_VERTEX } from "../shaders/star";
import { ATMOSPHERE_FRAGMENT } from "../shaders/atmosphere";

/** Emission follows existing young-star orbits; it never invents a second arrangement. */
export function Atmosphere({ field, pixelRatio, timeScale, fade = 1 }: {
  field: StarField; pixelRatio: number; timeScale: number; fade?: number;
}) {
  const geometry = useMemo(() => {
    const selected: number[] = [];
    for (let i = 0; i < field.count; i += 67) {
      if (field.population[i] === 2) selected.push(i);
    }
    const g = new THREE.BufferGeometry();
    const attributes = {
      aSemiMajor: field.semiMajor, aAxisRatio: field.axisRatio, aTilt: field.tilt,
      aPhase: field.phase, aOmega: field.omega, aY: field.y,
    };
    for (const [name, values] of Object.entries(attributes)) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(selected.map((i) => values[i]), 1));
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      selected.flatMap((i) => Array.from(field.position.subarray(i * 3, i * 3 + 3))), 3,
    ));
    g.setAttribute("aMagnitude", new THREE.Float32BufferAttribute(
      selected.map((i) => 45 + field.dust[i] * 70), 1,
    ));
    const blue = new THREE.Color("#648bbd");
    const rose = new THREE.Color("#c76491");
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(
      selected.flatMap((_, i) => (i % 5 === 0 ? rose : blue).toArray()), 3,
    ));
    return g;
  }, [field]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX, fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 }, uPixelRatio: { value: 1 }, uSizeScale: { value: 1 },
      uMaxPointSize: { value: 180 }, uReferenceDistance: { value: DEFAULT_GALAXY_DISTANCE },
      uFade: { value: 0.035 },
    },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  }), []);
  const materialRef = useRef(material);
  const rate = useRef(timeScale);
  useEffect(() => { rate.current = timeScale; }, [timeScale]);
  useEffect(() => { materialRef.current.uniforms.uFade.value = 0.035 * fade; }, [fade]);
  useEffect(() => { materialRef.current.uniforms.uPixelRatio.value = pixelRatio; }, [material, pixelRatio]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);
  useFrame((_, delta) => { materialRef.current.uniforms.uTime.value += Math.min(delta, 0.1) * rate.current; });
  return <points geometry={geometry} material={material} raycast={() => null} frustumCulled={false} renderOrder={1} />;
}
