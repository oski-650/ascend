// relationships — the canonical structural substrate. See docs/STRUCTURAL-SUBSTRATE.md.
//
// The impure half: call the nine canonical readers, map their read-models into the narrow shapes
// ./derive expects, and return the structural truth of the business. The derivation itself is pure
// and lives next door.
//
// NINE READERS, and deliberately not twelve. graph-view/projection reads twelve, but three of them
// produce something other than structure and must not enter this layer:
//
//   detectOpportunities()     engine judgment — produces the `flags` edges and `opportunity` nodes
//   assembleHealthOverview()  node STATE for rendering, not a relationship
//   readEvents()              activity; events become a feed, never edges
//
// This layer opens no files. All I/O belongs to somebody else's canonical reader, reached through
// its public export, which also keeps F15's pinned client-profile-reader set from growing.

import "server-only";

import { getClient, listClients } from "@/core/crm";
import { listProductionStates } from "@/core/production";
import { listCareClients, listInvoices } from "@/core/finance";
import { listDocuments } from "@/lib/documents";
import { listApprovalRequests } from "@/lib/portal";
import { listAudits } from "@/lib/audits";

import { deriveRelationships, subjectsOf, type RelationshipSources } from "./derive";
import type { StructuralContext } from "./contract";

export type {
  StructuralContext,
  StructuralEntityKind,
  StructuralProvenance,
  StructuralRelationship,
  StructuralRelationshipKind,
} from "./contract";
export { deriveRelationships, subjectsOf, EMPTY_SOURCES, type RelationshipSources } from "./derive";

/** Gather the nine readers and flatten them into the narrow structural shapes. */
async function gather(): Promise<RelationshipSources> {
  const [clients, productionStates, invoices, careClients, documents, approvals, audits] =
    await Promise.all([
      listClients(),
      listProductionStates(),
      listInvoices(),
      listCareClients(),
      listDocuments({ includeSuperseded: true }),
      listApprovalRequests(),
      listAudits(),
    ]);

  // `promoted_from_prospect` lives in the client's structural_meta, reachable only through the
  // per-client reader. Same call the projection already makes.
  const details = await Promise.all(clients.map((client) => getClient(client.slug)));

  return {
    clients: clients.map((client) => {
      const meta = details.find((detail) => detail?.slug === client.slug)?.meta.data ?? {};
      const promoted = meta.promoted_from_prospect;
      return {
        slug: client.slug,
        promotedFromProspect: typeof promoted === "string" && promoted.length > 0 ? promoted : null,
      };
    }),
    productionStates: productionStates.map((state) => ({
      clientSlug: state.clientSlug,
      phases: state.phases.map((phase) => ({
        key: phase.key,
        checklist: phase.checklist.map((item) => ({ done: item.done })),
      })),
    })),
    invoices: invoices.map((invoice) => ({ id: String(invoice.id), client: invoice.client })),
    careClients: careClients.map((care) => ({
      slug: care.slug,
      retainerActive: care.retainer_active,
    })),
    documents: documents.map((record) => ({
      docId: String(record.meta.doc_id),
      client: record.meta.client,
      supersedes: record.meta.supersedes ? String(record.meta.supersedes) : null,
    })),
    approvals: approvals.map((approval) => ({
      id: String(approval.id),
      clientSlug: approval.client_slug,
    })),
    audits: audits.map((audit) => ({ id: String(audit.id), client: audit.client })),
  };
}

/**
 * The structural truth of the business right now.
 *
 * Built per request and discarded — no cache, no persistence, no module state. Same vault, same
 * context.
 */
export async function buildStructuralContext(now: Date = new Date()): Promise<StructuralContext> {
  const relationships = deriveRelationships(await gather());
  return {
    subjects: subjectsOf(relationships),
    relationships,
    builtAt: now.toISOString(),
  };
}
