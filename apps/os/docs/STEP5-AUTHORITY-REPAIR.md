# Step 5 — Consumer / Authority Repair Contract

**Status: contract. No code written, no vault writes, no migration changes.** Specifies the repair so it can be reviewed before implementation, per the gate discipline used for H4.

Inputs: [SOURCE-AUTHORITY.md](./SOURCE-AUTHORITY.md) (Step 2), [COMMERCIAL-PROVENANCE.md](./COMMERCIAL-PROVENANCE.md) (Step 3), [COVERAGE-MATRIX.md](./COVERAGE-MATRIX.md) (Step 4).

> **Correct the living OS. Do not retire anything yet.**

Step 5 is independently valuable even if the historical vault is never migrated: it stops the OS manufacturing commercial and lifecycle facts **going forward**.

---

## 1. Scope

**IN:** repoint behaviour to authoritative fields · sever tier→revenue · classify the seven facts Step 4 surfaced · fix two latent default assertions · leave fitness rules behind.

**OUT, explicitly:**

- retiring or deleting any duplicated field — Step 6
- any change to `migration/` — Step 6
- any vault write
- `ASSUMED_DEAL_VALUE` — a forecasting-semantics decision (Step 3 §4.4), still open
- Bay Area Custom Shirts

**The duplicated fields keep their current values throughout.** Making consumers correct while both representations still agree is what makes §7's verification possible: if the fields were retired first, "old field changed → nothing happens" would be untestable.

---

## 2. Repointing

Every site, from the Step 4 scan.

| # | site | today | after |
|---|---|---|---|
| R1 | `engines/opportunity-engine/index.ts:72-79` | `c.scope.frontmatter.status` / `.launch_target` | client `meta.status`; launch target from `production_state` |
| R2 | `lib/opportunities.ts:73-74` | reads `project_scope.md` directly | same authoritative sources |
| R3 | `lib/compileOpportunityBrief.ts:44-45` | `scope.fm.phase` / `.status` / `.package` / `.launch_target` | drop `phase`; `status`→meta; `package`→`meta.tier`; launch→`production_state` |
| R4 | `core/finance/revenue.ts:25-26` | `package` → `TIER_PRICES` | **deleted** — see §3 |

### 2.1 R1/R2 change the shape of two rules

`launched_no_retainer` and `launched_checkin` gate on `status === "maintenance"`. After R1 they read `structural_meta.status`, which the reconciler observes — so a change to the field that drives the signal finally emits `client.status_changed`.

`launched_checkin`'s "Nd since launch" currently reads `project_scope.launch_target`. Repointed to `production_state.launch_target`, it inherits the H4 nullable semantics: **no target ⇒ no age ⇒ the signal cannot fire**, rather than computing an age from a fabricated date.

That is a real behaviour change and it is the point. It must be verified as premise-removal, not suppression: the rule's own predicate is untouched.

### 2.2 Behaviour is currently identical either way

Step 2 §1.5 measured it — all four clients have identical `structural_meta` and `project_scope` values, because one writer populates both. **So R1–R3 are expected to produce zero observable change today**, which is precisely what makes them safe to land before the fields are retired, and what §7 verifies.

---

## 3. Severing tier → revenue

`getClientRevenue` becomes:

```text
revenue_usd recorded  →  that value
otherwise             →  null
```

The `TIER_PRICES[tier]` branch is **deleted**, not conditioned. A catalog price may never answer "what is this client worth" (Step 3 §4.1).

Any accessor that turns a tier into money is named for what it is — `listPriceForPackage` — and **no finance path may call it**.

### 3.1 Consequence, already null-safe

`computeEhr` returns null for null revenue (`lib/ehr.ts:13`) and `low_ehr` skips null EHR (`lib/opportunities.ts:172`). So severing removes an urgent-severity signal without touching the rule — the H4 shape again.

Surfaces must render *unknown*, never `$0` and never an omitted clause: `/tasks`, `app/api/time/summary`, `compileOperatorBrief`, `core/finance/commands.ts:50`.

### 3.2 Ordering

**Sever before `package` is ever removed.** Reverse order leaves a window where deleting `package` silently zeroes revenue instead of unknowing it.

---

## 4. Classifying the seven facts Step 4 surfaced

Not added to the migration merely because a scanner found them. Each is classified as **durable state**, **derived**, or **historical evidence**, with an observer.

| fact | classification | observer | decision |
|---|---|---|---|
| `retainer_active` | **durable state with an evidence override** — see §4.1 | none today | **make observable**; the override stays but must be visible |
| `retainer_started` | **derived when back-filled**, durable when written | none | must not be presented as a recorded fact when inferred |
| `industry_template` | durable state (a choice) | none | `?? "generic"` asserts a choice nobody made → `unknown`; SOP already handles `hasTemplate: false` |
| checklist items | **historical evidence** of work done | content-fingerprint only | classify in migration; seeded for Pilar/Tapia |
| phase `started` / `completed` | historical evidence | none | **needs precision + provenance** (H3.1 §3.2, still unimplemented) |
| care-plan invoice state | historical evidence | none (invoices are Ascend-authored) | covered by invoice classification |
| automation firing state | historical evidence of an operator action | none | classify; one firing came from a seeded invoice |

### 4.1 `retainer_active` deserves its own note

