# Slice 2A.3b — Sales priority · CHECKPOINT

Six stated reasons to act now, computed by the database for the viewing member; a "Priority · N"
section first on `/sales`; a `priority` filter and order on `/sales/list`; the reason stated on ranked
rows. Built to SLICE-2A3-PREFLIGHT.md §2 and §7. No schema change, migration, index or write path.
Deploys only through a separate rollout task after 2A.3a-2 is promoted.

## Owner decision

**Q1 (2026-09-30): yes.** Ship rank 5 "Strong fit, untouched" even if it starts near-empty. Blank data
continues to score nothing, and the SQL/TypeScript parity test must remain exhaustive.

## What was built

| Rank | Reason shown | Condition (active, anchored, not closed) |
|---|---|---|
| 1 | Overdue follow-up | open follow-up past due (the queue's existing `DUE_STATE`) |
| 2 | Due today | open follow-up due today, Los Angeles, database clock |
| 3 | Warm, no next step | latest contact `interested`, `callback_requested` or `meeting_set`, no open follow-up |
| 4 | Proposal out | stage `proposal`, last contact 7 or more days ago, or never |
| 5 | Strong fit, untouched | score tier `hot` or `priority` (SQL copy of `computeScore`), never contacted |
| 6 | New, assigned to you | assigned to the viewer, never contacted |

- `core/db/sales-reads.ts`: `SCORE_POINTS_SQL` / `SCORE_TIER_SQL`, the rank `CASE` (its order is the
  rank order, so only the highest reason applies), a `priority` column on every summary row (NULL
  without a viewer), the `priority` filter and sort, and a `priority` section whose total is the sum of
  its per-reason counts (two statements).
- Order inside the priority sort: rank, earliest due, oldest last contact (never contacted first),
  then — rank 6 only — oldest witnessed assignment, then name; keyset-paged with the same fixed-width
  string-key technique as the existing sorts.
- `core/crm/sales.ts`: the viewer is always the resolved principal, never a caller-supplied id.
  A priority filter or sort without a viewer is refused, not guessed.
- `lib/sales-queue-url.ts`: `priority=1` (default order `priority`; a bare `sort=priority` falls back
  to `name`), cursor validation. Added to the write paths by scope change (the preflight omitted it).
- UI: Priority section first with per-reason counts; "See all" → `/sales/list?scope=…&priority=1`;
  "Priority only" toggle; the reason label appears only where rows are ranked (Priority section,
  priority list) — elsewhere the section heading already says it, and repeating it was clutter.

## Design choices for review

1. **Rank 6 "oldest assignment first".** Prospects carry no `assigned_at`. The time used is the latest
   `prospect.reassigned` event whose `to` is the current assignee (claim, claim-in-Save and reassign
   all emit one; `events_subject_idx`). Assignments with no such event (imports, anything before 010)
   have no known time: they sort after the known ones, by name, and are never given an invented time.
2. **Rank 4 includes a proposal never contacted** ("no contact in 7+ days" holds vacuously), placed
   first within rank 4 by the oldest-contact tie-break.
3. **"Never contacted" is `last_contact IS NULL`,** the same test as the existing never-contacted filter.

## Evidence

- **Tests** (`tests/db/sales-reads.test.ts`, PGlite 001–010, through real commands where history is
  needed): 33 passed (20 existing, 13 new). New: exhaustive score parity; each rank with its boundary
  (overdue vs due today vs upcoming; warm outcomes vs a cold one vs a warm one with a follow-up; the
  exact 7-day proposal edge; hot and priority vs warm, blank and contacted; rank 6 for the viewer only);
  highest-wins; rank-6 order (witnessed oldest first, unknown last); rank order and keyset pages equal
  one full read; per-reason counts sum to the total and match the list; the partner's Mine scope never
  shows another member's rows and Team shows only rows the partner can read; viewer required; URL
  parse, default order, round-trip and tamper refusal. The two existing summary key-set assertions
  were widened deliberately to include `priority`.
- **Score parity:** SQL points and tier equal `computeScore` on all 180 combinations of
  `website_quality` (4 values + NULL), `decision_maker_access`, `project_urgency` (3 + NULL) and
  `niche_alignment`, each with blanks both absent and null; the enumerated domains are read from the
  schema's own CHECK constraints, so a new enum value fails the test; all four tiers are reached.
- **UI tests:** 17 passed (`sales-presentation`: the six reasons' exact wording, total over the ranks,
  no digits; `sales-browse-filters`: the Priority toggle submits `priority=1`, and the priority order is
  offered only with the filter).
- **Mutants,** each turned tests red and was restored byte-for-byte: hot threshold 55→50 (1); rank 3
  ignoring the open follow-up (1); the 7-day edge `<=`→`<` (1); rank 6 ignoring the viewer (12); a blank
  urgency scoring as high (2); unknown assignment time sorting first (1); rank 5 moved above rank 2 (1).
- **Scale,** PostgreSQL 17.6 fixture on a Unix socket (never production): 3,300 prospects, 3,630
  contacts, 825 open follow-ups, 990 witnessed assignments, statistics current. Median of 7, through
  the real RLS roles:

  | Section | Owner (Team) | Partner (Mine + unassigned) |
  |---|---|---|
  | Priority | 14.3 ms | 11.8 ms |
  | Overdue | 4.5 ms | 3.9 ms |
  | Due today | 3.6 ms | 3.3 ms |
  | Unassigned | 4.7 ms | 4.6 ms |
  | Never contacted | 3.7 ms | 3.3 ms |
  | Recently contacted | 3.7 ms | 3.3 ms |

  Plans: sequential scans only on `prospects` (2,640 open rows) and the 825 open follow-ups (right at
  this size); per-row lookups on `prospect_contacts_timeline` and `events_subject_idx`. A first run
  immediately after the bulk seed, before statistics existed, measured every section (existing ones
  included) at 58–846 ms; that was stale statistics, not the queries, and is recorded so the numbers
  above are not mistaken for a cherry-pick. That observation also removed a redundant `count(*)`
  from the priority section (its total is now the sum of the per-reason counts).
- **Rendered proof** (fixture PG 17.6, `next dev` with every production variable unset, headless
  Chrome, owner AND partner, 390×844, 640×900, 667×375, 768×1024, 1024×800, 1440×900; `/sales` and
  `/sales/list?priority=1`, 24 pages, re-run after the final UI change): no horizontal overflow on any
  page; no link under 44 px on coarse pointers; phone form text 16 px; Priority is the first section and
  the section nav leads with "Priority · N"; 10 rows, each with its reason; the list titled "Priority"
  with 50 ranked rows; "Priority only" label 350×44 (phone dialog), 282×44 and 242×44 (inline); keyboard
  pass at 390 and 1440 for both roles reaches the Priority rows in DOM order with a visible focus
  indicator. Screenshots were inspected; they are kept outside the repository.
- **Pre-existing, not introduced here:** two 24×24 checkboxes in the Add-target form (labels 150×44 and
  132×44) and the filter checkboxes' 24×24 boxes inside ≥44 px labels; a `/favicon.ico` 404 on the dev
  server; one lint error in `tests/ui/record-contact.test.ts` (identical on the baseline).

## Scope

Thirteen files plus this checkpoint, all within the task's write paths after two recorded scope
changes: `lib/sales-queue-url.ts` (the priority URL, omitted from the preflight), and two existing
tests the first proof run showed must move with the change — `tests/db/page-matrix-provisioned.test.ts`
(the rendered queue bound, 70 → 80 rows, now also asserting the Priority section's own cap of 10) and
`tests/db/sales-routes.test.ts` (the summary key set gains `priority`). The builder had run only the
files it owned before that proof run; the db phase caught both. The fixture probe route, scratch scripts, dev-server output and the
cluster were removed; `tsconfig.json` is unchanged. No production contact by the builder.
