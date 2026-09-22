# Slice 2A.1c — routes, HTTP contracts, authorization · CHECKPOINT

**Status: ACCEPTED 2026-09-22 (owner), with the `prospects:manage` change; committed as the 2A.1c checkpoint.** Baseline `e55a9fb` (2A.1b). No UI, no
schema change, no production contact, no deployment, no push.

## Routes

| Route | Verb | Capability | Sales | Command |
|---|---|---|---|---|
| `/api/prospects/[slug]/actions` | POST | `prospects:write` | allowed | the atomic Save (contact · claim · stage · follow-up) |
| `/api/prospects/[slug]/claim` | POST | `prospects:write` | allowed | claim for oneself |
| `/api/prospects/[slug]/assignment` | POST | `prospects:manage` | **403** | reassign / unassign (owner) |
| `/api/prospects/[slug]/followups/[followupId]` | PATCH | `prospects:manage` | **403** | owner follow-up edit |

Every write: `authorize` resolves the session to a membership-resolved principal → the capability is
checked → `core/crm/sales` takes that principal (never the body's) → `withProspectDb` runs the domain
command in the request's own transaction → the guarded database functions re-validate. Bodies are
STRICT at every level: `actor`, `author`, `role`, `organizationId`, `prospect` (or any unknown key)
is a 400 and nothing is written. Owner-only operations are refused at the route (`prospects:manage`), in the
command, and in the database.

## HTTP contract (`lib/sales-http.ts`)

| Status | Meaning |
|---|---|
| 201 | applied |
| 200 | replayed (same id + payload → the SAME outcome) · `already_yours` |
| 400 | `invalid_command` (incl. outcome/channel contradictions, unknown/spoofed fields) · `nothing_to_do` |
| 403 | `backdate_not_permitted`, `reopen_not_permitted`, `closed_won_not_permitted`, `closed_won_is_final`, `assignment_not_permitted`, `followup_edit_not_permitted`, `followup_assignee_not_permitted`; and `prospects:manage` refusals |
| 404 | `prospect_not_found`, `followup_not_found` |
| 409 | `command_id_conflict` — body `{ ok: false, error }` ONLY · `stage_conflict {current}` · `already_assigned` · `followup_owned_by_other` + `fallback { contactOnly, newCommandIdRequired }` · `held_prospect` · `archived_prospect` · `assignment_conflict {current}` · `followup_conflict` · `followup_not_open` · `no_open_followup` · `followup_on_closed_prospect` · `followup_choice_required` · `stage_unchanged` · `assignment_unchanged` · `database_refused` |
| 422 | due time (`nonexistent_local_time`, `offset_required`, `offset_not_los_angeles`, `due_at_not_on_due_on`, `invalid_due_*`), `lost_reason_required`, `contact_in_future`, `assignee_not_member` |

Refusal details pass through an allowlist per code; nothing else a refusal carries reaches a client.

## Reads for 2A.2 (server-side, `prospects:read`; no GET routes — F46 and the "read in the page" rule)

`salesQueue(filter)` → one summary row per ACTIVE, anchored prospect (stage, assignee, latest contact,
open follow-up), keyset-paginated ≤ 200, filters assignee / unassigned / stage / due-by;
`prospectActionSummary(ref)`; `prospectTimeline(ref, { limit, before })` (the only read returning
contact notes). No history on the list.

## Evidence (2026-09-22)
| Suite | Result |
|---|---|
| `tests/db/sales-routes.test.ts` (PGlite, real admission chain) | 14/14 |
| `tests/db/sales-routes-concurrency.test.ts` (PostgreSQL 17.6) | 6/6 — 8 racing retries → one 201 + seven 200 with one outcome; same id / different body → classification-only 409; same id on two prospects (receipt-key race) → classification-only 409, never 500; racing claims → one winner; `/sales` page of 200 over ~3,200 prospects with history: 13.3 ms, contact lookup on `prospect_contacts_timeline` |
| recovery legs | 111/111 |
| `gate:static` | 1 failed — the pre-existing environment check only (its list now also names the two new 17.6 suites) |
| `gate:db` | 629 passed; the four 17.6 suites fail closed without `ASCEND_PG17_BIN` and pass 36/36 with it |
| typecheck / lint | clean |
| route-layer mutation probes | 10/10 caught (R1 conflict-body leak and R11 unmapped receipt-key race were first missed — both only fire on a cross-prospect race; test added) |

Architecture pins moved with the routes: route map (+4 entries), importer registry, and the three
route-count assertions 31 → 35.

## `prospects:manage` (owner decision at acceptance)
A new owner-only capability for CRM lifecycle management — reassign, unassign, edit/transfer an open
follow-up, reopen closed-lost. `admin:*` stays for administration/security only; no sales-management
route depends on it. Sales keeps `prospects:write` and does not gain anything. The two roles now differ
by exactly `admin:*` and `prospects:manage` (asserted in `tests/auth/dal-boundary` and
`tests/auth/landing`). Reopening happens through the Save route (`prospects:write`); its owner-only
rule is enforced in the command and in `ascend_transition_stage`, both from the membership role.
