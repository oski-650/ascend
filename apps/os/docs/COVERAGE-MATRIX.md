# Coverage Matrix — every durable business fact the OS reads

**Status: audit. No code changes, no vault changes.** Step 4 of the H8 §7 sequencing, built after the authority ([SOURCE-AUTHORITY.md](./SOURCE-AUTHORITY.md)) and commercial ([COMMERCIAL-PROVENANCE.md](./COMMERCIAL-PROVENANCE.md)) decisions, because both change what the correct classification *is*.

> **For every durable business fact the OS can read: where does it come from, who observes it, who consumes it, and what happens when its evidence is absent or untrustworthy?**

---

## 0. Method

Built **from consumers outward** and **generated, not remembered** — the fourth-time-recurring failure mode is a list scoped by what the author recalled.

A scanner read all **187 source files as bytes** across `engines/ core/ lib/ mission-control/ app/ graph-view/ packages/ migration/ navigation/ cognition/ relationships/`, extracting: every vault source touched, every business-field access, every `??` default with a non-empty literal, and every exported consumer entry point.

**Binary-safe by construction.** H8 established that `core/reconciler/observation.ts` contains a literal NUL (its fingerprint separator) and is silently skipped by `grep`. The scanner confirms it is the only such file and reads it like any other. A grep-based audit would again have produced a complete-looking result with one file missing.

Discovery is mechanical; classification below is judgement, and the split is deliberate.

---

## 1. The matrix

`OBS` = observed by `core/reconciler` (i.e. changes have provenance).

### 1.1 Production / delivery

| fact | authoritative source | OBS | consumers | absence means | migration |
|---|---|---|---|---|---|
| phase status | `production_state.phases.*.status` | ✅ | core/production, reconciler, SOP, `/tasks`, health, every opportunity rule | **unknown** | seeded → `unknown` |
| phase `started` / `completed` | same block | ❌ | `core/production/state.ts` → project surfaces | unknown | **classify — no precision/provenance today** |
| `launch_target` | `production_state.md` | ❌ | health `schedule`, `daysToLaunch`, `launch_crunch`, `launch-buffer-qa` | unknown | seeded → `""` |
| `industry_template` | `production_state.md` | ❌ | SOP template diff | unknown | classify · `?? "generic"` asserts |
| checklist items | `production_state.md` body | ❌ (content fp only) | SOP compliance, `/tasks`, effort | unknown | classify |

### 1.2 Client identity & lifecycle

| fact | authoritative source | OBS | consumers | absence means | migration |
|---|---|---|---|---|---|
| `client_id` | `structural_meta.json` | — | identity anchor (D1) | fatal — skip | preserve |
| client status | `structural_meta.status` | ✅ | reconciler, `/clients/[slug]`, graph — **and, after Step 2, the lifecycle rules** | unknown | classify |
| tier | `structural_meta.tier` | ✅ | `/clients/[slug]`, graph | unknown | classify |
| name / business | `business_context.md` | ❌ | everywhere | fall back to slug | preserve |
| industry, location, contacts, languages | `business_context.md` | ❌ | AI compilers, opportunity rules | unknown | preserve (unconfirmed) |
| `website` | `business_context.md` | ❌ | care, graph, AI context | unknown | corrected (Elite Vac `.co`) |
| `retainer_active` / `retainer_started` | `business_context.md` | ❌ | **`core/finance/care.ts`** | unknown | **classify — commercial, unexamined until now** |

### 1.3 Commercial

| fact | authoritative source | OBS | consumers | absence means | migration |
|---|---|---|---|---|---|
| package/tier selected | `structural_meta.tier` (Step 2 §4.4) | ✅ | display only, after Step 3 | unknown | classify |
| **contract value** | `project_scope.revenue_usd` (Step 3 §4.2) | ❌ | `getClientRevenue` → EHR, `low_ehr`, `/tasks`, brief | **unknown, never $0** | classify if present — **absent everywhere today** |
| catalog list price | `TIER_PRICES` (source constant) | — | **must have no finance consumer** (Step 3 §4.1) | n/a | reference data, not migrated |
| invoice record | `invoices.jsonl` | ❌ | finance, KPIs, automations, care | **no invoice issued** (exhaustive record) | remove `seed-*` |
| payment (`paid_at`) | `invoices.jsonl` | ❌ | `thisMonthReceived`, overdue | **not paid** (exhaustive) | remove `seed-*` |
| care plan | `business_context` + care invoices | ❌ | `core/finance/care.ts`, maintenance brief | unknown | classify |

