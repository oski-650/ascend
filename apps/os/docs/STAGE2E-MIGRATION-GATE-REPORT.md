# Stage 2E — Six-Prospect Production Migration & Source-of-Truth Flip

**Date:** 2026-08-28
**Outcome:** **PASSED.** Six prospects and 41 events are in production. Postgres is authoritative.
**One incident occurred, was caught, and was repaired — §8. Read it.**

---

## 1. Migration result

Six prospects and 41 events migrated in **one transaction**, with all twelve verification checks run
against the written-but-uncommitted state before commit.

```
001 prospects inserted           6
    events inserted             41
    events authored by migration 0
```

Verify-before-commit was not stylistic. `events` is append-only by trigger *and* by grant, so a bad
migration could not have been undone — there would have been no way back except a restore. Running
the checks inside the transaction means a failure would have left production exactly as it was.

### All twelve checks passed

| # | check | result |
|---|---|---|
| 1 | six prospects represented exactly once | vault=6 db=6 manifest=6 |
| 2 | anchored prospects retain their exact `prospect_id` | 4 ids, identical sets |
| 3 | both Tapia prospects remain held and matchable | held=2, 1 duplicate candidate |
| 4 | all historical events represented exactly once | vault=41 db=41 |
| 5 | historical operator events attributed to the operator | 10 of 10 |
| 6 | the migration generated no new events | none |
| 7 | no business fact inferred — unknown origin stays unknown | births: vault=0 db=0 |
| 8 | no prospect field changed during serialization | all fields identical |
| 9 | the database refuses the states Stages 0.5 and 1 prohibited | all 4 refused |
| 10 | the manifest mints nothing — re-planning is byte-identical | no ids minted |
| 11 | the vault remains byte-identical | *see below — verified independently* |
| 12 | both stores produce the same behavioural ledger | identical |

**Check 11 was not trusted.** It only echoes a digest the caller passes in, so it proves nothing on
its own. The vault was hashed independently before and after — **66 files, `6fabd121…`, unchanged**.

### Historical provenance held

- **Zero `prospect.created` events** on both sides. Ascend never witnessed any of these six
  businesses being created, and nothing was invented to fill the gap.
- **No prospect claims an author** — `created_by` is NULL on all six.
- `created_at` is the row insert time and the column's `COMMENT` states, in the database itself,
  that it is *"AUDIT METADATA, NOT A BUSINESS FACT… their origin is UNKNOWN"*. That comment is
  asserted by the gate, so the distinction travels with the data rather than living in a document.

---

## 2. Identity parity

```
anchored 01a0429d-d996-76fc-…  bay-area-custom-shirts-inc
anchored 01a0429d-d996-7455-…  central-coast-cleaning
anchored 01a0429d-d996-7ada-…  modesto-hvac-co
anchored 01a0429d-d996-7a63-…  valley-roofing-pros
held     —                     tapia-tile-amp-marble-co
held     —                     tile-amp-marble-installation-in-bay-area
```

**4 anchored · 2 held · 0 unexplained residue.** Every anchored id is the vault's own, and each is a
genuine UUIDv7 (version nibble `7`). Both Tapia records remain **held**: not merged, not deleted, not
renamed, hold reasons intact, and the duplicate-candidate pair still detected on `website`.

---

## 3. Event parity

| | |
|---|---|
| events | **41** — the same 41 `event_id`s the vault holds |
| operator events | 10, **each naming its human** |
| system events | 31, **none claiming a human** |
| `prospect.created` | **0** |
| authored by the migration | **0** |
| ordering | `seq` follows the vault's authoritative order exactly |

---

## 4. Raw parity — compared without a shared transformation

The migration's decisive check compares `buildLedger(vault)` with `buildLedger(db)` — **both sides
through the same function**, which is exactly the shape you told me not to rely on, and the shape
that once reported parity while dropping `body` entirely.

So a separate comparison reads the markdown with `gray-matter` and the rows with SQL, and applies an
explicit mapping **to the vault side only**:

| result | detail |
|---|---|
| all 15 fields, all 6 prospects | **identical** |
| **empty strings preserved** | **11 of them** — `contact_name`, `contact_email` and others survive as `''`, never NULL |
| dates | 3 compared **as written**, cast to text in SQL so no timezone touches a value that has none |
| identity fields | match the vault's own answer, not a re-derived one |
| `EMPTY_EQUALS_ABSENT` | pinned to **exactly** `first_contact`/`last_contact` so the exception cannot grow |

