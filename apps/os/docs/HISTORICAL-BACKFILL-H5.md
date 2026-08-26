# Historical Backfill — H5: Migration Contract

**Status: investigation. No migration code, no vault writes, no importer.** H4 repaired the interpreter (`6649528`); H5 designs the repair of the historical records themselves. Implementation is reviewed separately.

> **How do we replace the seeded historical fiction without creating new historical fiction?**

Standing constraint carried forward, recorded so the migration cannot erode it:

> **Do not loosen the schedule rule because more clients become indeterminate.** If no launch target exists, `schedule` cannot be computed and `null` is correct. Deciding health should be computable without a target is a NEW health-model decision requiring evidence and a pre-registered rule — never a concession extracted by migration pressure.

---

## 1. Classification

**Classification is an internal migration-time evidence decision. It does not enter the business domain.** No new permanent provenance vocabulary is added — the domain gained exactly one state (`unknown`) in H4 and gains nothing further here.

```text
INTERNAL (migration only)              RESULTING BUSINESS STATE
  business fact                 ──→      known
  seeded                        ──→      unknown
  synthetic / test artifact     ──→      removed
  unknown                       ──→      unknown
```

Why *removed* rather than *unknown* for synthetic artifacts: `unknown` means "a fact exists and Ascend cannot establish it." A test artifact has **no underlying fact to be uncertain about** — it is a real record of a non-real action. Demoting it would assert that something happened whose details are unclear, which is a different and false claim.

The reason a record was removed does not become a runtime domain state. It lives in the manifest (§10), which is a reviewable artifact, not a schema.

| internal class | disposition |
|---|---|
| `seeded` — authored by `scripts/scaffold-vault.mjs` | → `unknown` |
| `synthetic` — produced by exercising the UI | **remove** |
| `derived` — reconstructed from artifacts | retain only while its evidence chain holds (§3) |
| `confirmed` — Oscar stated it | retain as known |
| `unknown` | remains unknown |

### 1.1 The fifth class, and why it is not "seeded"

H3.1 left `seed-doc-*` uninspected. Resolved:

| doc | id | amount | created | class |
|---|---|---|---|---|
| Pilar proposal v1 | `seed-doc-pilar-prop-v1` | $2,997 | 2025-05-08 | seeded |
| Pilar proposal v2 | `seed-doc-pilar-prop-v2` | $2,497 | 2025-05-12 | seeded |
| Pilar contract v1 | `seed-doc-pilar-contract-v1` | $2,497 | 2025-05-14 | seeded |
| Pilar agreement v2 | `f0911bd7-…` | $2,497 | 2026-06-20T23:27:17.725Z | **test artifact** |
| Tapia SOW v1 | `babed1df-…` | $625 | 2026-06-20T23:27:17.155Z | **test artifact** |

The last two carry UUIDs and 2026 timestamps, so they read as genuine operator-created records. They are not. They were created **570 ms apart**, in the same session that produced Tapia's 1–2 second time entries at 23:42 the same evening. This is the third place the same signature appears — checklist toggles flipped on/off/on/off, timer entries of 1–2 seconds, and now two documents authored in the same second.

`test artifact` is distinct from `seeded` because it is not fiction authored by a script; it is a **real record of a non-real action**. It cannot be demoted to `unknown` — there is no underlying fact to be uncertain about. It is deleted.

**A UUID and a plausible timestamp are not evidence of genuineness.** Any classifier that trusts id format will misclassify these two. The reliable signal is temporal clustering against known testing sessions.

---

## 2. Source precedence

Which evidence may upgrade `unknown`, strongest first:

```text
observed business event        the OS witnessed the transition
  > external system evidence   invoice paid, deployment recorded
  > repository evidence        commit dates, repo creation
  > operator confirmation      Oscar states it
  > unknown
```

### 2.1 Two rules that keep the ladder honest

**Precedence orders trust; it does not manufacture it.** A lower rung never becomes "known" merely because no higher rung exists. If the strongest available evidence supports only "a build existed by date X", the record says that — it does not round up to a phase completion.

