# Slice 2A.2 — sales UI / UX · PRE-FLIGHT

**Status: DESIGN ONLY.** No UI implemented, no production contact, no deployment, no push. Baseline
`9a77a99` (2A.1c committed). Backend in place: migration 010 (local), the domain commands, four routes
under a frozen HTTP contract, and three server-side reads.

## 0 · What exists today, and what this must respect

| Fact | Consequence |
|---|---|
| `/sales` (`app/sales/page.tsx`) renders EVERY non-lost prospect from `listProspects()` in one list, sorted by score, plus a pipeline summary and "Add a target" | ~3,100 rows in the DOM; no actionable ordering. 2A.2 replaces the default view with bounded sections; the full list moves behind pagination |
| `/sales/[prospect]` renders facts, promote/archive, research, notes (`ProspectNotes`), imported call log | Restructured around current state + actions + timeline; the existing notes, research, promote and archive components stay |
| Prospect data is READ server-side in the page's guarded render; writes POST to a route and `router.refresh()` (note-log rule, F46) | No client GET of prospect data. The 2A.1c reads are server functions; the UI posts commands and refreshes |
| Slice 1C floor: 44px targets at coarse pointer / phone widths, 16px form text on phones, 44×44 menu trigger at 12,12, no horizontal overflow, measured at 390×844 · 640×900 · 667×375 · 768×1024 · 1024×800 · 1440×900 | Every new control is built to the floor, not retrofitted; verification uses the same viewports |
| Galaxy primacy (1B): the 3D Galaxy is `/`'s primary experience | `/sales` is a separate operational surface; nothing here opens the Galaxy directory or changes `/` |
| Visual changes are never shipped unseen (headless-Chrome loop, login, screenshot) | Each implementation slice ends with a screenshot review at the 1C viewports |
| `prospects:write` (sales + owner) vs `prospects:manage` (owner) | Controls are rendered from the resolved principal's capabilities, never from the role name |

## 1 · `/sales` information architecture

A work queue, not a database. Server-rendered from `salesQueue`-family reads, each section a BOUNDED
query (never "the first 200 and filter in the browser").

| Section (order) | Rows | Query (all: active, anchored) | Row order |
|---|---|---|---|
| **Overdue** | ≤ 20 | open follow-up with `due_at < now()` or (`due_at IS NULL` and `due_on < today_LA`) | oldest due first |
| **Due today** | ≤ 20 | open follow-up due today (LA), not yet overdue | `due_at` then `due_on` |
| **Unassigned** | ≤ 10 | `assigned_to IS NULL` | never-contacted first, then name |
| **Never contacted** | ≤ 10 | `last_contact IS NULL` (and assigned to me, for sales) | name |
| **Recently contacted** | ≤ 10 | latest contact within 7 days | newest contact first |
| **All active** | link | → `/sales/list` (paged) | — |

- **Scope:** sales sees "Mine" by default (assigned to me, plus Unassigned), with a one-tap "Team" toggle.
  The owner defaults to Team. The scope is a URL parameter, so it can be shared.
- Each section shows its total ("Overdue · 14"), its first N rows, and "See all 14" (a paged list with
  that filter). An empty section collapses to one line ("Nothing overdue"), never a blank box.
- **Held** prospects are not in the queue, because they are not workable. A single "Held · 2" link goes
  to the existing identity work.
- **Row** (one line on desktop, two on a phone): business name · stage chip · due badge
  (Overdue 2d / Today 3:00 PM PT / Tue) · last contact ("Spoke · 3d") · assignee initials. The whole row
  is one ≥ 44px target to the detail page; the phone number is NOT on the row, which avoids accidental
  dials.
- The pipeline summary and "Add a target" move below the sections; import stays linked. The score stays
  as a sort option on `/sales/list`, not the default. No AI scoring.

## 2 · Mobile sales-partner workflow

