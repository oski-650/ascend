# Slice 2A.3 — Sales priority dashboard and unified prospect pipeline · PRE-FLIGHT

**Status: DESIGN ONLY.** No code, no migration, no production contact, no deployment. Baseline
`b85c63c` (2A.2e promoted). Every fact below cites the file it was read from at that baseline.

## 0 · What exists today

| Fact | Where | Consequence for 2A.3 |
|---|---|---|
| **Production is not running any 2A.1c–2A.2e code.** The served build is dated 2026-09-21 00:12 (the D1 deploy), and the production ledger is 001–009. `010_sales_actions.sql` is not applied | `.next/BUILD_ID` in the serving tree; `docs/DEPLOYMENT-D1-CHECKPOINT.md`; `docs/DEPENDENCY-D1B2-CHECKPOINT.md` | Everything built in 2A.1c–2A.2e (contacts, follow-ups, queue, owner controls, accessibility) is promoted but not live. 2A.2's pre-flight reserved "2A.3" for exactly this rollout (§16 there). It cannot be dropped; §1 folds it in |
| A recovery profile for 010 already exists: `post-010-v1`, pinned to 010's checksum | `core/recovery/profile-registry.ts:52,79`; `core/recovery/profiles.ts:290` | The rollout needs authorization and an owner run, not new recovery engineering |
| `/sales` is a bounded work queue with five sections: Overdue, Due today, Unassigned, Never contacted, Recently contacted. It has a Mine/Team scope | `app/sales/page.tsx:15-19,34` | The priority dashboard extends this queue. It does not replace it |
| **The partner's landing page is not the queue.** `LANDING_ORDER` is `["/", "/partner"]`, and a sales principal cannot render `/`, so the partner lands on `/partner`. That page calls `listProspects()` and renders every prospect, about 3,100 rows (open, then closed), with a footer link to "Pipeline" | `navigation/destinations.ts` (LANDING_ORDER); `app/partner/page.tsx:52-90` | The single biggest clutter problem. The partner's first screen is the unbounded list 2A.2 removed from `/sales` |
| The nav shows "Partner" and "Pipeline" as two Command/Work destinations for the same person | `navigation/destinations.ts:53-66` | Two entry points to the same work |
| The retired pages already redirect: `/dashboard` goes to `/`, and `/search` goes to `/console` (keeping `?q=`). But `/` denies a sales principal, so an old `/dashboard` link lands the partner on a denial | `app/dashboard/page.tsx:13-14`; `app/search/page.tsx:20-27` | One real dead end: `/dashboard` should follow the capability-aware landing order instead of a fixed `/` |
| The existing scorer `computeScore` uses `website_quality` (none/outdated +30), `decision_maker_access` +25, `project_urgency` high +25, and `niche_alignment`. It deliberately scores absent data as zero (D-1) | `core/crm/scoring.ts:18-60` | Useful only where the fields are filled in. §2 depends on how many of the ~3,100 rows have them, which is unmeasured (§8) |
| Priority-relevant columns on `prospects`: `status`, `assigned_to`, `last_contact`, `first_contact`, `website`, `website_quality`, `website_opportunity` (+`assessed_by/at`), `decision_maker_access`, `project_urgency`, `niche_alignment`, `business_type`, `location`, `source` | `core/db/schema/001_substrate.sql:95-125`; `002_prospect_fields.sql:22-26` | No schema change is needed for a first priority rule |
| 3,108 prospects: 3,102 imported with no slug and an empty `notes` body; 0 `prospect_notes` rows at D1b.2 | `docs/DEPENDENCY-D1A-CHECKPOINT.md:23-30`; `docs/DEPENDENCY-D1B2-CHECKPOINT.md:40`; `docs/DEPENDENCY-D1B2-EXECUTION-CONTRACT.md:151` | Most imported rows carry only identity, contact and website data |
| **Three notes stores:** (1) `prospects.notes`, one imported markdown body per row, never split; (2) `prospect_notes`, an append-only authored log (008); (3) `prospect_contacts.note` and `prospect_followups.note`, notes attached to a contact or follow-up (010) | `003_prospect_notes.sql:21`; `008_prospect_notes_log.sql:1-20`; `010_sales_actions.sql:72,98` | "Notes" means three different things. The display must say which is which, never merge them into one blob |
| Notes are **prospect-only.** Client and production pages read none of the three stores | `app/clients/[slug]/page.tsx`, `app/production/*` (no notes readers) | Notes stop being visible the moment a prospect becomes a client |
| **Promotion copies only the imported body.** `promoteProspect` writes four party-layer vault files, puts `prospect.body` into the client's business context ("Carried over from prospect notes"), records `prospect_id` on the client, and sets the prospect to `closed-won` | `core/crm/promote.ts:3,140-143,434-446`; `core/db/prospects.ts:517` (`markProspectPromoted`) | For the 3,102 imported rows the carried body is empty. The note log, the contact history and open follow-ups do not follow the client. The stage change bypasses the 2A.1c stage command, so no stage event is written through the Sales path |
| Capabilities: the sales partner holds everything the owner holds except `admin:*` and `prospects:manage`, so it can promote and read clients | `core/auth/capabilities.ts:74-150` | 2A.3 changes no capability. Any change is an explicit owner decision |

