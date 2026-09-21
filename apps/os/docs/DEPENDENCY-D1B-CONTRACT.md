# Dependency D1b — Prospect archival

---

> ## ✅ DEPLOYMENT INVARIANT — SATISFIED (2026-09-20). DEPLOYMENT STILL NOT AUTHORIZED.
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

**PRE-FLIGHT ONLY. Nothing in this document is implemented.** Migration 009 is not written, no
route is changed, no test is added, and production has not been contacted for this dependency.

**Accepted baseline:** `4276f89` (Dependency D1a). Working tree clean at the time of writing.

**Bounded purpose.** Replace D1a's temporary Postgres-mode delete refusal with a real ARCHIVE
operation that preserves notes and history, preserves prospect identity, records actor attribution,
is safe to retry, is available to both owner and sales through resolved authority, and never exposes
raw `DELETE` to sales.

**Method.** Every claim below is grounded in the shipping schema (`core/db/schema/001`–`008`), the
D1a implementation (`core/db/prospects.ts`, `core/crm/promote.ts`, `app/api/prospects/[slug]/route.ts`),
the recovery manifest (`core/recovery/manifest.sql`, `core/recovery/restore.ts`) and the traced
consumer set. Where the D1a-era proposal (`DEPENDENCY-D1-CONTRACT.md` §E, `DEPENDENCY-D1A-CHECKPOINT.md`
§16) turns out to be incomplete or wrong, that is stated as a **CORRECTION** rather than carried
forward.

**Headline findings.** Four things the proposal did not anticipate:

| # | Finding | Where |
|---|---|---|
| 1 | The proposed RLS tightening **cannot** be written as a `WITH CHECK` predicate — the obvious form blocks archival itself | §1.6 |
| 2 | `core/intake/import.ts:93` uses `listProspects()` as the **matcher universe**. Excluding archived rows there manufactures duplicates — the exact P4/held-row failure one table over | §2.3 |
| 3 | D1a's compare-and-set does **not** close concurrent double promotion. Resolve (tx 1), client creation (filesystem) and mark (tx 2) are three separate steps; the client write is outside both transactions | §7.3 |
| 4 | `F4.digest.prospects` changes **even with zero archived rows**, because F4 digests `t::text` of the whole row. The recovery point is invalidated by the migration alone | §8.2 |

---

## 1 · Archival schema design

### 1.1 Verdict on the proposed shape

The proposal (`DEPENDENCY-D1A-CHECKPOINT.md` §16.1) is:

> `archived_at timestamptz`, `archived_by uuid REFERENCES users(id)`, a partial index for the active
> set, and a column-level UPDATE grant on those two columns to `ascend_sales`. RLS keeps the existing
> anchored-rows-only predicate for sales.

Checked against the live schema: **the column shape is correct, the grant analysis is correct and
sufficient, the index claim is overstated, and the RLS sentence is wrong in a way that matters.**

| Element | Proposed | Verdict |
|---|---|---|
| `archived_at timestamptz` | ✅ | Correct. Matches `assessed_at`, `created_at`, `updated_at`. |
| `archived_by uuid REFERENCES users(id)` | ✅ | Correct, **and the FK must carry no `ON DELETE` clause** — §1.4 |
| Partial index on the active set | ⚠️ | Correct in shape; the stated benefit is unevidenced at 3,108 rows — §1.5 |
| Column UPDATE grant to `ascend_sales` | ✅ | Correct **and sufficient**; no other privilege is needed — §4 |
| "RLS keeps the existing predicate" | ❌ | Incomplete. Leaving RLS untouched lets sales keep editing archived rows. Tightening it has a trap — §1.6 |
| Provenance CHECK constraint | *(absent)* | **Missing.** Required for consistency with `assessment_has_provenance` — §1.3 |

### 1.2 Exact column types

```sql
ALTER TABLE prospects
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users(id);
```

Both **nullable with no default**, which is the project's standing rule and not a style choice: an
unarchived row states *nothing* about archival, and a `DEFAULT` here would be a claim. This is the
same D-1 reasoning that `002_prospect_fields.sql` applied to five columns and `001_substrate.sql`
applied to `status` and `website_quality`.

`timestamptz`, not `timestamp`: every other time column in the schema is `timestamptz`, and
`prospects.first_contact` / `last_contact` are `date` only because they are business dates rather
than instants. An archival is an instant.

Note that `archived_at` does **not** need the `to_char` treatment that `first_contact`/`last_contact`
receive in `core/db/prospects.ts:68-73`. That normalization exists because a `date` column arrives as
a JS `Date` at UTC midnight and renders as the previous day in a timezone behind UTC. A `timestamptz`
carries its instant unambiguously and round-trips correctly.

### 1.3 The missing constraint

```sql
ALTER TABLE prospects ADD CONSTRAINT archival_has_provenance CHECK (
  (archived_at IS NULL) = (archived_by IS NULL)
);
```

This is required for the same reason `assessment_has_provenance` exists one constraint above it: an
archival that cannot name the human who performed it is exactly the "who decided this?" shape the
schema removes everywhere else. Without it, a future code path can archive anonymously and the row
will accept it.

There is no `system` or `automation` archival path in D1b (§4), so there is no case where
`archived_at` is legitimately set with a NULL actor. If a future automated retention policy needs
one, it adds a third column stating the policy — it does not relax this constraint.

**Cost:** this adds a row to `pg_constraint`, so `F5.constraints.count` and `.digest` change. That is
accounted for in §8.

### 1.4 `archived_by` — reference, and ON DELETE behaviour

**Does it reference `users`?** Yes. Attribution to an unvalidated uuid is not attribution.

**ON DELETE behaviour: none — plain `REFERENCES users(id)`, i.e. `NO ACTION`.**

This is deliberate and matches every other actor column on the table:

| Column | Definition | Source |
|---|---|---|
| `assessed_by` | `uuid REFERENCES users(id)` | `001_substrate.sql:111` |
| `assigned_to` | `uuid REFERENCES users(id)` | `001:114` |
| `created_by` | `uuid REFERENCES users(id)` | `001:115` |
| `events.actor_user_id` | `uuid REFERENCES users(id)` | `001:161` |
| `prospect_notes.author_user_id` | `uuid NOT NULL REFERENCES users(id)` | `008:60` |
| **`archived_by`** | **`uuid REFERENCES users(id)`** | **009, proposed** |

`ON DELETE SET NULL` is **rejected**: it would erase attribution on a surviving fact, which is the
provenance violation this project does not commit. `ON DELETE CASCADE` is absurd here — it would
delete the prospect because a user record went away.

`NO ACTION` means a user row cannot be deleted while it is named by an archival. That is the correct
outcome, and it is already the live behaviour for five other columns. It is also not a practical
constraint: `005_user_credentials.sql` added `disabled_at`, so the application **disables** users and
does not delete them. No code path deletes a `users` row.

### 1.5 The active-set partial index

```sql
CREATE INDEX prospects_org_active_idx ON prospects (organization_id)
  WHERE archived_at IS NULL;
```

**Shape:** correct. It mirrors `prospects_org_idx` (`001:141`) with the active-set predicate, and the
predicate matches the reader's `WHERE archived_at IS NULL` exactly, which is what makes a partial
index usable at all.

**Honest assessment of the benefit: there isn't one yet.** Production holds 3,108 prospect rows
(measured 2026-09-20, D1a pre-flight). At that size the planner will sequential-scan `prospects`
regardless of what indexes exist, and `prospects_org_idx` is presumably already unused for the same
reason. Claiming this index makes the active reader faster would be an unevidenced performance claim
of the kind this project rejects elsewhere.

**Recommendation: include it anyway, and say why in the migration header.** It is cheap to create
(milliseconds at this size), it is cheap to maintain, and it is the index the reader will need at
50,000 rows. What the header must *not* say is that it fixes a measured problem, because no such
measurement exists.

**Must be a plain `CREATE INDEX`, not `CONCURRENTLY`.** `applyMigrations` (`core/db/migrate.ts:112`)
runs each migration inside a transaction, and `CREATE INDEX CONCURRENTLY` cannot run in one. At 3,108
rows the `SHARE` lock a plain `CREATE INDEX` takes is held for milliseconds, so there is no reason to
want `CONCURRENTLY`. This constraint should be stated in the migration, because the next person to
add an index on a larger table will hit it.

### 1.6 RLS — the trap, and what must actually change

**The proposal's sentence — "RLS keeps the existing anchored-rows-only predicate for sales" — is
incomplete.** Here is the live policy (`001_substrate.sql:233`):

```sql
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING       (organization_id = current_org() AND identity_state = 'anchored')
  WITH CHECK  (organization_id = current_org() AND identity_state = 'anchored');
```

If nothing changes, then after 009 **sales can still edit an archived prospect's status, notes,
assessment and qualification fields.** Archival would remove the row from the operator's list while
leaving it fully writable underneath. That is a quiet inconsistency, not a crash, which is the kind
this schema exists to prevent.

**The trap.** The obvious tightening is to add `archived_at IS NULL` to both halves. That **breaks
archival itself**:

- `USING` is evaluated against the **old** row — `archived_at IS NULL` is true, so the archive passes.
- `WITH CHECK` is evaluated against the **new** row — `archived_at` is now *not* null, so the archive
  is **refused for sales, always**.

The archive operation would be structurally impossible for the role it is being built for, and the
symptom would be a zero-row update that D1a's read-back logic reports as a generic refusal. This is
worth stating plainly because the proposal's one-line RLS claim is exactly where someone would stop
reading.

**Correct form — tighten `USING` only:**

```sql
DROP POLICY prospects_update_sales ON prospects;
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING      (organization_id = current_org()
              AND identity_state = 'anchored'
              AND archived_at IS NULL)
  WITH CHECK (organization_id = current_org()
              AND identity_state = 'anchored');
```

