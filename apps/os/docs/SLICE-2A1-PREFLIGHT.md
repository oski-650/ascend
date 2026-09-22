# Slice 2A.1 — schema and command contract · PRE-FLIGHT

**Status: CONTRACT DESIGN ONLY.** No migration 010 written, nothing implemented, no production contact,
no deployment, no push. Baseline `9ed881e` (2A.0 committed).

Frozen inputs: `docs/SLICE-2A-PREFLIGHT.md` §20, plus this round's decisions — the closed-lost reason
enum, **command-layer enforcement** of sales rules the database can't express safely, and **no
automatic `lost_reason` on `prospects`**.

---

## 0 · Conventions every new table follows (from 001–009)

| Convention | Source | Applied |
|---|---|---|
| `organization_id uuid NOT NULL → organizations(id) ON DELETE CASCADE` on every row | 001, 008 | yes |
| prospect reference = the **row** (`prospects(id)`), not the anchor | 008 (so held rows stay representable) | yes, with **`ON DELETE RESTRICT`** (§20: history must survive) |
| actor columns `→ users(id)`, **no `ON DELETE`** | 001, 008, 009 | yes |
| RLS **enabled and forced**, `current_org()` / `current_user_id()` | 001 | yes |
| sales writes "as self" through `WITH CHECK (… = current_user_id())` | 008 | yes |
| `ascend_automation` gets **nothing** on human-judgment tables | 003, 008, 009 | yes |
| no nullable-with-default claims | 002 | yes |
| client-generated UUID primary key as the idempotency key | 2A.0 notes | yes — **one command id per request** |

**One command id per user action.** Every 2A.1 write carries a client-generated UUIDv4/v7 `commandId`,
reused unchanged on retry. Every row a command creates takes the command id **as its primary key**.
Each command creates at most one row per table, so a contact, a follow-up and a stage transition from the
same Save share one id, and a retry finds all three. This is the 2A.0 note pattern, generalised.

---

## A · `prospect_contacts` — exact schema proposal

| Column | Type | Rule |
|---|---|---|
| `contact_id` | `uuid PRIMARY KEY` | = the command id (idempotency key) |
| `organization_id` | `uuid NOT NULL → organizations(id) ON DELETE CASCADE` | RLS scope |
| `prospect` | `uuid NOT NULL → prospects(id) ON DELETE RESTRICT` | the worked row |
| `author_user_id` | `uuid NOT NULL → users(id)` | the resolved principal, never the request |
| `outcome` | `text NOT NULL` CHECK ∈ the **frozen ten** | `no_answer`, `voicemail`, `spoke`, `interested`, `not_interested`, `callback_requested`, `meeting_set`, `wrong_number`, `email_sent`, `other` |
| `channel` | `text NOT NULL` CHECK ∈ §4 | how it happened |
| `note` | `text NULL` | optional prose; `CHECK (note IS NULL OR btrim(note) <> '')`; length bounded at the route |
| `happened_at` | `timestamptz NOT NULL` | when the attempt occurred (defaults to server `now()` at the command; may be backdated) |
| `recorded_at` | `timestamptz NOT NULL DEFAULT now()` | when it was written |

**Constraints:**

- `happened_not_future` — `CHECK (happened_at <= recorded_at + interval '5 minutes')`, a small clock
  skew allowance.
- `happened_not_ancient` — `CHECK (happened_at >= recorded_at - interval '90 days')`. That's a bound on
  backdating, not a business rule. Owner-adjustable (§17).
- `channel_fits_outcome` — `CHECK ((outcome <> 'email_sent' OR channel = 'email') AND (outcome <> 'voicemail' OR channel = 'call'))`.
  Only the two combinations that would be contradictions are constrained. Nothing else is guessed.

**Immutable, by grant rather than by promise:** there is **no UPDATE and no DELETE grant to any role**,
so a correction can only ever be a new record (§20).

**Indexes:** `(prospect, happened_at DESC)` for the timeline; `(organization_id, author_user_id,
happened_at)` for per-person activity and future workload; `(organization_id, happened_at DESC)` for the
recent-activity feed.