## 1 · The production gap comes first (2A.3a)

2A.3's value depends on the partner using it, and today the partner uses the D1 build. The
recommended order puts the rollout first:

1. **Backup.** A fresh encrypted artifact of the current production database (ledger 009).
2. **Recovery re-proof on that artifact** with the existing R1b and R1c legs, under the COORD-PROOF-001
   `prove --owner` flow (one silent-prompt owner action).
3. **Apply 010** to production, alone in its own window, with the D1b.2 procedure:
   - read-only pre-flight;
   - apply;
   - read-only post-verification of the ledger, checksums, the four Sales tables, functions and grants.
4. **Deploy** the promoted baseline with the D1 order: baseline smoke, `.next` rollback clone,
   `bootout`, build from a clean committed tree, `bootstrap`, post smoke. The smoke gains the Sales
   routes and must pass as both the owner and the partner.
5. **After-artifact.** A new backup verified against `post-010-v1`.

2A.3a is a production mutation. It needs its own authorized execution contract (as D1b.2 had),
owner-run steps, and the rollback stated for each step. **The rollback for step 3 must be decided
before execution:** 010 adds tables, functions and grants but alters no existing column's data, so the
choices are forward-fix versus restore from the step-1 artifact.

Independent prerequisite: the main checkout, which is also production's serving tree, carries an
uncommitted `apps/os/next.config.ts` edit (`allowedDevOrigins`). It must be reverted before any build
there. The iCloud-serving risk (infrastructure slice I1) still applies.

## 2 · Priority: what "high priority" means before website scoring exists

A priority is a **reason to act now**, stated in words, not a hidden number. The rule is a fixed
order of reasons. Each prospect gets its highest applicable reason. Every reason is computable in SQL
from existing columns.

