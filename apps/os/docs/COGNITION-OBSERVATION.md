# Cognition — Observation & Evidence

**Status: research and specification. Nothing implemented, nothing approved. No pattern detector.**

N0–N3 are complete and checkpointed (`ec703d7`, `14b419a`, `aba266e`, `ae0f293`). The next thing this system needs is not a smarter brain. It needs **better senses** — and, more importantly, a defensible answer to:

> **What constitutes enough independent evidence for Ascend to be allowed to claim that a pattern exists?**

The Event Spine records what happened to the *business*. It says nothing about how the operator actually works. Pattern detection over business events would find patterns in 10 operator-caused records — which is why every earlier phase deferred it behind a numeric gate rather than a better algorithm.

---

## The ladder this document protects

```text
OBSERVATION   "I opened project X."
     ↓
EVIDENCE      "I repeatedly returned to X after retrieving Y."
     ↓
PATTERN       "Y tends to precede returning to X."
     ↓
PREDICTION    "When Y occurs, X will probably follow."
     ↓
HYPOTHESIS    "Y may be part of my workflow for X."
     ↓
CONFIRMATION  "Yes, that is how I work."          ← a human, and only a human
```

Each rung is a different epistemic claim. The existing `Epistemics` union already forbids cognition from authoring the top rung; this document is about the bottom three, which currently have no vocabulary at all.

---

## 1. What counts as an interaction observation

**The redesign test.** An observation is admissible only if it would still be meaningful after a complete UI rewrite.

> If the observation names an entity and an intent, it is an observation.
> If it names a widget, a route, or a gesture, it is telemetry.

`opened(document/d1)` survives a redesign. `panel.expanded` does not — it describes the shape of today's markup, and learning from it means learning the UI rather than the operator.

Admissible kinds, all naming an `EventSubject`:

| kind | meaning |
|---|---|
| `opened` | The operator deliberately navigated to an entity's surface. |
| `retrieved` | An entity was returned to the operator by a search or a propagation, and they acted on it. |
| `searched` | A retrieval happened — recorded as *what came back*, never what was typed (§12). |
| `focused` | An entity was selected in the Neural Core, an explicit act of attention. |
| `returned` | An `opened` for an entity already opened earlier in the same session. |

`returned` is called out separately because it is the single most informative signal available: coming *back* to something after going elsewhere is what distinguishes a workflow from a click.

---

## 2. What is deliberately not observed

Hover. Scroll depth. Mouse position. Clicks by coordinate. Panel or accordion state. Keystrokes. Anything named after a component or route. Anything about a *client's* portal behaviour — the portal is theirs, not instrumentation.

**Dwell time is excluded, and this is a deliberate disagreement with the original sketch.** Dwell cannot distinguish attention from an abandoned tab, a phone call, or lunch. It looks like a rich signal and is mostly a measure of interruption. If it is ever added it needs its own justification, not inclusion by analogy.

---

## 3. Where interaction data lives

**Not the Event Spine.** That decision from N0 stands and is now better supported. The spine's 68 types are business *facts* — claims about the world that survive the application being deleted. An interaction is a fact about the *app*. Different authority, different retention, different volume by roughly three orders of magnitude. The log has no compaction anywhere, and every `readEvents()` consumer would inherit the volume. It is a one-way door.

A separate append-only stream: `<vault>/.ascend-os/interactions.jsonl`, alongside the other machine-records. It belongs in the vault because the vault is meant to be portable and self-contained — moving it should not lobotomise cognition.

### The iCloud hazard is real, observed, and undefended

The vault lives in `iCloud~md~obsidian`. During this project we repeatedly watched iCloud duplicate files under sync pressure — `.next/types/cache-life.d 2.ts`, then `cache-life.d 3.ts`, regenerating after every build.

**Verified: there is no defence against this in the codebase today.** `core/vault/io.ts` `readJsonlFile` is tolerant of malformed lines but performs no deduplication, and the reconciler has no artifact filter (an earlier note in this project claimed an `isVaultArtifact` helper existed; it does not).

For markdown this is survivable — a duplicated note is visible. For a high-frequency append-only log it is corrupting in exactly the way that matters here: **a duplicated interactions file doubles every observation count, and inflated counts fabricate evidence.** The entire premise of a pattern claim is that occurrences are independent.

Two mitigations, both required before any capture begins:

1. **Every observation carries a stable id** (UUIDv7 via the existing `uuidv7()`), and the reader **deduplicates by id**. A doubled file then yields the same evidence as a single one.
2. **Independence is counted by session, not by record** (§8), so even undetected duplication within one session cannot manufacture a second occasion.

---

## 4. Retention and deletion

No compaction exists anywhere in this codebase, so retention must be decided *before* capture starts — deleting observations later changes derived state and breaks reproducibility retroactively.

The volume is smaller than it feels. One operator, generously ~200 admissible observations per working day, ~250 working days, ~200 bytes per record:

```text
200 × 250 × 200 B  ≈  10 MB / year
```

**Recommendation: retain indefinitely.** Ten megabytes a year is affordable, and indefinite retention is the only policy consistent with *history does not fade*. A rotation window would silently make old patterns unfalsifiable — the system would forget the evidence that contradicted it while keeping the pattern.

If the fold ever becomes slow, the answer is the checkpoint gate already specified in `COGNITION-CONTRACT.md` §6, not deletion.

---

## 5. How observations become activations

The seam already exists and was designed for exactly this. `ActivationSource` is an interface; `ActivationProvenance` already reserves `{ source: "interaction"; recordId }` with no producer. A second adapter in `mission-control/` is the whole integration:

```text
Event Spine  ─→ event adapter       ─┐
                                     ├─→ Activation[] ─→ cognition
Interaction stream ─→ interaction adapter ─┘
```

Cognition never learns which stream an activation came from, except through `provenance`. Not one line of N1/N2/N3 changes.

**Intensity stays uniform at first.** The original brief's table (mentioned 0.2, opened 0.5, edited 0.7) remains an invented scale. Let *frequency* carry the signal rather than a per-type weight — and if intensity is ever differentiated, derive the weights from observed data, not from intuition about what feels important.

---

## 6. Distinguishing human behaviour from system behaviour

`actor: "system"` already solves this for events, and the reconciler lesson generalises: **machine cadence is toxic to learning.** 17 of 27 spine events were the reconciler running.

The equivalent contamination here is subtler and will not announce itself:

- **Next.js prefetching.** Links prefetch on hover. A "page loaded" observation would record entities the operator never actually looked at — a rendering optimisation masquerading as attention.
- **`router.refresh()`** after `syncVault()`, which re-renders surfaces nobody navigated to.
- **Background revalidation** and any future scheduled work.

The rule: **observations are emitted from explicit user gestures, never from render or lifecycle hooks.** If an observation can fire without a human doing something, it is instrumentation of the framework.

---

## 7. Session identity

**Adding interactions invalidates the current justification for `SESSION_GAP_MS`, and that must be re-derived rather than inherited.**

Its present defence is empirical and specific: on the business-event corpus, within-burst gaps top out at 18 s and between-burst gaps start at 9.9 h, so any threshold across a 2000× range segments identically. Interaction data will be *continuous* — a smooth distribution of gaps from seconds to hours — and that valley disappears. The number stops being insensitive and becomes a real parameter.

Recommendation: keep gap-based sessionization (an explicit session id would require the surface to own session lifecycle, which is state the layer does not otherwise need), but re-measure the gap distribution against real captured data before trusting any threshold. Until then, treat session boundaries as provisional and do not let a pattern gate depend on them.

---

## 8. Repeated observations versus independent evidence

Two rules, one of which already exists.

**Occasions, not instances.** N2 already counts `observationCount` as distinct sessions. Opening the same document 47 times in one afternoon is *one* occasion. Without this, a single restless session would look like overwhelming evidence.

**Structural adjacency is not evidence.** If opening a project always renders its documents, then `opened(project)` → `saw(document)` is a fact about the UI's information architecture, not about the operator. The existing `structurallyExplained` flag already marks this class, and a pattern gate must exclude — not merely label — sequences whose every step is structurally forced.

This is the interaction-layer form of the rule that has held since N1: *the system must not rediscover its own schema and report it as insight.*

---

## 9. The minimum evidence for a pattern to exist

The hardest question, and the one where raw counts fail.

**Occurrence count alone is meaningless without a base rate.** "A → B occurred 17 times" says nothing if A occurred 200 times and B follows everything. The claim that matters is *lift*:

```text
lift = P(B follows A) / P(B)
```

A pattern is a claim that A tells you something about B. If `lift ≈ 1`, it does not, however many times it happened.

Proposed gate — all conditions, not any:

| condition | rationale |
|---|---|
| ≥ 12 independent sessions | occasions, not instances (§8) |
| spanning ≥ 6 distinct calendar weeks | rules out one intense fortnight of unusual work |
| `lift ≥ 2.0` | B is at least twice as likely after A as at random |
| not fully structurally explained (§8) | not the information architecture |
| at least one step is `returned` or `retrieved` | not a passive traversal |

These numbers are **not validated** — nothing in the corpus can validate them. They are a starting position stated explicitly as such, exactly as `SESSION_GAP_MS` was, and they must be re-derived once real data exists. The point of writing them now is that a gate must exist *before* the detector, or the detector will define the gate by whatever it happens to find.

**Corollary: the first honest output of a pattern engine is almost certainly zero patterns.** That is the same successful result N1 produced, and no heuristic may be added to change it.

---

## 10. How patterns are falsified

A pattern that cannot die is not a claim, it is a decoration.

- Every prediction a pattern makes is recorded with its outcome — confirmed, contradicted, or expired unobserved.
- Contradictions are counter-evidence and are retained with the same permanence as supporting evidence. **Evidence for and against are both monotonic.**
- A pattern whose accuracy falls to chance is **retired the way associations are**: state moves, provenance stays. Retirement is not deletion, and the same wall applies as at N2 — a threshold firing is not a human deciding the pattern is wrong.

---

## 11. How prediction accuracy feeds confidence

This is the first mechanism in the whole system where an *outcome* changes a *belief*, so it needs its own axis rather than modifying an existing one.

```text
strength            what the evidence built        monotonic
confidence          how much evidence built it     monotonic
relevance           how accessible it is now       plastic
predictiveAccuracy  how often it was right         plastic     ← new, separate
```

`predictiveAccuracy` must never be folded into `confidence`. Confidence measures *how much evidence supports the interpretation*; accuracy measures *whether the interpretation worked*. A pattern can be extremely well-evidenced and consistently wrong, and that combination is informative — collapsing the two would hide exactly the case worth seeing.

---

## 12. Privacy boundaries

Single operator, single machine, local files, no network. The real exposures are narrower and more specific:

**Record what was retrieved, never what was typed.** A `searched` observation stores the entities that came back, not the query string. This removes the PII question entirely — queries can contain client names, contract terms, or personal notes — and is more useful anyway, because the retrieved set is what the operator actually engaged with.

Client-side portal activity stays out of scope. The portal belongs to the client; instrumenting it would be surveillance of a third party who never agreed to it.

Nothing leaves the machine. This is stated because a future AI adapter will make sending cognitive context somewhere an obvious convenience, and the boundary should be written down before it is tempting.

---

## 13. Capture is explicit and reversible

There is precedent in this codebase and it is directly on point. `app/sync-vault.ts` says:

> Deliberately an explicit operator action, not a page-load side effect. Reconciling on read would make every page view silently mutate the event spine, collapsing the cleanest boundary the system has: **observing is not mutating.**

Interaction capture is held to the same standard:

- **Off by default**, enabled by an explicit act.
- **Visibly on** whenever it is running — no silent recording.
- **Stoppable at any time**, with capture ceasing immediately.
- **Inspectable**: what has been observed is readable in plain JSONL, and the count is surfaced the way `excludedCount` already is.

---

## 14. Learning intent rather than mechanics

The redesign test from §1 is the primary defence. Two more:

**No observation may name a component or a route.** If the vocabulary needs to mention `NeuralCore` or `/clients/[slug]`, the wrong thing is being observed. A fitness rule can enforce this by source-text scan, exactly as F22/F23 do.

**Prefer acts with alternatives.** Opening a document is meaningful because the operator could have opened something else. Loading the home page is not — there is nothing else it could have been. Signal lives in choices, not in traffic.

---

## 15. The pre-registered utility experiment

Recorded here **before the harness is built and before any result exists**, because a criterion chosen after seeing results is not a criterion. This is the same rule §9 applies to the pattern gate, turned on cognition itself.

> **Cognition earns further implementation only if its pre-declared ranking metric beats a pre-declared non-cognitive baseline on held-out existing evidence.**

| | |
|---|---|
| **Target** | the subject of event *i+1* |
| **Prediction** | a ranking produced from the spine folded through event *i* |
| **Metric** | Precision@K, reported at K = 1, 3, 5 |
| **Baseline** | recency ranking |
| **Data** | existing operator-caused events only — no new capture |
| **Forbidden** | UI, behavioural intervention, and any tuning of the metric after seeing results |

