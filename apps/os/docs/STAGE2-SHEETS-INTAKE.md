# Stage 2 — Sheets Intake, Research, and the Sales Workspace

**Status: contract. No code, no vault changes.** Written before implementation, on the H8 §7 pattern: decide the shape while it is still free, then build to it.

Prerequisites: [STAGE1-PROSPECT-IDENTITY.md](./STAGE1-PROSPECT-IDENTITY.md) (applied — 4 anchored, 2 held), [STAGE1-GATING.md](./STAGE1-GATING.md) (P1–P4).

> **What does it take to let 600 businesses enter Ascend without any of them arriving as a fact nobody established?**

---

## 0. The separation everything else follows from

```text
THE SHEET SAID        a repository fact. verbatim, immutable, attributable to a batch.
ASCEND FOUND          an external-system fact. evidence-bearing, append-only, re-runnable.
A HUMAN JUDGED        an operator fact. no automated writer, ever.
```

Three authors, three stores, three write rules. They are never merged into one field, because the moment they are, the system can no longer say which of the three it is looking at — and that is the failure the entire H-series was spent removing.

Two invariants carried in from Stage 1 govern the rest:

> **A hold is a write barrier, not an information barrier.**
> **Absence is not evidence of absence.**

---

## 1. Google Sheets ingestion

### 1.1 CSV export, not the Sheets API

Decided, for V1. The existing `app/api/import/prospects` route already does paste → column map → dry run → write, and its dry-run-first discipline is the right shape.

| | CSV export | Sheets API |
|---|---|---|
| snapshot semantics | inherent — you imported *this file*, hashable | must be constructed; "what did the sheet say then?" is otherwise unanswerable |
| failure mode | the operator sees the file they pasted | silent drift; a sheet edited mid-run is an unreproducible import |
| write-back risk | none, one-way by construction | one small step away, and it makes the sheet a competing authority |

**If live Sheets is added later it stays strictly one-directional and still materialises an immutable snapshot per run.** The OS is the source of truth; a sheet the OS writes into is a second one.

### 1.2 Batch identity

An import is a first-class thing, not a transient action.

```text
ImportBatch = {
  batch_id        ULID/UUIDv7, minted once
  label           operator-supplied, e.g. "Print Shop Prospect List"
  source_kind     "csv_paste" | "csv_upload"
  source_name     the filename or sheet name as given
  file_sha256     hash of the exact bytes imported
  row_count
  column_map      the exact mapping used, stored with the batch
  imported_at
  actor           "system", always (D-3)
}
```

Stored append-only. Re-importing the same bytes produces a **new batch** with the same `file_sha256` — that is a fact worth recording, not a duplicate to suppress.

> **AMENDED 2026-09-02 (§7.3(c)) — the STORE changed, the SHAPE did not.** This read *"stored append-only in `.ascend-os/import_batches.jsonl`"*. The batch is now an append-only EVENT on the existing Postgres spine, with `batch_id` carried as the event's `correlation_id`. Every field above is unchanged, and `actor: "system", always (D-3)` is now enforced rather than asserted: the `events` table's own CHECK requires a system event to name no human.

### 1.3 Preservation of the original value

Every row is stored verbatim, as an append-only event correlated to its batch:

```text
SourceRow = { row_id, batch_id, row_index, prospect_id | null, cells: Record<string,string> }
```

**Verbatim means verbatim.** No trimming, no case folding, no type coercion, no dropped empties, no header normalisation. `prospect_id` is null when the row did not result in a prospect (blocked, ambiguous, client-matched) — the row is still kept, because "we received this row and did not act on it" is exactly the fact a reviewer needs.

Frontmatter is the wrong home for 40 arbitrary columns: it would bury the fields the reconciler reads and move `contentFingerprint` on every import.

> **AMENDED 2026-09-02 (§7.3(c)).** This specified `.ascend-os/prospect_source_rows.jsonl`. The rows are now append-only events, `data` carrying the verbatim `cells` and `correlation_id` carrying the `batch_id`. **VERBATIM STILL MEANS VERBATIM** — no trimming, no case folding, no coercion, no dropped empties, no header normalisation — and §1.4's three blank-cell states are unaffected. The argument above for keeping rows out of frontmatter argues for this outcome; the store is now one the database makes append-only by GRANT rather than by convention.

