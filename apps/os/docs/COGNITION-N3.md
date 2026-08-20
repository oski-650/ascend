# Cognition N3 — Cognitive Propagation

**Status: specification. Nothing implemented, nothing approved.** N0–N2 are complete and committed (`ec703d7`, `14b419a`). The structural-substrate investigation ([`STRUCTURAL-SUBSTRATE.md`](./STRUCTURAL-SUBSTRATE.md)) is approved as the prerequisite design. `cognition/bounds.ts` stays frozen until this spec is reviewed.

The phase is not called "spreading activation" because spreading activation is the easy part. The architectural problem is:

> **How does activation move through multiple relationship modalities without collapsing their provenance?**

---

## 1. The governing principle

> **Relationships describe what is structurally connected. Cognition describes what the system has learned about co-occurrence. Propagation may traverse both only when their provenance remains distinguishable.**

Everything below is a consequence of that sentence. Where a design choice would make the two indistinguishable — a shared scalar, a summed score, an unlabelled edge — the choice is refused, even when it would be more convenient for a renderer.

---

## 2. Prerequisite: `relationships/`

N3 cannot begin until the structural substrate exists. Locked scope, per the approved investigation:

- A new top-level `relationships/` layer, sibling to `graph-view/` and `mission-control/`.
- It owns **only the 10 foreign-key relationship kinds**, derived from 9 canonical readers.
- It carries **no** opportunity, health, or flag interpretation — 8 of the projection's 106 edges are engine judgments and must not enter.
- It depends on neither `cognition/` nor `graph-view/`. Both consume it; neither owns it.
- It is deliberately boring: *given the current authoritative readers, return deterministic structural relationships.* Nothing learned, ranked, inferred, or smart.

```text
Vault / Event Spine
       │
       ├── structural facts ──→ relationships/
       │
       └── witnessed events ──→ cognition/ (associations, relevance)
                                     │
       relationships + cognition ────┘
                     │
                     ▼
            Cognitive Propagation
                     │
                     ▼
        provenance-preserving state
                     │
                     ▼
       graph-view and future surfaces  ← strictly downstream
```

---

## 3. No combined activation scalar

`activation: number` is **formally killed** for N3. It does not appear in any output type.

A single number invites exactly one question — *0.79 according to what epistemic operation?* — and has no answer, because it would fuse a hop count with a learned magnitude. The two channels are not competing measurements of one quantity; they answer different questions and are not even the same kind of number:

| signal | question | type | direction |
|---|---|---|---|
| `structuralDistance` | How many authoritative relationships away? | integer, or null | lower = closer |
| `learnedResonance` | How strongly has this co-activated? | real, 0..1 | higher = stronger |
| `relevance` | How accessible is that learned relationship now? | real, 0..1 | higher = more relevant |
| `paths` | Why did I reach this? | explanatory | — |

They may sit side by side. They may never be added, averaged, or compared. If a scalar is ever wanted, it must arrive with an explicit meaning and a mathematical justification — not because a renderer wanted one number.

**Cognition does not decide visualization.** The surface chooses what to do with three signals; the layer's job is to keep them true.

---

## 4. Two channels

### Channel A — structural propagation

Breadth-first over `StructuralRelationship`, from the seed. Yields **`structuralDistance`**: the length of the shortest path using **only** structural steps, or `null` when the node is not structurally reachable within the hop cap.

No decay. Distance is exact and integral — attenuating it would convert a fact into a magnitude and invite the collapse §3 forbids.

### Channel B — learned propagation

Traversal over `Association`, from the same seed. Yields **`learnedResonance`**: the product of `relevance` along the path.

```text
resonance(path) = Π relevance(association_i)
```

Relevance is already bounded in `[0, 1]` and already decays with time, so the product is non-increasing with depth and needs no separate attenuation. This matters: the resonance of a route is explained **entirely by the evidence on it**, with no tuning knob in the middle.

