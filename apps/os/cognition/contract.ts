// cognition/contract — the PERMANENT cognition seam (see docs/COGNITION-CONTRACT.md).
//
// This is the vocabulary of the cognitive layer. It is pure TYPES: no fs, no React, no Next, no
// runtime values, no learning logic. Numeric bounds live in ./bounds — the single owner.
//
// WHAT THIS LAYER IS. Cognition learns what tends to be associated, extrapolates what might
// follow, and proposes hypotheses. It is derived state, always rebuildable, and it is structurally
// incapable of deciding what is TRUE. The Vault remains authoritative for current business state;
// the Event Spine remains authoritative for history; the graph remains a projection.
//
// THE FOUNDING PRINCIPLE:
//
//     Anything a human answered is a fact. Anything a machine derived is a cache.
//
// The danger this layer is built against was never the learning rule. It is a chain of
// individually reasonable derivations — association, pattern, prediction, hypothesis — arriving at
// a claim of truth nobody authorised. The Epistemics ladder below makes every rung nameable, and
// no layer may silently promote one rung into another. The only legal ascent passes through a
// human, and only then through a core writer that emits an event.
//
// PERMANENT. Unlike graph-view/projection.ts, this file is not scheduled for retirement.

import type { EventSubject } from "@/domain";

// ─── The epistemic ladder ─────────────────────────────────────────────────────

/**
 * WHERE A CLAIM COMES FROM. Seven categories the OS must never collapse into each other.
 * Ordered by decreasing AUTHORITY — never by decreasing usefulness.
 *
 * Cognition may only ever produce the middle tiers. It cannot emit a claim at "fact" or
 * "witnessed": those belong to the Vault and the Event Spine respectively, and a derived layer
 * asserting them would be the exact fabrication the provenance rule (F21) forbids.
 */
export type Epistemics =
  /** The Vault asserts it. Authoritative business state. NOT producible by this layer. */
  | "fact"
  /** The Event Spine recorded it happening. Authoritative history. NOT producible by this layer. */
  | "witnessed"
  /** A foreign key that exists on disk. Deterministic, owned by the projection, never learned. */
  | "structural"
  /** Cognition derived it from co-activation. NOT evidence that two things are really related. */
  | "learned"
  /** Cognition extrapolated it. Not yet compared against an outcome. */
  | "predicted"
  /** Cognition proposes it. Unconfirmed by any human. */
  | "hypothesis"
  /** RESERVED. No producer exists. Gated behind the AI seam — see the contract doc. */
  | "ai_inferred";

/** The tiers this layer is permitted to author. Enforced by F22.13. */
export type CognitiveEpistemics = Extract<
  Epistemics,
  "learned" | "predicted" | "hypothesis"
>;

// ─── Identity ─────────────────────────────────────────────────────────────────

/**
 * Cognition's node identity IS the event spine's subject. There is deliberately no new id space:
 * a second entity registry is precisely what F17 ring-fenced graph-view against, and inventing one
 * here would let cognition name entities the vault cannot prove exist.
 */
export type CognitiveNodeRef = EventSubject;

/**
 * A ref collapsed to a map key, cognition-internal.
 *
 * The separator is a FORWARD SLASH, not a colon. `${type}:${entityId}` is graph-view's GraphNode.id
 * format and F19 makes that layer its sole owner; a colon here would duplicate an identity format
 * this repo has already paid to centralise once.
 */
export type CognitiveNodeKey = string;

// ─── Activation ───────────────────────────────────────────────────────────────

/**
 * What caused an activation. Every activation is traceable to a record that exists on disk.
 */
export type ActivationProvenance =
  | { source: "event"; eventId: string }
  /** RESERVED. No interaction log exists and none is planned at N0. */
  | { source: "interaction"; recordId: string };

/**
 * One node becoming active at one moment. The atomic input of the entire layer.
 *
 * ORDERING — a real gap in the spine, recorded here because cognition is the first consumer that
 * cares. core/events sorts by occurred_at, then log index, then append position, and then DISCARDS
 * the positional key before returning: EventEnvelope deliberately gains no ordering field. One
 * operator action can emit two causally ordered events inside the same millisecond, so timestamps
 * alone cannot separate cause from effect.
 *
 * Therefore no consumer of this type may compute an interval from `at` alone. `ordinal` is the
 * index of the event in the spine's already-correctly-sorted read, assigned by the adapter.
 * Same-millisecond pairs are ordered by `ordinal` and are never treated as simultaneous.
 *
 * TIME. `at` is inherited from EventEnvelope.occurred_at, which the reconciler defines as
 * OBSERVATION time — when Ascend learned of a change, never when the operator claims it happened.
 * Cognition inherits that meaning unchanged rather than trying to recover a truer timestamp.
 */
