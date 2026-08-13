// core/events — the append-only event spine of Ascend OS (Part IV §IV.4/§IV.5).
//
// The SOLE append path for events. Per-domain logs (`.ascend-os/<domain>.events.jsonl`)
// behind one unified reader. Events are immutable facts: never mutated, never deleted.
// Record stores (invoices.jsonl, time_log.jsonl, …) remain the mutable read-models
// beside this log (Part II §II.6).
//
// Consumers: Global Timeline, Notification Engine, AI Memory, BI, Automations, Graph.
// Forbidden here: mutating/deleting events; interpreting them.

import "server-only";
import type { EventEnvelope, EventLogDomain, EventType, NewEvent } from "@/domain";
import { EVENT_LOG_DOMAINS, ORGANIZATION_ID, eventLogDomainFor, newEventId } from "@/domain";
import { eventsLogPath } from "@/core/vault/paths";
import { appendJsonlLine, readJsonlFile } from "@/core/vault/io";

/**
 * Append one event. Fills event_id (UUIDv7), occurred_at, actor (default "operator"),
 * and organization_id. Routes to the event type's per-domain log file.
 *
 * Call this FROM INSIDE the same core/lib write operation that mutates the record —
 * emission is part of the write, never the route handler's separate job (IV.7 risk #1).
 */
export async function emitEvent(input: NewEvent): Promise<EventEnvelope> {
  const envelope: EventEnvelope = {
    event_id: newEventId(),
    type: input.type,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    actor: input.actor ?? "operator",
    subject: input.subject,
    organization_id: ORGANIZATION_ID,
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.correlation_id !== undefined ? { correlation_id: input.correlation_id } : {}),
  };
  await appendJsonlLine(eventsLogPath(eventLogDomainFor(input.type)), envelope);
  return envelope;
}

export type EventFilter = {
  /** Restrict to these per-domain logs (default: all). */
  domains?: EventLogDomain[];
  /** Restrict to these event types. */
  types?: EventType[];
  /** Restrict to events about this subject. */
  entity?: EventEnvelope["subject"]["entity"];
  entity_id?: string;
  /** ISO bounds on occurred_at (inclusive). */
  since?: string;
  until?: string;
  /** Keep only the most recent N (applied after sorting). */
  limit?: number;
};

/**
 * Unified read over all per-domain logs, merged and sorted ascending by occurred_at
 * (tie-broken by event_id — UUIDv7, so creation order wins). `limit` keeps the most
 * recent N while preserving ascending order; callers wanting newest-first reverse.
 */
export async function readEvents(filter: EventFilter = {}): Promise<EventEnvelope[]> {
  const domains = filter.domains ?? EVENT_LOG_DOMAINS;
  const perDomain = await Promise.all(
    domains.map((d) => readJsonlFile<EventEnvelope>(eventsLogPath(d)))
  );

  let events = perDomain.flat();

  if (filter.types) {
    const wanted = new Set<string>(filter.types);
    events = events.filter((e) => wanted.has(e.type));
  }
  if (filter.entity) events = events.filter((e) => e.subject?.entity === filter.entity);
  if (filter.entity_id) events = events.filter((e) => e.subject?.entity_id === filter.entity_id);
  if (filter.since) events = events.filter((e) => e.occurred_at >= filter.since!);
  if (filter.until) events = events.filter((e) => e.occurred_at <= filter.until!);

  events.sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id)
  );

  if (filter.limit !== undefined && events.length > filter.limit) {
    events = events.slice(events.length - filter.limit);
  }
  return events;
}
