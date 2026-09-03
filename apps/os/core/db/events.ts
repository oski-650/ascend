// core/db/events — the event spine, on Postgres.
//
// Mirrors core/events' contract exactly, because that contract was argued for and is not being
// reopened. What changes is only where the ordering signal comes from:
//
//   vault:     occurred_at → log position → (event_id is NOT ordering)
//   postgres:  occurred_at → seq          → (event_id is NOT ordering)
//
// `seq` is strictly stronger than log position: durable, total, and immune to file merges. The rule
// it replaces is unchanged in spirit — the identity primitive still orders nothing, because a
// UUIDv7's sub-millisecond bits are pure random and inverted same-millisecond pairs ~52% of the
// time. That finding cost a real investigation; it carries over.
//
// FORBIDDEN HERE, as in core/events: mutating or deleting an event, or interpreting one. The schema
// enforces the first with a trigger rather than trusting this comment.

import "server-only";
import type { EventEnvelope, EventType, NewEvent, OrganizationId, UserId } from "@/domain";
import { newEventId } from "@/domain";
import { visibleTo } from "@/core/events";
import { requireCaller } from "@/core/auth/authority";
import type { SqlClient } from "./client";

type Row = {
  event_id: string; type: string; occurred_at: Date; actor: string;
  actor_user_id: string | null; subject_entity: string; subject_entity_id: string;
  organization_id: string; data: Record<string, unknown> | null; correlation_id: string | null;
};

function toEnvelope(r: Row): EventEnvelope {
  return {
    event_id: r.event_id as EventEnvelope["event_id"],
    type: r.type as EventType,
    occurred_at: new Date(r.occurred_at).toISOString(),
    actor: r.actor as EventEnvelope["actor"],
    ...(r.actor_user_id ? { actor_user_id: r.actor_user_id as UserId } : {}),
    subject: { entity: r.subject_entity as EventEnvelope["subject"]["entity"], entity_id: r.subject_entity_id },
    organization_id: r.organization_id as OrganizationId,
    ...(r.data !== null ? { data: r.data } : {}),
    ...(r.correlation_id !== null ? { correlation_id: r.correlation_id } : {}),
  };
}

/**
 * Append one event. The sole append path, exactly as core/events is for the vault.
 *
 * Call this FROM INSIDE the write that mutates the record, never as the route handler's separate
 * job — the emit-with-the-write rule F21 exists to protect. Passing the same `tx` is what makes the
 * event and the state change atomic, which the JSONL spine could never guarantee: there, a crash
 * between the file write and the append left state with no memory.
 */
export async function appendEvent(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: NewEvent
): Promise<EventEnvelope> {
  const envelope: EventEnvelope = {
    event_id: newEventId(),
    type: input.type,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    actor: input.actor ?? "operator",
    ...(input.actor_user_id ? { actor_user_id: input.actor_user_id } : {}),
    subject: input.subject,
    organization_id: organizationId,
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.correlation_id !== undefined ? { correlation_id: input.correlation_id } : {}),
  };

  await tx.query(
    `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                         subject_entity, subject_entity_id, data, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      envelope.event_id, organizationId, envelope.type, envelope.occurred_at, envelope.actor,
      envelope.actor_user_id ?? null, envelope.subject.entity, envelope.subject.entity_id,
      envelope.data ? JSON.stringify(envelope.data) : null, envelope.correlation_id ?? null,
    ]
  );
  return envelope;
}

export type EventFilter = {
  types?: EventType[];
  entity?: EventEnvelope["subject"]["entity"];
  entity_id?: string;
  since?: string;
  until?: string;
  /** Restrict to events caused by one human — the §19 scoping seam. */
  actorUserId?: UserId;
  limit?: number;
};

/**
 * Read events in ascending order. Same guarantee the JSONL reader gave:
 *
 *   if B was appended after A, readEvents never returns B before A — even at equal occurred_at.
 *
 * `limit` keeps the most RECENT n while preserving ascending order, matching core/events, so a
 * caller that swaps stores sees no behavioural difference.
 */
/**
 * ─── THE SAME VISIBILITY MODEL AS THE VAULT SPINE, AND FOR THE SAME REASON ─────────────────────
 *
 * `core/events` and this module expose the same conceptual surface — business history — so a
 * capability filter that existed on one and not the other would be a vault-only special case, and
 * the store a deployment happens to select would decide what a principal may read. That is the
 * split-brain shape 2C removed, arriving as an authorization difference instead of a data one.
 *
 * **RLS REMAINS THE TENANT BOUNDARY AND IS NOT REPLACED.** `events_read … USING (organization_id =
 * current_org())` still decides which ORGANIZATION's rows exist for this session; the capability
 * filter decides which of those rows this PRINCIPAL may see. Two boundaries, different questions,
 * neither substituting for the other — and the schema is untouched.
 */
export async function readEvents(tx: SqlClient, filter: EventFilter = {}): Promise<EventEnvelope[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (filter.types?.length) add("type = ANY(?)", filter.types);
  if (filter.entity) add("subject_entity = ?", filter.entity);
  if (filter.entity_id) add("subject_entity_id = ?", filter.entity_id);
  if (filter.since) add("occurred_at >= ?", filter.since);
  if (filter.until) add("occurred_at <= ?", filter.until);
  if (filter.actorUserId) add("actor_user_id = ?", filter.actorUserId);

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // The limit is applied to the TAIL, then re-sorted ascending — the same two-step the JSONL reader
  // performed by slicing the end of a sorted array.
  const sql = filter.limit
    ? `SELECT * FROM (SELECT * FROM events ${clause} ORDER BY occurred_at DESC, seq DESC
         LIMIT ${Number(filter.limit)}) t ORDER BY occurred_at ASC, seq ASC`
    : `SELECT * FROM events ${clause} ORDER BY occurred_at ASC, seq ASC`;

  const { rows } = await tx.query<Row>(sql, params as never);
  // Resolved once, fail-closed, and applied AFTER RLS has already decided which organization's rows
  // exist — the capability filter narrows within a tenant, it never widens across one.
  const principal = await requireCaller();
  return rows.map(toEnvelope).filter((e) => visibleTo(principal, e.type));
}

/**
 * Events attributable to ONE human — the §19 measurement seam.
 *
 * §19 pre-registers its metric and forbids widening it. A second person using the OS would silently
 * inflate an unscoped count, which is an accidental redefinition rather than an observation. So the
 * measurement is scoped by `actor_user_id` and the original operator's number travels unchanged;
 * anyone else's adoption is a SEPARATE metric with its own pre-registration.
 */
export async function countOperatorBusinessEvents(tx: SqlClient, userId: UserId): Promise<number> {
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events
      WHERE actor = 'operator' AND actor_user_id = $1 AND type <> 'observation.captured'`,
    [userId]
  );
  return Number(rows[0]?.n ?? 0);
}
