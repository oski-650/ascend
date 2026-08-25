# Historical Backfill — H8: Coverage Audit

**Status: investigation. No code changes, no vault changes, no migration changes.** H8 answers what H6 was supposed to cover, derived from consumers rather than from the author's memory. H6 is banked as WIP at `c1556a8` and remains unapplied.

> **What facts does Ascend actually consume, where do they originate, and what epistemic status does each source currently have?**

The premise, from H7:

> **The migration's coverage model is author-defined, while the OS's truth surface is consumer-defined.**

---

## 1. The audit found a fourth instance of the pattern — in the audit's own tooling

Stated first because it explains why the earlier sweeps were incomplete, and because it is the most transferable finding in this document.

**`core/reconciler/observation.ts` is invisible to `grep`.** Line 69 embeds a literal NUL byte as the fingerprint separator:

```ts
const canonical = Object.keys(state).sort().map((k) => `${k}=${state[k]}`).join("\0");
```

That is a *good* choice — NUL cannot appear in a field value, so the separator is unambiguous. But `file(1)` classifies the source as `data`, and `grep` silently skips binary files unless given `-a`. It emits no warning and no match.

```text
grep -n  "not_started" core/reconciler/observation.ts   →  (nothing)
grep -an "not_started" core/reconciler/observation.ts   →  4 matches, including line 157
```

**Exactly one file in the repository is affected** — verified by scanning every `.ts`/`.tsx`/`.mjs` for NUL bytes.

### 1.1 What this invalidated

H3 §2.1's default-as-assertion audit was grep-based. It reported five sites; there was a sixth it could not see. H4 then fixed the five it found. So the sweep was not careless — **its instrument had a silent blind spot**, which is a worse failure mode than an incomplete list, because the output looked complete.

### 1.2 What it did NOT invalidate

**The project's own fitness rules are unaffected.** `tests/architecture/source-graph.ts` reads with `readFileSync` and regex-tests in Node, so F1–F25 have always seen this file. The blind spot was in ad-hoc auditing, not in the machine-enforced constraints. That distinction matters: the enforcement layer was sound while the investigation layer was not.

---

## 2. The sixth default, and the hole it leaves in H4's guard

`core/reconciler/observation.ts:157`:

```ts
const declared = str(table[phase]?.status);
// An absent phase entry genuinely means not_started — that is the schema's own default and
// core/production reads it the same way. Only a missing BLOCK is untrustworthy.
state[phase] = declared ?? "not_started";
```

**The comment is now false.** After H4, `core/production/state.ts:133` reads an absent phase entry as `unknown`. The observer and the read model disagree about the same bytes.

### 2.1 The consequence: the epistemic guard can be bypassed

H4 §6 protects history by refusing any transition into or out of `unknown`. But that guard tests the *observed* value, and the observer never produces `unknown` for an absent entry:

```text
vault:      phases block present, `dev:` entry absent
core/production   → dev = unknown        → progress null, health null
observation.ts    → dev = "not_started"  → stored in observation.captured

operator later adds `dev: { status: complete }`

reconciler: from = "not_started" (replayed), to = "complete"
            phaseTransitionType("not_started", "complete") → project.phase_completed  ← EMITTED
truth:      unknown → complete, which H4 requires to emit NOTHING
```

So a phase whose history was never known can still manufacture a `project.phase_completed` dated today — the exact failure the epistemic guard exists to prevent.

### 2.2 Severity: latent, not live

Checked against the real vault: **all four projects carry all five phase keys**, so no current record has this shape. Post-migration every entry is explicitly `unknown`, which the guard handles correctly — this is why the STOP 5 tests pass and why H7 did not surface it.

It becomes reachable when a template scaffolds a partial block, or an operator deletes a single phase line in Obsidian. **Latent, real, and not urgent** — but it must be fixed before it is relied on, and it is not what H7 failed on.

### 2.3 A related observation

H4's fix at `core/reconciler/index.ts:167-168` (`?? "unknown"`) is effectively unreachable for projects, because the observer always writes all five keys. The guard that actually does the work is `from === "unknown" || to === "unknown"` inside `phaseTransitionType`. Not a defect — worth knowing so nobody mistakes the `??` for the protection.

---

## 3. Consumer-derived fact inventory

Every field any engine, rule, compiler or surface reads as a business fact, traced to its source. Built by enumerating consumers, then working backward.

### 3.1 `production_state.md` — the phase spine

