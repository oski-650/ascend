// cognition/cooccurrence — the learning mechanism. See docs/COGNITION-N1.md and COGNITION-N2.md.
//
// N1 answers "what relationships does the evidence support?" and owns, exclusively, what counts as
// evidence. N2 answers "which of those are still cognitively relevant?" and may not loosen a single
// evidence rule to make its own results more interesting. Neither asks which relationships are TRUE
// (outside cognition entirely), nor what anyone should do about them (the Decision Engine).
//
// THREE AXES, and only one of them plastic:
//
//     strength    what the evidence built           monotonically non-decreasing
//     confidence  how much evidence built it        monotonically non-decreasing
//     relevance   how much it matters right now     rises AND falls
//
// Evidence is monotonic — you never learn that an observation did not happen — while accessibility
// is plastic. That is the difference between a memory and a decaying weight.
//
// WHAT THIS IS. A pure fold from an activation stream to a CognitiveState. Same activations, same
// structural context, same injected `now`, same bounds ⇒ byte-identical output, including ids,
// strengths, confidences, relevances, counts, timestamps, state and provenance. Not equivalent —
// identical.
// Every downstream mechanism (decay, consolidation, checkpoints, prediction, an AI adapter) assumes
// this, so it is asserted directly rather than left as a property nobody checks.
//
// WHAT IT IS NOT. It is not timing-dependent plasticity, whatever the roadmap's vocabulary
// suggests. STDP is defined over millisecond spike trains with thousands of pairings; the interval
// distribution here is bimodal at same-millisecond and days-apart, and at that timescale an
// exponential kernel IS an asymmetric time-decayed co-occurrence counter. So that is what this is
// called. The neuroscience lineage explains the SHAPE of the rule and nothing more.
//
// The output is deliberately sparse. On the current vault it produces exactly one association, and
// that one is structurally explained — see the header of docs/COGNITION-N1.md for why an honestly
// empty result is the successful one, and why no heuristic may be added to increase the count.
//
// PURITY: no fs, no reads, no writes, no events, no clock, no randomness, no module state.

import type {
  Activation,
  Association,
  CognitiveInput,
  CognitiveNodeKey,
  CognitiveNodeRef,
  CognitiveState,
  StructuralPair,
} from "./contract";
import type { AssociationState } from "./contract";
import {
  ARCHIVAL_THRESHOLD,
  CONFIDENCE_MAX,
  DECAY_HALF_LIFE_MS,
  DORMANCY_THRESHOLD,
  MAX_SESSION_ACTIVATIONS,
  REINFORCEMENT_RATE,
  RELEVANCE_HALF_LIFE_MS,
  SESSION_GAP_MS,
  S_MAX,
} from "./bounds";

/** The rule identity recorded on every association this module produces. Versioned: a change here
 *  is a change to what past results meant, so the name must change with it. */
const RULE = "cooccurrence.v1";

/**
 * A ref collapsed to its map key. The separator is a forward slash: the colon form belongs to
 * graph-view's GraphNode.id and F19 makes that layer its sole owner.
 */
export function nodeKey(ref: CognitiveNodeRef): CognitiveNodeKey {
  return `${ref.entity}/${ref.entity_id}`;
}

/** Undirected key for structural lookup, so a pair matches regardless of which side arrived first. */
function unorderedKey(a: CognitiveNodeKey, b: CognitiveNodeKey): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Split an activation stream into sessions: maximal runs where every consecutive gap stays under
 * SESSION_GAP_MS, capped at MAX_SESSION_ACTIVATIONS.
 *
 * Pairs form only WITHIN a session. Across a boundary no pair forms at all — not a weak one, not a
 * decayed one. A decay curve with no cutoff would still admit the 26-day pair carrying a small
 * weight, and small weights accumulate.
 *
 * Input must already be ordered; `foldCognitiveState` sorts by ordinal before calling.
 */
