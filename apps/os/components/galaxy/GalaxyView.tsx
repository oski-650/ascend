"use client";

// components/galaxy/GalaxyView — ONE SCENE, TWO SURFACES, AND THE CAMERA (Slices 5–6).
//
//     GraphProjection → SpatialModel → GalaxyLayout ──► Scene ──┬──► GalaxyCanvas  (pixels)
//                                                               └──► SceneList     (text)
//                                        camera + selection ────┘
//
// This component builds the `Scene` ONCE and hands the same value to both surfaces, and it owns the
// two pieces of state neither surface may own alone: WHAT IS SELECTED and WHERE THE CAMERA IS.
//
// ─── WHY THE CAMERA LIVES HERE AND NOT IN THE CANVAS ───────────────────────────────────────────
//
// Selecting a row in the list has to move the camera. If the canvas owned the camera, the list would
// need a way to reach into it and there would be two authorities over one view. One state, one
// owner, both surfaces downstream — the same argument that put `selectedId` here in Slice 5.
//
// The camera is PRESENTATION STATE and flows one way. It is derived from `scene.bounds` and from
// gestures, it is passed DOWN, and it never travels back up: no camera value reaches the Scene, the
// layout, the spatial model or the projection. Panning moves the camera; it does not move the graph.
// F65 makes that structural by forbidding in-place mutation of `.x`/`.y`/`.radius` anywhere in this
// directory — which is only viable BECAUSE this state is immutable, replaced rather than written.
//
// ─── `camera === null` MEANS "FOLLOW THE FIT" ──────────────────────────────────────────────────
//
// Rather than an effect that copies the fit into state and a flag saying whether the operator has
// touched it, `null` means the view has not been moved and the computed fit is in force. Reset is
// `setCamera(null)`. There is no synchronisation to get wrong, and a resize re-fits automatically
// until the moment somebody pans.
//
// ─── THE INSETS ARE THIS PAGE'S, NOT NEURAL CORE'S ─────────────────────────────────────────────
//
// `viewport.fitInsets` reserves 330px on the left for NeuralCore's attention panel, 380 on the right
// for its context panel and 130 top and bottom for its chrome — geometry measured from ITS markup.
// Slice 4 called it here, so `/galaxy` has been framing the graph into a region that avoided panels
// which do not exist on this page. `computeFitCamera` takes `Insets` as a plain parameter and is
// fully generic; only `fitInsets` is page-specific. So this page passes its own, and `fitInsets`
// stays exactly as it is for the surface it was measured from.
//
// ─── SLICE 7 · MOTION, AND THE LOOP THAT REFUSES TO IDLE ───────────────────────────────────────
//
// Camera JUMPS are eased; direct manipulation is not. Panning and wheeling are 1:1 with the pointer,
// because easing a drag makes the graph feel like it is lagging behind the hand. Focus and reset are
// jumps, and a jump is where easing earns its place: Slice 6 shipped them snapping, which is abrupt.
//
// THE LOOP IS DEMAND-DRIVEN AND SELF-TERMINATING. There is no `while mounted` frame loop here. A
// transition exists only while `cameraTarget` is non-null; each frame schedules exactly ONE
// `requestAnimationFrame`, the effect re-runs because the camera changed, and when `cameraSettled`
// says the difference is sub-pixel the target is cleared and NOTHING is scheduled again. An idle
// galaxy schedules no frames at all — the legacy `GraphCanvas` loop, which runs forever and decides
// per frame whether to skip, is deliberately NOT the architecture here.
//
// Unmount cancels through the effect's own cleanup, which is also what makes an interrupted
// transition deterministic: there is only ever ONE target, so a second interaction retargets rather
// than stacking a second animation on top of the first.
//
// MOTION CHANGES PRESENTATION OVER TIME. IT DOES NOT CHANGE WHAT THE GRAPH IS. Nothing in this file
// writes a coordinate — F65 bans the assignment outright, and every camera value here is replaced
// rather than mutated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import type { DetailLevel } from "@/graph-view/taxonomy";
import {
  cameraSettled, computeFitCamera, easeCamera, type FitCamera, type Insets,
} from "@/graph-view/viewport";
import { buildScene } from "./scene";
import { qualifyingActivations, type Activation } from "./activity";
import { GalaxyCanvas } from "./GalaxyCanvas";
import { SceneList } from "./SceneList";

