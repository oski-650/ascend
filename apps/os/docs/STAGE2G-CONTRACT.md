# Stage 2G — Authorization for the rendered surface, the invite lifecycle, and the partner UI

**Status: CONTRACT ONLY.** No code, no migrations, no database writes, no partner credential.
**Date:** 2026-08-29 · **Base:** `618510b` (2F closed: 52/52 files, 1077 passed, 55 skipped, fitness 178)

This document is the thing to argue with. Nothing in it has been built.

---

## 1. What 2F actually secured, stated precisely

2F made **`app/api/**` safe**. Twenty-seven routes, one capability each, totality enforced by F49,
denial demonstrated against a populated vault, and the whole boundary mutation-tested.

It did **not** touch the rendered surface. `middleware.ts` authenticates a page request and stops
there — it runs in the Edge runtime, has no database, and cannot resolve a role. So today:

> **Any authenticated user can render any page.** There is no authorization on the rendered surface
> at all.

That is currently harmless for exactly one reason: **there is no second user.** `users = 1`. The
moment 2G.2 issues a credential, it stops being harmless, and it stops being harmless *before* any
partner UI is written.

**2G.1 must therefore close before 2G.2, not merely before 2G.3.** The ordering in the approved
sequence is right; the reason is stronger than "before the partner has screens".

---

## 2. Measured current state

Read from the repository today, not recalled.

| | |
|---|---|
| Next.js | **16.3.0** (`CLAUDE.md` says 16.1.1 — stale, fix in passing) |
| page files | 28 (`page.tsx` + `layout.tsx`); 26 server, 2 client |
| server pages reading authorization-relevant data | **14** |
| `UNSCOPED_INTERNAL_INDEX` production call sites | **2** — `app/console/page.tsx:105`, `graph-view/projection.ts:223` (reached from `app/page.tsx`) |
| `React.cache` call sites today | **0** |
| `experimental.authInterrupts` | **not enabled** (`next.config.ts` sets only `turbopack.root`) |
| knowledge-index entity kinds | `client`, `prospect`, `sop` |

### The 14 pages, and what they read

| page | reads | owner-only? |
|---|---|:---:|
| `finance` | `listInvoices`, `listClients` | ✅ |
| `documents`, `documents/[id]` | `listDocuments`, `listClients` | ✅ |
| `crm` | `listClients` | ✅ |
| `maintenance` | `listAudits` | ✅ |
| `production` | `assembleHealthOverview` | ✅ |
| `clients/[slug]/portal` | `listApprovalRequests` | ✅ |
| `signals` | `compileOperatorBrief`, `detectOpportunities` | ✅ |
| `console` | `buildKnowledgeIndex` | ⚠️ scoped |
| `search` | knowledge search | ⚠️ scoped |
| `page.tsx` (graph) | `projectGraph` → `buildKnowledgeIndex` | ⚠️ scoped |
| `sales`, `sales/[prospect]` | `listProspects`, `getProspect` | sales ✅ |
| `portal/[token]` | `listClients` | portal token |

**The §21 gap was named too narrowly.** It said "the knowledge index is unscoped". The measured
truth is that **eleven owner-only pages have no authorization of any kind**, and the unscoped index
is one instance of that, not the whole of it. 2G.1's scope is the rendered surface, with the index
as its hardest sub-problem.

---

## 3. THE DECISION THIS CONTRACT EXISTS TO FORCE

> **`AsyncLocalStorage` won 7.2/7.3 for route handlers. That is not an argument that it is the right
> primitive for Server Components.**

### Request context is not React render context

A route handler is a function the framework calls with the request. Wrapping it in
`AsyncLocalStorage.run()` puts the entire handler — and everything it awaits — inside one async
execution tree. That is why 7.3's proof worked.

A Server Component is **not** called by its parent. React renders children itself, outside the
parent's call stack. A `run()` in a layout therefore does **not** wrap the pages beneath it. Any
design that assumes otherwise is assuming a propagation that the render model does not provide.

