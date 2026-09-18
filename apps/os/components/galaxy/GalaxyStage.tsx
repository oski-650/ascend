"use client";

// Observatory composition: black space, orbiting stars, local emission and a lensed core.
// Authorized system records arrive from the server; visual fixtures can use the same seam.
// The composer owns environment, quality and motion preferences.
//
// ─── WHY THE RENDERER SETTINGS ARE NOT TUNING ──────────────────────────────────────────────────
//
// Every value in the `gl` block below is load-bearing, and three of them are the difference between
// a photograph and a particle demo:
//
//   • **`logarithmicDepthBuffer`** — the scene spans 0.15 (a moon's surface) to 3000 (the halo's
//     edge). That is four decades, and a linear 24-bit depth buffer cannot resolve it: moons
//     z-fight with their planets while the halo stipples. Not optional at this ratio.
//
//   • **ACES tone mapping** — bright bodies are driven PAST 1.0 on purpose, because values above
//     1.0 are what the bloom pass selects on. ACES rolls that overdrive off to white; without it
//     the cores clip into flat blobs, which is what "it looks like a screensaver" actually is.
//
//   • **`antialias: false`** — deliberate, not an oversight. SMAA runs in the post chain at a
//     fraction of MSAA's cost, and MSAA on a float target is the expensive way to get a worse
//     result once bloom is smearing the edges anyway.
//
// ─── THIS FILE OWNS THE ENVIRONMENT QUESTIONS, AND IT IS THE ONLY ONE THAT MAY ─────────────────
//
// How many cores the machine has, whether the operator asked for reduced motion, how big the
// container is, whether the tab is visible: asked here, once, and handed down as values. Two places
// asking is two answers that can disagree, and the disagreement shows up as a scene that is in one
// quality tier and behaving like another.

import {
  useCallback, useEffect, useMemo, useRef, useState, type RefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  DEFAULT_GALAXY_CAMERA, DPR_RANGE, MOBILE_DPR_MAX, lockHorizontalFov,
} from "@/graph-view/field/framing";
import { CAMERA_FAR, CAMERA_NEAR } from "@/graph-view/field/scale";
import { DESKTOP_STARS, MOBILE_STARS, generateStarField } from "@/graph-view/field/spiral";
import { FocusProvider } from "./camera/useFocus";
import { OrbitRig, type CameraCommand } from "./camera/OrbitRig";
import { Effects } from "./scene/Effects";
import { GalacticCore } from "./scene/GalacticCore";
import { effectiveTimeScale, qualityTierFor, type QualityTier, type TimeRate } from "./camera/focusStore";
import { DEEP_SPACE } from "./lib/palette";
import { Atmosphere } from "./scene/Atmosphere";
import { SystemExplorer } from "./SystemExplorer";
import { BusinessBodies, type ObjectRegistry, type LabelRegistry } from "./scene/BusinessBodies";
import { focusDistance, recordPath, visibleSystemBodies, systemOverviewScale, type SystemMap } from "@/graph-view/field/systems";
import { GalaxyControls } from "./GalaxyControls";
import { StarField } from "./scene/StarField";
import { SurfaceBoundary } from "./SurfaceBoundary";
import { GalaxyNotice } from "./GalaxyNotice";
import {
  afterContextCreated, afterContextLost, afterContextRestored, afterSceneFailure,
  detectWebGL, isDegraded, isDrawing, type SurfaceState,
} from "./surfaceState";

/**
 * Applies the locked field of view, then reports what the live context actually produced.
 *
 * ─── WHY APPLYING AND REPORTING ARE ONE EFFECT ────────────────────────────────────────────────
 *
 * They were two, in two components, and the ordering bit. Child effects run before parent effects,
 * so the report fired with the PREVIOUS frame's field of view and was never corrected — the lock
 * was working and the published evidence said it was not. Doing both here, in that order, means the
 * number published is the number the camera is holding, which is the only reason to publish it.
 *
 * ─── WHY THIS REPORTS AT ALL ──────────────────────────────────────────────────────────────────
 *
 * "Correct colour space" is a claim about a live WebGL context, and the only honest way to check it
 * is to ask the context — a constant in this file asserts what was REQUESTED, never what the driver
 * agreed to. It is the acceptance evidence for this phase, not debug scaffolding, and it has
 * already earned its place twice: it caught a 1280px container cap in the shell, and then caught
 * R3F quietly ignoring a declarative `fov` because it builds the default camera exactly once.
 *
 * The camera arrives as a REF rather than through `useThree`, because `react-hooks/immutability`
 * forbids modifying anything a hook handed back — correctly, since a component that reconfigures
 * the renderer it was given is a second place the renderer gets configured.
 */