**Both rankers receive an identical candidate universe.** Otherwise cognition could "win" merely by retrieving a different candidate set rather than by ranking a shared one better. Entities absent from that universe count as a miss for both. Tie-breaking must be declared in advance and identical for both — recency in particular produces large ties across never-touched entities.

### Recency is a strong baseline, and on this corpus it is a devastating one

Measured on the retained stream:

```text
consecutive pairs                    9
  self-repeat (subject unchanged)    6   →  "predict the same subject again" scores 6/9 = 67%
  genuine transitions                3
```

**Propagation structurally cannot produce that answer** — `reached` never contains the seed, by design. So evaluated naively over all consecutive pairs, cognition scores 0% against a trivial baseline's 67%, for a reason that has nothing to do with whether it carries predictive information.

Two consequences, both pre-registered:

1. **Only genuine transitions are eligible trials** — pairs where `subject(i+1) ≠ subject(i)`. Self-repeats measure persistence, not association, and both rankers must be evaluated on the same eligible set.
2. **The eligible trial count on today's corpus is 3.** Not nine, not ten. Three.

### What three trials can and cannot establish

Three trials cannot validate cognition. They cannot validate anything. Stated plainly so no future reader mistakes a passing run for evidence:

> This first experiment is **harness validation, not cognition validation.**

Its purpose is to prove the measurement apparatus exists, is deterministic, and produces a number — before there is enough data for that number to mean something. Building the apparatus first is what stops the eventual data from retro-fitting the standard.

If the harness cannot be defined convincingly, or if the cognitive ranking is indistinguishable from ranking by recency once real trials accumulate, **the ladder stops**. No pattern detector gets built because it is theoretically interesting.

### Measurement before mechanism

The deeper point: this inverts the usual order. Rather than assuming cognition is useful and building machinery to demonstrate it, the existing system is asked whether the proposed mechanism contains predictive information at all — using data already on disk, with no capture subsystem, no retention policy, no F21 exemption, and no pattern engine.

It fails cheap, which is the only property that makes a kill criterion real.

---

## 16. Result of the pre-registered experiment

Run 2026-08-20 against the frozen corpus. **§15 above is unmodified. No criterion was rewritten and no trial was retroactively excluded.**

> **Harness validity: PASS**
> **Pre-registered arithmetic criterion: PASS**
> **Evidence for learned cognition's utility: INCONCLUSIVE**

```text
pairs 9 · eligible 3 · excluded 6 (all self-repeat)

                          hit@1   hit@3   hit@5
COG-A structural-first     0.33    0.33    0.33
COG-B learned-first        0.33    0.33    0.33
BASELINE recency           0.00    0.00    0.00

OUTCOME: beats     killConditionTriggered: false
```

| trial | seed → truth | COG rank | recency rank | ties (COG / recency) |
|---|---|---|---|---|
| 5 | tapia → decoraciones | 67 | 54 | 75 / 99 |
| 7 | decoraciones → elite-vac client | 33 | 19 | 70 / 98 |
| 8 | elite-vac client → elite-vac project | **1** | 55 | **1** / 97 |

### Why the arithmetic passed but the science did not

**Every eligible trial ran with zero associations in the prediction-time fold.** COG-A and COG-B are identical in all three rows, which is the direct confirmation: learned resonance was 0 throughout, so the learned channel — N1, N2, everything that makes this cognition rather than a graph walk — **was never exercised.**

The single hit is trial 8: given a client, predict its project. That is `has_project` at structural distance 1 — a foreign key answered by `relationships/`, which exists independently of N1 and N2.

The baseline was also under-informative, for its own structural reason. The universe holds 99 candidates and the spine has ever touched 4, so recency ranks four entities and ties the remaining ~95. Its ranks of 54 and 19 are arbitrary positions inside a 97–99-way tie.

**Both signals were too sparse for the comparison to carry meaning.** The pre-registered rule says `beats`, and it did. What beat recency was structural adjacency, once.

### The genuinely valuable finding

Not "cognition works" and not "cognition fails", but:

> **The existing corpus is too sparse to exercise the mechanism the experiment was built to validate.**

Which changes the next question from *how do we make cognition better?* to **what evidence must exist before cognition is even testable?** If the answer turns out to be interaction data, then observation capture is justified as an **experimental instrument** — not as a feature assumed to make the system smarter.

