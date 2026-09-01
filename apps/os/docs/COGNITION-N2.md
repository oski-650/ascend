# Cognition N2 — Plasticity & Forgetting

**Status: IMPLEMENTED and committed at `14b419a`, extended by N2.5 at `aba266e`.** N0 (anatomy and
walls) and N1 (association formation) are complete and checkpointed at `ec703d7`. See
[`COGNITION-CONTRACT.md`](./COGNITION-CONTRACT.md) and [`COGNITION-N1.md`](./COGNITION-N1.md).

> **STATUS CORRECTED 2026-08-31.** This line read "specification. Not implemented." until now. It was
> false: `14b419a` — *"Cognition N2: memory keeps what happened, and forgets only how much it
> matters"* — created THIS FILE and the implementation in the same commit, changing
> `cognition/{bounds,contract,cooccurrence}.ts` and adding `tests/cognition/plasticity.test.ts` (352
> lines). The spec status was accurate when the paragraph was drafted and was never updated when the
> code landed beside it. `aba266e` (N2.5) then gave structural truth its own owner in
> `relationships/`. Corrected rather than silently edited, because a `cognition/` doc asserting a
> phase is unbuilt invites re-implementing or re-authorizing work that is already done — in the one
> layer of this system that advances ONLY by explicit per-phase approval.
>
> What is recorded here is what the repository EVIDENCES: these commits exist and contain this code.
> The approval conversations are not in the tree, so this line does not assert them.

N2 owns exactly four mechanisms: **reinforcement, forgetting, reactivation, archival.**

---

## 1. The governing rule

> **Plasticity may change cognition; it may not silently change what constitutes evidence.**

N1 remains the sole authority over what produces an association: activation eligibility, the `actor === "system"` exclusion, subject-only activation, sessionization, self-pair exclusion, and the negative-Δt rule are all frozen. N2 may not touch any of them.

The falsification test: if association count rises, the increase must be attributable to one of N2's four mechanisms. If it is attributable to changed evidence rules, it is a regression regardless of how interesting the output looks.

N2 **does not change the association count at all.** It adds two derived fields and changes one hardcoded field into a computed one. That is the entire behavioural surface.

---

## 2. The central decision: `strength` vs `relevance`

**Answer: yes, split them — and the decision is already forced by N0.**

`cognition/contract.ts` states, in the approved `AssociationState` documentation:

> These three states describe CURRENT RELEVANCE. None of them describes evidence: an association's provenance is a record of things that actually happened, and no state transition may weaken, revise, or erase it. **Relevance fades; history does not.**

If forgetting decayed `strength`, N2 would contradict a committed contract line. So this is not a new judgement; it is the only reading consistent with what is already approved.

### Three axes, one of which can fall

| | question it answers | direction over an append-only log |
|---|---|---|
| `strength` | *How strongly has this been learned?* | monotonically **non-decreasing** |
| `confidence` | *On what evidential basis?* | monotonically **non-decreasing** |
| `relevance` | *How relevant is it right now?* | rises **and falls** |

**`confidence` does not decay.** Evidence does not become less true with age. An association observed on four separate occasions two years ago was still observed four times; what has changed is that nobody has reinforced it lately, and that is exactly what `relevance` reports. Conflating the two would make the system forget *that it once knew something*, which is the failure the contract forbids.

### Relevance requires no new stored state

This is the finding that makes N2 small. Relevance is a pure function of values that already exist:

```text
relevance = strength × 2 ^ ( −(now − lastObservedAt) / RELEVANCE_HALF_LIFE_MS )
```

No accumulator, no transition log, no incremental update. `strength` and `lastObservedAt` are already on `Association`, and `now` is already injected. Two invariants fall straight out:

- `relevance ≤ strength`, always. Current salience can never exceed what was actually learned.
- `relevance === strength` exactly when `now === lastObservedAt`.

Scaling by `strength` rather than decaying on recency alone gives a consolidation effect for free: a strongly-learned association starts higher, so it stays above a threshold for longer. Strong memories persist; weak ones lapse quickly. Nothing extra had to be built for that.

### Naming

`relevance` is per-association. `salience` is already taken — `CognitiveOverlay.salience` is per-node. Keeping the two words apart avoids repeating the `weight` collision that `strength` was named around in the first place.

---

## 3. The four mechanisms

