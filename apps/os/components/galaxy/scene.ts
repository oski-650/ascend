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

import type { EntityKind } from "@/domain";
import type { GraphEdgeType, GraphNodeType, GraphProjection } from "@/graph-view/contract";
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
  /**
   * World Z, copied verbatim from LayoutNode.z.
   *
   * Depth, carried for the same reason x and y are: GalaxyLayout decided it and this layer does not
   * recompute it. The 2D canvas ignores it today; the layer that produces it does not care who reads
   * it, which is exactly the property that let the pipeline gain a dimension without a rewrite.
   */
  z: number;
  /** World-unit radius, copied verbatim from SpatialNode.size. */
  radius: number;
  visualType: GraphNodeType;
  /**
   * The domain kind this object projects, copied from GraphNode.
   *
   * CARRIED, NEVER PARSED. `SceneNode.id` is formatted `${type}:${entityId}`, and it would be one
   * line to split it — which is exactly why it must not be done. That format is a convention, not an
   * API: an `entityId` may itself contain a colon, and a business identity recovered from a display
   * string is a guess that happens to work until it doesn't. The projection knows both parts; they
   * travel as fields.
   */
  entity: EntityKind;
  /** The id in its own namespace — a slug or record id — copied from GraphNode. Never parsed out. */
  entityId: string;
  color: string;
  shape: NodeShape;
  glyph: string;
  label: string;
  /**
   * The health band itself, copied from GraphNodeState. `null` means the dimension does not apply.
   *
   * Carried ALONGSIDE `ring` rather than instead of it, because the two surfaces need different
   * things from one fact: the canvas needs a colour, and a non-visual surface needs the WORD. A list
   * that had to reverse a hex value back into a meaning would be inventing one. Copied, never
   * derived — the mapping to colour stays taxonomy's.
   */
  health: "healthy" | "on_track" | "at_risk" | null;
  /** A3: how an already-computed health band LOOKS. `null` when the dimension does not apply. */
  ring: string | null;
  /** A3: an owner already flagged this object. The renderer draws it louder; it decides nothing. */
  emphasis: boolean;
  /**
   * The projection's display pairs, carried VERBATIM.
   *
   * `GraphNode.meta`'s own contract reads: "Opaque display pairs for the context panel. Presentation
   * copies these; it never computes them." This field is that instruction obeyed — the strings were
   * composed by the owners that know what they mean (`${amount}` by core/finance, `${progress}%` by
   * core/production, `${score}/${max} · ${tier}` by the prospect scorer), and a surface that
   * reformatted them would be re-deciding a presentation its owner already made.
   *
   * ORDER IS PART OF THE VALUE. An audit lists Performance, SEO, Accessibility in that order because
   * its owner chose it; sorting them alphabetically would be the renderer asserting a ranking nobody
   * stated. Nothing here sorts, filters, truncates or normalises, and F65 keeps it that way.
   *
   * These are OPAQUE. This layer does not know that "Severity" is an engine judgment and "Amount" is
   * a stored figure, and it must not learn: styling a pair by its label or its value would turn a
   * faithful copy into an interpretation.
   */
  meta: { label: string; value: string }[];
};

/** One relationship to draw, with both endpoints resolved to positions the layout produced. */
export type SceneEdge = {
  id: string;
  /** The relationship's kind, copied from SpatialEdge — so no surface has to infer one from an id. */
  kind: GraphEdgeType;
  /** SceneNode.id of the SOURCE. Carried so a surface can name the relationship, not just draw it. */
  source: string;
  /** SceneNode.id of the TARGET. Source → target is the direction the projection stored. */
  target: string;
  /**
   * Whether this relationship asserts containment, copied from SpatialEdge.
   *
   * ADDED IN SLICE 5 and purely additive: the judgment was made once, in graph-view/spatial, from
   * the `has_*` family. Carrying it here lets a surface draw containment differently from lateral
   * association WITHOUT re-deciding which is which — the renderer reads the flag, it does not
   * classify edges.
   */
  containment: boolean;
  x1: number;
  y1: number;
  /** Source Z. Carried so an endpoint never disagrees in dimension with the node it belongs to. */
  z1: number;
  x2: number;
  y2: number;
  /** Target Z. */
  z2: number;
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
  /**
   * SceneNode ids in the order a surface should give them attention — labels drawn first, list
   * entries read first. Largest first, ties broken by id so it is total and stable.
   *
   * ORDERING, NOT CLASSIFICATION. The legacy GraphCanvas gates labels on `weight >= 0.68`, a float
   * threshold whose comment reads "client · project · prospect" — an undeclared classification that
   * will mean something else the moment `weight` is retuned. This carries no threshold and invents
   * no category: it sorts by `size`, which taxonomy.nodeRadius already owns, and lets the DETAIL
   * LEVEL decide what is visible at all. F65 forbids a numeric comparison against a business value
   * anywhere in this directory, so the threshold cannot come back by reflex.
   */
  labelOrder: string[];
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
      z: placed.z,
      radius: identity.size,
      visualType: identity.visualType,
      entity: fact.entity,
      entityId: fact.entityId,
      color: visual.color,
      shape: visual.shape,
      glyph: visual.glyph,
      label: displayLabel(fact.label),
      health: fact.state.health,
      ring: healthColor(fact.state.health),
      emphasis: fact.state.attention,
      meta: fact.meta,
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
    edges.push({
      id: link.id,
      kind: link.kind,
      source: link.source,
      target: link.target,
      containment: link.containment,
      x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z,
      width: visual.width, alpha: visual.alpha,
    });
  }

  const labelOrder = nodes
    .slice()
    .sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id))
    .map((n) => n.id);

  return { nodes, edges, bounds: boundsOf(nodes), labelOrder };
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
