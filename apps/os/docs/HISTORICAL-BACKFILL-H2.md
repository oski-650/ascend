# Historical Backfill — H2: Historical Uncertainty & Phase State

**Status: investigation complete. Architectural decision recorded (§11). No code, no enum change, no vault writes.** H2 answers what vocabulary the real history needs, so the frozen `PhaseStatus` decision could be made against measured consequences rather than a hypothetical. `PhaseStatus` remains frozen; H3 maps the blast radius before anything is implemented.

Prerequisite: [H1](./HISTORICAL-BACKFILL-H1.md) established that **every** client's phase history is `unknown` or `seeded` — not one is genuinely known.

> **What does it mean for Ascend to know a project existed without knowing what happened during its lifecycle?**

---

## 1. What `PhaseStatus` currently means

```ts
// packages/domain/enums.ts:21
export type PhaseStatus = "not_started" | "in_progress" | "complete" | "skipped";
```

Four states, and **all four are assertions about the world**. There is no state meaning "Ascend cannot say."

### The default is where the lie enters

Two places substitute a value when the vault is silent:

```ts
// core/production/state.ts:105
const status: PhaseStatus = meta.status ?? "not_started";

// core/reconciler/index.ts:151-152
const from = prior.state[phase] ?? "not_started";
const to   = obs.state[phase]   ?? "not_started";
```

An absent field becomes a positive claim that the phase had not begun. This is the same failure class already recorded in the provenance rules — the intake tier select that fell back to `TIER_PRICES[tier]` and made the OS report revenue nobody was charged. **A default silently becoming an assertion.** It is not an incidental bug; it is the mechanism by which silence is converted into false testimony, and it will survive any enum change unless it is addressed with it.

---

## 2. Which statuses describe current state vs. historical state

They are not separable, and that is the finding.

| status | reads as current | reads as historical |
|---|---|---|
| `not_started` | "isn't underway" | "hadn't begun" |
| `in_progress` | "is underway now" | "was underway then" |
| `complete` | "is done" | "was finished" |
| `skipped` | "won't happen" | "was deliberately omitted" |

`production_state.md` is a **single mutable document describing the present**. Every consumer reads it as *now*. Nothing in the format carries an as-of date, so a historical project's record is interpreted as a live one — which is exactly what happens to Elite Vac and Tapia today.

`skipped` deserves note: it is the only status that already encodes an *operator decision* rather than an observation. It means "we chose not to." That is emphatically not "we don't know," and the two must not be conflated in the fix — `skipped` is knowledge, `unknown` is its absence.

---

## 3. The propagation map — measured, not estimated

Everything routes through one line:

```ts
// core/production/state.ts:112
activePhaseIndex = phases.findIndex(p => p.status !== "complete" && p.status !== "skipped");
```

**Any status that is not `complete` or `skipped` becomes the project's active phase.** An `unknown` phase would inherit this by default. Downstream:

| consumer | behavior | file |
|---|---|---|
| `computePhaseProgress` | `not_started` → **0** | `core/production/state.ts:81` |
| `overallProgress` | mean across all 5 phases | `state.ts:110` |
| `computeHealthScore` | `progress×0.5 + momentum×0.3 + schedule×0.2` | `engines/health-engine/index.ts:64` |
| `ruleStalledProject` | active phase + 0 tracked seconds in 14d → **URGENT** | `lib/opportunities.ts:131` |
| `ruleLaunchCrunch` | active phase + <14d to target + <70% → **URGENT** | `lib/opportunities.ts:110` |
| `ruleLowEhr` | skipped when `activePhaseIndex === null` | `lib/opportunities.ts:150` |
| task list | emits tasks for every non-terminal phase | `app/tasks/page.tsx:48` |
| `allPhasesResolved` | non-terminal phase blocks `project.launched` | `core/reconciler/index.ts:110` |

These render. `detectOpportunities()` is consumed by `app/signals/page.tsx` — the surface Slice 1 just made actionable.

### Reproducing the Elite Vac readings exactly

The recorded symptoms were "20% progress, an active Onboarding phase, health 30 at-risk, and a stalled-work flag." From the vocabulary alone:

```text
launch      complete     → 100
onboarding  not_started  →   0
strategy    not_started  →   0
design      not_started  →   0
dev         not_started  →   0
                overall  = 100/5 = 20 %

progress  20 × 0.5 = 10
momentum   0 × 0.3 =  0     (no time entries)
schedule 100 × 0.2 = 20     (launch_target "" → falsy → default 100)
                     ────
             score =  30    → below 40 → at_risk

activePhaseIndex = 0 → Onboarding
stalled_project  → active phase + zero tracked time → URGENT
```

Every number is a **correct derivation from a false premise**. There is no engine bug here. Confirms the standing ruling: do not fix this in the engines.

### And Tapia is worse

H1 showed Tapia is live and fully paid. The seeded record says design `in_progress`, dev/launch `not_started`, target 2026-08-15. As of 2026-08-25:

```text
overall = (100+100+50+0+0)/5 = 50 %      (design checklist 3/6 → 50)
schedule = 0                             (10 days past target, incomplete)
score = 50×0.5 + 0×0.3 + 0×0.2 = 25      → at_risk

launch_crunch    → URGENT  "10d overdue, only 50% done"
stalled_project  → URGENT  "zero tracked time in 14 days"
```

**Two URGENT signals about a delivered, paid project**, presented on the surface whose entire purpose is deciding what deserves attention. Seeded state is not inert — it is actively generating false demands on the operator.

---

## 4. The real cost of adding `unknown`

This is the part that justifies the freeze.

`computePhaseProgress` must return a number for every status. For `unknown`, every available answer is a lie:

```text
0    asserts nothing was done
100  asserts everything was done
50   fabricates a midpoint from no evidence
```

There is no honest number, because **progress across unknown phases is not a quantity — it is undefined.** Which means:

> Adding `unknown` to `PhaseStatus` is not an enum change. It forces `overallProgress: number` to become expressible as *unknown*, and that propagates into `HealthScore`.

A health score of 30 for Elite Vac is not merely wrong. `score: number` and `tier: "at_risk"` are the wrong *types* — the honest output is "not computable from available evidence." `at_risk` is an assertion about a client relationship the evidence cannot support, and it is currently being made about a business that has been live since 2022.

Three options, with their real blast radius:

| option | what it does | cost | honesty |
|---|---|---|---|
| **A** — `unknown` + engines coerce to 0 | one-line enum change | ~0 | **none** — same lie, new label |
| **B** — `unknown` + derived scalars become nullable | `overallProgress`, `HealthScore`, opportunity rules, task list, phase UI | high, touches every engine | full |
| **C** — exclude unknown phases from the denominator | progress = mean over *known* phases, plus a coverage ratio | moderate | **inverts on real data — see below** |

A is the trap. It is what a hurried importer would do, and it would satisfy the type checker while preserving the exact defect.

**B is chosen (§11). C is rejected**, and the reason is not a matter of taste — C fails on the very record that motivated this investigation. Elite Vac is `launch: complete` with four unknown phases, so a known-phases denominator computes:

```text
100 / 1 = 100 % complete
```

A project whose history is almost entirely unknowable would render as **fully delivered**. C does not merely lose precision; it converts maximal ignorance into maximal confidence, which is strictly worse than the 20% it produces today. The metric silently changes meaning from "how much of this project is done" to "how much of the part we know about is done," and nothing in the number carries that qualification.

---

## 5. One unknown state, or two?

The question was whether to distinguish *never investigated* from *investigated and unknowable*.

**Recommendation: one.** Both mean "Ascend cannot assert." No engine in §3 would branch differently between them — progress is equally undefined, stall detection equally unfounded, health equally uncomputable. The distinction is about whether *further research is worthwhile*, which is a workflow question (is there an open task?) not a domain-state question.

Encoding it in `PhaseStatus` would double the vocabulary to serve a difference no consumer can act on, against a codebase whose second-consumer rule exists precisely to prevent that. If the distinction proves load-bearing later, it belongs in provenance metadata — where it can be added without touching five engines.

---

## 6. How a confirmed fact replaces an unknown without faking an event

The sharpest question, and the system already contains the answer.

Today `phaseTransitionType` would treat `unknown → complete` as `project.phase_completed`, because it claims only the destination. But that conflates two different kinds of change:

```text
ONTIC      the business changed          in_progress → complete
EPISTEMIC  our knowledge changed         unknown     → complete
```

Only the first is an event. The second is Ascend *learning* something that was already true — emitting `project.phase_completed` for it would date a 2022 completion to today. Precisely the false memory the provenance rule was written to prevent.

**The precedent exists.** The reconciler's first-sighting path already does this correctly:

```ts
// core/reconciler/index.ts — FIRST SIGHTING — baseline only. No creation event, ever.
await emitEvent({ type: "observation.captured", actor: "system", data: { baseline: true, ... } });
```

A first observation is `observation.captured`, never a fabricated birth. **`unknown → X` is the same shape of thing**: a baseline being established for a phase, not a transition being witnessed. So the rule follows from existing doctrine rather than new invention:

> **A transition out of `unknown` emits no business event.** It is an observation, recorded as one.

Corollary: transitions *into* `unknown` should be impossible. Knowledge is not lost by writing to the vault; an operator blanking a field is a correction, not a business reversal.

Note the second-order effect: `allPhasesResolved` requires every phase terminal, so a project with unknown phases can never emit `project.launched`. For Elite Vac that is **correct** — the OS did not witness its 2022 launch and must not claim to. The read model can still show it as launched, because `ProjectStatus` is already documented as *"Derived from phase states — never stored."* The separation Oscar wants to hold forever is already structurally present.

---

## 7. Seeded records — delete, quarantine, or mark?

| option | problem |
|---|---|
| **delete the clients** | wrong — Pilar and Tapia are real clients with real relationships. Only the *fields* are fabricated. |
| **mark fields `seeded`** | every engine must learn a third provenance kind, or it keeps consuming them. High blast radius for no gain in expressiveness. |
| **demote seeded fields to `unknown`** | reuses the one state we are already adding. Seeded data is by definition unevidenced — which is exactly what `unknown` means. |

**Recommendation: demote, don't mark.** "Seeded" is a fact about a field's *history*, not about its epistemic status, and the epistemic status is what engines need. Collapsing seeded → unknown means one vocabulary addition solves both problems.

`seeded` stays a classification in the H1 inventory — the record of *why* a field became unknown — without becoming a runtime state.

The scaffold script remains valuable as a **development fixture** and should keep working for test vaults. Two practical notes:

- It is **idempotent** (`writeIfMissing`, line 37) — it never overwrites. Correcting these files in the real vault is safe; the script will skip them.
- It never calls `emitEvent`. The event spine stays clean regardless.

---

## 8. Does provenance belong at the field level?

The vault already answered this empirically. Elite Vac's honest annotation lives in its **markdown body**:

> `entered via intake from repo data only; contract value, contacts and phase dates before launch are UNKNOWN, not zero`

While its **frontmatter** says `not_started` four times. The truth was recorded in prose the engines cannot read, beside a machine-readable field that lies. Whoever wrote it knew — and had nowhere to put it.

That is the argument for field-level, machine-readable provenance, and specifically for dates:

```yaml
launch:
  status: complete
  completed: "2022-03-01"
  completed_precision: month        # the day is invented
  completed_provenance: derived     # portfolio entry, not witnessed
```

versus a bare `completed: "2022-03-01"`, which asserts a day nobody knows. H1 found the same shape at every turn: repo `createdAt` proves a build began, last-push does not prove a launch. **Date precision and date provenance are separate facts from the date**, and the format currently has room for neither.

Whether that lands as sibling keys, a `_provenance` block, or something else is a design question for H3. H2's finding is only that the need is demonstrated, not speculative.

---

## 9. What this recommends, for Oscar's decision

The decision is his; this is the shape the evidence supports.

1. **Add exactly one state — `unknown`** — to `PhaseStatus`. §5: two would serve a distinction no consumer can act on.
2. **Nullable derived scalars (option B).** Decided — recorded in full at §11.
3. **Remove the `?? "not_started"` defaults** in `state.ts:105` and `reconciler/index.ts:151-152`. Absent must resolve to `unknown`, or the enum change accomplishes nothing.
4. **`unknown → X` emits no business event** — `observation.captured`, per the existing first-sighting precedent (§6).
5. **Demote seeded fields to `unknown`** rather than introducing a runtime `seeded` state (§7).
6. **Carry precision and provenance on historical dates** (§8).

