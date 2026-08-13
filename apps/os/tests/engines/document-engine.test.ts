// Layer A — Document Lifecycle Awareness (Phase 12) contract tests.
//
// Frozen contract: what STATE the paperwork is in — NOT what to do about it and NOT how much revenue
// it represents. `paperworkInProgressUsd` is DOCUMENT VALUE, never revenue/pipeline/forecast.
// Version lineage is assembled from the stored `supersedes` FK among the passed records ONLY — no
// graph edges, no KnowledgeIndex, no traversal. Clock-free (status is a stored field).

import { describe, expect, it } from "vitest";
import { buildDocumentDigest, type DocumentInput } from "@/engines/document-engine";
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus, type DocumentType } from "@/domain";

const doc = (over: Partial<DocumentInput> & Pick<DocumentInput, "docId">): DocumentInput => ({
  client: "acme",
  type: "proposal" as DocumentType,
  status: "draft" as DocumentStatus,
  version: 1,
  title: "Untitled",
  amountUsd: null,
  supersedes: null,
  ...over,
});

describe("document-engine · empty + gap visibility", () => {
  it("returns an honest empty digest with every known bucket still present", () => {
    const digest = buildDocumentDigest([]);
    expect(digest.documents).toEqual([]);
    expect(digest.lineages).toEqual([]);
    expect(digest.counts).toEqual({ total: 0, paperworkInProgressUsd: 0 });
    // All known statuses/types shown at 0 so a gap like "0 sent" stays visible.
    expect(digest.byStatus.map((b) => b.status)).toEqual([...DOCUMENT_STATUSES]);
    expect(digest.byType.map((b) => b.type)).toEqual([...DOCUMENT_TYPES]);
    expect(digest.byStatus.every((b) => b.count === 0)).toBe(true);
  });
});

describe("document-engine · unknown value preservation", () => {
  it("appends unknown statuses and types rather than dropping the document", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "d1", status: "renegotiating" as DocumentStatus, type: "memo" as DocumentType }),
    ]);
    expect(digest.counts.total).toBe(1);
    expect(digest.byStatus.map((b) => b.status)).toContain("renegotiating");
    expect(digest.byType.map((b) => b.type)).toContain("memo");
    // Known vocabulary keeps its fixed order first.
    expect(digest.byStatus.slice(0, DOCUMENT_STATUSES.length).map((b) => b.status)).toEqual([
      ...DOCUMENT_STATUSES,
    ]);
  });

  it("falls back to the raw value as the label for an unknown status/type", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "d1", status: "renegotiating" as DocumentStatus }),
    ]);
    const row = digest.documents[0];
    expect(row.statusLabel).toBe("renegotiating");
  });
});

describe("document-engine · no fabricated values", () => {
  it("normalises a missing or non-finite amount to null, never 0", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "d1", amountUsd: null }),
      doc({ docId: "d2", amountUsd: Number.NaN }),
      doc({ docId: "d3", amountUsd: Number.POSITIVE_INFINITY }),
    ]);
    for (const row of digest.documents) expect(row.amountUsd).toBeNull();
  });
});

describe("document-engine · paperwork value is NOT revenue", () => {
  it("sums only draft and sent documents", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "d1", status: "draft", amountUsd: 1000 }),
      doc({ docId: "d2", status: "sent", amountUsd: 500 }),
      doc({ docId: "d3", status: "accepted", amountUsd: 9999 }),
      doc({ docId: "d4", status: "superseded", amountUsd: 8888 }),
    ]);
    // Accepted and superseded are excluded: this is unfinished paper, not contracted revenue.
    expect(digest.counts.paperworkInProgressUsd).toBe(1500);
  });

  it("exposes no revenue/forecast-flavoured field name", () => {
    const digest = buildDocumentDigest([doc({ docId: "d1", status: "draft", amountUsd: 100 })]);
    const keys = Object.keys(digest.counts);
    expect(keys).toEqual(["total", "paperworkInProgressUsd"]);
    const serialized = JSON.stringify(digest).toLowerCase();
    for (const forbidden of ["revenue", "forecast", "pipeline", "priority", "rank", "recommend"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("ignores non-finite amounts when summing", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "d1", status: "draft", amountUsd: Number.NaN }),
      doc({ docId: "d2", status: "draft", amountUsd: 250 }),
    ]);
    expect(digest.counts.paperworkInProgressUsd).toBe(250);
  });
});

describe("document-engine · version lineage from stored FK only", () => {
  it("assembles an ordered chain oldest → newest", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "v3", version: 3, supersedes: "v2" }),
      doc({ docId: "v1", version: 1, supersedes: null }),
      doc({ docId: "v2", version: 2, supersedes: "v1" }),
    ]);
    expect(digest.lineages).toHaveLength(1);
    expect(digest.lineages[0].chain.map((c) => c.docId)).toEqual(["v1", "v2", "v3"]);
  });

  it("does NOT link a dangling supersedes target that is absent from the passed set", () => {
    const digest = buildDocumentDigest([doc({ docId: "v2", version: 2, supersedes: "missing-v1" })]);
    // Never fabricates the absent predecessor.
    expect(digest.lineages).toEqual([]);
    expect(digest.counts.total).toBe(1);
  });

  it("terminates on a self-referencing supersedes without infinite looping", () => {
    const digest = buildDocumentDigest([doc({ docId: "loop", supersedes: "loop" })]);
    expect(digest.counts.total).toBe(1);
    expect(digest.lineages).toEqual([]);
  });

  it("terminates on a two-node supersedes cycle", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "a", supersedes: "b" }),
      doc({ docId: "b", supersedes: "a" }),
    ]);
    // The `seen` guard must stop traversal; the contract is only that it terminates.
    expect(digest.counts.total).toBe(2);
    expect(Array.isArray(digest.lineages)).toBe(true);
  });

  it("omits a single unsuperseded document from lineages (a chain needs ≥2)", () => {
    expect(buildDocumentDigest([doc({ docId: "solo" })]).lineages).toEqual([]);
  });
});

describe("document-engine · ordering guarantees", () => {
  it("orders by client, then fixed type order, then version, then docId", () => {
    const digest = buildDocumentDigest([
      doc({ docId: "b2", client: "beta", type: "contract", version: 2 }),
      doc({ docId: "a1", client: "alpha", type: "sow", version: 1 }),
      doc({ docId: "b1", client: "beta", type: "contract", version: 1 }),
      doc({ docId: "a0", client: "alpha", type: "proposal", version: 1 }),
    ]);
    // alpha before beta; within alpha, proposal precedes sow per DOCUMENT_TYPES order.
    expect(digest.documents.map((d) => d.docId)).toEqual(["a0", "a1", "b1", "b2"]);
  });
});

describe("document-engine · determinism + purity", () => {
  it("produces identical output for identical input", () => {
    const input = [doc({ docId: "v2", supersedes: "v1" }), doc({ docId: "v1" })];
    expect(buildDocumentDigest(input)).toEqual(buildDocumentDigest(input));
  });

  it("does not mutate its input", () => {
    const input = [doc({ docId: "v1" }), doc({ docId: "v2", supersedes: "v1" })];
    const snapshot = structuredClone(input);
    buildDocumentDigest(input);
    expect(input).toEqual(snapshot);
  });
});