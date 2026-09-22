# Slice 2A.1b — migration 010 + domain persistence · CHECKPOINT

**Status: ACCEPTED 2026-09-22 (owner), committed as the 2A.1b checkpoint.** Baseline `8ef09f5` (2A.1a). No routes, no
UI, no production contact, no deployment, no push. Contract: `docs/SLICE-2A1B-CONTRACT.md` §7–§14.

## Migration 010 — `010_sales_actions.sql`, sha256 `5cb6802a5acd4d353bac785a962ed4779ca2dd59a2dd5bff64892c19afa9bbb5`

| Object | Kind |
|---|---|
| `prospect_command_receipts`, `prospect_contacts`, `prospect_followups`, `prospect_stage_transitions` | tables (RLS enabled + forced; history FKs to `prospects` RESTRICT; command FKs DEFERRABLE) |
| `prospect_followups_one_open` | partial UNIQUE (prospect) WHERE state = 'open' |
| 9 policies | receipts read/insert; contacts read; transitions read; follow-ups read, insert owner/sales, update owner/sales |
| `ascend_guard_actor`, `ascend_guard_prospect` | SECURITY DEFINER helpers, no EXECUTE for anyone |
| `ascend_record_contact`, `ascend_transition_stage`, `ascend_assign_prospect` | SECURITY DEFINER, `search_path = ''`, EXECUTE to owner/sales only |
| `ascend_status_has_transition` + trigger `prospects_status_has_transition` | every status change, by any role, names its transition |
| grants | sales loses UPDATE (status, assigned_to, first_contact, last_contact); owner's table UPDATE → column UPDATE on every other column; anon/authenticated/service_role stripped of 010's default-granted privileges where those roles exist |

No column of `prospects` changed. 001–009 byte-identical.

## Promote
`markProspectPromoted` reads the status under the caller's lock, keeps `already_marked` / `refused`
exactly as D1, and otherwise calls `ascend_transition_stage(…, 'closed-won', 'promotion', …, true)`
with Promote's correlation id, then appends `prospect.status_changed` and `prospect.promoted` with that
correlation id. The vault/client steps and `MarkFailed` → `incomplete` are unchanged. Replay reaches no
primitive. D1 suites: 41/41 (M4's failure injection now also matches the guarded call; A4 probes the
archived-row policy through `notes`; A6 records the owner's column grants).

## Evidence
| Suite | Result |
|---|---|
| `tests/db/sales-actions.test.ts` (PGlite 001–010) | 54/54 (incl. the owner follow-up edit) |
| `tests/db/sales-actions-concurrency.test.ts` (PostgreSQL 17.6, distinct backends) | 16/16, three consecutive runs |
| recovery legs (`recovery:verify`: artifact, fidelity incl. post-010-v1, profiles) | 111/111 |
| `gate:static` | 1 failed — the pre-existing environment check only |
| `gate:db` | 599 passed; the three 17.6 suites fail closed without `ASCEND_PG17_BIN`, and pass 30/30 with it |
| typecheck / lint | clean |
| mutation probes (2A.1b) | 22 caught + 1 masked by defence in depth (C7: the TS reopen check; the guarded function refuses the same thing and the whole transaction rolls back — same observable outcome) |

## Recovery
`manifest.sql`: F3/F4 for the four new tables (twelve named). `post-010-v1` registered and implemented
(post-009 checks with the post-010 grant boundary + the four history tables + their invariants);
`forNewArtifacts` moved to it; `post-009-v1` and `pre-009-v1` checks unchanged (shared code split,
check ids and order identical).

## Historical recovery regression (required before commit, 2026-09-22)
The accepted post-009 artifact (unchanged; `.sha256` verifies), pinned contract `post-009-20260920`,
application profile `post-009-v1`, after the profile refactor and `post-010-v1`:
R1b 119/119 (profile 18/18); full two-leg R1c on PostgreSQL 17.6 19/19 — both legs 56/56 manifest keys,
10/10 behaviour, profile 18/18, zero tuple delta. Same measurements as the RT-3B runs. Fresh
byte-verified 17.6 root, deleted after.

## Owner acceptance
Architecture accepted. Mutation score accepted as 22 caught + 1 masked by stronger database
defence in depth (C7); no manufactured test. Decisions 1 (owner follow-up edit) and 2 (outcome/channel
matrix stays at two rules) incorporated — contract §15.
