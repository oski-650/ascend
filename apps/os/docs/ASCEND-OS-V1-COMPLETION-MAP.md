# Ascend OS V1 Completion Map

Phase 0 reality audit · 2026-09-16 · proposal, not implementation authorization

## Audit scope and confidence

This map describes the working tree, including unfinished work, not just HEAD. Paths below are relative to `apps/os/` unless explicitly marked repository-root. Evidence was gathered through route, component, canonical reader/writer, schema, test and import inspection. Sales and persistence call paths were traced. Bounded read-only evidence reviews supported Astra's repository-wide assessment; product decisions and the proposed contract remain Astra's responsibility.

**No product changes, migrations, deletions, synchronization, business writes, or Phase 1 implementation were performed.** This document is the audit checkpoint. Existing changes were not staged or committed.

Evidence levels:

- **Confirmed:** executable source or commands executed during this audit.
- **Risk:** a concrete code path with an unmeasured operational consequence.
- **Unverified:** requires authenticated rendering, deployment inspection, representative data, or fault injection.
- **Historical:** documentation/test commentary that must not be substituted for current runtime proof.

The running app at `http://localhost:3001` redirected the audit browser to `/login`. The sign-in surface rendered; protected desktop/mobile surfaces were **not visually verified**. No session was forged, authentication bypassed, or credentials extracted. Mobile findings below distinguish source gaps from visual acceptance work. This is a completed repository audit with explicit runtime limits, not V1 acceptance.

### Baseline and unfinished work to preserve

- One worktree: repository-root `/Users/oscar/Desktop/ascendSite/ascend`.
- Branch `hardening/p0-p1-production`; HEAD `9963b62`; two commits ahead of the locally recorded origin branch. No remote fetch was performed.
- Local commits: `2ce378b` (Sheets intake, prospect note log, website research), `9963b62` (prospect research history).
- Initial status: 30 modified tracked files, 24 untracked status entries (some directories); tracked diff reported 2,261 insertions and 267 deletions. Untracked implementation is additional to that diff.
- Modified areas: home/Galaxy routes, global CSS, client/project/portal/document/prospect/Console links, shell navigation/palette, entity primitives, graph projection/layout/taxonomy, dependency manifests, architecture and graph/UI tests.
- Untracked areas: `app/galaxy/GalaxyClient.tsx`, `/galaxy/next`, Galaxy stage/mount/controls/explorer/boundary/3D renderer, camera/data/lib/scene/shaders, `graph-view/field`, `docs/GALAXY-REBUILD.md`, and new graph/UI tests.
- These are a substantial in-progress Galaxy rebuild, not disposable leftovers. Do not reset, stash, clean, mass-format, or commit them as part of an unrelated slice. Before implementation, snapshot the exact pre-slice diff and checkpoint only the accepted slice.

### Verification performed

| Check | Result | Meaning |
|---|---|---|
| `tsc --noEmit --incremental false` | FAILED, exit 2 | Duplicate declarations in `.next/types/cache-life.d 2.ts` and `.next/types/routes.d 2.ts`; the latter duplicates `LayoutProps`. Generated-tree problem observed; clean build/typecheck remains unproven. Nothing deleted to conceal it. |
| `npm run lint` | Exit 0, 0 errors, 6 warnings | Unused values in search route, automations, Lighthouse helper and domain types; anonymous default export in PostCSS config. |
| Targeted Vitest | 6 files, 86 tests passed | `graph/galaxy-blackhole`, `graph/galaxy-systems`, `graph/galaxy-field`, `ui/galaxy-system-ui`, `engines/pipeline-engine`, `auth/landing`. Pure/fixture/DOM tests, not real WebGL or full workflow proof. |
| Protected rendered app | UNRUN | Sign-in required in audit browser. |
| Full static/server/DB gates, build, production checks | UNRUN | Server gates modify local app/generated state; DB gates can use provisioned databases. Outside this read-only audit. |

Tests may create ordinary local tool caches; no application data or source was intentionally written. Historical passing gate reports do not establish that the dirty tree passes today.

## A. Current architecture map

The repository contains two applications. The root is the Rayo agency website described by root `AGENTS.md`. Ascend OS is the independently configured `apps/os` Next.js application. Root claims such as “all content is JSON,” “no database,” and “no Tailwind” do not describe the existing OS implementation. This is a scope mismatch, not permission to change the marketing site or introduce another styling system.

OS uses Next.js 16.3.0, React 19.2, strict TypeScript, Geist, Tailwind 4 tooling and existing utility classes, `app/globals.css` design tokens, Three/R3F/postprocessing, Zustand, `pg`, Markdown parsing, and Vitest. `package.json` starts development on 3001. No Supabase client integration is needed for the application's SQL access path; hosting/provider posture is not verified by this audit.

```text
Session perimeter (middleware)
  -> request membership resolution -> branded principal / request context
  -> capability-gated routes and canonical DAL

Server pages / API / server actions
  -> core CRM, production, finance, knowledge, events, research, intake
  -> lib domain adapters still in active use
  -> PostgreSQL transactions + RLS OR vault filesystem, by domain ownership

Mission Control -> pure engines -> signals / decisions / explanations
Knowledge gather -> packages/indexer + search + wikilinks
Graph projection -> spatial model -> system map -> client Galaxy renderer
Command discovery -> deterministic matcher -> Console preview/confirm -> core writer
```

`packages/domain` owns types and vocabulary; `packages/{markdown,indexer,search,commands}` contain reusable deterministic computation. `engines/` owns health, decision, opportunity, pipeline, effort, documents, approvals, intelligence, notifications, SOP and site-quality computation. `mission-control/` assembles their inputs and exposes read models. Pages must not invent another scoring/ranking implementation. `relationships/` owns stored structural relationships; `cognition/` contains bounded derived computations, not an AI assistant or the active Core UI.

### System disposition register

Each row includes current state, deficiency, dependency/risk, and V1 action. KEEP means preserve the architecture, not that live acceptance has been completed.

