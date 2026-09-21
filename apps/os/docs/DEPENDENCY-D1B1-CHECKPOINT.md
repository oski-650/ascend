# Dependency D1b.1 — prospect archival, and the concurrency debt closed

**Status: ACCEPTED (owner, 2026-09-20). Committed as a single checkpoint.**
Baseline `4276f89` (D1a). Contract: `docs/DEPENDENCY-D1B-CONTRACT.md`.

---

> # ✅ DEPLOYMENT INVARIANT — SATISFIED (2026-09-20). DEPLOYMENT STILL NOT AUTHORIZED.
>
> Migration `009_prospect_archival.sql` was applied to production on 2026-09-20 by D1b.2 and verified
> 51/51 (`docs/DEPENDENCY-D1B2-CHECKPOINT.md`). Production's ledger head is now
> `009_prospect_archival.sql` and it has `archived_at` / `archived_by`.
>
> **D1a and D1b.1 code is therefore DEPLOYABLE AGAINST SCHEMA 009.** The ordering constraint this
> banner used to enforce — 009 first, application afterwards — has been met in that order.
>
> **That is a technical fact, not an authorization.** No deployment has occurred: the running
> `com.ascend.os` service is still the 2026-09-18 build, which predates D1a and never names the
> archival columns, and it keeps working unchanged against schema 009. Deploying D1a/D1b.1 requires
> separate, explicit owner authorization.
>
> *Superseded wording (kept for the record):* until 2026-09-20 this banner read "D1b.1 IS NOT
> DEPLOYABLE UNTIL 009 IS APPLIED", because the canonical reader filters on `archived_at IS NULL` and
> would have failed every prospect read against a schema-008 production.

---

**Not done, by instruction:** migration 009 is **not applied to production**; no production backup
was taken; D1b.2 is not started; nothing pushed. The only production contact was the single
authorized read-only aggregate in §1.

---

## 0 · Permanent D1b.1 invariants (owner-accepted, 2026-09-20)

These are not implementation notes. They are the accepted contract of this dependency, and a later
change that breaks one is a regression rather than a refactor.

1. PostgreSQL **archival replaces routine prospect deletion**.
2. Sales receives **only the bounded archival capability, never raw DELETE**.
3. `archived_at` / `archived_by` carry provenance and preserve prospect identity and history.
4. The sales RLS policy tightens its **`USING`** predicate **without** making the archival transition
   impossible through an incorrect `WITH CHECK`.
5. Archived prospects are excluded from the active-sales set but remain available to explicit
   audit / history / reconciliation readers.
6. Import identity matching **includes archived prospects** and must not recreate them as new.
7. Promotion and archival are serialized by a **prospect-scoped PostgreSQL transaction advisory
   lock**.
8. The lock spans the **full critical section** required to protect the filesystem client decision
   together with database state.
9. **Session-scoped advisory locks are not acceptable** with the production transaction pooler.
10. Promotion retries converge on **one client and one `prospect.promoted` event**.
11. Archive retries converge on **one transition and one `prospect.archived` event**.
12. Promotion/archive races produce a coherent winner/loser outcome.
13. Notes and history are preserved.
14. UI language is **Archive**, not Delete.

---

## 1 · Production aggregate result

One read-only query, over the **direct** endpoint (not the pooler) under TLS pinned to the same CA
`core/db/tls.ts` carries, inside `BEGIN READ ONLY` with `default_transaction_read_only=on`. Counts
and one migration filename. No names, ids, row contents or PII. No mutation.

| Field | Value |
|---|---|
| `ledger_head` | **`008_prospect_notes_log.sql`** ✅ exactly 008 — the precondition to proceed |
| `ledger_rows` | 8 |
| `prospects_total` | 3,108 |
| `anchored` / `held` | 3,106 / **2** |
| `closed_won` / `closed_lost` / `status_absent` | 1 / 0 / 0 |
| `anchor_absent` | 2 (equals `held` — `anchored_iff_identified` holds in production) |
| `slugged` | 6 |
| `notes_total` | **0** |
| `users_total` | **1** |
| `archive_cols_present` | **0** — 009 is not applied |

**What it changed.**

- **Ledger head is exactly 008**, so R1 abort condition A5 does not fire and D1b proceeds.
- **`held` = 2.** Small, which makes owner decision 2 (sales may not archive held rows) cheap: the
  protected set is two records, not a growing backlog.
