// Layer A — relationships / structural derivation (N2.5) contract tests.
//
// Frozen contract: given plain records, return the foreign-key relationships they assert. Nothing
// learned, nothing ranked, nothing inferred. Answers "what is structurally connected?" and never
// "what tends to co-occur?" (cognition), "how should this look?" (graph-view), or "what matters?"
// (Decision).
//
// The rule most worth defending here: ENGINE JUDGMENTS ARE NOT TERRAIN. An opportunity is not a
// vault entity, so no `flags`-shaped relationship may ever be produced — F23.7 enforces that
// statically, and the shape of this module makes it unrepresentable.

import { describe, expect, it } from "vitest";
import { deriveRelationships, subjectsOf, EMPTY_SOURCES, type RelationshipSources } from "@/relationships/derive";
import type { StructuralRelationship } from "@/relationships/contract";

const sources = (over: Partial<RelationshipSources> = {}): RelationshipSources => ({
  ...EMPTY_SOURCES,
  ...over,
});

const kinds = (relationships: readonly StructuralRelationship[]) => relationships.map((r) => r.kind);
const pairs = (relationships: readonly StructuralRelationship[]) =>
  relationships.map(
    (r) => `${r.source.entity}/${r.source.entity_id}->${r.target.entity}/${r.target.entity_id}`
  );

describe("relationships · the delivery hierarchy", () => {
  const production = sources({
    productionStates: [
      {
        clientSlug: "acme",
        phases: [
          { key: "design", checklist: [{ done: false }, { done: true }, { done: false }] },
          { key: "dev", checklist: [] },
        ],
      },
    ],
  });

  it("derives client → project → phase → task", () => {
    const derived = deriveRelationships(production);
    expect(pairs(derived)).toEqual(
      expect.arrayContaining([
        "client/acme->project/acme",
        "project/acme->phase/acme:design",
        "phase/acme:design->task/acme:design:0",
      ])
    );
  });

  it("emits tasks for OPEN checklist items only", () => {
    // A completed task is not outstanding work. The projection has always omitted them; including
    // them here would silently add nodes to the rendered graph.
    const tasks = deriveRelationships(production).filter((r) => r.kind === "has_task");
    expect(pairs(tasks)).toEqual([
      "phase/acme:design->task/acme:design:0",
      "phase/acme:design->task/acme:design:2",
    ]);
  });

  it("keeps the checklist INDEX, not the position among open items", () => {
    // task ids encode the original index. Renumbering would silently repoint every task edge.
    const ids = deriveRelationships(production)
      .filter((r) => r.kind === "has_task")
      .map((r) => r.target.entity_id);
    expect(ids).toEqual(["acme:design:0", "acme:design:2"]);
  });

  it("emits a phase with no open work, and no tasks under it", () => {
    const derived = deriveRelationships(production);
    expect(pairs(derived)).toContain("project/acme->phase/acme:dev");
    expect(pairs(derived).some((p) => p.includes("task/acme:dev"))).toBe(false);
  });
});

describe("relationships · the remaining foreign keys", () => {
  it("derives promoted_to only when the client records a prospect", () => {
    const withPromotion = deriveRelationships(
      sources({ clients: [{ slug: "acme", promotedFromProspect: "acme-lead" }] })
    );
    expect(pairs(withPromotion)).toEqual(["prospect/acme-lead->client/acme"]);

    const without = deriveRelationships(
      sources({ clients: [{ slug: "acme", promotedFromProspect: null }] })
    );
    expect(without).toEqual([]);
  });

  it("derives billed, owns_document, supersedes, awaits_approval, measured_by", () => {
    const derived = deriveRelationships(
      sources({
        invoices: [{ id: "inv-1", client: "acme" }],
        documents: [{ docId: "doc-2", client: "acme", supersedes: "doc-1" }],
        approvals: [{ id: "ap-1", clientSlug: "acme" }],
        audits: [{ id: "au-1", client: "acme" }],
      })
    );
    expect(pairs(derived)).toEqual(
      expect.arrayContaining([
        "client/acme->invoice/inv-1",
        "client/acme->document/doc-2",
        "document/doc-2->document/doc-1",
        "client/acme->approval/ap-1",
        "client/acme->audit/au-1",
      ])
    );
  });

  it("derives subscribes only for an ACTIVE retainer — the reader's boolean, copied", () => {
    const active = deriveRelationships(
      sources({ careClients: [{ slug: "acme", retainerActive: true }] })
    );
    expect(kinds(active)).toEqual(["subscribes"]);

    const inactive = deriveRelationships(
      sources({ careClients: [{ slug: "acme", retainerActive: false }] })
    );
    expect(inactive).toEqual([]);
  });

  it("omits supersedes when a document supersedes nothing", () => {
    const derived = deriveRelationships(
      sources({ documents: [{ docId: "doc-1", client: "acme", supersedes: null }] })
    );
    expect(kinds(derived)).toEqual(["owns_document"]);
  });
});