### 1.4 Blank-cell semantics

Three distinct states, and collapsing any two is the D-1/D-2 failure returning:

| sheet state | source row | prospect |
|---|---|---|
| column absent from the sheet | key absent from `cells` | field not written |
| column present, cell empty | `cells[col] === ""` | **field not written** |
| column present, cell has a value | `cells[col] === value` | field written |

> **An empty cell is a fact about the sheet, never a value on the prospect.**

`""` in a website column means *the sheet had a website column and left it blank*. It does **not** mean the business has no website, and it must never reach `website_quality: none`.

---

## 2. Identity matching

### 2.1 The five outcomes

Evaluated in this order. Order is the safety argument.

| # | outcome | condition | action |
|---|---|---|---|
| 1 | `blocked` | corroborates a **held** prospect | create nothing; name the blocker |
| 2 | `client_match` | corroborates an existing **client** | create nothing; report for linking |
| 3 | `matched` | corroborates exactly one **anchored** prospect | update that prospect's source row |
| 4 | `ambiguous` | corroborates two or more anchored prospects | create nothing; human review |
| 5 | `new` | corroborates nothing | create a prospect, mint an anchor |

**`blocked` is first, and it is the clause that will be under pressure.** It exists because a held prospect is invisible to assignment but must remain visible to matching:

```text
sheet row: "Tapia Tile & Marble", tapiatilemarbleco.com, 650-364-8038
  → corroborates BOTH held Tapia records
    → BLOCKED, blockers named
      → NOT "no anchored match found, therefore new"
```

Collapsing `blocked` into `new` creates a third Tapia record — the quarantine manufacturing the duplicate it exists to prevent. This is P4 from STAGE1-GATING, and it is the single most important line in this document.

### 2.2 What "corroborates" means

The same rule the research engine uses (§3.3), applied to a sheet row against a stored record. Reuses `findDuplicateCandidates`' normalisers — one definition of what a duplicate is, not two.

| signal | strength |
|---|---|
| normalised website host+path match | strong |
| phone match (last 10 digits) | strong |
| email match | strong |
| normalised name match **alone** | **not sufficient** — dozens of businesses share one |
| name + locality | strong |

`prospect_id` present in the sheet (from a prior export) is not corroboration — it is **identity**, and it short-circuits to `matched` without further evidence.

### 2.3 Clients participate as read-only blockers

The matcher reads `01 - CRM & Clients` as well. A row corroborating `tapia-tile-marble` (the client) must not become a prospect — the business is already further down the funnel. `client_match` reports it; **linking a prospect to a client stays `core/crm/promote.ts`'s job and is never done by an importer.**

### 2.4 Never

- never choose between two Tapia records
- never treat the Tapia *client* as proof that either prospect is the same record
- never merge, delete or rename
- never use the slug as a substitute for a missing `prospect_id`

---

## 3. Research engine

### 3.1 Deterministic, and F12 stays closed — see §8

### 3.2 Candidate discovery, and its honest ceiling

| source | available | note |
|---|---|---|
| the sheet's own website column | yes | highest quality, zero cost |
| domain probe (name → plausible hosts → DNS) | yes | produces **candidates**, never findings |
| search / Places API | **no** | not present; see §3.6 |

A domain that resolves is not the business's website. Parked domains, squatters and competitors all resolve. Stage 3.3 is mandatory, not an optimisation.

### 3.3 The confirmation rule

Fetch the candidate through the existing `lib/urlGuard.safeFetch` (re-validates every redirect hop), extract via `lib/htmlExtract`, then require **at least one independent corroborating signal**:

```text
STRONG        sheet phone or email appears on the page
STRONG        sheet locality or street address appears on the page
WEAK          distinctive name tokens match <title> / og:site_name
                → counts only ALONGSIDE a locality match
NOT EVIDENCE  appeared in a search result        (ranking is relevance, not identity)
NOT EVIDENCE  string similarity over a threshold (a tuned float is a judgment in a number's clothes)
```

No corroboration → `candidate_rejected`, value `null`, **and the rejected candidate is recorded** so the next run does not re-probe it and an operator can override in one click.

