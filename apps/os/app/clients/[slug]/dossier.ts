// app/clients/[slug]/dossier — SURFACE-OWNED gathering for the Client and Project views.
//
// This is presentation-layer SELECTION, not a new layer and not an intelligence engine. It is
// colocated with the routes it serves precisely so it cannot be mistaken for one.
//
// WHAT IT DOES: calls existing canonical readers and Mission Control assemblers, then narrows their
// output to one client by identity. Mission Control's assemblers are global by design
// (`assembleHealthOverview()`, `assemblePriorityFeed()`, …) and every item they return already
// carries its own client key, so narrowing is a `filter` on an id — the same "select + reshape"
// operation mission-control/kpis.ts documents itself as performing.
//
// WHAT IT MUST NEVER DO — no sums, averages, thresholds, scoring, ranking, health derivation, or
// status derivation. Every value below is copied from the module that owns it. Decision's ordering
// is preserved verbatim; `rank()` is never imported here (F14 is absolute).
//
// It performs no filesystem access of its own and emits no events.

import "server-only";

import { getClient } from "@/core/crm";
import { getProductionState } from "@/core/production";
import { listInvoices } from "@/core/finance";
import { readEvents } from "@/core/events";
import { assembleHealthOverview, assemblePriorityFeed } from "@/mission-control";
import { listDocuments } from "@/lib/documents";
import { listApprovalRequests } from "@/lib/portal";
import { listAudits } from "@/lib/audits";
import { deriveApprovalStatus, deriveInvoiceStatus, type EventEnvelope } from "@/domain";
import { routeForEntity } from "@/navigation/routing";
import { focusHrefFor } from "@/graph-view/contract";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import type { ActivityItem } from "@/components/primitives/entity";
import type { HealthTile } from "@/mission-control";
import type { PriorityItem } from "@/engines/decision-engine";
import type { Client } from "@/core/crm";
import type { ProductionState } from "@/core/production";

export type InvoiceView = {
  id: string;
  label: string;
  amountUsd: number;
  status: string;
  issuedAt: string;
  dueAt: string;
};

export type DocumentView = { docId: string; title: string; version: number; type: string; status: string };
export type ApprovalView = { id: string; title: string; kind: string; status: string };
export type AuditView = { id: string; strategy: string; runAt: string; performance: number | null };

export type ClientDossier = {
  client: Client;
  production: ProductionState | null;
  /** Health as the Health Engine produced it, via Mission Control. `null` when no project exists. */
  health: HealthTile["health"] | null;
  invoices: InvoiceView[];
  documents: DocumentView[];
  approvals: ApprovalView[];
  audits: AuditView[];
  /** Decision-ranked items whose subject IS this client. Order preserved exactly. */
  attention: PriorityItem[];
  /** Events whose subject id is this client or its project. Newest first. */
  activity: EventEnvelope[];
};

/** How many recent events a dossier surfaces. A presentation limit, not a business rule. */
const ACTIVITY_LIMIT = 8;

/**
 * Gather everything both entity views need for one client.
 * Returns `null` when the client does not exist, so the route can render a real 404.
 */
