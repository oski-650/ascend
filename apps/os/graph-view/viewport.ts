// graph-view/viewport — framing the graph, and deciding when a frame must be painted.
//
// PURE + framework-free: no React, no DOM, no canvas, no I/O. GraphCanvas owns the camera object
// and the render loop; this module owns the arithmetic behind them, so both are testable without a
// browser. It holds no state (F17 forbids module-level mutable state here).
//
// Two concerns live together because both answer "what does the operator actually see":
//   FIT    — what camera frames the whole graph inside the region the panels leave free
//   FRAME  — whether the next animation frame may be skipped

import type { DetailLevel } from "./taxonomy";

/** World-space bounding box of the laid-out graph, radii included. */
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Screen-space margins the graph must stay clear of, in CSS pixels. */
export type Insets = { left: number; right: number; top: number; bottom: number };

export type FitCamera = { x: number; y: number; zoom: number };

/**
 * Zoom floor for a FIT operation.
 *
 * Deliberately far below the manual floor. `MIN_ZOOM` exists to stop the operator wheeling the
 * graph into an unreadable speck; applying it to `fitView` made the fit arithmetic compute the
 * zoom it needed and then refuse to adopt it — pressing "Fit" left most of the graph off-screen.
 * A fit is a computed answer, not a gesture, so its only floor is one that avoids a degenerate
 * camera. See tests/graph/viewport.test.ts.
 */
export const FIT_MIN_ZOOM = 0.02;

/** Breathing room so the outermost nodes are not flush against the reserved region. */
export const FIT_MARGIN = 0.94;

/**
 * Panel geometry, measured from the rendered markup rather than guessed.
 *
 *   attention panel — NeuralCore: `lg:left-7` (28px) + `w-[290px]`  = 318, +12 breathing room
 *   context panel   — NeuralCore: `lg:right-7` (28px) + `w-[340px]` = 368, +12 breathing room
 *
 * Both are `lg:`-gated. Below that breakpoint the context panel spans `inset-x-4` — nearly the full
 * width — so there is no column to reserve and the graph simply uses the whole canvas.
 */
export const PANEL_BREAKPOINT = 1024;
const ATTENTION_PANEL_W = 330;
const CONTEXT_PANEL_W = 380;
const EDGE_GUTTER = 24;
/** Header and footer overlay the canvas top and bottom. */
const CHROME_V = 130;

/**
 * The region left free by the surrounding chrome.
 *
 * `hasContextPanel` is what the previous hardcoded `insetRight: 24` ignored: the code's own comment
 * claimed to reserve "the columns the attention panel and the context panel occupy", but only the
 * attention panel was ever subtracted, so with a node selected the fit framed the graph into a
 * region whose right ~344px sat underneath the context panel.
 */
export function fitInsets(viewW: number, hasContextPanel: boolean): Insets {
  const wide = viewW >= PANEL_BREAKPOINT;
  return {
    left: wide ? ATTENTION_PANEL_W : EDGE_GUTTER,
    right: wide && hasContextPanel ? CONTEXT_PANEL_W : EDGE_GUTTER,
    top: CHROME_V,
    bottom: CHROME_V,
  };
}

/**
 * The camera that frames `bounds` inside the free region.
 *
 * The focal point is offset by half the inset asymmetry so the graph's centre lands in the middle
 * of the AVAILABLE space rather than the middle of the canvas. The margin is applied BEFORE the
 * clamp, so `FIT_MIN_ZOOM` is a true floor — previously the 0.94 was applied afterwards and could
 * carry the result back under the floor it had just been clamped to.
 */
export function computeFitCamera(
  bounds: Bounds,
  viewW: number,
  viewH: number,
  insets: Insets,
  maxZoom: number
): FitCamera {
  const availW = Math.max(200, viewW - insets.left - insets.right);
  const availH = Math.max(200, viewH - insets.top - insets.bottom);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);

  const raw = Math.min(availW / spanX, availH / spanY) * FIT_MARGIN;
  const zoom = Math.min(maxZoom, Math.max(FIT_MIN_ZOOM, raw));

  return {
    x: (bounds.minX + bounds.maxX) / 2 - (insets.left - insets.right) / 2 / zoom,
    y: (bounds.minY + bounds.maxY) / 2 - (insets.top - insets.bottom) / 2 / zoom,
    zoom,
  };
}

