# Slice 2A.3 — Sales priority dashboard and unified prospect pipeline · PRE-FLIGHT

**Status: DESIGN ONLY.** No code, no migration, no production contact, no deployment. Baseline
`b85c63c` (2A.2e promoted). Every fact below cites the file it was read from at that baseline.
**Round 2** corrects four r1 errors: the partner's landing, the promotion transition, the per-slice
contract, and the client anchor name. §9 lists each correction.

## 0 · What exists today

| Fact | Where | Consequence for 2A.3 |
|---|---|---|
| **Production is not running any 2A.1c–2A.2e code.** The served build is dated 2026-09-21 00:12 (the D1 deploy), and the production ledger is 001–009. `010_sales_actions.sql` is not applied | `.next/BUILD_ID` in the serving tree; `docs/DEPLOYMENT-D1-CHECKPOINT.md`; `docs/DEPENDENCY-D1B2-CHECKPOINT.md` | Everything built in 2A.1c–2A.2e is promoted but not live. 2A.2's pre-flight reserved "2A.3" for this rollout (its §16). It is folded in as 2A.3a (§1) |
| A recovery profile for 010 already exists: `post-010-v1`, pinned to 010's checksum | `core/recovery/profile-registry.ts:52,79`; `core/recovery/profiles.ts:290` | The rollout needs authorization and an owner run, not new recovery engineering |
| `/sales` is a bounded work queue with five sections (Overdue, Due today, Unassigned, Never contacted, Recently contacted) and a Mine/Team scope | `app/sales/page.tsx:15-19,34` | The priority dashboard extends this queue. It does not replace it |
| **The partner lands on `/`, the Galaxy.** `landingFor` returns the first `LANDING_ORDER` entry (`["/", "/partner"]`) whose `requires` the principal holds. Since 2G.4.7 the sales partner holds every capability `/` requires, so `landingFor(SALES)` is `/` | `lib/landing.ts`; `navigation/destinations.ts:53-56,100`; `core/auth/capabilities.ts:108-150`; `tests/auth/landing.test.ts:54-59` | The partner starts on the Galaxy, not on the Sales work. The queue is one nav tap away ("Pipeline") |
| **Galaxy primacy (1B):** the 3D Galaxy is `/`'s primary experience | `docs/SLICE-2A2-PREFLIGHT.md:15` (owner-recorded at 1B acceptance) | Making the queue anyone's default landing trades against a recorded owner invariant, so it is an owner decision (Q2), not a cleanup |
| **`/partner` is a secondary nav destination** ("Partner", Command group, requires `prospects:read` + `search`). It calls `listProspects()` and renders every prospect, about 3,100 rows (open, then closed), with a footer link to "Pipeline" | `navigation/destinations.ts:57-59`; `app/partner/page.tsx:52-90` | The remaining unbounded list, and a second entry point to the same work as "Pipeline" |
| The retired pages redirect: `/dashboard` goes to `/`, and `/search` goes to `/console` (keeping `?q=`). Both targets are renderable by owner and partner | `app/dashboard/page.tsx:13-14`; `app/search/page.tsx:20-27` | No dead end here; nothing to change |
| The existing scorer `computeScore` uses `website_quality` (none/outdated +30), `decision_maker_access` +25, `project_urgency` high +25, and `niche_alignment`. Absent data scores zero (D-1) | `core/crm/scoring.ts:18-60` | Useful only where fields are filled. §8 measures how many are |
| Priority-relevant columns on `prospects`: `status`, `assigned_to`, `last_contact`, `first_contact`, `website`, `website_quality`, `website_opportunity` (+`assessed_by/at`), `decision_maker_access`, `project_urgency`, `niche_alignment`, `business_type`, `location`, `source` | `001_substrate.sql:95-125`; `002_prospect_fields.sql:22-26` | No schema change is needed for a first priority rule |
| 3,108 prospects: 3,102 imported with no slug and an empty `notes` body; 0 `prospect_notes` rows at D1b.2 | `docs/DEPENDENCY-D1A-CHECKPOINT.md:23-30`; `docs/DEPENDENCY-D1B2-CHECKPOINT.md:40` | Most imported rows carry only identity, contact and website data |
| **Three notes stores:** (1) `prospects.notes`, one imported markdown body; (2) `prospect_notes`, an append-only authored log (008); (3) `prospect_contacts.note` and `prospect_followups.note` (010) | `003_prospect_notes.sql:21`; `008_prospect_notes_log.sql:1-20`; `010_sales_actions.sql:72,98` | The display must say which is which, never merge them |
| Notes are **prospect-only.** Client and production pages read none of the three stores | `app/clients/[slug]/page.tsx`, `app/production/*` | Notes stop being visible when a prospect becomes a client |
| **Promotion is already a single, provenance-complete transition.** `promoteProspect` writes four party-layer vault files and creates the client (found by anchor first, so retries converge). Its business context carries `prospect.body` ("Carried over from prospect notes"). The client records the anchor as **`promoted_from_prospect_id`**. `markProspectPromoted` then changes the stage through `ascend_transition_stage(…, 'closed-won', 'promotion', …)` and appends `prospect.status_changed` under one correlation id | `core/crm/promote.ts:3,140-143,198,235,271`; `core/db/prospects.ts:517-560` | The stage change and its event already exist. What does NOT follow the client: the note log, the contact history and open follow-ups. Promotion does not resolve open follow-ups |
| **`closed-won` exists only through promotion.** The ordinary Sales command refuses a standalone `closed-won` | `core/db/sales-actions.ts:234` (`closed_won_not_permitted`) | No UI may offer "set closed-won" on its own; it must enter the promotion path |
| An anchor-keyed prospect reader exists: `findByProspectId`, including archived rows | `core/db/prospects.ts:206-209` | The client page can reach the prospect's history through the guarded read, with no new authority |
| Capabilities: the sales partner holds everything the owner holds except `admin:*` and `prospects:manage`, so it can promote and read clients | `core/auth/capabilities.ts:74-150` | 2A.3 changes no capability |