**Only `active` and `dormant` associations are traversable.** `archived` associations are, by definition, cognitively inactive — they retain full provenance and can reactivate, but they do not carry activation. This is what makes N2's accessibility model earn its keep: a dormant association contributes little because its relevance is low, and an archived one contributes nothing, without either being deleted or special-cased.

### Aggregation across routes: max, never sum

When several learned routes reach the same node, `learnedResonance` is the **maximum** — the strongest route — and `pathCount` reports how many contributed.

Summing would exceed 1, breaking the bound, and would let many weak routes impersonate one strong one. Convergence is real and worth surfacing, but it belongs in a count, not in an inflated score.

---

## 5. Paths are provenance traces, not enumerations

Retaining every traversal is combinatorially unbounded on a dense graph. Retaining a **compact labelled trace** is not.

```ts
export type PropagationStep =
  | { via: "structural"; kind: StructuralRelationshipKind; to: EventSubject }
  | { via: "learned"; associationId: string; to: EventSubject };

export type PropagationPath = {
  /** Ordered steps from the seed. Never revisits a subject. */
  steps: readonly PropagationStep[];
  /**
   * How much this ROUTE carried. Explanatory only.
   * NOT evidence, NOT confidence, and never summed into either.
   */
  contribution: number;
  /** Deterministic, derived from the step sequence. */
  id: string;
};
```

Paths may **mix** mechanisms, which is the point. These are different claims and stay distinguishable:

```text
A → structural(has_project) → B → learned(assoc#17) → C
A → learned(assoc#04)       → B → structural(billed) → C
```

So the system can eventually say: *"I reached this project because it is structurally connected to the client, and independently because those two have historically co-activated."*

### `contribution` is not a confidence

A path explains **how** something was reached. It is not evidence that the relationship is real, and it must never be promoted into `confidence`, which measures evidential support and belongs solely to `Association`. Two routes to a node do not make an association twice as well-supported; they make it twice as reachable. Conflating those would be implicit promotion up the epistemic ladder, by arithmetic.

### Bounded retention, deterministically ordered

`MAX_PATHS_PER_NODE` caps retention. Ties are broken by a **total order**, for the same reason association eviction requires one — without it, two runs over identical input keep different paths and the layer stops being reproducible:

```text
contribution desc
  → step count asc          (a shorter explanation is a better one)
    → mechanism priority     (structural before learned: the stronger claim first)
      → path id asc          (stable, derived from the steps)
```

`pathCount` reports the true number of contributing routes even when only `MAX_PATHS_PER_NODE` are retained, so truncation is visible rather than silent — the same instinct as `CognitiveState.source.excludedCount`.

### Cycle protection

A path may not revisit a subject. The visited set is **per path**, not global: a global set would suppress legitimate alternate routes and make output depend on traversal order.

---

## 6. Proposed contract

```ts
export type PropagationInput = {
  seed: EventSubject;
  structural: StructuralContext;            // injected; cognition imports nothing
  associations: readonly Association[];     // from the N1/N2 fold
  now: Date;
};

export type CognitivePropagation = {
  node: EventSubject;
  /** Shortest structural-only distance, or null when structurally unreachable. */
  structuralDistance: number | null;
  /** Strongest learned route, 0 when no learned route exists. */
  learnedResonance: number;
  /** Relevance of the strongest contributing association, or null when none. */
  relevance: number | null;
  /** True number of contributing routes, before MAX_PATHS_PER_NODE truncation. */
  pathCount: number;
  paths: readonly PropagationPath[];
  epistemics: "learned";
};

export type PropagationResult = {
  seed: EventSubject;
  computedAt: string;
  reached: readonly CognitivePropagation[];
  source: {
    hopLimit: number;
    structuralRelationships: number;
    traversableAssociations: number;
    truncatedNodes: number;
  };
};
```

`epistemics: "learned"` — a propagation result is derived, never a fact. F22.13 already makes `fact` and `witnessed` unrepresentable here.

