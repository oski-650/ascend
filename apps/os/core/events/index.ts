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
 * Unified read over all per-domain logs, merged into one ascending sequence.
 *
 * ORDERING CONTRACT — three signals, each doing only its own job:
 *   `occurred_at`  temporal ordering ACROSS logs.
 *   log position   deterministic ordering WITHIN a log — the physical append sequence.
 *   `event_id`     identity. NOT ordering.
 *
 * The invariant this guarantees:
 *
 *   If B was appended after A to the same log, readEvents never returns B before A —
 *   even when occurred_at(A) === occurred_at(B).
 *
 * Why it is not event_id: `newEventId()` is a UUIDv7 whose sub-millisecond bits are pure random
 * (only bytes 0-5 carry the timestamp), so tie-breaking on it inverted same-millisecond pairs ~52%
 * of the time — no ordering information whatsoever. One operator action can emit two causally
 * ordered events (rotating an invite revokes then issues; versioning supersedes then creates), so
 * that coin flip could present an effect before its cause. The log's own append order is the
 * strongest causal signal available and it is already authoritative, so the reader uses it. The
 * identity primitive is left alone.
 *
 * Cross-log ties (same millisecond, different domains) have no true causal order to recover; they
 * are broken by the domain's position in EVENT_LOG_DOMAINS purely so the result is deterministic.
 *
 * `limit` keeps the most recent N while preserving ascending order; callers wanting newest-first
 * reverse.
 */
export async function readEvents(filter: EventFilter = {}): Promise<EventEnvelope[]> {
  const domains = filter.domains ?? EVENT_LOG_DOMAINS;
  const perDomain = await Promise.all(
    domains.map((d) => readJsonlFile<EventEnvelope>(eventsLogPath(d)))
  );

  // Positional keys are attached here, where append order is still known, and dropped before
  // returning: EventEnvelope is the domain contract and gains no ordering field.
  type Positioned = { event: EventEnvelope; log: number; seq: number };
  let positioned: Positioned[] = perDomain.flatMap((events, log) =>
    events.map((event, seq) => ({ event, log, seq }))
  );

  if (filter.types) {
    const wanted = new Set<string>(filter.types);
    positioned = positioned.filter((p) => wanted.has(p.event.type));
  }
  if (filter.entity) positioned = positioned.filter((p) => p.event.subject?.entity === filter.entity);
  if (filter.entity_id)
    positioned = positioned.filter((p) => p.event.subject?.entity_id === filter.entity_id);
  if (filter.since) positioned = positioned.filter((p) => p.event.occurred_at >= filter.since!);
  if (filter.until) positioned = positioned.filter((p) => p.event.occurred_at <= filter.until!);

  positioned.sort(
    (a, b) =>
      a.event.occurred_at.localeCompare(b.event.occurred_at) || a.log - b.log || a.seq - b.seq
  );

  let events = positioned.map((p) => p.event);
  if (filter.limit !== undefined && events.length > filter.limit) {
    events = events.slice(events.length - filter.limit);
  }
  return events;
}