This reads exactly as intended: **sales may write any anchored, unarchived row, and archiving it is
the last write sales can make to it.** A second archive attempt fails `USING`, changes zero rows, and
is disambiguated to `already_archived` by the read-back (§3.6). Un-archival by sales becomes
impossible — correct, since D1b defines no un-archive verb (§12, decision 5).

`prospects_write_owner` (`FOR ALL`, org predicate only) is **unchanged**: the owner retains full
UPDATE on archived rows, which is what makes any future correction path possible without a new grant.

**Migration-safety note.** `DROP POLICY` / `CREATE POLICY` takes `ACCESS EXCLUSIVE` on `prospects` —
the same hazard `007_invitation_membership.sql:133` documented for `invitations`. At 3,108 rows and
single-operator traffic the window is sub-millisecond, but the migration header must say so rather
than leaving the next reader to rediscover it.

**`prospects_read` is NOT changed.** Archived rows stay SELECT-visible to both roles at the database
layer. Hiding them here would break the matcher (§2.3), the audit paths (§2.4) and note continuity
(§5). Exclusion is a **reader** decision, not an RLS decision — the same split `001:226` already
makes for held rows ("a hold is a WRITE barrier, not an information barrier").

### 1.7 Held rows

**Do held rows require special handling? Yes, and it is an owner decision (§12, decision 2).**

The mechanical facts:

- A held row has `prospect_id IS NULL` (`anchored_iff_identified`, `001:130`).
- `resolveProspectForMutation` (`core/db/prospects.ts:328`) refuses it with `reason: "held"` **before
  any mutation is attempted**, because there is no durable anchor to key an event's `subject_entity_id`
  on.
- `prospects_update_sales` would refuse it at the database anyway (`identity_state = 'anchored'`).
- `prospects_write_owner` would **not** — the owner can update held rows today.

So with no change, **archival refuses every held prospect for both roles**, because the shared
resolver refuses first.

**This is the wrong default, and it is worth arguing.** A held prospect is a record the matcher could
not safely resolve — a suspected duplicate. It is precisely the record an operator most wants off the
working list, and `008_prospect_notes_log.sql`'s header makes this exact argument for why notes key
on the row rather than the anchor: *"a held record … is precisely the record an operator most needs
to annotate"*. Refusing archival on held rows means the quarantine list can only ever grow.

**Recommendation (owner decision 2):** allow the **owner** to archive a held row, keeping the refusal
for sales (whose RLS refuses it regardless). The event's `subject_entity_id` then falls back to the
surrogate `id`, exactly as `createProspect` already does for held rows
(`core/db/prospects.ts:230`: `entity_id: row.prospectId ?? row.id`). The precedent is in the
codebase; this would follow it rather than invent something.

This requires a second resolver entry point (§3.2) so that the held refusal stays intact for
promotion, where it is genuinely load-bearing.

### 1.8 Are archived rows still readable by direct id lookup?

**At the database layer: yes, unconditionally.** `prospects_read` has no archival predicate, and both
roles hold table-level `SELECT`. Nothing in 009 changes that.

**At the application layer: an owner decision (§12, decision 3).** `core/crm.getProspect()` reads
through `listDbProspects(tx)` and finds by `slug ?? id` (`core/crm/prospect.ts:143-152`), so its
behaviour follows whatever `listProspects` does. §2 recommends it **include** archived rows and
surface the state explicitly.

### 1.9 Does automation need anything?

**No, and the omission is the mechanism.** `ascend_automation` receives no grant on `archived_at` or
`archived_by`, so the research runner cannot archive a prospect even if a future code path tried.
This is the same construction `001:265` used to withhold `website_opportunity` and `002:33` used to
withhold the qualification fields — F31 as a database permission rather than a source-text rule.

