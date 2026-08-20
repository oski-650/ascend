# Cognition — Architecture Contract (N0)

**Status: N0. Anatomy and walls only.** No learning logic, no persistence, no UI, no AI.

This document defines what the cognitive layer of Ascend OS *is*, what it may touch, what it may never do, and how it is enforced. It is the companion to [`GRAPH-CONTRACT.md`](./GRAPH-CONTRACT.md): that one defines the permanent seam between business data and the graph renderer, this one defines the permanent seam between the deterministic substrate and everything derived from it.

---

## 1. The founding principle

> **Anything a human answered is a fact. Anything a machine derived is a cache.**

Everything downstream — persistence, provenance, the AI boundary, the shape of the roadmap — falls out of this one sentence.

It decides where state lives, but that is the smaller half of its job. The larger half is that it names the failure mode the entire layer is built against.

The danger was never a bad learning rule. It is a chain of individually reasonable derivations arriving at a claim of truth nobody authorised:

```text
FORBIDDEN — implicit promotion          REQUIRED — earned promotion

association                             machine inference
    ↓                                       ↓
pattern                                 hypothesis
    ↓                                       ↓
prediction                              human confirmation
    ↓                                       ↓
hypothesis                              business fact
    ↓                                       ↓
"this is true"                          core writer
    ↓                                       ↓
written to the Vault                    event
```

Each step on the left is defensible on its own. The sequence is not. So the architecture makes each rung *nameable* (§3), makes the illegal rungs *unrepresentable* in this layer's types (§3, F22.13), and requires the legal ascent to pass through a human and then through a core writer that emits an event (§6).

**No layer may silently promote one epistemic category into another.** This sits on the same footing as the provenance rule F21 encodes, and it is the reason cognition can be genuinely useful without being dangerous: it learns what tends to be associated, extrapolates what might follow, and proposes hypotheses — while remaining structurally incapable of deciding what is true. It can learn without hallucinating reality.

---

## 2. Where cognition sits

```text
                       ASCEND OS
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
      STATE              MEMORY           STRUCTURE
      Vault            Event Spine          Graph
   (authoritative)   (authoritative)     (projection)
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                       COGNITION
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
        Association    Prediction    Hypothesis
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Cognitive State
                           │
                           ▼
                     OPTIONAL AI          ← does not exist; see §7
                           │
                           ▼
                       Reasoning
                           │
                           ▼
                        Action
                           │
                           ▼
                       Outcome
                           │
                           └──────────► Memory ↺
```

The arrows into cognition are *conceptual lineage*, not import direction. In code, cognition receives its input as an injected value and imports none of those three layers (§5).

**The brain does not decide what is true.** The Vault remains authoritative for current business state. The Event Spine remains authoritative for history. The graph remains a projection. Cognition produces derived state — always rebuildable, always deletable.

---

## 3. The epistemic ladder

The central requirement is that a fact, a learned association, a prediction, and a hypothesis are never conflated. This is made structural rather than documentary: every artifact carries a discriminant, so conflation is a type error rather than a review finding.

| Tier | Meaning | Owner | Producible by cognition |
|---|---|---|---|
| `fact` | The Vault asserts it. Authoritative business state. | Vault | **No** |
| `witnessed` | The Event Spine recorded it happening. Authoritative history. | Event Spine | **No** |
| `structural` | A foreign key that exists on disk. Deterministic, never learned. | Projection | **No** |
| `learned` | Derived from co-activation. *Not* evidence of a real relationship. | Cognition | Yes |
| `predicted` | Extrapolated. Not yet compared against an outcome. | Cognition | Yes |
| `hypothesis` | Proposed. Unconfirmed by any human. | Cognition | Yes |
| `ai_inferred` | **Reserved.** No producer exists. Gated behind §7. | — | No |

The ladder is ordered by decreasing **authority**, never by decreasing usefulness. A hypothesis may well be the most valuable thing on the page; it is still the least authoritative.

### The six things this repo must never collapse

