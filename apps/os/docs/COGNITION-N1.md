# Cognition N1 — Activation Semantics & the Co-occurrence Contract

**Status: specification. Not implemented.** N0 (anatomy and walls) is frozen and approved; see [`COGNITION-CONTRACT.md`](./COGNITION-CONTRACT.md). This document defines exactly what N1 does before any of it is built.

N1 merges the brief's N1+N2+N3: activations, associations, and one update rule. They are not independently observable — an activation stream on its own produces a list the Timeline already shows.

---

## 1. The success criterion, stated up front

> **N1 succeeds if it produces one association, flagged as structurally explained, and zero discoveries.**

That is not a hedge. It is the measured, correct output for the current vault, derived in §2. N1 is machinery that will be right when there is data; today its job is to be *honestly empty*.

The failure mode being designed against is the opposite: a version that ships without the filters below and renders "the system learned that clients have projects." That is a foreign key wearing a lab coat, and it would be the most damaging possible first result — it would look like the architecture works.

---

## 2. The measured input

The spine holds 27 events. The `actor === "system"` exclusion (COGNITION-CONTRACT §5) removes 17, leaving **10 activations across 4 distinct subjects**:

| # | occurred_at | type | subject |
|---|---|---|---|
| 0–3 | 2026-07-17 21:53:17→32 | `project.checklist_toggled` | `project/tapia-tile-marble` |
| 4–5 | 2026-07-18 07:46:48→49 | `project.checklist_toggled` | `project/tapia-tile-marble` |
| 6–7 | 2026-08-13 19:38:10→28 | `project.checklist_toggled` | `project/decoraciones-pilar` |
| 8 | 2026-08-17 11:35:06 | `client.created` | `client/elite-vac-service` |
| 9 | 2026-08-17 11:35:06 | `project.created` | `project/elite-vac-service` |

Consecutive gaps, in seconds: `0, 13, 1, 35595, 1, 2289082, 18, 316598, 0`.

**The distribution is a chasm, not a curve.** Within-burst gaps top out at 18 s; between-burst gaps start at 35,595 s (9.9 h). There is nothing in between. Every design decision below exploits that fact rather than smoothing over it.

`correlation_id` exists on `EventEnvelope` but is **populated on 0 of 10 events** — no writer sets it. It is inert vocabulary, like `AgentJobId`. The natural signal for "these events were one operator action" is therefore unavailable, and N1 must not pretend otherwise.

---

## 3. Activation semantics

### One event produces exactly one activation, from `subject` alone

`project.created` carries `client_slug` in its `data`. That backref is **not** read.

A backref is a foreign key — it is `structural`, tier 3 on the epistemic ladder. Deriving a second activation from it would manufacture a client↔project co-activation out of a single structural fact, and the layer would spend its life rediscovering its own schema and reporting it as learning. The rule:

> **Activations come from what happened, never from what is related.**

The cost is real and accepted: on the current corpus this removes the only cross-entity signal that a backref would have supplied. That is the correct trade.

### Field derivation

| Field | Value |
|---|---|
| `subject` | `EventEnvelope.subject`, unchanged |
| `at` | `EventEnvelope.occurred_at`, unchanged — observation time |
| `ordinal` | Index in the **retained** stream, contiguous from 0 |
| `intensity` | `1` for every activation at N1 — see below |
| `provenance` | `{ source: "event", eventId }` |

**`ordinal` is assigned after exclusion, not before.** It is a causal-ordering signal *within the learning stream*, not an address in the spine. If it carried the gaps left by the 17 excluded events, "adjacent" would become ambiguous. The link back to the spine is preserved exactly once, in `provenance.eventId`.

**Intensity is uniform at N1, and the brief's intensity table is deliberately not adopted.** That table (mentioned 0.2, retrieved 0.4, opened 0.5, edited 0.7 …) presumes interaction types that do not exist here. Of the 10 retained events, 8 are one type. There is no basis on which to rank `client.created` against `project.checklist_toggled`, and inventing one would be the same error `bounds.ts` refuses to make: a guess wearing the costume of a measurement. Intensity stays in the type because the shape is right; it gets values when there is something to differentiate.

---

## 4. Sessions

> A **session** is a maximal run of consecutive retained activations in which every consecutive gap is below `SESSION_GAP_MS`.

Pairs form **only within a session**. Across a session boundary, no pair forms at all — not a weak one, not a decayed one. None.

### Why chaining, and not a decay curve

A decay-weighted rule with no cutoff still admits the 26.5-day pair carrying a small weight, and small weights accumulate; it also makes association count grow quadratically with no natural bound. Session chaining makes cross-burst pairing *structurally impossible* and matches how the operator actually works — bursts of activity separated by days.

### Why the threshold is not a tuned parameter

Any `SESSION_GAP_MS` between **18 s and 35,595 s** produces byte-identical segmentation on the current corpus — a range spanning three orders of magnitude. The proposed value of **30 minutes (1,800,000 ms)** sits in the middle of that valley.

This is the justification `bounds.ts` demands: not "30 minutes felt right," but "the output is provably insensitive to this choice across a 2000× range, and here is the range." When the corpus grows, the valley narrows and the number becomes a real decision — at which point it is validated, per the N4+ staging rule.

