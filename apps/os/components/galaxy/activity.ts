// components/galaxy/activity — RECENT-EVENT ACTIVATION (Slice 8).
//
// A pure derivation: real events + the drawn objects + one clock reading → which objects should
// briefly acknowledge that something happened to them. No React, no canvas, no DOM, no I/O.
//
// It reads NO business field. Not weight, not health, not attention, not type. An object qualifies
// because a real, authorized event names it and that event is recent — and for no other reason. The
// input type below is deliberately structural rather than `GraphActivity` imported from the graph
// contract: this layer needs four fields, not the contract, and taking them structurally keeps the
// renderer's import boundary exactly where F65 already draws it.
//
// ─── THE GATE THAT MAKES THIS HONEST ───────────────────────────────────────────────────────────
//
// `graph-view/projection` builds its activity list from `readEvents({ limit: 60 })` — the newest
// SIXTY visible events, which is a COUNT bound, not a time bound. On a quiet vault those sixty may
// span months; on a busy one, minutes. **Membership in that list is not recency**, and treating it
// as recency would animate months-old events as though they had just happened.
//
// So age is computed here from the event's own `occurredAt` and checked against a window. Anything
// outside it simply does not qualify, no matter how near the top of the list it sits.
//
// ─── AGE IS A GATE, NEVER A MAGNITUDE ──────────────────────────────────────────────────────────
//
// Qualification is BINARY and every qualifying object is treated identically. Nothing here returns
// an intensity, a rank, or a count. Three reasons, each a hazard this avoids:
//
//   • intensity varying with age would let a viewer rank objects by recency, and recency is not
//     importance — nothing in the business says a newer event matters more than an older one;
//   • intensity varying with event count would be a business-volume metric invented by a renderer;
//   • several activations on one object would be the same metric wearing a different coat.
//
// Hence one activation per object, from its newest qualifying event, and no number attached.
//
// ─── THE WINDOW IS A DISPLAY CHOICE, NOT A DEFINITION OF "RECENT" ──────────────────────────────
//
// Twenty-four hours is a PRESENTATION ELIGIBILITY WINDOW. Ascend OS has no business definition of
// "recent", this does not invent one, and nothing downstream may read the window as a claim that a
// 23-hour-old event is current and a 25-hour-old one is stale. It decides only what the picture
// bothers to acknowledge on this visit.

/** The four fields this derivation needs. `GraphActivity` satisfies it structurally. */
export type ActivityRecord = {
  /** The event's own id — carried so an activation can be traced back to what caused it. */
  id: string;
  /** The drawn object the event landed on. */
  nodeId: string;
  /** ISO timestamp, straight from the event spine. */
  occurredAt: string;
  /** The sentence its owner already wrote. This layer never composes one. */
  summary: string;
};

/** What one object acknowledges. Carries no intensity, no rank, and no count — see above. */
export type Activation = {
  /** The event that qualified it. */
  eventId: string;
  /** The owner's own sentence, carried verbatim for the non-visual surface. */
  summary: string;
  /** The event's timestamp, so a surface can state it without re-deriving anything. */
  occurredAt: string;
};

/**
 * The visual activation eligibility window: 24 hours.
 *
 * NOT a business definition of "recent" — see the note above. It is how long the picture will
 * acknowledge an event, and nothing else depends on it.
 */
export const ACTIVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which drawn objects have a qualifying recent event.
 *
 * `drawn` is the set of ids the scene ACTUALLY CONTAINS, not the projection's. That is what makes
 * this incapable of lighting up an object the operator cannot see: an event naming a node dropped by
 * the detail level, or naming nothing at all, is discarded rather than repaired. It is the same
 * "drop, never fabricate" rule the event projection and the scene already apply, at the one place
 * where events and drawn objects meet.
 *
 * Pure and total: same inputs, same map, and no input is mutated.
 */
export function qualifyingActivations(
  activity: readonly ActivityRecord[],
  drawn: ReadonlySet<string>,
  now: number
): Map<string, Activation> {
  const out = new Map<string, Activation>();

  for (const record of activity) {
    // An object that is not on screen cannot acknowledge anything, and an unmatched id is not a
    // reason to invent one.
    if (!drawn.has(record.nodeId)) continue;

    const at = Date.parse(record.occurredAt);
    // A hand-edited vault can hold anything. An unparseable timestamp is not an event that happened
    // at an unknown time — it is a value this layer has no honest way to place, so it is ignored.
    if (!Number.isFinite(at)) continue;

    const age = now - at;
    // A future timestamp cannot describe something that has already happened. Ignored rather than
    // clamped: clamping would present a clock error as a very recent event.
    if (age < 0) continue;
    if (age > ACTIVATION_WINDOW_MS) continue;

    // COALESCE: one activation per object, from its NEWEST qualifying event. Keeping several would
    // make a busy object visibly busier, which is a volume metric no reader produced.
    const held = out.get(record.nodeId);
    if (held && Date.parse(held.occurredAt) >= at) continue;
    out.set(record.nodeId, {
      eventId: record.id,
      summary: record.summary,
      occurredAt: record.occurredAt,
    });
  }

  return out;
}