export type Activation = {
  subject: CognitiveNodeRef;
  /** ISO 8601. Observation time. */
  at: string;
  /** Position in the spine's sorted read. The only reliable causal signal. */
  ordinal: number;
  /** 0..1. How strongly this occurrence should count. */
  intensity: number;
  provenance: ActivationProvenance;
};

/**
 * Turning a source of record into activations. The ONLY way anything enters cognition.
 *
 * Cognition consumes Activation[], never EventEnvelope[]. That seam is why the learning code never
 * needs to know whether a signal came from the business log or from somewhere that does not exist
 * yet, and why N1 can ship with no persistence at all.
 *
 * THE EXCLUSION RULE, enforced HERE and nowhere else: an event with `actor === "system"` produces
 * no activation. The reconciler sweeps the whole vault in a single pass, so every object it touches
 * shares a near-identical occurred_at; fed to any interval-sensitive rule, every pair in a sweep
 * reinforces maximally and the strongest thing the system learns is that the reconciler ran. On the
 * current corpus that is 17 of 27 events.
 *
 * The LOCATION of the rule is the architectural decision. An exclusion buried inside a learning
 * function is one refactor from being lost and must be re-implemented correctly by every future
 * mechanism. At the adapter it holds once, for every consumer, permanently — and the count it drops
 * is reported on CognitiveState.source, so the filter is visible rather than silent. Algorithms
 * downstream are entitled to assume every activation they receive is legitimate.
 */
export type ActivationSource = {
  readonly name: string;
  activations(): Promise<readonly Activation[]>;
};

// ─── Learned association ──────────────────────────────────────────────────────

/**
 * Whether an association is currently participating in cognition.
 *
 * These three states describe CURRENT RELEVANCE and nothing else. None of them describes evidence:
 * an association's provenance is a record of things that actually happened, and no state
 * transition may weaken, revise, or erase it. Relevance fades; history does not. What an
 * association loses as it falls through these states is ACCESSIBILITY, never information.
 *
 * All three are DERIVED from `relevance` at read time and stored nowhere, so the same log and the
 * same `now` always yield the same state, and every transition is reversible in both directions.
 *
 *   ACTIVE    relevance >= DORMANCY_THRESHOLD. Participating in cognition now.
 *
 *   DORMANT   ARCHIVAL_THRESHOLD <= relevance < DORMANCY_THRESHOLD. Its historical evidence REMAINS
 *             VALID; only its current relevance has fallen. A dormant association is not a wrong
 *             association and not a deleted one — it is one the present has stopped reinforcing.
 *             It retains every contributing event id, so renewed co-occurrence REACTIVATES it
 *             rather than rediscovering it from nothing.
 *
 *   ARCHIVED  relevance < ARCHIVAL_THRESHOLD. Cognitively inactive due to prolonged irrelevance.
 *
 * WHAT `archived` DOES NOT MEAN. It is not historical archival, not deletion, not retirement, and
 * not rejection. It is a reversible statement about accessibility, made by a clock — and it must
 * never be collapsed with a human decision, because these are different kinds of claim entirely:
 *
 *     "This relationship is no longer relevant."               a person decided  -> FACT / EVENT
 *     "No evidence has reinforced this in fourteen months."    a threshold fired -> DERIVED STATE
 *
 * The first belongs to a human, is recorded as an event, and cannot be recomputed. The second is a
 * pure function of the log and the current time, and is recomputed from scratch on every read.
 * Conflating them is exactly the implicit promotion up the epistemic ladder this layer forbids.
 * Durable retirement, when it exists, will be a separate mechanism with a stored human decision
 * behind it — not this one.
 */
export type AssociationState = "active" | "dormant" | "archived";

/**
 * Evidence is NOT optional. Nothing in this layer may be constructed without naming the records
 * that produced it, which is what makes a fabricated association impossible to render: a surface
 * cannot show a link without being able to show the events behind it.
 */
