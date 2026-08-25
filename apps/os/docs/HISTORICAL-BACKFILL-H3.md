# Historical Backfill — H3: Impact Map & Migration Design

**Status: investigation. No code, no enum change, no vault writes, no intake resurrection.** H3 maps the blast radius of the [H2 §11](./HISTORICAL-BACKFILL-H2.md) decision (nullable derived scalars) and designs the migration contract. Implementation is reviewed separately.

Inherited invariant:

> **Historical backfill may replace seeded or false state with `unknown`, but it may never manufacture certainty to satisfy an existing scalar type.**

---

## 0. The finding that reshapes the migration

Stated first because it changes what "the backfill emits no events" can mean.

**The reconciler will manufacture the events the importer refuses to emit.**

`core/reconciler` observes the vault, replays `observation.captured` to reconstruct the last known state, diffs, and emits business transitions for the difference. There is no separate observation store — *the event log is the observation state*.

Every entity is currently baselined against **seeded** state:

```text
project:tapia-tile-marble   2026-08-17
  {onboarding: complete, strategy: complete, design: in_progress, dev: not_started, launch: not_started}
```

So if the migration corrects Tapia to reflect the delivered, paid reality, the next `sync-vault` sees three phases move to `complete`, plus `allPhasesResolved` flipping true, and emits:

```text
project.phase_completed ×3     occurred_at = today
project.launched               occurred_at = today
```

A June launch recorded as happening in August. **Precisely the false memory this entire project exists to prevent** — arriving through the back door, from a module whose own doctrine forbids backdating (`occurred_at` is observation time, always, and deliberately so).

### The mitigation, and the honest tension it creates

The existing first-sighting path is the answer: a baseline is not a birth. The migration must **re-baseline** each touched entity — emit `observation.captured` with `baseline: true` carrying the corrected state — so the next sync sees no diff and claims no transition.

That means the migration **does write to the event log**, which sits against the earlier framing of "zero event emission." The invariant needs refining rather than quietly bending:

> **The migration emits no BUSINESS events. It emits `observation.captured` baselines only, `actor: "system"`, because refusing to do so causes the reconciler to fabricate business events instead.**

This is a real change to the contract and needs Oscar's explicit blessing. Note it does not touch §19: the metric counts operator-caused events, and these are `system`.

**Ordering is load-bearing:** re-baseline must be part of the same operation as the vault write. A migration that writes state and defers baselining leaves a window in which any sync fabricates the history.

---

## 1. Complete uncertainty propagation map

### 1.1 The hub

```ts
// core/production/state.ts:112
activePhaseIndex = phases.findIndex(p => p.status !== "complete" && p.status !== "skipped");
```

Every uncertainty consequence routes through this line and through `overallProgress`. Consumer counts, tests excluded: **8 files read `overallProgress`, 14 read `activePhaseIndex`.**

### 1.2 Classification per consumer

`known → known` · `unknown → null` · `independent → survives`

| consumer | file | reads | verdict |
|---|---|---|---|
| `computePhaseProgress` | `core/production/state.ts:81` | `PhaseStatus` | **→ null** — no honest number exists |
| `overallProgress` | `state.ts:110` | phase progress | **→ null** — mean over a null is null |
| `activePhaseIndex` | `state.ts:112` | `PhaseStatus` | **→ ambiguous** — see §1.3 |
| list sort | `state.ts:144-148` | `activePhaseIndex`, `launchTarget` | **survives** — ordering only, no assertion escapes |
| `breakdown.progress` | `health-engine:40` | `overallProgress` | **→ null** |
| `breakdown.momentum` | `health-engine:43` | `hoursLast7Days` | **survives** — time log is independent |
| `breakdown.schedule` | `health-engine:46-62` | `launchTarget` + `overallProgress` | **→ null** when a target exists |
| `score` / `tier` | `health-engine:64-70` | all three subscores | **→ null** — `at_risk` unassertable |
| `daysToLaunch` | `health-engine:51` | `launchTarget` only | **survives** |
| `ruleLaunchCrunch` | `lib/opportunities.ts:110` | progress + active + target | **→ suppressed** — cannot claim crunch |
| `ruleStalledProject` | `lib/opportunities.ts:131` | active + tracked seconds | **→ suppressed** — see §1.4 |
| `ruleLowEhr` | `lib/opportunities.ts:150` | active + seconds + revenue | **→ suppressed** (active-gated) |
| `ruleLaunchedNoRetainer` | `engines/opportunity-engine:85` | `scope.status` only | **survives** — independent field |
| `ruleLaunchedCheckin` | `engines/opportunity-engine:100` | `scope.status` + `launch_target` | **survives** |
| `assembleFiringSignals` | `mission-control/signals.ts:21` | `activePhaseIndex` gate | **→ null health signal** must not become "no signal" |
| `healthToSignals` | `mission-control/adapters.ts:13` | `score`, `tier` | **→ must carry null** — preserves, never invents |
| `rank()` | `engines/decision-engine` | `score`, `tier`, `severity` | **→ needs an unrankable case** |
| notification lifecycle | `engines/notification-engine` | ranked signals | **→ inherits** |
| `evaluatePhaseComplete` | `lib/automations.ts:240` | `p.status === "complete"` | **→ must not fire on unknown** |
| `evaluateLaunchBuffer` | `lib/automations.ts:259` | active + target + progress | **→ must not fire** |
| `compileOperatorBrief` | `lib/compileOperatorBrief.ts:37-52` | active, progress, health | **→ null rendered explicitly** — feeds AI |
| `compileProductionSnapshot` | `lib/compileProductionSnapshot.ts:37-53` | active, progress | **→ null rendered explicitly** — feeds AI |
| graph projection | `graph-view/projection.ts:286-295` | active phase, progress, tier | **→ null** |
| `/clients/[slug]` | `page.tsx:158,261` | progress %, health tier | **→ render uncertainty** |
| `/clients/[slug]/project` | `page.tsx:117,127` | progress, health | **→ render uncertainty** |
| `/crm` | `page.tsx:65,66,218` | building count, at-risk count, badge | **→ counts need a third bucket** |
| `/production` | `page.tsx:61,62,73,222` | in-flight/launched split, at-risk, progress | **→ counts need a third bucket** |
| `/production/[client]` | `page.tsx:25,61` | active phase, progress bar | **→ render uncertainty** |
| `/tasks` | `page.tsx:48` | non-terminal phases | **→ must not emit tasks for unknown** |

