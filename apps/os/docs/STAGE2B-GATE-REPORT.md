# Stage 2B — Prospect Migration · Gate Report

**Status: built, verified against real Postgres, and NOT applied to any production database. Live vault untouched. No production reader flipped.**

Authorised by the Stage 2B gate. Prerequisite: [STAGE2A-GATE-REPORT.md](./STAGE2A-GATE-REPORT.md).

---

## 1. What tracing found before any code was written

Two findings changed the design, and neither would have survived an assumption.

### 1.1 Not one of the six prospects has a `prospect.created` event

```text
41 events   →   3 client.created · 3 project.created · 8 project.checklist_toggled
                27 observation.captured
prospect subjects → 6 events, ALL observation.captured, all 2026-08-17
```

Every prospect appears in the spine only as a reconciler **baseline**. That is the reconciler's own doctrine visible in live data — *"a baseline is not a birth"* — and it means **the origin of all six prospects is genuinely unknown.**

A migration that inserted rows and let `created_at` default to `now()` would have converted *"we never witnessed this being created"* into *"created on 2026-08-27"*. That is the absence-into-fact conversion the H-series was spent removing, committed at the single moment it is easiest to commit.

**Gate 7 exists for exactly this**, and the schema now carries a queryable `COMMENT ON COLUMN` saying so, so the warning travels with the data rather than living in a repository nobody reading SQL will open.

### 1.2 Stage 2A's schema was missing five columns

`decision_maker_access`, `project_urgency`, `niche_alignment`, `first_contact`, `last_contact` — present on all six prospects, absent from the table. **Three are scoring inputs.** Migrating without them would have silently changed every score while every row count looked correct.

Added in `002_prospect_fields.sql`, all nullable with no defaults (an unstated boolean is not `false` — D-1, one field over). The three qualification fields are withheld from `ascend_automation`'s grant for the same reason `website_opportunity` is: they are judgments a salesperson forms on a call, not facts a crawler can establish.

---

## 2. The behavioural ledger

The stage's claim is not "six rows were copied". It is:

> **The Postgres representation produces the same behavioural ledger as the vault representation.**

A field diff compares *storage*. The ledger compares *meaning*: identity state, scores **and their breakdowns**, duplicate candidates, event sequence, and origin knowledge — computed by **one function** fed by each store's reader, so two implementations cannot agree with each other while both are wrong.

---

## 3. The twelve checks — all passing

| # | check | result |
|---|---|---|
| 1 | six prospects, exactly once | ✅ |
| 2 | four anchors preserved **exactly**, never re-minted | ✅ |
| 3 | both Tapia records held, unidentified, still **matchable** | ✅ |
| 4 | all 41 events, exactly once | ✅ |
| 5 | historical operator events attributed to Oscar | ✅ 10/10 |
| 6 | the migration authored no event of its own | ✅ 0 |
| 7 | **unknown origin stays unknown** | ✅ births: vault 0, db 0 |
| 8 | no prospect field changed in serialization | ✅ |
| 9 | the database refuses what Stages 0.5/1 prohibited | ✅ 4/4 refused |
| 10 | deterministic and idempotent | ✅ mints nothing |
| 11 | the vault is never written to | ✅ |
| 12 | **both stores produce the same behavioural ledger** | ✅ |

Check 10 is unusually strong here: the migration **mints nothing at all** — every `prospect_id` and every `event_id` is carried from the vault, and the two held records receive no identity. There is no clock and no randomness in the manifest, so re-planning is byte-identical with nothing to inject.

---

## 4. Mutation gates — verification must fail on tampering

| mutation | caught by |
|---|---|
| a Tapia hold released | 3 and 12 |
| a prospect identity changed | 2 and 12 |
| an event duplicated | 4 and 6 |
| a prospect birth fabricated | **7** |
| **a scoring field dropped** | **8 and 12 only** |

