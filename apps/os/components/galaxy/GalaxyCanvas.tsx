"use client";

// components/galaxy/GalaxyCanvas — the pixel surface (Slice 4, made legible in Slice 5).
//
// Canvas 2D by decision (A1). It receives a `Scene` and paints it. It builds nothing, fetches
// nothing, and decides nothing about what exists — `scene.ts` made those decisions and `GalaxyView`
// holds the interaction state, so this file is the one place in the pipeline that is allowed to be
// about pixels and is about nothing else.
//
// STATIC BY DECISION (C). No requestAnimationFrame, no breathing, no glow decay, no pulses, no
// camera easing. A single paint per input change. Animation is a later slice and arrives with
// reduced-motion handling from its first commit rather than bolted on after.
//
// ─── WHY THE POLYGONS ARE WRITTEN OUT ──────────────────────────────────────────────────────────
//
// F65 forbids `Math.cos`/`Math.sin` anywhere in this directory, because a renderer that can do
// trigonometry can recompute a position, and then GalaxyLayout's determinism quietly stops being the
// thing on screen. Shape vertices are therefore UNIT CONSTANTS, computed once by hand and scaled at
// draw time. The rule costs six literal arrays and buys a boundary that cannot be crossed by
// accident — and the shapes are fixed silhouettes, so there was never anything to compute per frame.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SEMANTIC } from "@/graph-view/taxonomy";
import { computeFitCamera, fitInsets, toScreen } from "@/graph-view/viewport";
import type { Scene, SceneNode } from "./scene";

const MAX_ZOOM = 3.2;
/** Below this drawn radius a label is unreadable, so it is skipped unless focused. Pixels, not policy. */
const LABEL_MIN_RADIUS_PX = 4.5;
/** Above this drawn radius a glyph fits inside the node. Also pixels. */
const GLYPH_MIN_RADIUS_PX = 7;

/**
 * Unit silhouettes, centred on the origin, radius 1. Written out rather than generated — see above.
 * `disc` and `ring` are absent because they are drawn with `arc`, which needs no vertices.
 */
const POLYGON: Record<string, readonly (readonly [number, number])[]> = {
  diamond: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  square: [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]],
  hex: [[1, 0], [0.5, 0.8660254], [-0.5, 0.8660254], [-1, 0], [-0.5, -0.8660254], [0.5, -0.8660254]],
  tri: [[0, -1], [0.8660254, 0.5], [-0.8660254, 0.5]],
};

type Props = {
  scene: Scene;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
};

