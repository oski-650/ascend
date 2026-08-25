# Historical Backfill — H3.1: Closing the Open Items

**Status: investigation. No code, no enum change, no vault writes.** H3.1 closes the seven items left open by [H3](./HISTORICAL-BACKFILL-H3.md), in the order Oscar set. It ends at the boundary of H4 (Migration Contract). `PhaseStatus` remains frozen.

The invariant all of this now serves:

> **The OS must never turn absence of evidence into a business fact.**

---

## 1. DECISION — the system baseline exception (approved)

**Approved 2026-08-25 by Oscar.** Recorded as a decision, not an implementation convenience.

> **Historical migration may create system baselines. It may never create historical business events.**

The migration may emit, for entities whose historical state it corrects:

```text
observation.captured
actor:    system
baseline: true
```

What it means:

```text
✓  "This is the state from which future changes are now observable."
✗  "The business reached this state today."
```

Approved because the alternative is worse: without a re-baseline, `core/reconciler` diffs corrected state against the seeded baseline and manufactures `project.phase_completed` and `project.launched` dated today (H3 §0). Recording a system observation is honest; letting the reconciler invent business history is not.

Outside §19 by construction — that metric counts operator-caused events, and these are `system`.

**Scope limit:** this exception covers the migration only. It is not a general licence to write baselines to suppress reconciler output; any other use is a separate decision.

---

## 2. Side-effect audit — and a correction to H3 §5.1

Oscar's instruction was to audit everywhere seeded state can cause side effects, "not merely UI signals." That audit is now complete, and **it contradicts the framing H3 gave it.** Stated plainly, because it changes the priority H3.1 was asked to assign.

### 2.1 There are no external side effects

Every outbound path in the codebase:

| path | trigger | reads phase/health state? |
|---|---|---|
| `lib/urlGuard.ts:133` | operator submits a prospect URL | no |
| `lib/lighthouse.ts:60` | operator runs a PSI audit | no |

**That is the complete list.** No email sender, no Resend/SMTP/nodemailer, no webhook, no scheduled push. The client-facing portal (`app/portal/[token]`) handles document approvals only and **never reads production, phase, health, or progress state** — verified by grep, not assumed.

### 2.2 What the automation firing actually was

H3 §5.1 presented `welcome-on-deposit::seed-inv-pilar-01` as seeded data crossing "from record into action," under an external-consequence framing. That overstates it.

Automations are **clipboard prompt compilers**. Each rule carries a `clipboard_label`; "firing" means `dismissFiring()` appends to `automations_fired.jsonl` when the operator acts on a pending item. Nothing is sent anywhere.

So the true chain is:

```text
seeded invoice → pending firing surfaced → operator attention → compiled prompt on clipboard
```

Real, and worth fixing — a fabricated $1,248 deposit produced a client-facing welcome-email draft and consumed operator attention. But it is **not** an external consequence, and the migration is not urgent on those grounds.

### 2.3 The actual blast radius

| channel | severity | note |
|---|---|---|
| operator attention | **highest** | 4 of 6 URGENT-class signals are false (H3 §5.2) |
| AI context packs | **high** | `compileOperatorBrief`, `compileProductionSnapshot` feed fabricated facts into prompts; no type system catches this |
| clipboard artifacts | moderate | client-facing drafts built on false premises, operator-reviewed before use |
| `automations_fired.jsonl` | low | a record that a false firing was actioned |
| external systems | **none** | nothing leaves the machine |

### 2.4 What this changes

The correctness fix is **real but contained**. It corrupts Oscar's decisions and Claude's context; it does not reach clients. That argues for doing this carefully in the H2→H4 order already set, and against treating it as an incident requiring a fast patch.

Rules whose triggers read affected fields, for the record: `welcome-on-deposit` (invoice.paid), `phase-complete-celebration` (production.phase_completed), `launch-buffer-qa` (active + launch_target + overall_progress — Tapia sits in its window), `hot-lead-prompt` (prospect status, unaffected).

---

## 3. DECISION — `activePhaseIndex` stays `number | null`

**Oscar's call adopted; the tri-state recommendation from H3 §1.3 is withdrawn.** The principle he stated is now recorded as an architectural rule:

> **Do not encode uncertainty into derived values unless the consumer requires the distinction.**

Correct because the underlying `PhaseStatus` already carries the uncertainty. Propagating a second encoding of it through 14 consumers makes all of them pay for a distinction most do not need.

```ts
activePhaseIndex: number | null
//  number → evidence identifies the active phase
//  null   → no active phase, OR it cannot be determined
```

### 3.1 Which consumers genuinely require the distinction

He asked H3 to identify these explicitly rather than tax everyone. Examined all 14. **Three require it. Eleven do not.**

