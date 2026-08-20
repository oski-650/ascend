// relationships/contract — the canonical structural relationship vocabulary.
//
// WHAT THIS LAYER IS. The single owner of "what is structurally connected in this business",
// derived deterministically from foreign keys that already exist on disk. It is deliberately
// BORING: given the current authoritative readers, return structural relationships. Nothing
// learned, nothing ranked, nothing inferred, nothing smart.
//
// WHY IT EXISTS. Structural derivation used to live inside graph-view/projection, which carries its
// own retirement notice. Anything else needing structural truth would have had to depend on a
// module marked for deletion, or duplicate its logic — and this repository already has three graph
// representations, so a fourth was the likely outcome. Both consumers now read from here:
//
//     relationships ──→ graph-view/projection      (draws them)
//     relationships ──→ mission-control            (injects them into cognition)
//
// There is no reverse dependency. This layer imports neither graph-view nor cognition.
//
// WHAT IS DELIBERATELY ABSENT. Only foreign keys appear here. Engine judgments do not:
// `opportunity` is not a vault entity — it is synthesised per request by lib/opportunities, with
// ids like `launched_no_retainer:<slug>` — and its `flags` edges are an interpretation, not
// terrain. graph-view may draw them; nothing may traverse them as structure. Authored `wikilink`
// edges are a third provenance class and are also absent (see the contract doc).
//
// PURE TYPES. No fs, no React, no derivation logic — that lives in ./derive.

import type { EntityKind, EventSubject } from "@/domain";

/**
 * Every relationship kind backed by a field that exists on disk.
 *
 * Each is a foreign key an operator (or an Ascend writer) actually stored. If a kind cannot name
 * the field that asserts it, it does not belong in this union.
 */
export type StructuralRelationshipKind =
  | "has_project"
  | "has_phase"
  | "has_task"
  | "billed"
  | "subscribes"
  | "owns_document"
  | "supersedes"
  | "awaits_approval"
  | "measured_by"
  | "promoted_to";

/**
 * Which field asserted this relationship, so any claim can be audited back to its source.
 *
 * Mandatory, matching the rule cognition already enforces on learned associations: nothing in this
 * system may assert a connection without being able to say what stated it.
 */
export type StructuralProvenance = {
  /** The canonical reader that produced the record, e.g. "core/production". */
  reader: string;
  /** The field on that record which names the other entity, e.g. "clientSlug". */
  field: string;
};

/**
 * One structural fact. Directed as stored — whether a consumer may traverse it backwards is the
 * consumer's decision, not this layer's.
 */
export type StructuralRelationship = {
  source: EventSubject;
  target: EventSubject;
  kind: StructuralRelationshipKind;
  provenance: StructuralProvenance;
};

/**
 * The structural truth of the business at one moment.
 *
 * Identity is EventSubject — the same domain pair the event spine and cognition already use, and
 * deliberately NOT the `${type}:${entityId}` string, which F19 makes graph-view's sole property.
 * Consumers map to their own id space on the way out.
 *
 * Carries no layout, colour, weight, health, or status. Those are presentation concerns owned by
 * whoever renders.
 */
export type StructuralContext = {
  subjects: readonly EventSubject[];
  relationships: readonly StructuralRelationship[];
  builtAt: string;
};

/** Convenience for consumers that key by entity kind. */
export type StructuralEntityKind = Extract<
  EntityKind,
  | "client"
  | "prospect"
  | "project"
  | "phase"
  | "task"
  | "invoice"
  | "care_plan"
  | "document"
  | "approval"
  | "audit"
>;
