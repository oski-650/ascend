"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { SunSurface } from "./SunSurface";
import { PROSPECT_VERTEX, PROSPECT_FRAGMENT } from "../shaders/prospect";
import { orbitTrackPoints, type OrbitBody } from "@/graph-view/field/systems";
import { PROSPECT_BELT } from "@/graph-view/field/scale";

export type ObjectRegistry = Map<string, THREE.Object3D>;
export type LabelRegistry = Map<string, HTMLButtonElement>;

type Shared = {
  objects: ObjectRegistry; selectedId: string | null;
  onSelect: (id: string) => void; timeScale: number;
};

function Track({ body }: { body: OrbitBody }) {
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(
    orbitTrackPoints(body.track).map((p) => new THREE.Vector3(...p)),
  ), [body.track]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineLoop geometry={geometry} raycast={() => null}>
    <lineBasicMaterial color="#81939f" transparent opacity={0.2} depthWrite={false} />
  </lineLoop>;
}

function Body({ body, childrenByParent, ancestry, ...shared }: Shared & {
  body: OrbitBody; childrenByParent: Map<string, OrbitBody[]>; ancestry: Set<string>;
}) {
  const turning = useRef<THREE.Group>(null);
  const surface = useRef<THREE.Mesh>(null);
  const selected = body.id === shared.selectedId;
  const register = useCallback((object: THREE.Group | null) => {
    if (object) shared.objects.set(body.id, object);
    else shared.objects.delete(body.id);
  }, [shared.objects, body.id]);
  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1) * shared.timeScale;
    if (turning.current) turning.current.rotation.y += step * body.speed * 6;
    if (surface.current) surface.current.rotation.y += step * 0.8;
  });
  const sun = body.role === "sun";
  return <group rotation={[body.tilt, 0, 0]}>
    {body.parentId && <Track body={body} />}
    <group ref={turning}>
      <group position={body.position} ref={register}>
        <mesh ref={surface} onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation(); shared.onSelect(body.id);
        }}>
          <sphereGeometry args={[body.radius, sun ? 32 : 24, 24]} />
          {sun ? <SunSurface timeScale={shared.timeScale} /> : <meshStandardMaterial color={body.color} roughness={0.72}
            emissive="#142434" emissiveIntensity={0.3} />}
        </mesh>
        {sun && childrenByParent.has(body.id) && <pointLight color="#fff0d1" intensity={3500} distance={800} decay={1.5} />}
        {body.role === "planet" && <mesh raycast={() => null}>
          <sphereGeometry args={[body.radius * 1.08, 24, 24]} />
          <meshBasicMaterial color="#6cb7e3" transparent opacity={0.13} side={THREE.BackSide} depthWrite={false} />
        </mesh>}
        {selected && <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[body.radius * 1.45, body.radius * 1.52, 64]} />
          <meshBasicMaterial color="#f9ddb0" side={THREE.DoubleSide} transparent opacity={0.8} depthWrite={false} />
        </mesh>}
        {(childrenByParent.get(body.id) ?? []).filter((child) => !ancestry.has(child.id)).map((child) =>
          <Body key={child.id} body={child} childrenByParent={childrenByParent}
            ancestry={new Set([...ancestry, child.id])} {...shared} />)}
      </group>
    </group>
  </group>;
}