**Operator confirmation sits BELOW machine evidence, and that is deliberate.** Oscar's recall is authoritative about *what happened* (was this a paid client? which package?) and unreliable about *when*. Where the two disagree on a date, the artifact wins and the disagreement is recorded rather than silently resolved. Where only recollection exists, the value is `confirmed` — a real class, but not upgradeable to `observed`.

**Evidence must be nameable per field.** The acceptance test in §7 is "point to the evidence that caused this number to exist." A field whose evidence cannot be named is a field that should be `unknown`.

---

## 3. Historical dates

Repeating H1's finding because the migration will be tempted by it at every turn:

| artifact | proves | does NOT prove |
|---|---|---|
| commit on 2026-07-24 | code existed / was modified that day | the project started that day |
| last push | code stopped changing | the site launched |
| repo `createdAt` | a build began | a client signed |
| paid invoice | money moved on that date | a phase completed |
| live domain | a web artifact exists | who built it, when, or for how much |

Every migrated date carries precision and source (H3.1 §3.2):

```yaml
launch:
  status: complete
  completed: "2022-03-01"
  completed_precision: month      # the day is invented
  completed_source: derived       # portfolio entry, not witnessed
```

**`completed_precision` is load-bearing, not decoration.** Elite Vac's `2022-03-01` currently asserts a specific day nobody knows — manufactured certainty in date form, the same defect class as `schedule = 100`.

Where evidence supports a *window* rather than a date, the migration records the window or records `unknown`. It never picks a representative day.

---

## 4. Re-baselining — the dangerous part

Approved as an authorized system observation (H3.1 §1). Stated in the contract as what it is, not as "no events":

> The migration emits **no business events**. It emits `observation.captured`, `actor: "system"`, `baseline: true` — because refusing to do so causes the reconciler to fabricate business events instead. Outside §19 by construction.

### 4.1 Scope is wider than projects

`core/reconciler/observation` observes **four entity kinds**: `client`, `prospect`, `project`, `document`. Every one of them is touched by this migration, so every one needs re-baselining. A project-only re-baseline would leave three open channels.

### 4.2 The H4 repair already made the phase dimension crash-safe

A genuinely useful consequence, worth stating because it changes how careful the ordering must be.

`phaseTransitionType` now returns `null` for any transition **into or out of `unknown`** (H4 §6). The migration's dominant phase operation is `seeded value → unknown`. So if the process dies between the vault write and the baseline — in either order — a subsequent sync sees an `unknown` on one side and emits nothing.

The same holds for evidenced upgrades: `unknown → complete` also emits nothing, because learning a fact is epistemic. **The phase dimension cannot fabricate history through a crash window.**

### 4.3 The residual hazard is status, not phases

`client`, `prospect` and `document` do not go through `phaseTransitionType`. They use a direction-neutral status comparison:

```ts
const type = STATUS_EVENT[obs.entity];        // client.status_changed | prospect.status_changed | document.status_changed
if (type && from !== to && to.length > 0) { …emit… }
```

There is no `unknown` concept here and no epistemic guard. **Any migration edit to a client's status, a prospect's status, or a document's status will emit a business event dated today unless that entity is re-baselined first.** This is precisely where Bay Area Custom Shirts lives (§6.6).

H5 recommends: **baseline before write for status-bearing entities; either order is safe for phases.** Writing the baseline first means a crash leaves the baseline ahead of the vault, and the next sync would compare corrected→seeded — for status entities that is still an emission, so the true protection is that the migration is idempotent (§5) and re-runs before any sync. Recorded as a residual risk, not a solved one.

### 4.4 Deletion is invisible to the reconciler

`observeVault` reports what exists. An object removed from the vault simply stops appearing; nothing detects its absence, and its prior `observation.captured` stays in the replay map permanently.

So deleting a record leaves a **stale baseline asserting an object that no longer exists**, and the OS will never notice. This is not a bug in the reconciler — it observes state, not absence — but it means the migration cannot use deletion as a silent operation. Anything the migration deletes needs a recorded rationale somewhere the system can still read.

**Unresolved:** where that rationale lives. A `record.removed` event would be a new business event type, which this migration is forbidden from inventing. Carried to §8.

---

## 5. Idempotence and rollback

> **Running the migration twice must produce the same vault state and must not produce additional business events.**

Required properties:

1. **Dry-run is the default.** Writing requires an explicit flag. No path exists where a first run mutates.
2. **The plan is computed before anything is written** — `snapshot → plan → review → apply → re-baseline`, never `scan → mutate → discover`.
3. **The diff is total:** every change with before, after, class, and named evidence. A change that cannot state its evidence is a bug in the migration.
4. **Deletions itemised**, never summarised as counts.
5. **Demotions to `unknown` listed explicitly** — they are the point of the exercise, not a footnote.
6. **Snapshot before apply.** iCloud sync is not a backup; the vault sits under an iCloud-synced Desktop path that has already been shown to corrupt `.next/types` with duplicate files.
7. **`actor` passed explicitly** at every emission site — never inheriting `core/events:29`'s `?? "operator"`.
8. **No `sync-vault` run during the migration window.**

### 5.1 What makes re-running safe

Idempotence is structural, not a guard flag: a second run classifies already-migrated fields as `unknown → unknown` or `confirmed → confirmed`, producing an empty plan. The scaffold script is itself idempotent (`writeIfMissing`), so it can never re-seed over corrections.

---

## 6. The six subjects

### 6.1 Decoraciones Pilar — seeded → unknown
All five phase dates, the $2,497 contract value, 4 care-plan invoices, 11 time entries, ≥6 audits and 3 documents are scaffold-authored. Retain: identity, domain, tier (`confirmed`). Business/brand context retained but marked unconfirmed — plausible, useful for AI context, never citable as fact.

### 6.2 Tapia Tile & Marble — seeded → unknown, *despite* live/paid evidence
The hardest case, and the discipline test. The site is live and the final payment is real — but neither proves *when phases happened*. Live + paid supports `launched`; it does not reconstruct a phase history. The seeded `launch_target: 2026-08-15` demotes with everything else.

Retain: the non-seed $1,249 invoice, identity, domain, tier. Delete: 11 UI-test time entries, 2 seeded entries, 1 test-artifact SOW.

### 6.3 Elite Vac — unknown except what is independently supported
Already the best-behaved record. Keep the 2022-03 launch with `precision: month`, `source: derived`. Correct `.com` → `.co` **in place** — do not create a second identity. Four phases become `unknown` (they are currently `not_started`, which is the lie).

### 6.4 Bedolla's Landscaping — new record from evidence
`confirmed`: paid client, Growth. `derived`: repo `oski-650/bedollas-landscaping`, created 2026-07-24, 6 commits that day + 1 on 2026-08-10, artifacts from commit subjects. `unknown`: launch date, contract value, contacts, all phase dates. A dev window is not a phase history.

### 6.5 The Best House Cleaning Team — new record from evidence
`confirmed`: paid client, Starter. `derived`: repo created 2026-05-12, commits 05-12/05-15×3/05-16/05-26. `unknown`: everything else. Vercel would upgrade the launch dates for both — the CLI token is expired and this is optional, not blocking.

### 6.6 Bay Area Custom Shirts — the promotion was wrong, not the record

**Do not migrate it as a client, and do not make its client record more accurate.** The accurate state is that the promotion should never have happened. It has no invoices, no production events, a `tier: "growth"` fabricated by the `promote.ts` default now fixed, and a website that is not an Ascend build.

Correcting it collides with §4.3 and §4.4 simultaneously:

- flipping the prospect from `closed-won` emits `prospect.status_changed` **dated today** — a false claim that the deal reversed now;
- changing or removing the client record emits `client.status_changed`, or vanishes silently leaving a stale baseline.

Neither option is available without inventing a business transition. **H5 does not resolve this** — it is a distinct decision about how the OS records *"a fact was entered in error"*, as opposed to *"the business changed"*. The vocabulary has no term for a correction, and inventing one is a domain decision, not a migration detail.

Recommendation: **exclude Bay Area Custom Shirts from the migration entirely** and handle it as its own increment. Bundling it would force exactly the kind of quiet vocabulary invention this project refuses.

---

## 7. Acceptance test

Re-run the same read-only live-vault inspection used to verify H4. For every client, every derived number must answer:

> **Can I point to the evidence that caused this number to exist?**

If not, the number should not exist.

### 7.1 The decisive criterion

