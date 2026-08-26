# Historical Backfill — CLOSED

**Applied to the live vault 2026-08-26. Accepted. This work is finished.**

The one fact this file exists to record, because nothing else in the repository does: **the migration ran against production data, and here is where the backup is.**

```text
backup   ~/ascend-vault-backups/ascend-vault-pre-migration-20260826-015737.tar.gz
         outside iCloud · 80 entries · restore-verified byte-identical to live BEFORE the run
manifest 87 entries · validation clean · identical in composition to the snapshot-proven run
result   mutated=48 · removed=39 · baselines=6 · skipped=0
```

Retain the backup per normal retention policy after visual inspection of the vault and OS.

---

## Verification at time of application

```text
PASS  every planned change was applied      (none skipped)
PASS  operator business events unchanged    (10 → 10)
PASS  reconciler reports zero transitions   (none)
PASS  re-planning produces an empty manifest
POST  sync transitions: 0
```

### Behavioural ledger, pre → post

| | before | after |
|---|---|---|
| Decoraciones Pilar | launched · 100% · 70/healthy | indeterminate · null · null |
| Elite Vac Service | in_flight · 20% · null | indeterminate · null · null |
| Tapia Tile & Marble | in_flight · 50% · 25/at_risk | indeterminate · null · null |
| Bay Area Custom Shirts | in_flight · 0% · 20/at_risk | **byte-identical** |
| signals | 8 | 4 |
| priority feed | 5 (rank1 tapia @90) | 4 (rank1 bay-area @85) |
| attention queue | 11 open · 1 indeterminate | 8 open · 3 indeterminate |
| invoices | 8 · $5,790 | 2 · $1,448 |
| documents | 6 | 1 |
| production buckets | inFlight 3 · launched 1 · indeterminate 0 | inFlight 1 · launched 0 · indeterminate 3 |
| received / outstanding / overdue / pipeline90d | $0 / $199 / 1·$199 / $3,982.71 | **unchanged** |

Every difference traces to a manifest entry with named evidence. Every non-difference has a reason: the surviving unpaid invoice is non-seed, and `ASSUMED_DEAL_VALUE` was deliberately untouched.

### Invariants verified against the backup archive, not asserted

- Bay Area Custom Shirts: `diff -rq` vs the pre-migration archive — identical.
- Checklist state: 20 / 23 / 17 checkboxes, unchanged. A checkbox cannot say `unknown`.
- `automations_fired.jsonl`: identical. The operator did act, even on a fabricated trigger.
- `lib/opportunities.ts`: zero changed lines. Four signals stopped because their premises are gone.
- Elite Vac: `completed: "2022-03-01"` with `completed_precision: month` — a day nobody knows was not invented.

---

## The result

> **The vault no longer tells a more certain story than the evidence supports.**

The OS is less confident because its evidence is weaker, rather than tidier because replacements were invented. That was the objective of the whole chain, and it is why 75% of the recorded financial history and every phase date in the vault turned out to be scaffold output.

---

## Chain of record

| gate | outcome |
|---|---|
| H0 project universe · H1 evidence inventory | scaffold authorship discovered |
| H2 vocabulary → `PhaseStatus.unknown` | `6649528` interpreter repaired |
| H3 / H3.1 blast radius | corrections, crash-safety proven |
| H6 migration machinery | `c1556a8` WIP |
| **H7 inspection** | **❌ FAILED — `project_scope.md` coverage gap** |
| observer fix | `c145d55` |
| Step 2 authority · Step 3 commercial · Step 4 coverage matrix | decisions recorded |
| Step 5 authority repair | `6d26bcb` |
| Step 6 regeneration from the coverage model | `2c798d1` |
| H7b hostile snapshot inspection | `fad161c` ✅ |
| pre-live items closed | `0a05c5c` |
| **live apply** | **✅ 2026-08-26** |

H7's failure is the most valuable entry in that table: it caught a migration that passed every test it had while covering a sixth of the surface.

---

## Deliberately NOT reopened

Five items remain, each its own increment. **None is a reason to touch the migration again**, and the fact that they can now be worked on independently is the clearest sign this closed properly.

1. **`ASSUMED_DEAL_VALUE`** — forecasting semantics; three options in `COMMERCIAL-PROVENANCE.md` §4.4, none chosen.
2. **`56eb0b57`** — invoice provenance explicitly unclassifiable; invoices carry no creation timestamp, so temporal clustering cannot be applied.
3. **Bay Area Custom Shirts** — needs a vocabulary for *records entered in error*, which is not historical uncertainty. Currently rank 1 in the priority feed: a real operational problem, and the loudest thing in the OS.
4. **`ProjectStatus`** — declared in the domain, zero consumers; retire or derive.
5. **Tier verification** — `preserve` becomes a verifying treatment only if tier regains commercial consequence.