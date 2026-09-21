# Slice 2A.0 — recovery-test repair and note idempotency

**Status: ACCEPTED (owner, 2026-09-21). Committed as a single checkpoint.**
Baseline `d3f96e3`. Pre-flight: `docs/SLICE-2A-PREFLIGHT.md` (decisions frozen in §20).

**Not done, by instruction:** no migration 010, no `prospect_contacts` / `prospect_followups`, no sales
UI, no production contact, no deployment, no push.

---

## 1 · RT-1 — the exact defects

`listProspects(tx)` has been the **active** reader since D1b. Three recovery assertions still treated it
as "every prospect", and one fixture made all three unfalsifiable:

| # | Where | The defect |
|---|---|---|
| 1 | `tests/db/restore-independence.test.ts` (**R1b**) | compared the **active** reader with `count(*) FROM prospects`, the **total** |
| 2 | `tests/db/restore-same-version.test.ts` AC4 (**R1c**) | compared the **active** reader with `exp.prospects`, the **total** |
| 3 | `tests/db/restore-same-version.test.ts` AC4 notes (**R1c**) | summed notes over the **active** reader, so notes on archived prospects were **silently skipped** and archived history never verified |
| 4 | `tests/db/restore-fidelity.test.ts` (**R1a fixture**) | held **no archived prospect**, so nothing could catch #1–#3 |

**Witnessed before the fix:** with only the archived fixture row added, the R1a rehearsal of R1b went red
on exactly *"the owner's principal … sees every restored prospect of that org"*. That's the failure the
first real production archival would have caused in the next recovery proof.

## 2 · RT-1 — implementation

**One helper, three callers:** `tests/support/recovery-readers.ts`.

| Function | Measures |
|---|---|
| `restoredProspectCounts` | what the database **holds** — raw SQL, no application reader |
| `applicationProspectCounts` | what the application's readers **return**: `active` from the operator reader; `total` and `archived` from the audit reader (`includeArchived: true`); notes walked over the **audit** reader, with `notesOnArchived` separate |
| `prospectCountMismatches` | every disagreement, field by field, plus `active + archived = total` |

R1b, both R1c legs and the R1a fixture call it. The code R1c runs against production is the code the
fixture proves can fail.

**Also:** the R1a rehearsal's failure message now **names the failing production-leg test**, not just
the tally.

## 3 · The archived-prospect recovery fixture

`Closed Diner`: anchored, `closed-lost`, with a **legacy `prospects.notes` body** and a **`prospect_notes`
entry**, archived through the application's own `archiveProspect`. So the artifact carries the archival
columns, the note and the `prospect.archived` event exactly as production would.

The fixture now asserts `{ total 4, active 3, archived 1, notes 3, notesOnArchived 1 }`, that the
archived prospect is **absent** from the active reader, and that its note still **reads back**. The fixture
counts it moves: legacy bodies 1 → 2, notes-log rows 2 → 3, events 6 → 8 (its note and its archival).

## 4 · RT-2 — the independent coverage model

In `core/recovery/restore.ts`:

- **Universe: the catalog of the database being verified**, queried directly (`pg_class`, schema
  `public`, `relkind IN ('r','p')`, partitions excluded). It is **not** derived from `manifest.sql`, and
  not from F1 either, which that file produces.
- **F3 (rows counted) and F4 (content digested) are read separately** from the manifest text and each
  held to the universe on its own.