### 3.4 Website existence is three-valued

```text
confirmed present   a corroborated URL returning a real page
confirmed absent    ONLY where an enumerating source says so
unknown             everything else — including every business we could not identify
```

`COMMERCIAL-PROVENANCE.md` §5 gives the test: absence carries information only for records Ascend authors exhaustively. **Ascend does not author the web**, so without an enumerating source `confirmed absent` is unreachable and `unknown` is the honest answer.

### 3.5 Quality is measured, never inferred

PageSpeed runs **only on a confirmed URL** — measuring an unconfirmed candidate produces a quality claim about the wrong business. Any PSI failure yields `source_unavailable`, never a band (D-2).

Mechanical defects are separately observable in bytes we hold a hash of: missing viewport meta, no HTTPS, no `tel:` link, missing title. These are facts. "The site looks dated" is not, and no rule will produce it.

### 3.6 What cannot be answered without a Places/search API

Stated so it is not quietly filled in later:

- **Google Business Profile / map presence** — permanently `not_attempted`
- **`confirmed absent` for website existence** — permanently unreachable
- discovery for businesses whose name does not map to a plausible domain

These stay blank with a stated outcome. Adding Places is a separate, authorised decision with a key, a cost model and terms — **not an LLM question**, and F12 does not block it.

### 3.7 The finding record

```text
ResearchFinding = {
  finding_id, prospect_id, run_id, observed_at,
  field:    website_url | website_exists | category | locality | contact | social | defect
  value:    T | null            null ⇔ nothing established. always.
  outcome:  established | candidate_rejected | no_candidate | source_unavailable | not_attempted
  method:   sheet | dns | http | psi | places | operator
  evidence: Evidence[]          empty ⇒ outcome MUST be non-establishing
}
```

Append-only in `.ascend-os/research_findings.jsonl`. A re-run appends; it never rewrites. `outcome` carries the never-looked / looked-and-found-nothing distinction, per `enums.ts:33`'s standing instruction that such a distinction belongs in provenance metadata rather than the value vocabulary.

> **NOT DECIDED BY §7.3(c), AND FLAGGED RATHER THAN ASSUMED.** §7.3 decided where THE SHEET SAID
> lives. This is ASCEND FOUND evidence for the research engine, which no slice has begun, and it is
> not directly contradicted by that decision — so it is left as written.
>
> It is nevertheless the same architectural question one layer over, and the answer will probably
> want to be the same one: the spine is append-only by grant, and a second evidence store in the
> vault would sit oddly beside a first one in Postgres. **That is a reason to decide it deliberately
> when the research engine is designed, not a reason to decide it here by momentum.** Recorded so the
> inconsistency is visible rather than discovered.

---

## 4. Human judgment

```text
website_opportunity:  green | yellow | red        GREEN = no site, open field
                                                  RED   = good site, low opportunity
blank = not assessed
```

- **No automated path holds a write handle to it.** Enforced by a fitness rule (§9, F31), not by intention.
- Mapped from the sheet's GREEN/YELLOW/RED column on **first** import only. On re-import a disagreement is `conflict` — skipped and reported. **The human wins.**
- Set through the UI by a person → emits `prospect.assessed` with `actor: "operator"`. This is the only genuinely operator-caused event in the whole pipeline, and it should be, because it is the only step where a human adds information.

`website_opportunity` and `website_quality` are different axes and must never share a field. GREEN is *high* opportunity; `website_quality: none` is *low* quality; a PSI score is a third thing. D-2 exists because two of these were collapsed.

---

## 5. Second-brain integration

### 5.1 What becomes what

| | | why |
|---|---|---|
| **subject** | `prospect`, `import_batch`, `research_finding` | each is a stored record with a stable id |
| **relationship** | `imported_in` (prospect → import_batch)<br>`evidenced_by` (prospect → research_finding)<br>`promoted_to` (prospect → client, existing) | each is backed by a foreign key that exists on disk |
| **property** | `website_opportunity`, `research_status`, `website`, score | scalars on the record; not terrain |
| **nothing** | opportunity, priority, "ready to hit", flags | **F23.7 bans them outright** — engine judgments are not terrain |

