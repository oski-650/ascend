# Source Authority — which representation owns which fact

**Status: decision document. No code changes, no vault changes.** Written before implementation, per the H8 §7 sequencing. Arises from the H7 failure but outlives the backfill: this is a standing domain decision about the vault's shape.

Prerequisite: [H8](./HISTORICAL-BACKFILL-H8.md) established that several business facts are asserted by more than one file, with nothing reconciling them.

> **For each duplicated field, which representation is authoritative, and what is the other allowed to mean?**

The question is per **field**, not per file. "Which file is better" is unanswerable and would smuggle in a decision about facts nobody examined.

---

## 1. The evidence

Every consumer of every duplicated field, traced with `grep -a` (H8 §1 — this file set contains one grep-invisible source).

### 1.1 Phase

| representation | consumers |
|---|---|
| **`production_state.phases.*.status`** | `core/production/state.ts` · `core/reconciler/observation.ts` (observed) · SOP engine · `/tasks` · health · every opportunity rule · migration |
| `project_scope.phase` | `lib/compileOpportunityBrief.ts:44` — **AI context only** |

### 1.2 Launch date

| representation | consumers |
|---|---|
| **`production_state.launch_target`** | `core/production/state.ts:163` → health `schedule` + `daysToLaunch` · `launch_crunch` · `launch-buffer-qa` automation |
| `project_scope.launch_target` | `engines/opportunity-engine:79` → `launched_checkin` ("Nd since launch") · `lib/opportunities.ts:74` · `compileOpportunityBrief:45` |

### 1.3 Client lifecycle status

| representation | consumers |
|---|---|
| `structural_meta.status` | `core/reconciler/observation.ts:112` (**observed → `client.status_changed`**) · `/clients/[slug]:57` badge · `graph-view/projection:257` |
| `project_scope.status` | `engines/opportunity-engine:76` → **`launched_no_retainer` + `launched_checkin`** · `lib/opportunities.ts:73` · `compileOpportunityBrief:44` |

### 1.4 Commercial tier

| representation | consumers |
|---|---|
| `structural_meta.tier` | `core/reconciler/observation.ts:117` (**observed**) · `/clients/[slug]:58` badge · `graph-view/projection:258` |
| `project_scope.package` | **`core/finance/revenue.ts:25` → `TIER_PRICES` → contracted revenue** · `compileOpportunityBrief:45` |

### 1.5 Two facts about the current data

**The duplicates agree today, and not because anything reconciles them.** Across all four clients:

```text
                        structural_meta        project_scope
decoraciones-pilar      maintenance / growth   maintenance / growth
tapia-tile-marble       active / growth        active / growth
elite-vac-service       maintenance / (none)   maintenance / (none)
bay-area-custom-shirts  active / growth        active / growth
```

Identical values, same vocabulary. They agree because **one writer populates both** — `core/crm/promote.ts` writes `package: packageTier` into scope and `tier: packageTier` into meta, and the scaffold script did the same. Agreement is a side effect of a shared author, not a guarantee. The moment anything writes one and not the other, they diverge silently — which is exactly what the H6 migration did to phase state.

**`ProjectStatus` has zero consumers.** `packages/domain/enums.ts:19` declares `"planning" | "in_progress" | "launched" | "on_hold" | "archived"` with the comment *"Derived from phase states — never stored."* Nothing computes it. The type designed to be the derived answer is unused, while two stored fields duplicate the concept by hand.

---

## 2. The finding that decides it

> **In both duplicated pairs, the field the OS *witnesses* is not the field the OS *acts on*.**

```text
structural_meta.status   OBSERVED by the reconciler   → drives no behaviour
project_scope.status     drives every lifecycle signal → observed by nothing

structural_meta.tier     OBSERVED by the reconciler   → drives no money
project_scope.package    sole source of revenue        → observed by nothing
```

Editing `project_scope.status` in Obsidian changes what the OS tells the operator to do and **emits no event**. Editing `structural_meta.status` emits `client.status_changed` and changes nothing the operator sees.

That is a direct violation of the provenance rule already committed in F21:

> Every durable state transition must have an observable provenance.

The behaviour-bearing fields have no provenance at all. This is not a tie to be broken on taste.

---

## 3. The principle

> **Authority follows observability. The authoritative representation of a fact must be the one the reconciler observes; if a fact drives behaviour, it must be observed.**

Derived from F21 rather than invented for this decision. It gives a single test for every future duplicate, and it means "which file wins" is answered by the provenance rule instead of by preference.