/**
 * Mirrors the legacy graph's manual zoom range so the two surfaces agree about what "zoomed in"
 * means. Written out rather than imported: reaching into components/graph for two numbers would put
 * the new renderer back on the legacy path that F65 exists to keep it off.
 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3.2;
/** How far a focus jump zooms in, if the view is currently further out than this. */
const FOCUS_ZOOM = 1.25;
/** Fraction of the remaining distance covered per frame. ~0.22 settles a jump in roughly 250ms. */
const CAMERA_EASE = 0.22;
/** The same, for the focus emphasis ramp. Faster: dimming should acknowledge a click immediately. */
const EMPHASIS_EASE = 0.34;
/**
 * Frames an activation takes to fade out — roughly 1.2 seconds at 60fps.
 *
 * A PRESENTATION CONSTANT. It is how long the picture acknowledges a recent event and carries no
 * business meaning: nothing anywhere reads it, and no fact changes when it does.
 */
const ACTIVATION_FRAMES = 72;

/**
 * The browser's reduced-motion preference.
 *
 * Galaxy detects it ITSELF rather than receiving it, because there is no shared helper to reuse —
 * `apps/os` has no hooks directory and NeuralCore inlines the same `matchMedia` call, which this
 * must not import. Ten lines of a standard media query is the right amount of duplication.
 *
 * The global `prefers-reduced-motion` block in globals.css neutralises CSS transitions everywhere,
 * so DOM chrome is already covered for free. It does NOTHING for a canvas, which is exactly why this
 * exists: motion painted into a canvas carries an accessibility obligation the same effect in CSS
 * would not.
 */