Automation's `prospects_update_automation` policy is unchanged. It should arguably also gain
`archived_at IS NULL` in `USING` (so research cannot overwrite an archived row's website data), but
this is **not required** — and adding it costs a second `ACCESS EXCLUSIVE` policy swap. Deferred with
the reason stated, not silently dropped.

### 1.10 Migration 009, assembled

```sql
-- 009_prospect_archival.sql  (NOT WRITTEN — this is the validated shape, for review)

ALTER TABLE prospects
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users(id);

ALTER TABLE prospects ADD CONSTRAINT archival_has_provenance CHECK (
  (archived_at IS NULL) = (archived_by IS NULL)
);

CREATE INDEX prospects_org_active_idx ON prospects (organization_id)
  WHERE archived_at IS NULL;

GRANT UPDATE (archived_at, archived_by) ON prospects TO ascend_sales;
-- ascend_automation is granted NOTHING here, deliberately (§1.9).
-- ascend_owner needs nothing: its table-level UPDATE covers future columns (§4.2).

DROP POLICY prospects_update_sales ON prospects;
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING      (organization_id = current_org() AND identity_state = 'anchored'
              AND archived_at IS NULL)
  WITH CHECK (organization_id = current_org() AND identity_state = 'anchored');

COMMENT ON COLUMN prospects.archived_at IS
  'When this prospect left the active hit list. NULL means active — not "never archived", which '
  'would be a claim. Archival is REVERSIBLE IN PRINCIPLE and DESTRUCTIVE OF NOTHING: the row, its '
  'notes, its prospect_notes log and its events all survive. No role holds DELETE except ascend_owner.';
COMMENT ON COLUMN prospects.archived_by IS
  'The human who archived it. Never NULL when archived_at is set (archival_has_provenance). There '
  'is no system or automation archival path: no such role holds a grant on this column.';
```

`MIGRATIONS` in `core/db/migrate.ts:37` gains `"009_prospect_archival.sql"`.

---

## 2 · Reader semantics

### 2.1 The full traced reader set

Every call site reached through `core/db/prospects.ts` or `core/crm/prospect.ts`. This is a traced
inventory, not a remembered one — `003_prospect_notes.sql`'s header records what happens when a
consumer inventory is assumed rather than traced.

| # | Reader | Call site | Archived rows should be | Why |
|---|---|---|---|---|
| 1 | `core/db.listProspects(tx)` | primitive | **Excluded by default**, opt-in flag | The active set is the common case; the exception must be explicit |
| 2 | `core/crm.listProspects()` | `core/crm/prospect.ts:71` | **Excluded** | The canonical reader. This is the behaviour change D1b is for |
| 3 | `core/crm.getProspect(slug)` | `prospect.ts:143` | **Included**, state exposed | Decision 3. A direct link must not 404 into a lie |
| 4 | `core/crm.listProspectSources()` | `prospect.ts:166` | **Excluded** | Feeds the knowledge index → graph → `/search` |
| 5 | **`core/intake/import.ts:93`** | matcher universe | **INCLUDED — load-bearing** | §2.3. Excluding manufactures duplicates |
| 6 | `findCorroborating(tx, …)` | `prospects.ts:132` | **Included** | Identity matcher. Same reasoning as held rows |
| 7 | `findByProspectId(tx, id)` | `prospects.ts:116` | **Included** | Identity lookup and audit |
| 8 | `resolveProspectForMutation` | `prospects.ts:314` | **Included**, archived reported | Must answer `already_archived`, not `not_found` |
| 9 | `findProspectRef(tx, ref)` | `prospect-notes.ts:91` | **Included** | Notes stay readable (§5) |
| 10 | `listHeldProspects(tx)` | `prospects.ts:111` | **Excluded** | The held queue is a work queue |
| 11 | `core/research/website.ts:92` | raw SQL by id | **Included** (unchanged) | Raw SQL; see §2.5 |
| 12 | `core/recovery/restore.ts:315` | raw `count(*)` | **Included** (unchanged) | Fidelity counts must count every row |
| 13 | `substrate-migration/verify.ts:27` | parity verifier | **Included** | A parity check that skips rows is not a parity check |
| 14 | `identity-backfill/snapshot.ts` | vault only | N/A | Reads `hitListDir()`, never Postgres |

### 2.2 The shape of the change

```ts
export async function listProspects(
  tx: SqlClient,
  opts: { includeArchived?: boolean } = {}
): Promise<ProspectRow[]>
```

Default `false`. **Defaulting to exclusion is the correct risk posture** — a forgotten flag hides a
row from a list (visible, recoverable) rather than showing an archived prospect in the operator's
queue (the capability regression D1b exists to fix).

`ProspectRow` gains `archivedAt: string | null` and `archivedBy: UserId | null`, and `SELECT`
(`prospects.ts:66`) gains both columns. **`prospectFromRow` must NOT map them into
`ProspectFrontmatter`** — frontmatter is the vault's shape and the parity ledger compares it
field-for-field (`tests/db/consumer-parity.test.ts:206`). Adding a key there would register as a
behaviour change during serialization, which is exactly what that gate catches. Archival state
travels as a sibling field on `Prospect`, not inside `frontmatter`.

### 2.3 The one that would have broken silently

`core/intake/import.ts:93`:

```ts
// THE WHOLE UNIVERSE, held AND anchored. Reading only the anchored rows would make §2.1's
// `blocked` unreachable — the failure that "creates a third Tapia record" …
const universe = await listProspects(tx);
```

This is the **identity matcher's corroboration view**. If `listProspects` starts excluding archived
rows and this call site is not updated, then an import row for an archived business finds no match,
is classified `new`, and **creates a duplicate prospect** — the precise failure the comment calls
*"the single most important line in the document"*, reintroduced through a default parameter.

It would pass every existing test. `intake-identity.test.ts` and `intake-second-import.test.ts` have
no archived fixtures, because archival does not exist yet.

**Required:** this call site becomes `listProspects(tx, { includeArchived: true })`, carries a
comment explaining why, and is pinned by a test that archives a prospect and re-imports its row
(§10, T8).

**This generalizes.** Archival and holding are the same class of state: *a row that must stay
VISIBLE to machinery while being INVISIBLE to the operator's working surface.* Every place
`001_substrate.sql:222` argues for held rows, the same argument applies to archived ones.

### 2.4 Audit and reconciliation paths that must keep seeing archived rows

`DEPENDENCY-D1-CONTRACT.md` §6 defines incomplete promotion as **derived, not stored**:

> "Incomplete" is derivable: a client with `promoted_from_prospect_id = X` while row X is not
> `closed-won`. A read-only consistency check can list it.

If that check runs over an active-only reader, **an archived prospect drops out of it** and a
genuinely incomplete promotion becomes permanently invisible — the reconciliation path losing exactly
the rows most likely to need it. This check does not exist as shipping code yet, so D1b's obligation
is to make the requirement explicit before someone writes it against the wrong reader. It is recorded
here and pinned by §10, T9.

Same for `findByProspectId`, which `promote.ts:258` uses to read the row back after resolution.

### 2.5 Raw-SQL readers

Four call sites query `prospects` directly rather than through the repository:
`core/research/website.ts:92`, `core/recovery/restore.ts:315-318`, `substrate-migration/apply.ts:61,69`,
`core/db/prospect-notes.ts:93`. **None is changed by 009** — they select by id or count everything,
and all four are correct as-is under archival.

This is worth a fitness check rather than a promise: a rule asserting that no *new* raw
`FROM prospects` reader appears outside `core/db/` would keep the seam the traced inventory depends
on. Flagged as optional scope (§11).

### 2.6 Derived counts and metrics that change

Every one of these changes the moment the first prospect is archived. All are **intended**, and none
is currently asserted against a fixed number, so none breaks a test — but the owner should know the
numbers on screen will move.

| Surface | Call site | What moves |
|---|---|---|
| `/sales` list | `app/sales/page.tsx:61` | Row disappears — the point of the feature |
| `/partner` list | `app/partner/page.tsx:57` | Same |
| Pipeline funnel | `mission-control/pipeline.ts:12` | Stage counts drop |
| Revenue forecast | `lib/forecast.ts:118,171` | Archived prospects stop contributing forecast value |
| Opportunities | `lib/opportunities.ts:260` | Fewer candidates |
| Automations | `lib/automations.ts:291` | Fewer triggers |
| Operator brief | `lib/compileOperatorBrief.ts:25` | Fewer mentions |
| MC forecast | `mission-control/forecast.ts:21` | Same as forecast |
| Graph / `/search` | `graph-view/projection.ts:215` via `listProspectSources` | Node count drops; wikilinks to an archived prospect dangle |

**The graph one deserves a flag.** `listProspectSources` feeds the knowledge index, and
`core/crm/prospect.ts:160` records that bypassing this seam once produced *"a split brain with
nothing reporting the disagreement"*. Excluding archived rows means an existing `[[wikilink]]` to an
archived prospect becomes unresolved. That is defensible — the prospect left the working surface —
but it is a visible change and it is adjacent to decision 3.

`tests/db/restore-*.test.ts` AC4 (*"`listProspects` returns every restored prospect"*) keeps passing
while production has zero archived rows, and becomes wrong the moment it does not. It should be
re-scoped to the active set with an explicit archived count beside it (§10, T14).

---

## 3 · The archive mutation contract

`archiveProspect` is a **second verb over D1a's machinery**, not a parallel implementation. It reuses
`resolveProspectForMutation`, the compare-and-set shape, the read-back disambiguation and the typed
outcome vocabulary — the same reasoning `core/crm/prospect.ts:104` gives for exporting
`prospectFromRow`: a second answer to "what does this row mean" is the defect, not the duplication.

### 3.1 Signature

```ts
export type ArchiveOutcome =
  | { state: "archived"; archivedAt: string }
  | { state: "already_archived"; archivedAt: string }
  | { state: "refused"; reason: string };

export async function archiveProspect(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: {
    target: MutationTarget;
    actorUserId: UserId;
    correlationId: string;
    reason?: string;
  }
): Promise<ArchiveOutcome>
```

`tx` is the **caller's** transaction, exactly as `markProspectPromoted` takes it
(`prospects.ts:365`). That is what makes §3.5 true.

### 3.2 Identity resolution

Through `resolveProspectForMutation(tx, ref)` — unchanged for promotion, extended for archival:

1. **Slug first, then surrogate id**, no `LIMIT`. Production holds 6 slugged and 3,102 unslugged
   prospects (D1a, 2026-09-20), so both forms are live. The absent `LIMIT` is what turns a duplicate
   into a reported outcome rather than a silent first-match.
2. `0 rows` → `not_found`; `>1` → `ambiguous` with the count (never which rows).
3. **The anchor `prospect_id` is the identity written down**, never the slug and never the surrogate.

**Two required extensions:**

**(a) `MutationTarget` gains `archivedAt: string | null`**, so the caller sees archival state without
a second query. `resolveProspectForMutation` continues to return `ok: true` for an archived row —
archived is a *state*, not a resolution failure, and collapsing it into `not_found` would be the
"reading a filtered zero-row result as already-done" error `prospects.ts:308` warns against.

**(b) A held-row entry point**, if decision 2 permits owner archival of held rows:

```ts
resolveProspectForMutation(tx, ref, { allowHeld: true })
```

Default `false`, so **promotion's behaviour is untouched**. With `allowHeld: true`, a held row
resolves `ok` with `prospectId: null`, and the event's `subject_entity_id` falls back to the
surrogate `id` — the precedent already set by `createProspect` (`prospects.ts:230`).
`MutationTarget.prospectId` becomes `ProspectId | null`, which is a type change promotion must
narrow at its call site (a compile error, not a runtime surprise — correct).

If decision 2 goes the other way, extension (b) is dropped and held rows refuse as today.

### 3.3 Authority resolution

Identical to D1a and reusing it whole:

1. Route guard: `authorize(req, "prospects:identity", …)`. Sales **holds** this capability —
   `core/auth/capabilities.ts:95` and `core/auth/routes.ts:148` (`sales: "allow"`, `backing: "both"`),
   moved there deliberately by 2G.4.7.
2. `withProspectDb` → `asPrincipal` → `SET LOCAL ROLE ascend_sales | ascend_owner` plus the two
   `ascend.*` GUCs, all transaction-scoped (`core/db/client.ts:66-79`).
3. `actorUserId` comes from the **membership-resolved principal**, never from the request. A forged
   role claim is inexpressible, not rejected — `DbPrincipal` is branded (`client.ts:44`).

The capability layer and the database layer now **agree**, which §8 of the D1 contract recorded as a
live disagreement: *"Sales has no DELETE on `prospects`, and no UPDATE on any archive column (none
exists). The two layers disagree, and D1 must resolve it."* 009's column grant is that resolution.

### 3.4 Compare-and-set

```sql
UPDATE prospects
   SET archived_at = now(), archived_by = $2, updated_at = now()
 WHERE id = $1
   AND archived_at IS NULL
 RETURNING archived_at
```

`WHERE archived_at IS NULL` is the idempotency mechanism, structurally identical to promotion's
`WHERE status IS DISTINCT FROM 'closed-won'` (`prospects.ts:371`). **The state is the key.** No
operation-key table exists to drift out of sync with it.

Under `READ COMMITTED`, a concurrent second archive blocks on the row lock, then re-evaluates the
predicate against the updated row (EvalPlanQual). `archived_at` is now non-NULL, so it matches zero
rows. **No additional locking is required for archive-vs-archive** (§7.2).

`updated_at = now()` is included: sales already holds `UPDATE (updated_at)` (`001:258`), so it costs
no new grant, and leaving it stale would make archival the one mutation that does not touch it.

### 3.5 Transaction boundary

**The row update and the `prospect.archived` event commit together or neither does.**

This is guaranteed by construction, not by discipline: `archiveProspect` takes the caller's `tx` and
`appendEvent` runs on the same handle, so both statements are in the one transaction `withProspectDb`
opened. It is the same guarantee `createProspect` gives (`prospects.ts:180`) and the one
`promoteInPostgres` documents at step 3 — *"there is no state where the prospect is won with no
memory of why"*.

There is **no** partial-state row for archival in the §3.8 table, and that absence is the design.

### 3.6 Event append and ordering

```ts
await appendEvent(tx, organizationId, {
  type: "prospect.archived",
  subject: { entity: "prospect", entity_id: target.prospectId ?? target.id },
  actor: "operator",
  actor_user_id: input.actorUserId,
  data: { ...(input.reason ? { reason: input.reason } : {}) },
  correlation_id: input.correlationId,
});
```

- **`prospect.archived` must be added to the closed union in `packages/domain/events.ts`.** It is not
  there today; `prospect.deleted` (line 96) and `prospect.promoted` (line 93) are. Verified.
- **Order: UPDATE first, then append.** The append is skipped entirely when the update matched zero
  rows, so `already_archived` and `refused` produce **no event**. An event is a record that something
  happened; a no-op did not happen.
- `actor: "operator"` with `actor_user_id` set satisfies `operator_events_name_their_human`
  (`001:172`). A system archival would violate it — which is the constraint doing its job, since no
  system archival path exists.
- `subject_entity_id` uses the **anchor**, falling back to the surrogate only for held rows under
  decision 2.
- `data` omits `reason` when absent rather than writing `null`. Absence stays absence.
- Events are append-only by trigger (`events_are_append_only`, `001:165`), so the archival event can
  never be rewritten or removed — including by a future un-archive.

### 3.7 Retry behaviour

**Fully idempotent, converging on one state transition and one event.**