export function sessionize(activations: readonly Activation[]): Activation[][] {
  const sessions: Activation[][] = [];
  for (const activation of activations) {
    const current = sessions[sessions.length - 1];
    const previous = current?.[current.length - 1];
    const delta = previous === undefined ? 0 : Date.parse(activation.at) - Date.parse(previous.at);
    // A NEGATIVE delta means ordinal order and timestamp order disagree, which the adapter's stream
    // never does. Treating it as a session BREAK rather than a chain is deliberate: `delta <
    // SESSION_GAP_MS` alone would be trivially true for every negative gap, silently collapsing a
    // malformed stream into one enormous session and maximising the association count. A layer whose
    // job is to avoid manufacturing intelligence must fail toward fewer pairs, never toward more.
    const withinGap = previous !== undefined && delta >= 0 && delta < SESSION_GAP_MS;
    const hasRoom = current !== undefined && current.length < MAX_SESSION_ACTIVATIONS;
    if (current !== undefined && withinGap && hasRoom) current.push(activation);
    else sessions.push([activation]);
  }
  return sessions;
}

/**
 * How much a pair reinforces, given the interval between its two activations.
 *
 * Simultaneous activations reinforce fully; the effect halves every DECAY_HALF_LIFE_MS. This grades
 * a claim the session has already made — it never creates one.
 */
function pairDecay(elapsedMs: number): number {
  return Math.pow(2, -elapsedMs / DECAY_HALF_LIFE_MS);
}

/**
 * Confidence from the number of distinct OCCASIONS a pair was seen — never from strength (F22.11).
 *
 * One session yields exactly zero. That is deliberate: a pair observed once has produced a
 * measurement, not yet a basis for believing anything, and the number shown to an operator should
 * say so rather than round up to something reassuring.
 */
function confidenceFor(sessionCount: number): number {
  return CONFIDENCE_MAX * (1 - Math.pow(2, -(sessionCount - 1)));
}

/**
 * How much a learned association matters right now — the only plastic axis (N2).
 *
 * Strength discounted by how long it has gone unreinforced. Elapsed time, never invocation count:
 * folding the same log twice must give the same answer, and a decay applied per call is the
 * commonest way a fold like this quietly stops being reproducible.
 *
 * Scaling by strength rather than decaying on recency alone gives consolidation for free — a
 * strongly-learned association starts higher, so it stays accessible longer. It also guarantees
 * relevance <= strength: current salience can never exceed what was actually learned.
 *
 * A future `now` earlier than lastObservedAt would otherwise AMPLIFY relevance above strength, so
 * elapsed time is floored at zero. Same instinct as the negative-gap rule in sessionize: malformed
 * temporal input must degrade a claim, never inflate one.
 */
function relevanceFor(strength: number, lastObservedAt: string, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - Date.parse(lastObservedAt));
  return strength * Math.pow(2, -elapsed / RELEVANCE_HALF_LIFE_MS);
}

/**
 * Accessibility, expressed as a state. DERIVED from relevance and stored nowhere, so every
 * transition is reversible and `same log + same now` always yields the same answer.
 *
 * `archived` means cognitively inactive through prolonged irrelevance — never retired, deleted, or
 * rejected. A threshold firing is not a human deciding something no longer matters, and the two
 * must never be collapsed. See the AssociationState contract.
 */
function stateFor(relevance: number): AssociationState {
  if (relevance >= DORMANCY_THRESHOLD) return "active";
  if (relevance >= ARCHIVAL_THRESHOLD) return "dormant";
  return "archived";
}

/** What accumulates per directed pair while folding. Local to one call; never module state. */
type Accumulator = {
  source: CognitiveNodeRef;
  target: CognitiveNodeRef;
  strength: number;
  sessions: Set<number>;
  eventIds: Set<string>;
  firstObservedAt: string;
  lastObservedAt: string;
};

/**
 * Fold an activation stream into cognitive state.
 *
 * Ordering is taken from `ordinal`, never from `at`. core/events sorts correctly and then discards
 * its positional key before returning, so two causally ordered events emitted in the same
 * millisecond are indistinguishable by timestamp; the adapter re-establishes order as it builds the
 * stream, and this module trusts only that.
 */