### 3a. Reinforcement — unchanged from N1

```text
Δs = REINFORCEMENT_RATE × (S_MAX − s) × intensity × intensity × pairDecay(interval)
```

Already implemented and tested. Saturating, so the increment shrinks toward the ceiling. N2 adds nothing here; it is listed because it is one of the four mechanisms and because its **non-decreasing** property becomes a formal invariant under test.

`DECAY_HALF_LIFE_MS` remains **exclusively a pair-formation parameter** — how much the interval between two activations discounts their pairing. It is not reused for forgetting. N2 introduces its own parameter, justified separately below.

### 3b. Forgetting — new, derived, time-based

Relevance decays with elapsed time since `lastObservedAt`, never with invocation count. `fold(log, T)` must equal the incremental fold to `T`; a decay applied per call would break that and is the single most common way a fold like this silently stops being reproducible.

`now` is injected. No `new Date(`, no `Date.now(`, no `Math.random(` in `cognition/` — F22.6 already enforces this.

### 3c. Reactivation — free, because the fold is keyed by identity

A dormant association receiving new evidence must **update association #1, not mint association #2.**

This requires no mechanism. The fold accumulates by `id` (`${sourceKey}->${targetKey}`), so evidence arriving after any gap lands on the same entry. `observationCount`, `firstObservedAt`, and `contributingEventIds` are preserved because they were never separated. `lastObservedAt` advances, relevance jumps, and the derived state returns to `active`.

Reactivation is therefore a *consequence* of N1's identity scheme rather than something N2 adds — which is the strongest possible form for it to take. It is specified and tested here regardless, because a future refactor could break it silently.

### 3d. Archival — a derived state, never a deletion

```text
                    relevance ≥ DORMANCY_THRESHOLD  →  ACTIVE
  ARCHIVAL_THRESHOLD ≤ relevance < DORMANCY_THRESHOLD  →  DORMANT
                    relevance < ARCHIVAL_THRESHOLD  →  ARCHIVED
```

State is a **pure threshold on relevance**, so the whole fold remains a pure function of `(log, now)` with nothing path-dependent and no transition history to store.

Archival is therefore **reversible**: an archived association that receives new evidence returns to active. This is the honest reading — the business genuinely came back, and pretending otherwise would require storing a retirement decision nobody made. `archived` means *currently below the archival threshold*, not *retired by a judgement*.

**Archived is not deleted.** Provenance, evidence, counts and timestamps are all retained; the association simply no longer participates in active cognition. It remains fully inspectable and auditable.

### Archival is not eviction

`MAX_ASSOCIATIONS` stays **reserved and unimplemented.** Eviction is the one operation in this layer that genuinely destroys provenance, which sits directly against the contract's promise that archival preserves history. Conflating a resource bound with a cognitive state would let the former quietly erase what the latter guarantees.

With one association in the corpus a hard cap is theatre. It is re-reserved with an explicit note: eviction is a last-resort **resource** bound, distinct from archival, requiring its own justification and its own total-ordered, reproducible eviction rule when it is finally built.

---

## 4. Parameters

Three new bounds. None is falsifiable on the current corpus — there is exactly one association — so each is justified by **stated intent about how an agency's engagement cycles work**, not by a fake measurement. This follows the `SESSION_GAP_MS` precedent: justify, do not tune, and say plainly which kind of claim is being made.

| Bound | Value | Justification |
|---|---|---|
| `RELEVANCE_HALF_LIFE_MS` | 91 days | **Relevance halves each quarter.** A quarter is the natural cadence of client engagement here — retainer cycles, review periods, seasonal work. |
| `DORMANCY_THRESHOLD` | 0.1 | Below a tenth of full salience, an association is no longer part of current thinking. |
| `ARCHIVAL_THRESHOLD` | 0.01 | Two orders of magnitude down: present in the record, absent from cognition. |

### What those values actually produce

| learned strength | goes dormant | goes archived |
|---|---|---|
| 0.25 (single observation) | 120 days (~4 months) | 423 days (~1.2 years) |
| 0.50 (moderate) | 211 days (~7 months) | 514 days (~1.4 years) |
| 0.90 (strongly learned) | 288 days (~9.5 months) | 591 days (~1.6 years) |