The two AI-context compilers deserve emphasis: they are how state reaches Claude prompts. An unknown rendered as `0%` there teaches the model a fabricated fact, and no type system will catch it.

### 1.3 `activePhaseIndex` is genuinely ambiguous and needs a decision

Under `findIndex(status !== complete && status !== skipped)`, an `unknown` phase becomes the active phase — asserting *"this is what the operator is working on right now"* about a phase nobody knows the state of. For Elite Vac that produces "active: Onboarding" for a business live since 2022.

Three candidate semantics, none obviously correct:

| option | behavior | problem |
|---|---|---|
| unknown counts as active | current behavior with a new label | preserves the Elite Vac defect exactly |
| unknown is skipped when finding active | first *known* non-terminal phase wins | asserts the unknown phases aren't active — also unfounded |
| `activePhaseIndex` becomes `number \| null \| "unknown"` | tri-state | correct, but every one of the 14 consumers must handle it |

**H3 recommends the tri-state**, consistent with H2 §11: the honest answer to "which phase is active?" for a project with unknown history is *we don't know*, not a guess in either direction. This is the largest single cost of the migration and should be priced explicitly, not discovered during implementation.

### 1.4 `stalled_project` rests on an ambiguity its own text admits

```ts
const seconds = await secondsInWindow(14, s.clientSlug);
if (seconds > 0) continue;   // zero tracked time → URGENT
```

Zero tracked seconds means *no time was logged*, which the rule treats as *no work happened*. Its own rationale concedes this — *"Either work happened off-the-clock (fix the tracking) or the project is stalled."* The engine hedges in prose and fires URGENT anyway.

Independent of the enum: absence of tracking is not evidence of absence of work. Same failure class, different field.

---

## 2. Defaults that manufacture certainty — the audit

Swept `??`, falsy checks, and initialisation defaults across `core/`, `engines/`, `lib/`, `mission-control/`, `packages/`.

### 2.1 Manufacturing certainty — must be fixed with the migration

| site | code | asserts | reality |
|---|---|---|---|
| `core/production/state.ts:105` | `meta.status ?? "not_started"` | "the phase hadn't begun" | the field is absent |
| `core/reconciler/index.ts:151-152` | `prior/obs state ?? "not_started"` | same, inside transition detection | absent — and it drives event emission |
| `engines/health-engine/index.ts:46` | `let schedule = 100` | **"on schedule"** | **there is no schedule** |
| `core/crm/promote.ts:36` | `opts.packageTier ?? "growth"` | "they bought Growth" | no tier was stated |
| `core/events/index.ts:29` | `input.actor ?? "operator"` | "Oscar did this" | the caller didn't say |

`promote.ts:36` has already caused a visible defect. **Bay Area Custom Shirts carries `tier: "growth"`** in `structural_meta.json` with `source: "hit-list-promotion"` — and H0 classified it as a lead that was never a client. The tier was not recorded; it was defaulted into existence. This is the same bug as the intake `TIER_PRICES[tier]` fallback already recorded in the provenance rules, in a second location.

`core/events/index.ts:29` is the §19 contamination vector from H1, unchanged. Any migration code path must pass `actor` explicitly.