export function foldCognitiveState(input: CognitiveInput): CognitiveState {
  const ordered = [...input.activations].sort((a, b) => a.ordinal - b.ordinal);
  const sessions = sessionize(ordered);

  const structural = new Set(input.structuralPairs.map((p: StructuralPair) => unorderedKey(p.a, p.b)));
  const accumulators = new Map<string, Accumulator>();

  sessions.forEach((session, sessionIndex) => {
    for (let i = 0; i < session.length; i += 1) {
      for (let j = i + 1; j < session.length; j += 1) {
        const earlier = session[i];
        const later = session[j];
        const sourceKey = nodeKey(earlier.subject);
        const targetKey = nodeKey(later.subject);

        // Self-pairs carry no relational information: one project toggled repeatedly says nothing
        // about what it is connected to. On the current corpus this removes 6 of 9 adjacent pairs.
        if (sourceKey === targetKey) continue;

        const id = `${sourceKey}->${targetKey}`;
        const elapsed = Date.parse(later.at) - Date.parse(earlier.at);
        const existing = accumulators.get(id);
        const accumulator: Accumulator = existing ?? {
          source: earlier.subject,
          target: later.subject,
          strength: 0,
          sessions: new Set<number>(),
          eventIds: new Set<string>(),
          firstObservedAt: later.at,
          lastObservedAt: later.at,
        };

        // Saturating, never clamped: the increment shrinks as strength approaches the ceiling, so
        // staying inside [0, S_MAX] is a property of the rule rather than of a min() after it.
        accumulator.strength +=
          REINFORCEMENT_RATE * (S_MAX - accumulator.strength) * earlier.intensity * later.intensity * pairDecay(elapsed);

        accumulator.sessions.add(sessionIndex);
        if (earlier.provenance.source === "event") accumulator.eventIds.add(earlier.provenance.eventId);
        if (later.provenance.source === "event") accumulator.eventIds.add(later.provenance.eventId);
        if (later.at < accumulator.firstObservedAt) accumulator.firstObservedAt = later.at;
        if (later.at > accumulator.lastObservedAt) accumulator.lastObservedAt = later.at;

        accumulators.set(id, accumulator);
      }
    }
  });

  const computedAt = input.now.toISOString();
  const associations: Association[] = [...accumulators.entries()]
    .map(([id, accumulator]) => {
      // The three axes, kept deliberately independent. Strength is what the evidence built and
      // confidence is how much evidence built it — both monotonically non-decreasing over an
      // append-only log. Relevance is the only one that may fall, and neither of the other two is
      // ever derived from it (nor from each other: F22.11).
      const relevance = relevanceFor(accumulator.strength, accumulator.lastObservedAt, input.now);
      return {
        id,
        source: accumulator.source,
        target: accumulator.target,
        strength: accumulator.strength,
        confidence: confidenceFor(accumulator.sessions.size),
        relevance,
        observationCount: accumulator.sessions.size,
        firstObservedAt: accumulator.firstObservedAt,
        lastObservedAt: accumulator.lastObservedAt,
        structurallyExplained: structural.has(
          unorderedKey(nodeKey(accumulator.source), nodeKey(accumulator.target))
        ),
        state: stateFor(relevance),
        epistemics: "learned" as const,
        provenance: {
          // Sorted so the same evidence always serialises identically.
          contributingEventIds: [...accumulator.eventIds].sort(),
          derivedBy: RULE,
          computedAt,
        },
      };
    })
    // Total order by id. Map iteration order is insertion order, which is deterministic but carries
    // semantics silently; sorting makes the guarantee explicit and survives refactoring.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const workingSet = [...new Map(ordered.map((a) => [nodeKey(a.subject), a.subject])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, ref]) => ref);

  return {
    computedAt,
    workingSet,
    associations,
    // N1 produces none of these. They are declared vocabulary with no producer, and returning empty
    // arrays is the honest shape rather than omitting the fields.
    patterns: [],
    predictions: [],
    hypotheses: [],
    source: {
      name: input.sourceName,
      activationCount: ordered.length,
      excludedCount: input.excludedCount,
      sessionCount: sessions.length,
    },
  };
}