1. **Domain facts** — `structural_meta.json`, markdown frontmatter, invoices. What *is*. Owned by the Vault, changed only through a `core/` writer.
2. **Event memory** — the append-only spine. What *happened*, and when Ascend learned of it. Immutable, never interpreted at the point of writing.
3. **Structural graph relationships** — foreign keys that already exist on disk (`has_project`, `billed`, `supersedes`). Deterministic. They do not learn, decay, or carry confidence.
4. **Learned associations** — this layer. Strength, confidence, provenance, decay, dormancy. An association between two entities is **not** a claim that they are related; it is a record that they became active together.
5. **Cognitive state** — the fold of all of the above into one value at one moment. Derived; discarded and rebuilt freely.
6. **AI-generated inference** — reserved, non-existent, and permanently downstream of everything above.

Categories 3 and 4 are kept apart by *absence*: `cognition/contract.ts` declares no structural edge type at all, so no code path in the layer can express a structural claim even by accident. That is stronger than a discriminant field, and F22.12 enforces it.

---

## 4. Terminology

Two columns, because the roadmap borrows its vocabulary from neuroscience and the code does not.

The reason is empirical. Timing-dependent plasticity is defined over millisecond spike trains with thousands of pairings. Ascend's interval distribution is bimodal: events are either emitted in the *same millisecond* (one operator action, or one reconciler sweep) or *days apart*. An exponential kernel with a days-scale time constant is, mathematically, an asymmetric time-decayed co-occurrence counter — so the code says that. The neuroscience lineage lives in header comments, where it explains *why* a rule has the shape it does without implying a fidelity the timescale cannot support.

This matters beyond naming. Borrowed vocabulary pulls implementations toward mechanisms that only make sense in the regime the vocabulary came from.

| Brief term | In code | Meaning here |
|---|---|---|
| Activation / spike | `Activation` | One node becoming active at one moment, with intensity and provenance. The atomic input of the layer. |
| Neural link | `Association` | A learned pairing. Never called a "link" or an "edge" — those words belong to the graph. |
| Weight | `strength` | How strongly co-activation has been observed. Not a probability, not a ranking, and deliberately not the token `weight` (see below). |
| Confidence | `confidence` | How much evidence supports the *interpretation*. A separate axis from strength. |
| Plasticity / STDP | `reinforce`, `coOccurrence` | The update rule. Saturating, elapsed-time-decayed, order-sensitive. |
| Eligibility trace | *(deferred)* | Decaying credit for a past activation. Not built — see §8. |
| Neuromodulation | *(deferred)* | A signal that scales learning by importance. Requires an outcome signal that does not exist yet. |
| Pattern | `Pattern` | A recurring sequence, co-activation set, motif, or cycle. |
| Assembly | *(deferred)* | A stable cluster of repeatedly co-activated nodes. |
| Prediction | `Prediction` | An extrapolation from a pattern, with probability and confidence. |
| Prediction error / surprise | `PredictionOutcome.surprise` | The gap between expected and observed. |
| Attention / salience | `CognitiveOverlay.salience` | Which parts of the graph warrant deeper processing. **See the warning in §8.** |
| Working memory | `CognitiveState.workingSet` | Nodes currently in play. |
| Consolidation | *(replaced)* | Superseded by the benchmark gate in §6. |
| Hypothesis | `Hypothesis` | A proposal awaiting a human. The only artifact that can become a fact. |
| Cognitive state | `CognitiveState` | Everything the layer currently believes, as one value. |

### Why `strength` and not `weight`

`graph-view/contract.ts` already defines `GraphNode.weight` as *"structural, not editorial — a fixed constant per type, a rendering hint for node radius, nothing more."* Reusing the token would put a learned value and a presentational constant under one name in a codebase where they meet in the renderer. Different word, on purpose.

### Why strength and confidence are separate axes

Two activations a minute apart can produce high strength on almost no evidence. A hundred spread over a year can produce moderate strength on a great deal of it.

- **Strength** answers *how strongly?*
- **Confidence** answers *on what basis?*

