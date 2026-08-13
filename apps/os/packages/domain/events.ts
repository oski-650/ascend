// domain/events.ts — the canonical event contract (Part IV §IV.4).
// One envelope, one type vocabulary; consumed by Timeline, Notifications, AI Memory,
// BI, Automations, and the Graph. The log itself is APPEND-ONLY — record stores
// (invoices, time_log, …) remain mutable read-models beside it (II.6).
// PURE: no fs, no vault, no Next.js, no core/engine imports.

import type { EventId, OrganizationId } from "./ids";

// ─── Actor ────────────────────────────────────────────────────────────────────

export type Actor = "operator" | "client" | "system" | `agent:${string}`;

// ─── Subject ──────────────────────────────────────────────────────────────────

/** Every entity kind an event can reference (IV.2: subject is a discriminated ref). */
export type EntityKind =
  | "organization"
  | "client"
  | "prospect"
  | "project"
  | "phase"
  | "task"
  | "time_entry"
  | "invoice"
  | "payment"
  | "care_plan"
  | "contract"
  | "document"
  | "asset"
  | "approval"
  | "portal_invite"
  | "portal_submission"
  | "automation_rule"
  | "firing"
  | "audit"
  | "notification"
  | "agent_job"
  | "workflow_run"
  | "memory"
  | "sop"
  | "knowledge";

export type EventSubject = { entity: EntityKind; entity_id: string };

// ─── Event type union (IV.4 — past-tense, matching the existing invoice.paid style) ──

export const EVENT_TYPES = [
  // Party
  "prospect.created",
  "prospect.status_changed",
  "prospect.contacted",
  "prospect.promoted",
  "client.created",
  "client.status_changed",
  "client.archived",
  // Delivery
  "project.created",
  "project.phase_started",
  "project.phase_completed",
  "project.phase_skipped",
  "project.checklist_toggled",
  "project.launched",
  "task.created",
  "task.status_changed",
  "time.started",
  "time.stopped",
  "time.logged",
  // Revenue
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.unpaid",
  "invoice.overdue", // clock-detected; emitted by a scheduled reconciler
  "payment.received",
  "careplan.started",
  "careplan.paused",
  "careplan.canceled",
  "contract.accepted",
  // Artifact
  "document.created",
  "document.sent",
  "document.accepted",
  "document.superseded",
  "asset.uploaded",
  // Collaboration
  "portal.invited",
  "portal.invite_revoked",
  "portal.submitted",
  "approval.requested",
  "approval.approved",
  "approval.overdue", // clock-detected
  "notification.raised",
  "notification.viewed",
  "notification.snoozed",
  "notification.resolved",
  "notification.dismissed",
  // Automation
  "automation.fired",
  "automation.dismissed",
  "agentjob.queued",
  "agentjob.started",
  "agentjob.completed",
  "agentjob.failed",
  "workflowrun.started",
  "workflowrun.completed",
  // Intelligence / AI
  "audit.recorded",
  "health.snapshotted",
  "observation.captured",
  "memory.distilled",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ─── Envelope (IV.4) — snake_case to match every other on-disk record ─────────

export type EventEnvelope = {
  event_id: EventId;
  type: EventType;
  occurred_at: string; // ISO
  actor: Actor;
  subject: EventSubject;
  organization_id: OrganizationId;
  data?: Record<string, unknown>;
  correlation_id?: string;
};

/** Caller-supplied portion; core/events fills event_id / occurred_at / actor / organization_id. */
export type NewEvent = {
  type: EventType;
  subject: EventSubject;
  data?: Record<string, unknown>;
  actor?: Actor;
  correlation_id?: string;
  occurred_at?: string;
};

// ─── Log routing (IV.7 #5: per-domain append logs behind one reader) ──────────

export type EventLogDomain =
  | "crm"
  | "production"
  | "finance"
  | "documents"
  | "portal"
  | "automation"
  | "intelligence"
  | "notifications";

export const EVENT_LOG_DOMAINS: EventLogDomain[] = [
  "crm",
  "production",
  "finance",
  "documents",
  "portal",
  "automation",
  "intelligence",
  "notifications",
];

const PREFIX_TO_DOMAIN: Record<string, EventLogDomain> = {
  prospect: "crm",
  client: "crm",
  project: "production",
  task: "production",
  time: "production",
  invoice: "finance",
  payment: "finance",
  careplan: "finance",
  contract: "finance",
  document: "documents",
  asset: "documents",
  portal: "portal",
  approval: "portal",
  notification: "notifications",
  automation: "automation",
  agentjob: "automation",
  workflowrun: "automation",
  audit: "intelligence",
  health: "intelligence",
  observation: "intelligence",
  memory: "intelligence",
};

/** Which per-domain log file an event type belongs to (`<domain>.events.jsonl`). */
export function eventLogDomainFor(type: EventType): EventLogDomain {
  const prefix = type.split(".", 1)[0];
  const domain = PREFIX_TO_DOMAIN[prefix];
  if (!domain) throw new Error(`No event log domain mapped for event type "${type}"`);
  return domain;
}
