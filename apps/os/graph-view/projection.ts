// graph-view/projection — the UI-facing graph read-model adapter.
//
// ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ TEMPORARY — RETIRE WHEN GAP-1/2/3 CLOSE (docs/GRAPH-CONTRACT.md §6).                          ║
// ║                                                                                                ║
// ║ This module exists because the KnowledgeIndex covers 3 of 25 EntityKinds and emits only        ║
// ║ `wikilink` edges. It is a DISPOSABLE UI read-model adapter, NOT a source of truth. When        ║
// ║ packages/indexer gains structural + event contributors, replace this with `indexerGraphSource` ║
// ║ and DELETE this file. The UI must not change — it depends on ./contract, never on this module. ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝
//
// HARD RULES, enforced by review and by tests/architecture/graph-view.test.ts:
//   1. NO fs. No `node:fs`, no `node:path`, no vault paths. All I/O belongs to somebody else's
//      canonical reader, reached through its public export. (This also keeps F15's pinned
//      client-profile-reader set from growing.)
//   2. NO business computation. No sums, averages, scoring, ranking, or status derivation. Every
//      value rendered is COPIED from the read-model that owns it.
//   3. NO persistence, NO cache, NO module-level mutable state. Built per request, discarded.
//   4. NO writes and NO event emission.
//   5. Engines are reached through Mission Control, never imported here as values.
//
// The existing KnowledgeIndex is CONSUMED (its sop nodes and wikilink edges map straight through),
// never replaced. This module only adds the entity kinds the index does not yet cover.

import "server-only";

import { getClient, listClients, listProspects } from "@/core/crm";
import { listProductionStates } from "@/core/production";
import { listCareClients, listInvoices } from "@/core/finance";
import { readEvents } from "@/core/events";
import { buildKnowledgeIndex, UNSCOPED_INTERNAL_INDEX } from "@/core/knowledge";
import { assembleHealthOverview } from "@/mission-control";
import { listDocuments } from "@/lib/documents";
import { listApprovalRequests } from "@/lib/portal";
import { listAudits } from "@/lib/audits";
import { detectOpportunities } from "@/lib/opportunities";
import { buildStructuralContext, type StructuralRelationshipKind } from "@/relationships";
import {
  APPROVAL_KIND_LABEL,
  PHASE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  deriveApprovalStatus,
  deriveInvoiceStatus,
  type EntityKind,
  type EventEnvelope,
} from "@/domain";

import { graphNodeIdFor } from "./contract";
import type {
  GraphActivity,
  GraphEdge,
  GraphEdgeType,
  GraphModel,
  GraphNode,
  GraphNodeState,
  GraphNodeType,
} from "./contract";

// ─── Structural weights ────────────────────────────────────────────────────────────────────────
// A per-type constant, NOT a ranking. It scales node radius so containment reads as hierarchy.
// Deliberately not Decision.priorityScore — importing ranking here would move a business judgement
// into the presentation layer.
const WEIGHT: Record<GraphNodeType, number> = {
  client: 1.0,
  project: 0.85,
  prospect: 0.7,
  opportunity: 0.6,
  invoice: 0.55,
  document: 0.5,
  approval: 0.5,
  care_plan: 0.45,
  phase: 0.45,
  sop: 0.4,
  audit: 0.35,
  task: 0.2,
};

// ─── Builders ──────────────────────────────────────────────────────────────────────────────────

const EMPTY_STATE: GraphNodeState = { health: null, status: null, attention: false };

function node(
  type: GraphNodeType,
  entityId: string,
  entity: EntityKind,
  label: string,
  meta: { label: string; value: string }[] = [],
  state: Partial<GraphNodeState> = {}
): GraphNode {
  return {
    id: `${type}:${entityId}`,
    type,
    entityId,
    entity,
    label,
    weight: WEIGHT[type],
    state: { ...EMPTY_STATE, ...state },
    meta,
  };
}

function edge(type: GraphEdgeType, source: string, target: string): GraphEdge {
  return { id: `${type}:${source}->${target}`, type, source, target };
}