Collapsing them produces a number that means neither. No function in this layer may derive either one from the other alone; F22.11 enforces this.

---

## 5. What cognition may read, and may never write

### May read

Nothing, by import. Cognition is a pure function of its arguments.

All input arrives through `ActivationSource`, an adapter implemented in `mission-control/` that gathers, adapts, and injects. The seam is fixed:

```text
EventEnvelope  →  ActivationAdapter  →  Activation  →  cognition
```

**Cognition never consumes `EventEnvelope` directly.** This is the highest-value structural decision at N0: it lets the layer ship with zero persistence, and lets a future input source arrive without touching one line of learning code.

### May never

Write to the Vault. Emit a domain event. Perform filesystem or network I/O. Read `process.env`. Declare `server-only`. Hold module-level mutable state. Read the system clock — `now` is always injected. Construct a route. Re-rank anything the Decision Engine has ranked.

### Import rules

Permitted: `import type` from `@/domain`; relative imports within `cognition/`.

Forbidden: everything else — `@/lib`, `@/app`, `@/components`, `@/mission-control`, `@/engines`, `@/packages/graph`, `@/packages/indexer`, `@/core/knowledge`, all `node:*`, and **`@/graph-view`**.

`graph-view/projection.ts` opens with its own retirement notice, and F17 exists to keep it incapable of becoming a source of truth. Building cognition on a layer the architecture reserves the right to delete would invert exactly the property that makes the projection disposable. The `Graph → Cognition` arrow in §2 is conceptual lineage; structural context arrives as an injected input, the same way `deriveInsights` receives `IntelligenceInput`.

`@/core` imports would be type-only with **zero exemptions** — starting clean, unlike F6 which had to grandfather `opportunity-engine`. At N0 there are none.

### Identity

Cognition's node identity is the Event Spine's `EventSubject`. There is deliberately no new id space: a second entity registry is precisely what F17 ring-fenced `graph-view` against.

`CognitiveNodeKey` collapses a ref to `entity/entity_id` — a forward slash, never a colon. `${type}:${entityId}` is `graph-view`'s `GraphNode.id` format and F19 makes that layer its sole owner.

### Ordering — a real gap in the spine, recorded here

`core/events` sorts events by `occurred_at`, then log index, then append position — and then **discards the positional key before returning**. `EventEnvelope` deliberately gains no ordering field. One operator action can emit two causally ordered events inside the same millisecond, so timestamps alone cannot separate cause from effect.

Therefore **no consumer may compute an interval from `occurred_at` alone.** `Activation.ordinal` is the index of the event in the spine's already-sorted read, assigned by the adapter. Same-millisecond pairs are ordered by `ordinal` and are never treated as simultaneous.

`Activation.at` inherits `occurred_at`, which the reconciler defines as *observation* time — when Ascend learned of a change, never when the operator claims it happened. Cognition inherits that meaning unchanged rather than inventing a truer timestamp.

### The exclusion rule

**An event with `actor === "system"` produces no activation.**

The reconciler sweeps the whole vault in a single pass, so every object it touches shares a near-identical `occurred_at`. Fed to any interval-sensitive rule, every pair in a sweep reinforces maximally, and the strongest thing the system learns is *that the reconciler ran*. On the current corpus that is 17 of 27 events — `observation.captured` and `health.snapshotted`.

**The location of the rule is the architectural decision.** It is enforced at the adapter, never inside a learning function. An exclusion buried in an algorithm is one refactor from being lost, and would have to be re-implemented correctly by every future mechanism. At the adapter it holds once, for every consumer, permanently — and `CognitiveState.source.excludedCount` reports what it dropped, so the filter is an observable number rather than an invisible one. Algorithms downstream are entitled to assume every activation they receive is legitimate.

---

## 6. Persistence ownership

**None, until a benchmark fails.**

`CognitiveState` is a pure fold over activations. Nothing is written, nothing is cached, no module-level state exists. Same input, same state.

