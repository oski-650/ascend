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
// STATIC (Slice 5 decision C, unchanged). Camera moves SNAP. No requestAnimationFrame, no easing,
// no animation of any kind — those arrive together with reduced-motion handling in a later slice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import type { DetailLevel } from "@/graph-view/taxonomy";
import { computeFitCamera, type FitCamera, type Insets } from "@/graph-view/viewport";
import { buildScene } from "./scene";
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
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** `null` = the view has not been moved; the computed fit is in force. */
  const [camera, setCamera] = useState<FitCamera | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

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

  // ── Gestures. Every one of these REPLACES the camera; none writes through to anything else.
  const pan = useCallback((dxScreen: number, dyScreen: number) => {
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, x: from.x - dxScreen / from.zoom, y: from.y - dyScreen / from.zoom };
    });
  }, [fitCamera]);

  const zoomBy = useCallback((factor: number) => {
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, zoom: clampZoom(from.zoom * factor) };
    });
  }, [fitCamera]);

  const resetView = useCallback(() => setCamera(null), []);

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
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { x: node.x, y: node.y, zoom: clampZoom(Math.max(from.zoom, FOCUS_ZOOM)) };
    });
  }, [scene, fitCamera]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) focusNode(id);
  }, [focusNode]);

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
        <SceneList scene={scene} selectedId={selectedId} onSelect={select} />
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