function Asteroids({ bodies, objects, selectedId, onSelect, timeScale }: {
  bodies: OrbitBody[]; objects: ObjectRegistry; selectedId: string | null; onSelect: (id: string) => void; timeScale: number;
}) {
  const belt = useRef<THREE.Group>(null);
  const instances = useRef<THREE.InstancedMesh>(null);
  useFrame((_, delta) => { if (belt.current) belt.current.rotation.y += Math.min(delta, 0.1) * timeScale * 0.006; });
  const selected = bodies.find((b) => b.id === selectedId);
  const beltShift = Math.max(0, ...bodies.map((body) => body.track - PROSPECT_BELT.max));
  const beltGuides = useMemo(() => [PROSPECT_BELT.min + beltShift, (PROSPECT_BELT.min + PROSPECT_BELT.max) / 2 + beltShift, PROSPECT_BELT.max + beltShift]
    .map((track) => new THREE.BufferGeometry().setFromPoints(
      orbitTrackPoints(track).map((point) => new THREE.Vector3(...point)),
    )), [beltShift]);
  useEffect(() => () => { for (const geometry of beltGuides) geometry.dispose(); }, [beltGuides]);
  useEffect(() => {
    const mesh = instances.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      matrix.compose(new THREE.Vector3(...body.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(body.tilt, body.tilt * 3, body.tilt * 5)),
        new THREE.Vector3(body.radius, body.radius, body.radius));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [bodies]);
  const register = useCallback((object: THREE.Group | null) => {
    if (!selected) return;
    if (object) objects.set(selected.id, object);
    else objects.delete(selected.id);
  }, [objects, selected]);
  return <group ref={belt}>
    {beltGuides.map((geometry, index) => <lineLoop key={index} geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#75677f" transparent opacity={index === 1 ? 0.13 : 0.06} depthWrite={false} />
    </lineLoop>)}
    <instancedMesh ref={instances} args={[undefined, undefined, bodies.length]}
      onClick={(event) => {
        const body = event.instanceId === undefined ? null : bodies[event.instanceId];
        if (body) { event.stopPropagation(); onSelect(body.id); }
      }}>
      <sphereGeometry args={[1, 24, 16]} />
      <shaderMaterial vertexShader={PROSPECT_VERTEX} fragmentShader={PROSPECT_FRAGMENT}
        transparent={false} depthWrite depthTest />
    </instancedMesh>
    {selected && <group position={selected.position} ref={register}>
      <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[selected.radius * 1.5, selected.radius * 1.56, 64]} />
        <meshBasicMaterial color="#c7b6d2" side={THREE.DoubleSide} transparent opacity={0.76} depthWrite={false} />
      </mesh>
    </group>}
  </group>;
}

/** Meshes and accessible DOM labels refer to the same records and the same moving transforms. */
export function BusinessBodies({ bodies, labels, ...shared }: Shared & {
  bodies: OrbitBody[]; labels: LabelRegistry;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const scratch = useRef(new THREE.Vector3());
  const roots = useRef<THREE.Group>(null);
  const tree = useMemo(() => {
    const children = new Map<string, OrbitBody[]>();
    for (const body of bodies) if (body.parentId) children.set(body.parentId, [...(children.get(body.parentId) ?? []), body]);
    return children;
  }, [bodies]);
  const asteroids = useMemo(() => bodies.filter((b) => b.role === "asteroid"), [bodies]);
  useFrame((_, delta) => {
    if (roots.current) roots.current.rotation.y += Math.min(delta, 0.1) * shared.timeScale * 0.01;
    const occupied: { x: number; y: number; width: number }[] = [];
    for (const [id, label] of sharedLabels(labels, shared.selectedId)) {
      const object = shared.objects.get(id);
      if (!object) { label.style.visibility = "hidden"; continue; }
      object.getWorldPosition(scratch.current).project(camera);
      const x = (scratch.current.x + 1) * size.width / 2;
      const y = (1 - scratch.current.y) * size.height / 2;
      const width = label.offsetWidth;
      const outside = scratch.current.z < -1 || scratch.current.z > 1 || x < 20 || x > size.width - 20 || y < 100 || y > size.height - 90;
      const overlap = occupied.some((other) => Math.abs(other.x - x) < (other.width + width) / 2 + 8 && Math.abs(other.y - y) < 38);
      label.style.visibility = outside || overlap ? "hidden" : "visible";
      label.style.transform = `translate(${x}px, ${y + 20}px) translateX(-50%)`;
      if (!outside && !overlap) occupied.push({ x, y, width });
    }
  });
  return <>
    <ambientLight intensity={0.7} />
    <group ref={roots}>
    {bodies.filter((b) => !b.parentId && b.role !== "asteroid").map((body) =>
      <Body key={body.id} body={body} childrenByParent={tree} ancestry={new Set([body.id])} {...shared} />)}
    </group>
    <Asteroids timeScale={shared.timeScale} bodies={asteroids} objects={shared.objects} selectedId={shared.selectedId} onSelect={shared.onSelect} />
  </>;
}

function sharedLabels(labels: LabelRegistry, selectedId: string | null) {
  return [...labels].sort(([a], [b]) => a === selectedId ? -1 : b === selectedId ? 1 : 0);
}
