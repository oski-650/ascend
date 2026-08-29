# Stage 2C — Prospect Source-of-Truth Flip

**Status: PREPARED, NOT FLIPPED.** Steps 3-5 complete; the flip itself remains blocked on a production database. Two prerequisites were found by the consumer inventory, one of them a defect in Stage 2B's own verification. Both are now fixed; a third — no production database exists — is outside my reach.

Per the standing rule: **an unmet precondition is a result.**

---

## 1. The rule this stage exists to serve

> **Never scale an importer while the system has two competing sources of truth.**

Recorded here as a standing rule, not a stage note. The reason is diagnostic, not aesthetic: with two stores live, every subsequent bug becomes ambiguous — importer, vault writer, migration, graph reader, matcher or reconciler — and no test tells you which.

---

## 2. Consumer inventory

Traced mechanically. **Ten consumers, not nine** — the count I gave in Stage 2A was short by one, and the one it missed is the one that breaks requirement 3.

### 2.1 Through `core/crm` (the canonical seam)

| # | consumer | via | reads |
|---|---|---|---|
| 1 | `app/sales/page.tsx` | `lib/sales` | `listProspects` |
| 2 | `app/sales/[prospect]/page.tsx` | `lib/sales` | `getProspect` + **`.body`** |
| 3 | `lib/automations.ts` | `lib/sales` | `listProspects` |
| 4 | `lib/opportunities.ts` | `lib/sales` | `listProspects` |
| 5 | `lib/forecast.ts` | `lib/sales` | `listProspects` |
| 6 | `lib/compileOperatorBrief.ts` | `lib/sales` | `listProspects` |
| 7 | `mission-control/pipeline.ts` | `@/core/crm` | `listProspects` |
| 8 | `mission-control/forecast.ts` | `lib/sales` | `listProspects` |
| 9 | `graph-view/projection.ts` | `@/core/crm` | `listProspects` |
| 10 | `core/crm/promote.ts` | internal | `getProspect` |
| — | `lib/compileTargetContext.ts` | receives a `Prospect` | **`.body`** |

**Nine of these flip by changing one function.** F15's canonical-reader discipline is what makes that true, and it is the single largest reason this flip is tractable at all.

### 2.2 NOT through `core/crm` — the blocker

| consumer | reads | problem |
|---|---|---|
| **`core/knowledge/index.ts:37`** | `hitListDir()` + `listMarkdownFiles` **directly** | feeds `buildKnowledgeIndex` → the graph and `/search`. It would keep reading Obsidian after the flip — **a silent fallback to the vault, which requirement 3 prohibits.** |

### 2.3 Writers and observers (not readers, but they hold the vault open)

`core/crm/prospect.ts` (vault writer) · `app/api/import/prospects/route.ts` · `app/api/prospects/from-url/route.ts` · `app/api/prospects/[slug]/route.ts` (delete; an existing F21 exemption) · `core/reconciler/observation.ts` (`observeProspects`) · `core/vault/identity.ts` · `identity-backfill/` · `substrate-migration/`.

---

## 3. What the inventory found — and why it matters more than the flip

### 3.1 Stage 2B was silently dropping every prospect's notes

`Prospect.body` — the call log, objections and friction notes — is consumed in two places:

```text
app/sales/[prospect]/page.tsx:246   renders it
lib/compileTargetContext.ts:27      uses it as AI context
```

**The database had no column for it, the migration never carried it, and the behavioural ledger never compared it.** So Stage 2B reported parity while the operator's own qualitative notes were being deleted — invisible to a row count, invisible to a field diff, invisible to the ledger *as scoped*.

Flipping reads would have made that loss live.

**The lesson is not "add a column."** It is that a parity ledger is only as good as its consumer inventory, and the inventory has to come from tracing consumers rather than from listing what the schema happens to hold. Requiring the inventory as a deliverable — rather than trusting the tests — is what surfaced it.

**Fixed:** `003_prospect_notes.sql` adds `notes`, carried verbatim end-to-end (plan → apply → ledger → check 8), withheld from `ascend_automation`'s grant because prose in the operator's voice is not a research finding. A mutation gate now proves the extended ledger catches exactly this: counts and identities pass, checks 8 and 12 fail.

