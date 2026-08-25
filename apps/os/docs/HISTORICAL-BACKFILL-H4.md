# Historical Backfill — H4: Unknown-Safe Engine Semantics

**Status: contract. No code written. No enum change, no vault writes, no migration.** H4 specifies the semantic repair so it can be reviewed before implementation. H5 designs the migration; nothing here touches historical data.

Inherited: [H2 §11](./HISTORICAL-BACKFILL-H2.md) (nullable derived scalars), [H3](./HISTORICAL-BACKFILL-H3.md) (blast radius), [H3.1](./HISTORICAL-BACKFILL-H3.1.md) (corrections, `activePhaseIndex` stays `number | null`).

> **The OS must never turn absence of evidence into a business fact.**

---

## 1. The unknown-safe health model

### 1.1 Signatures

```ts
// core/production
Phase.progress                   : number | null
ProductionState.overallProgress  : number | null
ProductionState.activePhaseIndex : number | null      // §2

// engines/health-engine
HealthScore.breakdown.progress   : number | null
HealthScore.breakdown.momentum   : number             // survives — independent
HealthScore.breakdown.schedule   : number | null      // §5
HealthScore.score                : number | null
HealthScore.tier                 : HealthTier | null
HealthScore.daysToLaunch         : number | null      // already nullable; survives
```

### 1.2 `computePhaseProgress`

```text
complete | skipped   → 100
not_started          → 0
in_progress          → checklist ratio, or 50 when the checklist is empty
unknown              → null
```

### 1.3 `overallProgress`

```text
any phase progress null → null
otherwise               → mean of the five
```

**No renormalising over present terms.** Averaging the known phases silently redefines the metric from "how much of this project is done" to "how much of the part we know about is done" — H2 §4's rejected option C, which turns Elite Vac's near-total ignorance into `100 / 1 = 100%`. The denominator stays five.

### 1.4 `computeHealthScore`

```text
progress = overallProgress                        (null-propagating)
momentum = min(100, hours7d / 3 × 100)            (never null — the time log is independent)
schedule = §5
score    = null if ANY term is null, else the weighted sum
tier     = null when score is null
```

Weights are unchanged. A weighted sum with a missing term is missing — it is not the sum of the terms that happen to be present.

### 1.5 What survives

`momentum` and `daysToLaunch` are computed from the time log and the launch target, neither of which depends on phase history. They stay numbers under total phase ignorance. So does everything outside this module: a paid invoice stays paid, a live site stays live, a client keeps existing.

---

## 2. `activePhaseIndex` — `number | null`, and its computation changes too

H3.1 §3 settled the *type*. The *computation* must change with it, or the defect survives the repair.

### 2.1 The gap H3.1 left

```ts
// current — core/production/state.ts:112
activePhaseIndex = phases.findIndex(p => p.status !== "complete" && p.status !== "skipped");
```

An `unknown` phase is non-terminal, so for Elite Vac this still returns `0` — asserting **"Onboarding is the active phase"** about a business live since 2022. The type is honest; the value is not.

### 2.2 The rule

```text
first non-terminal phase, and its status is KNOWN  → its index
first non-terminal phase, and its status UNKNOWN   → null   (cannot be identified)
no non-terminal phase                              → null   (all terminal)
```

A number appears only when evidence identifies the phase. `null` remains overloaded — "no active phase" or "cannot determine" — exactly as decided, with the distinction recovered from `phases[]` by the three consumers that need it.

### 2.3 The derivation those three use

```text
every phase terminal (complete | skipped)   → launched
any phase unknown                           → indeterminate
otherwise                                   → in flight
```

**Ownership:** this belongs in `core/production` beside `ProductionState`, exported as a single derivation. Three surfaces hand-rolling the same phase-membership test is the pattern F24 exists to prevent (`partitionNotifications` has one definition site; no surface may hand-roll status membership). One owner, three callers.

It is a *pure derivation over existing state*, not a new business fact — no new field is persisted and no engine judgment is introduced.

### 2.4 Required consumer changes

