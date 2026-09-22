# Slice 2A.1b — migration 010 + domain persistence · CONTRACT (pre-implementation)

**Status: CONTRACT FROZEN (owner decisions of 2026-09-22 incorporated, §7–§14). Implementation follows it.**
Baseline `8ef09f5` (2A.1a committed). Sections 1–6 are the audit and the proposal that led here; where they
differ from §7–§14, §7–§14 govern.

## 1 · Mandatory grant audit (K) — BYPASS FOUND

`ascend_sales` holds (001 + 002 + 009):

| Column | Sales UPDATE today | What raw SQL as `ascend_sales` could do |
|---|---|---|
| `status` | yes (001) | set `closed-won` without Promote; reopen `closed-lost`/`closed-won`; any change **without a transition row** |
| `assigned_to` | yes (001) | assign to anyone, steal, unassign |
| `first_contact`, `last_contact` | yes (002) | rewrite the contact projection arbitrarily (backwards, or with no contact) |

RLS (`prospects_update_sales`) limits rows to anchored + unarchived in the org, but a policy cannot
see the OLD value, so none of the rules above is expressible there. Today the only application writer
of `status` is Promote (`markProspectPromoted`), and nothing writes `assigned_to`; the rules hold
only by code review. After 010 the invariant "every post-010 status change has exactly one transition
row" would likewise hold only by convention. Per owner item K this is a STOP.

`ascend_owner` holds `FOR ALL` + table UPDATE: the same missing-transition hole (not a role-rule hole —
owner may reassign and reopen). `ascend_automation` holds no UPDATE on these columns (unchanged).

## 2 · Proposed narrower model (for approval)

**Recommended — P1: keep the grants, enforce in `BEFORE UPDATE` triggers**, which (unlike policies)
see OLD and NEW and the effective role (`current_user` after `SET LOCAL ROLE`). Every role, including
the superuser, is subject to the transition rule; the role rules apply to `ascend_sales`.

| # | Rule (enforced by the database) | Applies to |
|---|---|---|
| R1 | `status` may change only if a `prospect_stage_transitions` row for this prospect was inserted **in the current transaction** (`recorded_xact xid8 DEFAULT pg_current_xact_id()`) with `from_status IS NOT DISTINCT FROM OLD.status` and `to_status = NEW.status` | all roles |
| R2 | at most one transition per prospect per transaction (`UNIQUE (prospect, recorded_xact)`) → exactly one row per status change; a second change in the same transaction has no transition and is refused by R1 | all |
| R3 | a transition with no matching status change is refused at COMMIT (deferred constraint trigger: the prospect's status must equal the transaction's transition `to_status`) | all |
| R4 | `closed-won` only with `cause = 'promotion'` (new transition column; CHECK `to_status='closed-won' ⇔ cause='promotion'`) | all |
| R5 | sales: `assigned_to` may change only `NULL → current_user_id()` | sales |
| R6 | sales: no status change FROM `closed-won`; FROM `closed-lost` only with `cause='promotion'` (see decision D-2) | sales |
| R7 | sales: `last_contact` only forward (`NEW >= OLD` or OLD NULL); `first_contact` only from NULL | sales |
| R8 | status change refused on a held or archived row | all |

What stays command-layer, inherently: whether a promotion is legitimate (a vault client exists) — the
database cannot see the vault, and Promote runs as `ascend_sales`. A sales principal with raw SQL could
still write a `cause='promotion'` transition + `closed-won`. P2 (below) has the same residual.

**Alternative — P2:** revoke sales/owner UPDATE on `status`, `assigned_to`, `first_contact`,
`last_contact`; perform them only through `SECURITY DEFINER` functions. Stronger surface reduction, but
moves lifecycle logic into plpgsql and rewrites Promote's UPDATE. Not recommended for 2A.

Neither changes any 001–009 file; 010 adds triggers (and, for P2, REVOKEs) on `prospects`. No column of
`prospects` is altered.

## 3 · Promote integration (D) — atomic, no D1 conflict in the mechanism