### 5.2 Why `evidenced_by` is legal and `has_opportunity` is not

The distinction is not "is it derived" but **"is it a stored record with a foreign key"**.

`measured_by` (client → audit) already exists in `relationships/derive.ts` and is the exact precedent: an audit is an Ascend-authored record containing measurements, joined by `Audit.client`. A research finding has the identical shape — authored record, `prospect_id` FK. The edge asserts *this record exists and refers to this prospect*, not *this prospect has a bad website*.

An `opportunity` has no record and no FK — `lib/opportunities` synthesises it per request. Drawing it is graph-view's business; traversing it as structure is prohibited.

**The line to hold:** if a kind cannot name the field on disk that asserts it, it does not belong in the substrate.

### 5.3 Domain additions required

`EntityKind` gains `import_batch` and `research_finding`; `StructuralRelationshipKind` gains `imported_in` and `evidenced_by`; `PREFIX_TO_DOMAIN` routes `research.*` to `intelligence` and `import.*` to `crm`.

### 5.4 No separate second-brain store

The relationships layer projects entities that already exist. Once prospects carry legitimate identities, the graph absorbs them with no import of its own — which is the whole reason Stage 1 came first.

---

## 6. UI

Three surfaces, built in this order.

### 6.1 Import review — the batch is reviewed before it lands

```text
IMPORT · Print Shop Prospect List · 612 rows

  NEW         484   will create prospects
  MATCHED      97   will update source rows only
  BLOCKED       9   held prospects — nothing created        ⛔
  AMBIGUOUS    14   two or more matches — review
  CLIENT        6   already clients
  CONFLICT      2   sheet disagrees with a human judgment

  [ REVIEW BLOCKED ]  [ REVIEW AMBIGUOUS ]  [ APPLY 484 + 97 ]
```

Dry run is the default. `blocked`, `ambiguous`, `conflict` and `client_match` write nothing and are never silently folded into `new`.

### 6.2 Research queue

Operator-triggered over a bounded slice — no scheduler exists and adding one is a larger decision. Resumable by `run_id`, per-host politeness delay, concurrency capped, every attempt recorded whether or not it succeeded.

### 6.3 Prospect card

```text
ABC Roofing                                    🟡 your assessment

Website      https://abcroofing.com    ✓ confirmed
             corroborated: sheet phone found in tel: link
Research     complete · 2026-08-27          [ view evidence ]
Defects      no viewport meta · no tel: link above the fold
Performance  38/100 (mobile)

[ OPEN SITE ]  [ OPEN PROSPECT ]  [ ADD TO HIT LIST ]
```

Three blank renderings, never one empty cell:

```text
— never researched          (not_attempted)     → action: research it
— not identified            (candidate_rejected / no_candidate)  → action: supply a URL
— unavailable               (source_unavailable) → action: retry later
```

Surfaces select and render; they compute nothing (F18, F24) and reach every derived number through `mission-control` (F14).

---

## 7. Scale — measured, not estimated

### 7.1 A quadratic write path exists today, and it is mine

`createProspect` calls `buildProspectIdIndex()` for its uniqueness check, and that index reads **every prospect file**. Importing N rows therefore performs O(N²) file reads. Measured on a local temp vault (SSD, no iCloud):

```text
N=  50   import   170 ms   (3.4 ms/row)
N= 100   import   396 ms   (4.0 ms/row)
N= 200   import  1411 ms   (7.1 ms/row)
N= 400   import  5722 ms  (14.3 ms/row)     ← ms/row doubles as N doubles
```

Fitting T = kN²  (k ≈ 0.0358 ms):

```text
N=  600   ≈ 13 s
N= 1200   ≈ 52 s
N= 5000   ≈ 15 min        and this is BEFORE iCloud sync
```

`listProspects` is linear and healthy (10 ms at N=400 → ~125 ms at N=5000); the read model is fine. **The write path must be fixed in 2A**: build the index once per batch and thread it through, or give `createProspect` a batch mode that accepts a prebuilt index. Non-negotiable before any import over ~200 rows.

