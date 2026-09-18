"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ShaderMaterial } from "three";
import { SUN_VERTEX, SUN_FRAGMENT } from "../shaders/sun";

export function SunSurface({ timeScale }: { timeScale: number }) {
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, delta) => {
    if (material.current) material.current.uniforms.uTime.value += Math.min(delta, 0.1) * timeScale;
  });
  return <shaderMaterial ref={material} uniforms={uniforms} vertexShader={SUN_VERTEX} fragmentShader={SUN_FRAGMENT} />;
}