| consumer | today | required |
|---|---|---|
| `/production` | `launched = filter(activePhaseIndex === null)`, section headed "Launched", aside "N live" | three buckets; indeterminate must never render as launched or live |
| `/production` card meta `:221` | `activePhase ? … : "launched"` | third string for indeterminate |
| `/crm` `:65` | `building = filter(activePhaseIndex != null)` | third count; indeterminate is not "not building" |
| `compileOperatorBrief` `:37` | `if (activePhaseIndex === null) continue; // skip launched` | render with status stated; **never omit** |

The last one is the sharpest. Omission is an assertion — a project silently absent from the AI brief reads as "nothing here to know," which is H2 §11.3's prohibition applied to the context path. It is also the channel with no type checking: a fabricated `0%` reaching a prompt is invisible to the compiler and to review.

The eleven other consumers are correct unchanged; `null` means "suppress" and suppression is the desired behavior.

---

## 3. The null-health signal path

The architectural question. Decision: **explicit unranked attention.**

### 3.1 Why the naive path fails silently

```ts
// engines/decision-engine/index.ts — weightOf
if (s.source === "health") {
  return s.tier === "at_risk" ? 85 : s.tier === "on_track" ? 45 : 15;
}
```

The final branch is a fall-through. A `null` tier does not error — it scores **15**, the same weight as `healthy`. Changing the types without touching this path would rank "health cannot be determined" identically to "this client is fine," and nothing would report a problem. That is laundering by ternary, and it is the single most likely way this repair fails quietly.

### 3.2 The design

`rank()` never receives a null-scored signal. `assembleFiringSignals` returns two channels:

```text
                    ┌─→ rankable    → rank()        → priority feed
assembleFiringSignals ┤
                    └─→ indeterminate → (no ranking) → attention, unranked
```

Both channels feed the notification lifecycle. This works without modification because `FiringSignal` carries `signalKey · fingerprint · subject · kind · severity? · title` — **no score, no tier**. `reconcile()` is pure lifecycle and already refuses to interpret producer semantics, so an indeterminate signal can be viewed, snoozed and dismissed like any other.

### 3.3 Why not the alternatives

| rejected | reason |
|---|---|
| adapter supplies a sentinel score | MC-1 forbids adapters inventing values; it is also the §3.1 lie made explicit |
| a second deterministic ordering primitive | a second ranker wearing different clothes; `rank()` is the sole ranker |
| drop indeterminate signals | "health cannot be determined" is actionable — it tells the operator what to investigate |

### 3.4 Constraints on the split

- The split keys on **presence** (`tier === null`), never on a tier's meaning. Routing on absence is not interpretation; routing on `at_risk` would be.
- It lives in `mission-control/signals.ts` — assembly, which Mission Control owns (MC-4). It detects nothing and ranks nothing.
- `rank()` is untouched. No new source, no new weight, no null handling inside the engine.
- Indeterminate items are presented as their own group, never interleaved with ranked items under an implied priority.

### 3.5 What the operator sees

```text
Tapia Tile & Marble — health cannot be determined
  phase history unknown · site live · final payment received
  → investigate
```

Not a score, not a tier, not a silence.

---

## 4. `stalled_project`

**Specified: absence of tracked time is not evidence of inactivity.** No replacement heuristic.

The detector asserts *"the project has been inactive for 14 days"* while knowing only *"the OS recorded no activity for 14 days."* Its own rationale concedes the gap and it fires URGENT anyway. This vault makes the gap unarguable: 11 of Tapia's 13 time entries are 1–2 second UI-test artifacts and 2 are seeded, so tracked time has never carried real signal here.

**Resolution: demote, and make the evidence requirement explicit.**

- Restate the claim to what is known — *"no activity recorded for 14 days"* — a statement about Ascend's record-keeping.
- Downgrade from `urgent`. A gap in the OS's own records is not an emergency about a client.
- Do not invent a corroboration heuristic. Requiring an independent quiet-channel check needs an **evidence-coverage primitive** that does not exist; building one here would be inventing a signal to rescue a signal.