**Absent keys: none exist.** All six prospects carry all fifteen fields, so "absent stays NULL" is
**untested here rather than proven**. Reported rather than passed over — it will matter when partial
records arrive from the Sheet.

### `body` / operator notes

Preserved. **5 148 bytes across six prospects**, every interior byte identical, verified two ways:
against the raw file and against what the vault reader produces.

**One measured difference, and it is not data:** `gray-matter` returns the body with the blank line
after the frontmatter and the file's trailing newline attached; the vault reader trims both.
Production stores what the **reader** produces, so it differs from raw file bytes by one or two
whitespace characters **at the boundaries and nowhere else**. That trim is pre-existing and belongs
to the reader — every consumer has always seen the trimmed body.

---

## 5. Consumer-output parity — all ten, real producers, real data

Run against the **real vault and the real production database**, over the **`ascend_app` login on
the transaction pooler** — the credential the deployed app will hold.

```
✓ prospect list          ✓ opportunity detection   ✓ graph projection
✓ prospect detail        ✓ forecast                ✓ knowledge index
✓ automations matching   ✓ operator brief          ✓ compileTargetContext
                         ✓ pipeline digest
```

**Identical, all ten.** Two declared non-differences removed and nothing else: the ambient clock
(two runs, two timestamps) and `EMPTY_EQUALS_ABSENT`. A completeness check asserts the list of ten
itself, so a suite that quietly stopped covering a consumer cannot still report green.

`body` is verified explicitly in three of them — the detail page, `compileTargetContext`, and the
knowledge index's search text.

---

## 6. Source-of-truth flip

`ASCEND_PROSPECT_SOURCE=postgres` is now set in `.env.production.local`.

| verification | result |
|---|---|
| every prospect resolves through Postgres | ✅ 6, with 4 anchored / 2 held |
| **no consumer silently reads the vault** | ✅ *see method below* |
| control: an empty vault + vault selected → 0 prospects | ✅ (so the above is not caching) |
| postgres selected, no connection → **throws** | ✅ `Refusing to fall back to the vault` |
| a typo does not select a store | ✅ `postgress` throws |
| unreachable database → error, **not** vault data | ✅ |
| the vault is still present and unmodified | ✅ rollback material intact |
| F43 / F21 / F29 and all source-of-truth rules | ✅ **152 fitness rules pass** |

### How "nothing reads the vault" was proven — and the approach I rejected

The obvious method is to edit a name in Postgres and check every consumer reports it. **I tried
that, and it was wrong in a way that mattered** (§8). It is replaced by the inverse, which cannot
touch production at all: `ASCEND_VAULT_PATH` is pointed at an **empty directory** while the source
is Postgres. Every consumer must still return all six prospects, complete with notes.

The knowledge index and graph projection — the two that historically read the vault directly — both
return all six. A paired control confirms that with the vault *selected* and empty, prospects
correctly disappear, so the result is not an artifact of caching.

---

## 7. Fresh backup — the empty-database recovery point is now expired

```
bundle  ~/AscendBackups/ascend-backup-20260828T192027Z-post-2e.tar.gz
sha256  75b0556730267a819482c6833fbf4caa0d53f5b1a66a63b7c64d3a0c5d694872
```

| | |
|---|---|
| migration version | `004_schema_migrations.sql` |
| rows | organizations 1 · users 1 · memberships 1 · **prospects 6** · **events 41** |
| identity inventory | anchored 4 · held 2 |
| operator events | 10 |
| `events_seq_seq` | 509 |
| location | `~/AscendBackups/` — outside the repo, outside iCloud, `chmod 700` |
| credential scan | **CLEAN** — no password hashes in the bundle |

**Verified, not merely written:** the artifact was replayed into a vanilla PostgreSQL with no
Supabase present (6/6), and independently inspected — 54 INSERTs, 6 prospects, 41 events, 4
`prospect_id`s, all 6 sets of operator notes.

A **pre-2E** backup (`…T190349Z-pre-2e`) was also taken and verified before any write.

> ⚠️ **Both live on this Mac.** Free plan means no PITR. **Copy the post-2E bundle off-machine.**