---

## 4. Decisions

### 4.1 Phase — `production_state.phases.*.status` is authoritative

`project_scope.phase` is **retired**. One consumer (AI context), and it is the field that produced the post-migration contradiction: `phases.* = unknown` beside `phase: design`.

Non-authoritative role: **none.** It is removed rather than demoted — a phase name in a scope document reads as an assertion no matter what a comment says.

### 4.2 Launch date — `production_state.launch_target` is authoritative

`project_scope.launch_target` is **retired**; its three consumers repoint. Note this is the field behind `launched_checkin: "420d since launch"`, computed from a seeded value H6 never touched.

Non-authoritative role: **none.**

### 4.3 Client lifecycle status — `structural_meta.status` is authoritative

Because it is the observed one (§3), and because `structural_meta.json` is already the identity anchor (D1).

`project_scope.status` is **retired**; `engines/opportunity-engine`, `lib/opportunities` and `compileOpportunityBrief` repoint to the client's meta. This makes `launched_no_retainer` and `launched_checkin` fire from a field whose changes are witnessed.

Non-authoritative role: **none.**

### 4.4 Commercial tier — authority assigned, valuation deferred

`structural_meta.tier` is the authoritative record of **which package the client is on**, for the same reason as §4.3.

`project_scope.package` is **retired as a tier record**.

> **Whether a tier may produce a contract value is NOT decided here.** That is Step 3. §4.4 settles only *where the tier lives*, deliberately leaving the `TIER_PRICES` question untouched so the two decisions do not contaminate each other.

### 4.5 What `project_scope.md` becomes

Scope and context only, and nothing that any engine reads as state:

```text
KEEPS     deliverables · out-of-scope · scope summary · decisions log
RETIRES   phase · launch_target · status · package
KEEPS     revenue_usd   (an explicitly recorded contract value — see Step 3)
```

`revenue_usd` is retained deliberately: it is the one commercial field that records an *agreed amount* rather than a catalog lookup, and Step 3 is likely to make it the only legitimate source. Retiring it now would prejudge that decision.

---

## 5. Implementation consequences

Recorded so the work is visible before it is authorized. **None of this is implemented.**

| # | change | risk |
|---|---|---|
| 1 | `engines/opportunity-engine:72-79` reads client meta rather than scope frontmatter | rule behaviour identical while the values agree — which they do today (§1.5) |
| 2 | `lib/opportunities.ts:73-74` likewise | as above |
| 3 | `lib/compileOpportunityBrief:44-45` drops `phase`, repoints `status` | AI context only |
| 4 | `core/finance/revenue.ts:25` reads `structural_meta.tier` — **or stops inferring entirely** | **blocked on Step 3** |
| 5 | migration retires the four fields from `project_scope.md` | needs the coverage matrix (H8 §7 step 4) |
| 6 | fitness rule: retired fields have no consumers | prevents silent reintroduction |

**Ordering constraint:** consumers repoint *before* the migration retires the fields. Retiring first would leave rules reading absent values, and `?? ""` would quietly become "not maintenance" — the same default-as-assertion failure, introduced by the fix for it.

---

## 6. The invariant this adds to the migration acceptance suite

Per H8's demonstration that duplicate state can contradict *after* migration:

> **No migrated client may have two authoritative-looking sources asserting conflicting business facts.**

Not "no duplicate files" — duplication can be legitimate (a cache, a projection, an index). The requirement is **no unresolved contradictory authority**. A duplicate is acceptable when one side is declared authoritative and the other is mechanically derived from it or read by nothing.

This is checkable: for each fact in the coverage matrix, assert that either one source exists, or one source is authoritative and the others have zero state-consumers.

---

## 7. What this does not decide

1. **Whether a package/tier may produce a contract value** — Step 3, deliberately isolated.
2. **Where `revenue_usd` should live** — depends on Step 3.
3. **Whether `ProjectStatus` should finally be computed** (§1.5) — it is declared, unused, and would be the honest derived answer for "launched vs in flight", which `phaseState` currently provides. Worth resolving, not urgent.
4. **Bay Area Custom Shirts** — unaffected; still needs a vocabulary for records entered in error.

---

## 8. Status

```text
authority        DECIDED (this document)
revenue model    UNRESOLVED — Step 3
coverage matrix  blocked on Step 3
H6 migration     WIP c1556a8, unapplied
live vault       untouched
```

No code changed. No vault touched.