**`happened_at` vs `recorded_at`:** distinct on purpose. Sales often logs a call minutes later.
`happened_at` drives the `last_contact` projection and the Sales Engine; `recorded_at` is audit.

## B · `prospect_followups` — exact schema proposal

| Column | Type | Rule |
|---|---|---|
| `followup_id` | `uuid PRIMARY KEY` | = the creating command id |
| `organization_id` | `uuid NOT NULL → organizations(id) ON DELETE CASCADE` | |
| `prospect` | `uuid NOT NULL → prospects(id) ON DELETE RESTRICT` | |
| `action` | `text NOT NULL` CHECK ∈ §5 | what to do |
| `assignee_user_id` | `uuid NOT NULL → users(id)` | whose job it is |
| `due_on` | `date NOT NULL` | the **business date** it's due (America/Los_Angeles) |
| `due_at` | `timestamptz NULL` | an exact instant, only when a time was chosen |
| `note` | `text NULL` | optional short context |
| `state` | `text NOT NULL DEFAULT 'open'` CHECK ∈ `open`, `completed`, `cancelled`, `superseded` | §10 |
| `created_by` | `uuid NOT NULL → users(id)` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `created_by_contact` | `uuid NULL → prospect_contacts(contact_id)` | set when scheduled from a Save |
| `resolved_by` | `uuid NULL → users(id)` | |
| `resolved_at` | `timestamptz NULL` | |
| `resolved_by_command` | `uuid NULL` | the idempotency key of the resolving command |
| `resolved_by_contact` | `uuid NULL → prospect_contacts(contact_id)` | set when **completed** by a recorded contact |
| `superseded_by` | `uuid NULL → prospect_followups(followup_id)` | set only when **superseded** |

**Constraints:**

- `resolution_has_provenance` — `CHECK ((state = 'open') = (resolved_at IS NULL) AND (state = 'open') = (resolved_by IS NULL) AND (state = 'open') = (resolved_by_command IS NULL))`
- `superseded_names_successor` — `CHECK ((state = 'superseded') = (superseded_by IS NOT NULL))`
- `completion_by_contact_only_when_completed` — `CHECK (resolved_by_contact IS NULL OR state = 'completed')`
- `due_at_agrees_with_due_on` — `CHECK (due_at IS NULL OR (due_at AT TIME ZONE 'America/Los_Angeles')::date = due_on)`
- `not_self_superseding` — `CHECK (superseded_by IS NULL OR superseded_by <> followup_id)`

**"One open follow-up per prospect" is represented and indexed as:**
`CREATE UNIQUE INDEX prospect_followups_one_open ON prospect_followups (prospect) WHERE state = 'open'`.
A second open row is **structurally impossible**. The command layer supersedes, completes or cancels the
old one *first*, in the same transaction.

**Queue index:** `(organization_id, assignee_user_id, due_on) WHERE state = 'open'`.

## C · Where the closed-lost reason lives — decision

| Option | Verdict |
|---|---|
| on the **contact** | ✗ — closed-lost can happen without a contact (the owner marking a `duplicate`), and "why we lost it" isn't what happened on one call |
| on the **follow-up resolution** | ✗ — a prospect may have no open follow-up when it's lost |
| a projection on **`prospects`** | ✗ as the canonical store (your decision). Not proposed even as a projection: no reader needs it yet, and it can be added later **derived** from the canonical record |
| **events only** (`prospect.status_changed` with a reason) | ✗ — you ruled the spine out as the only store, and a reason must be FK-bound, constrained and queryable |
| **a dedicated, immutable transition record** | ✅ **recommended** |

**→ `prospect_stage_transitions`**, the canonical, immutable history of every stage change made
through 2A's stage commands. The reason lives **here and only here**. `prospects.status` stays the only
current stage. The event carries the transition id plus the structured enums, as the audit signal,
never as a second canonical store.

