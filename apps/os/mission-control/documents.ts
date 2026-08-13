// mission-control/documents — the Document-Lifecycle-Awareness ORCHESTRATOR (Phase 12, MC-1/MC-3).
//
// Mission Control GATHERS documents (via the existing lib/documents reader — DL-2, lib/documents NOT
// migrated to core) and INVOKES the pure engine; it computes no digest itself. It maps each DocumentRecord
// to the engine input. `includeSuperseded: true` is required so the full lifecycle picture — including
// superseded history and complete version lineages — is available (listDocuments hides superseded by
// default). Read-only: no writes, no events. The engine is clock-free, so nothing is injected.

import "server-only";
import { listDocuments } from "@/lib/documents";
import { buildDocumentDigest, type DocumentDigest } from "@/engines/document-engine";

export async function assembleDocuments(): Promise<DocumentDigest> {
  const records = await listDocuments({ includeSuperseded: true });
  return buildDocumentDigest(
    records.map((r) => ({
      docId: r.meta.doc_id,
      client: r.meta.client,
      type: r.meta.type,
      status: r.meta.status,
      version: r.meta.version,
      title: r.meta.title,
      amountUsd: typeof r.meta.amount_usd === "number" ? r.meta.amount_usd : null,
      supersedes: r.meta.supersedes ?? null,
    }))
  );
}