| System / status | Repository evidence and current state | Problem / dependencies / risk | Recommended V1 action |
|---|---|---|---|
| App separation — KEEP | Root app and `apps/os/package.json`, `next.config.ts`, `app/layout.tsx` are distinct. | Wrong-root edits/builds would audit or modify the marketing site. Low implementation risk if scoped. | Keep OS work within its application; clarify documentation scope. |
| Authority — KEEP | `core/auth/{principal,authority,capabilities,routes}.ts`, `lib/{request-context,route-guard}.ts`, SQL RLS. | Security-sensitive; broad partner business access is intentional. | Preserve request authority and capability boundaries; test direct requests, not hidden links. |
| Operational design primitives — KEEP / FINISH | `components/primitives/{index,entity,form,phase}.tsx`; tokens in `globals.css`. | Strong restrained hierarchy exists; legacy forms/editor still differ. Depends on mobile shell. Medium visual regression risk. | Preserve strongest Deep Field work; converge remaining surfaces after shell acceptance. |
| Shell/navigation — FINISH | `layout.tsx`, `NavRail.tsx`, `navigation/destinations.ts`. Desktop rail and mobile drawer already exist. | Drawer lacks focus containment/Escape/restore/modal semantics; persisted desktop collapse also affects mobile labels. Overlay collisions possible. | First implementation slice: reliable mobile shell and coordinated overlays, no authority change. |
| Active Galaxy — KEEP / FINISH | `app/galaxy/page.tsx` -> `GalaxyClient` -> `GalaxyStageMount` -> `GalaxyStage`; `field/systems.ts`. | Strong current direction; unfinished working tree. Actual GPU/mobile/fallback experience unverified. | Preserve composition, prove current renderer, fix bounded interaction/recovery gaps. |
| Ascend Core command center — FINISH | `scene/GalacticCore.tsx` renders shader plane with `raycast={() => null}`; toolbar Core changes camera. | No business state machine or command interaction. Depends on existing command/search and truthful status. | Connect established capabilities after sales coherence; no new intelligence engine. |
| Search/commands — KEEP / FINISH | `core/knowledge`, `packages/search`, `core/command-runtime`, `api/console/search`, Console actions. | Index currently covers clients/prospects/SOPs, not all entities or note-log prose. Search failure can appear as no matches. | Retain deterministic ownership and mutation confirmation; add needed contributors/clear error state in bounded slices. |
| Sales/pipeline — REWORK | `/sales`, `/partner`, `engines/pipeline-engine`, `core/crm/scoring.ts`. Funnel plus score-sorted directory, not a call queue. | Missing contact/stage/follow-up loop. Depends on store-correct mutations. High risk if UI alone is extended. | Finish authoritative sales action model, then action-first prospect and explainable queue. |
| Intake/research — KEEP / FINISH | `core/intake/*`, `core/research/*`, import/from-url/research API and `ProspectResearch`. | Useful imported evidence/research history already present; not yet integrated into prioritization and next action. | Preserve provenance, no invented website score; verify failed/repeated intake/research states. |
| Prospect notes — KEEP / FINISH | `core/crm/notes.ts`, `core/db/prospect-notes.ts`, migration 008, `ProspectNotes`. Attributed append-only DB log. | Vault-only prospects may lack matching DB row; new notes do not follow into client dossier/search/global activity. High continuity risk. | Keep authorship/transaction invariants; define supported source mode and contextual continuity. |
| Client CRM/dossier — KEEP / FINISH | `/crm`, `clients/[slug]/dossier.ts`, client/project/portal pages. Canonical client detail exists. | No client conversation log; recent prospect notes not carried across. Depends on identity/promotion. | Link retained prospect history and define client notes owner; do not create duplicate CRM. |
| Promotion/deletion — REWORK | `core/crm/promote.ts:29-150`, `api/prospects/[slug]/route.ts:10-24`. | Canonical read followed by vault-only mutation conflicts with Postgres authority. Critical business-coherence risk. | Source-correct writes, explicit partial outcomes, retry/recovery tests before sales completion. |
| Production/tasks/time — KEEP / FINISH | `core/production`, `/tasks`, project dossier, `/production/[client]`, `lib/timeLog`, stopwatch. | Production checklist tasks are not a general sales follow-up model. Legacy editor must remain usable; timer stop ignores failed HTTP status. | Keep model; finish handoff and truthful failure UI. Do not silently turn checklist tasks into sales tasks. |
| Finance/documents/portal — KEEP / FINISH | `core/finance`, `lib/{documents,portal}`, corresponding routes/forms. | Existing writes/approval/version/invoice flows need mobile and recovery evidence. | Retain domain owners, exercise complete workflows; converge forms surgically. |
| Signals/automations/maintenance — KEEP / FINISH | `/signals` consumes Mission Control priority/notifications; `/automations`, `/maintenance`. | Valuable operational surfaces; signals are disconnected from sales execution/Core and mixed-store history. | Connect context/action outcomes without adding another engine. |
| DB substrate — KEEP | `core/db/client.ts`, migrations 001–008, scoped transactions, prospect/note event writes. | Deployed ledger/settings/grants not inspected. | Verify deployment separately; keep RLS, migration checksums, transactional writes. |
| Vault/Obsidian — KEEP / FINISH | `core/vault`, client/project/finance/document/portal writers. | Multi-file writes and events are not atomic; tolerant reads can hide failures. | Preserve intentional authority; define observable partial-failure/recovery behavior. |
| Events/reconciliation — REWORK at integration seam | Vault `core/events` and SQL `core/db/events`; vault-only reconciler. | Global history misses SQL events. Event union/order/deduplication not defined. High data-trust risk. | Specify one composed read contract, preserve separate write owners; no mass migration. |
| Backup/recovery — REWORK | `core/db/backup.ts:43-49`, `scripts/backup-production.sh`, restore template. | Logical snapshot omits invitations and note table; pg_dump path exists but successful full recovery not established. | Verify actual backup mechanism, update coverage, restore current schema/data into isolation before new business writes ship. |
| Old renderers/aliases — REMOVE CANDIDATE | `components/graph/*`, old `GalaxyView` family, `/galaxy/next`. | Current route switched; tests/contracts still refer to predecessors; some files dirty. | Prove ownership/reachability and replace relevant tests before deletion. |
| Speculative intelligence — DEFER | Reserved indexer event seam, cognition docs, future Core concepts. | Feature expansion would distract from completion. | Defer AI execution, new engines, audio/haptics and persisted intelligence unless a proven V1 need requires them. |

