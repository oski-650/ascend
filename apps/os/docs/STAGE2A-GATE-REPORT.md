# Stage 2A — Shared Substrate · Gate Report

**Status: implemented and verified against real Postgres. Nothing wired to any surface. Live vault untouched. No data migrated.**

Authorised by the sign-off on Decisions 1 and 3 in [STAGE2-MULTIUSER-ARCHITECTURE.md](./STAGE2-MULTIUSER-ARCHITECTURE.md).

---

## 1. The unknown, resolved as instructed

Offline capture was **not specified**. Per the standing instruction — *"If not specified, design online-first and document that offline is deferred"* — Stage 2A is **online-first**.

**What that commits us to:** nothing yet. Stage 2A contains no client code. The decision becomes expensive at **Stage 2E** (the sales workspace), because offline capture changes the client architecture materially — local write queue, conflict resolution, and a second identity-collision surface where two devices mint prospects for the same business while disconnected.

> **The question to answer before 2E, not before 2B:** *"If you're out somewhere with no internet, do you need to view prospects, add notes, or record sales activity?"*

Recorded as an open decision, not silently assumed away.

---

## 2. What was built

```text
packages/domain/          UserId · MembershipRole · IdentityState · actor_user_id · prospect.assessed
core/db/
  schema/001_substrate.sql   241 lines — tables, constraints, triggers, RLS, roles, grants
  client.ts                  the vendor seam: three methods, no vendor types
  events.ts                  append-only spine, seq-ordered, §19-scoped counting
  prospects.ts               repository; identity, holds, corroboration, assessment
  organizations.ts           organizations · users · memberships
tests/db/
  pglite.ts                  real Postgres 18.3 in-process
  substrate.test.ts          29 gates
  mutation.test.ts           12 gates — the two dangerous ones
  scale.test.ts              5 gates — the O(N²) correction
```

**Verification is real, not asserted.** PGlite is Postgres compiled to WASM, so the tests exercise the actual CHECK constraints, triggers, GRANTs and RLS policies — not a mock of them. That mattered: the Stage 2A claim is precisely that rules previously enforced by convention are now enforced by the database, and a fake would have made that claim unfalsifiable.

---

## 3. Guarantees that moved from convention to constraint

| guarantee | was | now |
|---|---|---|
| anchored ⟺ has identity | test | `CHECK anchored_iff_identified` |
| held ⟺ states a reason | test | `CHECK held_states_its_reason` |
| a judgment names its author | nothing | `CHECK assessment_has_provenance` |
| automation may not judge | intended (F31) | **GRANT withholds the column** |
| automation may not write a held row | P3, unimplemented | **RLS policy on UPDATE** |
| held rows stay matchable | P4, unimplemented | **SELECT policy deliberately unnarrowed** |
| an operator event names its human | nothing | `CHECK operator_events_name_their_human` |
| a system event claims no human | nothing | `CHECK system_events_name_no_human` |
| events are append-only | comment | **trigger raises on UPDATE/DELETE** |
| two records cannot share an identity | O(N) scan | **UNIQUE index** |
| the row and its event commit together | impossible | **one transaction** |

That last one is new capability, not a re-expression. The vault performed `writeFileAtomic` then `emitEvent` as two operations; a crash between them left a prospect with no memory of being created. That window is now closed.

---

## 4. The two mutation gates

Both demonstrate the failure rather than describing it.

**Gate A — held + corroborating row → `blocked`, never `new`.** The naive shortcut (`filter(h => h.identityState !== 'held')`) is applied directly in the test. Under it the Tapia row classifies `new`, and the follow-on gate acts on that classification and asserts the damage: **three records of one business, one of them anchored.** The quarantine manufacturing the duplicate it exists to prevent.

**Gate B — blank website → `unknown`, never "no website".** Under the mutation, 484 unresearched rows each assert the business has no website and each collect +30 — **14,520 fabricated points**, computed in the test.

Both also assert the converse, so neither passes by being "always block" or "always unknown".

---

## 5. The O(N²) correction, measured

The vault path was quadratic because `createProspect` called `buildProspectIdIndex()`, which read every prospect file:

```text
N= 50  3.4 ms/row      N=200   7.1 ms/row
N=100  4.0 ms/row      N=400  14.3 ms/row      ← per-row cost doubles as N doubles
                                                 projecting ~15 min at 5,000
```

**The correction is not "build the index once per batch."** That is correct only while exactly one process writes, and two users make that assumption false. Uniqueness is now a `UNIQUE` index: one probe per insert, and race-safe.

The gate asserts the **shape** (per-row cost flat within 2x from N=100 to N=400), not a wall-clock number, so it cannot go flaky on a different machine. Corroboration keys (`website`, `phone`, `email`) are indexed too, so identity matching at 5,000 rows is a probe per signal rather than a scan per row.

---

## 6. Two findings the tests produced that I had not predicted

**6.1 — Automation is blocked by column grants *before* RLS is evaluated.** I asserted an RLS refusal for an attempt to move a row into `held`; the actual error was `permission denied for table prospects`, because `identity_state`, `hold_reason` and `prospect_id` are absent from automation's UPDATE grant. Two independent mechanisms refuse it, and the stricter one fires first. The assertion was corrected to accept either.

**6.2 — F21 and F29 correctly fired on the dual-store period.** There are now genuinely two `createProspect` definitions and two `newProspectId` consumers. **I did not weaken the rules.** They now assert *one writer per store*, with both files named and an explicit retirement condition: when Stage 2B flips prospect reads to Postgres and the vault writer is retired, these return to a single entry. A third writer still fails.

I also corrected one of my own new rules that flagged its own documentation — the schema prose legitimately discusses Supabase, so SQL comments are stripped before scanning, the same discipline `stripComments` applies to TypeScript.

---

## 7. Verification

```text
tsc            clean
tests          733 passed · 9 skipped · 32 files      (was 677 before this stage)
  db gates       46 new, against real Postgres 18.3
  fitness       128 passed  (F41 added, F12/F21/F29 updated)
lint           0 errors, 7 warnings — all pre-existing
build          compiled successfully
live vault     UNTOUCHED — 8 files, 4 anchored, 2 held, unchanged
```

The db suite runs in 1.9 s. It was 24 s with a fresh WASM database per test, which is how a suite stops being run; it now shares one instance per file and truncates between tests, since the DDL is what is under test and only rows need to be clean.

---

## 8. What was deliberately NOT done

No Google Sheets importer · no research engine · no sales UI · no `apps/sales` · no graph changes · **no migration of the six live prospects** · no reader flipped · nothing wired to a surface (F41 asserts the last one).

The vault remains authoritative for every entity, including prospects.

---

## 9. Known gaps, recorded rather than closed

1. **Authentication is not implemented.** The schema models users and memberships; issuing and verifying credentials is external (Supabase Auth or equivalent) and is Stage 2B's first task. `lib/auth.ts`'s single shared password is untouched and still governs the local OS.
2. **`asPrincipal` is untested against a real connection pool.** It uses `SET LOCAL` specifically so a pooled connection cannot leak identity between requests, but PGlite is single-connection and cannot prove that. **This needs a pooled-integration test before any deployment.**
3. **No migration runner.** `001_substrate.sql` is applied by the test harness; production application is Stage 2B.
4. **§19's historical events carry no `actor_user_id`.** The 41 existing events must be attributed to Oscar during migration — true, since he was the only user — and the CHECK constraint will refuse them otherwise. Stage 2B must handle this explicitly.
5. **The pre-existing flaky test** (`event-emission.test.ts:407`, ~2 in 20 runs) is unrelated and untouched.

---

## 10. Recommended next gate

**Stage 2B — prospect migration**, and nothing else:

```text
snapshot → plan → validate → [review] → apply → verify
```

Move the six prospects and 41 events into the substrate, preserving `prospect_id` values exactly (never re-minted), the two Tapia holds and their reasons, event ordering, and actor attribution. Verify parity between stores, then flip prospect reads in a separate reviewed decision with the vault retained read-only as the rollback.

**Do not begin the Sheets importer until parity is verified.**