function usePrefersReducedMotion(): boolean {
  // READ SYNCHRONOUSLY ON THE FIRST RENDER, not in an effect.
  //
  // Starting at `false` and correcting in an effect meant the first render did not yet know, so an
  // activation scheduled one frame before the preference arrived and the cleanup cancelled it. One
  // cancelled frame is harmless in itself, but "reduced motion schedules zero frames" is a rule
  // worth being literally true rather than nearly true. The lazy initialiser runs during render;
  // `window` is guarded because this module is evaluated on the server, where the answer is the
  // safe default and no markup depends on it.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * This page's free region: a plain gutter. `/galaxy` has no floating panels over the canvas — the
 * object list is a SIBLING column, so the canvas element is already the full drawable area and the
 * only reservation needed is breathing room at the edges.
 */
export const GALAXY_INSETS: Insets = { left: 24, right: 24, top: 24, bottom: 24 };

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Props = {
  projection: GraphProjection;
  spatial: SpatialModel;
  layout: LayoutModel;
  detail: DetailLevel;
};

export function GalaxyView({ projection, spatial, layout, detail }: Props) {
  const scene = useMemo(
    () => buildScene({ projection, spatial, layout, detail }),
    [projection, spatial, layout, detail]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 1 → just acknowledged, 0 → faded out and permanently still. Uniform across every activation. */
  const [activationProgress, setActivationProgress] = useState(1);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** `null` = the view has not been moved; the computed fit is in force. */
  const [camera, setCamera] = useState<FitCamera | null>(null);
  /** Non-null only while a camera JUMP is easing. Cleared the moment it settles. */
  const [cameraTarget, setCameraTarget] = useState<FitCamera | null>(null);
  /** 0 → nothing focused, 1 → focus fully applied. The only animated presentation scalar. */
  const [emphasis, setEmphasis] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * ONE CLOCK READING, TAKEN ONCE, AT MOUNT.
   *
   * Every event age in this view is measured against this single instant. Reading the clock per node
   * or per frame would mean objects were judged against slightly different "nows" and an activation
   * could expire mid-animation — a fact appearing to change while nothing about it did. `/galaxy` is
   * force-dynamic with no polling, so the projection is fixed for the session and one reading is the
   * honest amount of time this view needs to know about.
   */
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setSize({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fitCamera = useMemo<FitCamera | null>(
    () =>
      size.w === 0 || size.h === 0 || scene.nodes.length === 0
        ? null
        : computeFitCamera(scene.bounds, size.w, size.h, GALAXY_INSETS, MAX_ZOOM),
    [scene, size]
  );

  const active: FitCamera = camera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };

  /**
   * Which drawn objects have a qualifying recent event.
   *
   * Derived ONCE, here, from the activity the authorized projection already carries — no second
   * event read, no second query, and no separate derivation for the accessible surface. Both
   * surfaces receive this same map, which is what keeps them incapable of disagreeing.
   *
   * Keyed against `scene.nodes` rather than the projection, so an event naming an object the detail
   * level dropped cannot light anything up.
   */
  const activations: Map<string, Activation> = useMemo(
    () => qualifyingActivations(projection.activity, new Set(scene.nodes.map((n) => n.id)), now),
    [projection, scene, now]
  );

  // ── Gestures. Every one of these REPLACES the camera; none writes through to anything else.
  //
  // Pan and zoom are DIRECT MANIPULATION and are never eased: the graph must track the pointer 1:1.
  // Both also clear any running transition, so grabbing the canvas mid-flight takes control from
  // wherever the camera currently is instead of fighting an animation that is still arriving.
  const pan = useCallback((dxScreen: number, dyScreen: number) => {
    setCameraTarget(null);
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, x: from.x - dxScreen / from.zoom, y: from.y - dyScreen / from.zoom };
    });
  }, [fitCamera]);

  const zoomBy = useCallback((factor: number) => {
    setCameraTarget(null);
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, zoom: clampZoom(from.zoom * factor) };
    });
  }, [fitCamera]);

  /**
   * Back to the computed fit.
   *
   * Eased when there is a fit to ease TOWARD, so the view glides back rather than jumping. Clearing
   * `camera` to null is what re-establishes "follow the fit", and that happens once the transition
   * settles — see the loop below.
   */
  /**
   * Begin a camera JUMP.
   *
   * Reduced motion is decided here rather than inside the transition effect, and that placement is
   * load-bearing twice over: an effect that calls setState synchronously cascades renders (lint
   * rejects it, correctly), and deciding here means a reduced-motion user schedules NO FRAME AT ALL
   * rather than one frame that immediately snaps. The witness counts frames, so the difference is
   * observable.
   */
  const jumpTo = useCallback((to: FitCamera) => {
    if (reducedMotion) {
      setCamera(to);
      setCameraTarget(null);
    } else {
      setCameraTarget(to);
    }
  }, [reducedMotion]);

  const resetView = useCallback(() => {
    if (fitCamera) jumpTo(fitCamera);
    else setCamera(null);
  }, [fitCamera, jumpTo]);

  /**
   * Put an object in the middle of the view.
   *
   * The target is looked up in `scene.nodes`, so a focus request can only ever land on an object the
   * scene actually contains — an id from anywhere else is ignored rather than moving the camera to
   * a coordinate nothing occupies.
   */
  const focusNode = useCallback((id: string) => {
    const node = scene.nodes.find((n) => n.id === id);
    if (!node) return;
    const from = camera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
    // A TARGET, not a camera. The loop below carries the view there — or, under reduced motion,
    // `jumpTo` arrives immediately, which is exactly the snap Slice 6 shipped.
    jumpTo({ x: node.x, y: node.y, zoom: clampZoom(Math.max(from.zoom, FOCUS_ZOOM)) });
  }, [scene, camera, fitCamera, jumpTo]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) focusNode(id);
  }, [focusNode]);

  /**
   * THE CAMERA TRANSITION. One frame per effect run, and the effect re-runs because the camera it
   * just set is a new dependency — so the loop advances itself and stops the instant it settles.
   *
   * Reduced motion takes the first branch: the target is adopted whole, no frame is ever scheduled,
   * and the result is identical to Slice 6's behaviour. Information is never carried by the motion,
   * only by the destination.
   */
  useEffect(() => {
    if (!cameraTarget) return;
    const from = camera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
    const raf = requestAnimationFrame(() => {
      // Settling ADOPTS the target whole rather than approaching it: an exponential ease is
      // asymptotic and would otherwise never arrive, and the loop would never stop.
      if (reducedMotion || cameraSettled(from, cameraTarget)) {
        setCamera(cameraTarget);
        setCameraTarget(null);
      } else {
        setCamera(easeCamera(from, cameraTarget, CAMERA_EASE));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [camera, cameraTarget, fitCamera, reducedMotion]);

  /**
   * The emphasis ramp — the same shape, for the one presentation scalar that animates.
   *
   * Under reduced motion the ramp is not RUN and not stored: the drawn value is simply the target,
   * computed during render. No effect, no frame, no state update — which is both simpler and the
   * reason a reduced-motion session schedules nothing whatsoever.
   */
  const emphasisTarget = selectedId || hoverId ? 1 : 0;
  const drawnEmphasis = reducedMotion ? emphasisTarget : emphasis;
  useEffect(() => {
    if (reducedMotion) return;
    if (Math.abs(emphasis - emphasisTarget) < 0.01) return;
    const raf = requestAnimationFrame(() =>
      setEmphasis((e) => {
        const next = e + (emphasisTarget - e) * EMPHASIS_EASE;
        return Math.abs(emphasisTarget - next) < 0.01 ? emphasisTarget : next;
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [emphasis, emphasisTarget, reducedMotion]);

  /**
   * The activation fade. Same demand-driven shape as the camera transition: one frame scheduled per
   * frame, and nothing scheduled once it reaches zero — after which this view is permanently still.
   *
   * It is the first loop here that starts WITHOUT an interaction, which is the one way Slice 7's
   * model is widened. It stays bounded: the fade runs to completion exactly once per mount, because
   * the projection cannot change during a session.
   */
  useEffect(() => {
    if (reducedMotion) return;
    if (activations.size === 0 || activationProgress <= 0) return;
    const raf = requestAnimationFrame(() =>
      setActivationProgress((p) => {
        const next = p - 1 / ACTIVATION_FRAMES;
        return next <= 0.001 ? 0 : next;
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [activationProgress, activations, reducedMotion]);

  /**
   * Under reduced motion the fade is not run and not stored — the drawn value is the state the fade
   * would have ENDED at, which is zero. No frame is scheduled and no halo is painted.
   *
   * The information is not lost with the motion: `SceneList` states the same activity in words for
   * every user, motion or not, from this same map. The canvas halo is an acknowledgement; the list
   * is the record.
   */
  const drawnActivation = reducedMotion ? 0 : activationProgress;

  const selected = selectedId ? scene.nodes.find((n) => n.id === selectedId) ?? null : null;
  const empty = scene.nodes.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: "#0d0f11" }}>
      <div ref={stageRef} style={{ position: "relative", flex: "1 1 auto", minWidth: 0 }}>
        {empty ? (
          // An honest empty state. Never a placeholder object: a fabricated node would be a business
          // object the renderer invented, which is the one thing this layer must never do.
          <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                      margin: 0, color: "#9aa2ab" }}>
            Nothing to show. The graph is empty for this account.
          </p>
        ) : (
          <>
            <GalaxyCanvas
              scene={scene}
              camera={active}
              viewW={size.w}
              viewH={size.h}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={select}
              onHover={setHoverId}
              emphasis={drawnEmphasis}
              activations={activations}
              activation={drawnActivation}
              onPan={pan}
              onZoom={zoomBy}
            />
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
              <button type="button" onClick={resetView} style={CONTROL}>
                Reset view
              </button>
            </div>
          </>
        )}
      </div>

      {/*
        The non-visual surface. A real, keyboard-reachable representation of the same scene — not a
        summary and not an afterthought. The canvas is aria-hidden; this is the accessible path to
        the same objects, and selecting here moves the camera exactly as clicking there does.
      */}
      <nav
        aria-label="Graph objects"
        style={{
          flex: "0 0 22rem", maxWidth: "40%", overflowY: "auto",
          padding: "1rem", borderLeft: "1px solid #1e2227", color: "#e9ebee",
          font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem", font: "600 13px/1.4 inherit", color: "#9aa2ab" }}>
          {scene.nodes.length} objects · {scene.edges.length} relationships
        </h2>
        <SceneList scene={scene} selectedId={selectedId} onSelect={select} activations={activations} />
      </nav>

      {/* Selection is announced rather than left to the visual change alone. */}
      <div aria-live="polite" style={SR_ONLY}>
        {selected ? `Selected ${selected.label}` : ""}
      </div>
    </div>
  );
}

const CONTROL: React.CSSProperties = {
  background: "#14181c", border: "1px solid #1e2227", borderRadius: 4,
  color: "#e9ebee", font: "12px ui-sans-serif, system-ui, sans-serif",
  padding: "0.35rem 0.7rem", cursor: "pointer",
};

const SR_ONLY: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
};
