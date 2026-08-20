// cognition/bounds — the single owner of every numeric bound in the cognitive layer.
//
// WHY THIS FILE EXISTS AT N0, NEARLY EMPTY. Constraint 14 of the cognition brief requires that
// every learning mechanism be bounded: no runaway strength, no infinite activation, no unbounded
// growth. Bounds are therefore not an implementation detail to be discovered inside whichever
// module happens to need one first — they are architecture, and they get one owner, the same way
// lib/ehr owns computeEhr (F7) and lib/forecast owns STATUS_PROBABILITY (F9).
//
// WHAT IS DELIBERATELY ABSENT. No reinforcement rate, no decay constant, no cap. The live event
// spine currently holds 27 events, of which roughly 10 are operator-caused business changes across
// 2 entities. A learning parameter tuned against that corpus would not be a measurement; it would
// be a guess wearing the costume of one — and a number that looks validated is far harder to
// remove later than a number that is visibly missing.
//
// The staging is:
//
//     N0      define WHERE bounds live, and the rule that each has exactly one owner
//     N1-N3   define actual VALUES, when the mechanism that consumes them exists
//     N4+     VALIDATE them empirically, against a corpus that can support it
//
// So this file contains only bounds with a STRUCTURAL justification — ceilings that exist because
// unbounded behaviour is forbidden, not because a value was chosen.

/**
 * The ceiling on Association.strength.
 *
 * Structural, not tuned: strength is defined as a bounded ratio, so its ceiling is 1 by
 * construction rather than by choice.
 *
 * SATURATING, NOT CLAMPING. When the update rule arrives it must take the form
 *
 *     ds = rate * (S_MAX - s) * f(interval)
 *
 * so that the increment shrinks as s approaches this ceiling. A clamp hides runaway behind a
 * min(); a saturating form makes runaway structurally impossible, and `s` staying within [0, S_MAX]
 * becomes a corollary of the rule rather than something a test has to hope for. That SHAPE is an
 * architectural commitment made now. The rate is not.
 */
export const S_MAX = 1;

/**
 * The ceiling on confidence, wherever it appears.
 *
 * Structural for the same reason as S_MAX, and kept separate from it on purpose: strength answers
 * "how strongly?" and confidence answers "on what basis?". They share a ceiling and nothing else.
 */
export const CONFIDENCE_MAX = 1;

// ─── N1 — the co-occurrence mechanism ─────────────────────────────────────────
//
// These have values because the mechanism that consumes them now exists. Each carries its
// justification, and none was chosen by taste.

/**
 * The gap above which one session ends and the next begins.
 *
 * NOT A TUNED PARAMETER. The observed gap distribution is a chasm, not a curve: within-burst gaps
 * top out at 18s, and the smallest between-burst gap is 35,595s (9.9h). There is nothing in
 * between. Any threshold in that range produces byte-identical segmentation, so this choice is
 * provably insensitive across three orders of magnitude, and 30 minutes sits in the middle of the
 * valley.
 *
 * When the corpus grows the valley narrows and this becomes a real decision. That is when it gets
 * validated, per the N4+ staging rule — not before.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * The rate in the saturating update.
 *
 * Governs how fast strength climbs toward S_MAX under repeated co-occurrence. At 0.25 a pair needs
 * roughly a dozen occasions to approach the ceiling, which keeps a single busy afternoon from
 * producing a maximally-strong association. Deliberately conservative: with the current corpus
 * nothing reaches even a tenth of the ceiling, and an over-eager rate would manufacture confidence
 * the evidence cannot support.
 */
export const REINFORCEMENT_RATE = 0.25;

/**
 * Half-life of PAIR-FORMATION decay — how much less two activations reinforce each other as the
 * interval between them grows. Not forgetting; see the note below.
 *
 * At one hour, two activations inside the same session reinforce at half the strength of two that
 * were simultaneous. Sessions cap at 30 minutes, so this never fully attenuates within a session —
 * which is the intent: a session is already the claim that these events belong together, and this
 * only grades the claim.
 */
export const DECAY_HALF_LIFE_MS = 60 * 60 * 1000;

/**
 * The largest number of activations one session may contain. Beyond it, a new session begins.
 *
 * This is a BOUND, not a semantic claim. Pair formation within a session is quadratic, so an
 * unbounded session is an unbounded association count — the runaway that constraint 14 forbids.
 * With this cap the total is at most n × MAX / 2.
 *
 * It has never fired: the largest session in the current corpus contains 4 activations. It exists
 * so that behaviour stays bounded on data nobody has seen yet.
 */
export const MAX_SESSION_ACTIVATIONS = 64;

// ─── N2 — forgetting ──────────────────────────────────────────────────────────
//
// These govern RELEVANCE only. Strength and confidence are never touched by them: evidence does not
// stop having occurred, so what fades is accessibility, not information.
//
// None of the three is falsifiable on the current corpus — there is exactly one association — so
// each is justified by STATED INTENT about how this business's engagement cycles work, not by a
// measurement that was never taken. That is the same kind of claim SESSION_GAP_MS makes, and it is
// labelled as such rather than dressed up as data.

