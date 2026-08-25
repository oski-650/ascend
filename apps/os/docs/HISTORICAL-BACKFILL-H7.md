# Historical Backfill — H7: Post-Migration Truthfulness Inspection

**Status: complete. VERDICT — FAIL.** Read-only with respect to the live vault: it was copied to a scratchpad snapshot, the H6 migration ran against the copy, and the copy was inspected. **The live vault is unmigrated and untouched.**

> **After migration, does Ascend OS tell the truth about the historical record — including what it cannot know?**

**No — not yet.** Nine of ten inspection areas pass. One does not, and it is not cosmetic: the OS still asserts $2,497 of contracted revenue for two clients from a scaffold literal, and still contradicts itself about what phase they are in.

Per the H7 protocol this document **does not fix anything it found**. The migration code is unchanged since the H6 record.

---

## 1. What passed

### 1.1 The three migrated clients

```text
                        BEFORE                                 AFTER
decoraciones-pilar      launched   overall=100  70/healthy     indeterminate  null  null
tapia-tile-marble       in_flight  overall=50   25/at_risk     indeterminate  null  null
elite-vac-service       in_flight  overall=20   null           indeterminate  null  null
bay-area-custom-shirts  in_flight  overall=0    20/at_risk     UNCHANGED (excluded)
```

Elite Vac's evidenced launch survived (`launch=complete`) while its four unevidenced phases became `unknown` — the migration distinguished evidence from silence within a single record.

**Decoraciones Pilar going from `100 / healthy` to `indeterminate / unscored` is the most important line in this table.** The inspection was willing to destroy a *good-looking* result because its evidence was fabricated. A migration that only removed bad news would be cosmetic.

### 1.2 False attention removed by premise, not suppression

```text
SIGNALS  8 → 5

REMOVED   urgent  launch_crunch     tapia-tile-marble
          suggest stalled_project   tapia-tile-marble
          suggest stalled_project   elite-vac-service

SURVIVED  suggest hot_lead_untouched     valley-roofing-pros
          suggest launched_no_retainer   decoraciones-pilar, elite-vac-service
          suggest launched_checkin       decoraciones-pilar
          suggest stalled_project        bay-area-custom-shirts-inc  (known-false, §4)
```

`lib/opportunities.ts` is **byte-identical**. `launch_crunch` stopped because `overallProgress` is null and the seeded target is gone; `stalled_project` stopped because `activePhaseIndex` is null. The premises disappeared. Three of the survivors are re-examined in §3 — two of them should not have survived.

### 1.3 Event spine — clean

```text
operator business events                 before=10  after=10
migration-emitted events                 4 · all observation.captured · all actor=system
business events attributed to migration  0
post-migration reconciler transitions    0
re-plan                                  empty manifest
```

§19 is untouched. No historical date became today's event.

### 1.4 Surfaces — the H4 semantics hold under real data

```text
/production buckets      in-flight=1  launched=0  indeterminate=3
    launched section     (none)                    ← nothing unknown is called launched
assembleFiringSignals    rankable=6  indeterminate=3
    rankable health signals missing a tier: false  ← no null reaches rank()
assemblePriorityFeed     4 items, health-evidenced=1
    no indeterminate client appears                ← not ranked at weight 15
attention queue          9 open, including three explicit
    "health cannot be determined — phase history unknown"
health overview order    bay-area=20 → pilar=null → elite-vac=null → tapia=null   (null last)
```

Indeterminate health is **visible and actionable but unranked** — exactly the design. It is neither dropped nor laundered into a low-priority ranked signal.

### 1.5 Rendered output — unknown does not look like zero

```text
ProgressRail(null)   text="unknown"   aria-valuenow present=false
ProgressRail(0)      text="0%"        aria-valuenow present=true
HealthBadge(null)    text="?UNKNOWN"
null and zero render differently:  true
```

Verified by rendering the components to markup, not by reading the source.

---

## 2. THE FAILURE — `project_scope.md` is a second, unclassified source of the same facts

`production_state.md` is not the only place the vault records a project's phase, launch date, tier and status. `project_scope.md` records them **again**, and the H6 classifier never looked at it.

Post-migration, on real data:

```yaml
# decoraciones-pilar/project_scope.md — UNTOUCHED, entirely scaffold-authored
phase: launched              # production_state.md now says every phase is `unknown`
package: growth              # → getClientRevenue → $2,497
launch_target: "2025-07"     # → "420d since launch"
status: maintenance          # → launched_no_retainer, launched_checkin

# tapia-tile-marble/project_scope.md — UNTOUCHED
phase: design                # production_state.md now says every phase is `unknown`
package: growth              # → $2,497
launch_target: "2026-08-15"
status: active
```

### 2.1 Three concrete consequences

**a · Fabricated revenue is still asserted.** `core/finance/revenue.ts:26` resolves `package → TIER_PRICES`. Measured on the migrated snapshot:

```text
decoraciones-pilar   contracted revenue = 2497
tapia-tile-marble    contracted revenue = 2497
bay-area-custom…     contracted revenue = 2497
elite-vac-service    contracted revenue = null     ← the only honest one
```