- **`notes_total` = 0.** Worth stating plainly because it corrects an impression: the
  `prospect_notes` log is empty in production today, so a hard delete would *currently* cascade
  nothing. It would still destroy the legacy `prospects.notes` bodies **(6 of them — see the
  correction below)**, and the table exists precisely so operators start using it. The archival
  argument is unchanged; its urgency is simply lower than the note count alone suggested.
- **`users_total` = 1.** The sales partner is **not yet provisioned in production**. Sales-side
  archival is therefore proven in the fixture and **unexercised in production** until that user
  exists. Flagged, not hidden.
- **`status_absent` = 0** and `closed_lost` = 0: no status value needs special archive handling.

**Two facts carried forward explicitly (owner-recorded):**

1. **Production has no provisioned sales-partner account.** `users_total = 1`. Sales archival is
   therefore proven through the fixture and the REAL authority machinery — a real invitation, a real
   login, a membership-resolved principal, and the real `ascend_sales` database role — but it is
   **not witnessed against a production sales principal**. That remains true until such an account
   exists; it is not evidence that can be assumed forward.
2. **`prospect_notes` currently contains zero rows, and archival is still required.** The empty log
   does not weaken the case: legacy prospect notes live in `prospects.notes` — **6 non-empty bodies,
   not 3,108 (corrected below)** — and would be destroyed by a hard delete, and the note-log table
   exists precisely so future state accumulates there. Archival protects both the history that
   exists today and the history that has not been written yet.

---

### ⚠️ CORRECTION (2026-09-20, D1b.2 step 4) — witnessed, not silently rewritten

**The claim this checkpoint originally made was wrong.** Two passages above, and the `eb0f8b6` commit
message, described `prospects.notes` as "the markdown body, which every one of the 3,108 rows
carries" / "carried by all 3,108 rows".

**Production truth, measured read-only immediately before migration 009 and re-confirmed by V45/V46
immediately after it:**

| | |
|---|---|
| prospects | **3,108** |
| non-empty `prospects.notes` bodies | **6** — the six vault-originated prospects |
| `prospect_notes` log rows | **0** |

The 3,102 rows created by the 2026-09 lead-list import have no body. Only the six migrated from the
vault do. The original statement overstated the *magnitude* of what a hard delete would destroy today
by a factor of ~518.

**What does not change — the architectural conclusion.** Hard deletion remains inappropriate, and the
reason was never the row count:

- **Prospect identity must survive.** `DELETE` releases the `prospect_id` anchor, so a re-import of
  the same business becomes a *new* record. Archival keeps the anchor, which is what makes the
  identity matcher still recognise an archived business (owner invariant 6).
- **History must survive.** The client's `promoted_from_prospect_id` back-reference and every
  `subject_entity_id` in the event spine point at that anchor.
- **Future note-log state must not be cascaded away.** `prospect_notes.prospect` carries
  `ON DELETE CASCADE` (008). That the table is empty *today* is a statement about adoption, not about
  the hazard: the first note written would be destroyed by the first delete. A safeguard is not
  justified by its current workload.

The correction is recorded here rather than edited away because the commit message of `eb0f8b6` is
immutable and would otherwise disagree with this document with no trace of why. **Nothing about
migration 009, its checksum, or any decision in this checkpoint changes.**

---

## 2 · Migration 009, exactly as written

`core/db/schema/009_prospect_archival.sql` — sha256
`f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d`, 10,397 bytes.
**Frozen from the moment it is applied anywhere**: `verifyChecksums` compares the recorded hash to
the file on disk, so even a comment edit afterwards reports drift.

```sql
ALTER TABLE prospects
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users(id);      -- NO ON DELETE clause

ALTER TABLE prospects ADD CONSTRAINT archival_has_provenance CHECK (
  (archived_at IS NULL) = (archived_by IS NULL)
);

CREATE INDEX prospects_org_active_idx ON prospects (organization_id)
  WHERE archived_at IS NULL;

GRANT UPDATE (archived_at, archived_by) ON prospects TO ascend_sales;

DROP POLICY prospects_update_sales ON prospects;
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING      (organization_id = current_org() AND identity_state = 'anchored'
              AND archived_at IS NULL)
  WITH CHECK (organization_id = current_org() AND identity_state = 'anchored');
```

Plus two `COMMENT ON COLUMN`s. `MIGRATIONS` in `core/db/migrate.ts` gains `009_prospect_archival.sql`.

**Decisions and why, each checked against the live schema rather than assumed:**