A client relationship untouched for four months is not current; one untouched for over a year is history. Strongly-learned associations persist roughly 2.4× longer than weak ones, which is the consolidation effect falling out of the `strength` scaling rather than being separately parameterised.

**These must be revisited when there are enough associations to observe.** Recorded as the N4+ validation obligation, exactly as `SESSION_GAP_MS` is.

---

## 5. Effect on the frozen baseline

The `REAL_STREAM` fixture is the experimental control. Under N2 it yields:

```text
associations:          1          unchanged
structurallyExplained: true       unchanged
confidence:            0          unchanged
observationCount:      1          unchanged
discoveries:           0          unchanged
state:                 "active"   unchanged (was hardcoded, now derived)
relevance:             0.246188   NEW
```

**The parameters were not chosen to protect this result.** The association's `lastObservedAt` is 2026-08-17 and the fixture's injected `now` is 2026-08-19 — two days against a 91-day half-life. It would take 120 days for that association to go dormant. The baseline is untouched because the numbers say so, not because the numbers were fitted to it.

Every existing assertion in `tests/cognition/cooccurrence.test.ts` therefore still holds. The only change is one added field. That is what "attributable to N2's four mechanisms" looks like when it passes.

---

## 6. Contract amendments

| Change | File |
|---|---|
| Add `relevance: number` to `Association` | `cognition/contract.ts` |
| `state` becomes derived from relevance rather than the constant `"active"` | `cognition/cooccurrence.ts` |
| Add `RELEVANCE_HALF_LIFE_MS`, `DORMANCY_THRESHOLD`, `ARCHIVAL_THRESHOLD` | `cognition/bounds.ts` |
| Re-reserve `MAX_ASSOCIATIONS` with the eviction-is-not-archival note | `cognition/bounds.ts` |
| Add the three bounds to the F22.9 list | `tests/architecture/fitness.test.ts` |

No new module. No new stored state. No change to the adapter, to `packages/domain`, to `graph-view`, or to any engine.

---

## 7. Adversarial tests

Beyond the existing suite, which must continue to pass unchanged:

**Monotonicity.** Over an append-only log, `strength` and `confidence` never decrease between any two prefixes. Only `relevance` may fall. This is the formal statement of "relevance fades; history does not," and it is the test most likely to catch a future mistake.

**Ceiling.** `relevance ≤ strength` for every association at every `now`; equality exactly at `now === lastObservedAt`.

**Decay is elapsed-time, not call-count.** Folding the same log ten times yields identical relevance. Folding at `now` versus folding twice at intermediate points yields the same value.

**Reactivation preserves lineage.** Build a log with a pair, a year of silence, then the pair again. Assert: one association, not two; `firstObservedAt` unchanged; `contributingEventIds` a superset containing all four event ids; `observationCount` = 2; state back to `active`; and `strength` higher than before the gap — the association was *reinforced*, not relearned from zero.

**Archival reversibility.** The same association observed once, then archived by the passage of time, then observed again, returns to `active` with provenance intact.

**Threshold boundaries.** Exactly at `DORMANCY_THRESHOLD` and `ARCHIVAL_THRESHOLD`, state is deterministic and matches the documented comparison direction (`≥` active, `<` dormant).

**Evidence rules are untouched.** The N1 golden test runs unmodified. Association count on `REAL_STREAM` is 1 under every `now` from the fixture's date to ten years later — forgetting changes state and relevance, never how many associations exist.

**Finiteness.** `Number.isFinite` on relevance for extreme elapsed values, including `now` far in the future.

**Purity.** F22 continues to pass; the fold reads no clock.

---

## 8. Out of scope for N2

No eviction. No persistence or checkpoint — the benchmark gate in COGNITION-CONTRACT §6 still holds. No patterns, assemblies, prediction, prediction error, attention, or spreading activation. No UI or overlay rendering. No interaction logging. No `correlation_id` change. No AI. No new event types. No change to what constitutes evidence.

---

## 9. What N2 will feel like

Today the layer knows one thing and says so flatly. After N2 it knows the same one thing, but can say how *current* that knowledge is — and, when the corpus grows, will be able to hold a strongly-learned association that has gone quiet without either forgetting it happened or pretending it still matters:

```text
strength   0.91   ← what was learned
confidence 0.75   ← on what basis
relevance  0.04   ← how much it matters now
state      dormant
```

That triple is the first thing this system produces that a memory would recognise.