### 2.2 Benign — absence genuinely means the value

`effort-engine:49` (`duration_seconds ?? 0`, commented EF-5 "never fabricated"), map accumulators in `document-engine`, string cleanup in `csv.ts` / `htmlExtract.ts`, notification fingerprints, and the `?? "9999-99-99"` sort sentinel in `state.ts:147` (never escapes the comparator). No action.

### 2.3 The general rule this suggests

Every one of the §2.1 defects has the same shape: **a total function over a partial domain.** The type demanded a value, the data didn't have one, and a literal was chosen. H2 §11.4 forbids this going forward; §2.1 is the existing inventory of where it already happened.

---

## 3. Historical provenance — the minimum that works

Deliberately small, per the brief. Since H2 §7 decided seeded fields **demote to `unknown`**, persisted state carries only the resulting epistemic status — `seeded` stays an H1 classification, never a runtime value.

### 3.1 Status needs no provenance field

`unknown` already *is* the provenance claim: Ascend cannot assert. Adding `status_provenance` alongside it would be redundant for `unknown` and unused for the other four.

### 3.2 Dates need provenance, and precision

A bare date cannot distinguish the two cases the migration must keep apart:

```text
2026-06-20 because a Vercel deployment / paid invoice proved it
2026-06-20 because someone typed it from memory
```

Both are legitimately stored. Only one is evidence. The minimum that separates them:

```yaml
launch:
  status: complete
  completed: "2022-03-01"
  completed_precision: month      # day is invented; only the month is known
  completed_source: derived       # observed | derived | confirmed
```

`completed_precision` is not optional decoration. Elite Vac's `2022-03-01` currently asserts a specific day nobody knows — the same manufactured certainty as §2.1, in date form. H1 found this shape repeatedly: repo `createdAt` proves a build began, last-push does not prove a launch.

Three source values only — `observed` (the OS witnessed it), `derived` (reconstructed from artifacts), `confirmed` (Oscar stated it). Absent means unknown. No framework, no per-field provenance blocks, nothing for fields the migration does not touch.

### 3.3 Scope limit

Provenance applies to **historical dates written by the migration**, nowhere else. Fields Ascend witnesses in the normal course already have provenance — the event that recorded them.

---

## 4. Seeded-data cleanup boundary

Per-artifact disposition. "Retain" means the record is genuine or is structurally useful without pretending to be historical evidence.

| artifact | count | disposition | reasoning |
|---|---|---|---|
| Pilar phase dates (5 phases) | 5 | **→ unknown** | script literals; no evidence exists |
| Tapia phase dates | 5 | **→ unknown** | script literals, and demonstrably counterfactual |
| `seed-inv-*` invoices | 7 | **delete** | fabricated financial records; they misstate revenue and have already fired an automation (§5) |
| Tapia final payment `0c3c1b03` | 1 | **retain** | UUID id, plausible amount, non-seed origin |
| `seed-pilar-*` time entries | 11 | **delete** | "realistic historical entries" — fabricated |
| `seed-*` Tapia time entries | 2 | **delete** | same |
| Tapia UI-test time entries | 11 | **delete** | 1–2 second durations; artifacts of testing, not work |
| `seed-aud-*` audits | ≥6 | **delete** | fabricated PSI results |
| `seed-doc-*` documents | 3 | **decide** | not yet inspected; likely fabricated contract/proposal versions |
| Pilar/Tapia business + brand context | — | **retain, mark unconfirmed** | plausible and useful for AI context, but unverified — must not be cited as fact |
| Pilar/Tapia identity (name, slug, domain, tier) | — | **retain** | `confirmed` in H0 |
| Bay Area Custom Shirts client record | 1 | **separate decision** | asserts a client relationship that never existed; not a backfill target |
| `scaffold-vault.mjs` | — | **retain** | legitimate fixture generator. The defect was its output entering the production vault, not the script |

Two notes on the script: it is idempotent (`writeIfMissing`, line 37), so it will never overwrite corrections; and it never calls `emitEvent`, so it cannot pollute the spine. It should, however, gain a guard against targeting the real vault.

Deleting records raises a question H3 does not answer: **deletion is invisible to the reconciler**, which observes markdown state and JSONL read-models, not their absence. Whether removed seeded records need a recorded rationale — and where — is an open item (§7).

---

## 5. What is currently deciding from seeded state

Quantified, as requested. This is the correctness fix already in flight, not a hypothetical.

### 5.1 A seeded invoice has already caused the OS to act

```json
{"firing_id":"welcome-on-deposit::seed-inv-pilar-01","rule_id":"welcome-on-deposit",
 "fired_at":"2026-06-20T13:22:50.104Z","context":{"client_slug":"decoraciones-pilar",
 "client_name":"Decoraciones Pilar","label":"Initial deposit","amount":"$1,248"}}
```