**Tapia's false URGENT signals must disappear because their premises disappeared — not because H5 suppressed those signals.**

The migration touches no rule in `lib/opportunities.ts`. `launch_crunch` stops firing because `overallProgress` is null and the seeded target is gone; `stalled_project` stops firing because `activePhaseIndex` is null. If either still fires, a rule is reading something other than what it claims to. If either was made to stop by editing the rule, the migration has hidden the consequence instead of repairing the state.

### 7.2 Additional criteria

1. `sync-vault` reports **zero business transitions** after migration. One emitted event means a re-baseline was wrong and history was fabricated.
2. Re-running the migration produces an empty plan.
3. Independent evidence survives: paid invoices, live sites, client identity, momentum, provenance-carrying dates.
4. No consumer reinterprets absence as a positive fact — not "launched", not "not building", not "healthy", not weight 15, not omitted from the operator brief.
5. The OS gets quieter. **A quieter queue is not proof the system is fixed**, and it is not evidence about §19, which counts operator-caused events and is untouched.

---

## 9. LOCKED CONTRACT (approved 2026-08-25)

### 9.1 The boundary H4 established, generalised

H4 did not merely repair health. It established a reusable safety boundary, and it now governs the whole migration:

> **Epistemic correction must not become a business transition.**

### 9.2 Four entity families require independent re-baselining

`project` · `client` · `prospect` · `document`. Modifying any of them without updating its observation baseline risks creating a present-day business event. A project-only re-baseline leaves three open channels.

### 9.3 Crash safety — now an invariant, and proven

> **A crash before or after the vault write cannot cause a historical phase transition event to be emitted.**

**Tested, not trusted.** `tests/engines/reconciler.test.ts` gained **STOP 5 · epistemic change is not business history** — five gates against a real temp vault, the real emitter and the real event log:

| gate | proves |
|---|---|
| `seeded → unknown emits NO business event` | the migration's core write claims nothing; the observation still advances |
| `unknown → complete emits NO business event` | learning a fact is not witnessing one |
| `any unknown phase never emits project.launched` | a historical project cannot acquire a launch the OS never saw |
| `CRASH SAFETY — written but never re-baselined` | both orderings — baseline ahead of vault, and vault ahead of baseline — fabricate nothing |
| `REGRESSION — a genuine transition is still emitted` | the control: `in_progress → complete` still emits, so the guard is not silencing real history |

25 tests pass in that file. These gate the reconciler **as it stands**; they are not tests of migration code, which does not exist.

### 9.4 Bay Area Custom Shirts is excluded from H5 entirely

Not a bad client record — a **bad historical assertion that a lead became a client**. Deletion or status reversal would manufacture history in one direction or the other. It needs its own correction vocabulary and its own investigation, and stays outside this entire chain until that exists.

---

## 10. The migration manifest

Defined **before** any migration is written. A deterministic, reviewable artifact — not a database, not a new store.

> **The migration must not discover what it thinks while simultaneously changing the vault.**

### 10.1 Shape

```text
entity · field · current value · proposed value · classification · evidence · confidence · baseline action · business event
```

### 10.2 Worked entries

```text
project/tapia-tile-marble
  field:           phase.design
  change:          in_progress → unknown
  classification:  seeded
  evidence:        scripts/scaffold-vault.mjs (script literal)
  confidence:      certain — the authoring source is identified
  baseline:        required
  business event:  none

document/babed1df-2536-4e30-a80c-59227ae67c1d   (Tapia SOW v1)
  change:          existing → removed
  classification:  synthetic / test artifact
  evidence:        created 2026-06-20T23:27:17.155Z, 570 ms before f0911bd7; same session
                   as 11 time entries of 1–2 s duration
  confidence:      high — temporal clustering, not id format
  baseline:        required
  business event:  none

project/elite-vac-service
  field:           phase.launch.completed_precision
  change:          (absent) → month
  classification:  derived
  evidence:        portfolio entry, month granularity; no day is known
  confidence:      medium
  baseline:        required
  business event:  none
```

### 10.3 Properties

