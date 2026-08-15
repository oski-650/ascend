// graph-view/contract — the PERMANENT graph seam (see docs/GRAPH-CONTRACT.md).
//
// This is the ONLY module the Neural Core renderer imports for its data shape. It is pure TYPES:
// no fs, no React, no Next, no rendering concerns, no coordinates, no colors.
//
// The absence of layout/visual fields is load-bearing. `x`/`y`, radius, color, opacity, and pulse
// timing are ALL computed inside the renderer from `type`, `weight`, and `state`. That is what makes
// the data producer swappable: today a presentation projection (graph-view/projection), later the
// real KnowledgeIndex, with no change to a single line of UI.
//
// PERMANENT. Unlike graph-view/projection.ts, this file is not scheduled for retirement.

import type { EntityKind } from "@/domain";

/** What kind of business object a node stands for. Presentation maps this to visual identity. */
export type GraphNodeType =
  | "client"
  | "project"
  | "phase"
  | "task"
  | "prospect"
  | "invoice"
  | "document"
  | "approval"
  | "audit"
  | "care_plan"
  | "opportunity"
  | "sop";

/**
 * The same list as a runtime value, so callers can ask whether an EntityKind is representable in
 * the graph at all. `EntityKind` has 25 members; only these 12 become nodes.
 */
export const GRAPH_NODE_TYPES = [
  "client",
  "project",
  "phase",
  "task",
  "prospect",
  "invoice",
  "document",
  "approval",
  "audit",
  "care_plan",
  "opportunity",
  "sop",
] as const satisfies readonly GraphNodeType[];

const GRAPH_NODE_TYPE_SET = new Set<string>(GRAPH_NODE_TYPES);

/**
 * The GraphNode.id an entity would have, or `null` when that EntityKind is not representable in the
 * graph (`time_entry`, `payment`, `notification`, `organization`, …).
 *
 * WHY THIS LIVES HERE. `GraphNode.id` is defined three lines below as `${type}:${entityId}`; this is
 * that definition made callable. Four surfaces were hand-building the string inline, which meant the
 * id format was duplicated in four places and none of them could tell whether an entity was
 * focusable — so the Signals page happily emitted `/?focus=…` for kinds the graph cannot contain.
 *
 * It is NOT a second routing owner: `navigation/routing` owns entity → ROUTE and is untouched. This
 * owns only graph IDENTITY, which is exactly what this contract already documents. When the real
 * KnowledgeIndex replaces graph-view/projection, this function moves with the contract, unchanged.
 *
 * A non-null result means "this KIND can be a node", not "this node exists right now" — a client
 * with no vault folder still yields an id. The Neural Core validates the id against the live model
 * server-side and simply renders unfocused if it is absent, which is the honest fallback.
 */
export function graphNodeIdFor(entity: EntityKind, entityId: string): string | null {
  if (!entityId || !GRAPH_NODE_TYPE_SET.has(entity)) return null;
  return `${entity}:${entityId}`;
}

/** The Neural Core href that arrives with `entity` pre-selected, or `null` if it cannot be focused. */
export function focusHrefFor(entity: EntityKind, entityId: string): string | null {
  const id = graphNodeIdFor(entity, entityId);
  return id ? `/?focus=${encodeURIComponent(id)}` : null;
}

/** What kind of real relationship an edge stands for. Every value is a foreign key that exists on disk. */
export type GraphEdgeType =
  | "has_project"
  | "has_phase"
  | "has_task"
  | "billed"
  | "owns_document"
  | "supersedes"
  | "awaits_approval"
  | "measured_by"
  | "subscribes"
  | "promoted_to"
  | "flags"
  | "wikilink";

/**
 * A presentation-neutral summary of a condition its OWNER already computed. The projection copies
 * these from the owning read-model; it never derives them.
 *
 * `null` means "this dimension does not apply to this node type" — never "zero".
 */
export type GraphNodeState = {
  /** Health band, copied from HealthScore.tier. Owner: engines/health-engine. */
  health: "healthy" | "on_track" | "at_risk" | null;
  /** A lifecycle word already owned by a domain deriver (deriveInvoiceStatus, DocumentStatus, …). */
  status: string | null;
  /** True when an owner has flagged this object as needing attention (overdue, at_risk, urgent). */
  attention: boolean;
};

export type GraphNode = {
  /** `${type}:${entityId}` — globally unique and stable across rebuilds. */
  id: string;
  type: GraphNodeType;
  /** Human-readable. Never a slug when a real name exists. */
  label: string;
  /** The id in ITS OWN namespace (slug or record id) — what routing and event subjects resolve against. */
  entityId: string;
  /** The domain EntityKind this node projects, so an EventSubject can resolve to it. */
  entity: EntityKind;
  /**
   * Relative structural importance, 0–1. NOT a business metric and NOT a ranking — it is a rendering
   * hint for node radius, derived from structural position (a client outranks one of its checklist
   * tasks). Deliberately NOT sourced from Decision.priorityScore: ranking stays owned by the engine.
   */
  weight: number;
  state: GraphNodeState;
  /** Opaque display pairs for the context panel. Presentation copies these; it never computes them. */
  meta: { label: string; value: string }[];
};

export type GraphEdge = {
  /** `${type}:${source}->${target}`. */
  id: string;
  type: GraphEdgeType;
  /** GraphNode.id */
  source: string;
  /** GraphNode.id */
  target: string;
};

/**
 * REAL business activity. Ambient graph motion never appears here — it is generated in the renderer
 * and is structurally incapable of producing a GraphActivity. Every entry originates from a real
 * EventEnvelope read via core/events.
 */
export type GraphActivity = {
  /** EventEnvelope.event_id */
  id: string;
  /** EventEnvelope.type, e.g. "invoice.paid" */
  eventType: string;
  /** ISO timestamp */
  occurredAt: string;
  /** The node the event landed on. Events resolving to no node are DROPPED, never fabricated. */
  nodeId: string;
  /** Human sentence for the activity ticker and the aria-live region. */
  summary: string;
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activity: GraphActivity[];
  /** Provenance — rendered in the status line so the operator always knows what they are looking at. */
  source: { name: string; builtAt: string; nodeCount: number; edgeCount: number };
};

/** The seam. graph-view/projection is one implementation; the future indexer source will be another. */
export type GraphSource = () => Promise<GraphModel>;

/** Empty model — the honest representation of "nothing to show", never a fabricated placeholder. */
export const EMPTY_GRAPH: GraphModel = {
  nodes: [],
  edges: [],
  activity: [],
  source: { name: "empty", builtAt: "", nodeCount: 0, edgeCount: 0 },
};