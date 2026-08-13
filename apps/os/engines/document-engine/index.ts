// engines/document-engine — PURE read-only Document Lifecycle Awareness (Phase 12).
//
// GOVERNING INVARIANT: Document Lifecycle Awareness = what STATE the deal paperwork is in, NOT what to
// do about it and NOT how much revenue it represents. It groups documents (proposals/contracts/SOWs/
// change-orders) by lifecycle status and type, assembles version lineages, and reports STRUCTURE ONLY.
// It:
//   • reports ARTIFACT FACTS ONLY — counts, per-document rows, version lineage (no recommendation/rank);
//   • computes NO revenue of any kind — "paperwork in progress" (Σ amount_usd of draft|sent docs) is
//     DOCUMENT VALUE, never revenue / pipeline value / contracted revenue / collected revenue / forecast;
//   • assembles version lineage from the STORED `supersedes` FK among the passed records ONLY — it creates
//     NO graph edges, queries NO KnowledgeIndex, performs NO traversal, is NOT a graph authority;
//   • emits NO signals and wires into NO Opportunity/Decision/composer.
// Pure & self-contained: imports only pure `@/domain` types + label maps. No fs, no core/lib, no other
// engine, no writes/events, NO CLOCK (document status is a stored field), no randomness → deterministic.

import type { DocumentType, DocumentStatus } from "@/domain";
import { DOCUMENT_TYPES, DOCUMENT_STATUSES, TYPE_LABEL, STATUS_LABEL } from "@/domain";

/** Statuses whose documents count as "paperwork in progress" (unfinished paper). */
const IN_PROGRESS_STATUSES = new Set<string>(["draft", "sent"]);

/** Minimal structural input — the orchestrator maps DocumentRecord.meta → this. `amountUsd` null when absent. */
export type DocumentInput = {
  docId: string;
  client: string;
  type: DocumentType;
  status: DocumentStatus;
  version: number;
  title: string;
  amountUsd: number | null;
  supersedes: string | null; // stored FK to the doc_id this one replaces (attribute only — NOT a graph edge)
};

/** A single document, presented as a fact (no derived revenue/priority). */
export type DocumentRow = {
  docId: string;
  client: string;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  version: number;
  title: string;
  amountUsd: number | null;
};

export type StatusBucket = { status: string; label: string; count: number };
export type TypeBucket = { type: string; label: string; count: number };
/** An ordered supersession chain (oldest → newest), assembled from the stored `supersedes` FK. */
export type Lineage = { client: string; type: string; chain: DocumentRow[] };

export type DocumentDigest = {
  byStatus: StatusBucket[];
  byType: TypeBucket[];
  lineages: Lineage[];
  documents: DocumentRow[];
  counts: {
    total: number;
    // Σ amount_usd for documents whose stored status is draft|sent. DOCUMENT VALUE, not revenue.
    paperworkInProgressUsd: number;
  };
};

/** Fixed type-order index for deterministic row ordering (presentation only, not prioritization). */
function typeIndex(type: string): number {
  const i = (DOCUMENT_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? DOCUMENT_TYPES.length : i;
}

function toRow(d: DocumentInput): DocumentRow {
  const isKnownType = (DOCUMENT_TYPES as readonly string[]).includes(d.type);
  const isKnownStatus = (DOCUMENT_STATUSES as readonly string[]).includes(d.status);
  return {
    docId: d.docId,
    client: d.client,
    type: d.type,
    typeLabel: isKnownType ? TYPE_LABEL[d.type] : d.type,
    status: d.status,
    statusLabel: isKnownStatus ? STATUS_LABEL[d.status] : d.status,
    version: d.version,
    title: d.title,
    amountUsd: typeof d.amountUsd === "number" && Number.isFinite(d.amountUsd) ? d.amountUsd : null,
  };
}

/** Bucket counts over a fixed known vocabulary; unknown values appended (sorted) rather than dropped. */
function countBuckets<K extends string>(
  values: readonly string[],
  known: readonly K[],
  label: (k: string) => string
): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const extra = [...counts.keys()].filter((v) => !(known as readonly string[]).includes(v)).sort();
  const ordered = [...known, ...extra];
  return ordered.map((k) => ({ key: k, label: label(k), count: counts.get(k) ?? 0 }));
}

/**
 * Build the document digest — pure and deterministic given `documents`. Clock-free (status is stored).
 * All known statuses/types are always shown (so a gap like "0 sent" is visible); unknown values are
 * preserved literally. Version lineages are assembled from the `supersedes` FK within the passed set only
 * (a target not in the set → the chain simply does not link there; never fabricated).
 */
export function buildDocumentDigest(documents: readonly DocumentInput[]): DocumentDigest {
  const rows = documents.map(toRow);

  const byStatus: StatusBucket[] = countBuckets(
    documents.map((d) => d.status),
    DOCUMENT_STATUSES,
    (k) => ((DOCUMENT_STATUSES as readonly string[]).includes(k) ? STATUS_LABEL[k as DocumentStatus] : k)
  ).map((b) => ({ status: b.key, label: b.label, count: b.count }));

  const byType: TypeBucket[] = countBuckets(
    documents.map((d) => d.type),
    DOCUMENT_TYPES,
    (k) => ((DOCUMENT_TYPES as readonly string[]).includes(k) ? TYPE_LABEL[k as DocumentType] : k)
  ).map((b) => ({ type: b.key, label: b.label, count: b.count }));

  // ── Version lineage (stored FK only) ──────────────────────────────────────
  // rowByDocId lets us resolve a `supersedes` pointer to its row; successorOf maps olderDocId → the row
  // that supersedes it. A chain head = a doc that IS superseded by an in-set doc but whose own `supersedes`
  // does NOT resolve in-set (the oldest we can see). Walk forward from each head to build the chain.
  const rowByDocId = new Map<string, DocumentRow>();
  documents.forEach((d, i) => rowByDocId.set(d.docId, rows[i]));
  const successorOf = new Map<string, DocumentRow>(); // olderDocId → superseding row
  documents.forEach((d, i) => {
    if (d.supersedes && rowByDocId.has(d.supersedes)) successorOf.set(d.supersedes, rows[i]);
  });

  const headDocIds = documents
    .filter((d) => successorOf.has(d.docId) && !(d.supersedes && rowByDocId.has(d.supersedes)))
    .map((d) => d.docId)
    .sort();

  const lineages: Lineage[] = [];
  for (const headId of headDocIds) {
    const chain: DocumentRow[] = [];
    const seen = new Set<string>();
    let current = rowByDocId.get(headId);
    while (current && !seen.has(current.docId)) {
      seen.add(current.docId);
      chain.push(current);
      current = successorOf.get(current.docId);
    }
    if (chain.length >= 2) lineages.push({ client: chain[0].client, type: chain[0].type, chain });
  }

  // Deterministic row ordering: client → fixed type order → version → docId. Presentation only.
  const documentsOrdered = [...rows].sort(
    (a, b) =>
      a.client.localeCompare(b.client) ||
      typeIndex(a.type) - typeIndex(b.type) ||
      a.version - b.version ||
      a.docId.localeCompare(b.docId)
  );

  let paperworkInProgressUsd = 0;
  for (const d of documents) {
    if (IN_PROGRESS_STATUSES.has(d.status) && typeof d.amountUsd === "number" && Number.isFinite(d.amountUsd)) {
      paperworkInProgressUsd += d.amountUsd; // DOCUMENT VALUE — not revenue
    }
  }

  return {
    byStatus,
    byType,
    lineages,
    documents: documentsOrdered,
    counts: { total: documents.length, paperworkInProgressUsd },
  };
}