### Segmentation of the current corpus

| Session | n | subjects |
|---|---|---|
| S1 | 4 | `project/tapia-tile-marble` |
| S2 | 2 | `project/tapia-tile-marble` |
| S3 | 2 | `project/decoraciones-pilar` |
| S4 | 2 | `client/elite-vac-service`, `project/elite-vac-service` |

---

## 5. Pair formation

Within each session, for every ordered pair `(i, j)` with `i < j`:

1. **Self-pairs are excluded.** `source` and `target` must differ. On this corpus that removes 6 of 9 adjacent pairs — the checklist bursts are one project toggled repeatedly, which says nothing about a relationship.
2. `source` is the earlier activation, `target` the later. Associations are **directed**; the update rule is asymmetric.
3. All ordered pairs within the session, not merely adjacent ones — otherwise `A → C` is lost in a session `A, B, C`. Bounded by `MAX_SESSION_ACTIVATIONS`, which caps the quadratic.

### Predicted output

| Session | non-self ordered pairs |
|---|---|
| S1, S2, S3 | none — every activation is the same subject |
| S4 | `client/elite-vac-service → project/elite-vac-service` |

**Total: 1 association.** It is same-millisecond, it is one atomic onboarding action, and its two entities are already joined by a `has_project` structural edge.

---

## 6. Structural explanation

That single surviving pair is exactly the trap this layer exists to avoid, so it is labelled rather than hidden.

```ts
/** True when a structural edge already joins these two entities. */
structurallyExplained: boolean;
```

Populated from structural pairs **injected by the adapter** — cognition still imports no graph, no projection, and no index (F22.4 unchanged).

- `structurallyExplained: true` → the mechanism is working; presented as confirmation, never as a discovery.
- `structurallyExplained: false` → a genuine candidate.

Excluding these pairs outright was considered and rejected: on this corpus it would discard the only evidence that co-occurrence runs at all. Labelling keeps the evidence and removes the lie.

---

## 7. The update rule

Named `coOccurrence.v1` in `Association.provenance.derivedBy`. Versioned so results stay auditable when the rule changes.

Required shape, fixed at N0:

```text
ds = REINFORCEMENT_RATE × (S_MAX − s) × decay(elapsed)
```

- **Saturating**, so `s ∈ [0, S_MAX]` is a corollary of the rule rather than a clamp hiding runaway.
- **Decay is a function of elapsed time, not call count.** The fold must be invariant to how it is invoked.
- **Order-sensitive.** `fold(xs) === fold(xs)`, and `fold(shuffle(xs)) !== fold(xs)`.
- **No clock read.** `now` is injected (F22.6).

`confidence` is computed from `observationCount` and the span over which observations occurred — never from `strength`, never derived from it (F22.11). With one observation, confidence is at its floor. It should be visibly, honestly low.

---

## 8. Amendments required to the frozen N0 contract

N0 is frozen as approved; N1 extends it. These are the only changes:

| Change | File |
|---|---|
| Add `structurallyExplained: boolean` to `Association` | `cognition/contract.ts` |
| Add `CognitiveInput = { activations, structuralPairs, now }` | `cognition/contract.ts` |
| Add `sessionCount` to `CognitiveSource` | `cognition/contract.ts` |
| Give values to `SESSION_GAP_MS`, `REINFORCEMENT_RATE`, `DECAY_HALF_LIFE_MS`, `MAX_SESSION_ACTIVATIONS` | `cognition/bounds.ts` |
| Add those four to the F22.9 bound list | `tests/architecture/fitness.test.ts` |
| Add the non-vacuity guard to F22.5 once cognition imports core types | `tests/architecture/fitness.test.ts` |

The adapter (`mission-control/`, impure, gathers and injects) is new and is **not** part of `cognition/`.

---

## 9. Acceptance tests

**Golden test against the real corpus shape** — the strongest test available, because the expected output is derived rather than asserted:

```text
27 events → 10 retained (17 excluded) → 4 sessions → 1 association
  source:                client/elite-vac-service
  target:                project/elite-vac-service
  structurallyExplained: true
  observationCount:      1
  confidence:            at floor
discoveries (structurallyExplained === false): 0
```

**Property tests** (seeded LCG, no new dependency): saturation derivative shrinks toward `S_MAX`; idempotence under a doubled log; decay invariant to invocation count; order sensitivity asserted both directions; growth cap with deterministic total-ordered eviction; `Number.isFinite` on every numeric field; degenerate cases — zero events, one event, all-same-timestamp, all-self.

**Benchmark as invariant:** the fold over the full log completes in under 50 ms. This is the gate from COGNITION-CONTRACT §6 — persistence is forbidden until it fails.

---

## 10. Out of scope for N1

No UI, no overlay rendering, no persistence, no checkpoint. No patterns, assemblies, prediction, prediction error, attention, or spreading activation. No interaction log. No AI. No new event types. No changes to `graph-view`, `packages/domain`, or any existing engine.

The three mechanisms stay distinct and must not be collapsed into one "link":

| Mechanism | Question | Phase |
|---|---|---|
| Structural | *What is connected?* | exists |
| Learned | *What tends to co-occur?* | N1 |
| Propagated | *What becomes salient if I activate this?* | N5 |