1. Produced by a **dry run that writes nothing**; writing requires an explicit separate flag.
2. **Total** — every proposed change appears. A change that cannot name its evidence is a bug in the migration, not an entry.
3. Deletions **itemised**, never summarised as counts.
4. Demotions to `unknown` listed explicitly — they are the point, not a footnote.
5. Reviewed by a human **before** any mutation.
6. Re-running after apply produces an **empty manifest**.

---

## 11. Acceptance suite — required before implementation is allowed

| # | criterion | status |
|---|---|---|
| 1 | Migration is deterministic | pending H6 |
| 2 | Running it twice produces the same state | pending H6 |
| 3 | `seeded → unknown` produces no business event | **PROVEN** — STOP 5 |
| 4 | Synthetic artifacts are removed, not converted to unknown | pending H6 |
| 5 | Client/prospect/document changes cannot create today's historical transitions | **pending — the residual hazard (§4.3)** |
| 6 | Every modified entity gets the appropriate baseline treatment | pending H6 |
| 7 | A crash/retry cannot duplicate business events | **PROVEN for phases** — STOP 5; open for status entities |
| 8 | Tapia's urgent signals disappear because their premises disappear | pending H6 |
| 9 | No opportunity/signal rule is modified | enforced by review of the H6 diff |
| 10 | **§19 receives zero operator events from the migration** | pending H6 — `actor` passed explicitly at every site |

Criterion 10 matters more than its position suggests: **the adoption experiment is running concurrently**, and a migration that emitted operator-actor events would corrupt the very measurement §19 exists to take. Every emission site passes `actor: "system"` explicitly rather than inheriting `core/events:29`.

Criterion 5 is the honest gap. Phases are safe by construction; `client`, `prospect` and `document` have no `unknown` concept and no epistemic guard, so their protection is procedural (baseline-before-write, idempotent re-run) rather than structural. **H6 must not treat 5 as covered by 3 and 7.**

---

## 12. Sequence

```text
H4  make the interpreter honest                                    ✅ 6649528
H5  specify how historical evidence is classified and transformed  ← this document
H6  implement deterministic migration + manifest + re-baselining
H7  inspect the resulting OS: fabricated attention gone, legitimate attention intact
```

Only after H7 is it worth deciding whether the historical data is useful enough to justify more work. Bay Area Custom Shirts stays outside the entire chain.

---

## 12.1 H6 implementation record (2026-08-25)

Built at `apps/os/migration/` — **not wired to any surface**, and F25 now enforces that. `tsc` clean · `eslint` 0 errors · build succeeds · **505 tests pass, 9 skipped** · 24 migration gates (G1–G8) · 91 fitness rules.

**The live vault was never written to.** Verification ran against a `cp -R` snapshot in the scratchpad.

### Snapshot run — a copy of the real vault

```text
BEFORE                                                          AFTER
elite-vac-service    in_flight       overall=20   score=null    indeterminate  overall=null  score=null
tapia-tile-marble    in_flight       overall=50   score=25 ⚠    indeterminate  overall=null  score=null
decoraciones-pilar   launched        overall=100  score=70      indeterminate  overall=null  score=null
bay-area-custom…     in_flight       overall=0    score=20      UNCHANGED — excluded by decision

manifest 56 entries · applied mutated=17 removed=39 baselines=4 skipped=0

PASS  every planned change was applied      (none skipped)
PASS  operator business events unchanged    (before=10 after=10)
PASS  reconciler reports zero transitions   (none)
PASS  re-planning produces an empty manifest
```

**`urgent:launch_crunch:tapia-tile-marble` is gone, and no rule was touched.** `lib/opportunities.ts` is byte-identical; the signal stopped because `overallProgress` became null and the seeded target was removed. That is §7.1 satisfied on real data — the premise disappeared, not the symptom.

`stalled_project` for Tapia and Elite Vac also cleared (their `activePhaseIndex` is now null). Legitimate attention survived untouched: `launched_checkin`, `launched_no_retainer`, `hot_lead_untouched`.

### The bug the snapshot found that fixtures did not

The first snapshot run failed `re-planning produces an empty manifest` with 4 entries remaining. Cause: **Elite Vac's `production_state.md` uses inline-map YAML** — `onboarding: { status: not_started }` — written by the quarantined intake route, while every seeded client uses block form. Both parse identically through `core/production`, so the difference is invisible to every reader; the rewriter matched only block form and skipped four phases in silence.