/** Screen-space projection of a world point, mirroring GraphCanvas's canvas transform exactly. */
export function toScreen(
  wx: number,
  wy: number,
  cam: FitCamera,
  viewW: number,
  viewH: number
): { x: number; y: number } {
  return {
    x: (wx - cam.x) * cam.zoom + viewW / 2,
    y: (wy - cam.y) * cam.zoom + viewH / 2,
  };
}

/**
 * The world point under a screen point — the exact inverse of `toScreen`.
 *
 * WHY IT EXISTS. `toScreen` has been exported since the beginning and its inverse has not, so every
 * caller that needed to answer "what is under the pointer" rolled its own. GraphCanvas computes it
 * inline; components/galaxy avoided it by projecting EVERY node forward and comparing distances,
 * which is correct but O(n) per pointer event and does not survive a movable camera. One exported
 * inverse removes both workarounds and keeps the projection defined in exactly one place — if the
 * transform ever changes, the two functions move together or the round-trip witness fails.
 *
 * `sx`/`sy` are CSS pixels relative to the canvas's top-left, the same space `toScreen` returns.
 */
export function toWorld(
  sx: number,
  sy: number,
  cam: FitCamera,
  viewW: number,
  viewH: number
): { x: number; y: number } {
  return {
    x: (sx - viewW / 2) / cam.zoom + cam.x,
    y: (sy - viewH / 2) / cam.zoom + cam.y,
  };
}

/**
 * One step of an exponential approach from `from` toward `to`.
 *
 * PURE AND STATELESS. It holds no clock, schedules nothing, and knows nothing about frames — a
 * caller decides when to step and when to stop. That is what keeps the easing testable without a
 * browser and keeps this module free of the render loop that consumes it.
 *
 * `k` is the fraction of the remaining distance covered per step, so the motion decelerates into its
 * target rather than arriving at constant speed. Zoom is interpolated in the same pass because a
 * camera that translated and scaled on different schedules reads as two separate movements.
 *
 * It never REACHES the target — an exponential approach is asymptotic — which is why `cameraSettled`
 * exists beside it. A loop that waited for exact equality would run forever.
 */
export function easeCamera(from: FitCamera, to: FitCamera, k: number): FitCamera {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    zoom: from.zoom + (to.zoom - from.zoom) * k,
  };
}

/**
 * Whether two cameras are close enough that the difference cannot be seen.
 *
 * The termination condition for an eased transition, and the reason a demand-driven loop can stop
 * rather than idling. The position tolerance is in WORLD units and is therefore scaled by zoom: half
 * a world unit is invisible when zoomed out and obvious when zoomed in, so a fixed world tolerance
 * would either stop too early up close or run too long far away.
 */
export function cameraSettled(a: FitCamera, b: FitCamera, epsilonPx = 0.5): boolean {
  const zoom = Math.max(a.zoom, b.zoom);
  return (
    Math.abs(a.x - b.x) * zoom < epsilonPx &&
    Math.abs(a.y - b.y) * zoom < epsilonPx &&
    Math.abs(a.zoom - b.zoom) < 0.001
  );
}

/**
 * Whether the render loop may skip this frame entirely.
 *
 * THE DEFECT THIS FIXES. The idle short-circuit required `reducedMotion`, and once the layout had
 * cooled and one frame had painted it returned before `draw()` forever. Camera mutations are plain
 * writes to a ref, so "Fit" and wheel-zoom changed the camera and NOTHING REPAINTED — under
 * `prefers-reduced-motion` those controls appeared completely dead. Dragging worked only because it
 * happens to set `pointerDown`.
 *
 * `dirty` is the fix: reduced motion must suppress ANIMATION, never RENDERING. Any code that moves
 * the camera marks the canvas dirty, and exactly one more frame is painted — no easing, no loop.
 */
export function shouldSkipFrame(s: {
  cooled: boolean;
  pulseCount: number;
  pointerDown: boolean;
  reducedMotion: boolean;
  painted: boolean;
  dirty: boolean;
}): boolean {
  const idle = s.cooled && s.pulseCount === 0 && !s.pointerDown && s.reducedMotion;
  return idle && s.painted && !s.dirty;
}

export type { DetailLevel };