## B. User-facing product map

All page routes found in `app/**/page.tsx` are represented here. API routes are accounted for by their owning workflows, not treated as independent product pages.

| Route(s) | Actual surface | Status and V1 requirement |
|---|---|---|
| `/`, `/galaxy`, `/galaxy/next` | Same guarded functional 3D Galaxy | FINISH active renderer/Core. `/galaxy/next` is a compatibility/proving alias candidate, not a separate product. |
| `/partner` | Open/closed prospect list and search count | REWORK into coherent sales entry or intentionally consolidate after usage/route review. Currently neither role-specific nor the default sales landing. |
| `/sales` | Pipeline digest, intake controls, score-sorted prospect list | REWORK around priority and next action while retaining stage context. |
| `/sales/import` | Prospect import | KEEP / FINISH narrow-screen, validation, duplicate and error handling review. |
| `/sales/[prospect]` | Score reasons, business intel, website research/history, attributed notes, imported body, promotion/deletion | FINISH contact/outcome/next action/stage and continuity. |
| `/crm` | Canonical client roster | KEEP. `/crm` is not obsolete simply because detail lives under `/clients`. |
| `/clients/[slug]` | Client dossier | FINISH notes/history continuity and action consistency. |
| `/clients/[slug]/project` | Project overview/context | KEEP / FINISH reliable handoff and links into checklist operations. |
| `/clients/[slug]/portal` | Operator-side portal invitations, submissions, approvals | KEEP / FINISH responsive controls and failure states. |
| `/production` | Production portfolio | KEEP / FINISH mobile operational review. |
| `/production/[client]` | Active phase/checklist editor | FINISH legacy UI integration. Do not remove: it provides working mutation controls. |
| `/tasks` | Production checklists and time tracking | KEEP / FINISH, not a sales follow-up store. |
| `/signals` | Ranked decisions, opportunities, notification lifecycle | KEEP / FINISH cross-workflow action continuity. |
| `/automations` | Automation status/firings and dismissal | KEEP / FINISH operational state verification. |
| `/maintenance` | Site audits and maintenance/quality context | KEEP / FINISH audit execution/error/mobile verification. |
| `/documents`, `/documents/[id]` | Filtered registry, detail, versions/actions | KEEP / FINISH narrow-screen content/actions and search consistency. |
| `/console` | Full search, command discovery, read execution, mutation preview/confirmation | KEEP / FINISH; Core should reuse it rather than implement a competing dispatcher. |
| `/finance` | Invoices and financial context | KEEP / FINISH money/date/mobile and mutation reliability checks. |
| `/admin`, `/admin/invitations`, `/admin/wipe` | Owner administration, account invitations, destructive management | KEEP boundary; FINISH usability/test coverage. Wipe must remain deliberate and owner-only. |
| `/login`, `/invite/[token]` | Account access and invitation acceptance | KEEP / FINISH mobile/invalid/expired/inactive states. |
| `/portal/[token]`, `/portal/[token]/approve/[reqId]`, `/portal/[token]/thanks` | Client onboarding/approval flow | KEEP / FINISH separate public-token authority and phone form verification. |
| `/dashboard` | Redirect to `/` | KEEP compatibility, not an abandoned dashboard to rebuild. |
| `/search` | Redirect to Console preserving `q` | KEEP compatibility; do not restore duplicate search. |
| Error/denied/loading boundaries | `app/error`, `global-error`, auth components, Galaxy boundary | FINISH clear failure versus empty states; retain denial semantics. |

The shell lists Galaxy, Partner, Clients, Production, Pipeline, Tasks, Signals, Automations, Maintenance, Documents, Console, Invoices and owner administration. `LANDING_ORDER = ["/", "/partner"]`; since both human roles satisfy home capabilities, **both currently land on Galaxy**. Comments claiming sales necessarily lands on Partner are stale.

## C. Sales flow map

**Current:** sign in → Galaxy (or manually Partner/Pipeline) → score-sorted prospect → read intel/research → manually contact outside the app → append note → no structured follow-up/stage action → promote → vault client → best-effort project → client dossier.

**Required:** authorized sales home → explainable next prospect → contact action → context-preserving outcome note → explicit next action/follow-up → stage progression → won → retained client context → production handoff → coherent owner-visible history.

Confirmed details:

- `app/sales/page.tsx:59-73,168-264` composes `listProspects()` and `assemblePipeline()`. Pipeline is five stage aggregates plus unknown states; it is not a drag board or state-transition writer.
- `core/crm/scoring.ts:18-72`: explicitly weak/no website +30; decision-maker +25; urgency +25; niche +20; tier cutoffs 30/55/80. Unresearched absence earns no points. Retain the breakdown and evidence semantics.
- `core/crm/prospect.ts:86-92` puts lost prospects last and otherwise orders by score. This does not account for due follow-ups or next action.
- `lib/opportunities.ts:190-225` already detects `hot_lead_untouched` and `proposal_cold` using score/status/contact facts. `/sales` does not consume those as a work queue. `/signals` already uses Decision through Mission Control.
- Prospect phone/email are rendered as generic values, without direct `tel:`/`mailto:` controls. The detail page has research, notes and promotion but no ordinary contact-result, stage, or follow-up writer.
- `/tasks` is explicitly production checklist-derived. A sales next action needs a small explicit domain contract; do not repurpose production items by assumption.
- `ProspectNotes` sends only text; server resolves author, appends note and a prose-free event transactionally, then the page refreshes. Preserve that truthful read-after-write pattern.
- Promotion copies only legacy `prospect.body`, not the new attributed log. A client can therefore lose the most recent conversation context in the UI.
- `promoteProspect` returns `prospectMarked`, but the route does **not** return that field. The route returns project warnings; `PromoteButton` consumes only `ok/error` and navigates away. Partial completion is less visible than the core return type suggests.
- The core removed an implicit Growth purchase default, while `PromoteButton` still initializes its explicit package selector to Growth. This is a product/provenance review item: submission must represent a deliberate purchase choice, not accidentally assert revenue.

No new scoring formula is proposed in this audit. Queue design should compose existing explanations and explicit due-state facts, with ranking changes specified separately and tested in their existing owner.

## D. Ascend Core / graph map