The project is neither successful nor failed. **The harness succeeded; the cognition experiment remains unanswered.**

---

## 17. Next pre-registration — separating structural from learned utility

Declared now, applied to **future data only**. It is never applied retroactively to the three trials in §16, whose result stands exactly as recorded.

### Eligibility for evaluating the learned channel

> A trial can evaluate the **learned cognitive channel** only when the prediction-time fold contains at least one active or dormant association **capable of contributing learned resonance to the candidate universe**.

This is deliberately stricter than `assocs > 0`. An association existing somewhere in the fold is not the same as one that could influence the ranking of the candidates actually being ranked — and counting the former would credit the learned channel for trials it could not have affected.

### Three measurements, kept apart

| measurement | question |
|---|---|
| **Structural utility** | Can structural propagation predict the next entity? |
| **Learned utility** | When learned evidence actually exists, does learned resonance contribute predictive information **beyond** the structural channel? |
| **Combined utility** | Does preserving both channels improve prediction **without collapsing their provenance**? |

Separating them is what stops a structural win being credited to the learned system — precisely the misreading §16 would have invited had the trials not been inspected.

The kill condition attaches to **learned utility**, not to structural utility. `relationships/` earning its place says nothing about whether N1–N3 do.

---

## 18. Observation Gate investigation — working backward from candidate relevance

No code. This walks the chain `observation → association → candidate relevance → eligible trial → metric` from the right-hand end, and stops at the first link that cannot be justified.

### The derived requirement

§17 needs learned resonance that adds information **beyond the structural channel**. If two entities are structurally adjacent, propagation already reaches one from the other at distance 1 — which is precisely what §16's trial 8 showed. So a learned association between adjacent entities contributes nothing new, and:

> **An observation stream can produce an eligible learned-utility trial only if the operator's work brings structurally-unrelated entities into the same session.**

Derived, not assumed. It makes the next question empirical.

### Two probes, and the reconciliation

- **Event-log sessions:** 4 total — three single-subject, one dual-subject (`client/elite-vac` + `project/elite-vac`, structurally adjacent, one atomic onboarding action). Zero sessions spanning structurally-distant entities.
- **Vault file mtimes:** 6 clusters at a 30-minute threshold. Three touch multiple owners, but all three are June bulk-scaffold artifacts — they contain `_template`, `README.md`, `prospect:README`. The three recent work clusters are each single-owner. A weak probe: mtime is one point per file, not a history, and is contaminated by bulk operations and sync.

The operator's own account contradicts both: he moves between clients regularly. That is not a conflict once usage is measured:

```text
operator-caused OS events        10
span                             2026-07-17 .. 2026-08-17  (32 days)
days with ANY OS activity        4 / 32  =  12% of days
events per active day            2.5
```

**The work is real; it is not happening in the OS.** Cross-client movement occurs in Obsidian and elsewhere, where Ascend cannot see it.

### The link nobody had named

The chain silently presupposes one more condition, upstream of everything else:

> **Observation presupposes that the operator is working in the instrumented surface.**

Capture inside Ascend OS can only ever observe Ascend OS. At 12% of days and 2.5 actions per active day, a capture substrate would faithfully record a sparse, biased sample of a workflow that mostly happens elsewhere — and the associations it formed would under-represent exactly the cross-client movement that eligibility requires.

**This is the first link that cannot currently be justified, and the investigation stops here.** Not because the design is wrong, but because instrumenting a surface that sees an eighth of the working days cannot produce the evidence the experiment needs.

### The vocabulary, for when the gate does open

Recorded now so it is not designed under pressure later. Each candidate must pass all three filters:

| candidate observation | creates association? | adds beyond structure? | trustworthy? |
|---|---|---|---|
| page render | yes | maybe | **no** — prefetch and `router.refresh()` |
| hover / prefetch | yes | maybe | **no** — the framework, not the operator |
| dwell time | questionable | questionable | **no** — cannot separate attention from an abandoned tab |
| follow a structural link | yes | **no** — structurally explained by construction | yes |
| open via search result | yes | **yes** | yes |
| focus a node in the graph | yes | **yes** | yes |
| complete a console action | yes | yes | yes |

**The counterintuitive result: the least valuable observation is following a link.** Navigation along a structural edge teaches nothing, because `relationships/` already knows that edge exists. The signal lives in the jumps — search-result selection and graph focus — because those are the moves that connect structurally-distant entities.