`promoteInPostgres` is ONE transaction under `lockProspect(anchor)`; `markProspectPromoted` is its
compare-and-set `UPDATE … SET status='closed-won' WHERE status IS DISTINCT FROM 'closed-won' AND
archived_at IS NULL`, followed by `prospect.promoted`, both with the per-request `correlationId`
(`uuidv7()` in `promoteProspect`). Insertion point: inside `markProspectPromoted`, read the current
status under the held lock, insert the transition (`cause='promotion'`, `transition_id = uuidv7()`,
`correlation_id = correlationId`), then the UPDATE, then `prospect.status_changed` and
`prospect.promoted` with the same correlation id. A replay's CAS matches nothing → no transition, no
events. Nothing about the vault step or the lock changes.

**D1 fact that needs a decision:** Promote today accepts ANY starting stage, including `closed-lost`
and NULL, for sales and owner. The frozen 2A rule "sales may not reopen" conflicts with that only if
promotion counts as reopening.

## 4 · Command idempotency (I) — a receipt table is required by evidence

One command id can create zero rows in the three history tables (a claim-only or resolve-only command
writes an UPDATE and an event, nothing else), so "the id is some table's primary key" cannot detect a
replay or a changed payload. Proposed 4th table, **`prospect_command_receipts`**:
`command_id uuid PK`, `organization_id`, `prospect` (RESTRICT), `actor_user_id`, `kind`,
`payload_sha256` (canonical JSON of the NORMALIZED command, prose included only as its hash),
`outcome jsonb` (structured ids/enums only), `recorded_at`. Written first, in the same transaction,
under the prospect lock; a second arrival finds it and returns the stored outcome if the digest matches,
else `command_id_conflict`. Immutable; no UPDATE/DELETE grants; F3/F4 and the profile cover it.
Row ids in the history tables are then fresh `uuidv7`s, recorded in `outcome`.

## 5 · Due time (F) — frozen algorithm (implemented and tested in 2A.1b)

Client sends `dueOn` (`YYYY-MM-DD`) and optionally `dueAt = { local: "YYYY-MM-DDTHH:MM", offset: "±HH:MM" }`.
The offset is REQUIRED with a time. Server: `instant = local − offset`; render `instant` in
`America/Los_Angeles` (Node ICU tz data); refuse unless the rendering equals `local` exactly
(→ refuses spring-forward times: no offset maps them to themselves) and its date equals `dueOn`.
Fall-back times are accepted only as the instant their offset names (`01:30-07:00` ≠ `01:30-08:00`).
PostgreSQL never resolves a wall-clock time: it stores the instant, and the table CHECK
`(due_at AT TIME ZONE 'America/Los_Angeles')::date = due_on` is a timezone-exact assertion, not a
conversion. Tests at 2026-03-08 02:00–03:00 and 2026-11-01 01:00–02:00, plus the day boundary.

## 6 · Decisions needed before migration 010

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Narrower model: P1 (triggers R1–R8) or P2 (SECURITY DEFINER functions) | **P1** |
| D-2 | May Promote (sales) start from `closed-lost` (D1 behaviour today)? | **Yes — keep D1 as is**; promotion is exempt from "no reopen", recorded as such (R6) |
| D-3 | Enforce the contact-projection monotonicity for sales in the database (R7) | **Yes** |
| D-4 | Add `prospect_command_receipts` as a 4th table (evidence in §4) | **Yes** |
| D-5 | Add `cause` (`stage_command` / `promotion`) and `recorded_xact` to `prospect_stage_transitions` | **Yes** (needed by R1–R4) |
| D-6 | Due-time payload shape in §5 (offset mandatory with a time) | **Adopt** |

---

# FROZEN CONTRACT (owner decisions D-1 … D-6, 2026-09-22)

## 7 · Privilege model — revoked grants + narrow guarded primitives (D-1)

**Rejected:** broad grants + triggers. `ascend_sales` is a shared role; `current_role` cannot identify
which human "self" is.

**Revoked in 010** (verified against the catalog of a 001–009 database, 2026-09-22):