export type AssociationProvenance = {
  /** The events whose activations produced this. Never empty. */
  contributingEventIds: readonly string[];
  /** Which rule derived it, e.g. "cooccurrence.v1". Rules are versioned so results stay auditable. */
  derivedBy: string;
  /** The INJECTED now, never the system clock. */
  computedAt: string;
};

/**
 * A learned association between two nodes.
 *
 * An association is NOT evidence that two entities are factually related. It means only: this
 * layer has observed them becoming active together. Structural truth lives elsewhere — see the
 * note below on why no structural edge type appears in this file.
 */
export type Association = {
  /** Deterministic, never minted: derived from the two node keys. Same inputs, same id. */
  id: string;
  source: CognitiveNodeRef;
  target: CognitiveNodeRef;

  /**
   * STRENGTH — how strongly co-activation has been observed. 0..S_MAX.
   *
   * Not a probability. Not a ranking. And deliberately NOT the word `weight`: graph-view's
   * GraphNode.weight is a fixed per-type rendering hint, and reusing the token across the two
   * layers would eventually collapse a learned value into a presentational one.
   */
  strength: number;

  /**
   * CONFIDENCE — how much evidence supports the INTERPRETATION. 0..1.
   *
   * A separate axis from strength, on purpose. Two activations a minute apart can produce high
   * strength on almost no evidence; a hundred spread over a year can produce moderate strength on
   * a great deal of it. Strength answers "how strongly?"; confidence answers "on what basis?".
   * No function in this layer may derive either one from the other alone.
   */
  confidence: number;

  /**
   * RELEVANCE — how much this learned association matters right now. 0..S_MAX.
   *
   * The third and only PLASTIC axis. Strength remembers what happened and confidence measures how
   * much evidence supports the interpretation; both are monotonically non-decreasing over an
   * append-only log, because evidence does not stop having occurred. Relevance alone rises and
   * falls.
   *
   * DERIVED, never stored: it is a function of strength, the time since it was last reinforced, and
   * the injected `now`. Nothing accumulates it, so it cannot drift out of agreement with the
   * evidence that produced it.
   *
   * Two invariants follow directly. Relevance never exceeds strength — current salience cannot be
   * larger than what was actually learned — and the two are equal exactly when an association has
   * just been reinforced. Scaling by strength also means a strongly-learned association stays
   * accessible far longer than a weak one, which is consolidation falling out of the definition
   * rather than being separately parameterised.
   */
  relevance: number;

  /**
   * How many DISTINCT SESSIONS this pair co-occurred in — not how many pair instances were formed.
   *
   * A burst in which A and B each appear twice yields four ordered pair instances but only one
   * occasion, and confidence must key on occasions. Counting instances would let a single flurry of
   * clicks masquerade as repeated independent evidence.
   */
  observationCount: number;
  firstObservedAt: string;
  lastObservedAt: string;

  /**
   * True when a structural edge already joins these two entities.
   *
   * The trap this layer exists to avoid is rediscovering the schema and reporting it as insight:
   * clients and projects co-occur constantly because a foreign key binds them. Rather than hide
   * such pairs, they are labelled — `true` is evidence the mechanism runs, `false` is a genuine
   * candidate. A surface may present only the latter as a discovery.
   *
   * Supplied by the adapter as injected structural context. Cognition still imports no graph.
   */
  structurallyExplained: boolean;

  state: AssociationState;
  epistemics: "learned";
  provenance: AssociationProvenance;
};

/**
 * An undirected structural relationship between two nodes, injected as context.
 *
 * Cognition never derives these — it cannot see the vault, the projection, or the index. They
 * arrive already computed so that `structurallyExplained` can be set without this layer gaining any
 * knowledge of what a foreign key is.
 */
export type StructuralPair = { a: CognitiveNodeKey; b: CognitiveNodeKey };

/**
 * Everything the fold needs. There are no other inputs: no clock, no filesystem, no ambient state.
 *
 * `now` is injected rather than read (F22.6), and `excludedCount` / `sourceName` are carried through
 * from the adapter so the resulting CognitiveState can report its own provenance honestly.
 */