Which means the entity alone is the wrong unit. **Arrival mode is the observation:**

```text
opened(entity, via: "link" | "search" | "focus" | "direct")
```

Same entity, same click, entirely different evidentiary value depending on how the operator got there. A minimum vocabulary is therefore three kinds — `opened` with arrival mode, `selected` from a result set, `completed` an action — and nothing else.

### What now gates capture

Not the capture design, which is sketched above and cheap. The gate is **adoption**: the OS has to become a surface the operator actually works in before instrumenting it can yield evidence. That is a product question, not a cognition question, and it is not something a better observation vocabulary can fix.

Per the standing rule — *an unsatisfied precondition is a result, not a defect* — the honest conclusion is **not yet instrumentable**, and the correct response is not to build capture anyway.

---

## 19. Working-surface gate — pre-registration

The blocker identified in §18 is adoption, so the next gate measures adoption. Declared **before the measurement period begins**.

### An honest caveat about what this pre-registration protects

**The baseline was already measured before the threshold was chosen.** §18 established 4 active days in 32, and that number was known when the metric and threshold below were selected.

This is not fatal — knowing pre-treatment values is normal — but it changes what the pre-registration protects. It **cannot** protect against fitting the threshold to the baseline. It **can** protect against moving the line after seeing the outcome, which is the failure that actually matters here. Stated so no future reader mistakes it for the stronger kind.

### The metric

> **The fraction of weekdays in the measurement window on which Ascend OS records at least three operator-caused events.**

Chosen over the alternatives because it is measurable from the existing spine with no new instrumentation, and because it maps directly onto the blocker: sessions can only exist on days the operator is in the OS.

**"At least three events" closes the loophole in the simpler version.** A single trivial action would otherwise count the same as an hour of real work. Three is the smallest count that cannot be produced by one incidental click, and it is not a proxy for session quality — only a floor beneath which a day is not plausibly a working day.

Weekdays only, because weekend activity is genuine but irregular, and including it would make the denominator depend on working habits rather than on adoption.

### Baseline, measured 2026-08-20

```text
window                 2026-07-17 .. 2026-08-17   (32 days, 22 weekdays)
operator-caused events 10

active day = >=1 event    3 / 22 weekdays  = 14%
active day = >=2 events   3 / 22 weekdays  = 14%
active day = >=3 events   1 / 22 weekdays  =  5%   <- the pre-registered metric
```

### The threshold

> **>= 60% of weekdays over a rolling 90-day window.**

Derived from the requirement rather than chosen for feel. At roughly 60% of weekdays the OS accumulates on the order of three working sessions a week — about 40 sessions per quarter. If even a modest fraction of those bring structurally-unrelated entities together, §17 finally has candidate associations to evaluate. Below that rate the sessions are too few for the cross-entity subset to reach a usable number, whatever the work pattern is.

It is a large jump from a 5% baseline. That is the point: the gate should be unmeetable without genuine adoption.

### Failure semantics

If the threshold is not met at the end of the window:

> **Ascend OS has not yet earned an observation layer.**

No widening the definition of an active day, no lowering the fraction, no switching to a metric that happens to look better, no extending the window until it passes. Per the standing rule, an unmet precondition is a result.

The gate may be **re-run** on a later window — adoption can take longer than expected — but the metric and threshold recorded here travel with it unchanged.

### What passing does and does not authorize

Passing authorizes **only** the next review: whether to design capture, against the vocabulary in §18 and the integrity requirements in §1–§14. It does not authorize capture itself, a pattern detector, UI cognition, or AI.

And the ordering the whole project has held to remains:

```text
real work → Ascend OS → events and facts → deterministic engines → useful surfaces
   → repeated adoption → meaningful observation data → N1–N3 cognition
   → only then → learned assistance
```

Never the inverse — build AI, invent signals, instrument everything, call it learning.

---

## What this document does not decide

Whether to build any of it. Everything above is design; the capture mechanism, the beacon path, the writer's F21 exemption, and the pattern engine all remain unbuilt and ungated.

It is also worth naming the honest alternative: **the system may not need interaction capture at all.** The measured value of cognition is still unproven, and the question from `COGNITION-CONTRACT.md` §7 stands unanswered — *does the cognitive layer measurably improve the context pack that `lib/compileContext.ts` already assembles?* If the answer is no, richer senses will not change it, and this document should be abandoned along with the rest of the ladder above N3.