This was written as a HYPOTHESIS and has since been **MEASURED — confirmed** (§9, spike 1: a
layout's store read `null` in the child page, while a store entered inside the page read correctly).
The project's own rule is why it was measured rather than asserted: *a diagnostic that does not
exercise the failing path is not evidence about the failing path.* Encoding an untested belief into
architecture is how the `ping6` mistake happened.

### The invariant, which does not depend on the mechanism

> **A Server Component obtains the database-derived `ResolvedPrincipal` for THIS request, and cannot
> fabricate one.**

Everything below is a means to that. The brand already makes fabrication a compile error; what 2G.1
chooses is how the resolved principal *arrives*.

### Option A — per-fetch boundary at the Data Access Layer

Each data function resolves the principal itself before returning anything. Pages call data
functions; the check lives with the data.

- **For:** the check is adjacent to the data, so a new page cannot forget it — it gets the check by
  calling the function. Matches 2F's shape exactly (`authorize` wraps the handler; the DAL wraps the
  read). Survives a future page, a Server Action, or a background caller.
- **Against:** touches every data function, and re-resolves per call unless memoized.
- **Blast radius:** 14 pages call ~12 distinct data functions.

### Option B — `React.cache()` + `cookies()`

A memoized `requirePagePrincipal()` reads the session cookie, resolves the principal once per render
pass, and returns the same value to every component that asks.

- **For:** this is **what Next 16.3's own authentication guide prescribes**
  (`node_modules/next/dist/docs/01-app/02-guides/authentication.md` §"Creating a Data Access Layer"):
  a `verifySession()` memoized with React `cache`, invoked from data requests, Server Actions and
  Route Handlers. `cookies()` is a documented request-time API. `cache` scopes to a render pass, so
  two concurrent requests cannot share a value — the isolation is React's, not ours.
- **Against:** `cache` is a React memoization primitive, not a security primitive; its guarantee is
  "same value within a render pass", and 2G.1 must *prove* that pass is per-request rather than
  assume it. Also opts routes into dynamic rendering (already true — every page is
  `force-dynamic`).
- **Blast radius:** one new module; call sites added wherever authority is needed.

### These are not exclusive, and the likely answer is both

Next's guide does exactly this: `cache`-memoized `verifySession()` **inside** the DAL functions. B is
the *mechanism*; A is the *placement*. The decision to make explicitly is whether the check is
placed at the data function (A) or at the page (which this contract rejects — see §4).

**DECIDED — see §9a.** The spikes removed the choice rather than informed it: ALS cannot carry
identity between components at all, and `React.cache` demonstrably can.

### Rejected in advance

- **Layout-level checks.** Next's own guide warns against them, and the render model is the reason:
  a layout does not wrap its children's execution. A check there protects the layout, not the page.
- **Middleware as the authorization layer.** Edge, no database, and it would mean trusting something
  the request carried. Same reasoning as §7 of the 2F contract.
- **Any module-level principal.** F50 already forbids it and must not be weakened.
- **A default or owner fallback when context is unavailable.** Fail closed, as everywhere else.

---

## 4. Scoping happens at ASSEMBLY. Render-time filtering is prohibited.

The index must never **contain** entities the principal may not know about. Not "must not display" —
must not contain.

Render-time filtering would pass the same tests today and fail the first time anything else reads
the index: an error message, a debug log, a scoring pass that echoes a title, a `JSON.stringify` in
a diagnostic, or a future consumer nobody has written yet. 2F already built the correct shape —
`buildKnowledgeIndex(visibility)` with a **required** argument, excluded kinds never discovered —
and 2G extends it to the rendered callers rather than inventing a second mechanism.

**Contract:** `buildKnowledgeIndex` keeps its required-argument signature. `UNSCOPED_INTERNAL_INDEX`
is **deleted** at the end of 2G.1, not merely unused — a constant that grants everything is a
loaded gun left on the table. Its two production call sites take a real visibility.

---

## 5. Scoped index contract

- `visibilityFor(principal)` remains the single mapping from capabilities to entity kinds.
- `sales` receives `prospect` only. `owner` retains today's visibility exactly — 2G must not
  silently narrow what the owner sees.
- **Cross-organization entities never enter the index.** Today this is trivially true (the vault is
  single-tenant and prospects come through RLS), and it must be *asserted* rather than inherited, so
  that a future multi-tenant vault cannot quietly break it.
- Every consumer of the index — search route, console page, search page, graph projection — is
  enumerated in a map with the same totality property F49 gives routes: **a consumer with no entry
  fails the suite.**

---

## 6. Invite / password-set lifecycle (2G.2)

Built on `tests/db/production-2f-partner.test.ts`, which already provisions and self-verifies. What
2G.2 adds is that **the owner never learns the partner's password**.

- Owner creates an invitation → single-use token, hashed at rest (the token is a credential; the
  table stores its digest, never the token).
- Explicit **expiry**, and explicit **consumption** — a used token is dead even before expiry.
- **Replay is refused**, and refused identically to an expired or unknown token: one response, one
  status, comparable timing. Same posture as `/api/auth/login` in 2F.
