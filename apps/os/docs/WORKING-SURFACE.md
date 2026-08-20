# Ascend OS → Working Surface

**Status: investigation. No implementation, no code changes, no telemetry.** This records the analysis and the resulting slice order. Implementation is reviewed separately.

The cognition ladder is parked (N0–N3 complete, capture gated on §19 of [`COGNITION-OBSERVATION.md`](./COGNITION-OBSERVATION.md)). The blocker is adoption: the OS recorded 10 operator events across 32 days, active on 4. So the next phase is not cognition.

> **Make Ascend OS the place where work happens, not the place where work is summarized.**

---

## 0. The objective, stated so it cannot drift

> **Rendering an existing engine is not the objective. Closing an operator loop is.**

This is written down because "we surfaced five engines" is an attractive progress metric and a false one. The measure of a working surface is whether an operator can finish something inside it.

For the first slice, success is **not** "notifications are now visible." It is:

> An operator can **discover** an actionable notification, **act** on it without leaving Ascend OS, and that action becomes a **real event in the spine.**

```text
signal → decision → action → recorded result
```

Any surface that stops before the last arrow has produced a dashboard.

---

## 1. An architectural correction, kept separate from the findings

The two are easy to conflate, so they are labelled.

**The correction.** An earlier claim that *"eight engines are built and rendered nowhere"* was **wrong**, and wrong for an instructive reason. It came from grepping `app/` and `components/` for strings like `site-quality-engine` and finding zero hits — but zero hits is exactly what **F14 requires**. Surfaces reach engines *through* `mission-control`, never by name. The measurement violated the very boundary it was trying to audit.

Corrected, the architecture looks **healthier**, not worse: F14 was doing its job, and the access path was being followed everywhere.

**The finding.** Measured by assembler consumption instead:

| engine | assembler | surfaced? |
|---|---|---|
| health | `assembleHealthOverview` | ✅ `/clients`, `/crm`, `/production` |
| decision | `assemblePriorityFeed` | ✅ `/`, `/signals`, `/clients`, `/crm`, `/production` |
| document | `assembleDocuments` | ✅ `/documents` |
| site-quality | `assembleSiteQuality` | ✅ `/maintenance` |
| pipeline | `assemblePipeline` | ✅ `/sales` |
| **approvals** | `assembleApprovals` | ❌ no consumer |
| **sop** | `assembleCompliance` | ❌ no consumer |
| **effort** | `assembleEffort` | ❌ no consumer |
| **intelligence** | `assembleInsights`, `assembleForecast` | ❌ no consumer |
| **notification** | `assembleNotifications` | ❌ no consumer |

**Five engines genuinely lack a consumer through their assembler.** Not eight.

### The other measured gap: actability

25 surfaces, **2 server actions** (`app/console/actions.ts`, `app/sync-vault.ts`). And these core writers — which already emit events — have no path from `app/` at all:

```text
dismissNotification      viewNotification      snoozeNotification      createClient
```

`createClient` is treated separately in §4.

---

## 2. The five, against the operator's real workflows

Each engine is judged on whether it answers a real question **and** leads to a real action. Ranked by operator value × actionability × implementation cost — not by how interesting the engine is.

### 1 · notification-engine — build first

| | |
|---|---|
| **Workflow** | all three (acquire, build, maintain) |
| **Operator question** | *What requires my attention?* |
| **Assembler** | `assembleNotifications` — exists, exported from `mission-control/index.ts` |
| **Where** | Mission Control attention queue |
| **Action** | dismiss · snooze · open source |
| **Action exists?** | **The writers exist and emit events. They are unreachable from `app/`.** |
| **Work required** | thin server actions over `core/notifications`. No new domain vocabulary, no new event types, no schema change |
| **Replaces** | nothing yet — `/signals` shows ranked signals but nothing dismissible |

This is the cheapest complete loop in the system, and the only place where **read + decision + write + event emission all already exist** and the sole missing piece is the seam between them.

### 2 · sop-engine — build second

| | |
|---|---|
| **Workflow** | build / deliver |
| **Operator question** | *What should happen next on this build?* |
| **Assembler** | `assembleCompliance` — diffs a project against its template |
| **Where** | project surface (`/clients/[slug]/project`, `/production/[client]`) |
| **Action** | execute the missing step |
| **Action exists?** | **Yes** — `api/production/toggle` |
| **Work required** | wiring plus presentation; no new write path |

Directly answers workflow 2's core question, and the action it implies already has a durable write path that emits `project.checklist_toggled`.

### 3 · approvals-engine — surface, but record the gap

| | |
|---|---|
| **Workflow** | client delivery / management |
| **Operator question** | *What needs a decision, and what is overdue?* |
| **Assembler** | `assembleApprovals(now)` → `ApprovalsDigest { overdue, pending, approved, counts }` |
| **Where** | attention queue + client dossier |
| **Action** | chase / resend / cancel |
| **Action exists?** | **Partially.** The *client* signs approvals (`/portal/[token]/approve`). `api/portal/approval-requests` can create one. There is no operator-side chase or resend path |
| **Work required** | display is cheap; **the action model needs domain work** — what event does "chased" emit, and is a nudge a business fact? |

Surface it, and record explicitly that until the chase/resend model is designed, this is informational and therefore an incomplete loop.

#### A distinction this uncovered, worth keeping