| Attempt | Row | Event | Returns |
|---|---|---|---|
| 1st | `archived_at` set | `prospect.archived` appended | `archived` |
| 2nd (any actor) | unchanged | none | `already_archived` |
| Nth after a client timeout post-COMMIT | unchanged | none | `already_archived` |

The unknown-outcome case — the caller's connection dropped after `COMMIT` was sent — is answered
definitively by the retry, exactly as promotion's is. This is also where the standing
`[[feedback_ascend_long_writes]]` rule applies: **a client timeout is not a rollback.** The retry
must re-read state rather than assume the first attempt failed.

`archived_by` records the **first** archiver and is never overwritten. A second operator's attempt
does not rewrite attribution.

### 3.8 The complete outcome table

| Outcome | HTTP | Body `outcome` | Event | Row changed | Retry |
|---|---|---|---|---|---|
| Archived | 200 | `archived` | `prospect.archived` | yes | idempotent |
| Already archived | 200 | `already_archived` | none | no | idempotent |
| Not found | 404 | `not_found` | none | no | — |
| Ambiguous (>1 match) | 409 | `ambiguous` + count | none | no | — after the duplicate is resolved |
| Held (sales; or owner under decision 2b) | 409 | `held` | none | no | — |
| Refused by RLS/grant | 409 | `refused` + reason | none | no | — |
| Vault mode | 200 / 404 | `deleted` / `not_found` | `prospect.deleted` | vault file | unchanged from D1a |

### 3.9 Disambiguating zero rows

Zero rows from the compare-and-set is ambiguous — it means *already archived* **or** *RLS refused
this principal*. D1a solved this for promotion by reading the row back (`prospects.ts:381-389`), and
archival uses the identical shape:

```
UPDATE matched 0 rows
  → SELECT archived_at FROM prospects WHERE id = $1
      → 0 rows              → refused: "no longer visible to this principal"
      → archived_at NOT NULL → already_archived
      → archived_at IS NULL  → refused: "the database refused this principal's archival"
```

The third branch is the live one after §1.6: a sales principal on a held row, or on a row whose
`identity_state` changed underneath. It must be **reported as a refusal**, never read as success —
that reading is the P4/P5 defect class D1a removed.

### 3.10 Correlation id

Generated per request, carried on the event, returned in the body — the same shape promotion uses
(`promote.ts`). Its job is to let a later reader tie an event to the request that caused it. Unlike
promotion, archival has no cross-store correlation to maintain (no vault write), so the correlation
id is for **traceability only**, not for reconciliation. Stated so nobody later mistakes it for an
idempotency key: **the state is the key** (§3.4).

---

## 4 · Sales authorization — the least-privilege proof

### 4.1 The question

Is column-level `UPDATE (archived_at, archived_by)` sufficient for sales to archive through the
application path, combined with current RLS and transaction role switching — **without** any broader
privilege?

**Answer: yes. Sufficient, and nothing else is required.** Here is the proof, statement by statement.

### 4.2 Privilege trace for the archival statement

Statement: `UPDATE prospects SET archived_at=now(), archived_by=$2, updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING archived_at`

| Requirement | Privilege needed | Sales holds it? | Source |
|---|---|---|---|
| `SET archived_at` | `UPDATE (archived_at)` | **New in 009** | 009 |
| `SET archived_by` | `UPDATE (archived_by)` | **New in 009** | 009 |
| `SET updated_at` | `UPDATE (updated_at)` | ✅ already | `001:258` |
| `WHERE id = $1` | `SELECT (id)` | ✅ table-level | `001:257` |
| `WHERE archived_at IS NULL` | `SELECT (archived_at)` | ✅ via table-level SELECT | `001:257` |
| `RETURNING archived_at` | `SELECT (archived_at)` | ✅ same | `001:257` |
| Row visibility | `prospects_update_sales` USING | ✅ anchored + unarchived | §1.6 |
| New row admitted | `prospects_update_sales` WITH CHECK | ✅ org + anchored | §1.6 |
| Read-back on zero rows | `SELECT` | ✅ `prospects_read` | `001:226` |
| Event append | `INSERT ON events` | ✅ | `001:253` |
| Event sequence | `USAGE, SELECT ON events_seq_seq` | ✅ | `001:254` |
| Role assumption | `SET ROLE ascend_sales` | ✅ `INHERIT FALSE, SET TRUE` | `001:51` |

**Exactly two new grants. No table-level UPDATE, no DELETE, no policy widening.**

**Owner needs nothing.** `GRANT SELECT, INSERT, UPDATE, DELETE ON prospects TO ascend_owner`
(`001:252`) is table-level, and a table-level `UPDATE` covers columns added later. Verified against
the same mechanism `005_user_credentials.sql:9` documented as a trap — *"A table grant covers every
column the table will EVER have"*. Here that property is benign and useful; it is called out so the
asymmetry between the two roles is deliberate and visible rather than accidental.

### 4.3 One consequence, stated rather than hidden

Sales' **table-level `SELECT`** means `archived_at` and `archived_by` become readable by sales the
moment 009 lands, with no explicit grant. That is the trap 005 documented, firing again.

Here it is **harmless and intended** — archival state is not a credential, and the UI shows it. But
005's remedy (revoke the table grant, replace it with an explicit column list) was adopted for `users`
and **not** for `prospects`, so `prospects` still has this property. D1b should not change that (it
would be a large, unrelated grant refactor), but the migration header must state that the two new
columns are readable by sales by inheritance and that this is accepted, not overlooked.

### 4.4 No raw DELETE — proven, not asserted

Three independent layers, none of which D1b weakens:

1. **No grant.** `DELETE ON prospects` goes to `ascend_owner` only (`001:252`). Sales' grant is
   `SELECT, INSERT` plus two column lists. 009 adds no DELETE.
2. **Already asserted in the recovery proof.** `core/recovery/restore.ts:322` runs
   `refused(target, as("ascend_sales"), "DELETE FROM prospects")` as check
   `F12.sales-cannot-delete-prospects` against every restored artifact. **This must keep passing
   after 009** — it is a standing regression test for exactly this.
3. **No application path.** The route performs `UPDATE`. No code path issues
   `DELETE FROM prospects`; `core/auth/routes.ts:144` already records this.

`ON DELETE CASCADE` on `prospect_notes.prospect` (`008:59`) therefore **cannot fire from any sales
action** — which is the whole reason archival exists instead of deletion.

### 4.5 Grants NOT broadened, and why each was considered

| Tempting | Rejected because |
|---|---|
| `GRANT DELETE … TO ascend_sales` | The stated non-goal. Would cascade the notes |
| Table-level `UPDATE … TO ascend_sales` | Would silently confer `website_quality`, `source`, `prospect_id`, `identity_state`, `hold_reason` — undoing F31 and P3 |
| `GRANT UPDATE (archived_at, archived_by) TO ascend_automation` | No automated archival path exists. A grant with no caller is a grant waiting for one |
| Relaxing `prospects_update_sales` to reach held rows | Held-row writes by sales are refused on purpose (P3). Decision 2 routes held archival to the **owner**, who already holds it |

---

## 5 · Notes and history continuity

**The requirement:** archival must not cascade-delete or orphan history. Traced per artifact.

| Artifact | Mechanism | Under archival | Under a hypothetical hard delete |
|---|---|---|---|
| `prospects.notes` (markdown body) | Column on the row | **Preserved** — the row is not deleted | Destroyed with the row |
| `prospect_notes` rows | FK `prospect → prospects(id) ON DELETE CASCADE` (`008:59`) | **Preserved** — no DELETE occurs, so no cascade | **Every note destroyed** |
| `events` for this prospect | Keyed by `subject_entity_id` (the anchor); append-only by trigger | **Preserved**, plus `prospect.archived` | Preserved as rows, but orphaned from a vanished row |
| Client back-reference `promoted_from_prospect_id` | Client meta → the anchor | **Preserved** — archival never nulls `prospect_id` | Dangling: points at nothing |
| Reconciliation observations | Derived from client meta × row status | **Preserved iff the check includes archived rows** (§2.4) | Impossible |
| `prospect.promoted` correlation chain | `correlation_id` shared with vault `client.created` | **Preserved** | Half-broken |

**The single most important line:** `008_prospect_notes_log.sql:59` declares
`prospect uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE`, and its header states the trade
openly — *"If a prospect is deleted and later re-imported it is a new row, and these notes do not come
back with it — they cascade away with the original."*

**Archival never triggers that cascade**, because archival is an `UPDATE`. This is the entire
justification for D1b over the shorter path of granting sales `DELETE`, and it is why D1a's refusal
route says *"the shortest path to 'deletion works again' is also the one that destroys sales
history."*

**Identity is preserved.** `prospect_id` is untouched, so:
- the `UNIQUE` index still prevents a re-import claiming the same identity;
- `findCorroborating` still matches on website/phone/email (§2.1, row 6);
- every event's `subject_entity_id` still resolves;
- the client's back-reference still resolves.

**Availability to future engines and audit/recovery paths:**

1. **Database layer:** `prospects_read` has no archival predicate. Every archived row is SELECT-visible
   to both roles, always (§1.6).
2. **Repository layer:** `includeArchived: true` on the primitive; the matcher, audit and
   identity-lookup readers pass it (§2.1).
3. **Event spine:** `readEvents` is unaffected — events are not archived, filtered or moved.
4. **Notes:** `findProspectRef` includes archived rows, so `listProspectNotes` keeps working and the
   prospect detail page keeps rendering the log (decision 3).
5. **Recovery:** `F3.rows.prospects`, `F4.digest.prospects`, `F7.notes.legacy.*` and `F8.notes.log.*`
   all count and digest **every** row, archived included. An archived prospect is fully carried by
   every backup and fully restored by every restore. No manifest key needs an archival predicate.

---

## 6 · Route and UI semantics