Removal is also acceptable and no worse. The rule may not be restored to `urgent` without the coverage primitive.

---

## 5. `schedule`

```text
launchTarget absent or unparseable            → null      (never 100)
launchTarget present, overallProgress known   → number    (existing thresholds unchanged)
launchTarget present, overallProgress null    → null
```

**No schedule ≠ on schedule.** The current `let schedule = 100` awards full marks for having no deadline, and it is load-bearing: two-thirds of Elite Vac's score of 30 is that credit. Under this rule a project with no target has no computable schedule term, therefore no computable health — which is the truth.

Note the existing `it.skip("scores schedule 100 when overallProgress is 100 despite an overdue target")` in the health tests already flags this area as unresolved.

---

## 6. Historical transition semantics (restated, unchanged)

Carried forward from H3.1 §1 so H5 inherits it in one place. The migration **may**:

- replace seeded state with `unknown` or with evidenced state;
- write `observation.captured` baselines, `actor: "system"`, `baseline: true`, where required to stop the reconciler manufacturing today's `phase_completed` / `launched` events;

and **may never** fabricate historical business events.

The baseline exception is an **authorized system observation**, approved explicitly (H3.1 §1) and scoped to the migration. It is not hidden inside the importer and is not a general licence to suppress reconciler output. Outside §19 by construction — `system`, not `operator`.

---

## 7. `promote.ts` — recorded, out of scope

`core/crm/promote.ts:36` — `opts.packageTier ?? "growth"` — is a **certainty-default defect**, not a historical-data defect. Recorded here so the migration does not become responsible for unrelated domain behavior.

```text
missing fact → default → stored fact → downstream interpretation
```

Proven, not theoretical: **Bay Area Custom Shirts carries `tier: "growth"`** for an entity that was never a client. No tier was recorded; the default created one, and it now sits in `structural_meta.json` and in the observation baseline.

It is a **precondition for trusting the migration** — otherwise cleaned records can be re-polluted by an ordinary application path the next day — but it is fixed separately, on its own review.

---

## 8. Acceptance test

Run against Elite Vac and Tapia **in their current seeded state**, before any historical data is touched. Predicted results below; the test is that observed matches predicted.

### 8.1 Elite Vac

Phases become `unknown` ×4 (from `not_started`), `launch: complete`. Launch target is already absent.

| claim | today | required |
|---|---|---|
| `overallProgress` | `20%` | **null** |
| `activePhaseIndex` | `0` → "Onboarding active" | **null** |
| `breakdown.progress` | `20` | **null** |
| `breakdown.schedule` | `100` (no target!) | **null** |
| `score` / `tier` | `30` / `at_risk` | **null / null** |
| `stalled_project` | URGENT | **gone** (active-gated) |
| `/production` bucket | "Launched · live" | **indeterminate** |
| health signal | ranks at 85 (`at_risk`) | **unranked attention** |
| `breakdown.momentum` | `0` | **`0` — survives**, truthfully |
| launch month `2022-03` | — | **survives**, `precision: month`, `source: derived` |

### 8.2 Tapia

All five phases seeded → `unknown`. `launch_target: "2026-08-15"` is **also seeded**, so it demotes too — which removes `daysToLaunch`.

| claim | today | required |
|---|---|---|
| `overallProgress` | `50%` | **null** |
| `activePhaseIndex` | `2` → "Design active" | **null** |
| `score` / `tier` | `25` / `at_risk` | **null / null** |
| `launch_crunch` | URGENT "10d overdue" | **gone** |
| `stalled_project` | URGENT | **gone** |
| `launch-buffer-qa` automation | eligible | **cannot fire** |
| `daysToLaunch` | `-10` | **null** — the target was fabricated |
| `/production` bucket | "In flight" | **indeterminate** |
| final payment $1,249 | retained | **survives** — non-seed invoice |
| site live | true | **survives** |

### 8.3 Pass criteria