- The partner sets their own password; `hashPassword` already enforces the minimum length.
- **No credential material in URLs beyond the single-use token itself**, none in logs, none in the
  repository, none in chat. The token appears in a URL by necessity — therefore it is single-use,
  short-lived, and hashed at rest.
- Membership supplies authority. The invitation grants **no** role by itself; accepting it does not
  create a membership the owner did not already write.
- New migration required (`006_invitations.sql`), which means: direct endpoint reachable per §17,
  fresh verified backup **before** it runs, ledger row, and the same gate discipline as 004/005.

---

## 7. Partner UI (2G.3) — a consumer of the boundary, never the enforcer

Only after 2G.1 is closed and 2G.2 is proven. Login · sales dashboard · prospect search · prospect
detail · permitted prospect operations · honest empty and error states.

**No client, finance, document, time, audit, admin or portal-admin surface.**

The UI reflects authorization. It does not implement it. The test that keeps this true:

> Every denial demonstrated through the UI must ALSO be demonstrated by a direct request to the
> corresponding API route with the same session. If hiding a button is the only thing stopping the
> action, it is not stopped.

---

## 8. The partner security matrix (2G.4)

Every row an executable test that demonstrates the outcome, not that a check exists.

| # | property |
|---|---|
| 1 | owner vs sales across all 27 routes — the 2F matrix, re-run with a REAL provisioned partner rather than a stubbed membership |
| 2 | owner vs sales across all 26 pages — the matrix 2F never had |
| 3 | knowledge index: no client/sop entity in a sales index, asserted on the index CONTENTS |
| 4 | search: shared-term fixture, prospect present, client absent, 200 not 403 |
| 5 | cross-organization isolation — RLS returns zero rows |
| 6 | revocation mid-session takes effect on the next request, page and route alike |
| 7 | `disabled_at` denies a valid unexpired session |
| 8 | invitation: expiry, single use, replay, unknown token — all refused identically |
| 9 | password establishment: minimum length, hash stored, plaintext never persisted or logged |
| 10 | concurrency: interleaved owner/sales PAGE renders keep separate authority — 7.3's proof, re-run against whatever mechanism §3 chooses |
| 11 | credential columns unreadable by `ascend_sales` on the live server |

Row 10 is the one that carries the most risk, because the mechanism will be new.

---

## 9. Required spikes — MEASURED 2026-08-29. Results below.

Run against a real `next dev` render of THIS app (Next 16.3.0, Turbopack), started with the database
environment removed — the server logged `ASCEND_DATABASE_URL is not set`, so nothing touched
production. All spike files deleted afterwards; tree clean.

### Spike 1 — does a layout's `AsyncLocalStorage.run()` reach a child page's render?

A layout entered a store and returned `store.run(ctx, () => <div>{children}</div>)`. A nested async
Server Component read it.

    spike1_alsFromLayout : null            ← NO. The hypothesis in §3 is CONFIRMED.
    spike1_alsSetInPage  : "set-by-page"   ← ALS entered INSIDE a component works, nested async included

**Finding.** React renders children outside the parent's call stack, so a layout's scope does not
wrap the pages beneath it. `AsyncLocalStorage` remains correct for propagating context *within* one
component's own async work — which is exactly how route handlers use it — and **cannot carry
identity from one Server Component to another.** Any design that put the context in a layout would
have silently produced `null` at every child, which fails closed but also fails entirely.

This is why the contract refused to prescribe ALS by analogy with 7.2/7.3.

### Spike 2 — is `React.cache` isolated per request under genuine concurrency?