function Frame({
  cameraRef,
  fov,
  onReport,
}: {
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  fov: number;
  onReport: (state: Record<string, string>) => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    const cam = cameraRef.current;
    if (cam !== null) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    onReport({
      colorSpace: gl.outputColorSpace,
      toneMapping: String(gl.toneMapping),
      exposure: gl.toneMappingExposure.toFixed(2),
      pixelRatio: gl.getPixelRatio().toFixed(2),
      fov: "fov" in camera ? Number(camera.fov).toFixed(2) : "n/a",
      size: `${size.width}x${size.height}`,
    });
  }, [cameraRef, fov, onReport, gl, camera, size]);

  return null;
}

export function GalaxyStage({ systemMap, initialFocusId = null, onRefresh }: {
  systemMap?: SystemMap; initialFocusId?: string | null; onRefresh?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const objects = useRef<ObjectRegistry>(new Map());
  const labels = useRef<LabelRegistry>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusId);
  const [rate, setRate] = useState<TimeRate>(1);
  const [drifting, setDrifting] = useState(false);
  const [command, setCommand] = useState<CameraCommand>({ view: "galaxy", revision: 0 });
  const onInteraction = useCallback(() => setDrifting(false), []);
  const selected = systemMap?.records.find((r) => r.id === selectedId);
  const effectiveSelectedId = selected?.promotedToId ?? selected?.id ?? null;
  const bodies = useMemo(() => systemMap ? visibleSystemBodies(systemMap, effectiveSelectedId) : [], [systemMap, effectiveSelectedId]);
  const activeCommand = useMemo<CameraCommand>(() => {
    if (!systemMap || !effectiveSelectedId) return command;
    const path = recordPath(systemMap, effectiveSelectedId).reverse();
    const target = path.find((r) => systemMap.bodies.some((b) => b.id === r.id));
    return target ? { view: "object", targetId: target.id, distance: focusDistance(systemMap, target.id), revision: command.revision } : command;
  }, [systemMap, effectiveSelectedId, command]);
  const selectRecord = useCallback((id: string) => {
    if (!systemMap?.records.find((r) => r.id === id)) return;
    setSelectedId(id);
    setDrifting(false);
    setCommand((previous) => ({ ...previous, revision: previous.revision + 1 }));
  }, [systemMap]);
  const showView = useCallback((view: "galaxy" | "core" | "object") => {
    setSelectedId(null);
    setCommand((previous) => ({ view, revision: previous.revision + 1 }));
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !systemMap || !effectiveSelectedId) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const path = recordPath(systemMap, effectiveSelectedId);
      const parent = path.at(-2);
      if (parent) selectRecord(parent.id);
      else showView("galaxy");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [systemMap, effectiveSelectedId, selectRecord, showView]);
  const labelled = useMemo(() => {
    if (!systemMap) return [];
    const eligible = bodies.filter((b) => b.role !== "asteroid" || b.id === effectiveSelectedId);
    eligible.sort((a, b) => a.id === effectiveSelectedId ? -1 : b.id === effectiveSelectedId ? 1 : a.role === "sun" ? -1 : b.role === "sun" ? 1 : 0);
    return eligible.slice(0, 24).map((b) => systemMap.records.find((r) => r.id === b.id)!).filter(Boolean);
  }, [bodies, systemMap, effectiveSelectedId]);
  const [aspect, setAspect] = useState(16 / 9);
  const [active, setActive] = useState(true);
  const [quality, setQuality] = useState<QualityTier>("high");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pixelRatio, setPixelRatio] = useState(1);

  // ─── WHAT THE PICTURE IS DOING ───────────────────────────────────────────────────────────────
  //
  // One word, owned here, for the same reason the quality tier is owned here: two places asking is
  // two answers that can disagree, and a surface that says "In motion" while the context is gone is
  // exactly that disagreement. See `surfaceState.ts` for what was witnessed in the browser.
  const [surface, setSurface] = useState<SurfaceState>("starting");

  // THE CAPABILITY IS ASKED ABOUT BEFORE THE RENDERER IS ALLOWED TO TRY. A failed context creation
  // throws OUTSIDE React and no boundary sees it, so the only way the operator is ever told is to
  // find out first and not mount `<Canvas>` at all.
  //
  // `null` until the probe has run, and `<Canvas>` waits for it. An effect ALONE would not do: a
  // child's effects run before its parent's, so `<Canvas>` would have asked for its context — and
  // thrown uncaught — a whole commit before this component got to look. One frame of "starting" is
  // the price of never mounting a renderer this machine cannot run.
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const available = detectWebGL();
    setWebglAvailable(available);
    if (!available) setSurface("unsupported");
  }, []);

  // Loss and restoration are three.js's to recover from — it preventDefaults the loss and rebuilds
  // on restore, both witnessed. We attach only to SAY which is happening. No preventDefault, no
  // remount, no retry: a second owner of recovery is how a surface ends up in a remount loop.
  const onCanvasCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    // Every transition goes through `surfaceState`, which owns the precedence — a teardown's
    // parting `webglcontextlost` must not talk over the failure that caused the teardown.
    canvas.addEventListener("webglcontextlost", () => setSurface(afterContextLost));
    canvas.addEventListener("webglcontextrestored", () => setSurface(afterContextRestored));
    setSurface(afterContextCreated);
  }, []);

  // A throw inside the scene is a React error, so this one IS a boundary's to report. It arrives
  // from the commit phase and only ever moves the surface to a terminal state.
  const onSceneFailure = useCallback(() => setSurface(afterSceneFailure), []);

  // ─── THE ENVIRONMENT, ASKED ONCE ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phone = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setReducedMotion(media.matches);
      const tier = phone.matches ? "reduced" : qualityTierFor({
        hardwareConcurrency: navigator.hardwareConcurrency,
        reducedMotion: media.matches,
      });
      setQuality(tier);
      setPixelRatio(Math.min(
        window.devicePixelRatio,
        tier === "reduced" ? MOBILE_DPR_MAX : DPR_RANGE[1],
      ));
    };
    apply();
    media.addEventListener("change", apply);
    phone.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      phone.removeEventListener("change", apply);
    };
  }, []);

  // ─── SIZE ────────────────────────────────────────────────────────────────────────────────────
  //
  // ResizeObserver on the CONTAINER, never `window.resize`. The two differ exactly when a panel
  // opens, and using the window one stretches the scene every time the operator opens anything.
  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ─── WHETHER TO RUN AT ALL ───────────────────────────────────────────────────────────────────
  //
  // `frameloop="demand"` is the wrong tool here: this scene is in constant motion, so "demand"
  // would mean "never repaint". What is wanted is the loop STOPPING when nobody is looking, which
  // is a different question with two answers — the tab is hidden, or the canvas is scrolled away.
  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    let inView = true;
    const onVisibility = () => setActive(inView && !document.hidden);
    onVisibility();
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      onVisibility();
    }, {
      threshold: 0,
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const fov = useMemo(() => lockHorizontalFov(aspect), [aspect]);

  // ─── THE CAMERA IS OURS, AND THAT IS WHY THE LOCK WORKS ──────────────────────────────────────
  //
  // The first version passed `camera={{ fov, near, far, position }}` and let R3F build it. R3F
  // builds the default camera ONCE and does not re-apply that object when it changes, so the locked
  // field was computed correctly, handed over, and silently ignored: `data-galaxy-fov` read 55.00 at
  // 3440×1440 where the lock says 46.8. Every unit test still passed, because the arithmetic was
  // never the thing that was broken.
  //
  // Holding the instance in a ref fixes it and keeps the mutation legal — a ref is the sanctioned
  // mutable surface, where an object handed back by a hook is not. R3F still owns the ASPECT, which
  // it updates on resize; we own the field of view, which is the one thing §14 is about.
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  cameraRef.current ??= (() => {
    const cam = new THREE.PerspectiveCamera(fov, 1, CAMERA_NEAR, CAMERA_FAR);
    cam.position.set(...DEFAULT_GALAXY_CAMERA);
    cam.lookAt(0, 0, 0);
    return cam;
  })();



  // Published on the host element, which this component owns outright — a ref'd DOM node is the
  // sanctioned mutable surface, where the renderer handed down by a hook is not.
  const publish = useCallback((state: Record<string, string>) => {
    const node = host.current;
    if (node === null) return;
    for (const [key, value] of Object.entries(state)) {
      node.setAttribute(`data-galaxy-${key.toLowerCase()}`, value);
    }
  }, []);

  // ─── THE GALAXY ITSELF ───────────────────────────────────────────────────────────────────────
  //
  // Built once per tier, off the authorized graph entirely: the star field is the BACKDROP, and it
  // carries no business meaning by construction. The rule that permits it requires exactly that —
  // see the fitness suite. How many stars is a property of the machine, which is why the composer
  // owns it: the same reason the detail-level layout moved here.
  const field = useMemo(
    () => generateStarField(quality === "reduced" ? MOBILE_STARS : DESKTOP_STARS),
    [quality],
  );

  const timeScale = useMemo(
    () => effectiveTimeScale({ rate, reducedMotion }),
    [rate, reducedMotion],
  );

  const dpr = useMemo<[number, number]>(
    () => (quality === "reduced" ? [1, MOBILE_DPR_MAX] : [DPR_RANGE[0], DPR_RANGE[1]]),
    [quality],
  );

  const drawing = isDrawing(surface);
  const degraded = isDegraded(surface);

  return (
    <div className="galaxy-observatory" data-functional={!!systemMap} data-surface={surface} ref={host} style={{ position: "absolute", inset: 0, background: DEEP_SPACE }}>
      {/*
        ─── THE CONTAINMENT HIERARCHY ───────────────────────────────────────────────────────────

        Failure gets more localised the further in it happens:

          route            → the page and its authorized projection
          DOM cockpit      → directory, inspector, controls, notice   ← OUTSIDE every boundary
          renderer boundary→ the canvas and the whole scene
          scene            → bodies, star field, core
          post chain       → bloom, lensing, SMAA                     ← its own boundary, no message

        The cockpit sits outside the renderer boundary deliberately. Until this slice ONE boundary
        wrapped the canvas, the labels, the explorer AND the controls, so a throw in the scene took
        the business with the picture — the inverse of what this surface is for.
      */}
      <SurfaceBoundary label="Galaxy" onFailure={onSceneFailure} fallback={null}>
        {webglAvailable !== true ? null : <FocusProvider initial={{ quality, reducedMotion }}>
          <Canvas
            frameloop={active ? "always" : "never"}
            dpr={dpr}
            gl={{
              antialias: false,
              powerPreference: "high-performance",
              alpha: false,
              stencil: false,
              depth: true,
              logarithmicDepthBuffer: true,
              // Declared here rather than assigned in an effect. R3F applies these to the renderer
              // it constructs, which keeps ONE place where the renderer is configured — and it is
              // what `react-hooks/immutability` is protecting by refusing the effect.
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1,
              outputColorSpace: THREE.SRGBColorSpace,
            }}
            camera={cameraRef.current}
            onCreated={onCanvasCreated}
          >
            <color attach="background" args={[DEEP_SPACE]} />
            <Frame cameraRef={cameraRef} fov={fov} onReport={publish} />
            <OrbitRig command={activeCommand} objects={objects.current} drifting={drifting} reducedMotion={reducedMotion} onInteraction={onInteraction} aspect={aspect} overviewScale={systemOverviewScale(systemMap)} />
            <Atmosphere fade={effectiveSelectedId ? 0.15 : 1} field={field} pixelRatio={pixelRatio} timeScale={timeScale} />
            <StarField fade={effectiveSelectedId ? 0.15 : 1} field={field} pixelRatio={pixelRatio} timeScale={timeScale} />
            <GalacticCore timeScale={timeScale} />
            {systemMap && <BusinessBodies bodies={bodies} objects={objects.current} labels={labels.current}
              selectedId={effectiveSelectedId} onSelect={selectRecord} timeScale={timeScale} />}
            {/*
              Losing bloom should cost the glow and not the galaxy — the reduced rendering this
              boundary was built for, which the active stage had never used.
            */}
            <SurfaceBoundary label="Post-processing" fallback={null}>
              <Effects quality={quality} />
            </SurfaceBoundary>
          </Canvas>
        </FocusProvider>}
      </SurfaceBoundary>

      {/* ─── THE DURABLE COCKPIT. Outside every boundary above; survives all of them. ─────────── */}
      {systemMap && <>
        {/*
          Labels are positioned by the render loop, so when the scene is not drawing they are last
          frame's coordinates. Left up during a lost context they floated over a white void, which
          was witnessed and is the reason they are held back here.
        */}
        {drawing && <div className="system-labels" aria-label="Visible galaxy objects">
          {labelled.map((r) => <button key={r.id} className="system-body-label"
            aria-label={`Select ${r.label}`} aria-pressed={r.id === effectiveSelectedId}
            ref={(element) => { if (element) labels.current.set(r.id, element); else labels.current.delete(r.id); }}
            onClick={() => selectRecord(r.id)}>{r.label}</button>)}
        </div>}
        <SystemExplorer map={systemMap} selectedId={effectiveSelectedId} onSelect={selectRecord}
          onOverview={() => showView("galaxy")} onRefresh={onRefresh} degraded={degraded} />
      </>}
      <GalaxyNotice state={surface} />
      <GalaxyControls functional={!!systemMap} rate={rate} setRate={setRate} drifting={drifting}
        setDrifting={setDrifting} reducedMotion={reducedMotion}
        onView={showView} drawing={drawing} />
    </div>
  );
}
