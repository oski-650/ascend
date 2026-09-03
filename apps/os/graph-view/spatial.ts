// graph-view/spatial — the SPATIAL MODEL layer (UI-REDESIGN-PROPOSAL §3.2, Slice 2).
//
//     GraphProjection  →  SpatialModel  →  GalaxyLayout  →  3D Renderer
//                         ^^^^^^^^^^^^
//
// §3.2 defines this layer as "presentation-space data — sizes, kinds, parents, stable identity".
// The line below it is GalaxyLayout: "spatial and orbital mathematics — radii, phases, inclination,
// collision". **That split is the whole design of this file.** SpatialModel says what each object
// IS in presentation space; it never says where the object GOES. There is no x, y, z, orbit, angle
// or camera here, and F63 fails the build if one appears.
//
// ─── FORMALISED, NOT INTRODUCED ────────────────────────────────────────────────────────────────
//
// Slice 1 found GraphProjection already existing under the name `GraphModel`, and named it rather
// than adding a second read-model beside it. Slice 2 is the same situation one layer down: the
// presentation-space half already existed, fused into `SimNode` in components/graph/simulation.ts,
// which carried presentation data (`r`, `phase`, `period`), layout output (`x`, `y`, `vx`, `vy`)
// and renderer state (`glow`, `pinned`) in ONE struct. This file extracts the first of those three.
// It does not reimplement it: `spatialSeed` is simulation's own FNV-1a hash, moved here, and
// simulation now imports it back. There is one owner of each value, and it is not a copy.
//
// ─── EVERY FIELD NAMES AN EXISTING OWNER ───────────────────────────────────────────────────────
//
//   id          GraphNode.id — `${type}:${entityId}`, F19's property, unchanged.
//   visualType  GraphNode.type — contract vocabulary, and the key into NODE_VISUAL.
//   size        taxonomy.nodeRadius(node). Taxonomy remains the owner of visual vocabulary and
//               sizing; this layer CONSUMES it and does not become the renderer's style sheet.
//   seed        spatialSeed(id) — the deterministic 0-1 value simulation already placed nodes with.
//   parent      the source of a CONTAINMENT edge (below). Read from stored direction; not invented.
//
// Nothing is computed here that an existing module already computes. A field with no owner is a
// field this layer would be inventing, and the one candidate that had no owner — `tier` — was
// dropped rather than guessed at: `tier` in this repository already means HealthTier
// (engines/health-engine), consumed by decision-engine and pipeline-engine. Reusing the word for a
// spatial depth would give one name two authorities. Depth, when GalaxyLayout needs it, is a walk
// up `parent` — derivable, and therefore not a field.
//
// ─── AUTHORIZATION IS NEVER RE-DECIDED HERE ────────────────────────────────────────────────────
//
// A GraphProjection value is ALREADY SCOPED to the principal whose readers produced it (Part Zero,
// F61). This layer receives no principal, resolves no caller, and holds no policy — it is a pure
// function of data that was authorized upstream. A SpatialModel that called `requireCaller()` would
// be a second place authorization lives, which is exactly what Stage 2G removed. F63 asserts this
// file contains no authorization vocabulary at all.
//
// PURE: no fs, no env, no network, no database, no clock, no randomness, no React, no Three.js, and
// no import of graph-view/projection. F17 already holds most of that for everything under
// graph-view/; F63 adds the rules specific to this boundary.

import type { GraphEdgeType, GraphNode, GraphNodeType, GraphProjection } from "./contract";
import { nodeRadius } from "./taxonomy";

/**
 * The edge kinds that assert CONTAINMENT — an object being part of another — as opposed to lateral
 * association between two objects that both stand on their own.
 *
 * NOT a new opinion about the domain. Two existing owners already say this:
 *
 *   • relationships/contract.ts backs each of these with a foreign key stored on disk, and records
 *     that a relationship is "directed as stored — whether a consumer may traverse it backwards is
 *     the consumer's decision, not this layer's". `has_project` is stored client → project, so the
 *     SOURCE is the container. This layer makes that consumer decision explicitly, once.
 *   • taxonomy.EDGE_VISUAL already separates the two classes in prose — "structural containment
 *     reads stronger than lateral association" — and gives exactly these three the shortest rest
 *     lengths (90 / 62 / 44) against 110-200 for the lateral kinds.
 *
 * `billed`, `owns_document`, `subscribes`, `awaits_approval`, `measured_by`, `supersedes` and
 * `promoted_to` are real foreign keys and real edges, and none of them makes its target PART OF its
 * source: an invoice is not inside a client the way a task is inside a phase. `flags` and
 * `wikilink` are not structural at all — relationships/ excludes them by construction.
 *
 * Typed as a Record over the full GraphEdgeType union rather than a bare array, so adding an edge
 * type upstream fails to compile until somebody decides which class it belongs to. A default of
 * "not containment" would be the silent answer, and silence is how a hierarchy gets invented.
 */