export async function getClientDossier(slug: string): Promise<ClientDossier | null> {
  const client = await getClient(slug);
  if (!client) return null;

  const [production, healthTiles, allInvoices, documents, approvals, audits, priority, events] =
    await Promise.all([
      getProductionState(slug),
      assembleHealthOverview(), // Mission Control invokes the Health Engine — the surface never does
      listInvoices(),
      listDocuments({ client: slug, includeSuperseded: true }),
      listApprovalRequests(slug),
      listAudits(slug),
      assemblePriorityFeed(), // Decision's ranked output, consumed in Decision's order
      readEvents({ limit: 200 }),
    ]);

  // ── Narrow by identity. Every filter below compares an id; none derives a fact. ──
  const health = healthTiles.find((t) => t.clientSlug === slug)?.health ?? null;

  const invoices: InvoiceView[] = allInvoices
    .filter((inv) => inv.client === slug)
    .map((inv) => ({
      id: inv.id,
      label: inv.label,
      amountUsd: inv.amount_usd,
      // The domain deriver owns invoice lifecycle (D2). Copied, never re-derived here.
      status: deriveInvoiceStatus(inv),
      issuedAt: inv.issued_at,
      dueAt: inv.due_at,
    }));

  const attention = priority.filter((item) => item.subject.id === slug);

  // A client's events are those about the client itself and about its 1:1 project (same slug).
  const activity = events
    .filter((e) => e.subject?.entity_id === slug)
    .reverse()
    .slice(0, ACTIVITY_LIMIT);

  return {
    client,
    production,
    health,
    invoices,
    documents: documents.map((d) => ({
      docId: d.meta.doc_id,
      title: d.meta.title,
      version: d.meta.version,
      type: d.meta.type,
      status: d.meta.status,
    })),
    approvals: approvals.map((a) => ({
      id: String(a.id),
      title: a.title,
      kind: a.kind,
      status: deriveApprovalStatus(a), // domain deriver, copied
    })),
    audits: audits.map((a) => ({
      id: String(a.id),
      strategy: a.strategy,
      runAt: a.run_at,
      performance: a.scores.performance,
    })),
    attention,
    activity,
  };
}

// ─── Presentation formatting (single values only — no aggregation) ─────────────────────────────

export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

/** Human sentence for an event. Phrasing only — derives nothing. Mirrors graph-view/projection. */
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
  "prospect.promoted": "Promoted from prospect",
  "document.created": "Document created",
  "document.sent": "Document sent",
  "document.accepted": "Document accepted",
  "document.superseded": "Document superseded",
  "approval.requested": "Approval requested",
  "approval.approved": "Approval signed",
  "portal.invited": "Portal invite issued",
  "portal.submitted": "Client submitted the portal form",
  "audit.recorded": "Site audit recorded",
  "time.logged": "Time logged",
  "careplan.started": "Care plan started",
};

export function eventLabel(type: string): string {
  return EVENT_VERB[type] ?? type.replace(/[._]/g, " ");
}

/**
 * A qualifier copied from the event's own `data` payload — e.g. which phase a checklist toggle
 * touched. Without it a run of checklist events renders as six identical lines. This SELECTS an
 * existing field; it derives nothing and invents nothing when the field is absent.
 */
export function eventQualifier(event: EventEnvelope): string | null {
  const data = event.data;
  if (!data) return null;
  const phase = data.phase;
  if (typeof phase === "string" && phase.length > 0) return phase;
  const label = data.label;
  if (typeof label === "string" && label.length > 0) return label;
  return null;
}

/**
 * Events → renderable activity, with both return paths resolved.
 *
 * THE RETURN PATH. `EventSubject` is `{ entity: EntityKind, entity_id: string }` — exactly the
 * signature of `routeForEntity` (entity → route) and `graphNodeIdFor` (entity → graph identity).
 * Every event has therefore always known where it points; nothing rendered it. This maps that
 * existing field through the two canonical owners and adds no data of its own.
 *
 * An entity with no detail route, or one the graph cannot represent, yields `null` for that link
 * and renders inert. Destinations are never invented.
 */
export function toActivityItems(events: EventEnvelope[]): ActivityItem[] {
  return events.map((event) => {
    const subject = event.subject;
    return {
      id: event.event_id,
      label: eventLabel(event.type),
      qualifier: eventQualifier(event),
      when: relativeTime(event.occurred_at),
      href: subject ? routeForEntity(subject.entity, subject.entity_id) : null,
      focusHref: subject ? focusHrefFor(subject.entity, subject.entity_id) : null,
      dotColor: subject && subject.entity in NODE_VISUAL
        ? NODE_VISUAL[subject.entity as keyof typeof NODE_VISUAL].color
        : undefined,
    };
  });
}