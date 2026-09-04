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
// SLICE 6 — IT DOES NOT OWN THE CAMERA. The camera arrives as a prop and gestures are reported
// upward: `onPan` and `onZoom` describe what the operator did, and GalaxyView decides what the
// camera becomes. That is what stops the list and the canvas becoming two authorities over one view,
// and it is why nothing in this file assigns to a camera or a node — F65 forbids the assignment
// outright, which is only viable because the state upstream is immutable.
//
// ─── WHY THE POLYGONS ARE WRITTEN OUT ──────────────────────────────────────────────────────────
//
// F65 forbids `Math.cos`/`Math.sin` anywhere in this directory, because a renderer that can do
// trigonometry can recompute a position, and then GalaxyLayout's determinism quietly stops being the
// thing on screen. Shape vertices are therefore UNIT CONSTANTS, computed once by hand and scaled at
// draw time. The rule costs six literal arrays and buys a boundary that cannot be crossed by
// accident — and the shapes are fixed silhouettes, so there was never anything to compute per frame.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { SEMANTIC } from "@/graph-view/taxonomy";
import { toScreen, toWorld, type FitCamera } from "@/graph-view/viewport";
import type { Scene, SceneNode } from "./scene";
import type { Activation } from "./activity";
import { relationshipsOf, type Relationship } from "./traversal";

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
  camera: FitCamera;
  viewW: number;
  viewH: number;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Pointer drag, in screen pixels. GalaxyView converts it into a camera move. */
  onPan: (dxScreen: number, dyScreen: number) => void;
  /** Multiplicative zoom step. GalaxyView applies the clamp. */
  onZoom: (factor: number) => void;
  /**
   * 0 → nothing focused, 1 → focus fully applied. The single animated presentation scalar, eased by
   * GalaxyView. It scales HOW STRONGLY the existing focus treatment is drawn; it never decides WHAT
   * is focused, and it carries no business meaning of its own.
   */
  emphasis: number;
  /** Objects with a qualifying recent event, derived once by GalaxyView. Read-only here. */
  activations: ReadonlyMap<string, Activation>;
  /** 1 → just acknowledged, 0 → faded. Uniform: it never varies per object. */
  activation: number;
  /** Follow a relationship. The SAME action the accessible list calls — one traversal semantic. */
  onTraverse: (relationship: Relationship) => void;
};

