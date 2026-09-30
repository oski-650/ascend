# Slice 2A.3c — One pipeline · CHECKPOINT

`/partner` redirects to `/sales`, the "Partner" nav destination is gone, the landing fallback
names `/sales`, and `/sales` opens with a count of open prospects per stage. Built to
SLICE-2A3-PREFLIGHT.md §3, §6 and §7. No schema change, migration, index, capability or write path.
Deploys only through a separate rollout task.

## Owner decisions (OWNER-Q2)

Recorded in chat on 2026-09-30, before the build:

- **Q2a: yes.** "Redirect `/partner` to `/sales` and remove the redundant Partner nav entry."
- **Q2b: no landing change.** "Keep Galaxy as the default landing page. Don't make Sales the default
  landing." Both roles still land on `/` (Galaxy primacy, owner-recorded at 1B).

## What was built

| Area | Change |
|---|---|
| `app/partner/page.tsx` | Retired to `redirect("/sales")`, the `/search` precedent. `?scope=mine` or `?scope=team` is forwarded; any other value, and every other parameter, is dropped. It reaches no reader. |
| `tests/architecture/page-authorization.ts` | `"partner"` moves from `["prospects:read", "search"]` to `[]`, beside `dashboard` and `search`, with the reason recorded where the entry was. |
| `navigation/destinations.ts` | The Partner destination is removed. `LANDING_ORDER` goes from `["/", "/partner"]` to `["/", "/sales"]`. |
| `components/shell/NavRail.tsx` | The `/partner` icon mapping is removed. |
| `lib/landing.ts` | Header comment only; the seam is unchanged. |
| `core/db/sales-reads.ts` | `countOpenByStage`: one `GROUP BY` over `prospects` with the list's own `scopeWhere` (anchored, unarchived, open pipeline, same assignee scope). It returns `lead`, `contacted` and `proposal`, plus `unstaged` for open rows with no stage recorded. |
| `core/crm/sales.ts` | `salesWorkQueue` adds `stages` inside the existing `prospects:read` lease, with the same scope as the sections. There is no second authorization. |
| `app/sales/page.tsx` | "Open pipeline by stage" appears between the scope bar and the section nav. Each stage links to `/sales/list?scope=…&stage=…`. "No stage recorded N" is plain text and appears only when N > 0, since no list filter selects it. |

## Design choices for review

1. **Redirect, not permanentRedirect.** This follows `app/search/page.tsx` exactly, which returns
   307. A 308 would be cached by browsers indefinitely, which makes a rollback of this slice
   harder. The route is permanent in the sense that it stays retired.
2. **The fallback names the page, not the redirect.** A landing candidate that declares `[]`
   would be "reachable" by every principal. The seam would then pick it for anyone, and the
   redirect, not the list, would decide the boundary. A new landing test holds every candidate to a
   non-empty contract.
3. **Unstaged prospects are shown, not dropped.** `prospects.status` is nullable. Silently leaving
   those rows out would make the stage counts disagree with the open pipeline's total. They get an
   unlinked count because `/sales/list` has no "no stage" filter, and adding one is outside this
   slice.
4. **The F57 control probe moved from `/partner` to `/console`.** `nav-boundary`'s control needs a
   visible destination that renders under the stub authority. `/partner` was that page, and
   `/console` reaches the same guarded knowledge index through `search`. `/sales` needs a database
   lease that suite does not have (measured: it threw).

## Evidence

- **Stage summary** (`tests/db/sales-reads.test.ts`, PGlite 001–010), 3 new tests (36 total):
  - As owner and as partner, in both Mine and Team, each stage count equals the number of rows
    reached by following the stage link's own URL. That URL goes through `browseHref`,
    `parseBrowseValues`, `browseFilter` and the Mine expansion, across all pages.
  - `unstaged` equals the open list's rows with no stage. The parts sum to the open pipeline.
  - The partner's Mine counts do not move when another member gains a prospect; Team does. Mine
    rows are the partner's own or unassigned.
  - Closed, held and archived prospects are never counted. Every stage key is present.