## 1 · The production gap comes first (2A.3a)

Owner decision Q0 is **fixed: yes**. The already-reviewed Sales stack goes live before any 2A.3
feature. 2A.3a is rollout only, with no new behaviour, and it is split in two:

- **2A.3a-1** (built and published separately) writes the frozen execution contract
  `docs/SLICE-2A3A-EXECUTION-CONTRACT.md`, plus the 010 apply/verify scripts and the Sales smoke.
- **2A.3a-2** is the owner-authorized execution of that contract.

Findings the contract carries, recorded here so the plan does not repeat r1's mistake:
- **010 and the serving D1 build are incompatible.** 010 revokes the `status` grant that D1's promotion
  write uses (`ba648d3:core/db/prospects.ts:523`), so migrate and deploy are ONE stopped-service
  window.
- **The D1 `.next` clone stops being a rollback** once 010 commits.
- **The pre-migration backup comes from `8ef09f5`,** whose schema ends at 009: backup A5 correctly
  refuses to back up 009 production from a 010 tree.
- **The main checkout must be clean first.** It serves production and carries an uncommitted
  `apps/os/next.config.ts` edit, which must be reverted before any build there. I1 (serving out of
  iCloud) remains a recorded risk.

## 2 · Priority: what "high priority" means before website scoring exists

A priority is a **reason to act now**, stated in words, not a hidden number. Each prospect gets its
highest applicable reason. Every reason is computable in SQL from existing columns and the 010 tables.