| Column | Type | Rule |
|---|---|---|
| `transition_id` | `uuid PRIMARY KEY` | = the command id |
| `organization_id` | `uuid NOT NULL → organizations(id) ON DELETE CASCADE` | |
| `prospect` | `uuid NOT NULL → prospects(id) ON DELETE RESTRICT` | |
| `from_status` | `text NULL` CHECK ∈ the five | NULL when the prior stage was unstated |
| `to_status` | `text NOT NULL` CHECK ∈ `lead`, `contacted`, `proposal`, `closed-lost` | **`closed-won` is not a legal value** — Promote is the only path, and this makes it structural |
| `lost_reason` | `text NULL` CHECK ∈ the frozen ten | `not_interested`, `no_budget`, `too_expensive`, `chose_competitor`, `not_a_fit`, `unreachable`, `wrong_contact`, `timing`, `duplicate`, `other` |
| `lost_note` | `text NULL` | optional short context, **only** with `other` |
| `actor_user_id` | `uuid NOT NULL → users(id)` | |
| `happened_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `contact` | `uuid NULL → prospect_contacts(contact_id)` | the contact that caused it, when there was one |

- `lost_reason_iff_closed_lost` — `CHECK ((to_status = 'closed-lost') = (lost_reason IS NOT NULL))`
- `lost_note_only_for_other` — `CHECK (lost_note IS NULL OR lost_reason = 'other')`, plus non-blank
- `a_transition_changes_something` — `CHECK (from_status IS DISTINCT FROM to_status)`
- no UPDATE, no DELETE for any role; index `(prospect, happened_at DESC)`

**Declared, not hidden:** Promote's `closed-won` is **not** written here, because D1 is frozen. It stays
recorded by `prospect.promoted`. Import-set stages are initial state, not transitions. So this table
is *"every stage change made through 2A"*, and it's named and documented as that. The complete stage
timeline is a read-time union of this table and `prospect.promoted`. No backfill: pre-2A stage history
is unknown, and the provenance rule forbids inventing it.

---

## 4 · Channel enum — decision

**Include `channel`, NOT NULL, now:** `call`, `email`, `text`, `in_person`, `other`.

It can't be backfilled later ("what channel was that?" is unrecoverable), and it's cheap now. The UI
defaults it from where Save started (the Call button → `call`) and from the outcome (`email_sent` →
`email`). Only the two contradictions in §A are constrained.

## 5 · Follow-up action enum — decision

**`call`, `email`, `text`, `meeting`, `other`.** This is the channel set, plus `meeting` (a next *step*
that isn't a channel), minus `in_person` (covered by `meeting`).

---

## 6 · Assignment command contract

`prospects.assigned_to` is mutated **only** by these three commands, each in one transaction under
`lockProspect`, each emitting `prospect.reassigned`:

| Command | Who | Rule (enforced in the command, under the lock) | Write |
|---|---|---|---|
| `claim` | owner, sales | only if **currently unassigned**; the target is the actor | CAS `UPDATE … SET assigned_to = $me WHERE id = $1 AND assigned_to IS NULL AND archived_at IS NULL` |
| `reassign` | **owner/admin only** | to any **member** of the organization | CAS on the expected current assignee |
| `unassign` | **owner/admin only** | to NULL | CAS on the expected current assignee |

**Two users claiming the same unassigned prospect:** both take `lockProspect`, so they serialize. The
first CAS matches one row and wins. The second matches zero rows, reads back, and gets
`already_assigned` (naming whether it's them or someone else). Only one wins, **by the database**,
and the lock makes the loser's answer deterministic. A retry of the winner's claim finds itself assigned
and returns `already_yours` with no second event.

**Sales may not:** reassign, unassign, claim an assigned prospect, or assign anyone but themselves.
Refused in the command with `refused: assignment_not_permitted` before any write. The database can't
express "only NULL → self" (a `WITH CHECK` can't see the old row), so this is **command-layer**, per
your decision.

## 7 · The atomic mobile Save — command contract

**`POST /api/prospects/[slug]/actions`**, one request, **one transaction, under the per-prospect
advisory lock.** Separate HTTP writes would allow a contact without its follow-up, which is exactly the
partial state the lock exists to prevent.

```
{ commandId,                               required UUID, reused on retry
  expectedStage,                           the stage the user SAW (CAS for any stage change)
  contact?:  { outcome, channel, note?, happenedAt? },
  stage?:    { to, lostReason?, lostNote? },
  followUp?: { action, dueOn, dueAt?, assignee? } | { none: true },
  claim?:    true }                        at least one part required