Point 2 was the one that needed Oscar specifically. It is now decided; the rest follow from doctrine already committed.

---

## 10. What H2 deliberately does not decide

- The concrete provenance format — H3.
- The complete blast radius of §11 — H3 maps it before any implementation.
- Whether to resurrect any part of `wip/intake`. Quarantine holds.
- Anything about §19, cognition, or capture. Untouched, and this work must not become a reason to revisit them.

No code has been written. `PhaseStatus` remains frozen at four states.

---

## 11. ARCHITECTURAL DECISION — nullable derived scalars

**Decided 2026-08-25 by Oscar. Option B. Recorded before H3, per the phase-gate workflow.**

> **Unknown propagates upward. It does not become zero, and it does not disappear from the denominator.**

```ts
type DerivedProgress = number | null;
```

| value | means |
|---|---|
| `0` | evidence says nothing is complete |
| `50` | evidence says approximately half is complete |
| `100` | evidence says everything is complete |
| `null` | **insufficient evidence to calculate** |

### 11.1 Propagate along the dependency graph, not by blanket nulling

Unknown phase history must not erase independently-evidenced facts. A paid invoice stays paid; a live site stays live; a client keeps existing.

```text
phase status → phase progress → overall progress → metrics requiring it → health components requiring those
```

Anything whose *mathematical meaning* requires `overallProgress` becomes unknowable with it. Everything else survives untouched.

Applied to `computeHealthScore` — the concrete map H3 will need:

| output | depends on | under unknown progress |
|---|---|---|
| `breakdown.progress` | `overallProgress` | **null** |
| `breakdown.momentum` | `hoursLast7Days` only | **survives** — independent of phase status |
| `breakdown.schedule` | `launchTarget` **and** `overallProgress >= 100` | **null** when a target exists (cannot distinguish "past target, incomplete" from "past target, delivered") |
| `score` | weighted sum of all three | **null** |
| `tier` | thresholds on `score` | **null** — `at_risk` becomes unassertable |
| `daysToLaunch` | `launchTarget` vs today | **survives** — pure date arithmetic |

So an Elite Vac card still truthfully reports days-to-launch and momentum while refusing to score health. That is the dependency rule doing real work rather than collapsing the whole surface.

### 11.2 A second default-as-assertion, found while mapping this

`schedule` initialises to `100` and stays there when `launchTarget` is absent (`health-engine/index.ts:46-62`). A project with **no schedule at all** receives **full marks for being on schedule**.

This is materially load-bearing, not cosmetic. Elite Vac's `launch_target` is `""`, so:

```text
score 30  =  progress 10  +  momentum 0  +  schedule 20
```

**Two-thirds of its health score is credit for having no deadline.** Same failure class as `?? "not_started"` — a default silently becoming an assertion — and it is independent of the `PhaseStatus` freeze. Logged here so H3 does not fix the enum while leaving this in place.

### 11.3 `null` must not be laundered in presentation

The distinction has to survive all the way to the pixel:

```text
unknown ≠ 0
unknown ≠ complete
unknown ≠ omitted
unknown = insufficient evidence
```

Both of these are prohibited:

```ts
const progress = overallProgress ?? 0;      // coercion — restores the lie
if (overallProgress != null) { /* show */ } // omission — absence reads as zero or as nothing
```

The second is the subtler one: hiding an unknown makes it indistinguishable from a value that was never relevant. Uncertainty must be **rendered**, not skipped.

Mission Control's language changes accordingly:

```text
BEFORE   Tapia — 30 — AT RISK

AFTER    Tapia — Health: insufficient historical evidence
         Site: Live · Contract: Paid · Phase progress: Unknown
```

Not a weaker dashboard. A more truthful decision surface — and one that tells the operator what to *investigate* rather than what to panic about.

### 11.4 The invariant H3 inherits

> **Historical backfill may replace seeded or false state with `unknown`, but it may never manufacture certainty to satisfy an existing scalar type.**

Any pressure to fill a value because a type demands one is the defect reappearing. Widen the type.