### 6.1 Today

| Layer | Behaviour |
|---|---|
| `app/api/prospects/[slug]/route.ts` | `DELETE`, `authorize(… "prospects:identity")`. Postgres → **409 `unsupported`** with a truthful message naming D1b. Vault → `deleteVaultProspect` + `prospect.deleted` |
| `components/DeleteProspectButton.tsx` | Label **"Delete"**, title *"Remove this prospect from the hit list"*, danger-variant confirm, `router.push("/sales")` on success. Accepts **only** `outcome === "deleted"` |

### 6.2 After D1b

**HTTP verb: `DELETE` is retained.** The resource leaves the collection; archival is how. A new
`POST /archive` route would need its own capability mapping and its own authorization test, and would
leave `DELETE` as a route that only ever refuses. Minor owner decision (§12, decision 6) — the
recommendation is to keep `DELETE`.

**Response contract:**

```jsonc
// 200
{ "outcome": "archived", "store": "postgres",
  "prospect": { "state": "archived", "archivedAt": "2026-09-20T…Z" },
  "changed": { "prospect": "archived", "notes": "none", "events": "appended", "vault": "none" },
  "operation": { "prospectId": "…", "correlationId": "…", "store": "postgres" } }

// 200 — idempotent
{ "outcome": "already_archived", "store": "postgres",
  "prospect": { "state": "already_archived", "archivedAt": "…" },
  "changed": { "prospect": "none", "notes": "none", "events": "none", "vault": "none" } }

// 404 not_found · 409 ambiguous | held | refused — each with `changed` all-"none"
```

`changed` is carried forward from D1a's refusal body deliberately: **a mutation states what it
touched, including when the answer is nothing.**

**Status code rationale:**

| Outcome | Code | Why not something else |
|---|---|---|
| `archived` | 200 | Not 204 — the body carries the archival instant and the correlation id |
| `already_archived` | 200 | Not 409. Idempotent success is success; 409 would make the retry path look like a failure |
| `not_found` | 404 | — |
| `ambiguous` | 409 | Conflict in the data, not a client error |
| `held` | 409 | Same, and it matches promotion's held refusal |
| `refused` | 409 | Matches D1a's refusal code |

**Success navigation:** `router.push("/sales")` — unchanged. The prospect is gone from that list
because the canonical reader now excludes it (§2.1, row 2), so the navigation is *truthful* after
D1b in a way it was not before.

**D1a's 409 `unsupported` branch is removed**, along with the `VaultProspectWriteRefused` catch in
the Postgres arm. The vault arm is untouched.

### 6.3 UI language — "Delete" or "Archive"

**This is an owner decision (§12, decision 1), and it is the one with a real argument behind it.**

The current button says **"Delete"**. After D1b it would perform an operation that keeps the row,
keeps the notes, keeps the identity and keeps every event. **A button that says "Delete" and performs
retention is making a claim the system does not honour** — the same class of untruth D1a spent a
whole slice removing (a delete that reported success while the row survived, P4/P5).

**Recommendation: change it.**

| Element | Now | Proposed |
|---|---|---|
| Button | `Delete` | `Archive` |
| Title | "Remove this prospect from the hit list" | "Remove from the hit list. Notes and history are kept." |
| Confirm | "Delete {name}?" | "Archive {name}? Its notes and history are kept." |
| Variant | `danger` | **`quiet`** — archival is reversible in principle and destroys nothing |
| Accepts | `outcome === "deleted"` | `outcome === "archived" \|\| "already_archived"` |

**The argument for keeping "Delete":** it is the word an operator expects, and "Archive" may read as a
weaker action they then avoid. If the owner prefers the product language, that is a legitimate call —
but then the **confirm copy must state what actually happens**, because the button alone would be
misleading. Retention is fine; silence about it is not.

**The `danger` variant should change regardless of the label.** `danger` communicates irreversible
destruction, and archival is neither.

**Naming collision, flagged:** `cognition/contract.ts:173` defines `AssociationState = "active" |
"dormant" | "archived"`, and `cognition/contract.ts:160` states explicitly that it *"is not historical
archival, not deletion, not retirement"*. The two senses are unrelated and live in different layers.
No conflict, but 009's header should say so, since a future reader grepping `archived` will hit both.

---

## 7 · Concurrency

D1b must close the concurrency debt carried from D1a
(`DEPENDENCY-D1A-CHECKPOINT.md` §15), which was owner-accepted **on condition it be closed here**.

### 7.1 Why it could not be tested in D1a — and what that means for D1b

PGlite is a **single in-process connection**. It cannot hold two concurrent transactions, so no
PGlite suite can test any of the races below. D1a proved its compare-and-set *indirectly* — by the
predicate, the anchor lookup, and a mutation probe that removes each.

**A server-backed harness is therefore mandatory, not optional.** The repository already has one:
`tests/support/r1c-cluster.ts` starts a disposable PostgreSQL 17.6 cluster — Unix socket only, no TCP
listener, generated superuser credentials never printed, every binary invoked by absolute path with
an allowlisted environment. It is the correct foundation and needs no redesign.