> **RESOLVED BY 2E, and NOT by either remedy proposed above — see §7.3(b).** The measurements stand;
> they were taken against the vault writer and remain the record of what that path cost. The fix was
> architectural rather than algorithmic: uniqueness stopped being a SCAN and became an INDEX
> CONSTRAINT when prospects moved to Postgres. `tests/db/scale.test.ts` records why the proposed
> remedy would not have been sufficient — *"build the index once per batch is correct only while
> exactly one process writes, and two users make that assumption false."* The ~200-row bound this
> paragraph imposed is lifted with the problem that motivated it.

### 7.2 iCloud is a demonstrated hazard, not a theoretical one

During Stage 1 verification the **repository itself** — which lives on iCloud-synced Desktop — produced 13 byte-identical `" 2"` conflict copies of build output, one of which broke `tsc`. `core/reconciler/observation.ts` already defends the vault against exactly this shape (`isVaultArtifact`), but that defence has never been exercised past six files.

### 7.3 Storage decision — AMENDED 2026-09-02. The original proposal is below it, unedited.

> **AMENDED, NOT IMPLEMENTED. Read this heading literally.** The proposal §7.3 originally made was
> never built, and this amendment does not pretend otherwise. What changed is the ARCHITECTURE the
> proposal was reasoning about: 2E landed between the writing of this contract and the sign-off it
> was waiting for, and it answered §7.1's problem by a different route. The original text is
> preserved verbatim in §7.3(a) because the reasoning in it is sound for the world it was written in,
> and a reader who finds only the conclusion cannot tell whether the premise still holds.

#### 7.3(a) THE ORIGINAL PROPOSAL, as written 2026-08-29 — SUPERSEDED, kept for its reasoning

> **A prospect nobody has touched is a RECORD. A prospect under active work is a NOTE.**

| | |
|---|---|
| `.ascend-os/prospects.jsonl` | the universe — append-only record store, exactly the precedent `invoices.jsonl` and `time_log.jsonl` already set |
| `02 - Sales & Hit List/<slug>.md` | materialised on **first human touch** (assessment, call log, status change) |

This keeps Obsidian useful instead of drowning it, keeps the vault the source of truth, and makes 5,000 prospects a non-event. The six existing markdown prospects stay exactly as they are.

**This is the one decision in this document that changes the vault's shape and needs explicit sign-off.** A narrower path exists: bound the first import to ~200 rows, keep markdown-per-prospect, and defer. That is legitimate — but it must be a decision, not a default, because the second import is where it stops being reversible.

#### 7.3(b) WHAT OVERTOOK IT — 2E, and the problem that stopped existing

§7.3 exists because of §7.1: `createProspect` called `buildProspectIdIndex()`, which read every
prospect file, so importing N rows cost O(N²). **2E solved that, and not by changing where prospects
are stored in the vault — by moving the store.** `core/db/prospects.ts`, in its own words:

> THE O(N²) CORRECTION LIVES HERE. `createProspect` in the vault called `buildProspectIdIndex()`,
> which read every prospect file, so importing N rows cost O(N²) reads — measured at 14.3 ms/row by
> N=400 and extrapolating to ~15 minutes at 5,000. Here uniqueness is a UNIQUE index: one probe, and
> race-safe, which the filesystem version could not be at any cost.

`tests/db/scale.test.ts` asserts the SHAPE is linear rather than a wall-clock number, deliberately.
`core/crm/source.resolveProspectSource()` now selects the store in exactly one place, and
`ASCEND_PROSPECT_SOURCE=postgres` is the deployed setting.

> **CORRECTED 2026-09-02, during Phase 2 closure.** This paragraph ended: *"`createProspect` and
> `listProspects` both branch on it, and the Postgres branch reconstructs the same `Prospect`
> shape."* **Only the READERS branch** — `listProspects` and `getProspect`.
> `core/crm.createProspect` had no Postgres arm at all, so a CSV import wrote markdown the deployed
> reader never read. Found while implementing 2F, and closed by `importProspectSheet`'s Postgres arm
> (§7.3(f)). The error is corrected rather than overwritten because it is the second time this
> stage that a claim about the code was written from memory and turned out to be half right.