Two consequences, both now closed:

1. `setPhaseStatus` handles both forms, pinned by a named regression test.
2. **A skipped entry is a failure, not a note.** `verifyMigration` takes the apply report and fails on any skip, so the cause is reported rather than the symptom.

This is the argument for verifying against a snapshot rather than a fixture, made concrete: the fixture suite was green while the migration silently no-opped on the one client whose record was already the most honest in the vault.

### What is NOT done

The live vault is unmigrated. Applying to it is a **separate decision** (§12), not a consequence of this work.

---

## 12.2 Step 6 — regeneration record (2026-08-26)

The manifest is now an **output of the coverage model**, not an independently maintained list. `migration/registry.ts` declares every durable business fact from [COVERAGE-MATRIX.md](./COVERAGE-MATRIX.md) with its authoritative source, authority standing, observability and treatment; the planner walks that table and has no other source of truth.

**Coverage went from 5 facts to 21.** Manifest entries on a real-vault copy: **56 → 87**.

```text
[F] deterministic=true   entries=87   validation=[]
[apply] mutated=48  removed=39  baselines=6  skipped=0

PASS  every planned change was applied
PASS  operator business events unchanged   (before=10 after=10)
PASS  reconciler reports zero transitions
PASS  re-planning produces an empty manifest

SIGNALS  8 → 4      launch_crunch:tapia          gone
                    stalled_project:tapia        gone
                    stalled_project:elite-vac    gone
                    launched_checkin:pilar       gone  ← new in Step 6
```

`launched_checkin` disappeared because retiring `project_scope.launch_target` removed the last fabricated date feeding it — Step 5 repointed the consumer, Step 6 removed the premise. `lib/opportunities.ts` remains untouched throughout.

### What Step 6 added beyond H6

| fact | treatment |
|---|---|
| `project_scope.phase` / `.status` / `.package` / `.launch_target` | **retired** — 3 clients × 4 fields |
| phase `started` / `completed` | seeded dates removed with their phase |
| Elite Vac's evidenced `completed` | **kept**, annotated `completed_precision: month` |
| `industry_template` | removed where seeded or defaulted to `generic` |
| `revenue_usd` | classified if present — not rescued by its name |

### Two facts deliberately NOT migrated

Recorded with reasons rather than fabricated, and asserted as record-only by G9:

**Checklist state.** A markdown checkbox has two states and neither is `unknown`. `[x]` asserts the step was done, `[ ]` asserts it was not; for a seeded project both are false. The same vocabulary failure `PhaseStatus` had, one level down — and the same answer: do not pick a lie.

**Automation firings.** `welcome-on-deposit::seed-inv-pilar-01` fired from a fabricated invoice, but the operator really did act on it. That its trigger was fiction does not un-happen the action. Removing it erases history; keeping it leaves a firing whose cause disappears. Neither is obviously right, so the migration asserts neither.

### Enforcement

**G9** binds the planner to the registry: every rule is acted on or explicitly blocked with a stated reason; the planner touches no undeclared source; exactly the four scope keys are retired and scope *content* survives; record-only facts produce no entry.

**F26's reader allowlist** caught the migration opening `project_scope.md` and required a named exemption rather than a weakened rule — the migration is the one reader whose purpose is to make the others unnecessary.

**Retirement is safe because of A1**, not because it looks tidy: `tests/engines/authority-repair.test.ts` proves changing these fields alone produces no behavioural change and no event.

**546 tests pass.** The live vault remains unmigrated and unwritten.

---

## 13. Open items H5 does not close

1. **Deletion rationale (§4.4)** — deletions leave stale baselines and the system cannot read a reason. Recording one needs a vocabulary the migration may not invent.
2. **Bay Area Custom Shirts (§6.6)** — how the OS records "entered in error" versus "the business changed". Its own increment.
3. **Status-entity crash window (§4.3)** — mitigated by idempotence, not eliminated.
4. **Vercel launch dates** — optional evidence upgrade; requires `vercel login`.
5. **Test-artifact detection (§1.1)** — temporal clustering identified these five by hand. Whether that needs to be systematic depends on how much more testing residue exists.

No code has been written. No vault writes. `wip/intake` remains quarantined.