export type CognitiveInput = {
  activations: readonly Activation[];
  structuralPairs: readonly StructuralPair[];
  /** How many source records the adapter declined to turn into activations. */
  excludedCount: number;
  /** Names the adapter that produced this input. */
  sourceName: string;
  now: Date;
};

// NOTE — WHY THERE IS NO STRUCTURAL EDGE TYPE IN THIS FILE.
//
// A structural relationship is a foreign key that already exists on disk; it is deterministic, it
// is owned by the projection, and it does not learn. This layer holds only Association. The
// separation the architecture requires is therefore achieved by ABSENCE, which is stronger than a
// discriminant field: there is no type here capable of expressing a structural claim, so no code
// path can accidentally produce one.

// ─── Declared now, produced later ─────────────────────────────────────────────
//
// The vocabulary below is fixed at N0 so the boundaries are testable and the shapes cannot drift
// into being invented per-phase. NO PRODUCER EXISTS for any of it.

export type PatternKind = "sequence" | "coactivation" | "motif" | "cycle";

export type Pattern = {
  id: string;
  kind: PatternKind;
  members: readonly CognitiveNodeRef[];
  observationCount: number;
  confidence: number;
  firstObservedAt: string;
  lastObservedAt: string;
  epistemics: "learned";
  provenance: AssociationProvenance;
};

export type Prediction = {
  id: string;
  expected: CognitiveNodeRef;
  /** The Pattern this was completed from. */
  fromPattern: string;
  probability: number;
  confidence: number;
  computedAt: string;
  epistemics: "predicted";
};

/** The comparison of a Prediction against what actually happened. */
export type PredictionOutcome = {
  predictionId: string;
  /** null means the window closed with nothing observed — an honest outcome, not a missing value. */
  observed: CognitiveNodeRef | null;
  /** 0..1. How unexpected the outcome was. */
  surprise: number;
  resolvedAt: string;
};

/**
 * A proposal awaiting a human.
 *
 * This is the ONLY artifact in the layer that can become durable business state, and only by being
 * answered. A confirmed or rejected hypothesis records what a person believed and cannot be
 * recomputed from the log, so it is a fact rather than a cache — it belongs to a core writer, earns
 * real event types, and takes no exemption from F21. An UNANSWERED hypothesis is derived state like
 * everything else here.
 */
export type Hypothesis = {
  id: string;
  statement: string;
  /** Association and Pattern ids that support it. Never empty. */
  supporting: readonly string[];
  confidence: number;
  raisedAt: string;
  /** null means it does not expire on its own. */
  expiresAt: string | null;
  resolution: "open" | "confirmed" | "rejected" | "expired";
  epistemics: "hypothesis";
};

// ─── Cognitive state ──────────────────────────────────────────────────────────

/**
 * Everything the layer currently believes, as one value.
 *
 * This is not a phase and not a store: it is the return type of a pure fold over activations. Same
 * activations, same state. Most fields will be empty for a long time, which is the honest result.
 */
export type CognitiveState = {
  /** The INJECTED now that produced this state. */
  computedAt: string;
  /** Nodes currently in play. */
  workingSet: readonly CognitiveNodeRef[];
  associations: readonly Association[];
  patterns: readonly Pattern[];
  predictions: readonly Prediction[];
  hypotheses: readonly Hypothesis[];
  source: CognitiveSource;
};

/**
 * Provenance for the state as a whole.
 *
 * `excludedCount` is deliberate: the layer reports how much of its input it DECLINED to learn from,
 * so the system-actor exclusion is an observable number rather than an invisible filter.
 */
export type CognitiveSource = {
  name: string;
  activationCount: number;
  excludedCount: number;
  /** How many sessions the activation stream segmented into. */
  sessionCount: number;
};

/**
 * How cognition reaches the renderer, when it eventually does.
 *
 * An OVERLAY, never a merge. graph-view/contract is PERMANENT and F17 keeps the projection
 * disposable; writing learned values onto GraphNode/GraphEdge would put derived cognition inside a
 * layer the architecture reserves the right to delete, and would collide with the existing
 * `weight` field. The renderer composes structure and cognition instead of receiving them fused.
 *
 * RESERVED — no producer, and no graph-view or component change exists at N0.
 */
export type CognitiveOverlay = {
  /** Keyed by CognitiveNodeKey. */
  salience: Readonly<Record<CognitiveNodeKey, number>>;
  associations: readonly Association[];
};