```
/sales (Mine) ─tap row─▶ prospect ─[Call]─▶ phone app ─return─▶ Record-contact sheet auto-opens
   outcome (1 tap) → note (optional, collapsed) → stage (suggested, not applied) → next (1 tap preset) → [Save]
   ─201/200─▶ sheet closes, "Saved" toast, page refreshes (state + timeline)
```

Target: about 4 taps after the call, with no typing.
- One sheet, with sections, not steps. No modal on top of the sheet.
- Every section except outcome is optional.
- Save is always visible in the sheet footer (safe-area aware).

## 3 · Prospect detail layout

1. **Header:** name, stage chip, assignee ("Mine" / "Maria" / "Unassigned"), held/archived banner when
   applicable.
2. **Now card:**
   - latest contact (outcome · channel · when · who);
   - open follow-up (action · due, with its due state · assignee);
   - contact info: phone as a `tel:` link, email as `mailto:`, website.
3. **Primary actions:**
   - Call (phone only; hidden when there is no number);
   - Record contact;
   - Next action;
   - Stage;
   - Claim (only when unassigned).

   On a phone they form a sticky bottom bar: Call · Record · More. More holds Next action, Stage and
   Claim.
4. **Timeline** (§9).
5. **Existing sections, unchanged:** research, promote/archive, imported call log, notes composer.

## 4 · Owner-only management controls (`prospects:manage`)

The server passes `can(principal, "prospects:manage")` into the page; the controls below are rendered
only when it is true. Sales never receives them.

| Control | Where | Behaviour |
|---|---|---|
| Reassign / Unassign | header assignee menu | member picker. When an open follow-up exists, a REQUIRED choice: Leave it with {name} · Transfer it · Cancel it. Nothing is preselected |
| Edit follow-up | Now card, next to the open follow-up | action, date/time presets, assignee, note. Sends `expected` = the card's values |
| Reopen closed-lost | Stage menu, only when closed-lost | lead / contacted / proposal |

For sales, a closed-lost prospect shows "Closed-lost · no budget". The stage menu is replaced by one
line: "Only the owner can reopen this." That's a disabled state that says something useful. There's no
disabled Reassign button.

## 5 · Contact-recording interaction

- **Outcome:** a radio group of chips.
  - Six visible: No answer · Voicemail · Spoke · Interested · Callback requested · Meeting set.
  - "More" reveals: Not interested · Wrong number · Email sent · Other.
- **Channel:** defaults from how the sheet was opened (from Call → call; otherwise the last channel
  used), shown as a small segmented control.
  - Voicemail forces Call; Email sent forces Email (the two frozen rules). The control shows the forced
    value with no error state.
  - No other pairing is constrained.
- **Note:** collapsed "Add a note". A 16px textarea, 2,000 characters max.
- **When:** "Just now" by default.
  - After Call, it is prefilled with the call's start time (§8).
  - "Earlier…" opens date/time. For sales, dates older than 90 days aren't offered (the server enforces
    it anyway).
- **Stage suggestion:** after Spoke / Interested / Meeting set on a lead, the Stage section shows "Move
  to Contacted?" as a highlighted but unselected chip. The human confirms; it is never auto-applied.
- **Claim:** when the prospect is unassigned, a "Claim this prospect" switch, default OFF. Assignment is
  never inferred.

## 6 · Follow-up scheduling interaction

**Presets**, computed in Los Angeles time and always labelled "PT", whatever the device timezone:

| Preset | Resolves to |
|---|---|
| Later today | +3h, rounded up to :00 or :30; hidden after 5 PM PT |
| Tomorrow 9 AM | next day, 09:00 |
| In 2 days 9 AM | +2 days, 09:00 |
| Next week | the next Monday, 09:00 |
| No time | date only (`due_on`, no `due_at`) |
| Pick… | native date input + optional time input |

- **Resolution:** the client builds `{ local, offset }` with the SAME algorithm as `core/db/due-time.ts`,
  moved to a shared pure module (§14). The offset comes from Los Angeles at that instant. The server
  re-validates, and its answer wins.