The current pipeline is `projectGraph()` → `toSpatialModel()` → `buildSystemMap()` → `GalaxyStage`. Graph reads are authorized before rendering. URL focus is honored only when the authorized projection contains the exact ID. Canonical record routes remain in `navigation/routing`.

The current universe has client suns, project planets, record moons and prospect asteroids. `field/systems.ts` distinguishes stored ownership from presentation placement, including explicit explanations when a client-owned document is displayed beside its only project. Unowned/ambiguous records remain discoverable in the directory rather than acquiring invented ownership. Keep this distinction.

Existing strengths:

- Server-free WebGL mount with loading UI; error boundary; deterministic spatial construction.
- Searchable record directory, inspector, hierarchy, canonical open links and focus permalinks.
- Explicit mobile tier/DPR controls; reduced orbital motion; visibility/intersection-based loop stopping.
- Manual and 60-second visible-tab refresh (`GalaxyClient`); background stars are explicitly non-business scenery.

Gaps:

1. `GalacticCore` receives only `timeScale`; shader time/camera orientation drive appearance. It has no command handler or connection to request/operation state.
2. Core toolbar control selects a camera view. Universal commands and search are still shell/Console concerns.
3. Active `SystemMap` contains records/bodies/source, not the old activity activation stream. Older renderers' event pulses and Neural Core priority panels must not be assumed to survive the route switch.
4. Camera hierarchy is not the requested DORMANT/AWARE/LISTENING/THINKING/ACTING/SUCCESS/WARNING lifecycle. State names remain a design proposal until grounded in actual interactions.
5. Directory/inspector sit inside `SurfaceBoundary` with Canvas. A caught subtree failure replaces the whole business explorer with an error; no proven non-WebGL operational fallback is supplied to Canvas.
6. `initialFocusId` seeds component state. Same-route URL focus changes and navigation-back behavior need an actual mounted/browser test, not just pure ID validation.
7. `FocusProvider`/store commentary claims a central camera state owner, but the active stage and rig also use direct state/commands. Trace actual consumers before keeping or removing transitional state machinery.

V1 Core direction: one restrained entry into existing search/navigation/actions, contextual record actions, truthful pending/result/error states, and a useful list/context experience when graphics cannot run. Motion must derive from those states. No fake “thinking,” ambient event claims, new command parser, execution bypass, or speculative audio/AI work.

**Invariant, recorded when 1B was accepted on 2026-09-18:** the 3D Galaxy is the primary normal
experience. Directory-first is a degradation path, entered only when the renderer capability is
unavailable or has failed. Slices 3A and 3B, and any later Galaxy or Core work, must not invert that
relationship. See `docs/PHASE-1B-CHECKPOINT.md` §7.

## E. Mobile gap map

Source-level findings below are not screenshot-confirmed defects. Each group requires portrait/landscape, keyboard, long-content and touch checks during its slice.

| Workflow/routes | Existing response | Confirmed gap or verification requirement |
|---|---|---|
| Global shell/all operator routes | Rail at `md`; fixed 44px mobile trigger; scroll container; skip link | Mobile drawer has no dialog semantics, Escape handling, focus containment/restoration or background inertness. It shares persisted collapsed state with desktop, so phone labels can disappear. Search does not close the drawer. |
| Operational `PageShell` routes | `pt-14` below `md`, wrapping headers/rows, generous bottom padding | Keep existing clearance. Verify focus visibility, 200% zoom, long names, touch targets and keyboard height. Do not claim navigation is absent. |
| Legacy production detail, wipe/import content | Basic responsive grids/forms; not all use PageShell | Global `.ascend-main` padding alone does not reserve the mobile trigger area. Verify header/control overlap on these paths. |
| Stopwatch | Fixed at top with z-index 60 | Can occupy the same space as navigation trigger/drawer (z-index 50) on phones. Stop action clears UI without checking HTTP success. Layout and persistence-failure correction are separate concerns. |
| Global palette | Width capped, 52vh results, 12vh top margin, keyboard arrows/Escape | No focus trap/return; virtual keyboard and input shrink behavior unproven; API error payload ignored. Coordinate stacked overlays. |
| Galaxy/home/aliases | Compact directory default, bottom-sheet panels, safe-area toolbar, 44px controls, landscape rule | Already real mobile work. Verify small heights, sheet/keyboard collisions, pinch/scroll semantics, Escape layering, fallback directory and reduced motion on actual browser/device. Do not force orbiting to be the only navigation. |
| Sales home/Partner | Wrapping list rows | Large list, no next-action queue, no structured due state. These are workflow gaps, not solved by changing columns. |
| Prospect | Wrapping title/actions and facts, inline note form | Contact values not phone actions; note/research depth; no compact contact→outcome→follow-up loop. Verify draft/error retention and submit accessibility. |
| Client/project/portal admin | Responsive dossier sections and wrapped records | No linked current prospect conversations; verify lengthy activity/approvals and form controls. |
| Production/tasks | Single-column mobile grid and list/time controls | Dense phase/checklist/editor interactions and timer overlay require phone verification; do not remove checklist editor. |
| Documents/detail | Filters wrap; prose and table/code overflow styles exist | Verify long titles, document actions, wide tables and horizontal scroll containment. |
| Console | Search and command argument forms | Top search row uses nonwrapping flex; narrow controls/keyboard and preview confirmation require rendering. |
| Finance/maintenance/signals/automations | Shared lists/wrapping sections | Verify money/date metadata, multi-action rows, clipboard actions, audit/notification errors. |
| Admin/invitations/wipe | Mixed PageShell and legacy content | Verify narrow forms, readable confirmation, owner-only access independent of navigation. |
| Login/invite/public portal/approval/thanks | Separate unauthenticated shell; responsive input/layout classes | Do not add operator navigation; verify keyboard, expired tokens, validation, submission and success states. |
| Redirect routes | Server redirects | Verify destination/query continuity, not independent responsive redesign. |

## F. Data ownership and coherence