- **Redirect** (`tests/db/page-matrix-provisioned.test.ts`, real provisioned partner):
  - `partner` joins Fact C. It redirects identically under both roles, and its target's row agrees
    with `DENIES_SALES`.
  - New: the target is `/sales` for both roles, and `/sales` renders for both.
  - Only a valid scope is forwarded. Six cases include an array value and extra parameters.
  - An anonymous request ends at `/sales`, which refuses it.
- **Nav and landing:**
  - `nav-visibility` (new): neither rail offers `/partner`, and both keep `/sales`.
  - `landing` (new): `LANDING_ORDER` is `["/", "/sales"]`, and owner and partner both land on `/`.
    A second new test checks that no landing candidate is a redirect or demands nothing.
  - `page-denial`: `partner` leaves the reachable set because it is `[]`-declared.
  - `nav-boundary`: F57 totality follows the destinations, and the control uses `/console`.
  - `f51-page-demand` measures `partner` as `[]`, equal to its new contract. `f56-nav-contract`
    passes unchanged.
- **Mutants.** Each one turned tests red and was restored byte-for-byte:

  | Mutant | Tests red |
  |---|---|
  | Forward any scope | 1 |
  | Stage count ignores the assignee scope | 2 |
  | Unstaged rows counted as lead | 1 |
  | Mine drops unassigned rows | 1 |
  | `LANDING_ORDER` back to `/partner` | 4 |
  | A `/partner` destination restored | 1 |
  | A redirect-shaped page placed first in `LANDING_ORDER` | 5 |
- **Rendered proof** (fixture PostgreSQL 17.6 on a Unix socket, `next dev` with every production
  variable unset, headless Chrome, owner AND partner, 390×844, 640×900, 667×375, 768×1024,
  1024×800, 1440×900; `/sales` and `/sales?scope=team`, 24 pages; 3,307 prospects including 7
  unstaged):
  - **Redirect:** `/partner` answers 307 to `/sales` for both roles. `?scope=team` and
    `?scope=mine` are forwarded; `?scope=bogus&assignee=x` goes to `/sales`. Anonymous requests
    get 307 to `/login?next=%2Fpartner` (the proxy).
  - **Nav:** no `/partner` link on any page. The desktop rail and the opened mobile rail
    (390/640/667) offer Pipeline and not Partner, and Galaxy stays first under Command.
  - **Layout:** no horizontal overflow on any page or in the stage nav. Every stage link is 44 px
    tall.
  - **Counts:** partner Mine shows Lead 1320 · Contacted 880 · Proposal 440 · No stage recorded 7;
    Team shows 1650 · 1100 · 550 · 7 for both roles.
  - **Links:** each stage link opens the list with that stage selected and the same scope.
  - **Keyboard:** at 390 and 1440, for both roles, focus reaches the three stage links in order
    with a visible indicator.
  - **Fix found during the proof:** the first run showed the link text as "Lead1650", which a
    screen reader would announce as one word. A space now separates label and count.
  - Screenshots were inspected; they are kept outside the repository.
- **Pre-existing, not introduced here:**
  - Two 24×24 checkboxes in the Add-target form.
  - A `/favicon.ico` 404 on the dev server.

## Rollout note (ROLLOUT-NOTE)

`scripts/deploy-smoke.mjs` A6 walks `["/", "/galaxy", "/sales", "/partner", …]` and expects `/partner`
to load; after this slice it answers 307. The smoke is rollout tooling and is not changed here. The
next rollout's preparation must:

- update A6 (`/partner` → a redirect to `/sales`);
- add checks for 2A.3b (Priority section first, reasons shown);
- add checks for 2A.3c (stage summary present, links scoped).

## Scope

Fourteen files plus this checkpoint, all within the task's write paths. Before drafting, every file
referencing `/partner`, `"partner"` as a page key, or `LANDING_ORDER` was enumerated:

- `nav-boundary`, `nav-visibility`, `page-denial`, `landing`, `f51-page-demand`, `f56-nav-contract`
  and `page-matrix-provisioned`;
- `page-authorization`, `destinations`, `NavRail` and `landing.ts`;
- `deploy-smoke.mjs`, which is not changed.

`f51-page-demand`, `f56-nav-contract` and `gate-2g1.ts` needed no edit, since no test file was added.
The full db phase was run before freezing. The fixture probe route, seed script, dev-server output
and cluster were removed, and `tsconfig.json` is unchanged. No production contact by the builder.