The justification is measured, not aesthetic: **27 events fold in microseconds, and will still fold in microseconds at 100×.** That is recorded as an executable gate — a test asserting the fold over the full log completes under 50 ms. **A checkpoint is forbidden until that test fails.** An aesthetic argument for statelessness would be traded away the first time someone wanted a cache; a failing benchmark cannot be negotiated with.

**Incremental folding is blocked, and whoever reaches for it must know why first.** The spine has no monotonic sequence number, and `NewEvent` permits a caller-supplied `occurred_at`, so backdated appends are legal and an `occurred_at` watermark is unsound. Any future checkpoint is total-recompute-only until the spine gains a per-log `seq`. Do not add `seq` now.

### The two halves

**Cache** — associations, patterns, predictions, cognitive state. Deletable with zero information loss. Never persisted while the benchmark passes.

If a checkpoint ever lands it goes in `core/cognition/` and takes a fifth named F21 exemption — backed by an **executable proof the existing four lack**: delete the checkpoint, rebuild from the log, assert the result is identical. An exemption with a passing test behind it is strictly stronger than the current prose-only precedent, not weaker.

**Fact** — a hypothesis a human confirmed or rejected. That cannot be recomputed from the log; it is an irreversible record of what a person believed. It is genuinely durable business state: it belongs to `core/cognition/`, it earns `hypothesis.raised` / `.confirmed` / `.rejected` in `EVENT_TYPES` plus a new `EventLogDomain`, and it **must emit — no exemption**. Per F21's third assertion, the confirm/reject route handler delegates to `core/cognition` rather than writing itself, exactly as prospect creation does.

### A loophole this layer declines to use

F21 is a *text* rule: a file containing a write primitive need only also contain the token `emitEvent`. It never checks that the event corresponds to the write. A checkpoint writer could therefore satisfy F21 by emitting anything at all.

Recorded here as refused. If cognition ever writes, the event it emits will describe the write it performed.

---

## 7. The AI boundary

**No AI exists in Ascend OS, and F12 continues to forbid it.** F12 was *widened* to cover `cognition/` in the same commit that created the directory — a new top-level directory is invisible to every fitness rule until named in one, so without that change `cognition/` could have imported an SDK on every line and F12 would still have passed.

When AI cognition eventually arrives, it does **not** arrive inside `cognition/`:

```text
Cognitive State  →  ai-adapter/  →  model  →  Cognitive Result  →  Cognition
```

- It is a **separate layer**. `cognition/` stays SDK-free permanently — that ban is not a staging step to be relaxed later.
- Its output is tagged `epistemics: "ai_inferred"` and can never be promoted to `fact` except by the human-confirmation path in §1.
- It is **optional and replaceable**. The substrate must be fully functional with no model attached, because it is the substrate that owns memory — not the model.
- `Actor` already includes `` `agent:${string}` ``, and `AgentJobId` / `AgentJobStatus` are reserved in `packages/domain` and required by F12 to remain unconsumed. The provenance vocabulary for that day already exists and needs no change now.

**The question to answer before the adapter is worth building:** `lib/compileContext.ts` and the `compile*Brief` modules already assemble a context pack. Does the cognitive layer measurably improve it? If yes, cognition has a success metric. If no, it is an ornament.

---

## 8. Roadmap — architectural intent, not commitment

The original brief proposed N0–N17. The following revisions come from the actual corpus: **27 events, of which 17 are reconciler cron, leaving roughly 10 operator-caused business changes across 2 entities.** Every phase from pattern detection onward is statistically undefined on this data. Deferral gates are written as numbers, not as judgement calls.