const CONTAINMENT: Record<GraphEdgeType, boolean> = {
  has_project: true,
  has_phase: true,
  has_task: true,
  billed: false,
  owns_document: false,
  supersedes: false,
  awaits_approval: false,
  measured_by: false,
  subscribes: false,
  promoted_to: false,
  flags: false,
  wikilink: false,
};

/** One object's presentation-space identity. Carries no position — that is GalaxyLayout's output. */
export type SpatialNode = {
  /** GraphNode.id, unchanged. The join key for every layer below this one. */
  id: string;
  /** GraphNode.type. Named `visualType` because below this line it selects visual identity only. */
  visualType: GraphNodeType;
  /** World-unit magnitude from taxonomy.nodeRadius — already weight-scaled by its owner. */
  size: number;
  /** Deterministic 0-1 from the id. Stable across runs, machines and rebuilds. */
  seed: number;
  /** The containing object's SpatialNode.id, or null when this object contains under nothing. */
  parent: string | null;
};

/** One relationship in presentation space. Carries no rest length, no force, no geometry. */
export type SpatialEdge = {
  /** GraphEdge.id, unchanged. */
  id: string;
  kind: GraphEdgeType;
  /** SpatialNode.id */
  source: string;
  /** SpatialNode.id */
  target: string;
  /** Whether this edge asserts containment — the same judgment `parent` is derived from. */
  containment: boolean;
};

export type SpatialModel = {
  nodes: SpatialNode[];
  edges: SpatialEdge[];
};

/**
 * A deterministic 0-1 value for `key` — FNV-1a, lifted verbatim from components/graph/simulation.ts,
 * which used it so that "random" placement is reproducible across runs and machines.
 *
 * EXPORTED because simulation needs the same function for its per-node breathing phase and period,
 * and two copies of a hash is two definitions of "deterministic". This is the one definition.
 */
export function spatialSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * GraphProjection → SpatialModel. Pure, total, deterministic.
 *
 * TOTAL: every projection node yields exactly one SpatialNode. Nothing is filtered — this layer is
 * not a visibility authority, and `DetailLevel`/`isVisibleAt` deliberately stay in taxonomy where
 * the renderer applies them. A layer named "spatial" that also dropped nodes would be a second
 * filtering point with no single owner, which is the shape F61 cost a slice to remove.
 *
 * DETERMINISTIC: the result depends only on the argument. Input ORDER is preserved rather than
 * canonicalised — reordering the output would silently change the renderer's draw order, and Slice
 * 2 changes no rendering behaviour. Determinism under a shuffled input is therefore a property of
 * the CONTENT, and the test asserts it that way.
 *
 * Accepts `Pick<…, "nodes" | "edges">` so a full GraphProjection is assignable while simulation can
 * pass the two arrays it is constructed with. GraphProjection's own contract is not altered.
 */
export function toSpatialModel(projection: Pick<GraphProjection, "nodes" | "edges">): SpatialModel {
  const known = new Set(projection.nodes.map((n: GraphNode) => n.id));

  // Dangling edges are skipped, never fabricated into nodes — the rule simulation already applies
  // ("dangling — skip, never fabricate"). An edge pointing at an absent node cannot make it exist,
  // and a parent that is not in `nodes` would be a reference no layer below could resolve.
  const edges: SpatialEdge[] = projection.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({
      id: e.id,
      kind: e.type,
      source: e.source,
      target: e.target,
      containment: CONTAINMENT[e.type],
    }));

  // Containment is directed source → target, so the TARGET gains a parent. A node reachable by two
  // containment edges keeps the lexicographically smallest parent id: an arbitrary choice would be
  // non-deterministic, and picking "the first one seen" would make the result depend on edge order.
  // This is a tie-break for totality, not a statement about which container is more true.
  const parents = new Map<string, string>();
  for (const e of edges) {
    if (!e.containment) continue;
    const held = parents.get(e.target);
    if (held === undefined || e.source < held) parents.set(e.target, e.source);
  }

  const nodes: SpatialNode[] = projection.nodes.map((node) => ({
    id: node.id,
    visualType: node.type,
    size: nodeRadius(node),
    seed: spatialSeed(node.id),
    parent: parents.get(node.id) ?? null,
  }));

  return { nodes, edges };
}