| Data | Canonical owner now | Derived consumers / write behavior | V1 concern |
|---|---|---|---|
| Users, organizations, memberships, credentials, account invitations | PostgreSQL, migrations 001, 005–007 | Request principal and access/invitation flows | Preserve live membership resolution, disabled-user handling, tenant scope. |
| Prospect record | `ASCEND_PROSPECT_SOURCE`: unset/vault or Postgres; invalid/unavailable Postgres fails closed | `core/crm/prospect` shared by sales, pipeline, discovery/graph | Inspect deployed mode separately. Never fall back silently or write the other source. |
| Imported prospect prose | Vault markdown body or DB `prospects.notes` through canonical reader | Detail body and promotion's carried-over overview | Distinct from attributed log; do not fabricate author/time. |
| Attributed notes | SQL `prospect_notes`, migration 008 | `core/crm/notes` resolves slug or row ID; note+event in same transaction | Vault-only unmatched record reads empty notes and cannot append. Establish supported mode explicitly. |
| Clients and project/production checklist state | Vault files | Client context/meta and `production_state.md`; read models for tasks/health/graph | Multi-file client creation is not transactional; 1 client/project model must be preserved unless evidence demands change. |
| Finance/time, documents, portal, audits, SOPs, automations | Vault/domain files and sidecars | Existing domain writers + vault events | Preserve domain-specific invariants; exercise partial write/event failures. |
| DB mutation history | SQL events ordered by sequence | Intake, assessment/research, note transactions and DB readers | Not automatically visible to vault activity consumers. |
| Vault mutation/observation history | `.ascend-os` JSONL, `core/events` | Client/production/finance/etc activity and graph; explicit reconciler | Append and business write are separate operations. |
| Search/knowledge | In-memory rebuilt index | Authorized clients/prospects/SOP discovery; no persistence; reserved event input unused | No direct note-log contributor; repeated full discovery; not a universal index yet. |
| Graph / spatial / systems | Per-request derived projection + client presentation state | Canonical reads, stored relationships, display-only orbits | No second write authority; placement is not ownership. |
| Scores/health/opportunities/decisions | Pure/domain computation through existing owners | Mission Control composition | Preserve explanations and null/unknown states; don't infer facts from absence. |

Important distinctions:

- Obsidian is an external editor of authoritative vault files, not a continuously synchronized second database. `app/sync-vault.ts` explicitly calls the reconciler; ordinary page reads do not authorize synchronization writes.
- Reconciliation observes vault state and emits baselines/transitions into vault history. It does not unify SQL events or guarantee recovery of every failed multi-file write.
- Postgres prospect promotion and DELETE are confirmed mismatches: both still target vault paths. They must be corrected before the won flow is accepted.
- `core/db/backup.ts` dynamically captures columns of five listed tables, so newer user credential columns may be included; **invitations and prospect_notes tables are not**. Do not mistakenly claim all credential data is omitted. Recovery tests need current credential/invitation/note fixtures.
- SQL event reader limits before capability filtering (`core/db/events.ts:131-142`), whereas vault reader filters before limit (`core/events/index.ts:183-191`). Current broad role parity reduces immediate impact; preserve consistent visibility/window semantics before introducing narrower roles.
- Notes are append-only for application DB roles. Source comments about provider/default role grants are not a fresh deployment audit; stronger guarantees require verification of actual grants/policies, not assumptions.

## G. Authorization map

`middleware.ts` authenticates signed sessions and defaults protected. Public exceptions are login/logout, account invitation acceptance, and token-authenticated client portal routes. Operator portal token issuance remains protected.

The authority chain is signed user identity → current DB membership → branded principal → request-local context → canonical capability guard → transaction-local SQL role/org/user settings + forced RLS. Layout/navigation visibility is presentation, never the access boundary. Protected readers resolve their own authority; caller-provided visibility is forbidden for production search assembly.

| Principal | Actual boundary | Preserve |
|---|---|---|
| Owner | All explicitly listed business capabilities plus `admin:*` | Administration/invitation issuance/wipe are explicit, not incidental UI checks. |
| Sales | Owner business capabilities except `admin:*` | Clients, finance, documents, time, portal operations, promotion, import, research and prospect deletion are currently permitted. Do not narrow or widen silently. |
| Inactive/invalid/ambiguous membership | Resolution refuses; next request rechecks current membership | No cached role in client/localStorage; ambiguity must not choose an organization arbitrarily. |
| Client portal user | Bearer invite token, own portal/approval context | Separate from operator shell and membership model. |
| Automation/auth/invitation DB roles | Purpose-specific infrastructure SQL grants | Not new human product roles or alternate UI authority. |

`assigned_to` is not a security boundary. Partner simplification should be information hierarchy and workflow emphasis, not a weakened guard or an invented assignment-based permission model. Both roles may see the same business records within their organization.

Tests cover DAL/route/page demands, direct denial, principal isolation and role differences. Unmapped event prefixes currently have an explicit allow-default deferral; revisit before narrower roles, not via an unreviewed security change in a UI slice. Tenant RLS does not imply all vault domains are multi-tenant; the deployed single-business vault binding remains an architectural boundary.

## H. Cleanup candidate register — no deletion approved

| Candidate | Evidence | Proof required / risk / action |
|---|---|---|
| `components/graph/{NeuralCore,GraphCanvas,ContextPanel,simulation}` | Active home no longer imports NeuralCore; internal imports and tests/docs remain. | Trace all imports/fixtures; preserve useful behavior/tests in active renderer; then retire as one slice. |
| `GalaxyView`, `GalaxyCanvas`, `GalaxyScene3D`, `SceneList`, old scene/traversal/activity code | Active route now reaches GalaxyStage; extensive old tests and dirty edits remain. | Import/route/build inventory and ownership checkpoint first. Never delete unfinished user work by static appearance. |
| `/galaxy/next` | Alias of guarded Galaxy; navigation explicitly recognizes it. | Bookmark/test/deployment usage before redirect/removal. Cheap compatibility may be worth retaining. |
| `packages/graph` | Appears used by tests/contracts rather than current production path. | Architectural ownership decision and consumer proof; “unused today” does not invalidate frozen contracts. |
| `framer-motion` | Declared dependency; no production source import found. | Verify dynamic/build consumers and lockfile impact; remove only in dependency cleanup slice. |
| `lib/sales.ts`, `lib/score.ts` shims | Re-export canonical owners; sales/partner still import them. | Migrate active callers deliberately if beneficial; not dead now. |
| Legacy CSS token aliases | `globals.css:76-103` explicitly supports older components. | Count actual consumers and migrate retained surfaces first. Do not delete based on stale comment counts. |
| Logical snapshot backup | A pg_dump script also exists; snapshot incomplete. | Establish actual operational recovery path; repair or formally retire only after current-schema restore proof. |
| `.next` duplicate generated files | Actual typecheck conflict; ignored/generated. | Separate environment cleanup checkpoint with stopped/isolated dev process; no source-test weakening. |
| Local ignored `.backups` | Recovery artifacts, not tracked product code. | Retention/restore/security ownership decision; never treat backups as slop. |
| Unused imports/helpers | Six lint warnings, including `pctScore`. | Low-risk cleanup once owning slice is accepted; avoid drive-by churn now. |
| Old proposals/reports/comments | Specific contradictions below. | Mark historical or update current-state docs; retain audit/provenance history. |

