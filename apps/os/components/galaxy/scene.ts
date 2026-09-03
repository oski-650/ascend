// components/galaxy/scene — THE RENDERER'S DRAW MODEL (Renderer Slice 4).
//
//     GraphProjection → SpatialModel → GalaxyLayout → **Renderer**
//
// This is the renderer's whole decision-making half, extracted from the canvas so it is a VALUE that
// can be asserted on. `GalaxyCanvas` paints what this returns and decides nothing. That split is
// what lets Slice 4's witnesses be behavioural instead of a source scan: "every LayoutNode is drawn
// exactly once" is a statement about an array here, not about pixels nobody can inspect.
//
// PURE + framework-free: no React, no DOM, no canvas, no Three.js. Slice 4 is Canvas 2D by decision
// (A1); nothing here is 2D-specific except that it carries no z.
//
// ─── WHERE EVERY VALUE COMES FROM, AND WHAT THIS LAYER IS FORBIDDEN TO DO ──────────────────────
//
//   x, y          COPIED from LayoutNode. **Never computed.** This file does not contain a
//                 trigonometric function and never reads `orbitRadius` or `orbitPhase` — if it
//                 recomputed a position from those, the renderer would have become a second layout
//                 authority and GalaxyLayout's determinism would stop being the thing on screen.
//                 F65 bans the vocabulary outright, with a control proving the matcher fires.
//   radius        COPIED from SpatialNode.size, which taxonomy.nodeRadius already owns.
//   colour/shape  taxonomy's NODE_VISUAL and EDGE_VISUAL, keyed by contract vocabulary.
//   label         the projection's own label, through taxonomy.displayLabel.
//   ring/emphasis the A3 encoding — see below.
//   edges         SpatialModel.edges ONLY, which came from the projection's edges. No relationship
//                 is inferred, reconstructed or invented here; an edge whose endpoints are not both
//                 present is dropped, never repaired.
//
// ─── THE A3 RULE, WHICH IS THE ONE WITH A CONSEQUENCE ──────────────────────────────────────────
//
// The renderer MAY consume already-projected `state` and `weight` to decide HOW AN AUTHORIZED FACT
// LOOKS. It may NOT decide WHAT BUSINESS FACT SOMETHING IMPLIES.
//
// So `ring` is `healthColor(state.health)` — taxonomy's existing map from a band an engine already
// computed — and `emphasis` is `state.attention`, a boolean an owner already set. Neither derives
// anything. What would breach the rule is a threshold: `weight >= 0.68 ? "important" : …` invents a
// classification the business never made, and `state.status === "overdue" && amount > X` invents a
// judgment. **No comparison against a business value appears in this file**, and that is the form
// the rule takes: this layer maps values it was given, and computes none.
//
// ─── LEVEL OF DETAIL IS PRESENTATION, NOT SCOPE ────────────────────────────────────────────────
//
// `detail` filters by TYPE through taxonomy's `isVisibleAt`. Authorization happened far upstream —
// the projection handed to this function is already scoped to its principal — so hiding a task at
// the `core` level narrows what is DRAWN and never what is PERMITTED. This layer receives no
// principal, no role and no capability, and could not scope anything if it tried. That is why LOD
// here does not contradict the GraphProjection contract's rule against downstream filtering, and
// §2.8 now records the same reasoning.

import type { GraphNodeType, GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import {
  EDGE_VISUAL,
  NODE_VISUAL,
  displayLabel,
  healthColor,
  isVisibleAt,
  type DetailLevel,
  type NodeShape,
} from "@/graph-view/taxonomy";

/** One object to draw. Every field is copied or mapped; none is derived. */
export type SceneNode = {
  id: string;
  /** World X, copied verbatim from LayoutNode.x. */
  x: number;
  /** World Y, copied verbatim from LayoutNode.y. */
  y: number;
  /** World-unit radius, copied verbatim from SpatialNode.size. */
  radius: number;
  visualType: GraphNodeType;
  color: string;
  shape: NodeShape;
  glyph: string;
  label: string;
  /** A3: how an already-computed health band LOOKS. `null` when the dimension does not apply. */
  ring: string | null;
  /** A3: an owner already flagged this object. The renderer draws it louder; it decides nothing. */
  emphasis: boolean;
};

/** One relationship to draw, with both endpoints resolved to positions the layout produced. */
export type SceneEdge = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  alpha: number;
};

/**
 * The bounding box of what will be drawn, in world units.
 *
 * The INPUT to `graph-view/viewport.computeFitCamera`, not a camera. Framing stays viewport's
 * property (D4); this reports extents the same way GraphCanvas already does inline.
 */
export type SceneBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type Scene = {
  nodes: SceneNode[];
  edges: SceneEdge[];
  bounds: SceneBounds;
};

export type SceneInput = {
  /** Already authorized and already scoped. The renderer receives it; it never fetches it. */
  projection: GraphProjection;
  spatial: SpatialModel;
  layout: LayoutModel;
  detail: DetailLevel;
};

const EMPTY_BOUNDS: SceneBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Build the draw model. Pure, total and deterministic: the same input yields the same scene.
 *
 * Nodes are emitted for LAYOUT nodes that survive the detail filter, so a scene can never contain
 * an object the layout did not place — the renderer has no way to invent one.
 */
export function buildScene({ projection, spatial, layout, detail }: SceneInput): Scene {
  const spatialById = new Map(spatial.nodes.map((n) => [n.id, n]));
  const projectionById = new Map(projection.nodes.map((n) => [n.id, n]));

  const nodes: SceneNode[] = [];
  for (const placed of layout.nodes) {
    const identity = spatialById.get(placed.id);
    const fact = projectionById.get(placed.id);
    // A node the upstream layers do not both describe is DROPPED, never filled in with defaults.
    // Fabricating an object here would put something on screen that no authorized reader produced.
    if (!identity || !fact) continue;
    if (!isVisibleAt(identity.visualType, detail)) continue;

    const visual = NODE_VISUAL[identity.visualType];
    nodes.push({
      id: placed.id,
      x: placed.x,
      y: placed.y,
      radius: identity.size,
      visualType: identity.visualType,
      color: visual.color,
      shape: visual.shape,
      glyph: visual.glyph,
      label: displayLabel(fact.label),
      ring: healthColor(fact.state.health),
      emphasis: fact.state.attention,
    });
  }

  const drawn = new Map(nodes.map((n) => [n.id, n]));

  // Edges come from SpatialModel and nowhere else, and survive only when BOTH endpoints are drawn.
  // That is the same rule the detail filter has always used, and it is what stops LOD from implying
  // a relationship between two objects that are no longer both on screen.
  const edges: SceneEdge[] = [];
  for (const link of spatial.edges) {
    const a = drawn.get(link.source);
    const b = drawn.get(link.target);
    if (!a || !b) continue;
    const visual = EDGE_VISUAL[link.kind];
    edges.push({ id: link.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: visual.width, alpha: visual.alpha });
  }

  return { nodes, edges, bounds: boundsOf(nodes) };
}

/** Extents of the drawn objects, including their radii. Min/max only — no framing decision. */
function boundsOf(nodes: readonly SceneNode[]): SceneBounds {
  if (nodes.length === 0) return EMPTY_BOUNDS;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x - n.radius < minX) minX = n.x - n.radius;
    if (n.y - n.radius < minY) minY = n.y - n.radius;
    if (n.x + n.radius > maxX) maxX = n.x + n.radius;
    if (n.y + n.radius > maxY) maxY = n.y + n.radius;
  }
  return { minX, minY, maxX, maxY };
}