- **Gaps reported:** `uncounted`, `undigested`, `phantom` (the manifest covers a table that isn't there),
  `staleExclusions`.
- **Exclusions:** `COVERAGE_EXCLUSIONS` is **empty**, per table, each entry requiring a reason, and it's
  tested as empty.
- **Enforced on every leg:** `RT2.coverage-totality` is the first check in `verifyBehaviour`, which R1a,
  R1b and R1c each require to have zero failures.
- **Development time:** the fixture test no longer pins "8 tables". It checks F3 **and** F4 against the
  migrated catalog, and adds **"no migration puts an application table outside `public`"**.
- **`manifest.sql` is NOT edited.** The current recovery point's proof compares the manifest production
  ran at dump time with the one run on restore. RT-2 lives beside the manifest, not in it.

## 5 · Proof that an uncovered application table fails recovery

A real restore of the fixture artifact, with a table added that the manifest doesn't cover
(`rt2_probe_uncovered`):

| Case | Result |
|---|---|
| before the table exists | `RT2.coverage-totality` passes |
| **table present, uncovered** | **the recovery suite's behaviour checks FAIL**, naming it `uncounted` **and** `undigested` |
| counted in F3, not digested in F4 | **still FAILS** — F4 is held on its own |
| **covered** — F3/F4 lines that the manifest **actually computes** (`F3.rows.… = 1`, a 64-hex digest) | **passes; zero failed checks** |
| an existing table's F3 line dropped from the manifest | caught — the universe isn't the manifest |
| a manifest naming a missing table / an exclusion for a missing table | `phantom` / `staleExclusions` |

## 6 · Note idempotency — design

- `POST /api/prospects/[slug]/notes` now **requires `noteId`**, a client-generated UUID reused unchanged
  on every retry, validated and lower-cased.
- `writeProspectNote`: `INSERT … ON CONFLICT (note_id) DO NOTHING`. On conflict, the existing row is read
  back: the **same** prospect, author and trimmed body is a **replay** — the same note is returned, and
  **nothing** is written, including no event. Anything else is `NoteIdConflict` → **409**, which reveals
  nothing of the other note.
- `prospect.note_added` is appended **only** by the call that inserted, in the same transaction, and now
  carries `correlation_id = noteId`.
- **201** when written; **200 `replayed: true`** when it already was. Same note either way.
- `ProspectNotes.tsx`: one id per note, kept across retries of the same text, replaced only if the text
  changes. `busy` stays, as a courtesy only.
- **Unchanged:** authority (`prospects:write`), authorship (the resolved principal), 008's RLS and
  grants, the owner-only delete. `addProspectNote` remains as a compatible wrapper for server-side callers.

**Known edge, recorded, not in scope:** if an owner **deletes** a note and a lost-response retry of that
same note arrives afterwards, the retry recreates it, because there is no tombstone. The retry window is
seconds and only the author's client retries. A tombstone would be a notes redesign.

## 7 · Note retry and concurrency proof

| Proof | Result |
|---|---|
| **PGlite, real route + admission chain** (13) | sequential retry → 201 then 200, one row, one event; **lost response** then retry → converges; 5 retries → `[201,200,200,200,200]`; trimmed and upper-case retries converge; different ids → two notes; same id with a different body, prospect or author → **409**, nothing leaked or appended; missing or malformed id → 400; unauthenticated → 401; a spoofed author is ignored; unknown prospect → 404 |
| **PostgreSQL 17.6, real concurrency** (6) | harness proves 17.6, socket-only, 8 distinct backends · **8 simultaneous writes of one id → 1 row, 1 event, one 201 + seven replays** · 8 different ids → 8 notes · two bodies racing under one id → exactly one stored, the other refused · **deterministic:** a retry arriving while the original is **uncommitted waits, then replays** · if the original **rolls back**, the waiting retry **writes** it |

## 8 · Files changed

| File | Change |
|---|---|
| `core/recovery/restore.ts` | RT-2 coverage model; `RT2.coverage-totality` in `verifyBehaviour`; optional manifest-text seam on `manifestOf` / `verifyBehaviour` (tests only) |
| `core/db/prospect-notes.ts` | `writeProspectNote`, `NoteIdConflict`, `NoteWrite`; `addProspectNote` becomes a wrapper |
| `core/db/index.ts`, `core/crm/notes.ts` | exports; `addNote` takes `noteId` and returns `{ note, replayed }` |
| `app/api/prospects/[slug]/notes/route.ts` | required UUID `noteId`; 201 / 200 / 409 |
| `components/sales/ProspectNotes.tsx` | one id per note across retries |
| `tests/support/recovery-readers.ts` | **new** — the RT-1 helper |
| `tests/db/restore-fidelity.test.ts` | archived fixture row; RT-1 assertions; RT-2 totality + adversarial suite; rehearsal names failing tests |
| `tests/db/restore-independence.test.ts` | R1b via the helper |
| `tests/db/restore-same-version.test.ts` | R1c prospects and notes via the helper |
| `tests/db/note-idempotency.test.ts` | **new** |
| `tests/db/note-idempotency-concurrency.test.ts` | **new** (real 17.6) |
| `tests/architecture/gate-2g1.ts` | the two new suites registered; the concurrency one `requires: ["ASCEND_PG17_BIN"]` |
| `docs/SLICE-2A-PREFLIGHT.md`, `docs/SLICE-2A0-CHECKPOINT.md` | pre-flight + frozen decisions + RT-2 correction; this checkpoint |

`manifest.sql`, every migration, and all D1 code are **unchanged**.

## 9 · Gate results

| Gate | Result |
|---|---|
| `tsc --noEmit` / `eslint` (changed files) | clean / clean |
| `gate:db` (with `ASCEND_PG17_BIN`) | **523 passed**, 199 skipped (was 496: +27) |
| `gate:static` | 1,818 passed; 1 failed — the pre-existing environment check, unchanged |
| `gate:server` | 3 passed |
| **R1b against the post-009 artifact** | **69 / 69** (3 suites: format 25, fixture mechanism 36, artifact 8) |
| **R1c against the post-009 artifact**, both legs on 17.6 | **31 / 31**; behaviour checks **10** per leg (the RT-2 check is new), 0 failed; prospects reader `{total 3108, active 3108, archived 0}` = restored; notes `{all 0, onArchived 0}` = restored; manifest 56/56 |

The R1c run used a temporary copy of the retained 17.6 build, byte-proven identical (1,879 entries,
inventory `bde2aaf1…`), and **deleted afterwards**. It held 12 restored-data directories and 4 credential
files. `/Users/oscar/AscendPg17` was re-inventoried and is unchanged. No PostgreSQL process, socket or
credential file remains; both artifacts verify; production is untouched (PID 18362, build
`2NCS2fCKGRoKqk3tUd4F8`).

## 10 · Mutation and adversarial results — 15 probes, 15 caught

| # | Probe | Caught by |
|---|---|---|
| RT1-P1 | notes walked over the **active** reader (the original defect) | fixture test **and** R1b rehearsal |
| RT1-P2 | `active` measured with the audit reader | fixture test **and** R1b rehearsal |
| RT1-P3 | the archived fixture row removed | fixture's explicit counts (non-vacuity) |
| RT2-P4 | F4 not held to the catalog | 2 tests |
| RT2-P5 | universe derived from the manifest itself (circular) | UNCOVERED test |
| RT2-P6 | RT-2 check removed from `verifyBehaviour` | 4 tests — *after a repair; see below* |
| RT2-P7 | exclusion registry silently widened | 3 tests |
| N1 | `ON CONFLICT` removed | 8 PGlite + 3 on 17.6 |
| N2 | **the original defect:** server-minted id | 8 PGlite + 4 on 17.6 |
| N3 | event also appended on replay | 3 PGlite + 3 on 17.6 |
| N4 | replay without the sameness check | 3 PGlite |
| N5 | id made optional | 1 PGlite |

**One probe beat the test first.** RT2-P6 initially made the RT-2 suite's **setup** throw, and vitest
reported five tests as **skipped** — the false-evidence shape the gate ledger exists to refuse. The suite
now looks the check up inside each test and fails with a named message if it's missing. Re-probed: four
explicit failures.

## 11 · Is the recovery machinery safe for migration 010?

**Yes, for coverage.** A table 010 adds without F3 **and** F4 manifest lines will now fail R1a at
development time, and R1b/R1c on any restored artifact. The failure names the table.

**What 010's slice must still do:** add F3/F4 lines to `manifest.sql` for `prospect_contacts` and
`prospect_followups`. That **changes the manifest**, so it must ship **with** 010, and the next recovery
point is taken after 010 is applied — the D1b.2 pattern: new artifact, full R1b, full R1c. A new
artifact's manifest and the new `manifest.sql` then agree by construction. The pre-010 artifact becomes
historical.

## 12 · Remaining blockers before 2A.1

None blocking. Three things 2A.1 must settle, recorded here so they aren't discovered mid-slice:

1. **The `closed-lost` reason vocabulary** — the decision requires "structured provenance", but no reason
   list is frozen yet.
2. **Where sales' stage and assignment limits are enforced.** Row policies can't express "sales may set
   `assigned_to` only from NULL to self" or "sales may not leave a closed stage", because `WITH CHECK`
   can't see the old row. And a trigger forbidding sales `closed-won` would also block **Promote**, which
   sales legitimately runs. Recommendation: enforce these in the 2A.1 commands under `lockProspect`,
   covered by adversarial tests, with RLS where it expresses cleanly (§13). Decide before writing 010.
3. RT-1 is closed, so the first real production archival is no longer blocked by recovery tests.

## 13 · Proposed exact boundary for migration 010

**Additive only** — no existing column, constraint, policy or grant is altered, so the D1 build keeps
running against 010 unchanged:

- **`prospect_contacts`** — `contact_id uuid PK` (= command id), `organization_id`, `prospect → prospects(id)
  ON DELETE RESTRICT`, `author_user_id → users(id)`, `occurred_at`, `recorded_at`, `channel` CHECK,
  `outcome` CHECK **exactly the frozen ten**, `note` (non-blank if present), not-from-the-future CHECK.
  RLS enabled + forced. SELECT for the organization. **INSERT only**, as self, and only when the target is
  anchored and not archived. **No UPDATE and no DELETE grant to any role.** Automation: nothing.
- **`prospect_followups`** — as the pre-flight §14 sketch, `prospect … ON DELETE RESTRICT`, the
  `resolution_has_provenance` and `superseded_names_successor` CHECKs, the **partial unique "one open per
  prospect"**, and the open-queue index. RLS: INSERT as creator; sales UPDATE limited to lifecycle columns
  **on rows assigned to themselves**; owner wider. Target must be anchored and not archived. No DELETE.
- **`closed-lost` provenance** — depends on decision 12.1: either a `lost_reason` column on `prospects`
  with a CHECK tying it to `status = 'closed-lost'` (transition and actor in `prospect.status_changed`), or
  the reason carried by a required contact record. Recommend the column; it's the only 010 change that
  touches `prospects`, and it's additive and nullable.
- **`manifest.sql`** — F3 and F4 lines for both new tables, in the same change.
- **Not in 010:** triggers on `prospects`, any stage vocabulary change, any change to 001–009.

---

**Accepted. 2A.1 begins with its pre-flight (`docs/SLICE-2A1-PREFLIGHT.md`).**
