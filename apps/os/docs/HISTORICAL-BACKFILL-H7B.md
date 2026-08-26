# Historical Backfill — H7b: Inspection of the Regenerated Migration

**Status: complete. VERDICT — PASS.** Read-only with respect to the live vault: copied to a scratchpad snapshot, the Step 6 migration ran against the copy, and the copy was inspected as hostile evidence. **The live vault is unmigrated and untouched.**

Supersedes [H7](./HISTORICAL-BACKFILL-H7.md), which failed on coverage. The intervening work: the observer fix (`c145d55`), Step 2 authority, Step 3 commercial provenance, Step 4 coverage matrix, Step 5 authority repair (`6d26bcb`), Step 6 regeneration (`2c798d1`).

> **A migration is not successful because the resulting Markdown looks cleaner. It is successful when every behavioural change has an evidence-backed explanation.**

---

## 1. Behavioural comparison — every difference, and why

```text
                        BEFORE                                    AFTER
decoraciones-pilar      launched      100%  70/healthy            indeterminate  null  null/null
elite-vac-service       in_flight      20%  null                  indeterminate  null  null/null
tapia-tile-marble       in_flight      50%  25/at_risk            indeterminate  null  null/null
bay-area-custom-shirts  in_flight       0%  20/at_risk            UNCHANGED — excluded by decision

signals                 8                                         4
priority feed           5                                         4
attention queue         11 open (10 rankable, 1 indeterminate)     8 open (5 rankable, 3 indeterminate)
invoices                8 · $5,790                                2 · $1,448
documents               6                                         1
production buckets      inFlight 3 · launched 1 · indeterminate 0  inFlight 1 · launched 0 · indeterminate 3
CRM                     building 3 · at-risk 2                    building 1 · at-risk 1
finance                 received $0 · outstanding $199 · overdue 1/$199 · pipeline90d $3,982.71   ALL UNCHANGED
care                    all source=none                           UNCHANGED
```

| # | change | evidence |
|---|---|---|
| 1 | Pilar `launched → indeterminate`, `100% → null`, `70/healthy → null` | all five phases were `scaffold-vault.mjs` literals |
| 2 | Elite Vac `20% → null` | four `not_started` phases had no evidence; its evidenced launch survives |
| 3 | Tapia `50% → null`, `25/at_risk → null` | seeded phase history; live+paid does not reconstruct a phase sequence |
| 4 | `launch_crunch:tapia` gone | `overallProgress` null **and** the seeded launch target removed |
| 5 | `stalled_project:tapia`, `:elite-vac` gone | `activePhaseIndex` null — no identifiable active phase to be stalled in |
| 6 | **`launched_checkin:pilar` gone** | the "421d since launch" was computed from a seeded `2025-07-01`, now demoted |
| 7 | priority feed loses rank-1 Tapia (score 90) | it was the `launch_crunch` urgency in #4 |
| 8 | indeterminate health 1 → 3 | Pilar and Tapia joined Elite Vac in being unscoreable |
| 9 | invoices 8 → 2, $5,790 → $1,448 | 6 `seed-inv-*` records removed; **75% of recorded money was fabricated** |
| 10 | documents 6 → 1 | 3 seeded + 2 synthetic removed; only `README.md` remains |
| 11 | production/CRM bucket shifts | consequences of #1–#3 |

**Nothing changed without an entry in the manifest, and no manifest entry lacks named evidence.**

### 1.1 Three things that did NOT change, and should not have

- **`pipeline90d` = $3,982.71 identical.** Derived from prospects × `ASSUMED_DEAL_VALUE`, which the migration deliberately does not touch. Verified still present in source. Forecast semantics remain explicitly unresolved.
- **`outstanding $199`, `overdue 1/$199`, `received $0` identical.** The only unpaid invoice (`56eb0b57`) is non-seed and survived; no invoice was paid in the current month either side. The seeded removals were all *paid* records outside the current month, so no finance total moved — which is the correct arithmetic, not a coincidence worth ignoring.
- **Bay Area Custom Shirts byte-identical**, still `20/at_risk`, still rank 1.

---

## 2. Against the eight inspection priorities

| # | priority | verdict |
|---|---|---|
| 1 | **Coverage** — 87 entries, all consumer-derived | ✅ registry-driven; G9 fails if the planner touches an undeclared source |
| 2 | **Contradiction** — no retired field remains behaviour-bearing | ✅ all four scope keys removed from all three clients; `deliverables` and prose survive |
| 3 | **Commercial truth** | ✅ revenue `null` for all four; no `TIER_PRICES` fallback (F26.3/26.4); only admissible invoice evidence remains |
| 4 | **Epistemic behaviour** | ✅ unknown phases render as `unknown`; unknown health unranked; `/production` launched bucket = **0**; `null` renders `"unknown"` with no `aria-valuenow` vs `"0%"` with one |
| 5 | **Signals** | ✅ four fabricated gone, legitimate survive, `lib/opportunities.ts` untouched |
| 6 | **Provenance** | ✅ operator events 10 → 10; 6 migration events, all `observation.captured`, all `actor: system`; **0 fabricated business events**; 0 post-sync transitions |
| 7 | **Dates** | ✅ Elite Vac `completed: "2022-03-01"` + `completed_precision: month`; no migration timestamp in the manifest; no launch date invented from git or deployment data |
| 8 | **Uncomfortable cases** | ✅ see §3 |

---

## 3. The uncomfortable cases, inspected rather than assumed