### 1.4 Prospect / pipeline

| fact | authoritative source | OBS | consumers | absence means | migration |
|---|---|---|---|---|---|
| prospect status | hit-list frontmatter | ✅ | pipeline, forecast probability, `/sales` | unknown | out of scope (not backfill) |
| `website_quality` | hit-list frontmatter | ❌ | **`computeScore` +30** | unknown | **`?? "none"` asserts — see §3.1** |
| `decision_maker_access` | hit-list | ❌ | `computeScore` +25 | unknown | `?? false` fails safe |
| `project_urgency` | hit-list | ❌ | `computeScore` +25 | unknown | `?? "low"` fails safe |
| `niche_alignment` | hit-list | ❌ | `computeScore` +20 | unknown | `?? false` fails safe |
| deal value | **does not exist** | — | `ASSUMED_DEAL_VALUE` → `pipeline90d` | unknown | **do not migrate the assumption** (Step 3 §4.4) |

### 1.5 Documents & sidecars

| fact | source | OBS | consumers | absence | migration |
|---|---|---|---|---|---|
| doc status / version / `supersedes` | document frontmatter | ✅ | documents engine, dossier, relationships | unknown | remove seeded + synthetic |
| doc `amount_usd` | document frontmatter | ❌ | document brief, `/documents` | unknown | remove with the record |
| time entries | `time_log.jsonl` | ❌ | effort, EHR, momentum, `stalled_project` | **no time recorded** ≠ no work | remove seeded + sub-5s |
| audits | `audits.jsonl` | ❌ | site-quality, maintenance | none run | remove `seed-*` |
| automation firings | `automations_fired.jsonl` | ❌ | automations surface | not fired | classify |
| approvals / portal | sidecar JSONL | ❌ | approvals engine, portal | none | classify |

### 1.6 Derived — never stored, never backfilled

`overallProgress` · `phaseState` · `activePhaseIndex` · `HealthScore` (score/tier/breakdown) · EHR · every opportunity signal · notifications · `pipeline90d` · `ProjectStatus`.

**Rule: a derived value is never a migration target.** It has no provenance of its own; it inherits its inputs'. Backfilling one would manufacture an unfalsifiable fact. `HealthScore` is null when evidence is insufficient; opportunity signals *vanish* when their premise disappears — that is the H7 acceptance criterion, not a defect.

`ProjectStatus` is declared in the domain and **has zero consumers** — the intended derived answer, never computed, while `phaseState` now provides it.

---

## 2. The ten checks

| # | check | verdict |
|---|---|---|
| 1 | every engine input represented | ✅ |
| 2 | every compiler input represented | ✅ — 7 compilers traced |
| 3 | every signal predicate represented | ✅ |
| 4 | every monetary calculation represented | ✅ — §1.3, plus `pipeline90d` |
| 5 | every persisted duplicate has exactly one authority | ⚠️ **decided, not implemented** — Step 2 is a document; the code still reads both |
| 6 | every behaviour-bearing authority is observed | ❌ **today** — `project_scope.status` drives lifecycle rules, observed by nothing. Step 2 fixes it by moving consumers to the observed field |
| 7 | every nullable input has explicit downstream behaviour | ⚠️ mostly — H4 covers the phase/health chain; `retainer_active`, `industry_template`, checklist items are unspecified |
| 8 | no default converts missing evidence into an assertion | ❌ **see §3** |
| 9 | derived values not classified as historical facts | ✅ §1.6 |
| 10 | classification by provenance, not by filename/id/timestamp/appearance | ✅ — and enforced by H5 §1.1's finding that a UUID + plausible timestamp is not evidence |

**Four checks are not clean.** 5 and 6 are the Step 2 implementation backlog. 7 and 8 are new work this matrix surfaced.

---

## 3. Defaults that still assert — the complete list