/**
 * Structural vocabulary → graph vocabulary.
 *
 * Written out rather than relying on the two unions happening to share literals: this makes the
 * subset relationship compile-checked, so adding a relationship kind upstream cannot silently fail
 * to render, and adding a graph edge type here cannot accidentally imply structural truth exists
 * for it. `flags` and `wikilink` are deliberately absent — neither is a foreign key.
 */
const STRUCTURAL_EDGE_TYPE: Record<StructuralRelationshipKind, GraphEdgeType> = {
  has_project: "has_project",
  has_phase: "has_phase",
  has_task: "has_task",
  billed: "billed",
  subscribes: "subscribes",
  owns_document: "owns_document",
  supersedes: "supersedes",
  awaits_approval: "awaits_approval",
  measured_by: "measured_by",
  promoted_to: "promoted_to",
};

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// ─── Event → sentence (presentation phrasing only; derives no fact) ────────────────────────────

const EVENT_VERB: Record<string, string> = {
  "invoice.paid": "Invoice paid",
  "invoice.created": "Invoice created",
  "invoice.sent": "Invoice sent",
  "invoice.overdue": "Invoice went overdue",
  "invoice.unpaid": "Invoice marked unpaid",
  "payment.received": "Payment received",
  "project.phase_started": "Phase started",
  "project.phase_completed": "Phase completed",
  "project.phase_skipped": "Phase skipped",
  "project.checklist_toggled": "Checklist updated",
  "project.launched": "Project launched",
  "project.created": "Project created",
  "client.created": "Client created",
  "client.status_changed": "Client status changed",
  "prospect.created": "Prospect added",
  "prospect.promoted": "Prospect promoted",
  "prospect.contacted": "Prospect contacted",
  "prospect.status_changed": "Prospect status changed",
  "document.created": "Document created",
  "document.sent": "Document sent",
  "document.accepted": "Document accepted",
  "document.superseded": "Document superseded",
  "approval.requested": "Approval requested",
  "approval.approved": "Approval signed",
  "approval.overdue": "Approval overdue",
  "portal.invited": "Portal invite issued",
  "portal.submitted": "Client submitted the portal form",
  "audit.recorded": "Site audit recorded",
  "time.started": "Timer started",
  "time.stopped": "Timer stopped",
  "time.logged": "Time logged",
  "careplan.started": "Care plan started",
  "automation.fired": "Automation fired",
};

/**
 * Resolve an EventSubject to a node id: `${type}:${entity_id}`, where the node TYPE mirrors the
 * domain EntityKind. Verified against the real log — `{entity:"project", entity_id:"tapia-…"}`
 * resolves to `project:tapia-…`. Events that resolve to no existing node are DROPPED by the caller,
 * never fabricated into a placeholder (the packages/graph DG-4.4.2 policy, applied here).
 */
function resolveNodeId(event: EventEnvelope): string | null {
  const entity = event.subject?.entity;
  const id = event.subject?.entity_id;
  if (!entity || !id) return null;
  return `${entity}:${id}`;
}

function summarize(event: EventEnvelope, label: string): string {
  const verb = EVENT_VERB[event.type] ?? event.type.replace(/[._]/g, " ");
  return `${verb} · ${label}`;
}

// ─── The projection ────────────────────────────────────────────────────────────────────────────

/**
 * Build the GraphModel from canonical readers. Implements `GraphSource`.
 *
 * Every node is a real object on disk and every edge is a foreign key that already exists. Nothing
 * here infers a relationship to make the graph look denser: if the underlying data does not support
 * an edge, no edge is drawn.
 */