`core/finance/care.ts:41-48` overrides the stored flag: a paid care invoice within 60 days sets `retainer_active = true` and back-fills `retainer_started` from the invoice's `paid_at`.

The override is **epistemically sound** — an invoice is evidence, and stronger evidence than a stale flag. Two problems, neither fatal:

1. **The inferred value is indistinguishable from the recorded one.** A consumer cannot tell "the operator declared a retainer" from "we inferred one from a payment." `retainer_started` in particular is presented as a date the operator recorded.
2. **The 60-day window is an unstated rule.** It is a domain judgement living in a `core/` read function.

**Decision:** the override stays; the result must carry which path produced it. Minimum: `retainer_active_source: "declared" | "inferred"`. This is a read-model field, not new vault state.

Not urgent: today Pilar's most recent *paid* care invoice is ~106 days old, so the override does not fire, and the paid ones are seeded anyway.

---

## 5. The two latent default assertions

The principle Step 4 extracted, restated because it decides which defaults survive:

> **A default is not inherently bad. A default is bad when the fallback creates a stronger business claim than the missing evidence supports.**

| site | change |
|---|---|
| `app/api/import/prospects/route.ts:76` — `website_quality ?? "none"` | **fix.** `"none"` is worth **+30** in `computeScore`. Absence must not award points; import an unstated quality as unstated |
| `app/sales/[prospect]/page.tsx:74`, `app/sales/page.tsx:216`, `lib/automations.ts:286` — `status ?? "lead"` | **fix.** "lead" carries a forecast probability row. An unstated status must not enter the weighted pipeline |
| `decision_maker_access ?? false`, `project_urgency ?? "low"`, `niche_alignment ?? false` | **keep, and document.** All award **zero** points — they fail toward fewer claims, which is correct. Their semantics are now explicitly accepted rather than accidental |
| `psi.scores.performance ?? 100` | **keep.** Fails safe (suppresses a pitch); note it |

**Both fixes are latent** — every prospect in the vault carries explicit values, so neither has produced bad data. They are reachable through the CSV import path.

`ProspectStatus` may need an `unknown` member for the second fix, which is a domain vocabulary change and therefore needs the same deliberate treatment `PhaseStatus` got. **If it does, that is a separate decision and this contract does not take it** — the alternative is for the import to omit the field and for consumers to treat absence as unknown.

---

## 6. Enforcement to leave behind

Tests prove today's behaviour; fitness rules prevent tomorrow's regression. **F26**, in the style of F24/F25:

| rule | assertion |
|---|---|
| F26.1 | `project_scope.status` has **zero behaviour consumers** — only AI-context compilers may read it |
| F26.2 | `project_scope.package` has **zero revenue consumers** |
| F26.3 | `TIER_PRICES` is not imported by `core/finance` or any module that produces a revenue figure |
| F26.4 | `getClientRevenue` has exactly one definition site and no catalog fallback |
| F26.5 | the fields the reconciler observes (`structural_meta.status/tier`, `phases.*.status`, prospect/document status) are the ones behaviour-bearing rules read |

F26.5 is the load-bearing one: it encodes **authority follows observability** (Step 2 §3) as a machine check rather than a document, which is what stops the next contributor — human or model — reintroducing the old path.

---

## 7. Verification protocol

Per the boundary: prove the consumers are correct **while both representations still exist**.

```text
For each repointed fact:

  1  change the OLD field only    →  no behavioural change, no event
  2  change the NEW field only    →  expected behaviour change AND the expected event
  3  both agree (today's state)   →  behaviour identical to before the repair
```

Test 3 is the regression control, and it is the one that would catch a repair that silently changed behaviour while the fields agreed — the failure mode most likely to reach production unnoticed.

Test 1 is what proves the retirement in Step 6 is safe: a field with no behavioural effect can be removed without a behavioural migration.

---

## 8. Acceptance criteria

1. `getClientRevenue` returns `null` for every client in the live vault (measured read-only) — today three return $2,497.
2. `low_ehr` stops firing because EHR is null, **with `lib/opportunities.ts`'s predicate unchanged**.
3. Lifecycle signals read observed fields; editing `structural_meta.status` emits `client.status_changed`.
4. Editing `project_scope.status` or `.package` changes **no** behaviour and emits **no** event.
5. No surface renders a null revenue or EHR as `$0` or omits it (H2 §11.3).
6. The two latent defaults no longer award points or probability from absence.
7. F26 passes; removing any repointed line fails it.
8. Full suite green; **no migration file changed; no vault write.**
9. `§7` tests 1–3 all present, including the regression control.

---

## 9. Explicitly not in Step 5

- retiring the duplicated fields (Step 6)
- regenerating the manifest (Step 6)
- `ASSUMED_DEAL_VALUE` (Step 3 §4.4, open)
- `56eb0b57` classification
- `ProjectStatus` — declared, zero consumers, retire-or-compute
- Bay Area Custom Shirts

---

## 10. Sequence

```text
Step 5  correct the living OS                    ← this contract
Step 6  rebuild classification from the corrected OS, retire the duplicates
Step 7  migrate a fresh snapshot
Step 8  H7-style inspection
Step 9  only then consider the live vault
```

No code changed. No vault touched. H6 remains WIP at `c1556a8`, unapplied.