- **DST, in the picker:**
  - A spring-forward gap time is refused inline: "2:30 AM doesn't exist on Mar 14 — use 3:00 AM?"
  - A fall-back hour offers two explicit choices: "1:30 AM PDT (first)" and "1:30 AM PST (second)".
    Nothing is silently chosen.
- **Action:** chips (Call · Email · Text · Meeting · Other), defaulting to the contact's channel.
- **With an open follow-up:** the section says what will happen to it — "Replaces: Call · Tue". It is
  completed when a contact is in the same Save, otherwise superseded. That's the domain rule, stated
  before Save.

## 7 · Closed-lost flow

- Choosing Closed-lost in Stage expands a required radio group with the ten reasons.
- Save is disabled until a reason is chosen. The sheet says so in text, not only by disabling Save.
- `Other` reveals a short optional context field (≤ 200 characters). Per A3, context travels through the
  CONTACT note mechanism:
  - with a contact in the same Save, it is appended to that contact's note;
  - without a contact, the field is not offered and the reason alone is recorded (decision **Q1**).
- If an open follow-up exists, the sheet states "This cancels the open follow-up (Call · Tue)".
- If that follow-up belongs to another salesperson and the actor is sales, Closed-lost is shown but
  explained, not hidden: "Maria owns the open follow-up — ask the owner." This mirrors the server's
  refusal instead of discovering it on Save.

## 8 · Conflict and retry UX

Nothing overwrites fresh server state silently. The draft (outcome, note, stage, follow-up) is kept in
every case.

| Server says | UI does |
|---|---|
| 201 applied / 200 replayed | Identical: "Saved". Close the sheet, refresh. A replay IS the first save's result |
| `stage_conflict {current}` | Inline in the sheet: "Stage changed to Proposal since you opened this." Refresh the state, keep the draft, ask again. This is a new payload, so a new command id |
| `already_assigned` | "Maria claimed this prospect." Claim switch turns off and shows the new assignee; the user can Save without claiming (new id) |
| `followup_owned_by_other` + fallback | Banner: "Maria owns the next follow-up, so it can't be changed from here." Buttons **Save contact only** (keeps outcome and note; new id) and Cancel |
| `command_id_conflict` | Should never happen from this UI. "Couldn't save this — please try again": mint a new id, keep the draft, log it (no details are available, by design) |
| `held_prospect` / `archived_prospect` | Close the sheet. Full-width banner: "This prospect was archived" / "…is on hold for identity review". Actions disabled. The draft is kept for copying |
| `followup_conflict` (owner edit) | "This follow-up changed while you were editing." Show the new values, keep the edits, owner re-confirms |
| `reopen_not_permitted`, `backdate_not_permitted` | Plain text next to the control. Not reachable from a correctly rendered UI; the server's answer is shown anyway |
| 422 due-time | Inline at the picker, with the suggested fix |
| network error / timeout / 5xx | "Not sent — Retry". Retry reuses the SAME command id. The Save button shows "Retry" |
| offline (`navigator.onLine === false`) | "You're offline. Your entry is kept." Retry becomes available when back online. No background queue in 2A.2 |

## 9 · Timeline design

- **Content:** one chronological list, newest first, grouped by Los Angeles day (Today / Yesterday /
  date). Sources are the canonical tables:
  - contacts — outcome, channel, author, and the note shown once;
  - stage transitions — "Contacted → Proposal", with lost reason and cause wording;
  - follow-ups — created, and their resolution (completed by a contact, superseded, cancelled, edited
    by the owner);
  - standalone notes (`prospect_notes`);
  - business events that have no table of their own: `prospect.created`, `promoted`, `archived`,
    `assessed`, from `events`.
- **No duplicates:** `prospect.contacted`, `status_changed` and `followup_*` events are NOT shown,
  because they would repeat the rows above. Prose appears once.
