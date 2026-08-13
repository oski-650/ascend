// packages/indexer — Knowledge INDEX CONTRACTS (Phase 4.1). TYPES ONLY — no traversal, no build logic.
//
// Establishes the single-index (KI-1) + single-traversal (KI-4) architecture as a CONTRIBUTOR PIPELINE:
//   one filesystem walk (core/vault) → one markdown parse (packages/markdown) → each parsed object is
//   handed to every registered contributor EXACTLY ONCE → one unified index.
// Contributors never traverse, re-read, or re-parse (KI-4). The index is a rebuildable cache, never
// truth (KI-2), and holds navigation, not intelligence (KI-3). The pipeline is implemented in Phase 4.2;
// this file defines only the SHAPE.
//
// Purity: imports ONLY the domain kernel — no fs, no Next, no core / engine / app code.

import type { EntityKind, EventEnvelope } from "@/domain";

/**
 * One source object — discovered by `core/vault` and parsed ONCE by `packages/markdown` — handed to
 * every contributor during the single traversal (KI-4). Contributors read this; they never re-read source.
 */
export type ParsedObject = {
  sourcePath: string;
  entity: EntityKind;
  id: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  wikilinks: string[];
};

// ─── Index artifact shapes (produced by contributors; consumed by Search / Graph / Console) ──────────

/** Registry: the canonical record that an object exists and is discoverable (KI-1). */
export type RegistryEntry = { id: string; entity: EntityKind; title: string; sourcePath: string };

/** Search document: text a search contributor produced for an object. */
export type SearchDocument = { id: string; entity: EntityKind; title: string; text: string };

/** Graph node / edge: produced by a graph contributor. Edge `kind` ∈ wikilink | structural | event. */
export type GraphNode = { id: string; entity: EntityKind; title: string };
export type GraphEdge = { from: string; to: string; kind: string };

/** The single unified index every consumer reads (KI-1). Rebuildable cache, never truth (KI-2). */
export type KnowledgeIndex = {
  registry: RegistryEntry[];
  search: SearchDocument[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Timeline/event history is NOT rebuilt here — it is owned by core/events (the single event reader).
  // Consumers reference events via core/events; the index never reconstructs timeline from markdown.
};

/** The index under construction — contributors append to it during the single traversal. */
export type MutableKnowledgeIndex = {
  registry: RegistryEntry[];
  search: SearchDocument[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/**
 * A contributor consumes each `ParsedObject` exactly once (KI-4) and appends to the index under
 * construction. It MUST NOT perform its own traversal, filesystem read, or re-parse. Concrete
 * contributors (registry, search, graph, future command-registry, future AI) arrive in Phase 4.2.
 */
export type IndexContributor = {
  readonly name: string;
  contribute(object: ParsedObject, index: MutableKnowledgeIndex): void;
};

/**
 * The pipeline contract (KI-1 + KI-4). Implemented in Phase 4.2:
 *   core/vault walk → packages/markdown parse → for each object, run every contributor → one KnowledgeIndex.
 * Defined here as a TYPE only — there is no `build()` implementation in Phase 4.1.
 */
export type IndexPipeline = {
  readonly contributors: readonly IndexContributor[];
  // build(objects: readonly ParsedObject[]): KnowledgeIndex  — implemented below in Phase 4.2.
};

// ─── Phase 4.2 — the single index PRODUCER (KI-1) + built-in contributors ─────────────────────────

/** Searchable text for an object: title + string frontmatter values + body. Pure. */
function searchText(o: ParsedObject): string {
  const fm = Object.values(o.frontmatter)
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return `${o.title} ${fm} ${o.body}`.replace(/\s+/g, " ").trim();
}

/** Registry contributor — records that an object exists and is discoverable. */
const registryContributor: IndexContributor = {
  name: "registry",
  contribute(o, index) {
    index.registry.push({ id: o.id, entity: o.entity, title: o.title, sourcePath: o.sourcePath });
  },
};

/** Search-document contributor — one searchable document per object. */
const searchContributor: IndexContributor = {
  name: "search",
  contribute(o, index) {
    index.search.push({ id: o.id, entity: o.entity, title: o.title, text: searchText(o) });
  },
};

/** Graph contributor — one node per object + one edge per wikilink. (Structural edges are additive later.) */
const graphContributor: IndexContributor = {
  name: "graph",
  contribute(o, index) {
    index.nodes.push({ id: o.id, entity: o.entity, title: o.title });
    for (const target of o.wikilinks) {
      index.edges.push({ from: o.id, to: target, kind: "wikilink" });
    }
  },
};

/** Fixed contributor registration order — load-bearing for deterministic output. */
const CONTRIBUTORS: readonly IndexContributor[] = [registryContributor, searchContributor, graphContributor];

/**
 * The single KnowledgeIndex producer (KI-1). PURE: `(objects, events) → KnowledgeIndex`. One pass over
 * the objects (KI-4) — each object handed to every contributor exactly once, in fixed order. No fs, no
 * parse, no clock, no randomness, no hidden state → deterministic and rebuildable (KI-2).
 *
 * `events` are read once by the caller (core/events) and passed here as the reserved LINKAGE POINT;
 * V1 does NOT derive graph edges from them, copy them into the index, or reconstruct any timeline —
 * the timeline remains owned by core/events (amendment 3).
 */
export function buildIndex(objects: readonly ParsedObject[], events: readonly EventEnvelope[]): KnowledgeIndex {
  void events; // reserved linkage point — intentionally unused in V1
  const index: MutableKnowledgeIndex = { registry: [], search: [], nodes: [], edges: [] };
  for (const object of objects) {
    for (const contributor of CONTRIBUTORS) contributor.contribute(object, index);
  }
  return { registry: index.registry, search: index.search, nodes: index.nodes, edges: index.edges };
}