**Bay Area Custom Shirts** — untouched, and still produces `stalled_project` plus `health 20/at_risk` at **rank 1 of the priority feed**. The loudest item in the OS remains a client that never existed, precisely because the migration refuses to invent a correction. Unchanged, and still its own increment.

**Checklist state** — checkbox counts identical (20 / 23 / 17). A markdown checkbox cannot say `unknown`; both `[x]` and `[ ]` are false for a seeded project, so neither was written.

**Automation firings** — `automations_fired.jsonl` byte-identical. The operator really did act on `welcome-on-deposit::seed-inv-pilar-01`; that its trigger was fabricated does not un-happen the action.

**Synthetic documents** — removed exactly as the manifest specified, including `f0911bd7` (Pilar agreement v2), which carries a UUID and a plausible 2026 timestamp and reads as genuine. It went because it was created **570 ms** after the Tapia SOW inside a known test session. Id shape would have kept it.

**Retainer provenance** — all four clients `active=false source=none`, derived per read. Nothing was converted into recorded vault state.

### 3.1 One thing the inspection was hostile about

`structural_meta.tier` has treatment `preserve`, which performs **no verification**. A wrong tier would survive the migration untouched. Checked against the H0-confirmed inventory:

```text
decoraciones-pilar   vault=growth   declared=growth   ✓
tapia-tile-marble    vault=growth   declared=growth   ✓
elite-vac-service    vault=(empty)  declared=null     ✓
```

All three agree, so nothing is wrong today — but the agreement is **unverified by the migration**, not enforced by it. Since Step 5 severed tier from revenue, a stale tier now misstates a package rather than a contract, which is why this is recorded as an observation rather than a defect. If tier ever regains commercial consequence, `preserve` must become `verify`.

---

## 4. Verdict

```text
PASS  every planned change was applied      (none skipped)
PASS  operator business events unchanged    (before=10 after=10)
PASS  reconciler reports zero transitions   (none)
PASS  re-planning produces an empty manifest
      deterministic=true · validation=[] · 87 entries · 48 mutated · 39 removed · 6 baselines
```

**H7b PASSES.** Every behavioural difference in §1 has an evidence-backed explanation; every non-difference in §1.1 has one too.

---

## 5. Closing the two pre-live items (2026-08-26)

### 5.1 `56eb0b57` — provenance cannot be established, and the obvious test was misleading

The decisive test looked like this: `core/finance/invoice.ts` emits `invoice.created` on every write, so an invoice with no event was never created through the OS. And indeed **`finance.events.jsonl` does not exist at all.**

That inference is wrong, and it is wrong in exactly the way this project keeps warning about.

```text
earliest event in the entire spine   2026-07-17T21:53:17.905Z
56eb0b57 issued                      2026-06-01     (46 days earlier)
0c3c1b03 paid                        2026-06-20     (27 days earlier)
```

**Both invoices predate the event spine.** So do the missing `documents`, `portal` and `notifications` domain logs — only `crm`, `production` and `intelligence` exist, and every event in them is from 2026-07-17 onward. The absence of a finance event says nothing about the invoice; it says the spine had not started yet.

> **"No event exists for X" is evidence only when X falls inside the spine's observation window.** Outside it, absence of evidence is not evidence of absence — the project's own rule, applied to its own investigation.

Ruling out that test leaves nothing conclusive:

| signal | reading |
|---|---|
| UUID id | **not evidence** — H5 §1.1 established this on two synthetic documents |
| `issued_at: 2026-06-01T00:00:00.000Z` | a date the operator chose, not a creation timestamp |
| `paid_at: null` | **no machine timestamp exists on this record at all** |
| temporal clustering | **inapplicable** — nothing to date |

**Structural limitation, now recorded in the registry:** an invoice carries no creation timestamp. The technique that caught `f0911bd7` and `babed1df` cannot be used on financial records. Only the `seed-` prefix distinguishes fabricated invoices, and a record with neither marker is *unclassifiable*, not *proven genuine*.

**Disposition: retained as an explicitly unclassified record.** Not removed (no evidence it is fabricated), not asserted as genuine (no evidence it is). It continues to produce `outstanding $199` and `overdue 1/$199`, and those figures now carry a named caveat rather than an unexamined assumption.

*(For contrast, `0c3c1b03` is marginally better supported: its `paid_at` of `2026-06-20T13:09:24.106Z` is a real machine timestamp falling outside every known test session. Weak positive evidence, still not proof.)*

**No migration change.**

### 5.2 `structural_meta.tier` — preserved without verification, by decision

Recorded in the registry rather than solved with machinery:

> Tier is preserved **because it no longer derives money**. Step 5 severed the catalog→revenue path, so a stale tier misstates a package rather than a contract, and it falls outside the historical correction this migration performs. Building verification for a field with no commercial consequence would be scope the migration has no reason to carry.

The H0 cross-check (all three agree) stands as a one-time observation, not an ongoing guarantee. **If tier ever regains commercial consequence, `preserve` must become a verifying treatment.**

**No migration change.**

---

## 6. What this does NOT authorize

Applying to the live vault. That is a **separate decision** and a separate gate. The regenerated migration has now survived a snapshot inspection; it has never run against production data.

Still open, unchanged by this inspection:

1. `ASSUMED_DEAL_VALUE` — three options in COMMERCIAL-PROVENANCE §4.4, none chosen.
2. `56eb0b57` ($199 care invoice) — non-seed, UUID, origin unverified; survived the migration on that basis.
3. Bay Area Custom Shirts — needs a vocabulary for records entered in error.
4. `ProjectStatus` — declared, zero consumers.
5. `structural_meta.tier` verification (§3.1).

No code changed. No vault touched.