| Role | Before (UPDATE) | After |
|---|---|---|
| `ascend_sales` | column grants incl. `status`, `assigned_to` (001), `first_contact`, `last_contact` (002) | same columns **minus those four** |
| `ascend_owner` | table-level UPDATE (every column) | table-level UPDATE revoked; column UPDATE re-granted on **every column except those four** — nothing else widened or narrowed |
| `ascend_automation` | none of the four | unchanged |

After 010 no application role can execute `UPDATE prospects SET status | assigned_to | first_contact |
last_contact …`. INSERT of a NEW prospect (import, from-url) still states its initial status — creating a
row is not mutating one; recorded, not changed.

**Guarded primitives** (plpgsql, `SECURITY DEFINER`, `SET search_path = ''`, fully schema-qualified, no
dynamic SQL, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` to `ascend_owner` and `ascend_sales` only):

| Function | Does exactly |
|---|---|
| `public.ascend_record_contact(p_prospect uuid, p_actor uuid, p_contact_id uuid, p_command_id uuid, p_outcome text, p_channel text, p_note text, p_happened_at timestamptz) RETURNS void` | insert one `prospect_contacts` row; move `first_contact` to `LEAST`, `last_contact` to `GREATEST` of the stored value and the contact's Los Angeles business date |
| `public.ascend_transition_stage(p_prospect uuid, p_actor uuid, p_transition_id uuid, p_correlation_id uuid, p_expected_from text, p_to text, p_cause text, p_lost_reason text, p_contact_id uuid, p_touch_last_contact boolean) RETURNS text` | if the stored status IS NOT DISTINCT FROM `p_expected_from`: insert exactly one transition, update `status` (and, for Promote, `last_contact = GREATEST(last_contact, current_date)`) → `'applied'`; else → `'stage_conflict'`, nothing written |
| `public.ascend_assign_prospect(p_prospect uuid, p_actor uuid, p_mode text, p_expected uuid, p_to uuid) RETURNS text` | `claim` / `reassign` / `unassign` with compare-and-set → `'applied'` · `'already_yours'` · `'already_assigned'` · `'assignment_conflict'` |

Every primitive, before any write: `current_org()` is set; the prospect row is in `current_org()`
(explicit predicate — the owner of these functions bypasses RLS in production (`postgres`, BYPASSRLS)
and in the harnesses (superuser), so RLS is NOT relied on inside them), anchored, not archived; row
locked `FOR UPDATE`; `p_actor = current_user_id()`; the actor has a membership row in `current_org()`
and is not disabled; the role rule is read from THAT membership row. Refusals `RAISE` (SQLSTATE
`42501`, message prefixed `ascend:`); conflicts are return values.

**Identity boundary, stated plainly.** The database validates that the actor exists, belongs to the
organization, holds the required membership role, is the transaction's bound `current_user_id()`, and
is the assignee of a self-claim. It does NOT know which human sent the request: the application uses
shared roles, and the binding *authenticated request → resolved user id* is the authority resolver's
(`resolvePrincipal`). The defence in depth is: routes cannot declare a role; commands receive resolved
authority; primitives re-validate membership and state; raw UPDATE grants no longer offer a bypass.

**Status history for every role, including table owners.** A `BEFORE UPDATE OF status` trigger refuses
any status change unless the transaction-local setting `ascend.transition_id` names a transition row
for that prospect whose `from_status`/`to_status` equal OLD/NEW. Only `ascend_transition_stage` sets
it. This closes the maintenance path (`postgres`/superuser raw SQL) without a new column.

## 8 · Tables (010) — exactly four

Common: `organization_id uuid NOT NULL → organizations(id) ON DELETE CASCADE` (as 008); `prospect uuid
NOT NULL → prospects(id) ON DELETE RESTRICT`; actor columns `→ users(id)`; RLS enabled + forced;
SELECT policy `organization_id = current_org()`; **no UPDATE/DELETE grant** except §8.3's lifecycle
columns; `ascend_automation` nothing.

**8.1 `prospect_command_receipts`** (D-4) — `command_id uuid PK`, `organization_id`, `prospect`,
`actor_user_id`, `kind text CHECK IN ('save','claim','reassign','unassign')`, `payload_sha256 text
CHECK (~ '^[0-9a-f]{64}$')`, `outcome jsonb NOT NULL` (ids, enums, states only — never prose),
`created_at timestamptz NOT NULL DEFAULT now()`. INSERT grant to owner/sales with `WITH CHECK
(organization_id = current_org() AND actor_user_id = current_user_id())`. Written LAST in the command's
transaction; history rows reference it through `DEFERRABLE INITIALLY DEFERRED` foreign keys, so a
command's rows and its receipt commit or roll back together.

**8.2 `prospect_contacts`** — `contact_id uuid PK`, `organization_id`, `prospect`, `command_id → receipts
(deferred)`, `author_user_id`, `outcome` CHECK ∈ {no_answer, voicemail, spoke, interested,
not_interested, callback_requested, meeting_set, wrong_number, email_sent, other}, `channel` CHECK ∈
{call, email, text, in_person, other}, `note text NULL` CHECK non-blank and ≤ 2000 chars,
`happened_at timestamptz NOT NULL`, `recorded_at timestamptz NOT NULL DEFAULT now()`. CHECKs:
`happened_at <= recorded_at + 5 minutes` (role-independent); `email_sent ⇒ email`, `voicemail ⇒ call`.
Written ONLY by `ascend_record_contact` (no INSERT grant). The 90-day sales backdate limit is command
validation (A6).

**8.3 `prospect_followups`** — as §B of the pre-flight: `followup_id`, `organization_id`, `prospect`,
`action` ∈ {call, email, text, meeting, other}, `assignee_user_id`, `due_on date NOT NULL`, `due_at
timestamptz NULL`, `note` (non-blank, ≤ 2000), `state` ∈ {open, completed, cancelled, superseded} DEFAULT
open, `created_by`, `created_at`, `created_by_command → receipts (deferred)`, `created_by_contact →
contacts`, `resolved_by`, `resolved_at`, `resolved_by_command`, `resolved_by_contact → contacts`,
`superseded_by → followups`. CHECKs: provenance iff resolved; `superseded ⇔ superseded_by`; by-contact
only when completed; `due_at` resolves to `due_on` in Los Angeles; not self-superseding. Partial UNIQUE
`(prospect) WHERE state = 'open'`. Direct grants (no primitive needed — no projection, no stage):
INSERT to owner/sales, `WITH CHECK` org, `created_by = self`, prospect anchored + unarchived + not
closed, and for sales `assignee = self`; UPDATE only on `(state, resolved_by, resolved_at,
resolved_by_command, resolved_by_contact, superseded_by)` for both, plus `(assignee_user_id)` for owner;
`USING (state = 'open' …)` — sales additionally `assignee_user_id = current_user_id()` — `WITH CHECK
(… (state = 'open' OR resolved_by = current_user_id()))`. A resolved row can never be updated again.

**8.4 `prospect_stage_transitions`** — `transition_id uuid PK`, `organization_id`, `prospect`,
`actor_user_id`, `correlation_id uuid NOT NULL` (the command id, or Promote's correlation id — no FK:
Promote has no receipt), `from_status` (NULL = unstated) and `to_status` ∈ the five, `cause`,
`lost_reason`, `contact_id → contacts NULL`, `recorded_at DEFAULT now()`. Written ONLY by
`ascend_transition_stage`. No UPDATE/DELETE. CHECKs: `from IS DISTINCT FROM to`; `from <> 'closed-won'`
(nobody leaves a win in 2A); `lost_reason ∈ the ten ⇔ to = 'closed-lost'`; the cause rules of §9.

## 9 · Cause vocabulary (D-5) — derived, and CHECK-enforced

| `cause` | Exactly when | Who |
|---|---|---|
| `promotion` | `to = 'closed-won'` (any from, incl. `closed-lost` — D-2) | Promote only (command layer) |
| `closed_lost` | `to = 'closed-lost'` | sales, owner (from lead/contacted/proposal/NULL) |
| `reopen` | `from = 'closed-lost'` and `to` ∈ open stages | owner only (primitive checks membership role) |
| `contact` | open → open, with `contact_id` | sales, owner |
| `manual` | open → open (or NULL → open), without `contact_id` | sales, owner |

No transaction-marker column: `transition_id` + `correlation_id` + `cause` identify every transition;
the only transaction-local fact needed (§7 trigger) is a setting, not stored data.

## 10 · Contact-date projections (D-3)

`first_contact` = earliest known contact date, `last_contact` = latest (both `date`, Los Angeles
business date of `happened_at`). Only `ascend_record_contact` (LEAST/GREATEST) and Promote's
`p_touch_last_contact` (GREATEST with `current_date`, D1's existing semantics) change them. A backdated
contact can move `first_contact` earlier without touching `last_contact`, and vice versa. Neither can
move the wrong way.

## 11 · Receipts and replay (D-4)

`payload_sha256` = SHA-256 of the canonical JSON of the NORMALIZED command (kind, prospect row id,
actor, parts; note text included only through this hash). Under the prospect lock: same id + same
digest (+ same prospect and actor) → the stored `outcome`, no rows, no events; same id + different
digest → `command_id_conflict`. A concurrent same-id command on a DIFFERENT prospect (different lock)
loses at the receipt primary key and is re-classified after rollback.

## 12 · Due time (D-6)

`dueAt` is `{ local: "YYYY-MM-DDTHH:MM", offset: "±HH:MM" }` or an ISO timestamp with an explicit
offset. Server: instant = local − offset; the instant rendered in `America/Los_Angeles` must equal
`local` exactly (refuses spring-forward times, and offsets that are not Los Angeles's at that instant;
fall-back times are disambiguated by their mandatory offset) and its date must equal `dueOn`. Only
`due_on` and `due_at` (the instant) are stored.

## 13 · Command composition (TypeScript, one transaction under `lockProspect`)

Validate the whole request → resolve (held refused) → lock → re-read (archived refused) → receipt
lookup (replay / conflict) → authorize EVERY part against the re-read state → primitives + follow-up
writes → receipt → events (`correlation_id` = command id). No implicit follow-up changes except the
cancellation that `closed-lost` implies; a sales Save that would resolve, replace or cancel another
salesperson's follow-up is refused whole (`followup_owned_by_other`, A4).

## 14 · Promote (post-010)

`markProspectPromoted` keeps its contract: under the caller's lock it reads status/archival, returns
`already_marked` / `refused` exactly as before, otherwise calls `ascend_transition_stage(…, 'closed-won',
'promotion', …, p_touch_last_contact => true)` with `p_correlation_id = correlationId`, then appends
`prospect.status_changed` and `prospect.promoted` with that correlation id. A replay never reaches the
primitive. The vault/client steps are untouched.

## 15 · Owner decisions at 2A.1b acceptance (2026-09-22)

**Decision 1 — owner follow-up edit.** `executeFollowUpEdit`: owner only (`followup_edit_not_permitted`),
open follow-ups only (`followup_not_open`), compare-and-set on the seen `{ action, assignee, dueOn, dueAt }`
(`followup_conflict`), receipt kind `followup_edit`, fields limited to action / dueOn / dueAt / note /
assignee, due time through the canonical resolver (a new day for a timed follow-up must restate or clear
its time), assignee must be an enabled member and changes only when named. Event
`prospect.followup_updated` `{ followup_id, changed, action?, due_on?, due_at?, assignee?: { from, to } }`
when ownership or scheduling changes; a note-only edit writes the receipt and no event. Database: 010
grants the owner UPDATE on `(assignee_user_id, action, due_on, due_at, note)`; the open-only policy and
the due-at CHECK still apply. Sales holds none of these columns.

**Decision 2 — outcome/channel.** Frozen as exactly two contradictions: `voicemail ⇒ call`,
`email_sent ⇒ email`. No other outcome is tied to a channel.