**Cost, stated honestly:** it requires `ASCEND_R1C_ROOT` and a built PostgreSQL 17.6 source tree,
**which R1c destroys after its proof** (`gate-2g1.ts:144`: *"Needs the build root, which R1c destroys
after the proof: until a root is rebuilt this entry FAILS the environment gate on purpose"*). So the
concurrency suite registers in `gate-2g1.ts` with `requires: ["ASCEND_R1C_ROOT"]` and fails the
environment gate until a root exists — consistent with the two R1 entries, and a deliberate
fail-closed rather than a silent skip.

This cost is the main evidence for the D1b.1 / D1b.2 split (§11).

### 7.2 Race A — two simultaneous archives

**Invariants:** exactly one state transition; **at most one** `prospect.archived` event; the loser
receives a truthful `already_archived`; `archived_by` records the **first** archiver only.

**Sufficient with compare-and-set alone. No extra mechanism required.**

Under `READ COMMITTED`, session 2's `UPDATE … WHERE id=$1 AND archived_at IS NULL` blocks on the row
lock held by session 1. When session 1 commits, session 2 re-evaluates the predicate against the
**updated** row (EvalPlanQual), finds `archived_at` non-NULL, and matches zero rows. It appends no
event, reads back, and answers `already_archived`.

The single-transaction boundary (§3.5) makes the row and the event inseparable, so "one archive, one
event" holds without a uniqueness constraint.

### 7.3 Race B — two simultaneous promotions · **NOT CLOSED BY D1a**

**This is the finding that changes D1b's scope.** The D1a checkpoint treats concurrent double
promotion as untested-but-probably-fine. Reading `promoteInPostgres` (`core/crm/promote.ts:250-300`)
shows it is **not** fine.

The three steps are **not one transaction**:

```
1 · resolve            withProspectDb(…)  ← transaction 1, COMMITS and releases
2 · findOrCreateClient filesystem         ← NO transaction. Scans client dirs for
                                            promoted_from_prospect_id, then stages + renames
3 · markProspectPromoted withProspectDb(…) ← transaction 2
```

Compare-and-set protects **step 3 only**. It guarantees one `closed-won` transition and one
`prospect.promoted` event. It does **nothing** for step 2, which is on the filesystem, outside both
transactions.

**The interleaving:**

| | Session A | Session B |
|---|---|---|
| t1 | resolve → anchor X (tx 1 commits) | |
| t2 | | resolve → anchor X (tx 1 commits) |
| t3 | scan clients for X → **none** | |
| t4 | | scan clients for X → **none** |
| t5 | stage + rename → `crm/acme-roofing` | |
| t6 | | stage + rename → `crm/acme-roofing-llc` |
| t7 | mark: 1 row → `promoted` | |
| t8 | | mark: 0 rows → `already_marked` |

**Result: TWO clients for one prospect, one `prospect.promoted` event, and session B is told
`already_marked` — a truthful-sounding answer next to a duplicate client it just created.**

This is defect **P2** from the D1a pre-flight (*"a retry with a different client slug created a
SECOND client"*), which D1a fixed **for sequential retries** via the `promoted_from_prospect_id`
scan. Under true concurrency the scan races, and P2 returns. Two simultaneous submissions are one
double-click apart, and `PromoteButton` stays visible while the request is in flight.

**Verdict: the current compare-and-set is NOT sufficient. An additional mechanism IS required.**

**Options considered:**

| Option | Mechanism | Verdict |
|---|---|---|
| **A · Advisory lock across the whole promotion** | `pg_try_advisory_lock(hashtext('prospect:'‖anchor))` at step 1, released in `finally` | **Recommended.** Session-scoped, so it spans the filesystem work without holding a transaction open across I/O. The loser gets a truthful `in_progress` outcome and a retry verdict |
| **B · Deterministic staging name** | Stage into `crm/.staging-<prospect_id>/`; the atomic rename makes `EEXIST` the loser's signal | Good **defence in depth**, and cheap. Does not alone prevent two *final* directories, since the operator chooses the final slug |
| **C · `SELECT … FOR UPDATE` held across steps 1–3** | Row lock for the whole promotion | **Rejected.** Holds a Postgres transaction open across filesystem writes — a connection-pool hazard and exactly the shape `client.ts:64` warns about |
| **D · Reorder: mark first, then create** | Eliminates the window | **Rejected** by `DEPENDENCY-D1-CONTRACT.md` §6: needs a durable "promotion in progress" state, or the prospect claims `closed-won` with no client |

**Recommendation: A, with B as defence in depth.** A requires no schema change and no new table. B is
a few lines inside `createClient`, and the staging mechanism already exists.

**New outcome:** `in_progress` — *"another promotion of this prospect is running; nothing was
written. Retry."* HTTP **409**, `retry: "safe"`.

**Owner note:** this is a real, newly-identified scope addition to D1b beyond the proposal. It is in
scope because the checkpoint carried the concurrency case here explicitly; the *fix* it needs is
larger than "write a test".

### 7.4 Race C — promotion against archival

**Reachable.** Step 1 and step 3 are separate transactions, so an archival can commit in the window.

**Invariants:** a prospect cannot end up both archived and newly promoted; the loser is told the
truth; no orphan client is created for an archived prospect.

**Required — two changes:**

**(a) Promotion's compare-and-set gains the archival predicate:**

```sql
UPDATE prospects
   SET status = 'closed-won', last_contact = current_date, updated_at = now()
 WHERE id = $1 AND status IS DISTINCT FROM 'closed-won'
   AND archived_at IS NULL
 RETURNING id
```

and the read-back gains an `archived_at IS NOT NULL → refused("archived")` branch. Without this, an
archived prospect can still be promoted to `closed-won`, which contradicts §2's exclusion (a
closed-won prospect invisible to every reader).

**(b) Ordering, if the advisory lock (7.3 option A) is adopted:** archival takes the **same** lock.
Archive-then-promote and promote-then-archive both serialize, the second sees committed state, and
the first-wins outcome is definite.

**Without the lock there is a residual window:** promotion resolves, archival commits, promotion
creates the client (filesystem), then step 3 refuses with `archived`. Result: **a client exists for an
archived prospect.** Not corruption — it is exactly the `incomplete` state D1a already defines, and
the §2.4 reconciliation query finds it **provided that query includes archived rows**. This is the
second reason §2.4 is load-bearing rather than tidy.

### 7.5 Race D — archival against a note append

Notes `INSERT` into `prospect_notes` with an FK to `prospects(id)`. Archival `UPDATE`s the prospect
row. **No conflict:** the FK takes a `KEY SHARE` lock, archival takes `FOR NO KEY UPDATE`, and these
are compatible. A note appended concurrently with archival lands correctly, on an archived prospect.
**This is correct behaviour** — §5 requires notes to remain attached and readable. Recorded so the
test design covers it and nobody later "fixes" it.

### 7.6 Isolation level

`READ COMMITTED` (the default) is **sufficient for every race above**, given the predicates in §7.2
and §7.4(a). `REPEATABLE READ` would convert the archive-vs-archive case from a clean zero-row result
into a serialization failure requiring application-level retry — strictly worse. **Do not raise the
isolation level.** Stated because it is the reflexive fix someone will reach for.

---

## 8 · Migration 009 and the recovery contract

### 8.1 The governing rule

`DEPENDENCY-R1-CONTRACT.md` §8.6:

> **What invalidates a recovery point:** any migration beyond the ledger it records, and any business
> write after it was taken.

and §"Stale PROVEN evidence is re-proven, not relabelled" (line 382).

**Applying 009 to production invalidates the current recovery point.** This is not negotiable and
D1b must not grandfather it. Abort condition **A5** fires by construction: *"The artifact's migration
ledger differs from `core/db/schema/` (001–008)."*

### 8.2 F-key impact, traced key by key

`manifest.sql` is **catalog-driven**: F2 reads `pg_attribute`, F5 reads `pg_constraint` / `pg_indexes`,
F11 reads `pg_policies`, F13 reads `aclexplode`. It adapts to any schema automatically.

**Therefore: F1–F18 require NO semantic change.** Not one line of `manifest.sql` is edited. What
changes are the **expected values**, and those are produced by production at dump time and compared
against the restore. The contract is generic; the recovery *point* is what goes stale.

| Key | Changes? | Why |
|---|---|---|
| `F1.tables` | **No** | 009 adds no table |
| `F2.columns.count` | **Yes** — +2 | `archived_at`, `archived_by` |
| `F2.columns.digest` | **Yes** | Digests name, type, notnull, default per column |
| `F3.rows.*` | **No** | 009 inserts and deletes nothing |
| **`F4.digest.prospects`** | **YES — even with zero archived rows** | §8.3 |
| `F4.held.digest` | **Yes** | Same table, same `t::text` mechanism |
| `F5.constraints.count/.digest` | **Yes** — +1 | `archival_has_provenance` (§1.3) |
| `F5.indexes.count/.digest` | **Yes** — +1 | `prospects_org_active_idx` |
| `F6.*` (events/sequences) | **No** | Untouched |
| `F7.notes.legacy.*` | **No** | `prospects.notes` unchanged |
| `F8.notes.log.authored` | **No** | `prospect_notes` unchanged |
| `F9.*`, `F10.*` (credentials, invitations) | **No** | Untouched |
| `F11.rls` | **No** | `relrowsecurity` / `relforcerowsecurity` unchanged |
| `F11.policies.count` | **No** — drop + create = net 0 | Same policy name |
| `F11.policies.digest` | **Yes** | The `USING` expression text changes (§1.6) |
| `F13.grants.relations.*` | **No** | No table-level grant changes |
| `F13.grants.columns.count/.digest` | **Yes** — +2 | The two column grants to `ascend_sales` |
| `F14.roles` / `F14.memberships` | **No** | No role or membership change |
| `F15.*` (functions, triggers) | **No** | Untouched |
| `F16.*` | **No** | No extension dependency, no foreign column type |
| `F17.ledger` | **Yes** | Gains the `009_prospect_archival.sql` row + checksum |
| `F18` (artifact integrity) | **Yes** | A new artifact has a new SHA256 |

### 8.3 The one that is easy to miss

```sql
'F4.digest.prospects' := sha256( string_agg(t::text, E'\n' ORDER BY t::text) )  FROM prospects t
```

`t::text` is the **whole-row** text representation. Adding two columns changes every row's rendering
from `(a,b,…,z)` to `(a,b,…,z,,)` — two extra empty fields for the NULLs. **So
`F4.digest.prospects` changes for all 3,108 rows even though not one byte of business data changed,
and even if nothing is ever archived.**

Anyone comparing a post-009 restore against a pre-009 manifest sees a whole-table content mismatch
and could reasonably read it as data corruption. Both the runbook and the migration header must say
this. It is also conclusive proof that a pre-009 artifact **cannot** be reused as a post-009 recovery
point — there is no normalization that rescues it, and attempting one would be the F5-style
normalization the R1c proof explicitly avoided needing.

### 8.4 Is a new production artifact required?

**Yes. Unavoidable, for two independent reasons:**

1. **Ledger.** The current artifact records 001–008. Post-009 production is at 009. A5 fires.
2. **Content digest.** §8.3 — `F4.digest.prospects` cannot match across the column-set change.

The existing artifact is **not deleted or invalidated as history**. It remains a valid recovery point
for pre-009 production. The runbook states the *date* of the last proven restore rather than claiming
currency (R1 contract §8.6), so this is a runbook update, not a contract change.

### 8.5 Re-run scope: R1a / R1b / R1c

| Proof | Re-run? | Scope | Cost |
|---|---|---|---|
| **R1a** — honest backup path (code only) | **No** | `backup-production.sh` derives roles from globals/migrations, not a hardcoded list. `manifest.sql` is catalog-driven. No code is version-pinned to the column set | None |
| **R1b** — current production artifact → PGlite, F1–F18 | **YES, full** | New dump, new manifest, full F1–F18 against it | **Low.** In-process PGlite, committed test, `ASCEND_BACKUP_ARTIFACT` + keyring. No build root |
| **R1c** — same artifact → real PostgreSQL 17.6, both paths | **YES** — see §8.6 | New artifact, both restore paths, F1–F18, read-only application proof | **High.** Requires rebuilding the 17.6 source root that R1c destroyed |

**`scripts/RESTORE.template.md` and `docs/RECOVERY-RUNBOOK.md`** need the ledger head, row counts and
proof date refreshed — the same staleness R1 found and fixed once already.

### 8.6 Must the same-version PostgreSQL 17 proof be repeated?

**The honest answer is: yes, and the cost is real.**

**The argument for "no":** R1c proved the *mechanism* — that this artifact shape restores onto real
17.6 over both the portable-SQL path and `pg_restore -L` with exactly four TOC entries skipped, with
no F5 normalization needed. Two nullable columns, one index, one constraint, one policy swap and two
column grants exercise no new mechanism. Everything 009 adds is already represented in the artifact
shape R1c proved: nullable columns (many), partial indexes (`events_operator_idx`), CHECK constraints
(several), column-level ACLs (`ascend_invite`, `ascend_auth`, and sales' existing lists).

**Why that argument loses:** R1c's recorded evidence is *"each F1–F18 key-for-key against production's
manifest"* for a **specific artifact**. After 009 that artifact no longer represents production.
Keeping the R1c entry green would be relabelling evidence about artifact *N* as evidence about
artifact *N+1* — which R1 abort condition **A10** forbids (*"A proof would need to be reclassified to
pass"*) and which the standing rule *"stale PROVEN evidence is re-proven, not relabelled"* forbids by
name. The `[[project_ascend_os_provenance_rules]]` rule applies directly: **state may be entered,
events must be witnessed.**

**One narrowing is legitimate and worth the owner's attention.** R1c proved *both* restore paths. A
re-run could prove one path (the runbook's `pg_restore -L`, since that is the one a human executes
under pressure) and record the portable-SQL path as *proven for the mechanism at 680d94e, not re-run
for artifact N+1*. That is **weakening the recovery contract**, and the instruction here is explicit —
*do not weaken the existing recovery contract*. So it is **not recommended**, and appears only in §12
as an owner decision with its cost stated, not as a default.

**Recommendation: full R1c re-run, in D1b.2 (§11).**

### 8.7 Ledger and checksum handling

- `MIGRATIONS` gains `"009_prospect_archival.sql"` (`core/db/migrate.ts:37`).
- `applyMigrations` inserts the ledger row with `checksum(sql)` and `applied_at_is_backfilled = false`
  — 009 is applied live and witnessed, never backfilled.
- `verifyChecksums` compares recorded against on-disk. **Once 009 is applied to production, its file
  is frozen.** Any later edit — even a comment — makes `verifyChecksums` report drift. This matters
  because 009's header carries a lot of prose (§1.10); it must be complete **before** the file is
  applied anywhere, not amended after.
- 009 is applied inside a transaction like every other migration. The `DROP POLICY`/`CREATE POLICY`
  pair and the `ALTER TABLE` both take `ACCESS EXCLUSIVE`; at 3,108 rows this is sub-millisecond, and
  the two DDL steps are atomic together.

---

## 9 · Production data precheck

**No production contact has occurred for D1b, and none is proposed without explicit authorization.**

### 9.1 Could any current row make 009 unsafe or ambiguous?

**Analysed from the schema alone: no. There is no row value that can break this migration.**

| Risk | Present? | Why not |
|---|---|---|
| Backfill ambiguity | **No** | Both columns are nullable with no default. Nothing is backfilled, so no existing row acquires a claim |
| `NOT NULL` violation | **No** | Neither column is `NOT NULL` |
| CHECK violation on existing rows | **No** | `archival_has_provenance` is `(NULL IS NULL) = (NULL IS NULL)` → true for every existing row |
| FK violation | **No** | `archived_by` is NULL everywhere; an FK does not check NULLs |
| Index build failure | **No** | Partial, non-unique, over a NULL column |
| Policy swap failure | **No** | Predicate references a column that exists by the time it runs |
| Lock contention | **Negligible** | 3,108 rows, single-operator traffic |

**Migration 009 is safe against any possible contents of `prospects`.** That is a property of its
shape, and it is the reason a precheck is not a safety prerequisite.

### 9.2 The proposed aggregate — ONE query, counts only

Value is **not** safety. It is (a) confirming the ledger head is 008 before applying 009, which is
abort condition A5; and (b) sizing the held population for **decision 2**.

```sql
-- READ-ONLY. Counts and one version string. No names, ids, or row contents.
SELECT
  count(*)                                                AS prospects_total,
  count(*) FILTER (WHERE identity_state = 'anchored')     AS anchored,
  count(*) FILTER (WHERE identity_state = 'held')         AS held,
  count(*) FILTER (WHERE status = 'closed-won')           AS closed_won,
  count(*) FILTER (WHERE status = 'closed-lost')          AS closed_lost,
  count(*) FILTER (WHERE status IS NULL)                  AS status_absent,
  (SELECT count(*) FROM prospect_notes)                   AS notes_total,
  (SELECT count(*) FROM users)                            AS users_total,
  (SELECT max(version) FROM schema_migrations)            AS ledger_head
FROM prospects;
```

**Privacy:** nine integers and one migration filename. No name, website, phone, email, note body,
uuid or hash. `ledger_head` is a filename already committed to this repository, not production data.
Satisfies R1 abort condition **A7**.

**What each answer changes:**

| Field | Decision it informs |
|---|---|
| `ledger_head` | **A5.** If it is not `008_prospect_notes_log.sql`, D1b stops and re-plans |
| `held` | **Decision 2.** If held ≈ 0, held archival can be deferred. If it is large, deferring leaves a growing list nobody can clear |
| `closed_lost`, `status_absent` | Sizes the first archival wave; informs whether bulk archival is eventually needed (**not** in D1b) |
| `notes_total` | The magnitude of what a hard delete would have destroyed — §5 evidence |
| `users_total` | Sanity check for `archived_by` (a single-digit number is expected) |

**Recommendation: worth running, but only for `ledger_head` and `held`.** The rest is
nice-to-have. A narrower two-column version is available if the owner prefers the minimum:

```sql
SELECT (SELECT max(version) FROM schema_migrations) AS ledger_head,
       count(*) FILTER (WHERE identity_state = 'held') AS held
  FROM prospects;
```

**Not run. Awaiting explicit authorization (§12, decision 4).**

### 9.3 What is NOT proposed

No row content, no sample rows, no `status` values joined to names, no `users` listing, no
`EXPLAIN` against production, no write of any kind, and no dry-run application of 009 to production.

---

## 10 · Test plan

Existing behavioural coverage of archival: **none** (it does not exist). Existing deletion coverage:
D1a's refusal path, which D1b removes. All tests below are new.

**Harness:** extend `tests/db/d1-promotion.test.ts`'s pattern — the **real route handlers** through
the real admission chain (session cookie → `withRequestContext` → membership-resolved principal)
against PGlite with migrations 001–**009** plus a throwaway vault. That suite already proves this
shape works; D1b adds `009` to its boot and a `tests/db/d1-archival.test.ts` beside it.

**Concurrency (T12–T14) cannot run on PGlite** (§7.1) and goes in a separate
`tests/db/d1-concurrency.test.ts` on the `r1c-cluster` harness, registered in `gate-2g1.ts` with
`requires: ["ASCEND_R1C_ROOT"]`.

### 10.1 Behavioural tests

| # | Test | Asserts |
|---|---|---|
| T1 | **Owner archives** | 200 `archived`; `archived_at` set; `archived_by` = owner's id; one `prospect.archived`; vault hash unchanged |
| T2 | **Sales archives** | 200 `archived`; `archived_by` = **sales'** id, not the owner's; event `actor_user_id` = sales |
| T3 | **Already archived** | Second call → 200 `already_archived`; `archived_by` still the **first** archiver; still exactly **one** event |
| T4 | **Held refusal (sales)** | 409 `held`; row unchanged; no event |
| T4b | **Held archival (owner)** — *only if decision 2 allows* | 200 `archived`; event `subject_entity_id` = the **surrogate id** (anchor is NULL) |
| T5 | **Notes preserved** | `prospect_notes` count **identical** before/after; `prospects.notes` byte-identical; `listProspectNotes` still returns them |
| T6 | **Events preserved** | Every pre-existing event for the anchor still readable; `prospect.archived` appended; `prospect.created` / `.promoted` untouched |
| T7 | **Actor attribution** | `archived_by` = the **membership-resolved** principal, never a request-supplied value. A forged body field changes nothing |
| T8 | **Reader exclusion** | After archival: absent from `core/crm.listProspects()`; **present** in `listProspects(tx, {includeArchived:true})`; **present** in the import matcher universe, and a re-import of its row is `blocked`, not `new` — §2.3 |
| T9 | **Audit reads still work** | `findByProspectId`, `findCorroborating`, `findProspectRef`, `resolveProspectForMutation` all still find it; the incomplete-promotion derivation still sees it — §2.4 |
| T10 | **Direct view** | `getProspect(slug)` returns it with archival state exposed — decision 3 |
| T11 | **Ambiguous / not found** | 409 with count / 404; nothing written in either case |
| T15 | **Promotion refuses an archived prospect** | §7.4(a): `refused` with reason `archived`; **no client created** |
| T16 | **Vault mode unchanged** | Vault arm still deletes + emits `prospect.deleted` |

### 10.2 Authorization tests

| # | Test | Asserts |
|---|---|---|
| A1 | **No raw DELETE for sales** | `DELETE FROM prospects` as `ascend_sales` → `permission denied`. Mirrors `restore.ts:322` |
| A2 | **Least privilege is exactly two columns** | As `ascend_sales`: UPDATE of `archived_at`/`archived_by` succeeds; UPDATE of `website_quality`, `source`, `prospect_id`, `identity_state`, `hold_reason` each **still refused** |
| A3 | **Automation cannot archive** | As `ascend_automation`, setting `archived_at` → `permission denied` |
| A4 | **Sales cannot write an archived row** | §1.6: after archival, sales UPDATE of `status`/`notes` matches **zero rows**; the owner's succeeds |
| A5 | **Cross-org** | An archived prospect in org B is invisible and unarchivable from org A |
| A6 | **Grant shape** | `aclexplode` over `prospects` shows **exactly** `archived_at`, `archived_by` added for `ascend_sales`, and nothing for `ascend_automation` |

### 10.3 Concurrency tests (real server — §7.1)

| # | Test | Invariant |
|---|---|---|
| T12 | **Two simultaneous archives** | Exactly one transition; **exactly one** `prospect.archived`; loser → `already_archived`; `archived_by` = first archiver |
| T13 | **Two simultaneous promotions** | **Exactly one client**; exactly one `prospect.promoted`; loser → `already_promoted` or `in_progress`, never a second client. **Fails today** — §7.3 |
| T14 | **Promotion racing archival** | Never both archived and newly `closed-won`; loser truthful; **no orphan client** for an archived prospect |
| T14b | **Note append racing archival** | §7.5: the note lands, attached and readable; no deadlock |

### 10.4 Recovery tests

| # | Test | Asserts |
|---|---|---|
| R1 | **Manifest after 009** | F2 count +2; `F4.digest.prospects` **changes with zero archived rows** (§8.3); F5 +1 constraint +1 index; F13 columns +2; F17 gains 009 |
| R2 | **Restore fidelity** | A fresh artifact restores F1–F18 key-for-key, including archived rows and their notes |
| R3 | **`F12.sales-cannot-delete-prospects`** | Still passes post-009 (`restore.ts:322`) |
| R4 | **AC4 re-scope** | `tests/db/restore-*.test.ts` AC4 asserts the **active** set plus an explicit archived count (§2.6) |

### 10.5 Mutation probes

D1a's standard: **10 of 10 probes caught, one of which exposed a weak test.** Each probe removes one
load-bearing mechanism; the named test must turn red. A probe that does not is a test defect, not a
passing probe.

| # | Probe — remove / weaken | Must turn red |
|---|---|---|
| M1 | Drop `archived_at IS NULL` from the compare-and-set | T3, T12 |
| M2 | Drop `WHERE archived_at IS NULL` from the canonical reader | T8 |
| M3 | Make the import matcher use the **active-only** reader | **T8** — the §2.3 duplicate |
| M4 | Set `archived_by` from the request body instead of the principal | T7 |
| M5 | Append `prospect.archived` **before** the UPDATE | T3 (a second event on the retry) |
| M6 | Move the event append into its own transaction | T6 under an injected failure |
| M7 | Grant sales table-level `UPDATE` instead of two columns | A2 |
| M8 | Grant sales `DELETE` and hard-delete | **A1 and T5** — notes cascade |
| M9 | Add `archived_at IS NULL` to the sales `WITH CHECK` | **T2** — the §1.6 trap, pinned |
| M10 | Drop `archival_has_provenance` and archive with a NULL actor | T7 |
| M11 | Drop the advisory lock (if 7.3-A is adopted) | **T13** |
| M12 | Drop `archived_at IS NULL` from **promotion's** compare-and-set | T15, T14 |
| M13 | Make `resolveProspectForMutation` return `not_found` for archived rows | T3 (reports `not_found`, not `already_archived`) |

**M9 and M3 are the two that matter most** — they are the failures this pre-flight found by reading
rather than by running, and neither would be caught by any test that exists today.

---

## 11 · Implementation boundary

### 11.1 Recommendation: split D1b

**The evidence supports the split**, and it is the split the user's framing anticipated.

| | Slice | Contents | Verification | Production contact |
|---|---|---|---|---|
| **D1b.1** | Archival implementation | Migration 009 (unapplied to production); `prospect.archived` in the domain union; `archiveProspect`; reader changes incl. the import matcher; the D1a 409 removed; route + UI; §7.3-A advisory lock; §7.4(a) promotion predicate | T1–T11, T15, T16, A1–A6, T12–T14 (concurrency), M1–M13 | **None** |
| **D1b.2** | Recovery re-proof | Apply 009 to production; new artifact; R1b full re-run; R1c full re-run; runbook + template refresh; gate-2g1 entries updated | R1–R4 | **Yes** — apply + dump |

**Why the evidence supports it, concretely:**

1. **Different risk classes.** D1b.1 touches no production data. D1b.2 applies DDL to production and
   takes a new backup. Bundling them means one review covers both, and the D1a checkpoint's own
   discipline is one reviewable slice per risk class.
2. **Different resource prerequisites.** D1b.2's R1c leg needs a **rebuilt PostgreSQL 17.6 source
   root** that R1c destroyed (`gate-2g1.ts:144`). That rebuild is a prerequisite with its own
   duration, and blocking the archival fix on it means the capability gap stays open longer for no
   correctness gain.
3. **Ordering is forced anyway.** 009 must be applied to production **before** a post-009 artifact
   can exist. So R1b/R1c cannot even begin until D1b.1's migration is written and applied — they are
   sequentially dependent, not parallel work being artificially separated.
4. **Reviewable size.** D1b.1 is already large: a migration, a domain change, a repository verb,
   fourteen traced reader call sites, a route, a UI change, **and a newly-discovered promotion
   concurrency fix** (§7.3). Adding a full two-leg recovery re-proof would make the diff unreviewable.

**The split does not weaken the recovery contract.** D1b.2 is committed scope with a defined
acceptance, not a deferral. Between the two slices, 009 exists **only locally** — production stays at
008, its existing recovery point stays valid and current, and nothing is grandfathered. The gate stays
honest because there is nothing to be dishonest about yet.

**Standing condition:** D1b.1 **must not be deployed** to production before D1b.2 completes, because
deploying the application without applying 009 means every archival query references columns that do
not exist. This is a deploy-ordering constraint and must be written into the D1b.1 checkpoint.

### 11.2 Smallest coherent D1b.1

In dependency order:

1. `core/db/schema/009_prospect_archival.sql` — §1.10
2. `core/db/migrate.ts` — `MIGRATIONS` gains 009
3. `packages/domain/events.ts` — `prospect.archived` in the union
4. `core/db/prospects.ts` — `archiveProspect`; `MutationTarget.archivedAt`; `allowHeld` option;
   `includeArchived` on `listProspects`; `SELECT` + `ProspectRow` gain both columns; **promotion's
   compare-and-set gains `archived_at IS NULL`**
5. `core/db/index.ts` — export `archiveProspect`, `ArchiveOutcome`
6. `core/crm/prospect.ts` — `getProspect` includes archived and exposes state; `listProspectSources`
   excludes; `prospectFromRow` does **not** touch `frontmatter`
7. **`core/intake/import.ts:93` — `{ includeArchived: true }` with the reasoning in a comment**
8. `core/crm/promote.ts` — advisory lock (§7.3-A); deterministic staging (§7.3-B); archived refusal
9. `app/api/prospects/[slug]/route.ts` — archival replaces the 409
10. `components/DeleteProspectButton.tsx` — per decision 1
11. Tests §10.1–10.3, probes §10.5
12. `docs/DEPENDENCY-D1B-CHECKPOINT.md`

**Explicitly NOT in D1b:** un-archival; bulk archival; hard deletion as an administrative capability;
URL-intake porting; retiring the vault mirror; the `PromoteButton` `"growth"` default; the
`prospects` table-grant refactor (§4.3); the automation-policy tightening (§1.9); the raw-SQL-reader
fitness rule (§2.5).

---

## 12 · Owner decisions

Implementation does not begin until these are answered.

**1 · UI language: Archive or Delete?** (§6.3)
> **Recommended: "Archive"**, `quiet` variant, copy *"Remove from the hit list. Notes and history are
> kept."* A button reading "Delete" that performs retention is the same class of untruth D1a removed.
> If the product language stays "Delete", the **confirm copy must state that history is kept** —
> that is not optional. The `danger` variant should change either way.

**2 · Held-row semantics: may a held prospect be archived?** (§1.7)
> **Recommended: yes for the owner, no for sales.** Held rows are suspected duplicates — the records
> most needing removal from the working list — and sales' RLS refuses them regardless. The event keys
> on the surrogate id, following `createProspect`'s existing precedent. **Declining is defensible**,
> but then the held list can only grow. The `held` count from §9.2 would inform this.

**3 · Do archived prospects remain directly viewable?** (§1.8, §2.1)
> **Recommended: yes** at `/sales/[prospect]`, with an explicit archived banner, excluded from lists,
> graph and `/search`. This keeps notes and history reachable — the stated purpose of archival — and
> avoids a direct link 404-ing on a row that exists. Declining makes archived prospects reachable
> only through the database.

**4 · Is the production aggregate worth running?** (§9)
> **Recommended: yes, narrowly** — `ledger_head` and `held` only. Nine integers and a filename; no row
> content. It is **not** a safety prerequisite (§9.1 proves 009 is safe against any contents); it
> confirms abort condition A5 and informs decision 2. **Requires explicit authorization and has not
> been run.**

**5 · Does the recovery re-proof stay inside D1b?** (§8, §11)
> **Recommended: yes as committed scope, split into D1b.2.** Not deferred, not grandfathered. D1b.1
> ships archival with 009 unapplied to production; D1b.2 applies it, takes a new artifact, and
> re-runs R1b and R1c in full.
>
> **Sub-decision (5a):** R1c's re-run is the expensive leg — it needs the PostgreSQL 17.6 source root
> that R1c destroyed. A narrowed re-run (the runbook's `pg_restore -L` path only, recording the
> portable-SQL path as proven-for-mechanism) would cost less. **This weakens the recovery contract
> and is NOT recommended**; it is listed only so the cost is visible and the choice is yours.

**6 · HTTP verb: keep `DELETE`, or add `POST /archive`?** (§6.2)
> **Recommended: keep `DELETE`.** The resource leaves the collection; archival is the implementation.
> A new route needs its own capability mapping and authorization tests, and would leave `DELETE` as a
> route that only ever refuses. Minor.

**7 · Un-archival** (§1.6)
> **Recommended: out of scope, and blocked for sales by construction.** The `USING` tightening makes
> archival the last write sales can make to a row. The owner retains full UPDATE and can reverse an
> archival directly if ever needed. A first-class un-archive verb with its own event would be its own
> slice. **Confirm you accept no un-archive button in D1b.**

---

## Status

**PRE-FLIGHT COMPLETE. D1b.1 IMPLEMENTED — see `docs/DEPENDENCY-D1B1-CHECKPOINT.md`.**

Corrections this contract made that the implementation then confirmed, and one it got wrong:

- §1.6's RLS trap is real and is now pinned by probe M9.
- §2.3's import-matcher hazard is real; the first test written for it was NOT discriminating, and
  probe M3 caught that.
- §7.3's concurrent-promotion hole is real and was MEASURED: without the lock, 2 concurrent
  promotions produce 2 clients and 6 produce 6.
- §8.3's `F4.digest.prospects` finding stands.
- **§7.3 option C was wrongly rejected.** The contract dismissed "hold one transaction across the
  critical section" as a pool hazard and preferred a session-scoped advisory lock. That is backwards:
  the application endpoint is a TRANSACTION POOLER, so session state does not survive it and a
  session lock would both fail to exclude and leak. A transaction is the only unit that yields a
  stable backend, so `pg_advisory_xact_lock` over one transaction is the correct mechanism.

**Original pre-flight status follows.**

Not done, by instruction: migration 009 is not written; Phase 2 not begun; R2 not begun; nothing
pushed; production not contacted.

Verified before writing: baseline `4276f89`, working tree clean, `prospect.archived` absent from
`packages/domain/events.ts`, no prospect-archival concept anywhere in the codebase, and the fourteen
reader call sites in §2.1 traced individually rather than recalled.

**STOPPING FOR APPROVAL.**
