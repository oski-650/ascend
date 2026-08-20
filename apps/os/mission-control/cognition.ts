// mission-control/cognition — the activation adapter (docs/COGNITION-N1.md §3).
//
// The seam is fixed:  EventEnvelope -> ActivationAdapter -> Activation -> cognition.
//
// Cognition never consumes an EventEnvelope. Everything impure lives here: reading the spine,
// reading structural context, choosing `now`. The layer below receives plain values and is a pure
// function of them, which is what makes the whole thing reproducible.

import "server-only";

import { readEvents } from "@/core/events";
import { listProductionStates } from "@/core/production";
import { foldCognitiveState } from "@/cognition/cooccurrence";
import type { Activation, CognitiveState, StructuralPair } from "@/cognition/contract";
import type { EventEnvelope } from "@/domain";

const SOURCE_NAME = "event-spine.v1";

/**
 * Whether an event becomes an activation.
 *
 * THE EXCLUSION RULE, enforced here and nowhere else. The reconciler sweeps the entire vault in one
 * pass, so every object it touches shares a near-identical occurred_at. Fed to any
 * interval-sensitive rule, every pair in a sweep reinforces maximally and the strongest thing the
 * system learns is that the reconciler ran — currently 17 of 27 events.
 *
 * It lives at the adapter rather than inside the fold on purpose. An exclusion buried in a learning
 * function is one refactor from being lost and must be re-implemented correctly by every future
 * mechanism; here it holds once, for every consumer, permanently. What it drops is reported on
 * CognitiveState.source.excludedCount, so the filter is an observable number rather than a silent
 * one, and algorithms downstream may assume every activation they receive is legitimate.
 */
function isLearnable(event: EventEnvelope): boolean {
  return event.actor !== "system";
}

/**
 * One event becomes exactly one activation, from `subject` alone.
 *
 * Backrefs in `data` (project.created carries client_slug) are deliberately NOT read. A backref is
 * a foreign key — structural, not observed co-occurrence — and deriving a second activation from it
 * would manufacture a client/project co-activation out of a single structural fact. The layer would
 * then spend its life rediscovering the schema and reporting it as learning.
 *
 * Activations come from what happened, never from what is related.
 *
 * `ordinal` is the index in the RETAINED stream, assigned after exclusion. It is a causal-ordering
 * signal within the learning stream, not an address in the spine: were it to carry the gaps left by
 * excluded events, "adjacent" would become ambiguous. The link back is preserved exactly once, in
 * provenance.eventId.
 *
 * `intensity` is uniform at N1. The roadmap's intensity table presumes interaction types that do
 * not exist here, and 8 of the 10 retained events are a single type — there is nothing to rank, and
 * inventing a ranking would be a guess wearing the costume of a measurement.
 */
function toActivation(event: EventEnvelope, ordinal: number): Activation {
  return {
    subject: event.subject,
    at: event.occurred_at,
    ordinal,
    intensity: 1,
    provenance: { source: "event", eventId: event.event_id },
  };
}

/**
 * Structural pairs, so the fold can label an association it did not discover.
 *
 * Derived from the canonical production reader, NOT from the graph: F22.4 keeps cognition away from
 * graph-view, and F11 keeps this layer away from the projection and the index. A project's id is
 * its client's slug, which is the same fact the projection uses to draw `has_project`; both read it
 * from the same place rather than one deriving it from the other.
 */
async function structuralPairs(): Promise<StructuralPair[]> {
  const states = await listProductionStates();
  return states.map((state) => ({
    a: `client/${state.clientSlug}`,
    b: `project/${state.clientSlug}`,
  }));
}

/**
 * Assemble cognitive state from the event spine.
 *
 * `now` defaults here and is injected downward, matching every other orchestrator in this
 * directory. The fold reads no clock of its own.
 */
export async function assembleCognitiveState(now: Date = new Date()): Promise<CognitiveState> {
  const [events, pairs] = await Promise.all([readEvents(), structuralPairs()]);

  const retained = events.filter(isLearnable);
  const activations = retained.map(toActivation);

  return foldCognitiveState({
    activations,
    structuralPairs: pairs,
    excludedCount: events.length - retained.length,
    sourceName: SOURCE_NAME,
    now,
  });
}