export function GalaxyCanvas({ scene, selectedId, hoverId, onSelect, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Framing is graph-view/viewport's. This hands it the scene's extents and uses the answer.
  // Memoised because it is a fresh object each render otherwise, which would invalidate the hit-test
  // callback and the paint effect on every render and repaint the canvas continuously.
  const camera = useMemo(
    () =>
      size.w === 0 || size.h === 0 || scene.nodes.length === 0
        ? { x: 0, y: 0, zoom: 1 }
        : computeFitCamera(scene.bounds, size.w, size.h, fitInsets(size.w, false), MAX_ZOOM),
    [scene, size]
  );

  /** Nearest object under the pointer. Squared distance — no trigonometry in this file. */
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

    const at = (n: { x: number; y: number }) => toScreen(n.x, n.y, camera, size.w, size.h);
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));

    // ── Focus: the selected or hovered object and everything the graph already connects it to.
    // Adjacency is READ from scene.edges. No relationship is inferred; a node is related because an
    // authorized edge says so, or it is not related.
    const focusId = selectedId ?? hoverId;
    const related = new Set<string>();
    if (focusId) {
      related.add(focusId);
      for (const e of scene.edges) {
        if (e.source === focusId) related.add(e.target);
        else if (e.target === focusId) related.add(e.source);
      }
    }
    const dimmed = focusId !== null;

    // ── Edges. Containment reads as structure; lateral association reads as a quieter, dashed link.
    // The distinction is READ from `e.containment`, which graph-view/spatial decided once.
    for (const e of scene.edges) {
      const inFocus = !dimmed || (related.has(e.source) && related.has(e.target));
      const a = at({ x: e.x1, y: e.y1 });
      const b = at({ x: e.x2, y: e.y2 });
      g.globalAlpha = e.alpha * (inFocus ? 1 : 0.15);
      g.strokeStyle = e.containment ? SEMANTIC.text3 : SEMANTIC.line;
      g.lineWidth = e.containment ? e.width : Math.max(e.width * 0.8, 0.5);
      g.setLineDash(e.containment ? [] : [3, 4]);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.setLineDash([]);

      // Direction, drawn only for containment and only when it is legible: a short arrowhead at the
      // TARGET end. Source → target is the direction the projection stored; nothing is reversed.
      const target = byId.get(e.target);
      if (e.containment && inFocus && target) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 12) {
          const ux = dx / len;
          const uy = dy / len;
          const tipX = b.x - ux * (target.radius * camera.zoom + 2);
          const tipY = b.y - uy * (target.radius * camera.zoom + 2);
          g.beginPath();
          g.moveTo(tipX, tipY);
          g.lineTo(tipX - ux * 6 - uy * 3, tipY - uy * 6 + ux * 3);
          g.lineTo(tipX - ux * 6 + uy * 3, tipY - uy * 6 - ux * 3);
          g.closePath();
          g.fillStyle = SEMANTIC.text3;
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;

    // ── Nodes.
    for (const n of scene.nodes) {
      const s = at(n);
      const r = Math.max(n.radius * camera.zoom, 1.5);
      const inFocus = !dimmed || related.has(n.id);
      const isSelected = n.id === selectedId;

      g.globalAlpha = inFocus ? (n.emphasis || isSelected ? 1 : 0.85) : 0.18;
      drawShape(g, n.shape, s.x, s.y, r, n.color);

      // A3: an already-computed health band becomes a ring. taxonomy owns the colour; this draws it.
      if (n.ring && inFocus) {
        g.strokeStyle = n.ring;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(s.x, s.y, r + 2.6, 0, Math.PI * 2);
        g.stroke();
      }
      if (isSelected) {
        g.strokeStyle = SEMANTIC.accent;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(s.x, s.y, r + 5.5, 0, Math.PI * 2);
        g.stroke();
      }

      // Glyph: taxonomy's, never invented, and only where it fits.
      if (n.glyph && inFocus && r >= GLYPH_MIN_RADIUS_PX) {
        g.globalAlpha = inFocus ? 0.9 : 0.2;
        g.fillStyle = "#0d0f11";
        g.font = `600 ${Math.round(r)}px ui-sans-serif, system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(n.glyph, s.x, s.y);
      }
    }
    g.globalAlpha = 1;

    // ── Labels, in the scene's own order of significance, with first-come collision. No threshold
    // against a business value decides this: `labelOrder` sorts by size, the detail level already
    // decided what exists, and the pixel floor is a legibility limit.
    const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
    g.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const id of scene.labelOrder) {
      const n = byId.get(id);
      if (!n) continue;
      const isFocused = n.id === selectedId || n.id === hoverId;
      const inFocus = !dimmed || related.has(n.id);
      if (!inFocus) continue;
      const s = at(n);
      const r = Math.max(n.radius * camera.zoom, 1.5);
      if (r < LABEL_MIN_RADIUS_PX && !isFocused) continue;

      const text = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
      const w = g.measureText(text).width;
      const box = { x1: s.x - w / 2 - 2, y1: s.y + r + 4, x2: s.x + w / 2 + 2, y2: s.y + r + 18 };
      const clash = taken.some((t) => !(box.x2 < t.x1 || box.x1 > t.x2 || box.y2 < t.y1 || box.y1 > t.y2));
      if (clash && !isFocused) continue;
      taken.push(box);

      g.fillStyle = isFocused ? SEMANTIC.text1 : SEMANTIC.text2;
      g.fillText(text, s.x, box.y1);
    }
  }, [scene, camera, size, hoverId, selectedId]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        onPointerMove={(e) => onHover(hit(e.clientX, e.clientY)?.id ?? null)}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => onSelect(hit(e.clientX, e.clientY)?.id ?? null)}
        aria-hidden="true"
      />
    </div>
  );
}

/** Paint one silhouette. Discs and rings use `arc`; the rest scale a unit polygon. */
function drawShape(
  g: CanvasRenderingContext2D,
  shape: SceneNode["shape"],
  x: number,
  y: number,
  r: number,
  color: string
): void {
  if (shape === "disc" || shape === "ring") {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (shape === "disc") {
      g.fillStyle = color;
      g.fill();
    } else {
      g.strokeStyle = color;
      g.lineWidth = Math.max(r * 0.28, 1);
      g.stroke();
    }
    return;
  }
  const points = POLYGON[shape];
  if (!points) return;
  g.beginPath();
  points.forEach(([ux, uy], i) => {
    const px = x + ux * r;
    const py = y + uy * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  });
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