export function GalaxyCanvas({
  scene, camera, viewW, viewH, selectedId, hoverId, onSelect, onHover, onPan, onZoom, emphasis,
  activations, activation, onTraverse,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Pointer bookkeeping. Local interaction detail — not camera state, and never a node's. */
  const drag = useRef({ down: false, lastX: 0, lastY: 0, moved: false });

  /**
   * SLICE 7 ALLOCATION PREREQUISITE. Both of these used to be built inside the paint effect. At one
   * paint per interaction that was free; with a transition running they would be rebuilt on every
   * animated frame, which is a garbage treadmill for values that do not change between frames.
   *
   * `byId` depends only on the scene. `labelBoxes` is per-paint scratch, so it is a REUSED array
   * whose length is reset rather than a fresh one per frame — boxes are stored as flat quadruples so
   * no object is allocated per label either.
   */
  const byId = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);
  const labelBoxes = useRef<number[]>([]);
  const present = useMemo(() => new Set(scene.nodes.map((n) => n.id)), [scene]);

  /**
   * The object the view is currently oriented around: the selection, or whatever is hovered when
   * nothing is selected. Lifted out of the paint effect so its relationships are computed ONCE per
   * change rather than on every animated frame — the Slice 7 rule about the paint loop, applied to
   * the one derivation Slice 9 added to it.
   */
  const focusId = selectedId ?? hoverId;

  /**
   * The focus object's relationships, from `traversal.relationshipsOf` — the same function the
   * accessible list calls, so the canvas holds no opinion of its own about what is connected.
   *
   * Used for BOTH jobs: dimming (what stays lit) and traversal (what can be followed). They were
   * two calls with identical arguments whenever something was selected, which is the common case.
   */
  const focusRelationships = useMemo(
    () => (focusId ? relationshipsOf(focusId, scene.edges, present) : []),
    [focusId, scene, present]
  );

  /**
   * What can be followed: the SELECTED object's relationships, and only those.
   *
   * When something is selected, `focusId === selectedId`, so this IS that list — no second
   * computation. When nothing is selected there is nothing to follow, which is what keeps traversal
   * an explicit act on a chosen object rather than something a hover makes available.
   */
  const followable = useMemo(
    () => (selectedId ? focusRelationships : []),
    [selectedId, focusRelationships]
  );

  /**
   * The object under the pointer.
   *
   * ONE inverse projection, then a comparison in WORLD space — `viewport.toWorld` is the exact
   * inverse of the `toScreen` used to draw. The previous version projected every node forward on
   * every pointer move; with a movable camera that is both wasteful and a second place the transform
   * is written down. The hit radius is widened in world units so small objects stay clickable at low
   * zoom, which is a targeting affordance and not a change to any object's size.
   */
  const hit = useCallback(
    (clientX: number, clientY: number): SceneNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const w = toWorld(clientX - rect.left, clientY - rect.top, camera, viewW, viewH);
      for (const n of scene.nodes) {
        const dx = w.x - n.x;
        const dy = w.y - n.y;
        const r = Math.max(n.radius, 8 / camera.zoom);
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    },
    [scene, camera, viewW, viewH]
  );

  /**
   * The followable relationship whose drawn line the pointer is on, or null.
   *
   * GEOMETRY CHOOSES WHICH LINE WAS POINTED AT. IT DOES NOT DECIDE WHAT THE LINE MEANS. Distance to
   * a segment answers "which edge did they click", exactly as distance to a centre answers "which
   * node did they click" — and it chooses only among `followable`, the authority's own answer for
   * the selected object. The relationship's target, direction and containment were decided there and
   * are returned unchanged.
   *
   * So no neighbour is inferred from proximity, and an edge between two OTHER objects is unreachable
   * however precisely it is clicked: it was never in the set geometry is searching.
   */
  const edgeUnder = useCallback(
    (clientX: number, clientY: number): Relationship | null => {
      const canvas = canvasRef.current;
      if (!canvas || !selectedId || followable.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const p = toWorld(clientX - rect.left, clientY - rect.top, camera, viewW, viewH);
      const reach = 8 / camera.zoom;

      for (const relationship of followable) {
        const edge = scene.edges.find((e) => e.id === relationship.edgeId);
        if (!edge) continue;
        if (distanceToSegment(p.x, p.y, edge.x1, edge.y1, edge.x2, edge.y2) > reach) continue;
        // The relationship is already in hand: `followable` came from the authority, and geometry
        // only chose which of ITS lines was pointed at. Re-deriving it here would rebuild the same
        // list and search it for the edge just matched.
        return relationship;
      }
      return null;
    },
    [selectedId, followable, scene, camera, viewW, viewH]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewW === 0 || viewH === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, viewW, viewH);

    const at = (n: { x: number; y: number }) => toScreen(n.x, n.y, camera, viewW, viewH);

    // ── Focus: the selected or hovered object and everything the graph already connects it to.
    // Adjacency is READ from scene.edges. No relationship is inferred; a node is related because an
    // authorized edge says so, or it is not related.
    const related = new Set<string>();
    if (focusId) {
      related.add(focusId);
      // SLICE 9: from `focusRelationships`, which came from the traversal authority. This block used
      // to scan `scene.edges` inline — a second place deciding what is connected to what, which would
      // have made "one relationship source" a claim rather than a fact. Dimming and traversal now
      // agree by construction: what lights up is exactly what can be followed.
      for (const r of focusRelationships) related.add(r.targetId);
    }
    const dimmed = focusId !== null;

    // ── Edges. Containment reads as structure; lateral association reads as a quieter, dashed link.
    // The distinction is READ from `e.containment`, which graph-view/spatial decided once.
    for (const e of scene.edges) {
      const inFocus = !dimmed || (related.has(e.source) && related.has(e.target));
      const a = at({ x: e.x1, y: e.y1 });
      const b = at({ x: e.x2, y: e.y2 });
      g.globalAlpha = e.alpha * (inFocus ? 1 : 1 - 0.85 * emphasis);
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

      g.globalAlpha = inFocus ? (n.emphasis || isSelected ? 1 : 0.85) : 1 - 0.82 * emphasis;
      drawShape(g, n.shape, s.x, s.y, r, n.color);

      // A3: an already-computed health band becomes a ring. taxonomy owns the colour; this draws it.
      if (n.ring && inFocus) {
        g.strokeStyle = n.ring;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(s.x, s.y, r + 2.6, 0, Math.PI * 2);
        g.stroke();
      }
      /**
       * RECENT-EVENT ACKNOWLEDGEMENT — an expanding neutral outline.
       *
       * Deliberately GREY. The palette reserves `accent` for selection, `neural` for graph traffic,
       * and `good`/`risk` for health, so a colour here would have been read as one of those. Grey
       * says only "something happened to this object recently" and cannot be mistaken for urgency,
       * severity, health or importance.
       *
       * The ring is IDENTICAL for every activated object — it never scales with the event's age or
       * with how many events an object had. Only the shared fade changes it, so nothing about the
       * picture ranks one object above another.
       */
      if (activation > 0 && activations.has(n.id)) {
        g.strokeStyle = SEMANTIC.text3;
        g.globalAlpha = activation * 0.9;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(s.x, s.y, r + 4 + (1 - activation) * 10, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      if (isSelected) {
        g.strokeStyle = SEMANTIC.accent;
        g.globalAlpha = emphasis;
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
    const taken = labelBoxes.current;
    taken.length = 0;
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
      const bx1 = s.x - w / 2 - 2;
      const by1 = s.y + r + 4;
      const bx2 = s.x + w / 2 + 2;
      const by2 = s.y + r + 18;
      let clash = false;
      for (let i = 0; i < taken.length; i += 4) {
        if (!(bx2 < taken[i] || bx1 > taken[i + 2] || by2 < taken[i + 1] || by1 > taken[i + 3])) {
          clash = true;
          break;
        }
      }
      if (clash && !isFocused) continue;
      taken.push(bx1, by1, bx2, by2);

      g.fillStyle = isFocused ? SEMANTIC.text1 : SEMANTIC.text2;
      g.fillText(text, s.x, by1);
    }
  }, [scene, camera, viewW, viewH, focusId, hoverId, selectedId, emphasis, byId, focusRelationships, activations, activation]);

  // ── Gestures. Each one reports WHAT HAPPENED and lets GalaxyView decide what the camera becomes.
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { down: true, lastX: e.clientX, lastY: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down) {
      onHover(hit(e.clientX, e.clientY)?.id ?? null);
      return;
    }
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    // A drag of a pixel or two is a shaky click, not a pan. Without this, selecting anything on a
    // trackpad would be luck.
    drag.current = {
      down: true, lastX: e.clientX, lastY: e.clientY,
      moved: d.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2,
    };
    if (drag.current.moved) onPan(dx, dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = { down: false, lastX: 0, lastY: 0, moved: false };
    if (d.moved) return; // A pan is neither a selection nor a traversal.

    // ORDER MATTERS, AND IT IS THE SEMANTIC. An object under the pointer is always a SELECTION —
    // clicking a node never traverses, so selection stays non-destructive and predictable. Only when
    // the pointer is on a relationship LINE of the already-selected object does following happen,
    // which is what makes traversal an explicit act rather than a side effect of clicking about.
    const node = hit(e.clientX, e.clientY);
    if (node) {
      onSelect(node.id);
      return;
    }
    const relationship = edgeUnder(e.clientX, e.clientY);
    if (relationship) {
      onTraverse(relationship);
      return;
    }
    onSelect(null);
  };

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas
        ref={canvasRef}
        // A static `grab` cursor rather than one that flips to `grabbing` mid-drag: the flip would
        // have to read the drag ref during render, which React forbids and which would not update
        // anyway, refs not being reactive. Making it reactive costs a re-render per drag start for a
        // cursor shape, which is not a trade Slice 6 needs to make.
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { drag.current = { down: false, lastX: 0, lastY: 0, moved: false }; onHover(null); }}
        onWheel={(e) => onZoom(e.deltaY < 0 ? 1.12 : 0.89)}
        aria-hidden="true"
      />
    </div>
  );
}

/** Perpendicular distance from a point to a segment. Dot products and one square root — no trig. */
function distanceToSegment(
  px: number, py: number, x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  // A degenerate segment is a point; fall back to point distance rather than dividing by zero.
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.sqrt((px - nx) * (px - nx) + (py - ny) * (py - ny));
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