- **Paging:** 50 entries a page, "Load earlier" (keyset on `at`, id).
- **Names:** authors are resolved to display names server-side from the organization's members.
- **Read changes needed (2A.2a):** `getProspectTimeline` gains notes and those four event types. That's
  a read-only change with no schema change.

## 10 · Filtering and pagination

- **Sections** (§1) are separate bounded server queries of 10–20 rows each, plus a count, so the default
  view touches at most about 70 rows.
- **`/sales/list`:**
  - filters: scope (mine / team / unassigned / member), stage, due state (overdue / today / upcoming /
    none), "never contacted", name search (prefix, case-insensitive);
  - sort: name (default), next due, last contact, score;
  - keyset pages of 50, "Load more" appends, with a hard cap of 200 per request (already enforced);
  - filters live in the URL.
- **Read extensions needed (2A.2a):** due-state filters computed in SQL against `now()` and
  `today_LA`, never-contacted, contacted-since, name prefix, the extra sort keys, and a count per
  section. They use the existing `prospect_followups_queue` and `prospect_contacts_timeline` indexes;
  measured again on 17.6 at production scale.

## 11 · Responsive behaviour

| Width | `/sales` | Detail | Record-contact |
|---|---|---|---|
| Phone (≤ 639) | stacked cards, one section after another | single column; sticky bottom bar Call · Record · More | full-height bottom sheet, footer Save in the thumb zone, safe-area insets |
| Tablet (640–1023) | two-line rows, sections in one column | two columns: state + actions / timeline | bottom sheet at 70% height |
| Desktop (≥ 1024) | aligned rows (CSS grid, not a table); sections side by side where they fit | two columns; actions inline in the header | side panel (dialog), 440px |

Landscape phone (667×375): the sheet scrolls internally, and Save stays pinned. No dense CRM table
anywhere on a phone.

## 12 · Accessibility

- **Floor:** every target is ≥ 44px (1C). Inputs use 16px text on phones. Nothing overflows
  horizontally at the six 1C viewports.
- **Controls:**
  - chip groups are `role="radiogroup"` with arrow-key movement and a visible focus ring;
  - the sheet is a `dialog` with a focus trap, Escape to close (keeping the draft), and focus returned
    to the opener.
- **Announcements:** Save state and conflicts use `aria-live="polite"`; errors use `assertive`.
- **Colour is never the only signal:** due state is text plus an icon ("Overdue 2d").
- **Labels:** `tel:` links read as "Call Tapia Tile, 209 555 0100". Times always name their zone ("PT").
- **Motion:** respects `prefers-reduced-motion`; sheet transitions under 200ms, none when reduced.
- **Verification:** keyboard-only and VoiceOver (iOS) pass on the Save flow before 2A.2 closes.

## 13 · Command-id lifecycle in the browser

- A draft belongs to one prospect and one sheet opening. It is saved in `sessionStorage` under
  `ascend:draft:{prospectRowId}`, so a reload or tab crash keeps it; it is cleared on a definitive
  outcome.
- **The id is minted when Save is first pressed for a given normalized payload**, and stored beside the
  draft.
- **The same id is reused while the payload is unchanged and the last outcome was not definitive:**
  network error, timeout, 5xx, or offline.
- **A new id is minted when:**
  - the payload changes (any edit after a failed attempt);
  - after `stage_conflict` / `already_assigned` / `followup_conflict` (the re-confirmed command differs);
  - for "Save contact only" (a different command);
  - after `command_id_conflict`.
- **Definitive outcomes clear the draft and id:** 2xx (including replay), and refusals the user resolves
  by changing the draft.
- **One in-flight request per draft:** a double-tap is ignored while a request is pending. If a second
  tab sends the same draft, the server replays.
- **The whole lifecycle lives in one hook**, `useSalesCommand` (§14). It is tested in isolation with
  fake fetch outcomes: lost response, 5xx then success, conflict then edit.

