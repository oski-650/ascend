"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, PerspectiveCamera, type Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_GALAXY_CAMERA, overviewCameraForAspect } from "@/graph-view/field/framing";
import { AMBIENT_RADIUS } from "@/graph-view/field/blackhole";
import { CAMERA_RAILS } from "@/graph-view/field/scale";

export type CameraView = "galaxy" | "core" | "object";
export type CameraCommand = { view: CameraView; revision: number; targetId?: string; distance?: number };

/** A cancellable flight; dragging always gives control back to the viewer. */
export function OrbitRig({ command, drifting, reducedMotion, onInteraction, aspect, objects, overviewScale = 1 }: {
  command: CameraCommand; drifting: boolean; reducedMotion: boolean; onInteraction: () => void; aspect: number; objects?: Map<string, Object3D>;
  overviewScale?: number;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const follow = useRef<Vector3 | null>(null);
  const aim = useRef(new Vector3());
  const destination = useRef(new Vector3());
  const displacement = useRef(new Vector3());
  const controls = useRef<OrbitControls | null>(null);
  const flight = useRef<{ from: Vector3; target: Vector3; to: Vector3; elapsed: number } | null>(null);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    controls.current = c;
    c.enableDamping = true;
    c.dampingFactor = 0.055;
    c.rotateSpeed = 0.45;
    c.zoomToCursor = true;
    c.minDistance = AMBIENT_RADIUS * 0.75;
    c.maxDistance = CAMERA_RAILS.galaxy.distance.max;
    c.minPolarAngle = CAMERA_RAILS.galaxy.polar.min;
    c.maxPolarAngle = CAMERA_RAILS.system.polar.max;
    c.autoRotateSpeed = 0.18;
    const interrupt = () => { flight.current = null; onInteraction(); };
    c.addEventListener("start", interrupt);
    return () => { c.removeEventListener("start", interrupt); c.dispose(); controls.current = null; };
  }, [camera, gl, onInteraction]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (camera instanceof PerspectiveCamera) {
      if (command.view === "object") {
        const mobile = size.width <= 600;
        camera.setViewOffset(size.width, size.height, mobile ? 0 : 162, mobile ? size.height * 0.19 : 0, size.width, size.height);
      } else camera.clearViewOffset();
    }
    const spaceScale = size.width <= 600 ? 2.2 : Math.max(1, size.height / Math.max(200, size.width - 324));
    const overview = new Vector3(...overviewCameraForAspect(aspect)).multiplyScalar(overviewScale);
    if (camera instanceof PerspectiveCamera) {
      camera.far = Math.max(12000, overview.length() * 4);
      camera.updateProjectionMatrix();
    }
    c.maxDistance = overview.length();
    follow.current = null;
    flight.current = {
      from: camera.position.clone(), target: c.target.clone(),
      to: command.view === "object"
        ? new Vector3(...DEFAULT_GALAXY_CAMERA).normalize().multiplyScalar((command.distance ?? 340) * spaceScale)
        : command.view === "core" ? new Vector3(...DEFAULT_GALAXY_CAMERA).multiplyScalar(0.23) : overview,
      elapsed: reducedMotion ? 1.8 : 0,
    };
  }, [camera, command, reducedMotion, aspect, size, overviewScale]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const object = command.targetId ? objects?.get(command.targetId) : undefined;
    if (command.view === "object" && !object) return;
    if (object) object.getWorldPosition(aim.current);
    else aim.current.set(0, 0, 0);
    c.minDistance = object ? 12 : AMBIENT_RADIUS * 0.75;
    const f = flight.current;
    c.autoRotate = drifting && !reducedMotion && !f;
    if (f) {
      f.elapsed += Math.min(delta, 0.05);
      const t = Math.min(1, f.elapsed / 1.8);
      const ease = t * t * (3 - 2 * t);
      destination.current.copy(f.to).add(aim.current);
      camera.position.lerpVectors(f.from, destination.current, ease);
      c.target.lerpVectors(f.target, aim.current, ease);
      if (t === 1) flight.current = null;
    } else if (object && follow.current) {
      displacement.current.copy(aim.current).sub(follow.current);
      camera.position.add(displacement.current);
      c.target.add(displacement.current);
    }
    if (object) {
      follow.current ??= new Vector3();
      follow.current.copy(aim.current);
    }
    c.update(delta);
  });
  return null;
}