**So both of the original options are answers to a question that is closed.** Markdown-per-prospect
bounded at ~200 rows was a concession to a quadratic write path that no longer exists.
`prospects.jsonl` would be a THIRD prospect store beside Postgres and the markdown — the split brain
2C diagnosed and 2E removed, reintroduced by the mechanism meant to prevent drowning.

#### 7.3(c) THE APPROVED DECISION, 2026-09-02

```text
THE SHEET SAID  →  append-only event evidence  →  Postgres prospect projection
```

    THE SHEET SAID    append-only events on the existing spine, attributable to a batch by
                      `correlation_id`. Never overwritten, never rewritten, never read as judgment.
    ASCEND FOUND      the current prospect row in Postgres, written through the EXISTING prospect
                      writer, under the existing grants and provenance constraints.
    A HUMAN JUDGED    untouched. Sheet intake never writes `website_opportunity`, `assessed_by`,
                      `assessed_at`, or any other judgment state.

**Postgres is the prospect source of truth.** No `.ascend-os/prospects.jsonl`. No second prospect
store. **No new table or schema for Sheets** — the evidence store already exists.

**Why the event spine and not a new table.** `events` is already append-only BY GRANT — 001 grants
`SELECT, INSERT` and no UPDATE or DELETE to any application role, so "never overwritten" is a
database permission rather than a convention. It is already organization-scoped by RLS, already
carries `actor`, `actor_user_id`, `subject`, `data jsonb` and `correlation_id`, and its CHECK
constraints already force an operator event to name its human and a system event to name none —
which is §1.2's `actor: "system", always (D-3)` rule, enforced. Nothing had to be invented.

**What this does NOT change.** §1.2's `ImportBatch` shape, §1.3's verbatim-row rule and §1.4's
three-state blank-cell semantics are unchanged in every respect except WHERE they are stored. The
reasoning in §1.3 for keeping rows out of frontmatter — *"it would bury the fields the reconciler
reads and move `contentFingerprint` on every import"* — argues for exactly this outcome and is
strengthened, not weakened, by the store being Postgres.

#### 7.3(d) SECOND-IMPORT SEMANTICS — the test the original decision was gated on

The original §7.3 warned that *"the second import is where it stops being reversible."* Defined here,
per case, because that warning is the whole reason this decision needed sign-off:

    unchanged row          a NEW source-row event, with the same cells and a new batch
                           `correlation_id`. Not suppressed as a duplicate — §1.2 already rules that
                           re-importing the same bytes is "a fact worth recording". The projection
                           is unchanged.
    changed row            a new source-row event carrying the new cells. Both batches remain
                           readable in order, so "what did the Sheet say in batch 1 vs batch 2" is
                           answerable. The projection is updated through the existing writer, under
                           the existing grants.
    new prospect           an ordinary insert through the existing writer, plus its source-row
                           event. Identity follows §2 unchanged.
    row absent in batch 2  NOTHING IS DELETED, NOTHING IS MARKED. The batch's own row set is
                           recorded, so absence is INFERABLE from the evidence — it is never
                           asserted as a fact about the business. See §7.3(e).
    duplicate identity     §2's existing outcomes govern. The row is still stored verbatim with
                           `prospect_id: null`, because "we received this row and did not act on it"
                           is the fact a reviewer needs (§1.3).
    conflicting identity   Stage 1's `held` state already exists for this: no `prospect_id`, a
                           stated `hold_reason`, and `anchored_iff_identified` enforcing the pair.
                           The import creates no identity it cannot justify.
    human judgment exists  UNTOUCHED. The Sheet writes evidence and the projection's system-owned
                           fields; it never writes judgment. This is enforced rather than promised —
                           `ascend_automation` holds no grant on `website_opportunity`,
                           `assessed_by` or `assessed_at`.

#### 7.3(e2) TWO CONSISTENCY CHECKS, MADE AGAINST THE CODE RATHER THAN ASSUMED