/**
 * Relevance halves each quarter.
 *
 * A quarter is the natural cadence of client engagement here: retainer cycles, review periods,
 * seasonal work. It is deliberately NOT DECAY_HALF_LIFE_MS, which governs something else entirely —
 * how much the interval between two activations discounts their pairing. Reusing one constant for
 * pair formation and for forgetting would fuse two unrelated mechanisms to a single number.
 *
 * What this produces, given the thresholds below: a single-observation association goes dormant
 * after ~4 months and archived after ~1.2 years, while a strongly-learned one lasts ~9.5 months and
 * ~1.6 years respectively.
 */
export const RELEVANCE_HALF_LIFE_MS = 91 * 24 * 60 * 60 * 1000;

/**
 * The active -> dormant boundary. Below a tenth of full salience, an association is no longer part
 * of current thinking — though every piece of its evidence remains valid and reactivatable.
 */
export const DORMANCY_THRESHOLD = 0.1;

/**
 * The dormant -> archived boundary. Two orders of magnitude down: present in the record, absent
 * from cognition.
 *
 * `archived` here means COGNITIVELY INACTIVE THROUGH PROLONGED IRRELEVANCE. It is not retirement,
 * not deletion, not rejection, and it is reversible the moment new evidence arrives. See the
 * AssociationState contract for why a threshold firing must never be confused with a human deciding
 * that something no longer matters.
 */
export const ARCHIVAL_THRESHOLD = 0.01;

// ─── N3 — propagation ─────────────────────────────────────────────────────────
//
// These bound TRAVERSAL. None of them shapes a magnitude: structural distance is an exact hop
// count and learned resonance is a product of relevance, so there is no attenuation knob here and
// deliberately so — see the HOP_DECAY note below.

/**
 * The furthest propagation may travel from a seed.
 *
 * Measured, not chosen. The deepest structural chain in the domain is exactly four edges:
 *
 *     prospect -> client -> project -> phase -> task
 *
 * Four hops spans the full hierarchy end to end and no further. This is also what guarantees
 * termination — every path is finite regardless of any decay applied to it.
 */
export const MAX_PROPAGATION_HOPS = 4;

/**
 * How many provenance traces are RETAINED per reached node.
 *
 * Bounded output, not bounded truth: `pathCount` always reports how many routes were actually
 * discovered, so truncation is visible rather than silent — the same instinct as
 * CognitiveState.source.excludedCount.
 */
export const MAX_PATHS_PER_NODE = 8;

/**
 * How many partial routes may be EXPLORED in total before traversal gives up.
 *
 * Retention bounds the output; this bounds the work, and the two are genuinely different. On a
 * sparse graph the number of routes within four hops is small — the live vault has 98 relationships
 * in a near-tree and explores well under a thousand — but a dense graph is combinatorial, and
 * "unbounded graph expansion" is exactly what constraint 14 forbids.
 *
 * When this trips, `PropagationResult.source.explorationExhausted` says so. A result that stopped
 * looking must admit it rather than presenting a partial sweep as a complete one.
 */
export const MAX_PATHS_EXPLORED = 50_000;

/*
 * STILL RESERVED — design parameters, NOT validated values.
 *
 * Each is named here so that it has exactly one definition site the moment it becomes real, and
 * each is deliberately left as prose so it cannot accidentally acquire a value. None may be
 * defined until the mechanism that reads it exists.
 *
 *   MAX_ASSOCIATIONS       growth cap, with total-ordered eviction         - deferred past N2
 *   HOP_DECAY              per-hop attenuation                            - unused; see below
 *
 * ARCHIVAL IS NOT EVICTION, and MAX_ASSOCIATIONS was deliberately NOT implemented at N2.
 *
 *   Archival is a reversible cognitive state that keeps every event id. Eviction is the one
 *   operation in this layer that would genuinely destroy provenance, which runs directly against
 *   the promise archival makes. Conflating a resource bound with a cognitive state would let the
 *   former quietly erase what the latter guarantees — so eviction stays a last-resort RESOURCE
 *   bound, separate from relevance, and earns its own justification when it is built.
 *
 *   When it is: it needs a TOTAL ORDER (strength, then last observed, then a stable id tiebreak).
 *   Without one, two runs over the same log keep different survivors and the layer stops being
 *   reproducible — the one property the whole design rests on. With one association in the corpus,
 *   a hard cap today would be theatre.
 *
 *   HOP_DECAY's recorded justification was WRONG and is corrected here. It previously read: "must
 *   be strictly below 1 or propagation does not terminate — not a tuning preference, the
 *   termination condition." That is false. MAX_PROPAGATION_HOPS caps depth, so propagation
 *   terminates whatever HOP_DECAY is; it is a SHAPING parameter, not a termination condition.
 *
 *   And it may not be needed at all. Learned resonance along a route is the product of `relevance`,
 *   which is already bounded in [0, 1] and already time-decayed, so the product is non-increasing
 *   with depth on its own. A separate per-hop attenuation would be a second decay mechanism with no
 *   independent justification — a tuned knob sitting between the evidence and the result, which is
 *   what this layer refuses everywhere else. If the eventual mechanism does not need it, DELETE it
 *   rather than inventing a reason for it to exist.
 */