| field | consumers | provenance today | classified by H6? |
|---|---|---|---|
| `phases.*.status` | `core/production`, reconciler, SOP engine, `/tasks`, health, all opportunity rules | seeded (Pilar, Tapia) · intake (Elite Vac) | ✅ |
| `phases.*.started` / `.completed` | displayed on project surfaces | seeded | ❌ **not classified** |
| `launch_target` | health `schedule`, `daysToLaunch`, `launch_crunch`, `launch-buffer-qa` automation | seeded | ✅ |
| `industry_template` | SOP engine template diff | scaffold default `?? "generic"` | ❌ not classified |
| checklist body | SOP compliance, `/tasks`, effort | seeded | ❌ not classified |

**`phases.*.completed` is a gap with teeth.** Elite Vac's `completed: "2022-03-01"` asserts a day nobody knows. H3.1 §3.2 specified `completed_precision` / `completed_source` for exactly this, and H6 implemented neither.

### 3.2 `project_scope.md` — the duplicate, and the H7 failure

| field | consumers | provenance | classified? |
|---|---|---|---|
| `status` | `engines/opportunity-engine:76` (`launched_no_retainer`, `launched_checkin`), `lib/opportunities:73` | seeded | ❌ |
| `launch_target` | `engines/opportunity-engine:79` → "420d since launch" | seeded | ❌ |
| `package` | **`core/finance/revenue.ts:25` → `TIER_PRICES` → contracted revenue** | seeded | ❌ |
| `revenue_usd` | `core/finance/revenue.ts:18` (override) | absent everywhere | ❌ |
| `phase` | `lib/compileOpportunityBrief:44` (AI context) | seeded | ❌ |
| `deliverables`, `out of scope`, decisions log | AI context compilers | seeded | ❌ |

### 3.3 Other sources

| source | fields consumed | notes |
|---|---|---|
| `structural_meta.json` | `client_id`, `status`, `tier` | **`status` + `tier` are the reconciler's observed client state** — editing them emits `client.status_changed` |
| `business_context.md` | `name`, `industry`, `location`, `contact_*`, `website`, `languages`, `retainer_active` | H6 corrects `website` only |
| `brand_identity.md` | palette, voice, photography | AI context only; seeded for Pilar/Tapia |
| hit-list `*.md` | `status`, scoring inputs, contact | prospect state; observed by reconciler |
| `invoices.jsonl` | amounts, paid/due dates | H6 removes `seed-*` |
| `time_log.jsonl` | durations, phase, client | H6 removes seeded + sub-5s |
| `audits.jsonl` | PSI scores | H6 removes `seed-*` |
| documents `*.md` | `doc_id`, `status`, `version`, `amount_usd` | H6 removes seeded + synthetic |
| `config.json` | `monthly_target_usd` | operator setting, not historical |

---

## 4. The duplication problem — `project_scope.md` vs `production_state.md`

H7 recommended not simply adding this file to the classifier. The audit supports that.

```text
production_state.md          project_scope.md
  phases.*.status              phase          ← same fact, different vocabulary
  launch_target                launch_target  ← same fact, same name, independent values
  (none)                       package        ← only source of contracted revenue
  (none)                       status         ← only source of client lifecycle for opportunity rules
```

### 4.1 Neither file is authoritative, and nothing reconciles them

`phase: design` and `phases.design.status: in_progress` are separate strings written by separate paths. `core/production` reads only the first file; the opportunity engine reads only the second. **No code compares them**, so they can disagree indefinitely — and after the H6 migration on the snapshot, they did.

Before migration they agreed *by coincidence*: the same script wrote both.

### 4.2 The honest options

| option | consequence |
|---|---|
| migrate both | two sources stay, can drift again, needs a reconciliation rule that does not exist |
| `production_state.md` authoritative; `project_scope.md` phase/launch fields **deprecated** | one truth; `package`/`status` still need a home |
| move `status` + `package` to `structural_meta.json` | consolidates lifecycle + commercial facts with identity; but that file is the reconciler's *observed* client state, so edits emit events |

**Recommendation: option 2, with `status` and `package` resolved separately** — and note that `structural_meta.json` already carries a `tier` that duplicates `package`. Three files now assert the client's commercial tier.

**This is a domain decision, not a migration detail.** H8 does not make it.

---

## 5. Revenue provenance — `package` is not a contract

`core/finance/revenue.ts`:

```ts
if (revenue_usd present) return it;
const tier = normalizeTier(fm.package);
if (tier) return TIER_PRICES[tier];   // ← a price list becomes a contract value
return null;
```

Measured on the migrated snapshot: **three of four clients report $2,497 contracted revenue, every one of them from a scaffold literal or the old `promote.ts` default.** Only Elite Vac — the client with no package recorded — is honest.

### 5.1 Four distinct facts the system conflates into one

```text
package selected     what they chose            evidence: agreement / proposal
contract value       what was actually agreed   evidence: signed contract
invoiced amount      what was billed            evidence: invoices.jsonl
amount paid          what actually arrived      evidence: invoices.jsonl paid_at
```

A Growth package has a **list price** of $2,497. The contract may be discounted, customised, staged, or never signed. `TIER_PRICES[tier]` answers "what does this package list at", and the system uses the answer to mean "what is this client worth" — feeding EHR, forecast, and the finance surface.

### 5.2 Note the precedent

This is structurally identical to the intake defect already recorded in the provenance rules — *"a blank contract value fell back to `TIER_PRICES[tier]`, making the OS report revenue nobody ever charged."* That was recognised as a bug in the **intake form**. The same fallback in `core/finance/revenue.ts` was never questioned, because it looks like a sensible default rather than an assertion.

**H8 recommends `getClientRevenue` return `null` when no contract value is recorded**, and that the package→price inference either be deleted or renamed to something that cannot be mistaken for a fact (`listPriceForPackage`). Deciding that is a domain call.

---

## 6. Against the H8 acceptance criteria

| # | criterion | verdict |
|---|---|---|
| 1 | every consumed fact has an identified source | ✅ §3 |
| 2 | every source has an explicit provenance classification | ✅ §3 — including the ones classified as *unclassified* |
| 3 | no consumer silently converts absence into certainty | ❌ **§2** (observer), **§5** (package→revenue), `project.ts:53` (`?? "generic"`) |
| 4 | duplicate representations identified | ✅ §4 — three files assert commercial tier; two assert phase and launch |
| 5 | authority between duplicates determined, or marked unresolved | ⚠️ **marked UNRESOLVED** — recommendation offered, decision not taken |
| 6 | revenue derivation separated from price-list metadata | ❌ **§5 — not separated; recommendation only** |
| 7 | every migration-relevant field has a coverage entry | ✅ §3, including six fields H6 does not cover |
| 8 | H6's manifest regenerable from this inventory | ⚠️ **partially** — §3 is the specification, but §4 and §5 must be decided first, since both change what the correct classification *is* |
| 9 | audit makes no code or vault changes | ✅ |

**H8 completes as an audit, and explicitly does not clear H6 to proceed.** Criteria 5, 6 and 8 depend on two domain decisions H8 deliberately leaves open.

---

## 7. What must be decided before H6 is extended

Ordered by what blocks what.

1. **Authority between `production_state.md` and `project_scope.md`** (§4). Until this is settled, classifying `project_scope.md` could be migrating a file that should not exist. This is the direct cause of the H7 failure and the first thing to resolve.
2. **Whether `package` may produce revenue** (§5). Changes whether `package: growth` is a fact to preserve or an inference to delete.
3. **Where the client's commercial tier lives** — `structural_meta.tier`, `project_scope.package`, or one place (§4.2).
4. **Date precision and provenance on `phases.*.completed`** (§3.1) — specified in H3.1 §3.2, implemented nowhere.

## 8. What can be fixed independently, now

None of these depend on the decisions above:

- **`observation.ts:157`** — absent phase entry must read `unknown`, matching `core/production`, closing §2.1's guard bypass. Correct the false comment with it.
- **A fitness rule against grep-invisible auditing** — or at minimum, record in the fitness suite that `observation.ts` contains a NUL and must be read with `-a`. The enforcement layer already handles it; the next investigator will not know.
- **`core/production/project.ts:53`** — `template ?? "generic"` asserts a template choice nobody made. Same class, low blast radius.

## 9. Bay Area Custom Shirts

Unchanged by this audit and still outside the chain. H7 demonstrated the operational cost — after migration it becomes **rank 1 in the priority feed at weight 85**, the loudest item in the OS, because the migration correctly refused to invent a correction.

It needs a vocabulary for **erroneous historical record** as distinct from a business reversal. That is its own increment and H8 does not design it. Its priority is now higher than when it was deferred.

---

No code was changed. No vault was touched. H6 remains WIP at `c1556a8`, unapplied.