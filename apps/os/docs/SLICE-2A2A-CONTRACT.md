# Slice 2A.2a — reads, shared time, command lifecycle · FROZEN CONTRACT

Frozen before implementation, per owner instruction (2026-09-22). No visible redesign in this slice.
Baseline `9a77a99`. Design: `docs/SLICE-2A2-PREFLIGHT.md`.

## 1 · Queue query signatures

```ts
type SalesSection = "overdue" | "due_today" | "unassigned" | "never_contacted" | "recently_contacted";
type SectionScope = { assignee?: string; includeUnassigned?: boolean };   // no assignee = team-wide

listSalesSection(tx, section, scope & { limit?; recentDays? })
  → { rows: SalesQueueRow[]; total: number; limit: number }

listSalesQueue(tx, {
  assignee?: string | "unassigned"; includeUnassigned?: boolean;
  stage?: ProspectStatus; dueState?: "overdue" | "today" | "upcoming" | "none";
  neverContacted?: boolean; contactedWithinDays?: number; search?: string;
  sort?: "name" | "due" | "last_contact"; after?: Cursor; limit?: number;
}) → { rows: SalesQueueRow[]; next: Cursor | null }
```

- Every query is scoped to ACTIVE, ANCHORED prospects (`archived_at IS NULL`,
  `identity_state = 'anchored'`). Held and archived never appear; they have their own surfaces.
- "Today" and "overdue" are computed in SQL from the database clock in `America/Los_Angeles`:
  overdue = `due_at < now()` when timed, else `due_on < today_LA`; today = the rest of `due_on = today_LA`.
- `total` is a bounded `count(*)` for the section's own predicate (one extra query per section).
- Section defaults: overdue 20, due_today 20, unassigned 10, never_contacted 10,
  recently_contacted 10; `limit` is clamped to 50. `listSalesQueue` stays clamped to 200.
- Cursor: `{ key, id }` — `key` is the sort's leading value (name, due day, or last contact),
  `id` breaks ties. Keyset only; no OFFSET.
- `search` is a case-insensitive PREFIX match on name (`name ILIKE $ || '%'`).
- **Score is NOT a sort in 2A.2a** (owner decision Q5 allows it only on `/sales/list`); it comes from the
  vault-side scorer and is deferred to 2A.2c.

### Maximum returned fields (decision 5)

| Read | Fields |
|---|---|
| `SalesQueueRow` | exactly 10: `id, anchor, slug, name, status, assignedTo, firstContact, lastContact, latestContact{outcome,channel,happenedAt}, openFollowUp{followupId,action,assignee,dueOn,dueAt}` — plus `dueState` (derived) = 11 |
| `ActionSummary` | `SalesQueueRow` + `archived, held, contacts, transitions` |
| `TimelineEntry` | ≤ 10 per kind, ids/enums/timestamps + one prose field (contact note, note body) + `actorName` |

No read returns a row payload beyond these; a test asserts the key sets.

## 2 · sessionStorage draft/command format

Key `ascend.sales.draft.v1:<prospectRowId>` (one draft per prospect):

```jsonc
{ "v": 1, "prospect": "<row id>", "updatedAt": "<iso>",
  "draft": { /* the unsent sheet: outcome, channel, note, happenedAt, claim, stage, followUp */ },
  "command": null | { "id": "<uuid>", "payload": "<canonical JSON of the SENT payload>",
                      "state": "uncertain", "attempts": 1, "firstAttemptAt": "<iso>" } }
```

- **draft ≠ command.** Editing writes only `draft`; `command` stays null until the first SAVE attempt.
- On a save attempt the payload is canonicalized (sorted keys) and snapshotted with the id.
- Stored only to restore an unfinished draft: no tokens, no session data, no server outcome, and no
  prose beyond the user's own unsent note.
- Entries older than 24h are dropped on load; `v` mismatch is dropped.

## 3 · Command-id lifecycle (owner amendment)

- **Mint** at the first actual save attempt, never on edit.
- **Reuse the same id** when the outcome is UNKNOWN: timeout, connection drop, lost response, offline,
  or an ambiguous 5xx — including when the user presses Retry.
- **Mint a new id** when: the payload materially changes after a definitive refusal; `stage_conflict`
  is reconciled and resubmitted; `followup_owned_by_other` → Save contact only; `command_id_conflict`;
  or a completed command is followed by a new action.
- **One in-flight request per command** (a second submit while pending is ignored).
- A definitive outcome (2xx, or a 4xx the user must resolve by editing) clears `command`.

## 4 · Shared time module boundary

`core/db/due-time.ts` moves to **`packages/domain/time.ts`** — the pure kernel both sides already
import (no fs, no Next, no database; safe in client bundles). One implementation of the Los Angeles
contract, used by the server command and by the follow-up picker:

```ts
BUSINESS_TZ, losAngelesWallClock(instant), losAngelesDate(instant), resolveDue(dueOn, dueAt),
laNow(), laOffsetAt(localWallClock), followUpPreset(kind, now) → { dueOn, dueAt? }
```

`followUpPreset` covers `later_today | tomorrow | in_2_days | next_week | no_time`, produces
`{ local, offset }` through the same resolver, and never guesses an offset.

## 5 · Pending-call state lifecycle (Q4 clarification)

Key `ascend.sales.call.v1` (one at a time), written BEFORE the `tel:` hand-off:

```jsonc
{ "v": 1, "prospect": "<row id>", "ref": "<slug>", "startedAt": "<iso>" }
```

1. Tap Call → write the state → navigate to `tel:`.
2. On return, `visibilitychange` (visible) OR `focus` OR a fresh page load restores it. No reliance on
   any "call ended" callback, which browsers do not provide.
3. If the state names THIS prospect and is < 30 minutes old → open Record contact with
   `happenedAt = startedAt` (editable) and channel `call`.
4. Record contact is ALWAYS available as a button, so nothing depends on resume behaviour.
5. Cleared when: the contact is saved, the user dismisses the offer, the state is stale (> 30 min), it
   names a different prospect than the one being opened, or it fails to parse.

No telephony integration: `tel:` hand-off only.

---

## Evidence (2026-09-22, implementation complete — NOT committed)

| Suite | Result |
|---|---|
| `tests/db/sales-reads.test.ts` (PGlite 001–010) | 12/12 |
| `tests/ui/sales-command-state.test.ts` (happy-dom) | 12/12 |
| `tests/ui/use-sales-command.test.ts` (happy-dom + Testing Library) | 9/9 |
| `tests/ui/la-time.test.ts` (pure) | 12/12 |
| PostgreSQL 17.6 at scale (~3,200 prospects with history) | `/sales` default view — five bounded sections — **51.1 ms for 45 rows** (overdue 6.4 · due today 5.8 · unassigned 17.5 · never contacted 17.0 · recently contacted 4.3); a 200-row `/sales/list` page 13.4 ms |
| `gate:static` | 1 failed — the pre-existing environment check only |
| `gate:db` | 642 passed; the four 17.6 suites fail closed without `ASCEND_PG17_BIN`, and pass 36/36 with it |
| recovery legs | 111/111 |
| typecheck / lint | clean (two pre-existing warnings in `packages/domain/entities.ts`, untouched) |

No visible redesign: no page or component was changed, and nothing new is rendered yet.