### 3.2 `core/knowledge` would have become a silent vault fallback

It reads the hit list directly, bypassing `core/crm` entirely. After a flip it would serve the graph and search from Obsidian while everything else read Postgres — two sources of truth, with nothing reporting the disagreement.

**Not yet fixed.** It needs to move behind the same seam, and that is flip work, not repair work.

---

## 4. The fourteen requirements

| # | requirement | status |
|---|---|---|
| 1 | every production prospect reader identified | ✅ §2 — ten, plus writers/observers |
| 2 | every reader reads Postgres | ⛔ **blocked** — no production database |
| 3 | no reader silently falls back to Obsidian | ⛔ **blocked** — `core/knowledge` (§3.2) |
| 4 | the six produce equivalent behaviour | ✅ proven, and now includes the body |
| 5 | the Tapia holds remain blocking/matchable | ✅ gate 3 |
| 6 | prospect ids stable | ✅ gate 2 |
| 7 | scores identical | ✅ gates 8, 12 |
| 8 | graph behaviour equivalent | ⚠️ **unproven** — depends on §3.2 |
| 9 | event behaviour equivalent | ✅ gates 4, 5, 6 |
| 10 | no new events from the flip | ✅ structurally — the flip writes nothing |
| 11 | no vault record modified | ✅ gate 11 |
| 12 | the vault writer retired or reduced to compatibility | ⛔ blocked on 2 |
| 13 | F21/F29 enforce ONE operational writer | ⛔ blocked on 12 — the exemption still records two, correctly |
| 14 | rollback procedure exists | ✅ §6 |

**Nine met, four blocked, one unproven.** The blocked four all reduce to two causes: no database, and one unmigrated consumer.

---

## 5. What must happen before the flip

1. **Provision Postgres and run 001–003.** Needs your account; I cannot do it.
2. **Close the pooled-connection gap** (carried from 2A). `asPrincipal` uses `SET LOCAL` so a pooled connection cannot leak identity between requests; PGlite is single-connection and cannot prove it. **This is a security property and must be proven before deployment.**
3. **Move `core/knowledge` behind the seam**, or scope it explicitly to vault-only entities with a rule asserting it reads no prospects.
4. **Re-run the 2B migration** — the existing plan predates the `notes` column.
5. **Create Oscar's `UserId`** — the schema refuses an unattributed operator event.

---

## 6. Rollback procedure

The flip is a **read-path change only**; no data is written and no vault file is touched.

```text
FORWARD   source resolution → postgres
ROLLBACK  source resolution → vault
```

The vault prospect files remain byte-identical throughout and are never deleted by the flip, so rollback restores the previous reader path **without touching migrated data**. The Postgres rows are left in place — they are not authoritative while the vault is selected, and re-flipping forward requires only re-running verification.

**Rollback is invalidated the moment a write lands in Postgres that has no vault equivalent** — the first Sheets import. That is the real point of no return, and it is why the flip must be proven before 2D rather than during it.

---

## 7. Design decision recorded: fail closed, never fall back

When the flip is built, source resolution must be **explicit and fail-closed**:

```text
ASCEND_PROSPECT_SOURCE=vault      → vault readers
ASCEND_PROSPECT_SOURCE=postgres   → Postgres readers
unset                             → REFUSE TO START
postgres + no connection          → THROW, never degrade to vault
```

A fallback would be a silent second source of truth — the precise failure this stage exists to prevent, reintroduced by the mechanism meant to prevent it.

---

## 8. Verification of the repair

```text
tsc            clean
tests          764 passed · 9 skipped · 33 files      (was 762)
  2B gates       23 — now including the dropped-body mutation
lint           0 errors, 7 warnings — all pre-existing
live vault     UNTOUCHED — 8 files, 4 anchored, 2 held
production DB  still none
```

---

## 9. Recommendation

**Do not flip yet, and do not start 2D.**