An automation fired on a **fabricated deposit**. Seeded data is not inert and never was — it has already crossed from record into action.

Installed rules whose triggers read the affected fields: `welcome-on-deposit`, `phase-complete-celebration`, `launch-buffer-qa` (Tapia sits squarely in its window), `hot-lead-prompt`.

### 5.2 Live false signals, per client

| client | seeded/unsupported state | signals produced today |
|---|---|---|
| **Tapia** | design `in_progress`, dev/launch `not_started`, target 2026-08-15 | `launch_crunch` **URGENT** ("10d overdue, 50% done"), `stalled_project` **URGENT**, health **25 at_risk** — about a delivered, paid site |
| **Elite Vac** | 4 phases `not_started`, no target | health **30 at_risk**, active phase "Onboarding", `stalled_project` **URGENT** — about a site live since 2022 |
| **Pilar** | all phases `complete` (fabricated) | none adverse — reads launched; the falsehood is invisible, which is its own hazard |
| **Bay Area Custom Shirts** | client record for a non-client, `tier: growth` defaulted | counted in `/crm` "building", inflates roster and any revenue view |

### 5.3 Surfaces consuming it

`/signals` (opportunities + ranked feed + the Slice 1 attention queue), `/` (priority feed), `/crm`, `/production`, `/production/[client]`, `/clients/[slug]`, `/clients/[slug]/project`, `/tasks`, the graph projection, and both AI context compilers.

**Four of the six URGENT-class signals the OS can currently raise are false**, and they render on the surface whose entire purpose is deciding what deserves attention — the one Slice 1 just made actionable.

### 5.4 The expected effect of the migration

Replacing this state with `unknown` should make those signals **disappear**, not change severity. That is the predicted outcome and the migration's acceptance test: a signal that survives the removal of the fabricated premise that produced it indicates a rule reading something other than what it claims to.

This is also the honest reason to be careful rather than fast. The OS will get *quieter*, and a quieter queue must not be mistaken for a fixed one — nor for evidence about §19, which measures operator events and is untouched by any of this.

---

## 6. Migration safety — the dry-run contract

```text
INPUT     vault · git · deployment · invoice evidence · confirmed facts (H0)
   ↓
CLASSIFY  observed · derived · confirmed · unknown · seeded
   ↓
PROPOSE   state changes only — no business events
   ↓
DRY RUN   complete reviewable diff
   ↓
HUMAN REVIEW
   ↓
APPLY     vault write + observation re-baseline, atomically
```

> **A migration must be able to produce a complete, reviewable diff before it is allowed to write anything.**

### 6.1 Required properties

1. **Dry-run is the default.** Writing requires an explicit flag; there is no path where a first run mutates.
2. **The diff is total.** Every proposed change, with before, after, class, and the evidence for it. A change that cannot state its evidence is a bug in the migration.
3. **Deletions are itemised**, never summarised as counts.
4. **Unknowns are listed explicitly** — the fields being demoted are the point of the exercise, not a footnote.
5. **No business events**, ever. `observation.captured` baselines only, `actor: "system"`, in the same operation as the write (§0).
6. **Idempotent.** Re-running after apply proposes nothing.
7. **Reversible.** Vault snapshot before apply. iCloud sync is not a backup.
8. **`actor` passed explicitly** at every emission site — never relying on `core/events:29`.

### 6.2 Acceptance test

Post-migration, re-running `sync-vault` must report **zero transitions**. A single emitted business event means the re-baseline was wrong and the migration fabricated history.

### 6.3 Sequencing constraint

The H2 §11 engine work (nullable scalars) and this migration are separable but ordered. Migrating first leaves `unknown` values flowing into engines that still coerce them; shipping engines first leaves them correct but idle. **Engines first, migration second** — the migration is then the event that makes the new code paths live, and its acceptance test (§5.4) actually means something.

---

## 7. Open items H3 does not close

1. **The `observation.captured` concession (§0)** — needs Oscar's explicit approval; it revises "zero event emission."
2. **`activePhaseIndex` tri-state (§1.3)** — the largest cost item; recommended, not decided.
3. **Deletion provenance (§4)** — should removed seeded records leave a recorded rationale, and where?
4. **`seed-doc-*` documents (§4)** — three document records not yet inspected.
5. **Bay Area Custom Shirts** — reconciling a false client relationship is its own decision.
6. **`stalled_project`'s tracking-vs-work ambiguity (§1.4)** and **`schedule = 100` (§2.1)** — both independent of the enum; both would survive a clean `PhaseStatus` fix unnoticed.
7. **The rank/notification null path (§1.2)** — what a null-health signal does inside `rank()` needs its own design; it must not silently drop.

No code has been written. `PhaseStatus` remains frozen at four states. `wip/intake` remains quarantined.