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

/*
 * STILL RESERVED — design parameters, NOT validated values.
 *
 * Each is named here so that it has exactly one definition site the moment it becomes real, and
 * each is deliberately left as prose so it cannot accidentally acquire a value. None may be
 * defined until the mechanism that reads it exists.
 *
 *   DORMANCY_THRESHOLD     the active -> dormant boundary                 - defined at N2
 *   MAX_ASSOCIATIONS       growth cap, with total-ordered eviction         - defined at N2
 *   MAX_PROPAGATION_HOPS   propagation depth limit                        - defined at N5
 *   HOP_DECAY              per-hop attenuation, strictly less than 1      - defined at N5
 *
 * Two of these carry a requirement that survives whatever value they are eventually given:
 *
 *   MAX_ASSOCIATIONS needs a TOTAL ORDER for eviction (strength, then last observed, then a stable
 *   id tiebreak). Without one, two runs over the same log keep different survivors and the layer
 *   stops being reproducible — which is the one property the whole design is built on.
 *
 *   HOP_DECAY must be strictly below 1 or propagation does not terminate. That is not a tuning
 *   preference; it is the termination condition.
 *
 * FORGETTING IS NOT IMPLEMENTED AT N1. An association's strength currently reflects only the
 * evidence that formed it; it does not fade as `now` moves away from lastObservedAt. Decay of
 * stored strength arrives with DORMANCY_THRESHOLD at N2, where dormancy gives a faded association
 * somewhere to go other than silently toward zero.
 */