Backups are now a script — `./scripts/backup-production.sh [label]` — which enforces `verify-full`
TLS, keeps the password out of `argv`, excludes role password hashes, and checksums everything. A
procedure that exists only as a paragraph gets retyped differently each time.

---

## 8. THE INCIDENT — a probe committed to production

**What happened.** My first attempt at proving no consumer reads the vault opened a transaction by
hand, wrote a marker into one prospect's `name`, then called `listProspects()` to see what consumers
returned. `listProspects()` opens **its own** transaction through `asPrincipal` on the same
connection — so the inner `COMMIT` committed **my outer transaction**, marker included. The
`ROLLBACK` in my `finally` then had nothing to roll back.

**Blast radius, measured precisely:**

| | |
|---|---|
| rows affected | **1** |
| columns affected | **1** — `name` on `bay-area-custom-shirts-inc` |
| events written | **0** (still 41) |
| identity | unchanged — 4 anchored / 2 held |
| `created_at` / `updated_at` | unchanged |
| vault | untouched |

**How it was caught.** The very next assertion — the vault-still-intact check — compared the name
against the vault's value and failed loudly. It was found within seconds, by a test, not by luck.

**Repair.** The correct value was read **from the vault** and restored. That is precisely the role
the vault was retained for, and it worked: one `UPDATE`, verified, zero markers remaining.

**Re-verification after repair, from scratch:** raw parity 9/9 · consumer parity 11/11 · flip 7/7.

**What I changed so it cannot recur.** The mutation-based probe is gone entirely, replaced by the
vault-removal method that never writes to production. The lesson is general and worth stating:
**do not hand-roll a transaction on a connection that application code will also use** — the
application's own transaction management will collide with yours, and in this case it committed.

I am reporting this prominently rather than burying it in a passing test suite. It is the only
unplanned write to production in the entire stage, and you should know it happened.

---

## 9. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| 2E migration gate | **13 passed** |
| 2E raw parity | **9 passed** |
| 2E consumer parity | **11 passed** |
| 2E source flip | **7 passed** |
| architecture fitness F1–F45 | **152 passed** |
| **full suite, everything enabled** | **887 passed, 52 skipped, 45 files** |
| vault | **byte-identical**, 66 files, `6fabd121…` |

---

## 10. Unexpected findings

**1 · The application login cannot discover its own tenancy.** `ascend_app` holds no grant on
`organizations`, and the `org_self` policy filters to `id = current_org()` — the very value it would
be trying to learn. It is structurally incapable of answering "which organization am I?".

This is correct, not a gap: **tenancy identity belongs to the session layer**, supplied by whoever
authenticated the human, and must never be self-asserted by the database client. It does mean the
partner-facing UI must carry `organization_id` and `user_id` in the signed session — worth knowing
now, before that UI is built.

**2 · A deployment setting was leaking into unit tests.** After the flip, twenty vault-fixture tests
failed with `ProspectSourceUnavailable` — the seam working exactly as designed, on the wrong input.
Anyone sourcing `.env.production.local` (which the database gates require) was handing
`ASCEND_PROSPECT_SOURCE=postgres` to every unit test in the process. Fixed with a Vitest setup file
that clears it; suites that need a store now set it explicitly, where the choice is visible.

**3 · Two production suites asserted "the database is empty."** True before 2E, false by design
after. Rewritten to be scoped and baselined rather than absolute — deleting them would have stopped
noticing if those suites ever leaked a row.

**4 · `length(notes)` looked like data loss and is not.** Three prospects show fewer characters in
Postgres than the vault body has JS `.length`: 1569→1558, 807→802, 1657→1650. The deltas are exactly
**11, 5 and 7 — the number of non-BMP characters** in each (the 🔴🟡🟢 in the PSI audit notes). JS
counts UTF-16 code units; Postgres counts code points. The strings are strictly equal. Verified
rather than assumed, because a number that shrank deserves an explanation and not a shrug.

---

## 11. State now

| | |
|---|---|
| prospects | **6 in Postgres** — 4 anchored, 2 held |
| events | **41**, append-only, 0 fabricated |
| `ASCEND_PROSPECT_SOURCE` | **`postgres`** — flipped |
| vault | untouched, retained as rollback material |
| recovery point | post-2E bundle, verified — **not yet off-machine** |

**Not done, deliberately:** Google Sheets · bulk import · automated research · scoring changes ·
outreach · partner UI · new prospect creation.

**STOPPING HERE**, as instructed.