1. Every derived claim that depended on fabricated phase history becomes `null`, disappears, or is explicitly indeterminate.
2. **No consumer reinterprets that absence as a positive fact** — specifically: not "launched," not "not building," not "healthy," not weight 15, not omitted from the operator brief.
3. Independent evidence survives untouched: momentum, paid invoices, live sites, client identity, and any date carrying its own provenance.
4. Four of the six URGENT-class signals disappear rather than soften. A survivor means a rule reads something other than what it claims to.

### 8.4 Method note

The rewritten `tests/engines/health-engine.test.ts` **is** the specification of the new semantics — the existing suite pins the old ones assertion by assertion. Rewriting it is the engine work, not a follow-up to it. §8.1 and §8.2 are fixtures for that suite, not a manual check.

Expect a quieter OS. A quieter queue is not evidence the system is fixed, and it is not evidence about §19 — which counts operator-caused events and is untouched by all of this.

---

## 9. Implementation order

```text
1  promote.ts default              §7 — precondition, separate review
2  PhaseStatus + unknown           the frozen enum, on approval
3  core/production                 §1.2, §1.3, §2.2, §2.3
4  engines/health-engine           §1.4, §5
5  mission-control/signals         §3
6  lib/opportunities · automations  §4, and the suppression gates
7  surfaces + compilers            §2.4
8  tests as specification          §8.4
```

Steps 2–8 are the semantic repair. **H5 designs the migration and begins only after this passes §8.**

---

## 9.1 Implementation record (2026-08-25)

Approved and implemented. `tsc --noEmit` clean · `eslint` 0 errors · **470 tests pass, 9 skipped** · production build succeeds. **No vault writes** — the migration remains H5.

Landed across 24 files. Beyond §1–§7 as specified, three things the contract did not name:

1. **`ProgressRail` and `OverallProgressBar` accept `number | null`.** An empty rail is pixel-identical to a genuine 0%, so null renders hatched and labelled "unknown", and `aria-valuenow` is dropped — the platform's own way of saying "amount unknown", so assistive tech is told what the eye is told.
2. **`mission-control/health.ts` sorts null last.** It ordered ascending by score; coercing null to 0 would have put the least-known clients at the top of a worst-first list, presenting ignorance as alarm.
3. **`/crm`'s `withProject - building` subtraction.** The same launched/indeterminate conflation as `/production`, in arithmetic rather than a filter — it assigned every non-building project to "launched".

### Verified against the live vault (read-only probe, since deleted)

```text
elite-vac-service     phaseState=in_flight  overall=20    score=null  tier=null     sched=null  dtl=null
tapia-tile-marble     phaseState=in_flight  overall=50    score=25    tier=at_risk  sched=0     dtl=-11
bay-area-custom…      phaseState=in_flight  overall=0     score=20    tier=at_risk  sched=100   dtl=20
decoraciones-pilar    phaseState=launched   overall=100   score=70    tier=healthy  sched=100   dtl=-421
```

**Elite Vac's false `30 / at_risk` is already gone** — killed by the §5 schedule repair alone, before any historical data is touched, because its `launch_target` is `""`. It now refuses to score, which is the truth.

**The other three still show numbers, and that is correct.** Their vault files still *positively assert* `not_started`, so the engines are faithfully scoring what the vault claims. Converting those assertions to `unknown` is precisely the migration's job. This is the clean H4/H5 boundary observed on real data: H4 stopped the engines manufacturing certainty from silence; only H5 can remove certainty that was written down.

Tapia's `at_risk 25` and its two URGENT signals therefore persist until migration — the §8.2 fixture is pinned in the test suite as the specification of what must happen when it runs.

---

## 10. Open

1. **Deletion provenance** — should removed seeded records leave a rationale, and where? Deletion is invisible to a reconciler that observes state, not absence.
2. **`seed-doc-*`** — three document records still uninspected.
3. **Bay Area Custom Shirts** — reconciling a client relationship that never existed; adjacent to §7, not the same fix.
4. **Evidence-coverage primitive** — §4 option 2, deliberately not built.

No code has been written. `PhaseStatus` remains frozen at four states. `wip/intake` remains quarantined.