Both were verified while amending this section, because a contract that disagrees with the deployed
behaviour is worse than one that says nothing:

    resolveProspectSource()        unset → vault · "postgres" → Postgres · postgres selected with no
                                   connection registered → THROW, deliberately, because degrading to
                                   the vault "would silently restore the second source of truth this
                                   whole stage exists to remove". A typo also throws. The deployed
                                   setting is `postgres`, so this amendment describes the live path.
    /api/import/prospects          calls `core/crm.createProspect`.
                                   ** THIS ROW WAS WRONG, AND THE ERROR IS INSTRUCTIVE. ** It read:
                                   "which branches on resolveProspectSource() … the existing CSV
                                   import therefore ALREADY writes to whichever store is deployed".
                                   It does not. Only the READERS branch. The import wrote markdown
                                   to the vault while the deployed reader read Postgres — a real
                                   split brain, present before this contract was amended and found
                                   only when 2F wired the route and seven vault tests went red.
                                   A "consistency check made against the code" that was made
                                   against the wrong function is exactly the vacuous evidence this
                                   document warns about elsewhere; it is corrected here rather than
                                   quietly rewritten. §7.3(f) records how the gap was closed.

#### 7.3(f) WHAT WAS BUILT — Phase 2, 2A–2G, 2026-09-02

The decision above is implemented. Recorded here so the contract describes the code rather than only
the intention:

    core/intake/batch        verbatim parse (§1.3), batch identity + file_sha256 (§1.2)
    core/intake/evidence     THE SHEET SAID — prospect.batch_imported / prospect.row_received,
                             correlation_id = batch_id, appended through core/db/events
    core/intake/projection   §1.4's three blank-cell states; closed vocabularies validated, never
                             guessed; judgment fields unreachable — they are absent from
                             CreateProspectInput
    core/intake/identity     §2.1's outcomes, on Stage 1's normalisers, `blocked` evaluated FIRST
    core/intake/import       one transaction: batch, then per row project-then-record
    core/crm/prospect        `importProspectSheet` — THE ONE PLACE THE STORE IS ASKED (F43)
    core/crm/sheet-import    the vault arm, lifted out of the route unchanged

**THE SPLIT BRAIN IS CLOSED.** `importProspectSheet`'s Postgres arm writes through the canonical
Postgres writer, so an import now lands in the store the deployed reader reads. The vault arm is
kept because `resolveProspectSource()` still offers `vault`, and a route that ignored the seam would
reintroduce the same defect from the other side.

**NO SCHEMA CHANGE.** No table, no column, no migration. Two additive event types on a `prospect.`
prefix that already mapped to the crm domain. `.ascend-os/prospects.jsonl` does not exist and was
never created.

§3.7's `research_findings.jsonl` is UNCHANGED and remains deferred — see the note in that section.

#### 7.3(e) THE PRINCIPLE THAT SURVIVES INTACT

> **Absence from a later Sheet is not evidence of absence from the business or prospect universe.**

A row missing from batch 2 means the batch did not contain it. It does not mean the business closed,
was disqualified, or stopped being a prospect — the Sheet is one source among several, and the
operator may have filtered it, re-scoped it, or exported a different range. The evidence records what
each batch CONTAINED; anything beyond that is an inference a human makes, never a write the import
performs. This is the same rule §1.4 applies one level down, where an empty cell is a fact about the
sheet and never a value on the prospect.

---

## 8. F12 — the prohibition stays closed

Reaffirmed, with the specific argument rather than by inertia.

Every question Stage 2 must answer is decidable by deterministic evidence:

```text
does this host resolve?              DNS
does it serve a page?                HTTP
is it THIS business's page?          corroboration against sheet-supplied facts
how does it perform?                 PageSpeed
does it have a viewport tag?         the bytes
```

None of these improve with a model, and **the one thing a model would do well — produce a plausible URL for a business that has none — is precisely the failure mode this pipeline exists to prevent.**

The place a model could genuinely help is *interpreting* evidence that has already been established and ranking outreach. That sits downstream of the trust boundary and is a much safer problem. It is not in scope, and if it is ever wanted it needs its own contract and its own gate, with one rule fixed in advance:

> **Model output may never become an established finding — only a candidate a human confirms.**

**Registration requirement:** `research/`, `ingest/` and any other new top-level directory must be added to F12's scanned list *in the commit that creates them*. F12 documents this trap about itself, and Stage 1 already followed it for `identity-backfill`.

---

## 9. Fitness rules Stage 2 would add