| Element | Decision | Reason |
|---|---|---|
| `archived_by` FK | **No `ON DELETE`** (NO ACTION) | `SET NULL` erases attribution on a surviving fact. Matches all five existing actor columns; 005 made users *disabled*, never deleted |
| Both columns | Nullable, no default | An unarchived row states nothing. A default would make a claim on 3,108 rows |
| `archival_has_provenance` | **Added** — was missing from the proposal | Mirrors `assessment_has_provenance`. Without it an anonymous archival is representable |
| Partial index | Included; **benefit not claimed** | At 3,108 rows the planner seq-scans. It is the index needed at 50,000, and it is cheap. Plain `CREATE INDEX`, since `applyMigrations` wraps migrations in a transaction and `CONCURRENTLY` cannot run in one |
| Sales grant | Exactly two columns | §3 proves it is sufficient |
| Automation | **Nothing** | No automated archival path exists; the absence is the mechanism |
| Owner | **Nothing needed** | Table-level UPDATE from 001 covers future columns |
| RLS | `USING` tightened, `WITH CHECK` **not** | §3, and probe M9 |

---

## 3 · RLS and grant proof

### The trap, confirmed by probe

Adding `archived_at IS NULL` to the sales `WITH CHECK` — the obvious tightening, and what a careless
reading of the D1a proposal would produce — makes archival **structurally impossible for sales**:
`USING` sees the old row and passes, `WITH CHECK` sees the new row where `archived_at` is now set and
refuses. **Probe M9 applies exactly that change and turns T2, T7 and A2 red.** The trap is pinned by
a test, not only described in prose.

### Privilege trace, verified against the database

| Requirement | Privilege | Source | Proven by |
|---|---|---|---|
| `SET archived_at`, `archived_by` | `UPDATE` (2 cols) | **009** | A2, A6 |
| `SET updated_at` | `UPDATE (updated_at)` | 001 | A2 |
| `WHERE archived_at IS NULL`, `RETURNING` | table `SELECT` | 001 | T2 |
| Row visible / admitted | `prospects_update_sales` | 009 | T2, A4 |
| Event append | `INSERT ON events` + sequence | 001 | T2 |

**Exactly two new grants**, asserted from `aclexplode` (A6):
`ascend_sales:archived_at`, `ascend_sales:archived_by` — and nothing else.

| Claim | Test | Result |
|---|---|---|
| Sales holds **no raw DELETE**; the notes cascade is unreachable | A1 | `permission denied` |
| Sales cannot write `website_quality`, `source`, `website`, `identity_state`, `prospect_id`, `hold_reason` | A2 | all refused |
| **Automation** cannot archive | A3 | `permission denied` |
| After archival sales cannot write the row; **owner still can** | A4 | 0 rows vs 1 row |
| Cross-org archival is invisible | A5 | 404, row untouched |
| `archival_has_provenance` refuses a half-stated archival **both ways** | M10 test | constraint error |

`core/recovery/restore.ts:322`'s standing `F12.sales-cannot-delete-prospects` check is unaffected and
must keep passing in D1b.2.

---

## 4 · Archive semantics

`archiveProspect` (`core/db/prospects.ts`) is a second verb over D1a's machinery — same resolver,
same compare-and-set shape, same read-back disambiguation, same typed outcomes.

```sql
UPDATE prospects SET archived_at = now(), archived_by = $2, updated_at = now()
 WHERE id = $1 AND archived_at IS NULL RETURNING archived_at
```

then `appendEvent('prospect.archived')` **in the caller's transaction** — so the row and the event
commit together or neither does. `prospect.archived` is new in `packages/domain/events.ts`, and is
deliberately *not* a weaker `prospect.deleted`: one says the record is gone, the other says the
business left the working list with everything kept.

| Outcome | HTTP | Event | Row |
|---|---|---|---|
| `archived` | 200 | appended | archived |
| `already_archived` | 200 | none | unchanged |
| `not_found` | 404 | none | — |
| `ambiguous` (+count) | 409 | none | unchanged |
| `held` | 409 | none | unchanged |
| `refused` | 409 | none | unchanged |
| `deleted` (vault) | 200 | `prospect.deleted` | file unlinked |

- **Identity** is the anchor, never the slug (T1).
- **Attribution** is the membership-resolved principal; a request body naming someone else changes
  nothing (T7, probe M4).
- **Retry** is idempotent: the first archiver and instant are kept, and exactly one event exists
  (T3). Zero rows is disambiguated by reading the row back, so an RLS refusal is reported as a
  refusal rather than read as success.
- **Held rows** are refused for **both** roles with `held_prospect` — the existing resolver refusal
  preserved, per owner decision 2, not a new policy (T4, T4b).
- `changed: {prospect, notes, events, vault}` is on **every** outcome including refusals.

---