| Rank | Reason (shown on the row) | Condition (active, anchored, not closed) |
|---|---|---|
| 1 | **Overdue follow-up** | open follow-up past due (the queue's existing definition) |
| 2 | **Due today** | open follow-up due today (LA) |
| 3 | **Warm, no next step** | latest contact outcome `interested`, `callback_requested` or `meeting_set`, and no open follow-up |
| 4 | **Proposal out** | stage `proposal` and no contact in 7+ days |
| 5 | **Strong fit, untouched** | `computeScore` tier `hot` or `priority`, and never contacted |
| 6 | **New, assigned to you** | assigned to the viewer, never contacted, oldest assignment first |

- **Tie-breaks** within a rank: earliest due, then oldest last contact, then name.
- **Scope** follows the existing Mine/Team toggle.
- **Where it shows:** a first section on `/sales`, "Priority · N", bounded to 10 rows with "See all" to
  `/sales/list?priority=1`. Each row states its reason.
- **Website quality slots in as data.** Website intelligence later fills `website_quality` and
  `website_opportunity` with provenance. Rank 5 activates through `computeScore`, which already reads
  `website_quality`. A new rank can be inserted without reordering.
- **Rank 5 may start near-empty** (§8 measures it).
- **No AI scoring,** and no reason inferred from missing data (D-1).

## 3 · One pipeline for the partner

**The landing is unchanged by default.** The partner (like the owner) lands on the Galaxy, which is
Galaxy primacy, and reaches Sales work through "Pipeline". What 2A.3c changes:

- **`/partner` stops being a second, unbounded pipeline.** Recommended (Q2a): `/partner` becomes a
  permanent redirect to `/sales` (keeping `?scope=`), and the "Partner" nav destination is removed, so
  "Pipeline" is the one entry to Sales work. `/partner` stays a valid URL, so bookmarks and the
  `LANDING_ORDER` fallback still resolve.
- **Making the queue the partner's default landing is a separate owner decision (Q2b),** because it
  trades against Galaxy primacy. If chosen, the change must stay routing, never authorization. Either
  add a preferred-landing rule keyed on capabilities already held (not a role name), or reorder
  `LANDING_ORDER`, which would move the owner too. `tests/auth/landing.test.ts` must then assert the
  new order for OWNER and SALES explicitly. Page authorization (`PAGE_AUTHORIZATION`, F56) is not
  touched.
- **A stage summary** on `/sales`: counts per stage (lead, contacted, proposal, won, lost this month),
  each linking to the filtered `/sales/list`.
- **Every screen has a next step:**
  - the prospect breadcrumb returns to the queue with its scope;
  - empty sections say what fills them;
  - held prospects link to identity work.
- **Capabilities are unchanged.**

## 4 · Notes that are visible and usable

- **One notes panel on the prospect page**, with three labelled groups in time order:
  - "Log" (`prospect_notes`, authored and timestamped);
  - "From contacts" (contact and follow-up notes, with outcome and date);
  - "Imported record" (the `prospects.notes` body, collapsed, shown once).

  Adding a note keeps writing to `prospect_notes` through the existing route.
- **Notes follow the client by reference, not by copy.** The client's vault record carries
  **`promoted_from_prospect_id`** (the prospect's identity anchor). The client page gains a read-only
  "Sales history" panel that:
  - resolves that anchor with `findByProspectId` inside the existing guarded prospect read
    (`withProspectDb(…, "prospects:read")`);
  - then reads the three stores for that row.

  No anchor means no panel (clients that were never prospects). An anchor that resolves to nothing is
  shown as "history unavailable", never guessed. Nothing is duplicated, and there is no new authority:
  a principal without `prospects:read` sees no panel.
- **Engines read one function:** a server-side `notesFor(prospectRowId)` in `core/crm/notes.ts` returns
  the three groups with author and time. Sales, the client page and later engines call it instead of
  reading tables directly.
- **Writing notes on a client** needs a new store or vault convention. That is a schema or authorization
  change, so it is decision Q4 and not part of 2A.3.

## 5 · Prospect → client, smoother (a UI entry, not a new path)

Promotion already does the right things (§0): client first, then the stage through
`ascend_transition_stage` with cause `promotion`, the `prospect.status_changed` event, one
correlation id, and convergent retry. **2A.3e changes only where it is offered:**

- The prospect page's stage area offers **"Won — create client"**, which calls the existing
  `POST /api/prospects/[slug]/promote` exactly as `PromoteButton` does today. The stage picker never
  offers a standalone `closed-won`, which the Sales command refuses anyway (`closed_won_not_permitted`).
  After success, the page links to the new client, where the §4 panel shows the history.
- **Open follow-ups on promotion are specified separately (Q5).** Promotion leaves them open today. The
  recommended treatment resolves each one inside the promotion's transaction with a recorded
  reason and the same correlation id. That is a domain change to the promotion path (`core/crm/promote.ts`,
  `core/db/prospects.ts`), so it is its own slice (2A.3f) with its own convergence and retry tests,
  not a side effect of the UI slice.
- The existing guarantees are untouched: identity anchor, one prospect equals one client, convergent
  retry, no bare catch, and the transition provenance.

## 6 · Less clutter

| Item | Action |
|---|---|
| `/partner` renders every prospect and duplicates "Pipeline" | Redirect to `/sales`; drop the "Partner" nav entry (Q2a) |
| The prospect page's research, notes and promote sections are equal-weight blocks below the timeline | Notes panel (§4); promotion offered in the stage area (§5); research collapsed by default |
| Unbounded lists | Fixed on `/sales` by 2A.2c; `/partner` is the last one |

## 7 · Implementation slices

Every UI slice ends with the **Slice 1C rendered proof**:
- headless-Chrome screenshots at 390×844, 640×900, 667×375, 768×1024, 1024×800 and 1440×900, as owner
  AND partner;
- no horizontal overflow; no target under 44px on coarse pointers; 16px form text on phones;
- a keyboard pass (focus order, visible focus, Escape and return focus for any dialog);
- the fixture-PG17 method (no production).

"Proof" below adds each slice's specific evidence. Every slice keeps `tests/architecture/gate-2g1.ts`
total. A new test file is classified in the same slice, so `gate-2g1.ts` is in each slice's write
paths when it adds a test.

| Slice | Contents | Allowed write paths | Gates | Proof beyond the 1C pass | Owner decisions |
|---|---|---|---|---|---|
| **2A.3a-1** · rollout contract | contract, 010 apply/verify, Sales smoke | `apps/os/docs/SLICE-2A3A-EXECUTION-CONTRACT.md`, `apps/os/scripts/{apply,verify}-migration-010.mjs`, `apps/os/scripts/deploy-smoke.mjs`, `apps/os/tests/architecture/rollout-010.test.ts`, `apps/os/tests/architecture/gate-2g1.ts` | typecheck, gate:static | local 17.6 rehearsal, smoke probes against the candidate (no 1C pass: no UI) | — |
| **2A.3a-2** · rollout execution | the contract's T0–T13 | `apps/os/docs/DEPLOYMENT-2A3A-CHECKPOINT.md` | full aggregate on the deploy tree (contract P2) | contract §7 evidence | D1–D6 of the contract |
| **2A.3b** · priority | §2 reasons as bounded SQL with counts; "Priority · N" section; `priority` list filter; reason label on rows | `apps/os/core/db/sales-reads.ts`, `apps/os/core/crm/sales.ts`, `apps/os/app/sales/page.tsx`, `apps/os/app/sales/list/page.tsx`, `apps/os/components/sales/SalesQueueRow.tsx`, `apps/os/components/sales/SalesBrowseFilters.tsx`, `apps/os/components/sales/presentation.ts`, `apps/os/tests/db/sales-reads.test.ts`, `apps/os/tests/ui/sales-browse-filters.test.ts`, `apps/os/tests/ui/sales-presentation.test.ts` | typecheck, gate:static, gate:server, gate:db | a 17.6 scale test at production size (3,100+ prospects) timing every section query; each rank shown to discriminate (a row qualifying for two ranks gets the higher one); RLS: the partner's Mine scope never shows another member's rows | Q1 |
| **2A.3c** · one pipeline | `/partner` redirect; the "Partner" nav destination removed; stage summary on `/sales`; and, only if Q2b is chosen, the landing change | `apps/os/app/partner/page.tsx`, `apps/os/navigation/destinations.ts`, `apps/os/components/shell/NavRail.tsx`, `apps/os/app/sales/page.tsx`, `apps/os/core/db/sales-reads.ts`, `apps/os/tests/auth/landing.test.ts`, `apps/os/tests/auth/nav-visibility.test.ts`, `apps/os/tests/auth/page-denial.test.ts` | typecheck, gate:static, gate:server | `nav-visibility` and `page-denial` unchanged in meaning (no destination gains a principal); landing asserted for OWNER and SALES; `/partner` → `/sales` for both | Q2a, Q2b |
| **2A.3d** · notes | `notesFor`; prospect notes panel; client "Sales history" panel via `promoted_from_prospect_id` → `findByProspectId` | `apps/os/core/crm/notes.ts`, `apps/os/core/db/sales-reads.ts`, `apps/os/components/sales/ProspectNotes.tsx`, `apps/os/app/sales/[prospect]/page.tsx`, `apps/os/app/clients/[slug]/page.tsx`, `apps/os/tests/db/prospect-notes.test.ts`, `apps/os/tests/ui/notes-panel.test.ts`, `apps/os/tests/ui/record-contact.test.ts`, `apps/os/tests/architecture/gate-2g1.ts` | typecheck, gate:static, gate:server, gate:db | RLS reads as owner and partner; cross-organization isolation (another org's anchor resolves to nothing); client without an anchor shows no panel; unresolved anchor says "history unavailable" | Q3 |
| **2A.3e** · promotion entry | "Won — create client" in the stage area, calling the existing promote route; link to the client afterwards | `apps/os/app/sales/[prospect]/page.tsx`, `apps/os/components/PromoteButton.tsx`, `apps/os/components/sales/ProspectNow.tsx`, `apps/os/tests/ui/owner-controls.test.tsx`, `apps/os/tests/ui/record-contact.test.ts` | typecheck, gate:static, gate:server | the stage picker never offers standalone `closed-won`; the promote request body is byte-identical to `PromoteButton`'s; retry after a lost response converges on one client (existing D1a probes still pass) | Q6 |
| **2A.3f** · follow-ups on promotion | resolve open follow-ups inside the promotion transaction, with reason and correlation id | `apps/os/core/crm/promote.ts`, `apps/os/core/db/prospects.ts`, `apps/os/tests/db/d1-promotion.test.ts`, `apps/os/tests/db/sales-actions.test.ts` | typecheck, gate:static, gate:db | convergent retry resolves each follow-up exactly once; a partial promotion leaves them untouched; the events share the correlation id (no UI, no 1C pass) | Q5 |

**Order:** 2A.3a-1, then 2A.3a-2. 2A.3b and 2A.3c may be built in parallel with 2A.3a-2, but deploy only
after it. 2A.3d–f follow 2A.3a-2, because they matter only once the partner is on the new build.

## 8 · Measurement needed before 2A.3b (read-only, owner-authorized)

One read-only aggregate against production, counts only:
- how many active prospects have a non-null `website_quality`, `decision_maker_access`,
  `project_urgency`, `niche_alignment` and `website`;
- how many are assigned, per member (as a count).

It decides Q1. Until 2A.3a-2 applies 010 there is no contact or follow-up data in production, so
ranks 1–4 start empty and fill as the partner works.

## 9 · Round-2 corrections (Codex r1 findings)

| Finding | r1 said | Corrected to |
|---|---|---|
| F1 | the partner cannot render `/`, lands on `/partner`, and `/dashboard` denies them | the partner lands on `/` (`landingFor(SALES)`, `tests/auth/landing.test.ts:59`); `/partner` is a secondary nav page; `/dashboard` is not a dead end. Making the queue the default is Q2b against Galaxy primacy |
| F2 | promotion bypasses the stage command and writes no stage event; the stage picker should set closed-won and promote | promotion already transitions through `ascend_transition_stage` with cause `promotion` and appends `prospect.status_changed`; standalone `closed-won` is refused. 2A.3e is a UI entry into the existing path, and follow-up closure is its own slice (2A.3f) |
| F3 | slices without write paths or complete gates | §7 gives exact write paths, gates, the 1C proof and per-slice evidence |
| F4 | the client stores `prospect_id` | the client stores `promoted_from_prospect_id`, resolved with `findByProspectId` inside the guarded prospect read |

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q0 | Roll out 2A.1c–2A.2e (2A.3a) before new features? | **Decided: yes** |
| Q1 | Ship rank 5 even if the §8 count is near zero? | Ship it; an empty rank costs nothing and fills when website intelligence lands |
| Q2a | `/partner`: redirect to `/sales` and drop its nav entry? | Yes. One place to work |
| Q2b | Make the Sales queue the partner's default landing (against Galaxy primacy)? | Not in 2A.3; revisit after the partner has used the rolled-out queue |
| Q3 | Show the imported markdown body in the notes panel? | Yes, collapsed and labelled "Imported record" |
| Q4 | Client-side note writing (new store) | Defer; a separate slice with its own schema contract |
| Q5 | Open follow-ups when a prospect is promoted | Resolve them inside the promotion, with reason "promoted to client" (2A.3f) |
| Q6 | May the partner promote (currently allowed by capability)? | Keep as is; no capability change in 2A.3 |

Out of scope: mobile responsiveness beyond the Sales surfaces, Ascend Core / command center, general
performance work, and website detection, scoring and ranking for the ~3,000 leads. Each is a later
slice, and §2 is shaped so the last one plugs in without redesign.
