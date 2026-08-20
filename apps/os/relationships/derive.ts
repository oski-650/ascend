// relationships/derive — the pure structural derivation.
//
// Takes plain records, returns structural relationships. No fs, no readers, no clock, no module
// state. The impure half — calling the nine canonical readers and mapping their read-models into
// these narrow shapes — lives in ./index.
//
// The input types are deliberately NARROW rather than the full read-models. This layer needs a
// slug, an id, and a foreign key; importing ProductionState or DocumentRecord wholesale would
// couple structural truth to presentation fields that have nothing to do with it, and would make
// this function impossible to test without a vault.
//
// EVERY RULE HERE MIRRORS graph-view/projection EXACTLY, because this code was extracted from it
// and the rendered graph must not change by one edge. Two behaviours are load-bearing and easy to
// lose:
//   1. Only OPEN checklist items become tasks — a completed task is not outstanding work.
//   2. Only clients with an ACTIVE retainer have a care plan.

import type { EventSubject } from "@/domain";
import type { StructuralRelationship, StructuralRelationshipKind } from "./contract";

// ─── Narrow inputs ────────────────────────────────────────────────────────────

export type RelationshipSources = {
  clients: readonly { slug: string; promotedFromProspect: string | null }[];
  productionStates: readonly {
    clientSlug: string;
    phases: readonly { key: string; checklist: readonly { done: boolean }[] }[];
  }[];
  invoices: readonly { id: string; client: string }[];
  careClients: readonly { slug: string; retainerActive: boolean }[];
  documents: readonly { docId: string; client: string; supersedes: string | null }[];
  approvals: readonly { id: string; clientSlug: string }[];
  audits: readonly { id: string; client: string }[];
};

export const EMPTY_SOURCES: RelationshipSources = {
  clients: [],
  productionStates: [],
  invoices: [],
  careClients: [],
  documents: [],
  approvals: [],
  audits: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const subject = (entity: EventSubject["entity"], entityId: string): EventSubject => ({
  entity,
  entity_id: entityId,
});

const relate = (
  kind: StructuralRelationshipKind,
  source: EventSubject,
  target: EventSubject,
  reader: string,
  field: string
): StructuralRelationship => ({ source, target, kind, provenance: { reader, field } });

/** Stable identity for dedupe and ordering. Not an id format any consumer should adopt. */
const relationshipKey = (r: StructuralRelationship): string =>
  `${r.kind}|${r.source.entity}/${r.source.entity_id}|${r.target.entity}/${r.target.entity_id}`;

const subjectKey = (s: EventSubject): string => `${s.entity}/${s.entity_id}`;

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Every structural relationship the sources assert, deduplicated and totally ordered.
 *
 * Deterministic: same sources, same output, byte for byte. Ordering is by relationship key so no
 * consumer inherits the incidental ordering of a reader.
 */
export function deriveRelationships(sources: RelationshipSources): StructuralRelationship[] {
  const out: StructuralRelationship[] = [];

  // prospect → client. The one relationship that crosses the sales/delivery boundary.
  for (const client of sources.clients) {
    if (!client.promotedFromProspect) continue;
    out.push(
      relate(
        "promoted_to",
        subject("prospect", client.promotedFromProspect),
        subject("client", client.slug),
        "core/crm",
        "structural_meta.promoted_from_prospect"
      )
    );
  }

  // client → project → phase → task. The delivery hierarchy, and the deepest chain in the domain.
  for (const state of sources.productionStates) {
    const project = subject("project", state.clientSlug);
    out.push(
      relate("has_project", subject("client", state.clientSlug), project, "core/production", "clientSlug")
    );

    for (const phase of state.phases) {
      const phaseSubject = subject("phase", `${state.clientSlug}:${phase.key}`);
      out.push(relate("has_phase", project, phaseSubject, "core/production", "phases[].key"));

      phase.checklist.forEach((item, index) => {
        // Open items only. A completed task is not outstanding work, and the projection has always
        // omitted them — including them here would silently add nodes to the rendered graph.
        if (item.done) return;
        out.push(
          relate(
            "has_task",
            phaseSubject,
            subject("task", `${state.clientSlug}:${phase.key}:${index}`),
            "core/production",
            "phases[].checklist[]"
          )
        );
      });
    }
  }

  for (const invoice of sources.invoices) {
    out.push(
      relate(
        "billed",
        subject("client", invoice.client),
        subject("invoice", invoice.id),
        "core/finance",
        "Invoice.client"
      )
    );
  }

  for (const care of sources.careClients) {
    // The reader's own boolean, copied — never re-derived.
    if (!care.retainerActive) continue;
    out.push(
      relate(
        "subscribes",
        subject("client", care.slug),
        subject("care_plan", care.slug),
        "core/finance",
        "retainer_active"
      )
    );
  }

  for (const doc of sources.documents) {
    out.push(
      relate(
        "owns_document",
        subject("client", doc.client),
        subject("document", doc.docId),
        "lib/documents",
        "DocumentFrontmatter.client"
      )
    );
    if (doc.supersedes) {
      out.push(
        relate(
          "supersedes",
          subject("document", doc.docId),
          subject("document", doc.supersedes),
          "lib/documents",
          "DocumentFrontmatter.supersedes"
        )
      );
    }
  }

  for (const approval of sources.approvals) {
    out.push(
      relate(
        "awaits_approval",
        subject("client", approval.clientSlug),
        subject("approval", approval.id),
        "lib/portal",
        "ApprovalRequest.client_slug"
      )
    );
  }

  for (const audit of sources.audits) {
    out.push(
      relate(
        "measured_by",
        subject("client", audit.client),
        subject("audit", audit.id),
        "lib/audits",
        "Audit.client"
      )
    );
  }

  const seen = new Set<string>();
  return out
    .filter((r) => {
      const key = relationshipKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const left = relationshipKey(a);
      const right = relationshipKey(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/**
 * Every subject named by a relationship, deduplicated and totally ordered.
 *
 * Derived from the relationships rather than listed separately: a subject nothing connects to is
 * not a structural fact this layer has any claim about. Isolated entities are the renderer's
 * business, and it reads them from its own sources.
 */
export function subjectsOf(relationships: readonly StructuralRelationship[]): EventSubject[] {
  const bySubject = new Map<string, EventSubject>();
  for (const relationship of relationships) {
    for (const side of [relationship.source, relationship.target]) {
      const key = subjectKey(side);
      if (!bySubject.has(key)) bySubject.set(key, side);
    }
  }
  return [...bySubject.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => value);
}