The last is the one worth dwelling on. Six rows, six identities, correct counts, correct events — and a changed score, because one boolean was lost in serialization. Checks 1 and 2 still pass. **Only the behavioural ledger sees it.** That is the argument for the ledger, demonstrated rather than asserted.

---

## 5. Three real bugs the gates caught in my own work

**5.1 — A date round-trip corrupted a business fact.** `first_contact: 2026-06-10` came back as `"Tue Jun 09"`: a `date` column arrives at the driver as a JS `Date` at UTC midnight, and rendering it in a timezone behind UTC yields the **previous day**. Fixed by formatting in SQL (`to_char`), which keeps the column queryable as a real date and guarantees the round trip. **The ledger found this; a row count never would have.**

**5.2 — The verifier could poison its own transaction.** Check 9 deliberately attempts prohibited writes. In Postgres a failed statement **aborts the surrounding transaction**, so every check after it would have failed with "current transaction is aborted". Each probe is now wrapped in a `SAVEPOINT` that is unconditionally rolled back — which also makes the verifier structurally incapable of persisting a write even if a probe unexpectedly *succeeded*, and a probe succeeding is precisely the failure it exists to detect.

**5.3 — A fitness rule fired on my own verifier.** F42 asserts INSERT lives only in `apply.ts`, and `verify.ts` contains three. Rather than exclude the file from the scan, it is **named in the rule** with the savepoint discipline asserted — because a verifier containing INSERT is exactly the shape that could hide a real write.

---

## 6. Live dry run (read-only, 2026-08-27)

```text
prospects            6  (4 anchored, 2 held)
events               41  (10 operator, 31 system)
prospect births      0  ← origin unknown, and stays unknown
VALIDATION: no issues
```

Every row carries its provenance as `vault:<path>` plus the source file's sha256. Recorded in `docs/stage2b/dry-run.txt`.

**Backup:** `/Users/oscar/AI/vault-backups/ascend-20260827-035409` — 66 files, outside iCloud, **restore-verified** byte-identical. Pre-migration digest ledger in `docs/stage2b/vault-pre-migration.sha`.

---

## 7. Verification

```text
tsc            clean
tests          762 passed · 9 skipped · 33 files      (was 733)
  2B gates       21 new — 12 checks + 6 mutations + dry-run guard
  fitness       137 passed  (F42 added; F12 registers substrate-migration)
lint           0 errors, 7 warnings — all pre-existing
build          compiled successfully
live vault     UNTOUCHED — 8 files, 4 anchored, 2 held
production DB  NONE — the migration has only ever run against a disposable PGlite database
```

---

## 8. What was NOT done

No clients, projects, invoices, documents or relationships migrated · no Google Sheet · no research · no partner authentication · **no production reader flipped** · no vault record deleted or modified · no business fact inferred.

Events *about* clients and projects **do** travel, because the spine moves whole — splitting it would break the ordering contract Stage 2A preserved. The client and project **records** do not.

---

## 9. Open before a production apply

1. **No production database exists.** Everything has run against in-process PGlite. Provisioning, connection config and a migration runner are unbuilt.
2. **`asPrincipal` is still untested against a real connection pool** (carried from 2A). It uses `SET LOCAL` so a pooled connection cannot leak identity between requests; PGlite is single-connection and cannot prove it. **This must be closed before deployment, not before 2C.**
3. **Oscar's `UserId` must be created before applying** — the manifest requires it, and the schema refuses an unattributed operator event.
4. **The reader flip is a separate decision.** Parity is proven; flipping is not part of this stage.

---

## 10. Recommended next gate

The substrate can take ownership without changing what the OS means — that is now demonstrated rather than argued.

**Two orderings are defensible, and the choice is yours:**

- **Flip prospect reads first** (small, reversible, retires the dual-writer exemption F21/F29 currently records), then 2C.
- **Go straight to 2C** against the substrate, leaving the vault authoritative until the importer proves itself at scale.

I would flip first: the dual-store period is a recorded exemption with a retirement condition, and carrying it through a 600-row import means debugging the importer and the parity question at the same time.