```

**Order inside the transaction:**

1. **Resolve** through `resolveProspectForMutation`: not found → 404; ambiguous → 409; **held → 409
   `held_prospect`**. Archived is *not* a resolution failure there (it resolves `ok` with `archivedAt`
   set); the command refuses it → 409 `archived_prospect`. Nothing is written.
2. **`lockProspect(anchor)`**, then re-read the row under the lock.
3. **Replay check:** if `prospect_contacts.contact_id = commandId`, or any row with that id exists, verify
   it's the same command (same author, prospect and fields) and return the **stored** result. Otherwise
   → 409 `command_id_conflict`. Nothing is written.
4. **Authorize every part before writing any** (§13). Any refusal → the whole command is refused.
5. **Contact:** insert; project `last_contact = GREATEST(coalesce(last_contact, d), d)` and `first_contact`
   if NULL, where `d` = the business date of `happened_at`.
6. **Claim** (if asked and permitted): the §6 CAS.
7. **Stage** (if asked): refuse `closed-won`; **CAS `status IS NOT DISTINCT FROM expectedStage`** →
   mismatch = 409 `stage_conflict`, carrying the current stage; insert the transition; update
   `prospects.status`.
8. **Follow-up:**
   - If the new stage is `closed-lost`: **cancel** the open follow-up, and refuse a new one.
   - Else, if a contact was recorded and an open follow-up exists that the actor may resolve: mark it
     **completed** with `resolved_by_contact`.
   - Else, if a new follow-up is given and one is still open: **supersede** it.
   - Then insert the new follow-up, if any.
9. **Events**, all with `correlation_id = commandId` (§12).
10. **Return** every effect: `contact`, `transition`, `followUp` (created / completed / superseded /
    cancelled) and `assignment`.

**Standalone commands**, same machinery and lock, for actions without a contact:
`POST …/assignment` (§6), `POST …/stage` (owner cleanup such as `duplicate`, or an owner reopen), and
`POST …/followups` (schedule or resolve without a contact).

## 8 · Closed-lost canonical storage — decision

In `prospect_stage_transitions.lost_reason` (+ `lost_note` for `other`), immutable, with actor,
timestamp, prospect and command id; referenced by the event. **Not** on `prospects`, not on the contact,
and not only in events. A reporting projection can be derived later if needed, and would be labelled as
derived.

## 9 · Closed-lost transition semantics

| Question | Answer |
|---|---|
| Which operations set it | the Save (with or without a contact) and `…/stage` |
| Required | a **structured `lostReason`** from the ten; `lostNote` only with `other` |
| Contact required in the same command? | **No.** When one is present, the transition references it (`contact`) |
| Who | **sales and owner**, from `lead` / `contacted` / `proposal` |
| Its follow-up | the open one is **cancelled** in the same transaction; no new one may be scheduled |
| Reopen | **owner/admin only**, to `lead` / `contacted` / `proposal`, as its own transition (from `closed-lost`). Sales is refused `reopen_not_permitted` |
| Leaving `closed-won` | refused for everyone in 2A (a won deal is a client — Promote's domain) |
| Provenance | the transition row + `prospect.status_changed` { transition_id, from, to, lost_reason }, actor and command id |

## 10 · Follow-up state model — frozen

| State | Means | Relationship column |
|---|---|---|
| `open` | the one current next action | — |
| `completed` | **the action was done** — by a recorded contact, or declared done | `resolved_by_contact` when by a contact |
| `cancelled` | **deliberately dropped** — incl. automatically when the prospect goes `closed-lost` | — |
| `superseded` | **replaced by a newer follow-up without being done** | `superseded_by` (required) |

**No overlap:** a contact against an open follow-up → `completed`. A reschedule without a contact →
`superseded`. A deliberate drop or a close → `cancelled`. Superseding is represented by **both** the
state (queryable) and the relationship (navigable), and the CHECK ties them.

Resolution is the terminal state; there is no separate `resolution` column that could disagree with it.

**Promote and archive (D1 frozen)** don't touch follow-ups. Queues exclude rows whose prospect is
archived or `closed-*` at query time. Nothing silently mutates on those paths.

## 11 · Timezone and date behaviour

- **One constant:** `BUSINESS_TZ = 'America/Los_Angeles'`, defined once in code and used **inside SQL**.
- **"Today"** is `(now() AT TIME ZONE 'America/Los_Angeles')::date`, from the **database clock**. Never
  from the browser, never a naïve UTC day.

| Case | Storage |
|---|---|
| **date-only selection** ("Thursday") | `due_on = that date`, `due_at = NULL` — no sentinel time, so no midnight/23:59 misclassification |
| **exact time** ("Thursday 3:00 pm") | `due_at = (date + time) AT TIME ZONE 'America/Los_Angeles'`, converted in the database; `due_on` = its business date (CHECK-enforced) |

| Derived state (never stored) | Date-only | Timed |
|---|---|---|
| **overdue** | `due_on < today` | `due_at < now()` |
| **today** | `due_on = today` | `due_on = today AND due_at >= now()` |
| **upcoming** | `due_on > today` | `due_on > today` |

**DST:** instants are `timestamptz`, and conversion uses the named zone, so DST is the database's job.
Date-only follow-ups have no instant, so they can't shift. A timed follow-up at a **non-existent** local
time (spring-forward 2:00–3:00) or an **ambiguous** one (fall-back 1:00–2:00) is **refused** by the
command with `invalid_local_time`. The UI can't create one silently shifted by an hour. Contacts'
`happened_at` is an instant; its business date (for `last_contact`) is computed the same way.

## 12 · Events — names and payload boundaries

All use subject = the prospect **anchor**, `actor: operator` + `actor_user_id` = the resolved principal,
`occurred_at`, and `correlation_id` = **commandId**. **No free-form prose in any payload.**

| Event | Status | `data` |
|---|---|---|
| `prospect.contacted` | declared, **first emitter** | `{ contact_id, outcome, channel, happened_at }` |
| `prospect.status_changed` | **reused** (the vault reconciler emits `{from,to}` as `system`) | `{ transition_id, from, to, lost_reason? }` |
| `prospect.followup_scheduled` | **new** | `{ followup_id, action, assignee, due_on, due_at?, supersedes? }` |
| `prospect.followup_resolved` | **new** | `{ followup_id, state: completed \| cancelled, by_contact? }` |
| `prospect.reassigned` | **new** | `{ mode: claim \| reassign \| unassign, from, to }` |

**Not events:** "superseded" (carried by `followup_scheduled.supersedes`), and the `last_contact`
projection update. `lost_note` and every contact note stay out of the spine.

## 13 · RLS and grant model

**Database — everything that IS safely expressible:**

| Table | RLS SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `prospect_contacts` | org, owner + sales | owner + sales, `WITH CHECK org AND author_user_id = current_user_id() AND` target **anchored and not archived** | **none, any role** | **none, any role** |
| `prospect_stage_transitions` | org | owner + sales, `WITH CHECK org AND actor_user_id = current_user_id() AND` target anchored, not archived | **none** | **none** |
| `prospect_followups` | org | owner + sales, `WITH CHECK org AND created_by = current_user_id() AND` target anchored, not archived | **column grant** on `state, resolved_by, resolved_at, resolved_by_command, resolved_by_contact, superseded_by` for sales and owner; owner also `assignee_user_id, due_on, due_at, note`. **Sales USING `assignee_user_id = current_user_id()`**; owner USING org | **none** |
| `prospects` | unchanged | unchanged | **unchanged** — sales already holds UPDATE on `status`, `assigned_to`, `first_contact`, `last_contact`, `updated_at`; 009's RLS still refuses held and archived rows | unchanged |

`ascend_automation`: **no grant on any new table.** The "target anchored and not archived" check is an
`EXISTS` over `prospects` (readable to both roles).

**Command layer — the rules the database can't express without breaking Promote:**

| Rule | Why not in the database |
|---|---|
| sales may set `assigned_to` only NULL → self | `WITH CHECK` can't see the old value |
| sales may not reassign or unassign | same |
| sales may not reopen a closed prospect | needs the old stage |
| nobody sets `closed-won` except Promote | a trigger forbidding sales `closed-won` would **break Promote**, which sales legitimately runs. `prospect_stage_transitions.to_status` already refuses it structurally for 2A's own path |
| sales may not resolve another's follow-up | **expressed in RLS** (`USING assignee = self`) *and* checked in the command, for a truthful message |

Every command checks all parts **before** writing any, from the membership-resolved principal. The
request body never carries a role or an actor.

## 14 · Concurrency model

| Hazard | Mechanism |
|---|---|
| double-tap / retry after a lost response | command id = primary key of every row created; replay check under the lock; `ON CONFLICT DO NOTHING` as the backstop |
| owner and sales, or two tabs, on one prospect | **one transaction under `lockProspect(anchor)`** for every 2A command — the D1 transaction-scoped advisory lock (pooler-safe, never leaks) |
| two claims | lock + CAS on `assigned_to IS NULL` (§6) |
| stage race | CAS on `expectedStage`; the loser gets `stage_conflict` with the current stage |
| two schedules | lock + the partial unique index (a second open row is impossible) |
| complete vs reassign | lock; CAS on `state = 'open'` (and the expected assignee) |
| Save racing archive or Promote | both take the same lock (D1); the Save re-reads under the lock → `archived_prospect`; a Save after Promote sees `closed-won` → stage refused, contact still allowed |
| backdated or out-of-order contacts | monotonic `GREATEST` projection |

**Proof plan:** PGlite for sequential behaviour; the retained **PostgreSQL 17.6** harness for double-Save,
two claims, stage race, schedule race, complete-vs-reassign, and Save-vs-archive. The same
distinct-backend self-check as D1 and 2A.0.

## 15 · Proposed migration 010 — object list (no SQL)

1. **Table `prospect_contacts`** — §A columns; PK; FKs (org CASCADE, prospect **RESTRICT**, author);
   CHECKs `outcome ∈ 10`, `channel ∈ 5`, `note non-blank`, `happened_not_future`, `happened_not_ancient`,
   `channel_fits_outcome`; 3 indexes.
2. **Table `prospect_followups`** — §B columns; PK; FKs (org CASCADE, prospect **RESTRICT**, assignee,
   created_by, resolved_by, created_by_contact, resolved_by_contact, self-FK superseded_by); CHECKs
   `action ∈ 5`, `state ∈ 4`, `resolution_has_provenance`, `superseded_names_successor`,
   `completion_by_contact_only_when_completed`, `due_at_agrees_with_due_on`, `not_self_superseding`;
   **partial unique `prospect_followups_one_open (prospect) WHERE state = 'open'`**; queue index.
3. **Table `prospect_stage_transitions`** — §C columns; PK; FKs (org CASCADE, prospect **RESTRICT**, actor,
   contact); CHECKs `from ∈ 5`, `to ∈ 4 (no closed-won)`, `lost_reason ∈ 10`,
   `lost_reason_iff_closed_lost`, `lost_note_only_for_other`, `a_transition_changes_something`; index.
4. **RLS** enabled + forced on all three; policies per §13.
5. **Grants** per §13 — SELECT/INSERT to owner and sales; the follow-up column UPDATE grants; **no DELETE,
   no UPDATE on contacts and transitions, nothing to automation.**
6. **`COMMENT`s** on each table and on `prospect_stage_transitions`' scope ("through 2A; Promote records
   `closed-won` in `prospect.promoted`").
7. **Nothing changes in 001–009:** no ALTER of `prospects`, no triggers, no policy swap.

## 16 · Recovery-manifest additions

**Migration 010 is not complete unless all three tables are in both F3 and F4.** RT-2 enforces that:
without the lines, R1a fails at development time and R1b/R1c fail on any restored artifact.

`manifest.sql` gains, **in the same change as 010**:

- `F3.rows.prospect_contacts`, `F3.rows.prospect_followups`, `F3.rows.prospect_stage_transitions`
- `F4.digest.prospect_contacts`, `F4.digest.prospect_followups`, `F4.digest.prospect_stage_transitions`

### RT-3 — a recovery prerequisite this pre-flight found

**Artifacts don't seal the manifest SQL or the commit they were taken with.** Verification runs the
**current** repository's `manifest.sql`. The moment it names 010's tables, the current code **cannot
verify the post-009 artifact**: the manifest would query tables that don't exist in that restore. Every
historical artifact would silently depend on someone checking out the right old commit.

**Proposed fix (RT-3), landing before the first post-010 backup:**

- The backup script seals **`manifest.sql` itself** (and the commit hash) into every new artifact.
- The verifier runs the **sealed** manifest SQL when present, falling back to the repository's only for
  artifacts that predate RT-3. `verifyBehaviour`'s RT-2 check takes the same sealed text through the seam
  2A.0 already added.
- The runbook records that the **post-009 artifact is verified with the manifest at `9ed881e`** —
  `git show 9ed881e:apps/os/core/recovery/manifest.sql`.

Also: `CONTENTS.md`'s hard-coded eight-table list becomes derived from the manifest's F3 keys.

---

## 17 · Unresolved risks and decisions for you

| # | Item | Recommendation |
|---|---|---|
| 1 | **A third table**, `prospect_stage_transitions`, for the closed-lost reason and stage history | **Adopt** — the only option satisfying all of "not on `prospects`", "not events-only" and "one canonical store" |
| 2 | **Promote's `closed-won` isn't in that table** (D1 frozen) | Accept, documented. If D1 is ever reopened, Promote can write a transition too |
| 3 | **RT-3** (seal the manifest in artifacts) — a new recovery-code change | **In 2A.1, before any post-010 backup.** Without it, 010 makes the post-009 artifact unverifiable by current code |
| 4 | A sales Save when the **open follow-up belongs to someone else** | **Refuse the follow-up part** (`followup_owned_by_other`) and therefore the whole command. The UI offers "save the contact only" |
| 5 | Backdating bound for `happened_at` (proposed 90 days) | confirm, or choose |
| 6 | Automatic `lead → contacted` on the first contact | **No** — a suggestion only, per §20 |
| 7 | `interested` as an outcome overlaps stage and qualification | accepted as frozen; it never changes stage automatically |
| 8 | Standalone `…/followups` "completed" without a contact | allow (the action may have happened outside the app), `resolved_by_contact` NULL |
| 9 | Reassigning with an open follow-up | the follow-up's assignee **does not** move automatically; the owner moves it explicitly (a separate, evented field update) |
| 10 | 3,102 never-contacted prospects (SLICE-2A-PREFLIGHT §2) dominating queues | a view concern — "never contacted" is a filter, not data |

## 18 · Implementation slices for 2A.1

| Slice | Contents | Production contact |
|---|---|---|
| **2A.1a · Recovery prerequisite** | RT-3: seal `manifest.sql` + commit into artifacts; the verifier prefers the sealed text; `CONTENTS.md` table list derived. Tests incl. "a post-010 manifest cannot be verified against a pre-010 restore **unless** the sealed manifest is used" | none |
| **2A.1b · Schema and domain** | migration 010 + `manifest.sql` F3/F4 lines (same commit); event union; `BUSINESS_TZ`; repository commands (contact, stage, follow-up, assignment) under `lockProspect` with command-id replay and CAS; RT-2 proves coverage | none |
| **2A.1c · Routes and authorization** | `…/actions`, `…/assignment`, `…/stage`, `…/followups`; every §13 command-layer rule with adversarial tests; the PGlite suite; **the real-17.6 concurrency suite** (§14); mutation probes | none |

The UI (2A.2) and production (2A.3: apply 010, verify, new artifact **with sealed manifest**, R1b + R1c,
deploy) follow, each authorized separately.

---

**STOPPING. No migration 010, no implementation, no production contact, no deployment, no push.**

---

## OWNER ACCEPTANCE AND AMENDMENTS (2026-09-22) — these supersede the sections above where they differ

**Accepted model:** `prospect_contacts`, `prospect_followups`, `prospect_stage_transitions`;
`prospects.status` and `prospects.assigned_to` remain the current-state projections; one atomic mobile
Save under the per-prospect lock; immutable contacts; one open follow-up per prospect; explicit
assignment commands; command-layer enforcement of sales-specific lifecycle rules; database
constraints/RLS/grants for what the database can safely express. **No generic activity table.**

| # | Amendment | Replaces |
|---|---|---|
| A1 | **Stage history is complete going forward.** INVARIANT: every change to `prospects.status` after migration 010 has **exactly one** durable `prospect_stage_transitions` row, whatever command caused it. The 2A stage commands write transitions for `lead`, `contacted`, `proposal`, `closed-lost` and owner/admin reopen. **Promote remains the ONLY command that can produce `closed-won`**, and additionally records its transition row in the same transaction and correlation. This extends the history model; it must not create a second path to win a prospect. If touching Promote conflicts with a D1 invariant, STOP and report — never leave history silently incomplete. Not implemented during RT-3. | §C "Declared, not hidden", §17 row 2 — the table is no longer "2A-only", and `to_status` must admit `closed-won` **only** for Promote's path (to be designed in 2A.1b) |
| A2 | Closed-lost reason canonical in `prospect_stage_transitions`, preserving at least: transition id, prospect, organization, actor, command/correlation id, from stage, to stage, structured lost reason where required, optional contact link, recorded timestamp. No `lost_reason` on `prospects`. No UPDATE/DELETE. | §8 (confirmed) |
| A3 | The ten reasons are frozen. `other` may carry optional short context **through the contact/action note mechanism**; prose is never the canonical reason. | §C `lost_note` column — to be re-examined in 2A.1b against this wording |
| A4 | **Follow-up ownership conflict:** a combined sales Save that would modify, replace or resolve an open follow-up assigned to ANOTHER salesperson is refused **atomically** — no contact, no stage, no assignment, no follow-up change — with a structured conflict. The UI offers "Save contact only", **preserving the entered outcome/note**; the contact-only retry uses a **NEW** command id (its payload changed). | §17 row 4 (confirmed, detailed) |
| A5 | **Reassignment does not silently move follow-ups.** Prospect assignment and follow-up assignment are separate facts. Owner/admin reassignment explicitly chooses: leave the open follow-up with its assignee, transfer it, or resolve/cancel it. | §17 row 9 (made explicit in the command) |
| A6 | **Backdating is role-specific.** Sales: `happened_at` at most 90 days back; 5-minute future skew. Owner/admin: older historical contacts allowed when explicitly supplied; impossible/future timestamps still refused. `happened_at` and `recorded_at` are both always preserved (and in the event), so a backfill never masquerades as contemporaneous. Enforced in command validation, not a table CHECK, where the database cannot see the resolved role. | §A `happened_not_ancient` CHECK (removed; the future-skew CHECK stays) |
| A7 | Channels `call, email, text, in_person, other`; `email_sent ⇒ email`, `voicemail ⇒ call`. In 2A.1b, check with evidence whether any other outcome/channel pair should be impossible; no speculative matrix. | §4 (confirmed) |
| A8 | Follow-up actions `call, email, text, meeting, other`. | §5 (confirmed) |
| A9 | `due_on DATE NOT NULL` (the business-day identity) + optional `due_at TIMESTAMPTZ` that must resolve to `due_on` in `America/Los_Angeles`. **Before 010 is authored, freeze and test the exact DST conversion algorithm**: either (A) the command carries an unambiguous instant/offset and its Los Angeles local form is validated, or (B) an explicit local-time resolver detects non-existent and ambiguous wall-clock times. PostgreSQL must never silently pick one side of a fall-back hour. | §11 (algorithm to be frozen in 2A.1b) |
| A10 | **RT-3 is 2A.1a** and completes before migration 010 is written. | §18 slice order (confirmed) |