| Phase | Disposition |
|---|---|
| **N1 + N2 + N3** | **Merged.** Activations, associations, and one update rule are not independently observable. Shipping "activations" alone produces a list the Timeline already shows. |
| **N4** eligibility traces | **Deferred indefinitely.** Traces solve credit assignment across delay in large state spaces with sparse reward. There are 4 clients and no reward signal at all until outcome learning. "Which activity preceded a won deal" is an exact filter over 27 events. |
| **N5** spreading activation | **Moved early.** The only mechanism here that yields an honest visible result with *no learning whatsoever* — decayed traversal over structural edges that already exist. It claims nothing about what was learned. |
| **N6** attention | **Deferred — it already exists.** `engines/decision-engine.rank()` and `assemblePriorityFeed` are the attention mechanism. F8 and F18 exist specifically to prevent a second ranker, and F18 pins *"never re-ranks: Decision's order is consumed, never recomputed."* An attention phase is a re-ranker in disguise and will collide head-on. |
| **N7 / N8** patterns, assemblies | **Gated on a number** — on the order of 10⁴ activation records. Pattern detection over 27 events finds patterns in 27 events. |
| **N9 / N10** prediction, error | **Deferred, with a grounded alternative noted.** `lib/forecast.ts` already owns a real prediction with a real outcome. Predicted-vs-actual close is the honest first prediction-error signal, over data the system already has. Per F9, cognition must consume that math, never re-derive it. |
| **N11** consolidation | **Replaced** by the benchmark gate in §6. |
| **N12** cognitive state | **Not a phase.** It is the return type of the merged N1. |
| **N13 / N14** hypotheses, outcome learning | **Kept, late.** Per §6 this is the only part that produces genuinely new facts, and the only part that legitimately extends the event union. |
| **N15** graph integration | **Kept, reshaped.** A separate `CognitiveOverlay` the renderer composes — never learned values written onto `GraphNode` / `GraphEdge`. `graph-view/contract.ts` is PERMANENT and stays untouched, F17's disposability stays intact, and the `weight` collision is sidestepped rather than worked around. |
| **N16** AI adapter | **Kept**, behind the question in §7. |
| **N17** cognitive loop | **Not a phase.** It is what the parts do once they exist. |

### Bounds are staged, not guessed

```text
N0      define WHERE bounds live, and the rule that each has one owner
N1-N3   define actual VALUES, when the mechanism that consumes them exists
N4+     VALIDATE them empirically, against a corpus that can support it
```

`cognition/bounds.ts` therefore contains only structurally-justified ceilings. Every algorithm parameter is declared as reserved prose with no value, because a learning rate tuned against 10 events would be a guess wearing the costume of a measurement — and a number that looks validated is much harder to remove later than one that is visibly missing.

Two requirements survive whatever values are eventually chosen: eviction needs a **total order** or the layer stops being reproducible, and per-hop decay must be **strictly below 1** or propagation does not terminate.

---

## 9. Enforcement

Walls are enforced by **F22** in `tests/architecture/fitness.test.ts`, modelled on the F17 block that `graph-view` received when it was added as a sibling layer.

| Rule | Enforces |
|---|---|
| F22.1 | No I/O — no `node:*`, `fs`, `path`, `crypto`, `server-only`, `process.env`, `fetch` |
| F22.2 | No module-level mutable state — a cache is persistence by another name |
| F22.3 | Writes nothing, emits nothing |
| F22.4 | Imports no outer layer, and in particular no `@/graph-view` |
| F22.5 | `@/core` imports are type-only, zero exemptions |
| F22.6 | No clock read — `now` is injected, always |
| F22.7 | Never opens a vault file |
| F22.8 | The graph id format never leaks in |
| F22.9 | Every bound has exactly one definition site |
| F22.10 | Provenance and epistemics are never optional |
| F22.11 | Strength and confidence are never derived from each other |
| F22.12 | No structural edge type is declared here |
| F22.13 | No artifact is typed `fact` or `witnessed` |

F12 and F19 were widened to include `cognition` in their scan roots. **No existing fitness rule was weakened and no exemption was added.**

Two enforcement notes worth keeping:

- `sourceFiles()` calls `statSync` outside its try/catch, so naming a directory that does not exist takes down the whole suite. The directory must exist before it is named in any root array.
- F22.6 is scoped to `cognition/` only. `engines/opportunity-engine` and `engines/health-engine` both read the ambient clock today; widening the rule to `engines` would fail immediately. That gap is recorded rather than silently fixed.

A rule that cannot be made to fail is not enforcing anything — see the mutation checks in the N0 verification record.