No blanket mock-data purge is justified. Decorative generated stars are not fake business records. Onboarding placeholders are prompts, not evidence that production rows are mocked. Template kickoff text created by promotion is intentional unfinished client context and should remain visibly incomplete rather than masquerade as known facts.

### Documentation disagreement register

- Root `AGENTS.md` describes the agency website, not the current OS subtree.
- `docs/UI-REDESIGN-PROPOSAL.md` claims no mobile navigation and a duplicate client command matcher; current drawer and server-backed palette contradict both.
- `docs/GRAPH-CONTRACT.md` and `cognition/README.md` still identify NeuralCore as home renderer; current home uses GalaxyStage.
- `app/partner/page.tsx`, navigation/search comments describe the older restricted sales role; current capability table grants full business access and home landing.
- `core/db/index.ts` describes an unwired substrate/vault-only authority; current SQL prospects, credentials, invitations and notes contradict that.
- Both event modules describe themselves as the sole event append path; that is true only within each store.
- Command runtime header says read-only while registration includes finance mutation definitions with preview/confirm.
- Knowledge module header mentions reading events, but actual assembly passes an empty reserved events input.
- `vitest.config.mts` says DOM tests/happy-dom do not exist; current package and UI tests use them.
- `scripts/RESTORE.template.md` describes migration 004/empty state; migration registry now includes 008. Logical backup's all-business-tables claim is false.
- `GALAXY-REBUILD.md` records earlier rendered checks and multiple preview stages; use it as history, not proof of the exact current tree.

## I. Performance risk register

No bundle, device frame-time, latency, memory or throughput baseline was measured in this audit. Local `.next` disk size is not a browser bundle metric. Lighthouse used for prospect/client website audits is not an Ascend OS performance gate.

| Evidence-based hotspot | Measurement required | Preserve / recommended action |
|---|---|---|
| `projectGraph():197-251` gathers many domains, then one `getClient` per client | Server duration, read/query counts, representative corpus growth | Keep canonical readers; profile duplicate request work before caching or changing composition. |
| Knowledge rebuild per search; sequential client/SOP reads | Cold/warm query latency, typing request count, file I/O, SQL result size | Preserve principal scope and freshness; request-local reuse only if measurements justify it. |
| `GalaxyClient` refreshes every visible minute | Server load, transfer bytes, refresh cost, selected-state continuity | Keep visible-tab guard; justify interval/partial refresh with measured need. |
| WebGL continuous visible loop, star fields, shaders and postprocessing | Frame-time percentiles, GPU memory, thermal/battery behavior on representative phones | Retain existing DPR/tier/visibility controls; tune measured bottleneck, not aesthetic guesswork. |
| Large `SystemMap`, client directory filtering and record lookup | Serialized payload, hydration cost, interaction delay as prospect count rises | Directory displays 40 initially but searches the complete in-memory set. Source comment records a historical 3,102-prospect import, not a verified live count. |
| Sales/Partner render all list entries; dossier/signals read fan-out | HTML/RSC size, time to useful interaction, server fan-out | Add pagination/limits only with usable queue semantics and evidence. |
| Legacy renderer/dependency paths | Production chunk graph and route imports | Unreachable files do not automatically enter the bundle; prove inclusion before claiming bundle savings. |
| Event folding/JSONL scans and filesystem tolerance | Log growth, parsing duration, malformed/permission failure visibility | Preserve deterministic ordering and replay; optimize only after correctness and recovery tests. |

## J. Test and reliability gap map

There are 108 `*.test.ts` files at the audit snapshot. Strong coverage exists for engines, graph math, architectural fitness, principal/DAL/route/page authorization, DB tenant isolation, migrations, prospect-source parity, intake/research, and append-only attributed notes.

`package.json` defines `gate:static`, `gate:server`, `gate:db`, and their sequential aggregate. **A successful aggregate exit is not sufficient release evidence:** several server/DB proofs are environment-gated and skip or merely warn when flags/URLs are missing. Release acceptance must record executed suites, skipped suites and the expected proof matrix.

Priority gaps:

1. No full browser partner → queue → contact → note → follow-up → stage → won → client → production → owner history test.
2. No observed promotion/delete test for Postgres-selected prospect authority; no cross-store partial-failure/retry proof.
3. Recovery fixtures do not establish restoration of current notes/invitations/credential lifecycle. Logical restore coverage is stale.
4. No unified SQL/vault activity ordering/deduplication test or notes-to-client continuity test.
5. No automated real-browser viewport/touch/focus/virtual-keyboard, screenshot regression, WebGL context-loss or accessibility suite found. Happy-dom is not a GPU/rendering substitute.
6. Legacy Galaxy tests can pass while the new production stage lacks equivalent lifecycle proof. Active-path coverage must be explicit.
7. Search masks failures as empty data; palette ignores returned `error`; timer stop clears display without checking response success. Add failure assertions in owning slices.
8. No application bundle/performance budget or CI release workflow found; timing-sensitive engine branches also have explicitly deferred tests.

Every future slice must declare applicable checks. UI-only work still needs authority/navigation regression gates; persistence work needs isolated DB/vault fixtures plus fault/retry assertions. Do not run provisioning/destructive gates against production simply because environment variables are available.

## K. V1 execution roadmap

Each row is a future independent contract/checkpoint. Astra designs and reviews; Sol implements only the accepted contract; targeted tests, applicable gates and rendered review follow; accept or bounded correction; checkpoint; stop. No row is authorized by this audit to start automatically.