## 14 · Component boundaries

**Server (read, authorize, render):**
- `app/sales/page.tsx` — sections, scope from the URL, capabilities from the principal.
- `app/sales/list/page.tsx` — the paged list.
- `app/sales/[prospect]/page.tsx` — summary, timeline, members, capabilities.
- `QueueSection`, `QueueRow`, `TimelineList`, `NowCard` — presentational server components.

**Client (interaction, no data fetching):**
- `useSalesCommand(route)` — id lifecycle, `fetch`, maps the frozen HTTP contract to typed UI states,
  `router.refresh()` on success.
- `RecordContactSheet` — the draft, and composition of `OutcomePicker`, `ChannelPicker`,
  `StagePicker` (+ `LostReasonPicker`), `FollowUpPicker`, `ClaimSwitch`.
- `CallButton` — `tel:` plus return detection (`visibilitychange` → open the sheet, prefill
  `happenedAt`).
- `ClaimButton`.
- `AssignmentMenu` and `FollowUpEditor` — owner only; rendered only when `canManage`.
- `LoadEarlier` — appends timeline pages through a server action or a refresh with a cursor. No client
  GET.

**Shared pure:** `due-time` moves from `core/db` to a client-safe module (e.g. `lib/time/la.ts`),
imported by both the server command and the picker, so there is ONE resolver. It has no dependencies,
so the move changes nothing.

## 15 · Routes, pages and components affected

| Kind | Items |
|---|---|
| Pages changed | `app/sales/page.tsx` (queue sections replace the full list), `app/sales/[prospect]/page.tsx` (restructured) |
| Pages added | `app/sales/list/page.tsx` |
| Components added | `components/sales/*` (§14) |
| Kept as they are | `ProspectNotes`, `ProspectResearch`, `PromoteButton`, `ArchiveProspectButton`, `AddTargetForm`, import |
| Server reads extended (read-only) | `core/db/sales-reads.ts` (sections, due state, counts, search, sorts; timeline with notes and business events; member names) |
| Unchanged | API routes (the 2A.1c contract is frozen), schema, capabilities, nav |

Page authorization entries: `/sales/list` needs a page-matrix entry (`prospects:read`).

## 16 · Implementation slices

| Slice | Contents | Verification |
|---|---|---|
| **2A.2a** · reads and plumbing | read extensions (§9, §10) with a 17.6 scale test; shared LA-time module (one resolver); `useSalesCommand` with its lifecycle tests. No visible UI | unit, PGlite, 17.6 |
| **2A.2b** · prospect detail and Record contact | Now card, action bar, `CallButton`, `RecordContactSheet` (outcome, note, stage + closed-lost, follow-up presets and DST, claim), every conflict state of §8, timeline | component tests; headless-Chrome screenshots at the six 1C viewports; keyboard pass |
| **2A.2c** · `/sales` queue and `/sales/list` | sections, scope, rows, empty states, paging and filters | screenshots, DOM row-count bound, 17.6 timing |
| **2A.2d** · owner management | `AssignmentMenu` (with the required follow-up choice), `FollowUpEditor`, reopen | capability-rendering tests (sales receives none of it) and screenshots |
| **2A.2e** · accessibility and polish | VoiceOver/iOS pass, reduced motion, 1C re-measure, copy review | measured report |

Production (applying 010, backup and recovery re-proof, deploy) stays 2A.3, authorized separately.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Closed-lost `other` context when the Save has no contact | Offer no context field (reason only). The alternative writes a standalone note, which would be a second, non-atomic write |
| Q2 | Sales default scope on `/sales` | "Mine + Unassigned", with a Team toggle |
| Q3 | Claim switch default when unassigned | OFF (assignment is never inferred), placed prominently |
| Q4 | After Call, prefill `happenedAt` with the call's start | Yes, editable |
| Q5 | Show the scorer's score on `/sales` | Only as a sort on `/sales/list`, not on the queue |