`ApprovalsDigest` sorts into `overdue / pending / approved`, but **overdue-ness is derived on read**. `approval.overdue` is declared in the event union as *"clock-detected; emitted by a scheduled reconciler"* — and that scheduler does not exist. The same is true of `invoice.overdue`.

So the attention queue's most time-sensitive category is the one thing the spine never witnesses. That is not a bug. It is a legitimate read-model state, and it exposes four things that must not be collapsed:

```text
FACT             "Approval was created."
EVENT            "Approval was acted upon."
DERIVED STATE    "Approval is currently overdue."
DETECTION EVENT  "The system noticed it became overdue."
```

> **A derived condition can be visible without being an event.**

The consequence, stated plainly: until a reconciler exists, the spine cannot honestly answer *"when did the system notice this became overdue?"* — and inventing an `approval.overdue` emission at read time would be exactly the fabrication the provenance rule forbids, since nothing witnessed a transition.

**This is deliberately not being solved now.** Discovering it is the value; building it immediately would fold an unrelated substrate question into a UI slice. It is recorded here and left alone.

### 4 · intelligence-engine — defer, despite being cheap

`Insight` is deliberately built to carry **no priority score, no recommendation, and no "you should" language** — that is contract-tested. It informs and produces no action.

By §0's rule it fails the actionability test. Its cheapness is a trap: it is exactly the attractive card an operator reads and then leaves to do the work elsewhere. **Do not turn `assembleInsights` into an "interesting things" panel because it is easy.**

Revisit only when an insight can lead somewhere — e.g. investigate → navigate to evidence → act.

### 5 · effort-engine — defer

`EffortDigest { byPhase, byClient, totalSeconds }` answers *where is my time going?* — a weekly-review question, not a right-now operational one. The implied action, "reprioritise", is not a primitive the OS has. Belongs to a review surface, not Mission Control.

---

## 3. What Mission Control should become

Not eight dashboards. **One decision, a small queue, today's work.**

```text
YOUR NEXT MOVE      one action, and why        ← decision-engine, already surfaced
NEEDS ATTENTION     counts + queue             ← notification-engine, slice 1
TODAY               per-area action counts     ← existing assemblers
```

The existing `assemblePriorityFeed` already ranks. `decision-engine.rank()` stays the **only** ranker — cognition must not quietly become the ranking mechanism, and F8/F18 already forbid a second one.

---

## 4. `createClient`, handled separately

`createClient` exists in `core/crm` and is unreachable from `app/`. A client can enter the OS only by prospect promotion, so onboarding an existing client requires leaving.

**Do not route around this to unblock it.** A solution already exists, quarantined on branch `wip/intake` at `fc9feb4`, and it is blocked on a deliberate domain decision: what `PhaseStatus` should mean when historical phase state is unknown. That vocabulary is frozen pending that decision.

Resolve the domain question first, then bring intake in. Inventing a second client-creation path would create a second lifecycle model — the failure this project has avoided everywhere else.

---

## 5. Relationship to §19

**No telemetry is being added. §19 is untouched and its metric is not being optimised toward.**

Every action in the slices above — dismissing a notification, ticking an SOP step, chasing an approval — is already an operator-caused event in the existing spine. So adoption gets measured by **naturally occurring work**, never by instrumentation added to make a number move.

> **Do not build instrumentation to make §19 pass. Build functionality that makes the OS worth using, and let §19 observe whether that happened.**

If the OS becomes genuinely useful, §19 passes on its own. If it does not, §19 reports that honestly — which is the result, not a defect.

---

## 6. Slice 1 — the implementation boundary, fixed in advance

Brutally narrow, so the first working-surface slice cannot grow into a framework:

```text
assembleNotifications()
        ↓
Mission Control attention surface
        ↓
dismiss / snooze / open
        ↓
existing core writers
        ↓
existing event spine
```

Out of scope, explicitly: no new notification intelligence. No new event types **unless an existing writer genuinely cannot represent the action**. No generic "attention framework" abstraction. No instrumentation. No cognition changes. No approvals reconciler (§2).

### The architectural test

The surface **consumes the assembler**. It does not reconstruct notification logic.

```text
                        ┌── app / components
assembleNotifications ──┤
                        └── existing engine + domain
```

Not:

```text
app
 ├── reads notifications
 ├── determines priority
 ├── determines urgency
 └── invents its own filtering
```

The second shape recreates precisely the boundary problem F14 exists to prevent — and it is how the earlier eight-engine miscount happened in the first place, by reasoning about the wrong access path. If the surface needs a judgement the assembler does not provide, the answer is to extend the assembler, never to compute it in the component.

`decision-engine.rank()` remains the only ranker. F8 and F18 already forbid a second one, and an attention queue is exactly where a second one would try to appear.

### Why this is a clean first experiment for §19

Because the actions already emit events, **no observation system is being added** — an existing real workflow is merely being made reachable. Adoption gets measured by work that would have been recorded anyway.

---

## 7. What this document does not authorize

Implementation. Each slice is reviewed before it is built.

No cognition work of any kind: N4 stays untouched, capture stays gated, and the cognition layer remains exported-and-unwired. No new engines. No new event types. No telemetry, click tracking, dwell tracking, or search logging.

The milestone this phase is aiming at is not "smarter Ascend". It is:

> **"I had real work to do, and I opened Ascend OS first."**