## 5 · Active vs audit reader behaviour

`listProspects(tx, { includeArchived })` — **default excludes**. The direction is the risk posture: a
forgotten flag hides a row from a list (visible, recoverable) rather than putting an archived
prospect back in the operator's queue.

| Reader | Archived rows | Why |
|---|---|---|
| `core/crm.listProspects()` | **excluded** | the working surface — the behaviour change |
| `core/crm.getProspect()` | **included**, state exposed | decision 3: a direct link must not 404 on a record that exists |
| `listProspectSources()` (knowledge/graph/search) | excluded | left the working surface |
| **`core/intake/import.ts`** | **INCLUDED** | decision 4 — §6 |
| `findCorroborating` | **included, no opt-out** | identity matcher |
| `findByProspectId` | **included, no filter** | audit + the incomplete-promotion derivation |
| `resolveProspectForMutation` | included, archival state carried | must answer `already_archived`, not `not_found` (probe M13) |
| `findProspectRef` (notes) | included | notes stay readable |
| `listHeldProspects` | excluded | a work queue |
| raw-SQL readers (research, recovery, substrate-migration) | unchanged | correct as-is |

`Prospect.archivedAt` travels **beside** `frontmatter`, never inside it — a key present in one store
and absent in the other would register in the parity ledger as a business fact changing during
serialisation.

**Counts that will move** once anything is archived (all intended, none currently asserted against a
fixed number): `/sales`, `/partner`, pipeline funnel, revenue forecast, opportunities, automations,
operator brief, MC forecast, and graph/`search` node counts. Wikilinks to an archived prospect will
dangle — defensible, and flagged.

---

## 6 · Import archived-identity regression proof

The highest-risk reader, and the one that produced the most useful failure in this slice.

`core/intake/import.ts:93` is the identity matcher's universe. Under the new default it would have
silently become the **active** set, so an import row for an archived business would corroborate
nothing, be classified `new`, and **create a duplicate** — the "third Tapia record" failure arriving
through a default parameter. It now reads `listProspects(tx, { includeArchived: true })`.

**The test initially failed to pin it.** Probe M3 — pointing the matcher at the active-only reader —
left the suite **green**, because the test asserted `findCorroborating` and a universe it built
itself rather than running the importer. A test that reimplements the caller does not pin the caller.
It now drives the real `importSheet` with an archived fixture:

| Assertion | Result |
|---|---|
| outcome kind | `recorded` (not `projected`) |
| reason | **`matched`** |
| `refs` | the archived row's id |
| prospects created | **0** |
| active reader sees it | **no** — the contrast that makes the test meaningful |

Re-probed after the repair: **M3 now turns T8 red.**

---

## 7 · Concurrency mechanism

### The finding

D1a's compare-and-set guarded the status and the event — never the **client**. `promoteInPostgres`
ran as three steps: resolve (tx 1), find-or-create the client on the **filesystem**, mark (tx 2). The
client write sat outside both transactions, so two concurrent promotions both scanned for
`promoted_from_prospect_id`, both found nothing, and both created a client.

### Why the obvious fix is wrong

A **session-scoped** `pg_advisory_lock` fails here, and `core/db/pool.ts:31-37` says why: the
application endpoint is a **transaction pooler**, which "multiplexes transactions across backends, so
session-scoped state does not survive it". Such a lock could be taken on a backend the next
transaction never sees — failing to exclude anything *and* leaking, with no session left to release
it.

### What was implemented

`pg_advisory_xact_lock`, keyed on the **anchor**, over **one** transaction spanning the whole
critical section:

```
resolve → LOCK(anchor) → re-check under the lock → find-or-create client → mark → COMMIT
```

The pooler pins a backend for a transaction's duration, and the lock is released by COMMIT or
ROLLBACK — including a crashed request's. A leaked lock is not representable. Key derivation uses
only documented functions (`md5 → bit(32) → int`), not the internal `hashtext`.

**The cost, stated:** the transaction now spans the client's filesystem write — four small files and
a rename. The pre-flight rejected this option as a pool hazard; the pooler finding **reverses that
judgement**, because a transaction is the only unit that gives a stable backend. At one production
user it is not a contention concern.

---

## 8 · Concurrent promotion result — the D1a hole, measured