Every one of those numbers traces to a scaffold literal or to the `promote.ts` default. This is the exact defect H1 identified in the *intake* tier select — "a blank contract value fell back to `TIER_PRICES[tier]`, making the OS report revenue nobody ever charged" — surviving the migration untouched.

**b · Fabricated attention survived.** `lib/opportunities.ts:70-74` reads `status` and `launch_target` from this file. So `launched_checkin: "Check in with Decoraciones Pilar (420d since launch)"` is computed from the seeded `2025-07`. It passes the §7.1 test only by accident: no rule was edited, but its premise did not disappear either. Likewise `launched_no_retainer` fires off a seeded `status: maintenance`.

**c · The vault now contradicts itself.** Tapia's `production_state.md` says every phase is `unknown`; its `project_scope.md` says `phase: design`. Before the migration the two agreed — both wrong. Now they disagree, and nothing detects it.

### 2.2 The invariant that was violated

H5 §1: **seeded → unknown**. It was applied to `production_state.md`, documents and sidecars, and never applied to `project_scope.md` at all, because the classifier enumerated *files it knew about* rather than *facts the vault asserts*.

The acceptance question — *can I point to the evidence that caused this number to exist?* — is answered "scripts/scaffold-vault.mjs" for four fields per client that no manifest entry mentions.

### 2.3 Root cause, stated so the fix is not just "add a file"

The classifier's coverage was derived from the migration's *narrative* (phases, documents, sidecars) rather than from an enumeration of **every field any engine reads as a business fact**. `project_scope.md` was invisible to it for the same structural reason a new top-level directory is invisible to the fitness rules: nothing named it.

This is the third appearance of one pattern in this project — the eight-engine miscount, the inline-map YAML skip, and now this. **A check scoped by what the author remembered rather than by what the system actually reads.** The correct fix is coverage derived from consumers, not another remembered file.

---

## 3. Signals whose survival is now suspect

| signal | premise | verdict |
|---|---|---|
| `launched_checkin: pilar` | seeded `launch_target: 2025-07` | **false — should not survive** |
| `launched_no_retainer: pilar` | seeded `status: maintenance` | **false — should not survive** |
| `launched_no_retainer: elite-vac` | `status: maintenance`, intake-written | plausible — Elite Vac is genuinely launched |
| `hot_lead_untouched: valley-roofing` | prospect record, never seeded | legitimate |
| `stalled_project: bay-area` | excluded client | known-false, §4 |

So of five surviving signals, **two are fabricated and one is known-false.** Two are legitimate.

---

## 4. The declared exclusion is working as specified

```text
bay-area-custom-shirts-inc   touched by manifest: false
                             files byte-identical: yes
                             still produces: suggest:stalled_project
                             still asserts:  $2,497 contracted revenue, health 20/at_risk
```

Recorded, not fixed:

> **Known false state, intentionally excluded from H6** because correcting the erroneous promotion requires a domain operation the current vocabulary does not represent. *"A business record exists because a promotion was erroneous"* is not historical backfill.

Worth noting for its own increment: after migration it becomes **rank 1 in the priority feed at weight 85** — the loudest thing in the OS is a client that never existed. That is a consequence of the exclusion, not a defect in it, and it argues for scheduling that increment sooner rather than later.

---

## 5. Verdict and what must not happen next

**H7 FAILS on §2.**

Per the protocol:

- **Do not patch around the failure.**
- **Do not modify the migration to make the inspection pass.**
- **Do not apply the migration to the live vault.**

The first violated invariant is **§2.2: `seeded → unknown` was not applied to `project_scope.md`.** That is where investigation resumes.

What the failure does *not* impugn: the migration machinery itself. Determinism, idempotence, crash safety, baselining, §19 isolation and the surface semantics all held on real data. The defect is **coverage**, not mechanism — the migration correctly did a job that was incompletely specified.

### Recommended next step

An **H8 coverage investigation** before any further implementation: enumerate every field any engine, compiler or rule reads as a business fact, and check each against a classification. Derived from consumers, not from memory — §2.3 is the reason a remembered list will miss something a third time.

Two questions H8 should also answer, both surfaced by this inspection:

1. **Should `project_scope.md` continue to duplicate phase/launch/tier state at all?** Two sources for one fact is what allowed them to disagree. Consolidation may be the honest fix rather than migrating both.
2. **Does `getClientRevenue`'s `package → TIER_PRICES` fallback belong at all?** A tier is a price list, not a contract value. The `revenue_usd` override exists precisely because they differ.

---

## 6. Reproducing this inspection

The harness was temporary and has been removed. It copied the live vault to a scratchpad snapshot, ran `planMigration` / `applyMigration` / `verifyMigration` against the copy, then captured: production states and phase statuses, health scores and subscores, `detectOpportunities`, the event spine, `assembleFiringSignals` / `assemblePriorityFeed` / `assembleNotifications` / `assembleHealthOverview`, `getClientRevenue`, and `renderToStaticMarkup` of `ProgressRail` and `HealthBadge`.

**The live vault was never opened for writing.** `git status` shows no vault paths, and the vault is outside the repository in any case.