| Rank | Reason (shown on the row) | Condition (active, anchored, not closed) |
|---|---|---|
| 1 | **Overdue follow-up** | open follow-up past due (the queue's existing definition) |
| 2 | **Due today** | open follow-up due today (LA) |
| 3 | **Warm, no next step** | latest contact outcome is `interested`, `callback_requested` or `meeting_set`, and there is no open follow-up |
| 4 | **Proposal out** | stage `proposal` and no contact in 7+ days |
| 5 | **Strong fit, untouched** | `computeScore` tier `hot` or `priority`, and never contacted |
| 6 | **New, assigned to you** | assigned to the viewer, never contacted, oldest assignment first |

- **Tie-breaks** within a rank: earliest due, then oldest last contact, then name.
- **Scope** follows the existing Mine/Team toggle.
- **Where it shows:** a new first section on `/sales`, "Priority · N", bounded to 10 rows with "See all"
  going to `/sales/list?priority=1`. Each row states its reason.
- The later **website-quality score slots in as data, not as a redesign.** Website intelligence fills
  `website_quality` and `website_opportunity` with provenance (`assessed_by/at`). Rank 5 then
  activates for those rows through `computeScore`, which already reads `website_quality`. A new rank
  can be inserted without reordering the others.
- **Rank 5 may be nearly empty on day one**, because imported rows rarely carry scorer fields. The
  measurement in §8 decides whether it ships in 2A.3b or waits for website intelligence.
- **No AI scoring.** No reason may be inferred from missing data (the D-1 rule).

## 3 · One pipeline for the partner

- **The partner lands on the queue.** `/partner` stops rendering all ~3,100 prospects. Recommended:
  `/partner` redirects to `/sales` (Mine), and the nav keeps a single "Pipeline" entry. The
  alternative (owner decision Q2) keeps `/partner` as a short personal summary: Priority count, today's
  follow-ups, and a link to the queue.
- **A stage summary** on `/sales`: counts per stage (lead, contacted, proposal, won, lost this month),
  each linking to the filtered `/sales/list`. This is the "pipeline" view, built from the existing
  list filters.
- **Every screen has a next step:**
  - the prospect page's breadcrumb returns to the queue with its scope kept;
  - an empty section explains what fills it;
  - held prospects link to identity work;
  - `/dashboard` redirects through the landing order instead of to `/`.
- **Capabilities are unchanged.** The partner keeps `prospects:write` without `prospects:manage`, and
  the owner controls from 2A.2d stay owner-only.

## 4 · Notes that are visible and usable

- **One notes panel on the prospect page**, with three labelled groups in time order:
  - "Log" (`prospect_notes`, authored and timestamped);
  - "From contacts" (contact and follow-up notes, with outcome and date);
  - "Imported record" (the `prospects.notes` body, collapsed, shown once).

  Adding a note keeps writing to `prospect_notes` through the existing route.
- **Notes follow the client by reference, not by copy.** The client already stores the prospect's
  `prospect_id` (promotion rule 2). The client page gains a read-only "Sales history" panel that
  reads the three stores through that anchor. It is authorized by the existing prospect-read
  boundary, so nothing is duplicated and nothing drifts.
- **Engines read one function:** a server-side `notesFor(prospectRowId)` in `core/crm` returns the
  three groups with author and time. Sales, Production and the knowledge index call it instead of
  reading tables directly.
- **Writing notes on a client** (not a prospect) needs a new store or a vault convention. That is a
  schema or authorization change and a separate owner decision (Q4), not part of 2A.3.

## 5 · Prospect → client, smoother

The current transition is a separate "Promote to client" action. Recommended:

- It is offered where the decision happens: in the stage picker, when the owner or partner sets
  `closed-won`, as an explicit second choice "and create the client". Promotion is never automatic.
- On promotion:
  - open follow-ups are closed with an explicit recorded reason (decision Q5);
  - the stage change goes through the 2A.1c stage command, so the Sales event spine records it;
  - the client page opens with the "Sales history" panel from §4.
- The existing promotion guarantees stay intact: identity anchor, one prospect equals one client,
  convergent retry, no bare catch.

## 6 · Less clutter

| Item | Action |
|---|---|
| `/partner` renders every prospect | Redirect or summarize (§3, Q2) |
| "Partner" and "Pipeline" both in the nav | One entry |
| `/dashboard` redirects to `/`, which denies the partner | Redirect via the landing order |
| The prospect page's research, notes and promote sections are equal-weight blocks below the timeline | Notes panel (§4) and a promote affordance in stage (§5). Research is collapsed by default |
| The full-list pages load every row | Already fixed on `/sales` by 2A.2c. `/partner` is the remaining instance |

## 7 · Implementation slices

Each slice is one review round, is built to the Slice 1C floor, and ends with rendered proof at the
six viewports plus a keyboard pass. There is no schema change unless noted.

| Slice | Contents | Gates and proof | Owner decisions |
|---|---|---|---|
| **2A.3a** · production rollout | §1 steps 1–5, under an execution contract | owner-run backup, R1b/R1c `prove --owner`, D1b.2-style migration pre- and post-checks, D1 deploy order and smoke as owner and partner | authorize; rollback choice; outage window |
| **2A.3b** · priority reads and section | SQL for the §2 reasons with bounded queries and counts; the "Priority · N" section and the `priority` list filter | typecheck, gate:static, gate:db (17.6 scale timing), gate:server; screenshots | Q1 (rank 5 now or later) |
| **2A.3c** · partner landing and nav | `/partner` redirect or summary; a single nav entry; stage summary; `/dashboard` landing-order redirect | page-authorization tests unchanged in meaning; screenshots as partner | Q2 |
| **2A.3d** · notes panel and `notesFor` | read function, prospect notes panel, client "Sales history" panel | reads-only DB tests with RLS (partner and owner); screenshots | Q3 |
| **2A.3e** · promotion from stage | stage-picker path, follow-up closing, stage command use, events | domain tests for convergence and events; screenshots | Q5 |

2A.3a can run in parallel with 2A.3b–c, since they are independent. 2A.3d–e should ship after 2A.3a,
because they only matter once the partner is on the new build.

## 8 · Measurement needed before 2A.3b (read-only, owner-authorized)

One read-only aggregate against production. It returns counts only: no names, ids or contents.
- how many active prospects have a non-null `website_quality`, `decision_maker_access`,
  `project_urgency`, `niche_alignment` and `website`;
- how many are assigned, and to whom (as a count per member).

This decides Q1 and tells website intelligence how large its job is. Until 2A.3a applies 010 there is
no contact or follow-up data in production, so ranks 1–4 start empty after rollout and fill as the
partner works.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q0 | Order: roll out 2A.1c–2A.2e (2A.3a) before new features? | **Yes.** Features the partner cannot use add risk without value |
| Q1 | Ship rank 5 ("Strong fit, untouched") in 2A.3b even if the §8 count is near zero? | Ship it; an empty rank costs nothing and fills itself when website intelligence lands |
| Q2 | `/partner`: redirect to `/sales`, or a short summary page? | Redirect. One place to work |
| Q3 | Show the imported markdown body in the notes panel? | Yes, collapsed and labelled "Imported record" |
| Q4 | Client-side note writing (new store) | Defer; a separate slice with its own schema contract |
| Q5 | Open follow-ups when a prospect is promoted | Close them with reason "promoted to client", recorded as an event |
| Q6 | May the partner promote (currently allowed by capability)? | Keep as is; no capability change in 2A.3 |

Out of scope: mobile responsiveness beyond the Sales surfaces, Ascend Core / command center, general
performance work, and website detection, scoring and ranking for the ~3,000 leads. Each is a later
slice, and §2 is shaped so the last one plugs in without redesign.