The generated sweep covers all 187 files. Presentation fallbacks (`?? "neutral"`, `?? "—"`, error strings) are excluded as non-assertive.

### 3.1 Newly found

| site | default | consequence |
|---|---|---|
| `app/api/import/prospects/route.ts:76` | `website_quality ?? "none"` | **`computeScore` awards +30 for "no website / outdated"** — an omitted CSV column becomes evidence the prospect has no site, raising score → tier → `hot_lead_untouched` → forecast weight |
| `app/sales/[prospect]/page.tsx:74`, `app/sales/page.tsx:216`, `lib/automations.ts:286` | `status ?? "lead"` | a prospect with no status is asserted to be a lead, which carries forecast probability `[0.05, 0.2, 0.35, 0.4]` |
| `app/api/prospects/from-url/route.ts:114` | `psi.scores.performance ?? 100` | a missing performance metric reads as perfect; **fails safe** (suppresses a pitch rather than asserting one) |

**The scoring defaults are asymmetric, and only one is wrong.** `decision_maker_access ?? false`, `project_urgency ?? "low"` and `niche_alignment ?? false` all award **zero** points — they fail toward *fewer* claims, which is correct. `website_quality ?? "none"` is the only one that fails toward *more*.

**Latent, not live:** every prospect in the vault carries explicit values, so this has never fired. Same status as the observer default H8 found — real, reachable through the CSV import path, not currently producing bad data.

### 3.2 Known, decided, not yet implemented

| site | status |
|---|---|
| `core/finance/revenue.ts:25` — `package → TIER_PRICES` | Step 3 §4.1 — delete |
| `lib/forecast.ts:15` — `ASSUMED_DEAL_VALUE = 2497` | Step 3 §4.4 — three options, undecided |
| `core/production/project.ts:36` — `?? "generic"` | asserts a template choice nobody made |

### 3.3 Correct as-is

`core/events/index.ts:23` — `?? "operator"` is right for its normal callers (operator-initiated writes genuinely are operator-caused); migration code passes `actor` explicitly, enforced by F25. The three `?? "unknown"` sites in `state.ts` / `reconciler/index.ts` / `observation.ts` are the H4 + H8 repairs. `?? "9999-99-99"` is a sort sentinel that never escapes its comparator.

---

## 4. What this changes about the migration

**H6's `DECLARED_SUBJECTS` must stop being the de facto truth.** §1 is the specification; the manifest becomes an output of it. Concretely, H6 today covers 5 of the ~30 facts above and misses at least:

```text
phase started/completed        no precision or provenance (H3.1 §3.2 specified both)
industry_template              defaulted, unclassified
checklist items                seeded, unclassified
retainer_active / _started     commercial state, unexamined until this audit
project_scope.*                the H7 failure — pending Step 2 implementation
care-plan invoices             seeded, partially covered
automation firings             one fired from a seeded invoice
```

---

## 5. Sequencing

```text
Step 2  authority          DECIDED, unimplemented
Step 3  commercial         DECIDED, unimplemented (except §4.4)
Step 4  coverage matrix    THIS DOCUMENT
Step 5  fix consumer/authority conflicts   ← next; checks 5 + 6
Step 6  regenerate the manifest from §1
Step 7  migrate a fresh snapshot
Step 8  H7-style inspection
        then, separately, consider the live vault
```

**Step 5 must precede Step 6**, and its ordering constraint stands from Step 2 §5: consumers repoint *before* fields are retired, or `?? ""` quietly becomes "not maintenance" — the same failure reintroduced by its own fix.

Bay Area Custom Shirts stays outside the chain entirely. Its problem is an erroneous promotion, not historical uncertainty.

---

## 6. Open

1. **`ASSUMED_DEAL_VALUE`** — three options in Step 3 §4.4, none chosen.
2. **`56eb0b57`** ($199 care invoice) — non-seed, UUID, unverified origin.
3. **`retainer_active` / `retainer_started`** — newly surfaced commercial state; provenance unexamined.
4. **Checklist items and `industry_template`** — seeded, unclassified, no absence semantics.
5. **`ProjectStatus`** — declared, unused; retire or compute.

No code changed. No vault touched. H6 remains WIP at `c1556a8`, unapplied.