**Require it — because they interpret `null` as a positive claim:**

| consumer | code | the false claim |
|---|---|---|
| `/production` | `page.tsx:61-62` | `launched = filter(activePhaseIndex === null)`, rendered under a section headed **"Launched"** with aside `${launched.length} live`, and `page.tsx:221` pushes the literal string `"launched"` as card meta |
| `/crm` | `page.tsx:65` | `building = filter(activePhaseIndex != null)` — an unknown project is silently counted as *not building* |
| `compileOperatorBrief` | `.ts:37` | `if (activePhaseIndex === null) continue; // skip launched` — the comment says it outright; unknown projects vanish from the AI brief with no trace |

`/production` is the decisive case. Under a naive `number | null`, **Elite Vac would be asserted as launched and live** — which is option C's `100 / 1 = 100%` failure (H2 §4) reappearing in a different variable. Maximal ignorance rendered as maximal confidence.

**Do not require it** — eleven consumers, where `null` correctly means "suppress":

`state.ts:144` (sort ordering only) · `lib/opportunities.ts:117,135,156` (crunch/stall/EHR gates — suppression is the desired behavior) · `lib/automations.ts:264` (launch-buffer gate — must not fire) · `app/clients/[slug]`, `app/clients/[slug]/project`, `app/production/[client]`, `graph-view/projection` (render active phase or fall through) · `app/crm:175,236` (row detail) · `mission-control/signals.ts:21` (health-signal gate — but see §7.3, it must not become silent).

### 3.2 How the three get their answer

Not by a sentinel. They derive it from `phases[]`, which already holds the uncertainty:

```text
all phases terminal (complete | skipped)  → genuinely launched
any phase unknown                         → cannot determine
otherwise                                 → in flight
```

This satisfies the principle exactly: the uncertainty stays in the underlying state, and only the three consumers that need the distinction pay for it. `/production` gains a third bucket; `/crm`'s counts gain a third; the operator brief renders the project with its status stated as unknown rather than omitting it.

**Omission is an assertion.** A project silently dropped from the operator brief reads as "nothing here to know" — H2 §11.3's prohibition on laundering `null` through the UI, applied to the AI context path.

---

## 4. Default-as-assertion — the fix list

All five sites from H3 §2.1, with sequencing.

| # | site | fix | when |
|---|---|---|---|
| 1 | `core/crm/promote.ts:36` — `packageTier ?? "growth"` | require an explicit tier; "unknown" must be expressible | **before migration** |
| 2 | `core/production/state.ts:105` — `status ?? "not_started"` | absent → `unknown` | with the enum change |
| 3 | `core/reconciler/index.ts:151-152` — same default | absent → `unknown`; `unknown → X` emits no business event (H2 §6) | with the enum change |
| 4 | `engines/health-engine:46` — `let schedule = 100` | see §6 | with the engine work |
| 5 | `core/events/index.ts:29` — `actor ?? "operator"` | migration passes `actor` explicitly at every site | migration code discipline |

### 4.1 Why `promote.ts` blocks the migration

Oscar's reasoning, recorded: the migration can clean historical records and a normal application path will manufacture new false ones immediately after. The failure mode is proven, not theoretical —

```text
missing fact → default → stored fact → downstream interpretation
```

**Bay Area Custom Shirts carries `tier: "growth"` for something that was never a client.** No tier was ever recorded; the default created one, and it now sits in `structural_meta.json` and in the observation baseline.

Fixing #1 is not part of the migration and should not be bundled into it. It is a precondition for trusting the migration's output.

### 4.2 Not changing

`core/events:29`'s default is correct for its normal callers — operator-initiated writes genuinely are operator-caused. The defect is only that migration code inherits it silently. Discipline at the call site, not a signature change.

---

## 5. DECISION — `stalled_project` claims what it can prove

The detector's premise and its evidence are different claims, and it currently conflates them:

```text
what it asserts    "The project has been inactive for 14 days."
what it knows      "The OS has recorded no activity for 14 days."
```

Its own rationale already concedes the gap — *"Either work happened off-the-clock (fix the tracking) or the project is stalled."* It hedges in prose and fires **URGENT** anyway.

**This vault makes the gap unarguable.** Of Tapia's 13 time entries, 11 are 1–2 second UI-test artifacts and 2 are seeded (H1). Tracked time is not a usable activity proxy here at all — the detector is reading a channel that has never carried real signal.

### 5.1 Resolution

Do not redefine the detector to make it pass. Three options, and the recommendation:

| option | effect |
|---|---|
| restate the claim | signal becomes "no recorded activity in 14d" — honest, but low value while tracking is unused |
| require corroboration | fire only when an independent channel also shows quiet (no events, no commits) |
| suppress when coverage is unknown | if the client has no reliable tracking history, the detector cannot speak |