The overall phase order remains. **One dependency adjustment:** move the minimal source-correct mutation and recovery work from later integration/reliability phases ahead of Phase 2 sales mutation delivery. Evidence: current Postgres prospect promotion/delete mismatch and incomplete logical backup. Responsive read-only UI work can proceed first; new business writes must not build on those gaps.

| Slice | Bounded outcome | Depends on | Acceptance emphasis |
|---|---|---|---|
| 1A Mobile shell and overlay foundation | Navigation labels, focus, dismissal, layering, viewport containment | Preserved baseline; authenticated isolated review environment | Phone/keyboard/desktop behavior; direct authorization unchanged. First proposed contract below. |
| 1B Active Galaxy phone access and failure recovery | Usable directory/context when graphics fail; coherent short-screen panels | 1A | Active renderer browser/GPU/fallback and reduced-motion verification; preserve existing artwork. |
| 1C Operational responsive consistency | Remaining legacy editor/forms, long content and touch controls | 1A | Route matrix above; preserve existing writes. Split only if actual diff exceeds one reviewable UI slice. |
| Dependency R1 Current recovery proof | Select/repair actual backup path; restore current tables/schema in isolation | Deployment-mode facts, safe fixtures | Notes/invites/credentials/events sequence/rows survive; current runbook. |
| Dependency D1 Prospect source-correct mutations | Promotion/deletion honor selected owner; truthful partial outcomes and retry contract | R1; explicit source configuration | Vault/Postgres cases, retained notes, no silent closed-won disagreement; no destructive migration. |
| 2A Sales action persistence | Bounded contact outcome, stage and next-action/follow-up ownership | D1 | Capabilities, validation, idempotency/concurrency, author/time/event and due-state semantics. |
| 2B Prospect phone work loop | Contact → note/outcome → next action with minimal friction | 1A/1C, 2A | Phone call links, draft/error handling, refresh persistence, no duplicate notes. |
| 2C Explainable priority sales home | Queue answers who next/why; pipeline context and next-target progression | 2A/2B, existing score/opportunity owners | Explanation fidelity, unknown-state handling, due/stale facts, usable large list; no hidden new weights. |
| 2D Won/client/production continuity | Conversation context survives; repairable production handoff | D1, 2B | Real end-to-end partner/owner workflow and partial-failure UI. |
| 3A Core entry and command interaction | Core opens one accessible search/context/action experience | 1B, stable command/search seam | Keyboard/touch/non-graph equivalent; existing preview/POST confirmation and canonical routing. |
| 3B Core meaningful state and motion | Explicit idle/input/pending/result/warning lifecycle from actual operations | 3A | No fake state; reduced motion and operation failures; no unnecessary effects. |
| 4A Cross-store activity composition | Define/read coherent SQL+vault history with attribution | D1, 2A | Tenant/capability scope, identity, ordering, deduplication, retries; preserve write owners. |
| 4B Notes/context/search integration | Useful prospect/client notes discoverable in allowed context | 2D, 4A | Auth before discovery, prose visibility, retained author/time; no invented ownership. |
| 4C Vault/application reconciliation reliability | Clear external-edit/failure/refresh behavior | 4A | Fault injection and explicit recovery for retained file workflows; no read-triggered writes. |
| 5A Retired renderer/product surface retirement | Remove proven obsolete implementations and migrate relevant tests/docs | Active renderer accepted, 3A/3B | Reachability/build/route compatibility proof; preserve unfinished work before deletion. |
| 5B Dependency/style/utility cleanup | Remove proven dead deps/aliases/shims and update current docs | 1C, 5A | Minimal diffs, caller inventory, static/build parity, no broad refactor. |
| 6A Measured app/graph performance | Capture baseline then fix dominant measured costs | Stable workflows, 5A/5B | Representative mobile/desktop/corpus, explicit before/after budgets and regression checks. |
| 6B Reliability and release gate execution | Remaining timer/search/errors/recovery faults; assert required proofs ran | R1, 4C | Failure/retry tests, no false green from skipped required suites, current build/typecheck. |
| 7A V1 business acceptance | Full role/device/workflow matrix in isolated representative environment | All required slices | Partner and owner flows, persistence/events/vault, documents/portal/time/finance, performance evidence. |
| 7B Final polish and release checkpoint | Bounded corrections only; verified completion ledger | 7A | No abandoned major surface; final clean slice diff, known limitations and rollback evidence. |

Deferred: new engines, speculative AI/autonomous execution, audio/haptics, new collaboration roles, multi-organization UX, generalized task management, wholesale database migration, universal persisted graph/index rebuild, redesign of the root agency site. Revisit only after V1 or when a measured dependency requires an explicit scope decision.

## First proposed implementation contract — 1A

**Status: proposed only. DO NOT IMPLEMENT in Phase 0.**

### OBJECTIVE

Complete the existing responsive application shell and its navigation/search overlay behavior. Correct phone navigation labeling, keyboard/focus behavior and overlay overlap without changing route destinations, authority, domain models, graph artwork or business actions.

### USER OUTCOME

On a phone, users can open readable navigation, move to a page or search, dismiss the overlay and continue exactly where they were. Navigation, search and an active timer do not obstruct one another. Desktop keeps its current compact/expanded rail behavior.

### CURRENT STATE

`layout.tsx` renders a fixed-height flex shell only for signed-in operators. `NavRail` has a `md` desktop rail and fixed mobile trigger; both reuse one nav fragment and localStorage collapse state. Mobile drawer closes on a link/backdrop but lacks modal semantics, Escape/focus handling and background inertness. Search dispatch leaves the drawer open. `CommandPalette` has dialog semantics and initial focus, but lacks containment/return and visible error distinction. `StopwatchWidget` occupies the top phone region above the drawer's stacking level. `PageShell` already reserves mobile top clearance; legacy non-PageShell content does not uniformly do so.

### DESIGN