The next action is not code: provision the database, then re-run the 2B migration with `notes` included and verify against it. The flip becomes a small, reviewable change once §5 is closed — and §3.1 is the argument for closing it in that order rather than discovering the next missing column with 600 rows already imported.


---

# Addendum — steps 3, 4 and 5

## A. What the rule caught that the hand inventory did not

The hand inventory found ten consumers and one bypass (`core/knowledge`). Encoding the rule as **F43** found **two more on its first run**:

| module | verdict |
|---|---|
| `core/crm/promote.ts` | legitimate **writer** — marks the prospect closed-won. Added to the declared storage owners. |
| `lib/compileOpportunityBrief.ts` | **an eleventh consumer**, opening `hitListDir()` with its own `gray-matter` parse |

So the true count is **eleven consumers**, and two of them bypassed the canonical reader. That is the argument for the rule rather than for a more careful inventory: I read the codebase twice and missed one both times.

Both now go through `core/crm`. F43 fails if a twelfth appears.

## B. Consumer-output parity — the replacement for row parity

`tests/db/consumer-parity.test.ts` runs the **real producers** against each store and compares what they emit: the canonical reader and its ordering, the detail page's inputs, the automations matcher, opportunity detection, the forecast, the operator brief, the pipeline digest, the graph projection, the knowledge index, and `compileTargetContext`.

A field nobody reads cannot fail it. A field somebody reads cannot escape it.

## C. Two more defects, both found by comparing RAW instead of normalised

**C.1 — Empty strings were being collapsed to NULL.** The vault holds `contact_email: ""`; the migration ran every value through `norm()`, which turns `""` into null. **And the 2B ledger normalised *both sides* with the same function, so the comparison agreed with itself and reported parity.**

> A ledger that normalises before comparing proves NORMALISED parity, not behavioural parity.

That is the missing-body lesson one layer down. Values are now carried **raw**; `""` survives the round trip.

**C.2 — Two fields genuinely cannot round-trip, and the inventory settled it.** `first_contact` / `last_contact` are `date` columns and Postgres will not store `""` in one. Rather than pick by taste, all three consumers were traced:

```text
lib/opportunities.ts:211    daysSince(v) → if (!iso) return null    "" and undefined both → null
lib/compileTargetContext    fmtScalar(v) → "—" for undefined AND for a zero-length string
app/sales/[prospect]        FactRow — both falsy, both render identically
```

Behaviourally indistinguishable, so the collapse is safe. It is declared as `EMPTY_EQUALS_ABSENT`, limited to those two fields, and every other field is still compared raw.

**C.3 — One of my own assertions was vacuous.** The knowledge-index comparison filtered `idx.nodes` on `.type`, but the indexer has its own `GraphNode` shaped `{ id, entity, title }` — that filter matched nothing and a third of the comparison did no work. `tsc` caught it; it compares real nodes now.

## D. The seam

`core/crm/source.ts` — one place decides the store, and it is **fail-closed in the dangerous direction**:

```text
unset                      → vault      (a statement of what IS authoritative, not a fallback)
=vault / =postgres         → that store
postgres, no connection    → THROW
anything else              → THROW      (a typo may not select a store)
```

`core/knowledge` and `compileOpportunityBrief` now consume `listProspectSources()` / `getProspect()`. **The default is unchanged: the vault is still authoritative and nothing was flipped.**

## E. Status of the fourteen

1 ✅ (eleven, not ten) · 2 ⛔ no database · 3 ✅ **no bypass remains, F43-enforced** · 4 ✅ consumer-output parity · 5 ✅ · 6 ✅ · 7 ✅ · 8 ✅ **now proven** (graph + knowledge index) · 9 ✅ · 10 ✅ · 11 ✅ · 12 ⛔ blocked on 2 · 13 ⛔ blocked on 12 · 14 ✅

**Eleven met, three blocked** — all three on the same cause: no production database.

## F. Verification

```text
tests   782 passed · 9 skipped · 34 files   (was 764)
        14 consumer-parity gates · F43 · 140 fitness
tsc     clean       lint 0 errors      build clean
vault   UNTOUCHED   ASCEND_PROSPECT_SOURCE unset → vault
```
