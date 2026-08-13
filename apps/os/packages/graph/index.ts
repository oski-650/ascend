// packages/graph — pure navigation-traversal over KnowledgeIndex.{nodes,edges} (Phase 4.4).
//
// A SIBLING of packages/search (DG-4.4.1): both consume the ONE KnowledgeIndex directly; neither
// imports the other. Framework-agnostic, fs-free, deterministic. It answers "what is connected to
// what?" (NAVIGATION connectivity) — never "what matters most?" (that is Decision's PRIORITY ranking,
// KI-3). It imports NO fs / node: / Next / core / engines / app; it lives BELOW engines, so a
// dependency on engines/decision is structurally impossible. It consumes the graph structure the
// FROZEN packages/indexer already produced — it NEVER constructs nodes/edges, never mutates the index,
// never re-reads or re-parses source (KI-1, KI-2, KI-4). Same (index, id) → identical output — no
// clock, no randomness, no hidden state.
//
// GraphNode / GraphEdge remain OWNED by packages/indexer (DG-4.4.3) — imported here, never redefined.

import type { GraphNode, GraphEdge, KnowledgeIndex } from "@/packages/indexer";

// ─── V1 result contracts (graph-owned) ───────────────────────────────────────────────────────────

/** Who links TO a node. `source` is always resolvable: the producer sets every edge's `from` to a node id. */
export type BacklinkResult = { source: GraphNode; edge: GraphEdge };

/** A distinct node connected to the subject (either direction), with the edge(s) reaching it. */
export type NeighborResult = { node: GraphNode; edges: GraphEdge[] };

/**
 * The bounded reachable set from a subject. Contract defined now (DG-4.4.4); the multi-hop `traverse()`
 * implementation is DEFERRED until a real consumer (Canvas / Console) requires depth > 1. V1 exposes
 * only the 1-hop reads below.
 */
export type TraversalResult = { nodes: GraphNode[]; edges: GraphEdge[]; depth: number };

// ─── Internal helpers (pure) ──────────────────────────────────────────────────────────────────────

/** id → node lookup over the existing index nodes. Read-only; constructs nothing in the index. */
function nodeLookup(nodes: readonly GraphNode[]): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

/** Deterministic edge ordering: (from, to, kind) ascending. */
function edgeSort(a: GraphEdge, b: GraphEdge): number {
  return a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind);
}

// ─── Traversal API (pure, deterministic, 1-hop) ───────────────────────────────────────────────────

/**
 * Incoming links: every node that links TO `id`. Filters `index.edges` where `edge.to === id` and
 * resolves each `edge.from` (always a node id) to its GraphNode. Stable order by `source.id` ascending.
 * Backlinks are a graph QUERY, never a producer — no parse, no fs, no index rebuild.
 */
export function backlinks(index: KnowledgeIndex, id: string): BacklinkResult[] {
  const nodes = nodeLookup(index.nodes);
  const results: BacklinkResult[] = [];
  for (const edge of index.edges) {
    if (edge.to !== id) continue;
    const source = nodes.get(edge.from);
    if (!source) continue; // dangling `from` (should not occur) — skip, never fabricate (DG-4.4.2)
    results.push({ source, edge });
  }
  results.sort((a, b) => a.source.id.localeCompare(b.source.id) || edgeSort(a.edge, b.edge));
  return results;
}

/**
 * Outgoing links: the directed edges FROM `id`. Dangling-edge policy (DG-4.4.2): an edge whose `to`
 * resolves to no node is SKIPPED (V1 navigation cannot navigate to a non-node; no placeholder is
 * fabricated). Stable order by target (`to`) then `kind`.
 */
export function outgoing(index: KnowledgeIndex, id: string): GraphEdge[] {
  const nodes = nodeLookup(index.nodes);
  const results: GraphEdge[] = [];
  for (const edge of index.edges) {
    if (edge.from !== id) continue;
    if (!nodes.has(edge.to)) continue; // unresolved target — skip (DG-4.4.2)
    results.push(edge);
  }
  results.sort((a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  return results;
}

/**
 * Neighbors: every distinct node connected to `id` in EITHER direction, deduplicated by node id, each
 * carrying the edge(s) that connect it. Unresolved targets are skipped (DG-4.4.2). Stable order by
 * `node.id` ascending; each result's `edges` are stably ordered too.
 */
export function neighbors(index: KnowledgeIndex, id: string): NeighborResult[] {
  const nodes = nodeLookup(index.nodes);
  const byNeighbor = new Map<string, GraphEdge[]>();

  for (const edge of index.edges) {
    let neighborId: string | null = null;
    if (edge.from === id) neighborId = edge.to;
    else if (edge.to === id) neighborId = edge.from;
    if (neighborId === null) continue;
    if (!nodes.has(neighborId)) continue; // unresolved neighbor — skip (DG-4.4.2)
    const bucket = byNeighbor.get(neighborId);
    if (bucket) bucket.push(edge);
    else byNeighbor.set(neighborId, [edge]);
  }

  const results: NeighborResult[] = [];
  for (const [neighborId, edges] of byNeighbor) {
    const node = nodes.get(neighborId);
    if (!node) continue; // guarded above; defensive
    results.push({ node, edges: [...edges].sort(edgeSort) });
  }
  results.sort((a, b) => a.node.id.localeCompare(b.node.id));
  return results;
}