- Retain existing navigation labels, groups, order, active-route matching, accent and typographic language.
- Mobile drawer always shows text labels and hides desktop collapse control. Desktop collapsed preference remains unchanged and persists as today.
- Trigger exposes expanded state and associated drawer. Open drawer focuses its close control; Tab/Shift+Tab remain within it. Escape/backdrop/close dismiss; focus returns to trigger unless a destination navigation moves focus to content.
- Background content and the timer are noninteractive while the mobile drawer is modal. Drawer must scroll independently on short screens. A labeled close button is always available.
- Choosing Search closes the drawer and opens the existing palette with input focused. Closing palette returns focus to the logical launcher; after drawer-to-search handoff that is the mobile navigation trigger. Do not stack two competing modal surfaces.
- Palette remains global and uses the existing search API and command handoff. Add proper focus containment/restoration and ensure all controls fit the available viewport. Search error semantics may be recorded for 6B if fixing them would broaden this contract beyond shell behavior; never label this slice universal search completion.
- Reserve a mobile navigation area consistently for legacy content while preserving existing PageShell spacing and Galaxy safe-area rules. Avoid doubled padding.
- Place an active timer in a stable non-overlapping phone region; modal overlays take precedence. Preserve timer start/stop logic in this slice; record its failed-stop behavior for the reliability slice.
- No new menus, dashboard cards, colors, animated effects or route reorganization.

### RESPONSIVE BEHAVIOR

- Below 768px: labeled drawer, 44px minimum primary touch targets, safe-area-aware positioning, viewport-height containment and scrollable content. Opening the software keyboard must leave search input/results/dismissal reachable.
- At and above 768px: preserve current rail width/collapse behavior; global palette remains operable by keyboard.
- At 320/375/390/430px portrait, 667×375 landscape, 768px tablet and 1280px desktop: no shell-caused horizontal overflow, trapped hidden focus, obscured navigation or unreachable close control.
- Public login/invitation/client portal shell remains separate; no operator navigation is introduced there.

### ARCHITECTURE

Use the existing client shell boundaries and `ascend:open-palette` handoff. Prefer a small shared overlay/focus helper only if both components require the same behavior; do not introduce a general UI framework. Presentation may receive existing server-resolved navigation data; it must not gain role/capability decisions. Keep styling in the OS's existing stylesheet/component system, scoped to shell behavior. No new dependency is expected.

### INVARIANTS

- Canonical route table and landing order unchanged.
- Authorization remains in middleware/request/DAL/SQL; hidden navigation confers no security.
- Same business content and commands for each currently authorized principal.
- Command discovery never mutates; Console preview/explicit confirmation path preserved.
- Public portal isolation, skip link, existing desktop collapse preference and page scrolling retained.
- No unrelated dirty Galaxy/source/dependency/test changes overwritten or included in this checkpoint.

### LIKELY FILES / SYSTEMS

`components/shell/NavRail.tsx`, `CommandPalette.tsx`, `app/layout.tsx`, scoped portions of `app/globals.css`, `components/StopwatchWidget.tsx` (layout only), and focused shell interaction tests. `components/primitives/entity.tsx` only if needed to avoid duplicate mobile spacing. Navigation and authorization files should require no behavior changes.

### NON-GOALS

Sales redesign, new follow-up persistence, Core command-center implementation, shader/graph rework, authentication changes, role narrowing, database/vault edits, dead-code removal, dependency upgrades, timer mutation semantics and full search contributor/error redesign.

### ACCEPTANCE CRITERIA

1. A desktop-collapsed preference never produces an unlabeled mobile drawer.
2. Open/close/Escape/backdrop/route selection/search handoff have deterministic focus behavior; background controls cannot receive focus or input while modal.
3. Search opens once with the drawer closed; closing returns focus correctly; keyboard selection still opens canonical results/Console.
4. Active timer, navigation trigger and drawer/palette controls remain reachable without overlap at listed viewports.
5. Existing PageShell, legacy production editor, Galaxy and public portal each preserve their intended containment and scrolling.
6. Owner/sales visible links and direct page/API denials are unchanged.
7. Actual rendered desktop/mobile inspection passes; DOM-only tests cannot satisfy this criterion.
8. Slice-only diff is reviewed, applicable gates pass, preexisting failures are documented and resolved separately rather than hidden.

### TEST PLAN

- Capture baseline screenshots in a legitimate authenticated isolated/test environment before editing. Include one owner and one sales account without changing their permissions.
- Mount shell tests for collapse→mobile, focus containment/restore, Escape, route close and search handoff. Test long navigation and short height.
- Render actual `/`, `/sales`, a prospect, `/production/[client]`, `/console`, owner administration and public login/portal across listed viewports. Use read-only interactions; simulate active timer in isolated fixture state.
- Check keyboard-only navigation, 200% zoom, reduced motion, touch-sized controls and virtual-keyboard behavior on a real/mobile-capable browser.
- Run targeted UI/auth/landing/navigation-contract tests and `gate:static`; lint and clean-environment typecheck/build. For declared server/DB regression gates use isolated provisioned fixtures and assert required suites actually ran.
- The current generated-type collision must be resolved in an isolated baseline/checkpoint, not by weakening TypeScript includes or tests as part of this UI patch.

### ROLLBACK / RISK

Main risks: focus restoration across Next navigation; escape conflicts with Galaxy hierarchy; shared scroll/inert behavior; double mobile padding; timer overlap on short screens; accidental capture of dirty files. Keep one overlay owner at a time, retain existing navigation contract, and checkpoint only slice changes. Roll back the slice patch without restoring whole shared files over preexisting work. No data migration or irreversible action is involved.

## Owner input and evidence still needed

No owner answer is needed to understand the source findings above. Before a slice's rendered acceptance, provide a legitimate authenticated review session or isolated test accounts/environment; the audit browser currently has none. This is an access prerequisite, not permission to bypass authentication.

Before D1, inspect deployment configuration/ledger through an authorized read-only path. Only if that does not settle the operational policy is an owner decision required: must vault-only prospect operation remain supported, or is Postgres the sole supported production prospect mode? Code supports both on reads and inconsistently on writes; documentation alone cannot choose the supported business operating mode.

Confirm the actual backup/recovery mechanism in use before relying on or retiring the logical helper. No destructive restore against live data is authorized. No broad role or visual redesign questions are necessary now: preserve the current trusted-partner authority and strongest existing design.

**Phase 0 stops here. The first recommended next instruction is to design/execute slice 1A against this contract after establishing rendered-review access. No implementation has begun.**