describe("relationships · provenance", () => {
  it("names the reader and the field for every relationship", () => {
    const derived = deriveRelationships(
      sources({
        clients: [{ slug: "acme", promotedFromProspect: "lead" }],
        productionStates: [{ clientSlug: "acme", phases: [{ key: "design", checklist: [] }] }],
        invoices: [{ id: "inv-1", client: "acme" }],
        documents: [{ docId: "d1", client: "acme", supersedes: null }],
        approvals: [{ id: "ap-1", clientSlug: "acme" }],
        audits: [{ id: "au-1", client: "acme" }],
        careClients: [{ slug: "acme", retainerActive: true }],
      })
    );
    expect(derived.length).toBeGreaterThan(6);
    for (const relationship of derived) {
      expect(relationship.provenance.reader).toMatch(/^(core|lib)\//);
      expect(relationship.provenance.field.length).toBeGreaterThan(0);
    }
  });
});

describe("relationships · determinism", () => {
  const dense = sources({
    clients: [
      { slug: "b", promotedFromProspect: "lead-b" },
      { slug: "a", promotedFromProspect: null },
    ],
    productionStates: [
      { clientSlug: "b", phases: [{ key: "dev", checklist: [{ done: false }] }] },
      { clientSlug: "a", phases: [{ key: "design", checklist: [{ done: false }] }] },
    ],
    invoices: [
      { id: "i2", client: "b" },
      { id: "i1", client: "a" },
    ],
  });

  it("is byte-identical across runs", () => {
    expect(JSON.stringify(deriveRelationships(dense))).toBe(
      JSON.stringify(deriveRelationships(dense))
    );
  });

  it("is totally ordered, so no consumer inherits a reader's incidental order", () => {
    const derived = deriveRelationships(dense);
    const keys = derived.map(
      (r) => `${r.kind}|${r.source.entity}/${r.source.entity_id}|${r.target.entity}/${r.target.entity_id}`
    );
    expect(keys).toEqual([...keys].sort());
  });

  it("deduplicates identical relationships", () => {
    const duplicated = sources({
      invoices: [
        { id: "i1", client: "a" },
        { id: "i1", client: "a" },
      ],
    });
    expect(deriveRelationships(duplicated)).toHaveLength(1);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(dense);
    deriveRelationships(dense);
    expect(JSON.stringify(dense)).toBe(before);
  });
});

describe("relationships · subjects", () => {
  it("returns every endpoint, deduplicated and ordered", () => {
    const derived = deriveRelationships(
      sources({
        productionStates: [{ clientSlug: "acme", phases: [{ key: "design", checklist: [] }] }],
        invoices: [{ id: "i1", client: "acme" }],
      })
    );
    const subjects = subjectsOf(derived).map((s) => `${s.entity}/${s.entity_id}`);
    expect(subjects).toEqual([...subjects].sort());
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(subjects).toEqual(
      expect.arrayContaining(["client/acme", "project/acme", "phase/acme:design", "invoice/i1"])
    );
  });

  it("names no subject that no relationship connects", () => {
    // A subject nothing connects to is not a structural fact this layer has any claim about.
    expect(subjectsOf([])).toEqual([]);
  });
});

describe("relationships · honest empty states", () => {
  it("returns nothing for empty sources", () => {
    expect(deriveRelationships(EMPTY_SOURCES)).toEqual([]);
  });

  it("returns nothing for a client with no records at all", () => {
    expect(deriveRelationships(sources({ clients: [{ slug: "a", promotedFromProspect: null }] }))).toEqual([]);
  });
});