| | |
|---|---|
| **F31** | no research/ingest module mentions `website_opportunity`; a full run leaves it byte-identical |
| **F32** | every `established` finding has non-empty evidence; every non-establishing outcome has `value === null` |
| **F33** | ingest and research emit with an explicit `actor: "system"` (F25/F27 shape) — protects §19 |
| **F34** | the findings and source-row stores are append-only |
| **F35** | import preserves every source column byte-identically, including empty cells |
| **F36** | generated markdown is machine-marked; nothing writes into Call Log or Friction/Notes |
| **F37** | `research-engine` joins `ENGINE_DIRS`, inheriting F1–F6 purity for free |
| **F38** | no automated writer accepts a held `prospect_id` or slug (P3) |

---

## 10. The gates that must be mutation-tested

Not "tested" — **mutation-tested**, because both are one-line shortcuts that look harmless and would poison 600 records in a single import.

### Gate A — held + corroborating row → `blocked`, never `new`

```text
mutation:  remove held prospects from the matcher's candidate set
expected:  the Tapia row is classified `new`
           → a THIRD Tapia record is created
           → the test MUST fail
```

### Gate B — blank website → `unknown`, never "no website"

```text
mutation:  treat an empty website cell as evidence of absence
expected:  website_exists becomes `confirmed absent` with no enumerating source
           → 484 unresearched prospects assert they have no website
           → computeScore awards +30 to each
           → the test MUST fail
```

A control that passes both before and after the mutation proves nothing. Stage 0.5 and Stage 1 both found real bugs this way — including one vacuous gate of my own — and neither would have been caught by inspection.

---

## 11. Staging

| stage | delivers | gate |
|---|---|---|
| **2A · ingest** | batch model, verbatim source rows, five-outcome matcher, dry-run-first UI, **the O(N²) fix** | dry-run the real sheet and review by hand before one write; a surprising `blocked`/`ambiguous` count is a finding |
| **2B · research** | collectors, corroboration engine, append-only findings, website + existence only | pre-registered against 30 hand-verified businesses: record precision **and blank rate before looking**. A wrong confirmed URL stops the stage; a high blank rate does not |
| **2C · workspace** | prospect surface, evidence drawer, assessment control, loop-closing actions | an operator can filter to GREEN + never-researched and act without opening Obsidian |
| **2D · graph** | `import_batch` + `research_finding` subjects, two new edges | F23 green — the substrate still contains only foreign keys |

Widening research (category, contacts, socials, defects) comes after 2B, each field with its own confirmation rule and its own honest failure outcome. **A field with no confirmation rule does not ship.**

---

## 12. What this contract does not decide

1. ~~**Storage shape** (§7.3) — needs sign-off; it changes the vault.~~ **DECIDED 2026-09-02 — §7.3(c).** The Sheet's claims are append-only events; Postgres remains the prospect source of truth; the vault's shape is NOT changed, which is the opposite of what this item anticipated. Left struck rather than deleted: the sign-off was genuinely required, and the record of it having been open is part of why the decision took the shape it did.
2. **Whether a Places/search API is added** (§3.6) — without it, GBP is permanently `not_attempted` and `confirmed absent` is unreachable.
3. **The Tapia resolution** — still requires a human, and still may require an "entered in error" vocabulary the domain lacks (H5 §6.6).
4. **Scheduled re-research** — needs a scheduler that does not exist.
5. **Deal value / forecast contribution** — COMMERCIAL-PROVENANCE §4.4 forbids a constant becoming a forecast. Imported prospects must not reintroduce it.

---

## 13. Status

```text
identity            4 anchored · 2 held · 0 residue          (applied)
gate                P1-P4                                     (adopted)
this contract       WRITTEN, not implemented
live vault          untouched since the Stage 1 apply
F12                 CLOSED, reaffirmed
blocking decision   §7.3 storage shape                        RESOLVED 2026-09-02 — §7.3(c)
prospect store      POSTGRES (2E). `ASCEND_PROSPECT_SOURCE=postgres` is the deployed setting and
                    `resolveProspectSource()` is the single seam. The vault's six markdown
                    prospects are unchanged and remain readable; they are no longer authoritative.
still not built     EVERYTHING in this contract. The decision above unblocks implementation; it
                    is not implementation.
```

No code changed. No vault touched.