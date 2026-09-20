// domain/events.ts — the canonical event contract (Part IV §IV.4).
// One envelope, one type vocabulary; consumed by Timeline, Notifications, AI Memory,
// BI, Automations, and the Graph. The log itself is APPEND-ONLY — record stores
// (invoices, time_log, …) remain mutable read-models beside it (II.6).
// PURE: no fs, no vault, no Next.js, no core/engine imports.

import type { EventId, OrganizationId, UserId } from "./ids";

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
  /**
   * A HUMAN recorded a website-opportunity judgment (green/yellow/red).
   *
   * The only genuinely operator-caused event in the intake pipeline, and it should be: it is the
   * one step where a person adds information rather than Ascend recording what it found. Import and
   * research are `actor: "system"` precisely so this stays distinguishable from them.
   */
  "prospect.assessed",
  /**
   * An operator appended a note to a prospect's log (008).
   *
   * `actor: "operator"`, and unlike almost everything else in the intake pipeline that is correct
   * rather than convenient: a note is a person writing prose in their own voice, which is the
   * definition §19 is counting when it measures operator-caused events. Import and research stay
   * `system`; this does not.
   *
   * The note's TEXT is not carried in the event. `prospect_notes` is the record, this is the
   * provenance that it happened — F21's "every durable state transition must have an observable
   * provenance" — and duplicating the prose into an append-only spine would mean an owner deleting
   * a note left a full copy of it behind in a table nobody can delete from.
   */
  "prospect.note_added",
  /**
   * Ascend LOOKED for this business's website, and this is what it saw.
   *
   * `actor: "system"` — the machine did the looking, and §19's operator count must not absorb it.
   *
   * ─── THE EVENT IS EMITTED WHETHER OR NOT ANYTHING WAS FOUND, AND THAT IS THE POINT ──────────
   *
   * A run that finds a site writes `website` and records why. A run that finds NOTHING writes no
   * prospect field at all — `website_quality` stays unstated — and records the attempt: which
   * addresses were tried, on what basis, and how each failed.
   *
   * That asymmetry is the whole design. `computeScore` pays +30 for `website_quality: 'none'`,
   * exactly the `warm` threshold, and its own comment records what happened last time an unchecked
   * blank was read as an assertion: *"at the scale of a bulk import it makes the entire ranking
   * meaningless."* A failed probe is indistinguishable from slow DNS, a blocked crawler, or a domain
   * nobody guessed — so it may establish that Ascend LOOKED, and never that the business has no
   * site. A human converts the observation into a claim, or nobody does.
   */
  "prospect.website_researched",
  "prospect.promoted",
  // D1a: a prospect removed from the vault hit list, in vault mode. The Postgres-owned operation
  // is ARCHIVE, which is a different fact and has its own type below.
  "prospect.deleted",
  /**
   * D1b: a Postgres-owned prospect removed from the ACTIVE hit list, with everything kept.
   *
   * NOT A WEAKER `prospect.deleted`, and the distinction is the point. `deleted` says the record is
   * gone; `archived` says the business left the working list and its notes, identity and history are
   * still here. Reusing one type for both would make the spine unable to answer which happened —
   * and a reader that cannot tell retention from destruction cannot reconstruct anything.
   *
   * Appended in the SAME transaction as the row update, so there is no state where a prospect is
   * archived with no memory of who archived it. Carries `actor_user_id` (an operator event must name
   * its human) and an optional stated `reason`.
   */
  "prospect.archived",
  /**
   * ─── THE SHEET SAID · Stage 2 intake evidence (STAGE2-SHEETS-INTAKE §1.2, §1.3, §7.3(c)) ─────
   *
   * Two types, one act. A batch is imported; each of its rows is received verbatim. Both are
   * `actor: "system"` — Ascend authored these records, not the operator, which is the same ruling
   * `app/api/import/prospects/route.ts` already makes and for the same reason: one paste must not
   * manufacture hundreds of operator-caused events for §19's threshold to count.
   *
   * That route's own comment anticipated these: *"the domain has no event for 'an operator ran an
   * import' … when the reviewed ingest stage lands it can carry a batch subject."* This is that
   * stage, and these are that subject.
   *
   * SUBJECT IS THE ORGANIZATION, deliberately. An import is an act upon the organization's prospect
   * universe, and a row that matched nothing is not a prospect to point at — §1.3 keeps such rows
   * with `prospect_id: null` precisely because "we received this row and did not act on it" is the
   * fact a reviewer needs. Adding an `import_batch` EntityKind was considered and rejected: the
   * union feeds `graph-view`'s taxonomy, so a 26th kind would ripple into a layer this slice is
   * gated out of. The batch's identity travels in `correlation_id`, which is what it is for.
   */
  "prospect.batch_imported",
  "prospect.row_received",
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
  // A document's status moving in ANY direction, carrying `data: { from, to }`.
  //
  // The forward types above name real-world ACTS: `document.sent` means the document was sent to
  // the client, not that it entered the sent state. Reusing it for a revert INTO sent would corrupt
  // that meaning, so reversals — which the UI genuinely offers ("Back to draft", "Back to sent") —
  // get this direction-neutral type instead. Exactly one event per transition either way.
  "document.status_changed",
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
  /**
   * WHICH human acted — required whenever `actor` is "operator", absent otherwise (Stage 2A).
   *
   * `actor` is the KIND of principal and its vocabulary is unchanged. This names the person, so that
   * a second human using the OS does not silently inflate §19's pre-registered adoption metric: that
   * measurement is scoped to one `actor_user_id` and travels unchanged, per its own failure
   * semantics. The database enforces the pairing with a CHECK; nothing here relies on convention.
   */
  actor_user_id?: UserId;
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
  actor_user_id?: UserId;
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