---

## 7. Bounds

Two new. Both justified by measured graph shape, per the `SESSION_GAP_MS` precedent.

| Bound | Value | Justification |
|---|---|---|
| `MAX_PROPAGATION_HOPS` | 4 | The deepest structural chain in the domain is exactly 4 edges: `prospect → client → project → phase → task`. Four hops spans the full hierarchy end to end and no further. |
| `MAX_PATHS_PER_NODE` | 8 | Bounded before it can matter. Today's graph is tree-shaped with 106 edges, so retained paths per node are far below this; it exists so behaviour stays bounded on data nobody has seen. Same posture as `MAX_SESSION_ACTIVATIONS`, which has never fired. |

### `HOP_DECAY` stays reserved — and its recorded justification is wrong

`bounds.ts` currently states:

> HOP_DECAY must be strictly below 1 or propagation does not terminate. That is not a tuning preference; it is the termination condition.

**That is incorrect.** With `MAX_PROPAGATION_HOPS` capping depth, termination is guaranteed whatever `HOP_DECAY` is. It is a *shaping* parameter, not a termination condition.

And since resonance is the product of relevances — already bounded, already time-decayed — a separate per-hop attenuation would be a second knob with no independent justification. Adding one would put a tuned constant between the evidence and the result, which is exactly what this project has refused at every phase.

**Recommendation: `HOP_DECAY` is not implemented at N3, and the incorrect comment is corrected in the same change.**

---

## 8. Determinism

Same seed, same structural context, same associations, same `now` ⇒ **byte-identical** result: node order, path order, ids, contributions, counts.

- Reached nodes sorted by node key; paths by the §5 total order.
- Traversal never depends on `Map` iteration order.
- No clock read (F22.6), no randomness.
- Structural distance is order-independent by construction (BFS on a fixed edge set).

---

## 9. Adversarial tests

**Provenance never collapses.** A node reachable both ways reports a structural distance *and* a learned resonance, with at least one path of each mechanism. No output field fuses them.

**Judgments cannot propagate.** Construct a context containing a `flags`-shaped relationship; assert it is rejected at the substrate boundary and reaches nothing. Guarded statically by F23.7 and behaviourally here.

**Archived associations carry nothing.** An archived association is not traversed; the same association, reactivated, is. Direct proof that N2's accessibility model drives N3.

**Bounded and terminating.** On a fully-connected 30-node graph with maximal associations: terminates, respects `MAX_PROPAGATION_HOPS`, retains at most `MAX_PATHS_PER_NODE` per node, reports honest `pathCount`, and every number is finite.

**Cycles.** A ring `A → B → C → A` terminates, and no path revisits a subject.

**Reproducibility.** Identical input ⇒ identical JSON. Shuffled input orderings ⇒ identical JSON.

**Resonance is bounded and monotone in depth.** `learnedResonance ≤ 1`, and extending a route never increases its contribution.

**No re-ranking.** The result carries no priority, no score, no ordering claim about business importance. F18's "never re-ranks" applies: `decision-engine.rank()` remains the only ranker.

---

## 10. Out of scope for N3

No UI or overlay rendering. No persistence — the benchmark gate still holds. No patterns, assemblies, prediction, prediction error, or hypotheses. No attention or salience ranking; `CognitiveOverlay.salience` stays unproduced. No interaction logging, no `correlation_id` change, no AI, no new event types.

**No change to what constitutes evidence.** N1 remains the sole authority there, and the frozen `REAL_STREAM` control must pass unmodified.

Propagation is exported and unwired, as N1 and N2 were. Nothing renders it.

---

## 11. Order of work

1. **N2.5** — build `relationships/`, migrate `graph-view/projection` onto it, add the F23 block. Checkpoint and review.
2. **N3** — build propagation against the substrate. Checkpoint and review.

They are separately reviewable, and N2 remains completely valid if neither is built. If N3 is abandoned, the substrate migration should be abandoned with it.
