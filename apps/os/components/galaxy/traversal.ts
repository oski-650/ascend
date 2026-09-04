// components/galaxy/traversal — FOLLOWING A RELATIONSHIP (Slice 9).
//
// One authority for the question "what can I reach from here, and how". Both surfaces call it: the
// canvas when an operator clicks a relationship, the accessible list when they activate one with the
// keyboard. Neither derives its own answer, so the two cannot disagree about what is connected.
//
// PURE: no React, no canvas, no DOM, no clock, no I/O. It takes ids and edges and returns ids.
//
// ─── IT INFERS NOTHING ─────────────────────────────────────────────────────────────────────────
//
// Everything here comes from `SceneEdge`, which carried it down from `SpatialEdge`, which took it
// from `relationships/` — foreign keys an operator actually stored. This layer reads `source`,
// `target`, `kind` and `containment` and computes none of them.
//
// It cannot do otherwise: it READS no label, coordinate, radius or type, so a neighbour cannot be
// guessed from resemblance, from being drawn nearby, or from an id that looks similar. `SceneEdge`
// structurally carries `x1`–`y2` — the whole edge is passed in — but no line below touches them, and
// F65 fails the build if one ever does. "Cannot see" would have been the easier sentence and the
// false one. And it never splits `${type}:${entityId}` — an id is an opaque key here, compared and
// passed on but never parsed. Business identity is not recoverable from a formatted string.
//
// ─── DIRECTION IS PRESERVED, NEVER NORMALISED ──────────────────────────────────────────────────
//
// An edge is stored source → target. From the source, the relationship reads forward; from the
// target, it reads backward. Both are offered — you may walk a relationship either way — but the
// STORED direction is reported alongside so a surface can say "has project" in one direction and
// "is the has project of" in the other. Flattening both into "related to" would discard a fact the
// projection took care to keep.
//
// ─── A TARGET MUST BE ON SCREEN ────────────────────────────────────────────────────────────────
//
// `present` is the set of ids the SCENE contains. An edge whose far endpoint is not in it — dropped
// as dangling, or hidden by the detail level — yields no relationship at all. The renderer does not
// reach past the scene to recover it, does not bypass the detail level, and does not fabricate a
// node to arrive at. It is the same "drop, never fabricate" rule every layer below already applies.

import type { SceneEdge } from "./scene";

/** One relationship an operator may follow from a given object. */
export type Relationship = {
  /** SceneEdge.id — the relationship this came from, so a traversal can be traced to its edge. */
  edgeId: string;
  /** The relationship kind, copied. Surfaces map it to wording through taxonomy's EDGE_VISUAL. */
  kind: SceneEdge["kind"];
  /** The object at the other end. Guaranteed to be present in the scene. */
  targetId: string;
  /** True when the object we are standing on is the edge's SOURCE — i.e. the stored direction. */
  outgoing: boolean;
  /** Whether this relationship asserts containment. Copied from SceneEdge; never re-decided. */
  containment: boolean;
};

/**
 * Every relationship reachable from `nodeId`, in the scene's own edge order.
 *
 * Total and deterministic. Returns an empty list when the object itself is not in the scene, so a
 * stale selection cannot open a path into objects that are no longer drawn.
 */
export function relationshipsOf(
  nodeId: string,
  edges: readonly SceneEdge[],
  present: ReadonlySet<string>
): Relationship[] {
  if (!present.has(nodeId)) return [];

  const out: Relationship[] = [];
  for (const edge of edges) {
    const outgoing = edge.source === nodeId;
    const incoming = edge.target === nodeId;
    if (!outgoing && !incoming) continue;

    const targetId = outgoing ? edge.target : edge.source;
    if (!present.has(targetId)) continue;

    out.push({
      edgeId: edge.id,
      kind: edge.kind,
      targetId,
      outgoing,
      containment: edge.containment,
    });
  }
  return out;
}

// `relationshipAlong(nodeId, edgeId, …)` USED TO LIVE HERE and has been removed.
//
// Its only caller already held the relationship it returned: the canvas builds the selected object's
// relationship list once, finds which of THOSE lines the pointer is on, and therefore has the answer
// in hand. Calling this rebuilt the identical list and searched it for the edge it had just matched
// — a provable round trip to the same object.
//
// It was not kept as a "seam": `relationshipsOf(...).find(r => r.edgeId === id)` is what it was, one
// expression any caller can write, and an exported function whose sole production use is redundant
// is API that has to be maintained and explained for no property it protects. The property it was
// tested for — that an edge which does not touch an object, or leads out of the scene, offers no
// traversal — is asserted directly against `relationshipsOf`, which is where it actually lives.