export async function projectGraph(): Promise<GraphModel> {
  const [
    clients,
    productionStates,
    prospects,
    invoices,
    careClients,
    documents,
    approvals,
    audits,
    opportunities,
    healthTiles,
    knowledgeIndex,
    events,
    structural,
  ] = await Promise.all([
    listClients(),
    listProductionStates(),
    listProspects(),
    listInvoices(),
    listCareClients(),
    listDocuments({ includeSuperseded: true }),
    listApprovalRequests(),
    listAudits(),
    detectOpportunities(),
    assembleHealthOverview(), // Mission Control invokes the Health Engine — we never do
    buildKnowledgeIndex(UNSCOPED_INTERNAL_INDEX),
    readEvents({ limit: 60 }),
    buildStructuralContext(), // the canonical foreign-key relationships — no longer derived here
  ]);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ── Structural relationships ─────────────────────────────────────────────────────────────────
  // The ten foreign-key edge kinds are NO LONGER DERIVED HERE. relationships/ owns them, and both
  // this projection and cognition read from that one owner — so structural truth no longer lives
  // inside a module that carries a retirement notice. All this module does now is translate
  // EventSubject identity into the graph's own id format, which F19 keeps as graph-view's property.
  //
  // Engine judgments (`flags`) and authored links (`wikilink`) are NOT structural and are still
  // built below: this layer may draw an opportunity, but nothing may traverse one as terrain.
  for (const relationship of structural.relationships) {
    const source = graphNodeIdFor(relationship.source.entity, relationship.source.entity_id);
    const target = graphNodeIdFor(relationship.target.entity, relationship.target.entity_id);
    if (!source || !target) continue;
    edges.push(edge(STRUCTURAL_EDGE_TYPE[relationship.kind], source, target));
  }

  // Health, copied from the engine's output via Mission Control. Never recomputed.
  const healthBySlug = new Map(healthTiles.map((t) => [t.clientSlug, t.health]));

  // ── Clients ──────────────────────────────────────────────────────────────────────────────────
  // getClient() is the canonical reader (F15). structural_meta carries promoted_from_prospect.
  const clientDetails = await Promise.all(clients.map((c) => getClient(c.slug)));

  for (const client of clients) {
    const health = healthBySlug.get(client.slug);
    const detail = clientDetails.find((d) => d?.slug === client.slug) ?? null;
    const meta = detail?.meta.data ?? {};
    const status = typeof meta.status === "string" ? meta.status : null;
    const tier = typeof meta.tier === "string" ? meta.tier : null;
    const website = typeof meta.website === "string" ? meta.website : null;

    nodes.push(
      node(
        "client",
        client.slug,
        "client",
        client.name,
        [
          ...(status ? [{ label: "Status", value: status }] : []),
          ...(tier ? [{ label: "Tier", value: tier }] : []),
          ...(health
            ? [
                {
                  label: "Health",
                  value:
                    health.tier !== null
                      ? `${health.score} · ${health.tier.replace("_", " ")}`
                      : "cannot be determined",
                },
              ]
            : []),
          ...(website ? [{ label: "Website", value: website }] : []),
        ],
        {
          health: health?.tier ?? null,
          status,
          attention: health?.tier === "at_risk",
        }
      )
    );

  }

  // ── Projects · phases · tasks ────────────────────────────────────────────────────────────────
  for (const state of productionStates) {
    const health = healthBySlug.get(state.clientSlug);
    const activePhase = state.activePhaseIndex !== null ? state.phases[state.activePhaseIndex] : null;

    nodes.push(
      node(
        "project",
        state.clientSlug,
        "project",
        `${state.clientName} · Build`,
        [
          { label: "Progress", value: `${state.overallProgress}%` },
          { label: "Phase", value: activePhase ? activePhase.label : "All phases complete" },
          ...(state.launchTarget ? [{ label: "Launch target", value: state.launchTarget }] : []),
          ...(health
            ? [
                {
                  label: "Health",
                  value:
                    health.tier !== null
                      ? `${health.score} · ${health.tier.replace("_", " ")}`
                      : "cannot be determined",
                },
              ]
            : []),
        ],
        {
          health: health?.tier ?? null,
          status: activePhase ? activePhase.label : "launched",
          attention: health?.tier === "at_risk",
        }
      )
    );
    for (const phase of state.phases) {
      nodes.push(
        node(
          "phase",
          `${state.clientSlug}:${phase.key}`,
          "phase",
          PHASE_LABEL[phase.key],
          [
            { label: "Status", value: phase.status.replace("_", " ") },
            { label: "Progress", value: `${phase.progress}%` },
          ],
          { status: phase.status.replace("_", " ") }
        )
      );
      // Open checklist items only — a completed task is not outstanding work. The matching rule
      // lives in relationships/derive, which owns the has_task edge; both must stay in agreement.
      phase.checklist.forEach((item, index) => {
        if (item.done) return;
        nodes.push(
          node("task", `${state.clientSlug}:${phase.key}:${index}`, "task", item.text, [
            { label: "Phase", value: PHASE_LABEL[phase.key] },
          ], { status: "open" })
        );
      });
    }
  }

  // ── Prospects ────────────────────────────────────────────────────────────────────────────────
  for (const prospect of prospects) {
    const fm = prospect.frontmatter;
    const status = fm.status ?? null;
    nodes.push(
      node(
        "prospect",
        prospect.slug,
        "prospect",
        fm.name ?? prospect.slug,
        [
          ...(status ? [{ label: "Status", value: status }] : []),
          { label: "Score", value: `${prospect.score.score}/${prospect.score.max} · ${prospect.score.tier}` },
          ...(fm.business_type ? [{ label: "Type", value: fm.business_type }] : []),
          ...(fm.location ? [{ label: "Location", value: fm.location }] : []),
        ],
        {
          status,
          // Attention is the SCORING ENGINE's tier, copied — not a threshold invented here.
          attention: prospect.score.tier === "priority" || prospect.score.tier === "hot",
        }
      )
    );
  }

  // ── Invoices ─────────────────────────────────────────────────────────────────────────────────
  for (const invoice of invoices) {
    // deriveInvoiceStatus is the domain's single owner of invoice lifecycle (D2). Copied, not re-derived.
    const status = deriveInvoiceStatus(invoice);
    nodes.push(
      node(
        "invoice",
        invoice.id,
        "invoice",
        `${invoice.label} · ${usd(invoice.amount_usd)}`,
        [
          { label: "Amount", value: usd(invoice.amount_usd) },
          { label: "Status", value: status },
          { label: "Issued", value: invoice.issued_at.slice(0, 10) },
          { label: "Due", value: invoice.due_at.slice(0, 10) },
          ...(invoice.paid_at ? [{ label: "Paid", value: invoice.paid_at.slice(0, 10) }] : []),
        ],
        { status, attention: status === "overdue" }
      )
    );
  }

  // ── Care plans ───────────────────────────────────────────────────────────────────────────────
  for (const care of careClients) {
    if (!care.retainer_active) continue; // the reader's own boolean, copied
    nodes.push(
      node(
        "care_plan",
        care.slug,
        "care_plan",
        `Care · ${care.name}`,
        [
          { label: "Status", value: "active" },
          ...(care.retainer_started ? [{ label: "Started", value: care.retainer_started }] : []),
          ...(care.last_care_invoice
            ? [{ label: "Last invoice", value: `${usd(care.last_care_invoice.amount_usd)} · ${care.last_care_invoice.paid_at.slice(0, 10)}` }]
            : []),
        ],
        { status: "active" }
      )
    );
  }

  // ── Documents ────────────────────────────────────────────────────────────────────────────────
  for (const record of documents) {
    const doc = record.meta;
    nodes.push(
      node(
        "document",
        doc.doc_id,
        "document",
        `${doc.title} v${doc.version}`,
        [
          { label: "Type", value: TYPE_LABEL[doc.type] },
          { label: "Status", value: STATUS_LABEL[doc.status] },
          { label: "Version", value: `v${doc.version}` },
          ...(doc.amount_usd !== undefined ? [{ label: "Amount", value: usd(doc.amount_usd) }] : []),
        ],
        { status: doc.status }
      )
    );
  }

  // ── Approvals ────────────────────────────────────────────────────────────────────────────────
  for (const approval of approvals) {
    // deriveApprovalStatus is the domain's single owner (was lib/portalTypes.approvalStatus).
    const status = deriveApprovalStatus(approval);
    nodes.push(
      node(
        "approval",
        String(approval.id),
        "approval",
        approval.title,
        [
          { label: "Kind", value: APPROVAL_KIND_LABEL[approval.kind] },
          { label: "Status", value: status },
          ...(approval.approved_by_name ? [{ label: "Signed by", value: approval.approved_by_name }] : []),
          ...(approval.due_at ? [{ label: "Due", value: approval.due_at.slice(0, 10) }] : []),
        ],
        { status, attention: status === "overdue" }
      )
    );
  }

  // ── Audits ───────────────────────────────────────────────────────────────────────────────────
  for (const audit of audits) {
    nodes.push(
      node(
        "audit",
        String(audit.id),
        "audit",
        `Audit · ${audit.strategy}`,
        [
          { label: "Strategy", value: audit.strategy },
          { label: "Run", value: audit.run_at.slice(0, 10) },
          { label: "Performance", value: audit.scores.performance === null ? "—" : String(audit.scores.performance) },
          { label: "SEO", value: audit.scores.seo === null ? "—" : String(audit.scores.seo) },
          { label: "Accessibility", value: audit.scores.accessibility === null ? "—" : String(audit.scores.accessibility) },
        ],
        { status: audit.strategy }
      )
    );
  }

  // ── Opportunities ────────────────────────────────────────────────────────────────────────────
  // Health signals are node STATE (above); opportunities are nodes. Together these cover 100% of
  // assembleFiringSignals() with zero duplication — see docs/GRAPH-CONTRACT.md §3.
  for (const opportunity of opportunities) {
    nodes.push(
      node(
        "opportunity",
        opportunity.id,
        "client", // an opportunity has no EntityKind of its own; it is about a client/prospect
        opportunity.title,
        [
          { label: "Severity", value: opportunity.severity },
          { label: "Why", value: opportunity.rationale },
          { label: "Next", value: opportunity.action },
        ],
        { status: opportunity.severity, attention: opportunity.severity === "urgent" }
      )
    );
    if (opportunity.target) {
      edges.push(
        edge("flags", `opportunity:${opportunity.id}`, `${opportunity.target.kind}:${opportunity.target.slug}`)
      );
    }
  }

  // ── SOPs + wikilinks — mapped straight through from the existing KnowledgeIndex ───────────────
  const indexNodeIds = new Set<string>();
  for (const indexNode of knowledgeIndex.nodes) {
    indexNodeIds.add(indexNode.id);
    if (indexNode.entity !== "sop") continue; // clients/prospects already projected above
    nodes.push(node("sop", indexNode.id, "sop", indexNode.title, [{ label: "Source", value: "SOP Library" }]));
  }

  // The index's edges are keyed by bare object id; map them onto our namespaced node ids.
  const byEntityId = new Map<string, GraphNode>();
  for (const n of nodes) byEntityId.set(n.entityId, n);
  for (const indexEdge of knowledgeIndex.edges) {
    const from = byEntityId.get(indexEdge.from);
    const to = byEntityId.get(indexEdge.to);
    if (!from || !to || from.id === to.id) continue; // unresolved → skip (DG-4.4.2)
    edges.push(edge("wikilink", from.id, to.id));
  }

  // ── Prune dangling edges (DG-4.4.2 — never fabricate a placeholder node) ──────────────────────
  const nodeIds = new Set(nodes.map((n) => n.id));
  const resolvedEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Deduplicate — a wikilink may restate a structural edge.
  const seenEdges = new Set<string>();
  const uniqueEdges = resolvedEdges.filter((e) => {
    if (seenEdges.has(e.id)) return false;
    seenEdges.add(e.id);
    return true;
  });

  // ── Real activity ────────────────────────────────────────────────────────────────────────────
  // Newest-first. Events that resolve to no node are DROPPED, never fabricated.
  const activity: GraphActivity[] = [];
  for (const event of [...events].reverse()) {
    const nodeId = resolveNodeId(event);
    if (!nodeId || !nodeIds.has(nodeId)) continue;
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) continue;
    activity.push({
      id: event.event_id,
      eventType: event.type,
      occurredAt: event.occurred_at,
      nodeId,
      summary: summarize(event, target.label),
    });
  }

  return {
    nodes,
    edges: uniqueEdges,
    activity,
    source: {
      name: "graph-view/projection (temporary)",
      builtAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: uniqueEdges.length,
    },
  };
}