"use client";

// components/galaxy/GalaxyCanvas — the Slice 4 renderer surface.
//
// Canvas 2D by decision (A1): no Three.js, no WebGL. The point of this slice is to prove the
// pipeline, and a new 3D dependency would have made the proof about the dependency.
//
// It PAINTS and nothing else. Every decision about what to draw was made in `scene.ts`, which is a
// pure function this component calls; positions arrive from GalaxyLayout and are copied to the
// screen through `graph-view/viewport.toScreen`. There is no layout arithmetic here, no camera of
// its own (framing is `computeFitCamera`, viewport's property), and no reachback into any reader.
//
// ISOLATED (A2). It does not touch `components/graph/*` — not `GraphCanvas`, and above all not
// `simulation.ts`. The legacy 2D path stays exactly as it was, and this surface can be deleted
// without touching it. F65 holds that separation.
//
// DELIBERATELY MINIMAL. No animation loop, no particles, no orbital motion, no pulses, no drag.
// Dragging is the notable omission: a drag writes a position, and a renderer that authors positions
// is the second layout authority this slice exists to avoid. Pinning returns when there is a layer
// that owns persisted positions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import { SEMANTIC, type DetailLevel } from "@/graph-view/taxonomy";
import { computeFitCamera, fitInsets, toScreen } from "@/graph-view/viewport";
import { buildScene, type SceneNode } from "./scene";

const MAX_ZOOM = 3.2;

type Props = {
  projection: GraphProjection;
  spatial: SpatialModel;
  layout: LayoutModel;
  detail: DetailLevel;
};

export function GalaxyCanvas({ projection, spatial, layout, detail }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scene = useMemo(
    () => buildScene({ projection, spatial, layout, detail }),
    [projection, spatial, layout, detail]
  );

  // Framing belongs to graph-view/viewport. This passes it the scene's extents and uses the answer.
  const camera = useMemo(() => {
    if (size.w === 0 || size.h === 0 || scene.nodes.length === 0) return { x: 0, y: 0, zoom: 1 };
    return computeFitCamera(scene.bounds, size.w, size.h, fitInsets(size.w, false), MAX_ZOOM);
  }, [scene, size]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /** Nearest object under the pointer. Squared distance — no trigonometry anywhere in this file. */
  const hit = useCallback(
    (clientX: number, clientY: number): SceneNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      for (const n of scene.nodes) {
        const s = toScreen(n.x, n.y, camera, size.w, size.h);
        const dx = px - s.x;
        const dy = py - s.y;
        const r = Math.max(n.radius * camera.zoom, 8);
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    },
    [scene, camera, size]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    for (const e of scene.edges) {
      const a = toScreen(e.x1, e.y1, camera, size.w, size.h);
      const b = toScreen(e.x2, e.y2, camera, size.w, size.h);
      g.globalAlpha = e.alpha;
      g.strokeStyle = SEMANTIC.line;
      g.lineWidth = e.width;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.globalAlpha = 1;

    for (const n of scene.nodes) {
      const s = toScreen(n.x, n.y, camera, size.w, size.h);
      const r = Math.max(n.radius * camera.zoom, 1.5);
      const active = n.id === selectedId || n.id === hoverId;

      g.fillStyle = n.color;
      g.globalAlpha = n.emphasis || active ? 1 : 0.82;
      g.beginPath();
      g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;

      if (n.ring) {
        g.strokeStyle = n.ring;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(s.x, s.y, r + 2.5, 0, Math.PI * 2);
        g.stroke();
      }

      if (active) {
        g.fillStyle = SEMANTIC.text1;
        g.font = "12px ui-sans-serif, system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(n.label, s.x, s.y - r - 8);
      }
    }
  }, [scene, camera, size, hoverId, selectedId]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        onPointerMove={(e) => setHoverId(hit(e.clientX, e.clientY)?.id ?? null)}
        onPointerLeave={() => setHoverId(null)}
        onClick={(e) => setSelectedId(hit(e.clientX, e.clientY)?.id ?? null)}
        aria-label={`Galaxy renderer preview: ${scene.nodes.length} objects, ${scene.edges.length} relationships`}
      />
    </div>
  );
}