Real PostgreSQL **17.6** (production's version), real connection pool, one backend per request.

**The harness proves its own credentials first**, because a green suite that never raced would be the
most expensive kind of false evidence:

| Harness check | Result |
|---|---|
| `server_version` | **17.6** |
| `listen_addresses` / `inet_server_addr()` | `''` / NULL — Unix socket only, no TCP |
| 8 concurrent leases → distinct `pg_backend_pid()` | **8 distinct backends** |
| two backends blocking on one row | second UPDATE started before the first committed, and could not finish until it did |

| Test | Result |
|---|---|
| T13 · 2 simultaneous promotions, different requested slugs | **1 client**, **1** `prospect.promoted`, both callers converge on that client, outcomes `promoted` + `already_promoted` |
| T13 · 6 simultaneous promotions, 6 different slugs | **1 client**, **1** event, 1 `promoted` + 5 `already_promoted`, every caller names the one client that exists |

### Removing the transaction lock REPRODUCES the original defect — recorded explicitly

**Probe M11**, run against the same real 17.6 server, with only `lockProspect` removed:

| Concurrent promotions of one prospect | Lock held (shipped) | **Lock removed (M11)** |
|---|---|---|
| 2, different requested client slugs | **1 client**, 1 `prospect.promoted` | **2 clients** (`race-client-a`, `race-client-b`) |
| 6, six different requested slugs | **1 client**, 1 `prospect.promoted` | **6 clients** |

So the defect is not hypothetical and the lock is not precautionary: **the number of clients created
equals the number of concurrent callers when the lock is absent, and is exactly one when it is
held.** The pre-flight argued this from the code; this measures it against production's server
version. It is the reason invariants 7–10 in §0 are permanent.

---

## 9 · Concurrent archive result

| Test | Result |
|---|---|
| T12 · **8** simultaneous archives | exactly **1** `archived` + **7** `already_archived`, all 200; **one** `archived_at` transition; **exactly one** `prospect.archived`; `archived_by` = the first archiver; notes count unchanged |

No lock is needed here and none is used: archival never leaves the database, so the row lock plus
`WHERE archived_at IS NULL` (re-evaluated by EvalPlanQual) is sufficient. **Probe M1** — removing that
predicate — turns T3 red.

**T14b · a note appended *during* an archival** lands, attached and readable, no deadlock: the FK
takes `KEY SHARE`, the archival `FOR NO KEY UPDATE`, and they are compatible.

---

## 10 · Promotion/archive race — defined and proven semantics

Repeated **six times**, because which side wins is genuinely nondeterministic and asserting one
ordering would only prove whichever happened that day.

**Defined semantics.** Archival has no precondition on status, so it always succeeds. Promotion wins
only if it commits first.

| Case | Guaranteed |
|---|---|
| Promotion commits first | `status = closed-won`, **1** client, **1** `prospect.promoted`, then archived. A won deal that was later archived — coherent |
| Archival commits first | promotion **never** marks the row, appends **no** event, and **never** reports `promoted`. It reports `refused` (`archived_prospect`) or `incomplete` |
| Always | never both archived and newly won; **≤1** client; **exactly 1** `prospect.archived`; notes intact |

`incomplete` is reachable and permitted: promotion may have staged a client before the archival
committed. That is D1a's existing honest partial state, and §2.4 of the contract requires the
reconciliation query to include archived rows or it becomes invisible.

**Two guards, and an honest distinction between them.** The load-bearing one is the **re-check under
the lock** (probe M12d → T15 red). The `archived_at IS NULL` predicate on promotion's compare-and-set
is **defence in depth**: probe M12 removes it and **nothing turns red**, because the lock leaves no
window for it to guard. It is kept — it is the guard that survives if the lock is ever narrowed — and
M12 is recorded below as NOT CAUGHT rather than counted as a pass.

---

## 11 · Notes and history proof

| Artifact | Mechanism | Result |
|---|---|---|
| `prospect_notes` rows | `ON DELETE CASCADE` never fires — archival is an UPDATE | count unchanged; still returned by `listProspectNotes` (T5/T6) |
| `prospects.notes` body | column on a surviving row | byte-identical (T5/T6) |
| Prior events | append-only by trigger | **nothing removed**, exactly one added (T5/T6) |
| Identity anchor | never nulled | `findByProspectId` still resolves it (T5/T6, T9) |
| Client back-reference | points at the anchor | still resolves |
| Under concurrency | — | notes intact in T12 and all six T14 iterations |

**Probe M8** — grant sales DELETE and hard-delete instead of archiving — turns **6 tests** red,
including the notes assertions. The cascade is a real, reachable failure, and the tests see it.

---

## 12 · UI changes (owner decision 1)

`components/DeleteProspectButton.tsx` → **`components/ArchiveProspectButton.tsx`** (git mv, consumer
updated).

| | Before | After |
|---|---|---|
| Label | `Delete` | **`Archive`** |
| Variant | `danger` | **`quiet`** / `primary` on confirm |
| Title | "Remove this prospect from the hit list" | "Remove from the hit list. Notes and history are kept." |
| Confirm | "Delete {name}?" | "Archive {name}? Its notes and history are kept." |
| Accepts | `outcome === "deleted"` | `archived` \| `already_archived` \| `deleted` |

`already_archived` is treated as **success** — it is the idempotent repeat, and showing it as an error
would make a retry after a dropped connection read as a failure.

`app/sales/[prospect]/page.tsx`: an archived prospect shows an **Archived** status chip, and the
Promote and Archive actions are **not offered**. The server refuses both anyway, so this is the UI
agreeing with the server rather than a second, weaker gate in front of it.

No "Delete" remains in the ordinary sales workflow. Hard deletion is not reachable from any surface.

---

## 13 · Tests and mutation probes

| Suite | Tests |
|---|---|
| `tests/db/d1-archival.test.ts` (new) | **22** |
| `tests/db/d1-concurrency.test.ts` (new, real 17.6) | **8** |
| `tests/db/d1-promotion.test.ts` (D1a, deletion block rewritten to archival) | 19 |

`tests/db/pglite.ts` gains 009 — its own header predicted it ("this one is the one that can fall
behind"), and every reader now carries the active-set predicate.

### Mutation probes

| # | Probe | Caught by | Result |
|---|---|---|---|
| M1 | remove the archival compare-and-set predicate | T3 | ✅ *after repair* |
| M2 | canonical reader stops excluding archived rows | T8 ×2, T10 | ✅ |
| M3 | import matcher uses the active-only universe | T8 | ✅ *after repair* |
| M4 | attribution from somewhere other than the principal | T2, T7 | ✅ |
| M5 | append the event before the update | T1, T2, T3, T5/T6 | ✅ |
| M7 | sales gets table-level UPDATE | A2, A6 | ✅ |
| M8 | grant sales DELETE and hard-delete | 6 tests incl. notes | ✅ |
| M9 | `archived_at IS NULL` added to the sales `WITH CHECK` | T2, T7, A2 | ✅ |
| M10 | drop `archival_has_provenance` | M10 test | ✅ |
| M11 | remove the advisory lock | T13 ×2 (**2→2 clients, 6→6 clients**) | ✅ |
| M12 | drop `archived_at IS NULL` from promotion's CAS | — | ❌ **NOT CAUGHT** — redundant while the lock holds (§10) |
| M12d | remove the under-lock archived re-check | T15 | ✅ |
| M13 | resolver reports archived rows as `not_found` | T3, T15 | ✅ |

### The mutation score is 12 / 13, and stays 12 / 13

**M12 is NOT caught, and is not to be relabelled as caught.** Recorded precisely, per owner
instruction:

- The **under-lock state re-check is load-bearing**, and its removal **is** caught (M12d → T15 red).
- The **final compare-and-set predicate is redundant while the advisory lock is correctly held** —
  the lock leaves no window between the re-check and the UPDATE for it to guard.
- The predicate **remains, as defence in depth**: it is the guard that still holds if the lock is
  ever removed or its critical section narrowed.
- **No test claims that predicate is independently required under the present locking contract**,
  and none should be added to make this read 13/13. A test manufactured to fail against a redundant
  safeguard would assert something untrue about the system, which is worse than an honest 12/13.

The same reasoning is written into `core/db/prospects.ts` beside the predicate itself, so the next
reader meets it there rather than inferring that it is load-bearing.

**Two probes beat the tests first**, and both produced real repairs — the same discipline that found
D1a's M6b:

1. **M1** passed because T3's only retry was as *sales*, whose RLS `USING` predicate already excludes
   archived rows — so RLS was silently doing the work the assertion credited to the compare-and-set.
   Fixed by retrying as the **owner**, who holds `FOR ALL` and is therefore stopped by the CAS and
   nothing else.
2. **M3** passed because T8 reimplemented the matcher instead of running it. Fixed by driving the
   real `importSheet`.

---

## 14 · Final gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| `eslint` (changed files) | **clean** |
| `gate:db` | **496 passed**, 199 skipped (was 466 in D1a: +30) |
| `gate:static` | **1,818 passed**, 9 skipped, **1 failed** — the pre-existing fail-closed environment check for suites needing absent production/recovery variables, unchanged by D1b.1 |
| `gate:server` | 3 passed, 5 skipped |

`gate:db` and `gate:static` were run with `ASCEND_PG17_BIN` set; without it
`tests/db/d1-concurrency.test.ts` **fails closed** with an explicit message and does not fall back to
PGlite. It is registered in `tests/architecture/gate-2g1.ts` with `requires: ["ASCEND_PG17_BIN"]`.

**Working-tree note:** `.next/types/*` contained iCloud-duplicated `… 2.ts` build artifacts that
faked a typecheck failure. They are generated output and were removed; no source file was affected.

### The PostgreSQL 17.6 build root — **keep this for D1b.2**

| | |
|---|---|
| Root | `/Users/oscar/AscendPg17` (mode 0700, outside the repo, outside iCloud) |
| Binaries | `/Users/oscar/AscendPg17/pg17/bin` — set `ASCEND_PG17_BIN` to this |
| Version | `postgres (PostgreSQL) 17.6` — production's version |
| Source | `https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2`, 21,623,975 bytes |
| Source SHA-256 | `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0` — equal to the published `.sha256` **and** to the value R1c recorded |
| `bin/postgres` SHA-256 | `ba83fff9cbbc813c500d29ef78dfc53ea911f6c7333e30e5797454addd6e34c7` |
| Build | `./configure --prefix=$ROOT/pg17 --without-icu --without-readline --with-zlib`, `make world-bin`, `make install-world-bin`, all in `env -i` |
| Size | 35 MB |

No Homebrew PostgreSQL was installed. No persistent service runs; clusters are created per test run,
Unix-socket-only with `listen_addresses = ''`, and destroyed afterwards. **The root is retained** so
D1b.2's R1c same-version re-proof reuses it instead of recompiling (`ASCEND_R1C_ROOT` expects
`<root>/pg17/bin`, which this layout already satisfies).

---

## 15 · The exact D1b.2 runbook

**Do not begin until D1b.1 is accepted and committed.** D1b.1 must **not be deployed** before 009 is
applied: the application would query columns that do not exist.

### Preconditions

1. D1b.1 accepted and committed; `009_prospect_archival.sql` **unmodified** (sha256
   `f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d`) — `verifyChecksums` reports
   drift on any edit after application.
2. Re-run the §1 aggregate. **If `ledger_head` is not `008_prospect_notes_log.sql`, STOP** (R1 A5).
3. `ASCEND_PG17_BIN` / `ASCEND_R1C_ROOT` → `/Users/oscar/AscendPg17`; confirm `bin/postgres` still
   reports 17.6 and matches the recorded hash.
4. Confirm `~/AscendBackups` exists, mode 0700, and the keyring is available.

### Step 1 — apply 009 to production

- Over the **direct** endpoint (`ASCEND_DATABASE_URL_DIRECT`), never the pooler: this is DDL.
- `applyMigrations` wraps it in one transaction; the `ALTER TABLE` and the policy swap take
  `ACCESS EXCLUSIVE` on `prospects` for a sub-millisecond window at 3,108 rows.
- The ledger row records `applied_at_is_backfilled = false` — 009 is applied live and witnessed.

### Step 2 — verify the migration in place (read-only)

| Check | Expected |
|---|---|
| `ledger_head` | `009_prospect_archival.sql`; `ledger_rows` = 9 |
| `verifyChecksums` | no drift |
| `archive_cols_present` | 2 |
| `archived_at IS NOT NULL` count | **0** — 009 backfills nothing |
| `prospects_org_active_idx` | present, valid |
| `archival_has_provenance` | present |
| `prospects_update_sales` | `USING` carries `archived_at IS NULL`; `WITH CHECK` does **not** |
| column grants | exactly `ascend_sales` × `archived_at`, `archived_by` |
| `DELETE FROM prospects` as `ascend_sales` | refused |

### Step 3 — first real archival (only if the owner wants it)

Optional and owner-gated. If taken: archive **one** prospect the owner names, then verify the row,
the single `prospect.archived` event, the unchanged note count, and its absence from `/sales`. Not
required for the recovery proof.

### Step 4 — new encrypted production recovery artifact

- `scripts/backup-production.sh` against the direct endpoint, read-only (`pg_dump` takes only
  `ACCESS SHARE`). Any write, DDL, or RLS error **aborts** (R1 A4/A6).
- Artifact lands in `~/AscendBackups` only (A8); verify `SHA256SUMS`.
- It contains credential hashes and PII — labelled as such, as R1a established.
- **The pre-009 artifact is not deleted**; it remains a valid recovery point for pre-009 production.
  It must **not** be presented as current.

### Step 5 — full R1b re-proof (PGlite)

`tests/db/restore-independence.test.ts` against the **new** artifact, F1–F18 with zero skips.
Expected to differ from the pre-009 manifest at exactly:

| Key | Change |
|---|---|
| `F2.columns.count` | **+2** |
| `F2.columns.digest` | changes |
| `F4.digest.prospects` | **changes even with zero archived rows** — F4 digests `t::text`, the whole-row rendering, which gains two empty fields for all 3,108 rows |
| `F4.held.digest` | changes (same mechanism, 2 rows) |
| `F5.constraints.count/.digest` | **+1** (`archival_has_provenance`) |
| `F5.indexes.count/.digest` | **+1** (`prospects_org_active_idx`) |
| `F11.policies.count` | unchanged (drop + create, same name) |
| `F11.policies.digest` | changes (the `USING` expression) |
| `F13.grants.columns.count/.digest` | **+2** |
| `F17.ledger` | gains 009 + checksum |
| `F18` | new artifact checksum |
| everything else (F1, F3, F6–F10, F14–F16) | **unchanged** |

**`manifest.sql` itself needs no edit.** It is catalog-driven, so F1–F18 require **no semantic
change** — only the expected values move, and production produces those at dump time.

`F4.digest.prospects` changing with zero archived rows is the one that looks like data corruption to
anyone comparing across the migration. Note it in the runbook before the proof runs.

### Step 6 — full two-leg R1c re-proof (real 17.6)

`tests/db/restore-same-version.test.ts` against the new artifact, on the retained build root, **both
legs** — the portable-SQL `restoreInto` and the runbook's `pg_restore -L` with exactly four TOC
entries skipped — each F1–F18 key-for-key, plus the read-only application proof as `ascend_app`.

**Not narrowed.** Keeping the pre-009 R1c entry green would relabel evidence about artifact *N* as
evidence about *N+1*, which R1 abort condition A10 forbids.

### Step 7 — records

- `docs/DEPENDENCY-R1B-CHECKPOINT.md`, `docs/DEPENDENCY-R1C-CHECKPOINT.md`: new artifact timestamp,
  ledger head 009, counts, checksum, proof date.
- `docs/RECOVERY-RUNBOOK.md` and `scripts/RESTORE.template.md`: ledger head, row counts, last proven
  restore **date**.
- `docs/ASCEND-OS-V1-COMPLETION-MAP.md`: D1 complete.
- `docs/DEPENDENCY-D1B2-CHECKPOINT.md`.

### Abort conditions

Stop and report — do not improvise — if: ledger head ≠ 008 at step 1; `verifyChecksums` reports
drift; the migration needs more than one transaction; `pg_dump` shows any write, DDL or RLS error;
a fidelity check would require printing a hash, token, password, env value or PII row; any F-key
differs **beyond** the table above; or a proof would have to be reclassified to pass.

---

## 16 · Owner decisions applied

| # | Decision | Where |
|---|---|---|
| 1 | Archive, not Delete, throughout the sales workflow | §12 |
| 2 | Sales may not archive held rows; existing refusal preserved, not reinvented | §4, T4/T4b |
| 3 | Archived rows excluded from the active reader, retrievable by audit/history/direct id | §5 |
| 4 | Import matcher must treat archived prospects as existing identities, with a regression test | §6 |
| 5 | Concurrency guard keyed by `prospect_id` across the full critical section | §7, §8 |
| 6 | Same harness for archive concurrency and the promotion/archive race | §9, §10 |
| 7 | Migration 009 in the preflight-corrected shape | §2, §3 |
| 8 | One read-only production aggregate; stop unless ledger head is 008 | §1 |
| 9 | No grandfathering; full R1b and two-leg R1c after 009 | §15 |
| 10 | D1b.1 local only; no production mutation; 009 unapplied | header, §1 |

---

## 17 · Carried debt

1. **Sales-side archival is unexercised in production** — `users_total = 1`, so the sales partner
   does not exist there yet. Proven in the fixture against the real `ascend_sales` role.
2. **Probe M12 is not caught** (§10) — a documented redundant safeguard, not a missing test.
3. **Un-archival has no verb.** Sales cannot reverse an archival by construction; the owner retains
   `FOR ALL` and can correct one directly. A first-class un-archive with its own event would be its
   own slice.
4. Deferred with reasons stated, not silently: hard deletion as an admin capability; bulk archival;
   the `prospects` table-grant refactor (§4.3 of the contract); the automation-policy tightening;
   the raw-SQL-reader fitness rule; URL-intake porting; the `PromoteButton` `"growth"` default.

---

**STOPPING BEFORE COMMIT FOR OWNER ACCEPTANCE.**
