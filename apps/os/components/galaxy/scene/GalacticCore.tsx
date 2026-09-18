"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHADOW_RADIUS } from "@/graph-view/field/blackhole";
import { DEFAULT_GALAXY_CAMERA } from "@/graph-view/field/framing";
import { HORIZON_VERTEX } from "../shaders/horizon";
import { BLACK_HOLE_FRAGMENT } from "../shaders/black-hole";

/** One optical image keeps the disk, shadow and bent light registered at every zoom. */
export function GalacticCore({ timeScale }: { timeScale: number }) {
  const frame = useRef<THREE.Group>(null);
  const surface = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>(null);
  const diskNormal = useMemo(() => {
    const view = new THREE.Vector3(...DEFAULT_GALAXY_CAMERA).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    up.addScaledVector(view, -up.dot(view)).normalize();
    const right = new THREE.Vector3().crossVectors(up, view);
    return up.multiplyScalar(0.93).addScaledVector(view, 0.35)
      .addScaledVector(right, -0.11).normalize();
  }, []);
  const inverseView = useRef(new THREE.Quaternion());
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HORIZON_VERTEX,
    fragmentShader: BLACK_HOLE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 }, uRadius: { value: SHADOW_RADIUS },
      uDiskNormal: { value: new THREE.Vector3() },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: false,
  }), []);

  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }, delta) => {
    frame.current?.quaternion.copy(camera.quaternion);
    if (surface.current) {
      surface.current.material.uniforms.uTime.value += Math.min(delta, 0.1) * timeScale;
      inverseView.current.copy(camera.quaternion).invert();
      surface.current.material.uniforms.uDiskNormal.value
        .copy(diskNormal).applyQuaternion(inverseView.current);
    }
  });

  return (
    <group ref={frame}>
      <mesh ref={surface} material={material} raycast={() => null} renderOrder={9}>
        <planeGeometry args={[SHADOW_RADIUS * 9, SHADOW_RADIUS * 9]} />
      </mesh>
    </group>
  );
}