Two requests with different `spike_user` cookies, held at a **barrier inside the memoized function**
so neither could complete until both had entered — the 7.3 technique, so overlap is a precondition
of the result rather than an assumption about it.

    ALPHA  who=alpha  id=vrsukm  overlapped=true   (identical id from both calls in the render)
    BRAVO  who=bravo  id=5ymxb7  overlapped=true   (distinct from alpha's)

**Finding.** `overlapped=true` on both sides proves the renders were simultaneous. Each request saw
only its own cookie, and the two memoized values were distinct. **Zero crossover, memoized within a
pass, isolated across passes.** `React.cache` satisfies the requirement.

### Spike 3 — what happens without `experimental.authInterrupts`?

    HTTP 500
    ⨯ Error: `unauthorized()` is experimental and only allowed to be used when
      `experimental.authInterrupts` is enabled.

**Finding.** `unauthorized()` and `forbidden()` are unavailable, and fail as a 500 rather than
degrading. Two options: enable the experimental flag, or use stable APIs.

**Decision: do NOT enable `authInterrupts`.** It is an experimental flag on the authorization path,
and 2F's whole posture is that this path does not rest on anything provisional.

And the case is narrower than it first appears: `middleware.ts` already redirects an unauthenticated
PAGE request to `/login`, so the 401 case is handled before a page renders. What 2G.1 actually needs
is the **403** case — authenticated, wrong role — which has never existed on this surface. That
renders an explicit denial component. Never an empty page, never a silent fallback.

---

## 9a. THE MECHANISM DECISION, now evidence-based

> **Option B is the mechanism. Option A is the placement. Both, and the spikes are why.**

- ALS **cannot** be the carrier between Server Components (spike 1). That removes A-carried-by-ALS.
- `React.cache` **is** per-request and demonstrably isolated under overlap (spike 2). That makes it a
  sound carrier — not because Next's guide says so, but because it was measured here.
- The check still belongs at the **data-access boundary**, not the page: a new page can forget a
  check; a data function cannot be called without one.

So the target shape, which is the owner's stated constraint and Next 16.3's documented DAL pattern
arriving at the same place:

```
request/session → cache()-memoized principal resolution → authorized DAL
    → scoped assembly/query → UI
```

not

```
request → page remembers to check → page calls unrestricted DAL
```

A sensitive data function resolves the principal itself, via the memoized resolver, and refuses
without one. Resolution happens **once per render pass** regardless of how many functions ask.

**Still to be proven during implementation, not assumed:** that the memoized resolver refuses when
the cookie is absent, forged, expired, or the membership revoked — the §11 threat rows re-run
against the page path — and that a module-level principal mutation produces observable crossover
(row 10 of §8). Spike 2 proves the primitive isolates; it does not prove our use of it authorizes.

## 10. Mutation tests — the suite must fail under each

The 2F rule stands: *a mutation that survives is evidence the test is insufficient, not evidence that
the implementation is fine.* If a mutation does not cause a failure, **stop** and fix the test.

| mutation | required result |
|---|---|
| `buildKnowledgeIndex` called unscoped from a page | sales sees a client → tests fail |
| a page principal defaulted to `owner` when context is missing | tests fail |
| the capability check removed from a page's data path | tests fail |
| a page's data function called without principal resolution | tests fail |
| an invitation token accepted twice | tests fail |
| an expired invitation accepted | tests fail |
| interleaved owner/sales renders sharing one principal slot | observable crossover → tests fail |

---

## 11. New fitness rules, proposed

- **F51 — every server page that reads authorization-relevant data resolves a principal.** Totality
  over `app/**/page.tsx`, with a named exemption list (`login`, `portal/[token]/*`). A page with no
  entry fails the suite. The page equivalent of F46/F49.
- **F52 — the knowledge index has no unscoped constructor.** `UNSCOPED_INTERNAL_INDEX` no longer
  exists; every `buildKnowledgeIndex` call site passes a principal-derived visibility.
- **F53 — invitation tokens are stored hashed and are single-use.** No migration stores a raw token;
  no code path accepts a consumed one.

F46–F50 are **not** weakened to accommodate any of this.

---

## 12. Explicit non-goals

**No Sheets intake.** Not in 2G, not partially, not "just the parser". It comes after 2G.4 closes.

Also out: no broad redesign of Ascend OS · no new membership roles (`owner`, `sales`, and nothing
else) · no weakening of RLS or of any column grant · no authorization logic in the UI · no migration
of clients, finance, documents or time into Postgres · no email infrastructure · no SSO/MFA · no
self-service signup · no multi-organization membership.

---

## 13. The gate

1. **This contract approved first.** Zero implementation until then.
2. §17 preconditions re-checked — the direct endpoint is IPv6-only and has dropped twice.
3. Baseline recorded from `618510b` before any 2G code.
4. Implementation in increments, each with its own stop: **2G.1 → 2G.2 → 2G.3 → 2G.4**.
5. **Security tests pass before a partner credential is ever issued.** The mechanism was built in 2F
   and deliberately not run; it stays unrun until 2G.1 is closed and 2G.4's page matrix is green.
6. Fresh verified backup before migration 006, per the 2D.2 recovery contract.
7. Closing 2G requires: full suite, fitness, `tsc`, `eslint`, production integrity, no test residue,
   clean tree — and **one commit per increment**, never a known-unverified commit.

### Rules carried forward from 2F, non-negotiable

- Do not weaken a fitness rule to make an implementation pass.
- Do not substitute infrastructure to turn a red gate green.
- Do not commit with a known verification gap.
- Diagnose infrastructure failures and code failures separately.
- Assume every new security test is vacuous until a mutation proves otherwise.

> **The Server Component obtains the database-derived `ResolvedPrincipal` for this request and cannot
> fabricate one. `memberships.role` determines authority. Postgres enforces the boundary.**

---

## 14. 2G.1 BASELINE — captured 2026-08-29, before any 2G code

Recorded so a 2G regression is distinguishable from a pre-existing or environmental failure.
Captured at `618510b`, clean working tree, **no source modified during capture**.

| | |
|---|---|
| HEAD | `618510b` |
| working tree | clean |
| §17 direct endpoint | **3/3**, IPv6, TLS 1.3 |
| full suite | **52/52 files · 1077 passed · 55 skipped · 1132 total** |
| architecture fitness | **178** (F1–F50) |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| `next build --turbopack` | **succeeds** — compiled in 4.8s, 5 static pages generated |

`next build` is in the baseline for the first time. 2G.1 changes the RENDER path, and a change that
type-checks and passes tests can still break a production build — the previous stages only touched
route handlers and could not.

To reproduce the 1077, export:

    ASCEND_TEST_DATABASE_URL=$ASCEND_DATABASE_URL_ADMIN_POOLED
    ASCEND_BACKUP_SQL=~/AscendBackups/20260829T010319Z-pre-step7/ascend-public-...-portable.sql

The 55 skips are the 47 one-shot mutation gates from STAGE2F §18 plus the 8 in the partner
provisioning gate. Every one writes to production. **Do not set them during 2G.1.**

### Production state at baseline — unchanged by the run

    prospects 6 · anchored 4 · held 2 · events 41
    users 1 · memberships 1
    ledger 005_user_credentials.sql
    no leftover test schema

`users = 1` remains the check that no partner credential exists. It must still read 1 when 2G.1
closes; issuing one is 2G.2's act, gated on 2G.1 being green.

### A note on the spikes, since they touched the working directory

The three §9 spikes ran a `next dev` server, which generates route types under `.next/dev/types/`.
After the spike files were deleted those generated types still referenced them, and `tsc` reported
three phantom errors against `.next/dev/types/validator.ts` — **stale build output, not source.**
`rm -rf .next` cleared it and `tsc` was clean before and after a fresh `next build`.

Recorded because it is a trap worth naming: `.next` is gitignored, so `git status` said clean while
`tsc` said broken. A clean tree is not the same as a clean workspace, and only one of those two
signals would have caught it.

### The proof 2G.1 owes, restated

Not "the partner cannot see the page". That is a symptom.

> **A partner cannot cause an unauthorized datum to enter the system's data-access boundary,
> regardless of which page or which future consumer asks for it.**

This is the 2G.1 equivalent of 7.3's mutation proof, and like 7.3 it is only credible once a
deliberate mutation — a module-level principal, or a DAL function that skips resolution — produces
**observable** crossover.

**2G.1 may now begin.** Any deviation from the numbers above is a 2G effect and must be explained,
not absorbed.

---

## 15. 2G.1 SLICE 1 — the resolver, proven. No page wired.

Built on `348d964`. **Nothing consumes this yet**, deliberately: keeping the resolver unwired makes
the next failure legible — *resolver failure ≠ page wiring failure ≠ DAL scoping failure.*

### Delivered

`lib/page-principal.ts` — `pageAuthority()`, memoized by `React.cache`, and `requirePagePrincipal()`
which throws rather than returning without authority. `components/auth/Denied.tsx` — the explicit
403, built and not yet used.

The resolver names its refusals — `unauthenticated` · `no-request` · `unavailable` · and the four
`ResolutionFailure`s. All refuse identically; the distinction is for the log, never the response. An
outage must not read as "everyone suddenly logged out", and a data function reached from outside a
request is a bug, not a visitor.

### Refusal proofs — 22 tests, `tests/auth/page-principal.test.ts`

Absent · malformed · v1 · forged user id · forged expiry · expired · wrong secret · unconfigured
perimeter · revoked membership · no membership · disabled · ambiguous membership · outside a request
· database unregistered · database throwing. Two successes: owner and sales, each resolving the role
**the membership row holds**.

The load-bearing one: *the same token, a different row, a different role.* Nothing in the token
decides anything.

### The isolation proof — `tests/render/page-isolation.test.ts`, gated on `ASCEND_RENDER_TEST=1`

Real `next dev`, real renders, real perimeter, real signed cookies. Three parts, 7.3's structure:

1. **Real overlap.** Two renders held at a barrier inside the page; neither completes until both
   have entered. Overlap is a precondition of passing, not an assertion about it.
2. **Mutation.** The same request path with the memoized resolver replaced by one module-level slot:

   ```
   MUTATION DETECTED — 3 crossings:
     sales render saw role=owner
     sales render saw org=11111111-1111-4111-8111-111111111111
     sales render saw another user
   ```

3. **The real resolver.** Three rounds, **zero crossover**, and the memo stable within each pass
   (the value before the barrier equals the value after).

The mutant is *sequentially correct* — it leaks only under overlap, which is how this class of defect
survives review, and why the barrier had to come first.

Production is never touched: the server starts with the database environment removed and the probe
registers its own two-user stub, because the property needs two roles and production holds one user
until 2G.2.

### Two workspace traps this slice found

**`next dev` rewrites `tsconfig.json`** — measured: it appends `.next/dev/dev/types/**` to `include`.
`next build` does not. Unhandled, every run of the render gate would dirty version control, which is
the property step 7.1 was committed to establish. The gate now snapshots and restores the file and
**asserts** the restoration.

**`next dev` generates route types for the probe pages**, which the probe's deletion leaves dangling
— `tsc` then fails against `.next/dev/types/validator.ts` while `git status` reports clean. Same trap
as §14. The gate now clears `.next/dev` as well.

Both are the same lesson, and it is worth keeping past this stage:

> **The compiler's world is larger than Git's.** A clean tree is not a clean workspace, and only one
> of those two signals will tell you.

### Close-out

| | baseline §14 | now |
|---|---|---|
| test files | 52 | **54** |
| tests | 1077 / 55 skipped | **1100 passed / 58 skipped** |
| fitness | 178 | 178 (F51–F53 not yet due) |
| `tsc` · `eslint` · `next build` | clean · 0 errors · succeeds | unchanged |

+23 = 22 refusal proofs + 1 render-gate guard. The 3 new skips are the render gate itself, which
runs only under `ASCEND_RENDER_TEST=1` and warns loudly when it does not.

Production untouched: 6 prospects · 41 events · **users 1** · ledger 005.

---

## 16. 2G.1 SLICE 2 — the DAL boundary. Decisions settled before implementation.

Baseline re-measured at `2cf16cf`, not carried over: 54 files · 1100 passed · 58 skipped ·
fitness 178 · tsc clean · 0 lint errors · §17 3/3.

### The invariant this slice exists to satisfy

> A page does not become secure because the page remembered to authorize. It becomes secure because
> the data it can request has an authorization boundary.

And the rule that decides WHERE that boundary goes:

> **Never add authorization merely because a module is sensitive. Add it where authority controls
> whether protected data may be obtained.**
>
> Sensitivity describes the data. Authority governs access to the data. Put the boundary where the
> data is obtained.

`lib/forecast` handles the most sensitive numbers in the system and is exactly where a check would be
wrong: it can obtain nothing. Conflating the two is how a codebase ends up with checks everywhere and
a boundary nowhere.

### The inventory — the DAL is NOT uniform

Measured across every server page. Three classes, and only the first is guarded.

**1 · Storage boundaries — authority is enforced here, one capability per boundary.**

| module | functions | capability |
|---|---|---|
| `core/finance` | `listCareClients`, `listInvoices`, `createInvoice`, `markPaid`, `markUnpaid`, `getClientRevenue` | `finance:*` |
| `core/crm/client.ts` | `listClients` and the client writers | `clients:*` |
| `lib/documents` | `listDocuments`, `createDocument`, `updateStatus`, `createNewVersion` | `documents:*` |
| `lib/audits` | `listAudits`, `appendAudit` | `audits:*` |
| `core/production` — time | `getAllEntries`, `getActiveEntry`, `startEntry`, `logEntry`, `stopEntry`, `stopActive`, `summarizeByClient`, `summaryFor` | `time:*` |
| `core/production` — projects | `listProductionStates`, `getProductionState` | **`production:read`** |
| `core/production` — projects | `createProject`, `toggleChecklistItem` | `production:toggle` |
| `lib/portal` — operator half | `listInvites`, `createInvite`, `revokeInvite`, `listApprovalRequests`, `createApprovalRequest`, `listSubmissions` | `portal:admin` |
| `lib/automations` | `loadRules`, `getFiredEntries`, `detectFirings` / `dismissFiring` | `pipeline:read` / `pipeline:write` |

**2 · Pure derivation — MUST NOT be guarded.** `lib/forecast` (zero imports), `lib/opportunities`
(engine only), every `compile*`, and the format helpers (`statusOf`, `statusLabel`,
`formatDuration`, `parseProductionMarkdown`, `renderTemplate`, `isValidPhaseKey`). F2 forbids I/O and
identity here, and keeping these modules auth-unaware is the reason ALS was chosen back in 7.2. They
receive data from an already-authorized caller.

**3 · Client-token paths — MUST NOT be guarded.** `findInviteByToken`, `getApprovalRequest`,
`signApproval`, `createSubmission`, `saveUploadedFile`. `lib/portal` is **split**: `app/portal/[token]`
is client-facing with no operator session, and those pages are public in `middleware.ts`. A
module-level check would break the client portal, and break it *silently*.

### Two decisions, settled 2026-08-29

**`production:read` — ADD IT, owner-only.** Project state is protected data. `production:toggle`
remains the mutation capability, and a read must not inherit authorization from a write capability.
Same failure shape as the DELETE route in 2F §7.4: access arriving from adjacency rather than from a
decision.

**`app/automations` — SALES-PERMITTED** on `pipeline:read` / `pipeline:write`, matching the
`/api/automations/dismiss` row where sales is ✅.

### The page count is an OUTPUT, not a contract

An earlier note said "11 owner-only pages". That number came from a narrow grep; it missed pages and
classified `automations` wrongly in the permissive direction. **It is not load-bearing and must not
be carried into implementation.**

F51 derives the rendered-surface set from the filesystem and fails on any page with no entry — the
same mechanism F49 gives routes, where totality is a set comparison rather than a maintained list. A
rule that produces the count cannot drift the way a remembered one does.

### The ~43 test call sites are evidence, not maintenance

Four test files call these functions directly. Each one that now has to arrive as an authenticated
caller is a demonstration that the boundary is on the path. **A call site that does NOT need updating
is the interesting signal** — it means the function believed to be guarded is not actually reached.

### Completion standard, unchanged from 7.3

> If the mutation cannot make the test fail, the test has not proven the property.

Genuine overlap → a broken module-level authority leaks observably → the real implementation produces
zero crossover.

---

## 17. SLICE 2A — the boundary primitive. **SLICE 2 IS NOT COMPLETE.**

A verified implementation waypoint, committed so a real finding is not lost. It is **not** a
slice-completion commit, and nothing here should be read as the rendered surface being secured.

### Guarded — 2 of 8 storage boundaries

| module | capability | functions |
|---|---|---|
| `lib/documents` | `documents:*` | `listDocuments`, `getDocument`, `findSuccessors`, `createDocument`, `updateStatus`, `createNewVersion` |
| `lib/audits` | `audits:*` | `listAudits`, `appendAudit`, `latestAudit`, `historyFor` |

### NOT guarded — 6 of 8 remain

`core/finance` (`finance:*`) · `core/crm/client.ts` (`clients:*`) · `core/production` time
(`time:*`) · `core/production` projects (`production:read` / `production:toggle`) · `lib/portal`
**operator half only** (`portal:admin`) · `lib/automations` (`pipeline:read` / `pipeline:write`).

`lib/portal` needs care: it is split, and guarding the client-token half would break
`app/portal/[token]` silently, because those pages are public in `middleware.ts`.

### Also NOT done

No page wiring · no `UNSCOPED_INTERNAL_INDEX` deletion · **no mutation proof** · no F51–F53 · no 2G
gate. The completion standard is unchanged and unmet: *if the mutation cannot make the test fail,
the test has not proven the property.*

### What IS established

`core/auth/authority.ts` — `requireCapability(capability)`, returning the principal so a data
function scopes its query from the same call that authorized it.

**Placement was forced by measurement**, not preference: `core/` imports neither `next/*` nor
`@/lib/*`, and reading a cookie means `next/headers` while verifying a session means `lib/auth`.
So `core` holds the QUESTION and the runtime registers HOW TO ANSWER IT — the same seam
`core/auth/connection` already uses. The slot holds a **function, never an identity**, which is
precisely the line F50 draws: a module-level principal is one slot every request inherits; a
module-level resolver is a question asked afresh each time.

**One boundary, two carriers.** `lib/authority.ts` checks the ALS request context first (route
handlers, proven under overlap in 7.3), then falls back to the `React.cache` memo (Server
Components, proven under overlap in slice 1). A data function behaves identically however it was
reached.

### THE FINDING WORTH PRESERVING

Guarding two modules broke **four parity tests on the graph projection**. `projectGraph()` obtains
documents, audits and invoices — a consumer that appears on no page inventory, reached through
`graph-view` rather than through any page.

> The boundary caught a consumer nobody had enumerated. A page-level guard could not have: there is
> no page to guard, and the data still arrives.

That is the whole argument for the DAL placement, demonstrated rather than asserted, and it is why
this waypoint is worth a commit.

Thirteen engine tests also began failing with `NoAuthority: no-resolver`. Seven test files now
declare their caller — each one evidence the boundary is on the path, not maintenance.

### State

54 files · 1100 passed · 58 skipped · fitness 178 · tsc clean · 0 lint errors. Identical to the
slice-2 baseline: this waypoint adds a boundary and the callers to satisfy it, and changes no
behaviour anyone can observe.

Production untouched: 6 prospects · 41 events · users 1 · ledger 005.

---

## 18. SLICE 2B — all eight boundaries guarded. **SLICE 2 IS STILL NOT COMPLETE.**

A verified waypoint. The rendered surface is **not** secured, and the boundary is **not** proven
under concurrency.

### Guarded — 8 of 8, across 12 files

`core/finance` → `finance:*` · `core/crm/client.ts` → `clients:*` · `lib/documents` →
`documents:*` · `lib/audits` → `audits:*` · `core/production` time → `time:*` · `core/production`
projects → `production:read` / `production:toggle` · `lib/automations` → `pipeline:read` /
`pipeline:write` · `lib/portal` **operator half only** → `portal:admin`.

**Class 2 remains auth-unaware** — `lib/forecast`, `lib/opportunities`, every `compile*`, and the
pure helpers on guarded modules (`statusLabel`, `formatDuration`). Asserted, not assumed.

**Class 3 remains auth-unaware** — `findInviteByToken`, `getApprovalRequest`, `signApproval`,
`saveUploadedFile`, `createSubmission`. Also asserted.

### THE FINDING: a guarded function was an internal dependency of an unguarded one

`findInviteByToken` — the client-token entry point — internally called `listInvites()`, which slice
2b had just guarded with `portal:admin`. **Every client portal visitor would have been refused access
to their own portal**, silently: `app/portal/[token]` is public in `middleware.ts`, so nothing else
covered it. `tests/auth/dal-boundary` caught it.

Fixed by extracting a private, unguarded `readInvites()`. The rule, now recorded in the code:

> A guarded function must not be an internal dependency of an unguarded one. **Extract the read;
> authorize the entry.**

A systematic scan across all twelve guarded files found **no other instance**.

### A vacuity corrected

The first version of the "correct authority" block used `await expect(...).resolves.not.toThrow` — a
**property access, not an assertion**. It asserted nothing, leaked 15 unhandled rejections, and
appeared green. Rewritten as an explicit try/catch asserting the error is not an authorization
error, **with a control test that proves the helper can detect a refusal.** Without the control the
rewrite would have been the same trap in better clothes.

### The proofs, and why they call the DAL directly

`tests/auth/dal-boundary.test.ts` — 30 tests. They do not go through a page or a route, because a
future consumer would not either. Per boundary: no authority → `NoAuthority`; sales → `CapabilityDenied`
on owner-only data; owner → not refused.

Refusal is an exception, never an empty result. A function returning `[]` to an unauthorized caller
would be indistinguishable from an empty vault, which is the authorization-by-absence F49 forbids.

### NOT DONE

- **THE MUTATION PROOF HAS NOT RUN.** The eight-boundary state is the prerequisite it must be run
  against, which is why it comes after this commit and not before.
- Page authorization wiring — not started.
- `UNSCOPED_INTERNAL_INDEX` — still present, still used by `app/console` and `graph-view/projection`.
- F51–F53 — not written.
- The 2G.1 gate — not passed.

The completion standard is unchanged and unmet:

> The mutation must genuinely fail with observable crossover when authority is made module-global,
> and the real request-scoped implementation must then show zero crossover. A green test that cannot
> detect the defect does not count.

### State

55 files · 1130 passed · 58 skipped · tsc clean · 0 lint errors. +30 over slice 2a, all of them the
new boundary proofs. Production untouched: 6 prospects · 41 events · users 1 · ledger 005.