**Recommend restating the claim (option 1), and downgrading it from URGENT.** A signal about Ascend's own record-keeping is not an emergency about a client. Option 2 is better but needs an evidence-coverage notion that does not exist yet; note it as future work rather than building it here.

This is independent of `PhaseStatus` and would survive a clean enum fix unnoticed — which is why it is in scope.

---

## 6. DECISION — `schedule` becomes nullable

```text
launch target exists + progress known   → number
launch target exists + progress unknown → null
launch target absent                    → null
```

Per Oscar: **no schedule ≠ on schedule.** The current `let schedule = 100` awards full marks for having no deadline, and it is materially load-bearing — two-thirds of Elite Vac's score of 30 is that credit (H2 §11.2).

Consequence: `score` and `tier` become `null` whenever `schedule` is null, since the weighted sum has a missing term. Health cannot receive fabricated schedule credit, and a project with no target simply has no computable health — which is the truth.

---

## 7. The engine blast-radius contract

The type-level statement of H2 §11, for H4 to build against.

### 7.1 Signatures

```ts
// core/production
Phase.progress            : number | null
ProductionState.overallProgress : number | null
ProductionState.activePhaseIndex: number | null   // §3 — no sentinel

// engines/health-engine
HealthScore.breakdown.progress : number | null
HealthScore.breakdown.momentum : number           // survives — time log is independent
HealthScore.breakdown.schedule : number | null    // §6
HealthScore.score              : number | null
HealthScore.tier               : HealthTier | null
HealthScore.daysToLaunch       : number | null    // already nullable; survives
```

### 7.2 Propagation rules

1. **Null is contagious along dependency, not across independence.** Momentum and `daysToLaunch` survive an unknown history untouched. A paid invoice stays paid; a live site stays live.
2. **A weighted sum with a null term is null.** No renormalising the weights over present terms — that silently redefines the metric, the same defect as option C.
3. **Null must not be coerced or omitted in presentation** (H2 §11.3). `?? 0` restores the lie; `if (x != null)` makes absence read as irrelevance.
4. **Gates that suppress may stay boolean.** The eleven consumers in §3.1 are correct as-is.

### 7.3 The one path needing design

`mission-control/signals.ts:21` filters to `activePhaseIndex !== null`, then `healthToSignals` maps `score`/`tier` into `RankableSignal` for `rank()` and the notification lifecycle.

A null-health signal must not silently vanish — a project whose health is uncomputable is exactly what the operator should be told about. But `rank()` orders by score, and it has no concept of unrankable. The adapters are explicitly forbidden from inventing values (`MAY NOT: assign ranking weights, infer urgency, compute metrics`), so the null cannot be filled there either.

**This needs its own design and H3.1 does not resolve it.** The shape of the answer is likely a separate "needs investigation" channel that bypasses ranking rather than a sentinel score — but that is H4's problem, and `decision-engine.rank()` must remain the only ranker.

### 7.4 Test posture

`tests/engines/health-engine.test.ts` pins the current contract, including `it.skip("scores schedule 100 when overallProgress is 100 despite an overdue target")` — an already-acknowledged gap. Every assertion that a number appears where evidence is absent becomes an assertion that `null` appears. The test suite is the specification of the old semantics; rewriting it *is* the engine work, not a follow-up to it.

---

## 8. Sequence to H4

Confirmed order, with §4.1 inserted as a precondition:

```text
fix promote.ts default        (precondition — stops new false records)
        ↓
engine epistemic semantics    (§6, §7 — nullable scalars)
        ↓
test engines against unknown
        ↓
H4: migration contract
        ↓
dry run → review → apply
        ↓
false signals disappear
```

**Acceptance boundary**, unchanged from H3 §5.4 and now sharper: after unsupported premises are removed, every signal, decision and automation depending *exclusively* on them **disappears** — not softens. A survivor means a rule reads something other than what it claims to.

And the expected outcome is a quieter OS. A quieter queue is not evidence the system is fixed, and it is not evidence about §19 — which measures operator-caused events and is untouched by all of this.

---

## 9. Still open after H3.1

1. **Deletion provenance** — should removed seeded records leave a recorded rationale, and where? Deletion is invisible to the reconciler, which observes state and not absence.
2. **`seed-doc-*` documents** — three records not yet inspected; two carry `status: superseded`, one `accepted`.
3. **Bay Area Custom Shirts** — reconciling a client relationship that never existed. Its own decision, adjacent to §4.1 but not the same fix.
4. **The null-health signal path** (§7.3) — H4.
5. **Evidence-coverage notion** (§5.1 option 2) — future work, deliberately not built now.

No code has been written. `PhaseStatus` remains frozen at four states. `wip/intake` remains quarantined.