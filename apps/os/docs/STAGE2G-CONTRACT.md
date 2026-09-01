# Stage 2G — Authorization for the rendered surface, the invite lifecycle, and the partner UI

**Status: 2G.1 · 2G.2 · 2G.3 CLOSED; §28.13 closed at `8a511c5`. NO PARTNER CREDENTIAL EXISTS.**
Code and both migrations are committed. `006` IS applied to production (`a6f4068`); **`007` is NOT**
— see §28.15, which supersedes this header wherever they disagree. No partner has been onboarded;
production still holds `users = 1`.

> **CORRECTED 2026-08-31.** This line read "CONTRACT ONLY. No code, no migrations, no database
> writes, no partner credential." Two of those four were false and two were true, which is exactly
> why the line was dangerous: a reader trusting it would have concluded that production carried no
> invitation schema, when `006` has been applied to it since `a6f4068`. The surviving true halves —
> no partner credential, `007` unapplied — are the ones that matter most, so they are stated first.
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

> **THE DISPOSITIONS AND THE CORRECTIONS ARE IN §29 — READ IT BEFORE ACTING ON THIS SECTION.** The
> eleven rows below are the requirement AS AUTHORED, unedited since this contract opened, and two of
> their facts have since been measured false: "all 27 routes" and "all 26 pages" — the repository now
> has 29 of each. §29 does not correct the rows in place; it corrects the counts BY REMOVING THE
> LITERAL NUMBERS, because totality here is set-equality against the filesystem and a count frozen in
> prose is exactly the kind of fact that rots — this is its second rotting. The row-by-row
> disposition, its evidence class, and the five rulings that resolve this section all live in §29,
> not here.

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

---

## 19. SLICE 2C — THE MUTATION GATE: **PASS**. Slice 2 is still not complete.

```
Overlap:
  2/2 concurrent requests proven
  distinct principals (owner@orgA, sales@orgB)
  barrier negative control

Mutant:
  module-level ResolvedPrincipal
  observable cross-role/cross-tenant crossover
  mutant fails

Real implementation:
  5 overlapping rounds
  zero crossover
```

### What was mutated, and why only this

Not `requireCapability` returning the wrong verdict — that proves a test notices a broken `if`. The
mutation is architectural, and for this boundary it is a change in what the module-level slot HOLDS:

```
real     let resolver: () => Promise<Answer>     a QUESTION, asked afresh on every call
mutant   let answer:   ResolvedPrincipal         an ANSWER, written once and reused
```

Capability table, request contexts, guarded finance module and barrier all unchanged, so the
mechanism is the only variable between the mutant round and the clean round. Same defect shape as
the `registerProspectDb` slot removed in 7.2: one value shared by every caller, where a leak is a
race rather than something visible in a diff.

Observed:

```
MUTATION DETECTED — 3 crossings:
  owner request saw role=sales
  owner request saw another tenant's organization
  owner request was denied its own finance access
```

**The leak direction is a race.** Here sales wrote the slot first, so the owner inherited sales'
identity. The reverse race shows sales obtaining finance data. The assertion accepts either but
requires cross-tenant **or** cross-role-data specifically, so it cannot pass on a mislabelled field
alone — and the report text varies between runs by design.

### Three harness defects found and corrected — not worked around

These are recorded because each would have produced a convincing but meaningless isolation result,
and that is a worse outcome than a red test.

1. **Module-instance mismatch.** `vi.resetModules()` meant a statically imported binder registered
   into a stale module instance, so every call failed `no-resolver` — correct behaviour, wrong cause.
2. **The same defect one level down, and this one was dangerous.** `runInRequestContext` came from
   the static graph while the resolver read a fresh one. `AsyncLocalStorage` identity is **per module
   instance**: writing to one and reading from another silently yields "no context". That fails
   closed, so the suite could have stayed green while proving nothing about isolation. Fixed by
   threading the context module through the same graph.
3. **Denial conflated with I/O failure.** No vault is mounted, so an authorized `listInvoices()`
   throws for a missing-vault reason; the first version scored that as a denial and reported the
   OWNER as crossed over. Now distinguished by error type — which is precisely the conflation the
   whole boundary exists to prevent, reproduced inside the test that tests for it.

> A harness defect that fails closed is more dangerous than one that fails loudly: it manufactures
> the result you were hoping for.

### NOT DONE

Page authorization · `UNSCOPED_INTERNAL_INDEX` removal · scoped assembly · F51–F53 · the final 2G.1
gate. None of it has been started, and none of it belongs in front of this gate.

### State

56 files · 1134 passed · 58 skipped · tsc clean · 0 lint errors. Production untouched: 6 prospects ·
41 events · users 1 · ledger 005.

---

## 20. SLICE 2D — the public portal narrowed to token-scoped data. Slice 2 still not complete.

The corrected page inventory found a real defect, not an instrument artifact: `app/portal/[token]`,
a **public** client-facing page, called `listClients()` to turn its invite's slug into a display
name. Once slice 2b correctly guarded `listClients()` with `clients:*`, every real portal visitor
would have been refused access to their own portal — the same class as `findInviteByToken`
internally calling the guarded `listInvites()`, one level out.

### Ruling D — the operator snapshots the name at issuance

Rejected: granting the portal `clients:*` · a branded claim (moves the forgery rather than
preventing it) · a `portal:self` authority kind (a new authorization model for a presentation
lookup) · weakening `listClients()`.

```
createInvite (portal:admin + clients:*)  →  invite { client_slug, client_name }
                                                        ↓
                        portal/[token] → findInviteByToken → its own record → UI
```

**The authority to snapshot the client name is the authority to read the client.** `createInvite`
resolves the name through `listClients()`, so it now demands `clients:*` as well — which stops the
snapshot mechanism from becoming an authorization bypass for an operator who may issue invites but
may not read clients.

### The property is structural, not checked

> The token selects ONE record. There is no parameter through which another client could be named,
> so there is no query to widen.

That is what satisfies the invariant — *a client-token caller cannot cause another client's data to
enter its data-access boundary* — rather than merely satisfying the inventory.

### Snapshot semantics, accepted deliberately

An invite is an **issued artifact**, and the record now carries provenance: issued for client X,
whose display name was Y at issuance. A later rename does not retroactively alter an artifact
somebody was already handed. `client_name` is OPTIONAL; invites issued before it fall back to
`client_slug`, which is what the page always displayed when no name was available, and that path is
tested.

**No migration.** Invites live in `.ascend-os/portal_invites.jsonl` in the vault, not Postgres, so
migration 006 and the ledger/backup gate are not involved.

### Proofs — `tests/auth/portal-token-boundary.test.ts`

valid token → only its client, with NO authority bound · token A ↛ client B · no operator session
required · absent/unknown/revoked token refused · `listClients()` still refuses both an unbound
caller and sales · legacy invite falls back to the slug. Issuing side: `createInvite` records the
name · sales is denied · an unidentified caller is denied.

### Inventory after the fix

```
portal/[token]                  clients:*  ->  []      defect closed
portal/[token]/approve/[reqId]  []                     unchanged
portal/[token]/thanks           []                     unchanged
pages 26 · demanding 11 (was 12) · [] 15 (was 14)
```

### STILL OUTSTANDING

Declared 26-page map · runtime demand instrumentation · F51 · page denial handling ·
`UNSCOPED_INTERNAL_INDEX` removal and scoped assembly · F52–F53 · the final 2G.1 gate.

57 files · 1143 passed · 58 skipped · tsc clean · 0 lint errors. Production untouched.

---

## 21. F51 — the rendered-surface contract. Slice 2 still not complete.

Baseline `07c9333` (see §22 for why the baseline moved). 58 files · 1174 passed · 58 skipped ·
fitness 178 · F51 31/31 · mutation gate 4/4 · render isolation 4/4 · tsc clean · 0 lint errors ·
`next build` succeeds.

### Two-dimensional drift detection

```
filesystem pages  ⟷ exact set equality ⟷  declared map
declared map      ⟷ exact set equality ⟷  runtime demand
```

A new page fails even if nobody updates the map. A new guarded data dependency fails even if
somebody remembered the page but not its capabilities. Neither dimension covers for the other, and
`[]` is a declared, tested value — `portal/[token]` declaring nothing is F51 actively protecting the
fact that the public token surface acquires no operator capability.

### Why runtime, after two static instruments were measured and rejected

**Import analysis** under-reported `app/finance` (it imports the `lib/finance` re-export shim) and
over-reported `app/portal/[token]` as `portal:admin` for merely importing `lib/portal`. **A
call-name scan** then missed transitive fan-out entirely. Both failed in the direction that writes
a wrong contract.

### FIVE harness defects, four fixed and one ruled out

Every one produced misleading evidence; none was ever a page defect.

1. **Production fixture shape** — `production_state.md`, not `production.md`. Empty array ⇒ the map
   body in `tasks` never ran ⇒ `finance:*` invisible.
2. **Document fixture shape** — `walkDocs()` iterates THREE levels; a file one level short is never
   yielded, so `getDocument` returned null and the page stopped at `notFound()`.
3. **Module-instance mismatch** — `vi.resetModules()` left a statically imported binder writing to a
   stale instance.
4. **Async render attribution leakage** — a single module-level Set, cleared per page, collected
   spillover from unawaited `Promise.all` work. `admin` — a page importing only `Link` and three
   presentational primitives — reported SIX capabilities it had inherited from `/`. Fixed with
   AsyncLocalStorage render identity, so attribution follows causality rather than the clock, and
   proven by a control that reproduces the exact old failure shape.
5. **Import-time contamination** — hypothesised, then RULED OUT by splitting import-time from
   render-time demand. The split stays in the harness regardless: it closes a class of
   contamination that isolation testing cannot detect.

> A harness defect that fails closed is more dangerous than one that fails loudly: it manufactures
> the result you were hoping for.

### The tracing that ended the investigation

Three structurally different pages reported a byte-identical seven-capability set. Isolation runs
confirmed the demand was real and not cross-page. A render-time stack trace found the cause:

```
ProjectPage → getClientDossier (app/clients/[slug]/dossier.ts:83) → listApprovalRequests → portal:admin
```

A **colocated route module**, imported by relative path — invisible to every static pass, all of
which matched only `@/`-aliased specifiers.

**Consequence worth knowing before 2G.3:** `clients/[slug]` and `clients/[slug]/project` are
owner-only in practice. A sales principal cannot render the client dossier at all.

### The declarations were written from measurement, never inference

`signals` was assigned all seven from a DEDUPLICATED diff list and turned out to demand two. The
map is a hypothesis; the render is the measurement.

> The render measures the contract; the contract does not dictate the render.

### Expected to change

`console` and `search` declare `[]` and that is correct today — they build the index through
`UNSCOPED_INTERNAL_INDEX`, which demands no authority. When the index is scoped, F51 **must fail**
until those two lines are updated. That failure is the point.

### STILL NOT DONE

Page denial handling · `UNSCOPED_INTERNAL_INDEX` removal and scoped assembly · the Server Component
prospect-read bridge · F52–F53 · the final 2G.1 gate.

---

## 22. SLICE 3 — PAGE DENIAL HANDLING. Contract. **No implementation yet.**

> **The page may decide how to respond to denial. It may never decide that denial should not occur.**

Six pages began demanding `prospects:read` at `a8167ec`, and thirteen of twenty-six pages now deny a
`sales` principal outright. That state is reachable today: a partner authenticates, the perimeter
lets them through, the DAL correctly refuses, and the surface lies to them. This slice makes the
refusal legible without moving one gram of authority into the page.

### 22.1 The seven questions, answered from the code — not from intent

**1 · Where does an unauthorized Server Component denial surface today?**

Nowhere useful. `requireCapability()` throws inside a data function; the throw propagates out of the
page; the nearest boundary is `app/error.tsx`, the only `error.tsx` in the tree (there is also
`app/global-error.tsx`). **`components/auth/Denied.tsx` exists and is imported by NOTHING** — it was
built in slice 1 and never wired, which is correct sequencing, not an oversight.

**2 · What type represents a capability denial?**

Three distinct things, and collapsing them is the failure mode:

| thrown | meaning | correct response |
|---|---|---|
| `CapabilityDenied` | identified, and the answer is still no | render `Denied` |
| `NoAuthority("unauthenticated" \| "no-request")` | nobody is identified | `/login` — never a denial page |
| `NoAuthority("unavailable" \| "no-resolver")` | outage, or a resolver never bound | rethrow: this is an incident |
| `PageNotAuthenticated` | slice 1's page-side equivalent, currently unused by any page | as its `reason` |

`NoAuthority` covers an outage AND a logged-out visitor. **Catching it wholesale would report a
database failure as "you don't have access"** — a denial that isn't one, which is the mirror image of
the bug in question 5 and just as dishonest. The `reason` must be discriminated.

**3 · How does middleware differ from render-time denial?**

`middleware.ts` **authenticates only, and says so**: it runs in the Edge runtime with no database, and
role resolution reads `memberships`. It redirects unauthenticated page requests to `/login` and
answers `/api/*` with 401. It has never been able to authorize and must not learn how.

Consequence: **render time is the ONLY place a capability denial can surface for a page.** There is no
earlier layer that could have caught it.

**4 · What should the page render when `requireCapability()` rejects?**

`components/auth/Denied.tsx`, already written to the rule that a denial names nothing — no
capability, no role, no reason — because a denial that explains itself is a map of the system for
whoever is probing it. The detail goes to the server log.

**5 · Does `app/error.tsx` misclassify authorization and database errors as vault failures?**

**Yes, and demonstrably so.** Its body reads:

> "Something failed while reading from the vault. … This is most often a malformed record in a
> `.jsonl` log or a vault file that could not be read."

A partner opening `/finance` is told the vault is corrupt. Two independent reasons that is now false:
2E moved prospects to Postgres, so a read failure is at least as likely to be the database; and a
`CapabilityDenied` is not a failure at all. It also sends the operator hunting for a broken file that
does not exist.

**6 · Which pages can produce a legitimate denial rather than crashing?**

Derived mechanically from the committed `PAGE_AUTHORIZATION` × `ROLE_CAPABILITIES`, never counted by
hand — the "eleven owner-only pages" figure was a grep and was wrong:

    DENY a sales principal (13)   / · crm · finance · tasks · signals · maintenance ·
                                  production · production/[client] · documents · documents/[id] ·
                                  clients/[slug] · clients/[slug]/portal · clients/[slug]/project
    RENDER for sales (4)          sales · sales/[prospect] · console · automations
    DECLARE [] (9)                login · portal/[token] ×3 · dashboard · search ·
                                  admin · admin/import · admin/wipe

**7 · What already constrains this?**

F51 (declared == observed, exact equality) is the binding constraint: **wiring denial handling must
not change what any page demands.** If a declaration moves, the wiring changed the contract and the
slice is wrong. F2 keeps derivation auth-unaware. F49 forbids authorization-by-absence, which is why
`Denied` may not be an empty page.

**Gap, recorded rather than fixed here:** nothing forbids a page from calling `can()` or
`requireCapability()` itself. That rule is F52/F53, which are FROZEN. This slice therefore relies on
review for its own central invariant. *Retirement condition: F52/F53 land.*

### 22.2 Two measured facts that decide the design

Both read out of this version's own bundled documentation, not from memory.

**(a) The client error boundary cannot classify a server error.**
`next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:111` —

> "Errors forwarded from Server Components show a generic message with an identifier. This is to
> prevent leaking sensitive details."

So `app/error.tsx` receives a redacted message and a `digest`. **Classification is impossible there,
in production, by design.** Denial must therefore be handled ON THE SERVER, inside the render, before
the error crosses to the client. `catchError` (new in this version) is also a Client Component
boundary and inherits the same limitation. `forbidden()` and `unauthorized()` exist but still require
`experimental.authInterrupts`, which §9 spike 3 measured as a 500 without the flag — an experimental
flag does not belong on the authorization path.

**(b) A server-side catch will swallow framework control flow unless it rethrows.**
`notFound()`, `redirect()` and `permanentRedirect()` work by throwing, as do request-time APIs
(`cookies`, `headers`, `searchParams`) under some segment configs. `unstable_rethrow` is exported by
this version — verified at runtime — and is the documented remedy.

**This is not hypothetical: 5 of the 13 denial pages throw control flow inside the region a catch
would wrap** — `production/[client]`, `documents/[id]`, `clients/[slug]`, `clients/[slug]/portal`,
`clients/[slug]/project` (2). A naive `try/catch` would turn every missing document into a denial
page. `unstable_rethrow` must be the first statement in the handler.

### 22.3 The shape

    page render
        ↓
    data function → requireCapability()  ← authority still decided HERE, only here
        ↓
    CapabilityDenied
        ↓
    page's denial handler: unstable_rethrow(e) first, then classify
        ↓
    <Denied />           no data · no capability named · no role named

A shared helper is permitted and is **not** the `authorizeEverything()` wrapper ruled out in slice 2.
It authorizes nothing and cannot: it takes no capability argument, holds no principal, and its only
inputs are a thrown value and a subtree. It CLASSIFIES a refusal that has already happened. The
distinction is the slice's whole point — coping is shared, deciding is not.

It must catch narrowly. Anything that is not a `CapabilityDenied`, or a `NoAuthority` whose reason is
an authentication reason, is rethrown unchanged. **A denial page shown for a database outage is a
lie in the opposite direction and is as unacceptable as the vault message it replaces.**

### 22.4 In scope / out of scope

IN — the denial handler and its tests; wiring the 13 pages; the minimum correction to
`app/error.tsx` so it stops asserting a vault cause it cannot know.

OUT, and frozen: index scoping · `UNSCOPED_INTERNAL_INDEX` removal · F52 · F53 · the startup-binding
proof · any change to the portal or partner authorization model · a general error-handling refactor.

**Also OUT, and recorded as a finding rather than fixed:** `admin`, `admin/import`, `admin/wipe` and
`dashboard` declare `[]`, so a sales principal RENDERS them. No data leaks — every route they drive
is guarded, F46/F49 — but a partner sees admin tooling that fails on click. They cannot be fixed by
this slice, because a page that obtains no protected data produces no denial to handle, and adding
`if (can(...))` to a page is precisely what this slice forbids. **Belongs to 2G.4**, and inventing a
data read purely to manufacture a denial would be dishonest.

### 22.5 Acceptance

Tests before behaviour where practical. The slice closes when:

1. a `sales` render of each of the 13 pages produces `Denied`, not `app/error.tsx`, and **emits no
   protected data into the markup** — asserted on the rendered output, not on the absence of a throw;
2. an owner render of all 26 is unchanged;
3. `notFound()` and `redirect()` still work from inside a wrapped page — proven on a page that
   actually throws one, not on a synthetic;
4. an outage (`NoAuthority("unavailable")`) reaches the error boundary and does **not** render
   `Denied`, with a control proving the test can tell the two apart;
5. **F51 is unchanged at 31/31** — the wiring altered no page's demand;
6. full gate green before commit.


### 22.6 OUTCOME — implemented. Slice 3 closed.

`components/auth/renderOrDenied.tsx` + `tests/auth/page-denial.test.ts` (38 tests) + the 13 wrapped
pages + the `app/error.tsx` correction. Full gate **59/59 files · 1216 passed · 58 skipped · zero
failures**; **F51 unchanged at 31/31**, which is the proof that wiring altered no page's demand.

**ONE DIVERGENCE FROM THE DRAFT ABOVE, recorded rather than made silently.** §22.1's table routed
`NoAuthority("unauthenticated" | "no-request")` to `/login`. **Not implemented.** `middleware.ts`
already redirects an unauthenticated page request before a render begins, so a redirect from the
handler could only fire for a caller who HOLDS a valid cookie — which is a login loop. Only
`CapabilityDenied` is converted; every `NoAuthority` rethrows. Consequence, stated: a caller whose
membership was revoked mid-session reaches the error boundary rather than a named surface. That is
2G.4's to name, and manufacturing a denial for it here would be inventing an authorization decision.

**The premise from §22.2 is now enforced, not assumed.** A test walks `components/` and asserts the
set of async non-`"use client"` exports is EXACTLY `["components/auth/renderOrDenied.tsx"]` — pinned
to one name rather than an exemption list that could grow. The handler is called and awaited by a
page, so what it catches was thrown inside the page's own await; any other async export there would
be rendered as a CHILD, and a child's refusal is thrown after its page returned, bypassing the
handler and reaching `app/error.tsx` as a vault failure again.

**Two assertions were tightened after they failed for the wrong reason.** The first leak check was
`/finance:\*|sales|owner|capability|role/i`, which the denial copy fails on legitimately — it says
"ask the account owner" and links to `/sales`. A blunt match there would pressure the next person to
reword honest copy instead of removing a real disclosure, so the assertion now matches capability
TOKEN SHAPE (`\w+:(\*|read|write|…)`) and role ATTRIBUTION (`role \w+`). Shape rather than a list, so
a capability added later is caught without this file being told about it.

**Classification is by TYPE, with a test that proves message-matching would not pass**: an ordinary
`Error` whose text reads "role sales does not hold finance:* — CapabilityDenied" must rethrow. Any
unrelated failure could imitate that string, and a denial page shown for a parser bug is the vault
lie inverted.

Still open and unchanged by this slice: the startup-binding proof; F52/F53 (which would enforce this
slice's own central invariant, so until they land it rests on review); the `[]` admin/dashboard
surfaces, which are a **2G.4** finding.

---

## 23. SLICE 4 — SCOPED INDEX ASSEMBLY. Contract. **No implementation yet.**

> **The index boundary must decide what gets built before the filesystem or database is touched —
> not decide what gets hidden afterward.**

### 23.1 Two live defects, MEASURED at `017b633`

Not projected from reading the code. Both were reproduced with a throwaway probe that rendered the
real pages against a seeded vault, then deleted.

**C1 · `/console` serves client and SOP material to a `sales` principal.**

    /console rendered as SALES, q="Northwind"
      client NAME in markup : true
      SOP title in markup   : true
      client BODY in markup : false   (titles render; the body sits in the index in memory)

`console` declares `["prospects:read"]`, which sales holds, so the page renders. `discoverClients()`
reads `crmDir()` STRAIGHT FROM THE FILESYSTEM — never through the `clients:*`-guarded `listClients()`
— so the visibility flag is the only thing protecting client data, and `UNSCOPED_INTERNAL_INDEX` sets
it `true`. This is not a mis-declared capability. **The page constructs data the principal is not
entitled to receive.** It is unexploitable today only because `users = 1`; the 2G ordering that put
this boundary before the invite flow is what keeps that true.

**C2 · `/` builds everything, then hides it.**

    / rendered as SALES → DENIED (slice 3's Denied surface, correctly)
      client files OPENED during the denied render : 1   (acme-co/business_context.md)
      SOP files OPENED during the denied render    : 1

`projectGraph`'s `Promise.all` starts `buildKnowledgeIndex(UNSCOPED_INTERNAL_INDEX)` alongside the
guarded readers. `Promise.all` rejects fast but cannot cancel siblings, so the unscoped discovery
runs to completion. Slice 3 hides the outcome correctly and the protected material was still read.

**C3 · `readEvents()` has no authorization boundary**, and `buildKnowledgeIndex` calls it on every
build only to have `buildIndex` do `void events`. Unguarded I/O over the crm/production/intelligence
logs, for no result.

### 23.2 What the existing proof does and does not cover

`tests/api/search-boundary.test.ts` is strong and proves the right things — for `/api/console/search`
ONLY: sales gets 200 with zero clients/SOPs, the sales registry contains `["prospect"]` and nothing
else, and a mutation control shows the unscoped variant leaking the client straight back.

Every other suite passes at `017b633` while C1 is live:

| proof | blind spot |
|---|---|
| F49 `UNSCOPED_INTERNAL_INDEX` rule | bans the constant under `app/api` — and therefore **explicitly sanctions it everywhere else**. Containment, not prohibition |
| F51 | measures capability DEMAND. Demand is not data: `console` demanding `prospects:read` says nothing about client files being opened |
| F50, 7.3 request-isolation | principal scoping and per-request isolation; neither builds an index |
| `search-boundary` | the route. Never a rendered page |

### 23.3 The contract

**E1 · `UNSCOPED_INTERNAL_INDEX` is retired.** No production caller can request an unscoped index.

**E2 · Assembly derives authorization from a principal; the caller cannot manufacture visibility.**
`buildKnowledgeIndex()` takes NO visibility argument. It resolves the asking principal through the
same registered resolver every other protected read uses, and derives visibility with the existing
`visibilityFor()`. A caller that has established no authority fails closed.

The capability that authorizes the ACT of assembling is `search`, which both roles hold — because
search is not a domain a role either has or lacks (§9); what differs is what comes back. The
capabilities that decide CONTENT remain `clients:*`, `prospects:read`, `sops:read`.

**E3 · Unauthorized stores are not read.** Already the mechanism; it must become true for every
caller, not just the route. No assemble-then-filter, at any layer.

**E4 · `/console` and `/` cannot cause client or SOP discovery for a sales principal.** Asserted at
the FILESYSTEM, by counting opened files — not by inspecting the rendered output. The property is
about construction, so the evidence must be about construction.

**E5 · Mutation.** Replacing principal-derived visibility with the old unscoped literal must produce
an observable cross-capability leak in the SAME assertions. If it does not, the tests are not
measuring the scoping.

**E6 · Events are resolved explicitly, not left as an escape hatch.** `buildIndex` does `void events`
— V1 derives nothing from them — so the read inside `buildKnowledgeIndex` is unguarded I/O over
protected logs with no consumer. By E3's own logic it is a violation: material the caller may not be
entitled to, read for no purpose. **The read is removed and the reserved linkage point is fed an
empty array**, with a test asserting no event file is opened during assembly. A future contributor
that needs events must ask for them, and the scoping question surfaces then rather than being
inherited silently.

**E7 · F51 stays downstream measurement.** Declarations are not edited before the fresh run.
`console` will move; the direction is not predicted here. `/` will likely gain `search`. The runtime
decides.

### 23.4 Deliberately NOT in this slice

No general CRM/SOP DAL rewrite. `discoverClients()` and `discoverSops()` reaching the filesystem
rather than the guarded readers is what makes E2 necessary, and E2 answers it at the assembly
boundary: with no caller-supplied visibility, an unauthorized discovery cannot be requested. Routing
those two through `listClients()`/a guarded SOP reader is a larger change that the repository has not
yet proven necessary — recorded, not undertaken.

Frozen and untouched: F52/F53 · page denial handling · the startup-binding proof · the final 2G.1
gate · the 2G.4 findings.

### 23.5 One fitness rule must CHANGE, and the change is a strengthening

F49 currently asserts the route reads `buildKnowledgeIndex(visibilityFor(principal))`. Under E2 no
caller passes visibility at all, so that literal disappears. The replacement asserts the strictly
stronger property — that `core/knowledge` derives the principal itself and that no production file
supplies a visibility — and the old assertion is not deleted so much as promoted. Stated here in
advance so it is not mistaken for weakening a rule to make an implementation pass.


### 23.6 OUTCOME — implemented. Slice 4 closed.

`core/knowledge/index.ts` rewritten · 3 production consumers updated · `tests/auth/index-scoping.test.ts`
(11 tests) · 2 F49 rules strengthened · 4 dependent suites migrated · 2 F51 declarations moved from
measurement. Full gate **60/60 files · 1227 passed · 58 skipped · zero failures**; fitness 178;
F51 31/31.

**C1 and C2 were written as failing regressions BEFORE the fix**, and both reproduced at `017b633`:
a sales `/console` render opened a client file and put the client name and an owner-only SOP title
into the markup; a correctly-DENIED sales render of `/` opened a client file and a SOP file anyway.
Both now assert **zero opened files**.

**The evidence is filesystem reads, not rendered output.** A result-shaped assertion cannot
distinguish "never built" from "built and then filtered", and those are different security
properties. The suite counts what the process OPENS, through mocks on `core/vault/markdown` and
`core/vault/io`. It also waits before reading the counts — work abandoned by a rejected `Promise.all`
keeps running, so measuring too early would have let C2 pass while the defect was live.

**E2 as implemented.** `buildKnowledgeIndex()` takes no argument — asserted by ARITY, not by reading
source — and resolves the asking principal through `requireCapability("search")`, deriving content
visibility from that same principal. `search` authorizes the ACT and both roles hold it, so this is
scoping and not denial; `clients:*` / `prospects:read` / `sops:read` still decide WHAT.

**C2 needed no restructuring of `projectGraph`**, and that is the design working rather than luck.
The concurrent build was never the defect — the unscoped visibility was. A sales caller now assembles
a prospect-only index inside the same `Promise.all`, so the sibling that cannot be cancelled is
harmless because it was never entitled to read anything else.

**E6 · the event read is gone.** `buildIndex` does `void events`, so reading the crm/production/
intelligence logs on every assembly was unguarded I/O over protected material with no consumer —
the same violation as the rest of this slice, minus the leak. The reserved linkage point is fed an
empty array and a test asserts no event log is opened during assembly.

**Two fitness rules were strengthened, and §23.5 said so in advance.** The old
`filesMatching(/UNSCOPED_INTERNAL_INDEX/, ["app/api"])` was containment, not prohibition — it
sanctioned the constant everywhere else, and the two defects took it up. The ban is now total across
twelve production roots. The old `buildKnowledgeIndex(visibilityFor(principal))` assertion could only
ever check the one caller it named; `buildKnowledgeIndex()` with no parameter holds for callers the
rule has never heard of. The retired identifier does not appear in production source **even in a
comment**, so it cannot be reintroduced by copying a line out of the file that explains its removal.

**The mutation seam follows the existing idiom.** `__unsafeBuildKnowledgeIndexForTests` is pinned to
its own definition site exactly as `__unsafePrincipalForTests` is — a production caller would be the
defect returning under a longer name. E5 uses it to prove the unscoped variant still leaks the client
back, so the scoped assertions are not passing for some other reason.

**F51 moved, from measurement only.** `/` and `console` each gained `search`. `console` KEPT
`prospects:read` — that was the runtime's answer, not a prediction: an owner render still discovers
prospects through the guarded reader. No declaration was edited before the run.

**Not fixed, recorded:** `discoverClients()` and `discoverSops()` still read the vault directly
rather than through the guarded readers. E2 removes the exploit path — no caller can request an
unauthorized discovery — but the underlying asymmetry with `listClients()` remains, and it is a
larger change the repository has not yet proven necessary.

---

## 24. SLICE 5 — THE STARTUP-BINDING PROOF. Bounded evidence, and the bound is stated.

> **A green test is evidence only when the test traverses the same seam the production defect
> traverses.**

### 24.1 What was actually open

`07c9333` (a peer session) fixed registry duplication: both the connection lease and the authority
resolver moved to `globalThis[Symbol.for(...)]`, because this module is emitted into 20–35 server
chunks and a bare `let` is one slot PER COPY. **That fixed the implementation and proved nothing
about startup.** The gap recorded on `2cf16cf` was never closed: a self-registering probe can only
demonstrate that it can register itself.

Investigation at `654fe56`:

1. **Where startup binds** — `instrumentation.ts`, Next's `register()` hook. It calls
   `bindAuthorityResolver()` UNCONDITIONALLY and before the `ASCEND_DATABASE_URL` check, then
   `registerAppDb()` after proving the pool. Returns early unless `NEXT_RUNTIME === "nodejs"`.
2. **Which instance registers** — `register()` reaches it through a dynamic `import("@/lib/authority")`.
3. **Which instance consumes** — every protected read, through `core/auth/authority`.
4. **Is the registry shared?** Within one realm, BY CONSTRUCTION: `Symbol.for` is process-wide and
   `globalThis` is per-realm. **So module duplication is no longer the risk — runtime topology is.**
   If Next served requests from a worker thread or a second process, `globalThis` would differ and
   startup binding would not reach the consumer. Reasoning cannot settle that; only running the real
   server can.

### 24.2 A finding that explains why this could hide

`app/api/console/search/route.ts` catches everything and returns **`200 {objects: [], commands: [],
error: "Search unavailable"}`**. So a production server whose resolver was never bound would answer
search with SUCCESS AND ZERO RESULTS — no 500, no alarm, just an empty palette. Same family as the
`app/error.tsx` vault-lie corrected in slice 3.

Two consequences, both load-bearing for this proof: the observable must be the **response body, never
the status**; and `commands` is the sharpest discriminator available, because in the success path it
comes from the STATIC command catalog and depends on no vault content at all — while the catch
returns `commands: []` regardless.

### 24.3 The proof

    real project tree → real `next dev` → real instrumentation.register() → bindAuthorityResolver()
      → globalThis[Symbol.for(...)]
        → independent ROUTE chunk   → /api/console/search   → body has commands, and no `error`
        → independent RENDER chunk  → /console              → renders, no error boundary

Two entry points because they are **separate chunk graphs**: observing one startup registration from
both is the evidence that the registry is shared across duplicated entry points. **No probe code runs
in the server** — nothing in either path registers a resolver, so a resolver that answers can only
have come from `register()`.

The negative control is the SAME observable with the resolver absent, in-process: the same handler,
invoked directly, must produce the known failure shape (`error: "Search unavailable"`, `commands: []`).
That is what makes the positive result meaningful rather than merely green.

### 24.4 THE BOUND, recorded as a fact rather than a footnote

> **Real Next startup binding is proven in the tested server process: instrumentation registration
> reaches the resolver consumed by independent route and render entry points. Cross-process /
> worker-realm topology is not exercised.**

It must NOT be recorded as "startup binding is proven under all production runtime topologies."
`globalThis + Symbol.for` gives the same-realm guarantee; the real-server test establishes that the
application we actually run has the expected topology. A hypothetical second process or worker realm
remains outside this proof.

### 24.5 Why the stronger proof was REFUSED, not missed

A true out-of-process negative control — booting a server with startup binding absent — was designed
and rejected. Two routes to it exist and both were closed:

- A temp directory of symlinks to the real tree, minus `instrumentation.ts`. **Measured: Turbopack
  refuses it** — `Symlink [project]/package.json is invalid, it points out of the filesystem root`.
  `next dev` also accepts no `--config` override, so no flag suppresses instrumentation.
- Temporarily displacing `instrumentation.ts` in the real tree, as the render gate already does with
  `tsconfig.json`. **Refused on the ownership boundary**: two peer sessions (`ascend-ff`,
  `ascend-d1`) were active on this shared tree, and mutating a production startup file mid-run to
  manufacture a stronger-looking control is exactly the hazard
  `feedback-ascend-concurrent-writers` exists for.

Oscar's ruling, recorded verbatim because the reasoning is the point: *"This is not letting the
property slide; it is refusing to manufacture a stronger-looking proof by violating the ownership
boundary."*

Also prohibited, and not done: no probe added to `instrumentation.ts`, and no alteration of the
production startup path for testing.


### 24.6 OUTCOME — proven, within the stated bound. Slice 5 closed.

    ROUTE CHUNK  · a protected search resolves authority bound by startup alone   PASS
    RENDER CHUNK · a Server Component page resolves the SAME startup registration PASS
    CONTROL      · the observable flips when no resolver is bound                 PASS
    guard        · announces loudly when the real-server proof has NOT run        PASS

A real `next dev` booted from this tree, ran its own `instrumentation.register()`, and answered both
surfaces. **Nothing in the test registered a resolver in that server** — the only thing supplied was
a session cookie for the real owner, so a resolver that answered can only have come from startup.
The two surfaces are separate chunk graphs, which is the evidence that the `globalThis` registry is
shared across duplicated entry points — the property `07c9333` asserted and could not demonstrate.

**A MISDIAGNOSIS, CORRECTED RATHER THAN QUIETLY DROPPED.** For two sessions this was recorded as an
unresolved `ASCEND_STARTUP_TEST` → Vitest-worker environment-propagation problem. **That was wrong,
and it was wrong because of how I read the output, not because of anything in the code.** Measured:
all four variables are present in the worker at module load. The gate was never skipping for
environment reasons — its `beforeAll` was THROWING, on

    column m.disabled_at does not exist
    HINT: Perhaps you meant to reference the column "u.disabled_at".

`disabled_at` lives on `users`; a membership row records the role, the user row records whether the
account is live. **Vitest reports a failed suite's tests as "skipped"**, and my `grep` filters
excluded the `Failed Suites` block — so a hard failure in setup was read as "the gate did not run",
and that reading was then carried into the contract, the ledger and memory.

The rule this earns, next to the vacuity rules already here:

> **A filtered test run is not a test result.** "Skipped" and "the suite threw in `beforeAll`" print
> the same count. Read the failure block, or read nothing.

**THE BOUND IS UNCHANGED** and is restated because a passing proof is exactly when a limitation gets
quietly dropped:

> Real Next startup binding is proven IN THE TESTED SERVER PROCESS: instrumentation registration
> reaches the resolver consumed by independent route and render entry points. **Cross-process /
> worker-realm topology is not exercised.**

The negative control is IN-PROCESS — the same handler and the same observable with no resolver bound.
It proves the observable discriminates. It does not prove that a real server with broken
instrumentation fails end-to-end; that would need the out-of-process control §24.5 refused on the
ownership boundary.

Also unchanged: the startup log line and healthy routes remain SUPPORTING OBSERVATIONS, not proof.
They are consistent with correct binding and equally consistent with a resolver bound by something
else. Only the controlled observable distinguishes them.

---

## 25. SLICE 6 — F52 formalized · F54/F55, the page-authorization regression barrier

> **F54/F55 enforce WHERE authorization may happen. They do not change authorization behaviour.**

### 25.1 Numbering, settled — §11 is not overwritten

Discovery found the labels had drifted. §11 committed both numbers, and neither is this rule:

| rule | §11 meaning | status |
|---|---|---|
| **F52** | the knowledge index has no unscoped constructor | **already satisfied** by slice 4 (`654fe56`) — but its assertions live inside F49's `describe`, so no rule named F52 exists |
| **F53** | invitation tokens stored hashed and single-use | **reserved for 2G.2**, which is not built |

"F52/F53" became shorthand for the page-authorization rule in slice 3's outcome note and was carried
for several sessions. **Ruling: option 2.** §11 keeps its meanings; F52 is FORMALIZED around the
invariant it already names, without changing behaviour; F53 stays reserved; the page rule is new work
at **F54/F55**. Nothing satisfied is renamed and no number 2G.2 already needs is borrowed.

### 25.2 What discovery measured

**Zero violations today.**

    imports of @/core/auth/* under app/ (excl. app/api/) + components/   1
      └─ components/auth/renderOrDenied.tsx → CapabilityDenied
    can( · requireCapability · capabilitiesFor · visibilityFor ·
    ROLE_CAPABILITIES · role/principal branching, in pages               0

Every `requireCapability` occurrence under `app/` is inside slice 3's doc comments, and
`filesMatching` strips comments before matching — so the rule reads CODE, not prose. That distinction
is deliberate and is the OPPOSITE of the §23 choice for `UNSCOPED_INTERNAL_INDEX`, which is banned
even in comments because the retired identifier must not survive anywhere to be copied back. Here the
identifiers are legitimately *discussed*: a rule that failed on documentation would pressure the next
person to delete the explanation rather than the violation.

**So F54 is a REGRESSION BARRIER, not a fix. It passes on the day it is written** — which is exactly
the vacuity trap this project has hit repeatedly. F55 exists because of that, and is not optional.

**`requirePagePrincipal` has zero consumers.** Slice 1 built it as "the shape data functions will
use"; slice 2 put the check inside the DAL instead. `pageAuthority` is used (by `lib/authority`'s
resolver); `requirePagePrincipal` is dead — and it is the most convenient tool a page could use to
start authorizing. It goes in the forbidden surface now, while nothing depends on it.

### 25.3 F52 — formalized, behaviour unchanged

The two assertions added to F49 in slice 4 move into their own `describe("F52 · …")`. Same
assertions, same strength, same files scanned. This is a labelling correction so §11's commitment is
findable by its own name; if the diff changes any assertion's meaning, it is wrong.

### 25.4 F54 — pages and components may cope with denial; they may never decide it

Surface: every `.ts`/`.tsx` under `app/` **excluding `app/api/**`** (F46–F49 own routes), plus all of
`components/`. Three checks:

1. **No import of `@/core/auth/capabilities` or `@/core/auth/principal`.** No exception. These are
   the decision table and the principal constructor.
2. **Only `components/auth/renderOrDenied.tsx` may import `@/core/auth/authority`**, and only
   `CapabilityDenied` — pinned to that exact file in the `__unsafePrincipalForTests` style, so a
   second importer fails rather than joining a list.
3. **No file on the surface — including the denial handler — references the DECISION identifiers**:
   `can(` · `requireCapability` · `capabilitiesFor` · `ROLE_CAPABILITIES` · `visibilityFor` ·
   `requirePagePrincipal` · `pageAuthority` · `__unsafePrincipalForTests`.

Check 3 applies to the handler too, which is the point: catching a `CapabilityDenied` is coping;
computing one is deciding. The handler may know a refusal happened and may not know why it should.

### 25.5 F55 — the rule is proven able to fail

One matcher function, used by BOTH F54 and F55. F55 runs it against a committed fixture directory
containing deliberately violating files — a page that imports `can` and branches on it, a component
that resolves a principal — and asserts each is reported. It also asserts a clean fixture returns
`[]`, so the matcher is not simply flagging everything.

A fixture rather than a temp file, because it is reviewable in the diff and cannot leave the tree
dirty if a run aborts. It lives under `tests/`, which no production rule scans.

    F54 green + F55 red-capable  →  the barrier holds
    F54 green + F55 green-always →  the barrier is decorative, and F55 says so

### 25.6 Explicitly NOT in this slice

No page rewrites · no new capability checks · no change to `PAGE_AUTHORIZATION` · no manufactured
denial paths · no duplication of `page-denial.test.ts`'s page-wrapping coverage, which is a different
property · no reopening of index scoping (landed at `654fe56`) or startup binding (proven at
`8efd212`). F51 must remain 31/31; if it moves, this slice changed behaviour and is wrong.

### 25.7 OUTCOME — implemented. Slice 6 closed.

    F52 · the knowledge index has no unscoped constructor        2 assertions, MOVED not changed
    F54 · pages and components cope; they never decide           3 assertions
    F55 · the F54 matcher is proven able to fail                 3 assertions
    fitness total                                                178 → 184

**F52 is a labelling correction and the count proves it.** The two assertions moved out of F49's
block into a `describe` named for the rule §11 actually committed. Same matchers, same roots, same
strength; the suite total was 178 before and after the move.

**F54 passed the moment it was written**, as discovery predicted — zero violations exist. So the
rule's own credibility rests entirely on F55, which runs the SAME matcher over three committed
fixtures and asserts each is caught for the RIGHT REASON: a page that resolves a principal and calls
`can()` (caught twice — forbidden module AND decision surface), a component holding a
`requirePagePrincipal` result, and a second importer of `@/core/auth/authority` proving the pin
holds. A fourth fixture is the same shape written correctly and must report nothing — without it a
matcher that flagged everything would also look red-capable and be useless.

**Three vacuity guards, not one.** F54 additionally asserts the surface it governs is REAL: more than
thirty files, containing the denial handler, containing at least one page, and containing no
`app/api` route. A matcher pointed at an empty list is green for the worst possible reason, and this
project has shipped that mistake before.

**The pinned exception is checked at its narrowest.** Rather than exempting the denial handler
wholesale, F54 parses the symbols it imports from `@/core/auth/authority` and requires the list to be
exactly `["CapabilityDenied"]`. Recognising a refusal that already happened is coping; computing one
is deciding, and the handler may do only the first.

**`requirePagePrincipal` is now banned on the page surface while it still has zero consumers.**
Banning an unused affordance costs nothing; banning it after something depends on it is a
negotiation.

**Behaviour is unchanged, and that was the acceptance condition.** F51 remains 31/31 and
`page-denial.test.ts` remains 38/38 — no page rewritten, no capability added, `PAGE_AUTHORIZATION`
untouched, no denial path manufactured.

Full suite 57/61 files, 1195 passed, 100 skipped, zero failing tests. The four red files remain the
IPv6-only direct endpoint timing out; this slice touches only `tests/architecture/`, and the cause
was re-confirmed as `connect ETIMEDOUT` rather than assumed. Not routed around.

F53 stays reserved for 2G.2's invitation tokens.

---

## 26. FINAL 2G.1 GATE — integration of evidence, not another slice

> **A healthy production server produces OBSERVED facts. It never produces PROVEN ones.**

### 26.1 What this gate is, and what it refuses to be

2G.1 closes by integrating the proofs already built. It adds no behaviour, fixes no parked finding,
and touches no page. The deliverable is `tests/architecture/gate-2g1.ts` — a declared inventory of
**every** suite in the repository and what each is worth as evidence — checked by
`gate-2g1.test.ts`.

It exists because of a mistake made during slice 5: a suite whose `beforeAll` THREW was read as
"skipped", because vitest prints a failed suite's tests exactly as it prints a genuinely gated one.
The misreading survived two sessions and reached the contract, the ledger and memory.

    A filtered test run is not a test result. "Skipped" and "the suite threw in beforeAll" print the
    same count.

So the gate **fails closed**: a suite claimed PROVEN whose environment gate is unset FAILS, with a
message naming the variable and telling the reader to run the full environment or reclassify. It
demonstrated this on its first run, before the environment was exported, by refusing ten claims.

### 26.2 The five classes, and the accounting

| class | meaning | count |
|---|---|---|
| **PROVEN** | an executed controlled proof, with a discriminating control that can go red | 25 |
| **BLOCKED** | infrastructure prevented execution — recorded, never counted as a pass | 4 |
| **PARKED** | deliberately deferred to a later layer | 1 |
| **NOT_APPLICABLE** | not a 2G.1 authorization property | 32 |
| **OBSERVED** | production behaviour consistent with a property, no control in the loop | 3, held separately |

**OBSERVED is held in a SEPARATE list from the suite manifest**, on purpose: listing an observation
beside proven properties is how it gets promoted by proximity. The three are the healthy deployed
build, the startup log line, and the production 404 — each recorded with the reason it falls short,
and each asserted to name its own missing control.

**The four one-shot production gates classify as NOT_APPLICABLE, not BLOCKED.** `production-migration`
(2D), `production-hardening` (2D.1) and `production-2e-migration` (2E) each WRITE to production, ran
once at their own stage, and their evidence is that stage's waypoint — they are not 2G.1 properties.
`production-2f-partner` is PARKED: it provisions the partner, which is 2G.2's act, deliberately not
run while `users = 1`. Nothing prevented these from running; they were withheld, and the manifest
says so rather than borrowing the word "blocked".

### 26.3 The four BLOCKED suites

`production-app-login`, `production-2e-consumer-parity`, `production-2e-raw-parity` and
`production-2e-source-flip` all reach the Supabase DIRECT endpoint, which resolves **IPv6-only** and
whose egress is down on this network. **Re-probed rather than assumed** at gate time: the direct host
returns families `['IPv6']` and TCP connect times out, while the pooler answers in 0.2s. Not routed
through the pooler — substituting infrastructure to turn a red gate green destroys the meaning of the
gate.

They are recorded as BLOCKED, with a stated cause, and the gate asserts the blocked count so the set
cannot drift silently.

### 26.4 Parked findings, asserted to stay parked

The gate holds the six deferred items with their owning layer and asserts none was quietly fixed
here — the temptation this slice exists to resist is tidying a finding while assembling the gate.

    admin ×3 + dashboard renderable by sales (no data leaks; routes guarded)   2G.4
    revoked membership reaches the error boundary, not a named surface         2G.4
    discoverClients/discoverSops read the vault directly — asymmetry, not      2G.4
      an escape path
    invitation tokens hashed and single-use (F53, reserved)                    2G.2
    partner UI                                                                 2G.3
    Sheets intake                                                              after 2G.4

### 26.5 Two assertion bugs the gate found in itself

Recorded because the pattern recurs: `/\w{20,}/` demands a twenty-character WORD, not twenty
characters of prose, so "direct endpoint IPv6-only, unreachable" failed a check meant to require an
explanation. Length was what was meant.

And an assertion policing the word "proven" inside the OBSERVED list rejected the honest sentence
"Proven in-process; here only observed". It was replaced with one that checks the entry NAMES its
missing control — because a rule that fails on accurate wording pushes the next person toward vaguer
claims, not safer ones. Same lesson as the §23 leak-check and the §25 comment-stripping decision.

### 26.6 THE GATE'S FIRST REAL FINDING — two proofs that could not both execute

Assembling the gate meant running **every** controlled proof in one execution for the first time.
That immediately failed, and not in the way expected:

    tests/render/page-isolation.test.ts  PART 1 · barrier            FAIL
                                         PART 2 · mutation           FAIL
                                         PART 3 · zero crossover     FAIL

`page-isolation` is 2G.1 slice 1's render-isolation gate, classified PROVEN, and it had never been
executed in the same run as slice 5's `startup-binding`. **Run alone it passes 4/4 with its mutation
detecting three crossings.** Run beside `startup-binding` it fails three of four.

Cause: both suites boot a real `next dev` against THIS project. Different ports — so that was never
it — but they share `.next/dev`, which each server writes and each suite deletes on teardown. Vitest
runs test files in parallel workers, so one suite's cleanup removes the build output the other is
still serving from. The conflict was introduced in slice 5 by copying `page-isolation`'s teardown
pattern without noticing the directory is shared.

**Two properties that cannot both be demonstrated in a single run are not two proofs.** A gate that
integrates evidence has to actually execute the evidence together, which is precisely why this was
invisible until now: every previous run had at most one real-server suite enabled.

FIXED WITH A LOCK, NOT A FLAG. `tests/render/dev-server-lock.ts` — an atomic `wx` lockfile with
stale-holder recovery, acquired in each suite's `beforeAll` and released in its `afterAll`.
`--no-file-parallelism` would have worked and was rejected: a command-line flag is a fact about how
someone remembered to invoke the suite, and the gate must not rest on an invocation detail a future
run can silently omit. Same reasoning that made the route→capability map a test rather than a note.

Verified: both suites pass in one run, the lock is released, and `page-isolation`'s mutation still
reports its three crossings.

### 26.7 CAUSE B — proven, and it was not shared state

The second combined run surfaced five further failures. All five pass in isolation, so none is a
regression — but "passes alone" is not a diagnosis. Five controlled runs, and the discriminator is
the third and fourth:

    production-authorization alone                             26/26 PASS
      + the four other admin-DB suites                         60/60 PASS   not DB contention
      + startup-binding   (dev server, SHARES production DB)   30/30 PASS   not DB contention
      + page-isolation    (dev server, DB env DELETED)         TIMEOUTS     no DB sharing at all
      + page-isolation, --testTimeout=30000                    30/30 PASS   latency, not deadlock

Every failure was `Test timed out in 5000ms` — Vitest's default. `page-isolation` writes probe
routes and triggers a **Turbopack compilation burst**; `production-authorization` makes real network
round-trips to Supabase on that default, and under the burst they exceed it. **The suite that shares
the database is harmless; the suite that burns CPU is not.** Nothing collides — the clock runs out.

The suite was NOT modified while being diagnosed.

Recorded as a MEASURED HARNESS CONSTRAINT, not an implementation defect, and deliberately not fixed
by raising timeouts: inflating a timeout to absorb starvation hides the next real slowdown.

### 26.8 The phased gate — encoded, not documented

Cause A (probe routes contaminating static scans) and Cause B (compilation burst starving network
round-trips) are two independent reasons the same phase is a hostile neighbour. Phasing resolves both
without scattering locks and without touching a timeout.

    PHASE A  static   architecture scans          invariant: app/ is not contaminated
    PHASE B  server   page-isolation ·            invariant: dev servers own .next/dev;
                      startup-binding                        the lock stays, INSIDE the phase
    PHASE C  db       real database / network     invariant: not competing with Turbopack

**The encoding is the point.** A documented protocol is a fact about how someone remembered to
invoke the suite — the same objection that rejected `--no-file-parallelism`. So:

1. every manifest entry declares `phase`;
2. the gate FAILS if a PROVEN entry has no phase, or declares an unknown one;
3. the declared phase must match the directory the scripts actually target, so a label cannot drift
   from the schedule it claims;
4. **phase is validated against BEHAVIOUR**: a suite outside phase `server` that boots a dev server
   fails, and a `server` suite that boots none fails too;
5. the `.next/dev` lock remains an invariant of the two server suites, not a substitute for phasing;
6. `gate:static` → `gate:server` → `gate:db` are committed npm scripts, run in order by `npm run gate`.

The detector's own file is pinned out of check 4 — it contains the pattern as a regex literal and
matches its own source. Pinned by name, so a second self-exclusion would have to be argued for.

### 26.9 THE PHASED GATE RUN — 2G.1 accounting

    PHASE A  static   42 files   1058 passed    9 skipped   0 failed
    PHASE B  server    2 files      8 passed    0 skipped   0 failed
    PHASE C  db       18 files    148 passed   86 skipped   4 FILES BLOCKED
    ─────────────────────────────────────────────────────────────────────
             total    62 files   1214 passed   95 skipped

    PROVEN          25   executed controlled proofs
    BLOCKED          4   IPv6-only direct endpoint, re-probed at gate time
    PARKED           1   partner provisioning — 2G.2's act, users = 1
    NOT_APPLICABLE  32   earlier stages, or not a 2G.1 authorization property
    OBSERVED-only    3   production behaviour, held separately, never promoted

**Every remaining non-pass carries an explicit classification.** The four failures are exactly the
declared BLOCKED set, and the gate asserts that count so it cannot drift. The 86 Phase-C skips are
the one-shot production gates, deliberately unset.

This is the FIRST run in which every controlled proof executed together and the result was valid.
The two previous attempts were not proof executions at all — the first invalidated a stale PROVEN
claim (§26.6), the second exposed a starvation constraint (§26.7). Both were the gate working.

tsc clean · eslint 0 errors · no probe routes left in `app/` · lock released · live service
untouched (PID 88780, 200) · production unchanged: users 1, ledger 005.

**NOT CLAIMED:** that the four BLOCKED suites pass; that cross-process/worker-realm startup topology
is exercised; that any OBSERVED property is proven; that any parked finding is fixed.

---

## 27. 2G.2 — INVITATION / PASSWORD-SET. Contract. **No implementation yet.**

> **Invitation acceptance is an explicit unauthenticated capability, not a disguised authenticated
> request.**

### 27.1 Two unrelated things are called "invite"

Conflating them is the fastest way to break something already proven, so the distinction is stated
before anything else:

| | CLIENT PORTAL INVITE | PARTNER INVITATION |
|---|---|---|
| exists | yes — `lib/portal.ts`, `portal_invites.jsonl` (vault) | **no — this is 2G.2** |
| grants | a client sight of their own portal | a USER the ability to set their own password |
| guarded | deliberately NOT — slice 2d narrowed it to token-scoped data, and F54 depends on that | see §27.3 |

**F53 governs only the second.** They share a word and nothing else. Neither may grow a code path
that reaches the other.

### 27.2 The problem this slice must solve

`005_user_credentials.sql` says it in its own comment:

> Deliberately absent: any INSERT, UPDATE or DELETE for `ascend_auth`. It authenticates; it never
> writes.

But **accepting an invitation is a write performed by someone who is not authenticated.** Setting a
password and consuming a token happen at the one moment there is no principal, no membership and no
capability. Every other write in this system requires authority; this one structurally cannot have
it. Today `setUserCredential` runs only from the one-shot provisioning gate over a DIRECT SUPERUSER
connection, which cannot be the application's acceptance path.

Rejected, and recorded so they are not revisited:

- **Grant the writes to `ascend_auth`** — the role that READS credential material must never be able
  to write it.
- **Accept through the owner's connection** — the acceptor is not the owner and holds no session;
  this would mean the application performs privileged writes on behalf of an anonymous caller.

### 27.3 `ascend_invite` — the least-privilege boundary

A new database role, in the same idiom as `ascend_auth`: infrastructure, one job, structurally unable
to do more.

    GRANT USAGE  ON SCHEMA public
    GRANT SELECT (id, user_id, expires_at, consumed_at, token_hash) ON invitations
    GRANT UPDATE (consumed_at)                                      ON invitations
    GRANT SELECT (id)                                               ON users
    GRANT UPDATE (password_hash, password_algo, password_set_at)    ON users

`SELECT (id) ON users` is present only because Postgres requires SELECT on columns named in an
UPDATE's WHERE clause. Everything else is absent on purpose: no membership access, no capability, no
INSERT, no DELETE, no other table, and — the property worth foregrounding —

> **The role that READS credentials cannot write them. The role that WRITES them cannot read them.**

`ascend_auth` holds SELECT on `password_hash` and no writes. `ascend_invite` holds UPDATE on
`password_hash` and no read of it. Neither can do the other's job, and a compromise of either yields
strictly less than the pair.

**AND IT IS NOT A PRINCIPAL.** Stated here because a future contributor will otherwise read "special
role for unauthenticated requests" as a general-purpose bypass:

> `ascend_invite` is not a principal and grants no application authority. It is a DATABASE capability
> restricted to the invitation-acceptance transaction. It has no `ResolvedPrincipal`, cannot be
> resolved into one, and no `requireCapability` call may ever be satisfied by it.

### 27.4 `006_invitations.sql`

    invitations
      id               uuid primary key
      organization_id  uuid not null references organizations(id)
      user_id          uuid not null references users(id)     -- the user ALREADY exists
      token_hash       text not null unique                   -- a digest, NEVER the token
      created_by       uuid not null references users(id)
      created_at       timestamptz not null default now()
      expires_at       timestamptz not null
      consumed_at      timestamptz                            -- null until accepted
      check (expires_at > created_at)

**The invitation grants no role.** `user_id` references a user the owner has ALREADY provisioned with
a membership (the 2F gate). Acceptance sets a password and nothing else — it creates no user, no
membership, and no authority the owner did not already write. Membership remains the only source of
authority in the system.

**Why the token is hashed with SHA-256 and not scrypt.** A password is low-entropy and human-chosen,
so its resistance must come from KDF cost. This token is 32 bytes of CSPRNG output: its resistance
comes from entropy, and a slow KDF would buy nothing while making every lookup expensive. The digest
exists so that a database disclosure does not hand over live tokens — the same reason `password_hash`
exists, for a different threat.

### 27.5 Acceptance is ONE transaction

    BEGIN
      SELECT … FROM invitations WHERE token_hash = $1 FOR UPDATE
      refuse unless: exists AND consumed_at IS NULL AND expires_at > now()
      UPDATE users       SET password_hash/algo/set_at  WHERE id = user_id      → affected = 1
      UPDATE invitations SET consumed_at = now()        WHERE id = … AND consumed_at IS NULL
                                                                                → affected = 1
    COMMIT

The failure this shape forbids:

    set password → crash → token remains usable

One transactional boundary, so the credential and the consumption succeed together or neither does.
`FOR UPDATE` plus the `consumed_at IS NULL` guard on the UPDATE also settles the concurrent case: two
simultaneous acceptances serialize, and the loser sees `affected = 0` and refuses.

**Stated as a property, because the race test alone does not imply it:**

> The token cannot be consumed successfully unless the password write AND the token-consumption
> state transition occur in the SAME transaction.

An implementation can satisfy the `FOR UPDATE` race test while still splitting the two writes across
transaction boundaries, and would then pass every concurrency assertion while leaving the exact
crash window this design exists to close. So BOTH rollback directions are tested, by forcing a
failure at each point:

    password write succeeds → consumption fails → the WHOLE transaction rolls back:
      no credential is left behind, and the token is still unconsumed and still usable
    consumption succeeds → password write fails → the WHOLE transaction rolls back:
      the token is NOT burned, and the user has no new credential

Neither direction may leave the system half-accepted. A token burned without a credential locks the
partner out permanently; a credential set without burning the token leaves a live reusable secret.

### 27.6 F53 — the contract, wider than "the token works once"

    valid token          → password established AND invitation consumed, in one transaction
    same token again     → refused
    expired token        → refused
    consumed-then-expired→ refused
    malformed token      → refused
    unknown token        → refused
    two concurrent uses  → exactly one succeeds
    partial failure      → NEITHER the credential nor the consumption takes effect

**Refusals are indistinguishable.** Unknown, expired, consumed and malformed produce one response,
one status and comparable timing — the same posture `/api/auth/login` took in 2F. A caller must not
learn whether a token, or the user behind it, exists.

**Negative privilege, proven at the database.** `ascend_invite` must be shown UNABLE to: read
`users.password_hash`; read or write `memberships`; INSERT or DELETE anywhere; touch prospects,
clients, finance, documents or events; or update any `users` column other than the three credential
columns. Each is a refusal by GRANT, demonstrated, not asserted in prose.

**And acceptance may not become an authenticated write path**: no route may reach `ascend_invite`
except the acceptance endpoint, and that endpoint may do nothing else.

### 27.7 Closure criteria — and what is BLOCKED

Runs to completion in this slice: the contract · `006_invitations.sql` · the `ascend_invite` role ·
token minting and hashing · the atomic acceptance transaction · the full F53 matrix and the negative
privilege suite, against PGlite and the local substrate.

**BLOCKED, and not to be worked around:** the production migration and live acceptance. §17 requires
migrations over the DIRECT endpoint — `connectionConfigFor` refuses DDL through the transaction
pooler — and that endpoint is IPv6-only and currently unreachable (re-probed: `families: ['IPv6']`,
connect times out). **The migration requirement is itself part of the security boundary**; routing
006 through the pooler to finish the slice would be the §14 antipattern with higher stakes.

2G.2 therefore closes as *implemented and locally proven, production application BLOCKED* — recorded
in the gate manifest under the same five classes 2G.1 established, never as a pass.

### 27.8 Explicit non-goals

No email or delivery mechanism · no partner UI (2G.3) · no membership creation on acceptance · no
second new role · no change to `ascend_auth`, to the client portal, or to any 2G.1 boundary · none of
the three parked 2G.4 findings · no Sheets. F54/F55 remain in force: the acceptance page copes with
refusal and never decides it.

### 27.9 TWO SCHEMA FINDINGS, both measured while building 006

**A · an RLS policy is part of a role's effective privilege dependency graph.**

`ascend_invite` could not touch `users` at all, and the error named the wrong table:

    permission denied for table MEMBERSHIPS

001's `users_same_org` carries no `TO` clause, so it applies to every role — and evaluating its
expression requires `SELECT ON memberships`, which this role deliberately lacks. `ascend_auth`
escapes it only because 005 happened to grant it membership reads. Adding a second permissive policy
does not help: policies are OR-ed, but the planner still checks privileges on every relation an
applicable policy references.

> A role is not least-privileged merely because its explicit GRANTs are small. An unscoped policy can
> make an unrelated relation a hard dependency of every statement that role runs.

Fixed by scoping `users_same_org` to the three application roles it was always written for — a
NARROWING. `memberships` access was NOT granted to `ascend_invite`: that would solve the symptom by
widening the role.

**B · a policy that hides consumed rows forbids consuming them.**

The SELECT policy was written as "only live invitations are visible", to make uniform refusal
structural. Measured:

    as written                            → 42501 new row violates row-level security policy
    same statement, SELECT policy `true`  → burn OK, 1 row

**Postgres checks the SELECT policy against the NEW row of an UPDATE.** Setting `consumed_at` makes
the row fail the predicate that made it visible, so the policy forbade exactly the transition it was
protecting. `WITH CHECK (true)` on the UPDATE policy does not help; the SELECT policy is applied
independently.

Rejected: DELETE-on-acceptance (a wider authority, and it discards when the invitation was used) and
a `SECURITY DEFINER` consume function (a privileged bypass — the shape §27 exists to prevent).

So **liveness is a precondition of the state transition, not a visibility property**:

    SELECT policy      what the role may SEE
    UPDATE … WHERE     which row may TRANSITION
    WITH CHECK         whether the resulting row is allowed

Uniform refusal is preserved — unknown, expired and consumed all return zero rows from ONE predicate,
so no branch can distinguish them — but it is now a property of one line of SQL, and the call site
says so. The concession, stated rather than hidden: `ascend_invite` can read dead invitation rows,
seeing only `(id, user_id, token_hash, expires_at, consumed_at)` — no organization, no issuer — and
the digest yields no token. A test asserts that BOUND, so a later change cannot quietly widen it.

### 27.10 The acceptance surface

`POST /api/invitations/accept` is declared `kind: "public"` in the route map, and public in the
perimeter alongside `/invite/`. It contains **no `authorize()` call, because there is no principal to
authorize** — the authority is the database role, assumed inside the transaction and released with
it. One body and one status for every failure, including a too-short password, so "bad password" and
"bad token" are not two distinguishable outcomes. **No session is minted**: accepting establishes a
credential, signing in remains a separate act, so a stolen token cannot be traded for a live session.

`app/invite/[token]` **looks nothing up**. Validating the token server-side would make a rendered
form mean "valid" and an error mean "not" — the enumeration oracle again, one layer up. Every token
renders the same form; only the POST decides. It therefore reaches no boundary, declares `[]`, and
F54 holds it to that.

`006` also grants `ascend_invite` to the login role `WITH INHERIT FALSE, SET TRUE`, the same shape and
reasoning as 001's grant of the application roles: the capability is acquired only by deliberately
assuming it, never passively on a bare connection.

**F48 gained one member.** `core/auth/invitations.ts` names the credential columns, and is the only
member of that set which WRITES them rather than reading — it runs as a role holding UPDATE on the
three columns and no SELECT on `password_hash` at all. The surface stays inside `core/auth/`, which is
what the rule confines.

### 27.11 THE BLOCKED SET WENT TO ZERO — reclassified from measurement

IPv6 egress returned during 2G.2. The direct endpoint connects in 0.1s and the four suites that had
been BLOCKED since §26.9 executed and passed, 41/41. They are reclassified **BLOCKED → PROVEN**:
leaving them blocked after a successful direct-endpoint execution would make the manifest contradict
measured reality.

    PHASE A  41 files · 1057 passed
    PHASE B   2 files ·    8 passed
    PHASE C  19 files ·  206 passed        0 blocked

    PROVEN 30 · BLOCKED 0 · PARKED 1 · NOT_APPLICABLE 32 · OBSERVED-only 3

**PROVEN is 30, not 29.** Twenty-five carried over, four reclassified, and one is new:
`tests/db/invitations.test.ts`, 2G.2's own F53 suite entering the manifest.

**The gate is deliberately SENSITIVE to that network, not insulated from it.** If egress drops again
those four fail in phase C, loudly, rather than resting in a comfortable category. That is the
intended behaviour of the five classes: BLOCKED when a proof cannot execute, PROVEN when it does, and
never a weakening that makes flapping invisible.

### 27.12 2G.2 STATUS — local closure, production NOT run

    local implementation   PROVEN     006 · ascend_invite · mint/digest · atomic acceptance
    local F53              PROVEN     18/18, full matrix, both rollback directions
    least privilege        PROVEN     refusals by GRANT, demonstrated
    atomicity              PROVEN     with the PGlite single-connection limit RECORDED
    acceptance surface     BUILT      route public by declaration; page looks nothing up
    direct endpoint        AVAILABLE  no longer a blocker
    production migration   NOT RUN
    production acceptance  NOT RUN

The blocker lifting makes `006` ELIGIBLE to run; it does not satisfy its operational prerequisites.
Required order, and the first item is not the migration:

1. rotate the Supabase `postgres` credential — updating BOTH `ASCEND_TEST_DATABASE_URL` and
   `ASCEND_DATABASE_URL_DIRECT`. `ASCEND_DATABASE_URL_DIRECT` is the exact connection the migration
   uses, so migrating with a credential about to be invalidated is the wrong order;
2. verify the rotated direct credential independently;
3. fresh verified backup;
4. ledger entry;
5. `006_invitations.sql` over the DIRECT endpoint;
6. production acceptance verification against the migrated database;
7. record the outcome honestly — production proven only if the controls execute and pass, BLOCKED if
   the network disappears again, and **never local/PGlite evidence substituted for production
   evidence**.

### 27.13 STEP 4 CAUGHT A DEFECT THAT WOULD HAVE SHIPPED — the grant target

Inspecting `006`'s execution identity before authorization found it granting `ascend_invite`
**`TO current_user`** — copied from 001, whose grant targets the MIGRATING identity (`postgres`, over
the direct endpoint). **The application is not that identity.** It connects as `ascend_app`, which
takes its assumable roles from `ASSUMABLE_ROLES` in `core/db/provision`, and `ascend_invite` was not
in that list.

Production would have answered **`permission denied to set role ascend_invite`** on every invitation
acceptance, while all eighteen local tests passed. 001's own header documents the trap verbatim:

> SUPERUSERS NEVER HIT THIS — they may assume any role unconditionally. PGlite runs as a superuser,
> so the whole Stage 2A/2B test suite passed while the schema was unusable on any managed Postgres.

The same defect, one migration later, reintroduced by copying the block from the file that explains
why the block exists.

**Fix 1, red-first:** `ASSUMABLE_ROLES` gains `ascend_invite`, so the login can assume it.

**Fix 2 was attempted and REFUSED BY F45.** `006` briefly granted `ascend_invite` to `ascend_app`
directly, to make the migration self-contained for an already-provisioned login. F45:

> Its privileges must arrive ONLY through role membership, so that what the application may do is
> described in exactly one place.

A migration granting the login anything creates a SECOND authority over its shape. The rule was NOT
weakened; the grant was removed. `core/db/provision` remains the single owner, and the cost is an
ordering constraint rather than a gap — see §27.15.

### 27.14 A CORRECTION: PGlite CAN represent the non-superuser boundary

It was previously stated — by me, more than once — that the local database could not distinguish a
working grant from a missing one. **That is false.** `SET SESSION AUTHORIZATION` changes
`session_user`, and role assumption is checked against `session_user`, so a non-superuser login is
representable exactly. Measured: a probe login granted `ascend_owner` CAN assume it and CANNOT assume
`ascend_invite` (42501).

The Stage 2A/2B failure was therefore not a limitation of the tool. **No test had ever asked the
question.** That is a less comfortable conclusion and a more useful one: the regression now exercises

    ascend_app → assumable roles → ascend_invite → acceptance

rather than "a superuser can execute this SQL".

Two harness facts, both measured while building it:

- `SET LOCAL SESSION AUTHORIZATION` does **not** revert on `ROLLBACK` here;
- session authorization is a **one-way door** — `RESET SESSION AUTHORIZATION`,
  `SET SESSION AUTHORIZATION DEFAULT` and a multi-statement `exec` all leave `session_user` changed.

The first symptom was "permission denied for table invitations" three tests away from its cause. The
block now runs on a DISPOSABLE database it is free to poison, and its control asserts both that the
probe is genuinely non-superuser and that an ungranted role is refused — so it can still detect a
missing grant.

### 27.15 A SEQUENCING CONSTRAINT THE FIX CREATES

`ASSUMABLE_ROLES` now names a role that only exists **after** `006`. So `provisionAppLogin` — and
therefore the 2D.1 hardening gate — would FAIL against production until `006` is applied. Ordering is
now fixed: **`006` first, any re-provisioning after.** That ordering is now the ONLY route, because F45 refused the
shortcut of granting the login directly from the migration: production's existing login gains the
capability when provisioning next runs, and not before.

The hardening gate is consequently NOT run as part of the pre-authorization gate. It writes to
production, its manifest classification is NOT_APPLICABLE for exactly that reason, and running it now
would both mutate production and fail on a role that does not yet exist.

### 27.16 PRODUCTION ACCEPTANCE — the fixture problem, and a proposal. NOT AUTHORIZED.

Everything up to acceptance is now proven ON PRODUCTION: `006` applied and its security definitions
verified, `ascend_app` re-provisioned, and `SET LOCAL ROLE ascend_invite` executed successfully by
`ascend_app` over the pooled connection. What remains unproven is the acceptance path itself.

**The constraint that shapes it:** `users = 1`, and that one user is the owner. Accepting an
invitation SETS A PASSWORD on a user, so using the real owner as the subject would overwrite Oscar's
own credential. Measured: **no application role can create a user** — every grant on `users` is
SELECT, except `ascend_invite`'s three UPDATE columns — so any fixture user must be created
administratively over the direct connection.

**OPTION 1 — rollback-scoped acceptance. RECOMMENDED.** One direct connection, one outer transaction:
insert a fixture user and membership, issue an invitation, run the REAL `acceptInvitation`, assert the
credential was set and the token burned, then ROLLBACK. Net production change: zero — `users` stays 1
and `invitations` stays 0.

It needs one piece of test-side machinery and no production change: `acceptInvitation` opens its own
transaction, so the test supplies a `SqlClient` whose `transaction()` issues SAVEPOINT / RELEASE /
ROLLBACK TO rather than BEGIN / COMMIT. The acceptance logic runs UNMODIFIED — the alternative, adding
an "already in a transaction" mode to production code, would be weakening the implementation to
accommodate a caller.

    PROVES        the real acceptance path against the real schema, roles, RLS policies, grants and
                  constraints — the things PGlite approximates and production defines
    DOES NOT      durability of a COMMITTED acceptance · that `ascend_app` rather than `postgres`
                  drives it (already independently proven) · anything about the running service

**OPTION 2 — the real partner.** Provision the partner (the parked `production-2f-partner` gate),
issue a real invitation, let them accept. This is not a fixture and should not be described as
verification: **it is 2G.2 going live**, it moves `users` 1 → 2, and it commits a real human's
credential. It deserves its own authorization on those terms.

**OPTION 3 — disposable committed user, then deleted. NOT RECOMMENDED.** Same proof as Option 1 at
the cost of a real mutation, a transient violation of the `users = 1` invariant that several gates
assert, and a deletion that must cascade perfectly to leave no trace.

**Recommendation: Option 1 now, Option 2 as a separate later decision.** Option 1 closes the
acceptance claim against production without changing production; Option 2 is a product decision about
onboarding a person, not a test.

**Recorded honestly:** the two verification failures observed immediately after provisioning are
**transient, correlated with the provisioning moment, cause unconfirmed.** They pass on retry with no
mutation possible. The same shape appeared twice earlier during credential rotations, which is
suggestive of pooler credential-cache invalidation — but the error text was lost to a grep filter at
the time, so "Supavisor cache lag" is NOT claimed. Reproducing it would need a third `ALTER ROLE`.

### 27.17 PRODUCTION ACCEPTANCE — AUTHORIZED, RUN, AND PASSED (2026-08-30)

Option 1 was explicitly authorized and executed. `tests/db/production-2g2-acceptance.test.ts` ran
against production with both gate variables supplied at the command line:

    WORK    ASCEND_ACCEPT_TEST_URL     direct endpoint, 5432, migrating identity
    VERIFY  ASCEND_ACCEPT_VERIFY_URL   admin pooled, 6543, DIFFERENT HOST, holds BYPASSRLS

**The observer identity was chosen for NON-VACUITY, not convenience.** A verification connection that
RLS silently filters would read "nothing survived" no matter what survived — a false clean. The
BYPASSRLS admin identity cannot be blinded that way, and the test additionally asserts `users = 1`
and `memberships = 1` rather than only asserting absences, so a blinded observer fails the suite
instead of passing it.

    1 file · 2 passed · exit 0 · 4.19s        the end-to-end test itself: 3268ms
    unfiltered output, no `-t` filter, no grep — a filtered run is not a result

What executed inside one production transaction: an administratively created fixture user with no
credential; a real `createInvitation` issued THROUGH the owner principal, so the RLS policy was
genuinely exercised; `token_hash` confirmed equal to `digestOf(token)`; the real unmodified
`acceptInvitation`; the written credential verified with `verifyPassword`; `consumed_at` non-null;
a replay of the consumed token REFUSED; and the owner's `password_set_at` unchanged while the
transaction was still open. Then `ROLLBACK`, in a `finally` — the safety argument never depended on
the assertions passing.

**An independent probe, from a separate process started after the test process exited**, over the
pooled admin connection with the pinned CA:

    users: 1 | invitations: 0 | memberships: 1 | fixture rows: 0
    owner has credential: true | password_set_at: 2026-08-28T23:49:40.531Z   (unchanged)
    prepared transactions left open: 0 | sessions idle in transaction: 0

The last two lines matter beyond tidiness: an abandoned prepared transaction or a session left idle
in transaction would mean the rollback path had not actually closed, and the "nothing persisted"
reading would be premature rather than final.

    production acceptance   PROVEN     the real path, real schema, real roles, real policies

**Unchanged limits, restated because a green result is exactly when they get dropped:**

    NOT PROVEN     durability of a COMMITTED acceptance — nothing was committed, by design
    NOT PROVEN     anything about the running service, which is still a PRE-006 build
    NOT PROVEN     that `ascend_app` drives acceptance — proven separately in production-2g2-provision
    NOT AUTHORIZED live service restart · real-partner onboarding (Option 2, still a product decision)

`users` is still 1. Production is byte-for-byte what it was before the run.

---

## §28 — 2G.3, THE PARTNER SURFACE

**Written before implementation, from the discovery measured at `07e7f45` and five rulings given on
2026-08-30. No code exists for this section yet, deliberately: §27 was easier to keep honest because
the contract was written while the answer was still open.**

### 28.1 2G.3 is NOT an invitation problem

The invitation primitive is finished and production-proven (§27.17). `/invite/[token]`, the public
accept route and `acceptInvitation` all exist, and the acceptance transaction has executed against
the real schema, roles, policies and grants. **2G.3 must not touch any of it.**

What discovery found instead is that the partner has nowhere to be. Crossing the F51 declared map
with the capability table — derived, not assumed:

    DENIED to sales      13 pages, INCLUDING `/`
    renderable + useful   4 pages   sales · sales/[prospect] · console · automations
    renderable, parked    4 pages   admin · admin/import · admin/wipe · dashboard   (2G.4)

**A partner who accepts an invitation and signs in successfully lands on a denial screen**, because
`/` demands seven capabilities they do not hold. And `components/shell/NavRail` is a `"use client"`
module with hardcoded links, rendered by `app/layout` for ANY authenticated session — the layout
verifies a session token, which is authentication, not role. **Nine of its twelve destinations deny
the partner**, and one that does not is `/admin`.

So 2G.3's subject is the **partner presentation and capability boundary AROUND a proven primitive**,
not the primitive.

### 28.2 THE FIVE RULINGS, transcribed

1. **Provisioning stays operational.** No `INSERT` authority is added. *2G.3 may invite an
   already-provisioned partner; it may not create users or memberships.* The invitation mechanism
   must not quietly become a user-provisioning mechanism.
2. **Minting gets an owner-only HTTP surface**, `POST /api/invitations`: authenticated, owner
   capability, existing user + membership required, calling the existing `createInvitation`. Sales
   does not get it absent a concrete business requirement.
3. **The partner lands on a dedicated `/partner` surface.** `/` does not become a universal role
   router. `/invite/[token]` remains strictly the acceptance surface. `/partner` still enforces its
   own server-side authorization: *a redirect is navigation, not authorization.*
4. **Navigation is capability-shaped PRESENTATION, never security.** Every destination continues to
   enforce its own boundary.
5. **`admin`-renderable-by-sales stays parked in 2G.4.** Hiding it from a rail does not fix it.

Stated as the separation §28 exists to hold:

    AUTHORIZATION   route / page / API perimeter decides access
    NAVIGATION      capability-aware presentation only
    LANDING         capability-aware routing only
    NONE OF THESE MAY SUBSTITUTE FOR THE OTHER

### 28.3 HARD SCOPE CONSTRAINT — no production schema migration

> **2G.3 MUST NOT require a production schema migration.**

Production is frozen at a proven state and the live service still serves a pre-006 build; a design
whose first step is `007` and a third production mutation is a design that cannot land. `006` closed
the database authority question days ago — reopening it for a UI convenience would undo that in the
cheapest possible way.

**The test is mechanical, not a judgement call.** If a proposed feature requires a new GRANT, COLUMN,
POLICY, INDEX or ROLE, it leaves 2G.3 and becomes a separately authorized architectural change. It
does not enter quietly as "part of the UI work". Every ruling in §28.2 already fits inside the grants
that exist; anything that does not fit is out of scope BY THAT FACT, and the honest move is to record
it as blocked rather than widen the schema to accommodate a screen.

This also preserves the column-level privilege model the stage has been built on: `006` grants
`ascend_invite` exactly `UPDATE (password_hash, password_algo, password_set_at)` and
`SELECT (id, user_id, token_hash, expires_at, consumed_at)` — privileges narrow enough that the
role's reach is readable in one line. A stage that adds grants to make a UI convenient is a stage
that stops being able to make that claim.

Two consequences follow immediately, and both are decisions rather than observations:

- **Re-issuing.** `ascend_owner` holds `SELECT, INSERT` on `invitations` and no `UPDATE`. It
  therefore CANNOT revoke a live invitation. "At most one live invitation per user" would need
  either a partial unique index or an UPDATE grant — a migration, and so out of scope. **2G.3
  permits multiple live invitations for the same user.** Each is independently single-use, the first
  accepted burns and the rest expire on their TTL. The mitigation is a SHORT TTL, not a new grant.
  This must be written in the UI in plain words, because an operator who mints twice needs to know
  the first link still works. **This is not UX polish — it communicates an actual state and security
  property of the system**, and the UI is where the operator learns it:

      Multiple active invitation links can exist for this partner.
      Each link can be used once and expires automatically.

  Revocation is explicitly OUT OF SCOPE for 2G.3, not deferred by accident.
- **Listing candidates.** Selecting "which partner" reads `users`/`memberships`, on which the owner
  role already holds `SELECT`. No new grant, and owner-only by the route's capability.

### 28.4 `POST /api/invitations` — the minting contract

**AMENDED 2026-08-31, after §28.13 was raised and Path B adopted. Read §28.13 first; this section is
only accurate alongside it.**

> 2G.3 may ship the minting path with an atomic application/data-layer membership predicate as its
> immediate authorization barrier. The schema does not independently encode invitation ownership;
> this is an acknowledged architectural limitation, not a claimed database invariant. A future schema
> hardening step remains required before the system can claim independent database enforcement of
> invitation ownership.

    minting contract   CONDITIONALLY IMPLEMENTABLE under §28.3
    the condition      the membership predicate is evaluated BY THE DATABASE, inside the INSERT
    NOT claimed        a schema-level invariant · independent database enforcement

    kind        capability
    capability  admin:*
    sales       deny
    backing     postgres

F49 requires an entry in `core/auth/routes` before the file exists; an unmapped route is a failing
test, never a silent allow.

**The organization is DERIVED FROM THE PRINCIPAL, never read from the body.** The RLS policy
`invitations_owner_issues` checks `WITH CHECK (organization_id = current_org())`, so a body-supplied
organization would either be refused by the database or — worse, if it happened to match — would be
an authorization fact taken from the request. The route sends what the principal already proves.

**The token is returned EXACTLY ONCE and is never logged.** Only `token_hash` reaches the table; a
minting response is the single moment the plaintext exists outside the operator's clipboard. No
`console.log` of the response body, no token in an error message, no token in a redirect URL that a
proxy would record.

**What the route must refuse, and how.** A user that does not exist, a user with no membership in the
principal's organization, and a malformed body are all refused. Unlike `/api/invitations/accept`,
these need NOT collapse into one indistinguishable response — the caller is an authenticated owner
acting on their own organization, so there is no enumeration oracle to protect against. That
difference is deliberate and must be stated in the file, or a future reader will "fix" the
asymmetry.

The UI follows the existing `InviteLinkPanel` shape: mint → display one-time link → operator copies
→ out-of-band delivery. **No email system enters 2G.3.** A token that never reaches a mail log is a
token that cannot leak from one.

### 28.5 `/partner` — the surface

A page that reaches a guarded boundary and shows the partner the work that is actually theirs:
pipeline and prospects, through the same guarded readers everything else uses. It declares its
capabilities in the F51 map like every other page and is measured, not asserted.

**Capability-gated, not role-gated.** An owner holds a superset and may render it. A page that asks
"is this principal sales?" would be the first role check at a call site in the whole system, and
`core/auth/capabilities` exists precisely so that never happens.

**It copes, it does not authorize.** Page → guarded DAL → data or `CapabilityDenied` → `Denied`, via
`renderOrDenied`. No `if (can(...))` in the page.

### 28.6 Landing — routing, and the seam must be EXPLICIT

Post-authentication the partner is routed to `/partner`. The seam that decides this must name where
its authority comes from: **do not build it on inherited context.** Slice 1 measured that a layout's
`AsyncLocalStorage.run()` reads `null` in a child page, and slice 4 measured what happens when a
boundary accepts a caller-supplied authority. The landing decision resolves membership explicitly, at
one named place, or it is not in this contract.

`/` is NOT modified to redirect by role. It keeps denying what it denies; its denial is correct and
is the fallback if the landing seam is ever bypassed.

### 28.7 Navigation — and the control that stops hiding from becoming the fix

The shell may resolve the authenticated principal's effective capabilities on the SERVER and pass
them into the rail as data. `NavRail` stays presentational: it receives what to show and shows it. It
must not import `can()`, must not receive a `ResolvedPrincipal`, and must not become an async Server
Component — slice 3 pinned that set to exactly one name and this must not join it.

**The required proof, without which this section is a security regression dressed as UX:**

> **Every destination removed from a role's navigation because of authorization must independently
> reject that role when directly requested.**

Mechanically: for every destination hidden from a `sales` principal, a test issues a DIRECT request
as `sales` and asserts it is still refused by the destination's own boundary.

    navigation filtering  =  presentation
    PAGE_AUTHORIZATION    =  authorization

Never conflated, never one standing in for the other. The failure mode this exists to catch is
subtle because it LOOKS like an improvement:

    BEFORE                              AFTER, IF DONE BADLY
    sales sees /finance                 sales does not see /finance
      → clicks it                         → requests /finance directly
      → receives Denied                   → gets the page

The second state has a cleaner UI and a weaker system.

A rail that hides `/finance` while `/finance` would have served it is strictly worse than the rail we
have now, because it converts a visible denial into an invisible one. The test is what keeps ruling 4
true after someone edits the rail.

### 28.8 THE INVITE-SEPARATION INVARIANT — same English word, different security primitive

Discovery found two mechanisms that both call themselves "invite". They are not variants of one idea:

    CLIENT PORTAL INVITE                   PARTNER INVITATION
    lib/portal                             core/auth/invitations
    portal_invites.jsonl                   Postgres `invitations`
    grants a CLIENT access to their        establishes an OPERATOR's PASSWORD for an account
      own portal, no account involved        that already exists
    token IS the authentication            token authorizes ONE credential write, then burns
    read by public token-scoped pages      executed under the `ascend_invite` database role

Stated as an invariant rather than a warning, because a warning is something a future maintainer
reads and an invariant is something the gate enforces:

> **2G.3 partner invitations MUST resolve exclusively through `core/auth/invitations`, and MUST NOT
> call, import, wrap, or reinterpret the client-portal invitation mechanism.**

The reverse direction is equally forbidden: the client portal must not acquire a dependency on
partner invitations. Both halves are made mechanically reviewable — a source-text rule in the F49
style, over the partner surface and over `lib/portal`, so the naming hazard fails a test instead of
surviving a code review. The realistic accident this catches is not somebody building a third token
system; it is somebody reaching for the invite helper that autocompletes first.

### 28.9 THE HARD WALLS

    2G.3 CANNOT
    ───────────
    create users                          create memberships
    create a second invitation/token      use client-portal tokens
    authorize through navigation          make /admin safe by hiding it
    change the production schema          restart production
    onboard a real partner                touch 2G.4 findings
    modify the acceptance path            weaken the ascend_invite boundary

Two token systems already exist — `lib/portal` client-token invites and `core/auth/invitations`
operator invitations — and both are called "invite" in this codebase. The likelier accident is not
building a third; it is **wiring the partner surface into the portal one.**

### 28.10 Proof obligations

    F49          entry for POST /api/invitations, written BEFORE the route file
    F51          entry for /partner; declared == observed, measured against the DEPLOYED store
    F54/F55      /partner uses renderOrDenied and demands no capability of its own
    new rule     every NavRail destination appears in PAGE_AUTHORIZATION — totality, so a link
                 to a page nobody classified is a failing test rather than a surprise
    new rule     every destination hidden from sales has a direct-request refusal test (28.7)
    new rule     the invite-separation invariant (28.8), enforced in BOTH directions over source
                 text: the partner surface may not reach lib/portal's invite mechanism, and the
                 client portal may not reach core/auth/invitations
    minting      owner mints · sales refused at the route · cross-organization refused BY THE
                 DATABASE, demonstrated, not asserted · token returned once · re-mint leaves the
                 earlier invitation live and single-use, which is the documented behaviour
    gate         gate:static → gate:server → gate:db, all three, before review

Local evidence only. **No production execution is authorized by this section**, and the acceptance
path is not re-proven — it was proven at `07e7f45` and 2G.3 does not touch it.

### 28.11 Non-goals

Email or any delivery mechanism · invitation revocation (needs a grant this stage may not add) ·
multi-organization anything · the 2G.4 findings · Sheets · a role check at any call site · making
`/` role-aware.

### 28.12 Closure criteria — AMENDED 2026-08-31, because the original was unsatisfiable

**The clause this replaces asked for two incompatible things.** It required a "full phased gate
green" while §28.10 required "local evidence only, no production execution". The `gate-2g1`
environment assertion goes red PRECISELY BECAUSE credential-gated suites did not run, so the only way
to turn it green is to run them — which §28.10 forbids and §28.3 puts outside the stage.

That was an authoring error, not a discovery: the phrase was imported from stages that did run with
credentials. It is corrected here rather than resolved by weakening the assertion, because the
assertion is doing its job — refusing to let unrun production suites read as local passes.

#### The behavioural claims

    owner mints THROUGH THE UI and copies a link
    a `sales` principal is refused that route
    the partner accepts through the UNCHANGED proven path
    …signs in, and LANDS on `/partner`
    …sees a rail containing only what they may reach
    every destination NOT in that rail still refuses them when requested directly

Each must be established by a test that EXERCISES the behaviour. A route being tested does not
establish that the journey works, and a source-text rule proving a component imports the right module
does not establish that the component functions. Presence is not behaviour.

#### The evidence conditions

1. **Every suite that can run locally passes**, in all three phases, EXCEPT the specific environment
   assertion whose permitted red state is defined by Condition 3. This is the operative measure of
   2G.3's own evidence: none of 2G.3's suites carries a `requires` gate, so all of them are fully
   established by a credential-free run.

   **The exception is named, not a category.** It applies ONLY to the existing `gate-2g1`
   environment assertion described in Condition 3. No other failing locally executable suite
   satisfies this condition — there is no "known failures are acceptable" class here, and creating
   one is how a gate stops meaning anything:

       landing.test.ts fails        → Condition 1 fails. Closure is blocked.
       the environment assertion    → Condition 3 permits it. Condition 1 remains satisfiable.
         fails

   **AMENDED AGAIN, 2026-08-31.** The first version of this clause read "every suite that CAN run
   locally passes", unqualified — and `tests/architecture/gate-2g1.test.ts` carries no `requires`
   gate, so it can run locally, and it fails on exactly the assertion Condition 3 permits. Conditions
   1 and 3 therefore contradicted each other.

   That is the SAME defect as the original "full phased gate green", one level down, introduced by
   the amendment that fixed the original and caught by the closure review that followed it. Recorded
   rather than quietly corrected, because it is the argument for the review step existing: a contract
   author is the worst reader of their own clause.
2. **Every credential-gated suite is explicitly classified** in the manifest, and 2G.3 changes none
   of those classifications to make the run quieter.
3. **The `gate-2g1` environment assertion MAY be red in a credential-free run**, and its redness is
   not a 2G.3 defect. It is a true statement about THAT RUN — *these proofs did not execute here* —
   and it is evidence about earlier stages' production claims, not about this stage's implementation.

   It must NEVER be resolved by weakening the assertion, by reclassifying a suite so it stops
   complaining, or by supplying production credentials to a local stage. If the classification of a
   production suite is genuinely wrong, that is its own correction with its own record — as the 2G.2
   acceptance row was at `1591808`.
4. **Production evidence is REFERENCED, never re-established.** Acceptance was proven at `07e7f45`
   (§27.17); 2G.3 cites it and does not re-run it.
5. **F51 measured against the DEPLOYED store**, no production mutation, no schema change (§28.3).

#### The line that must not be crossed

    SKIPPED is never PASSED.  BLOCKED is never PASSED.

A closure criterion that could be satisfied by making the gate stop objecting is not a criterion. The
amendment above changes what closure REQUIRES; it changes nothing about what the gate REPORTS.

### 28.13 BLOCKER — AN INVITATION NAMES A USER, NOT AN ORGANIZATION RELATIONSHIP

> **RESOLVED IN THE SCHEMA — READ §28.15 BEFORE ACTING ON THIS SECTION.** Everything below is the
> finding AS IT STOOD during 2G.3, and its conclusion — *"the invariant cannot be established inside
> 2G.3"* — was true of that stage and is no longer the current state of the repository.
> `007_invitation_membership` adds the composite foreign key. It has NOT been applied to production,
> so this section still describes the DEPLOYED database. Both facts matter; §28.15 holds them apart.

**Raised during the 2G.3 implementation pass, 2026-08-30. Recorded before any decision about how to
resolve it, and while the implementation sits uncommitted.**

#### 1. The path

    org A owner  →  invitation naming an org B user  →  acceptance  →  org B user's credential is set

#### 2. Why the existing boundary cannot prevent it

    invitations.organization_id   the ISSUER's organization. Checked by RLS, and always matches,
                                  because the issuer supplies it from their own principal
    invitations.user_id           a bare FK to users. NOTHING ties it to a membership in that
                                  organization — no constraint, no policy, no column
    invite_sets_credential        permits ascend_invite to write a credential for ANY user holding a
                                  live invitation. It does not mention organizations at all

Postgres is behaving exactly as written. A policy can only evaluate a relationship the schema
represents, and **this relationship is not represented anywhere.** `WITH CHECK (organization_id =
current_org())` constrains the row's own organization column; it says nothing about the user that
column is paired with.

Stated as the architectural fact underneath: **`invitations` records an invitation TO A USER, and
not an invitation relationship OWNED BY AN ORGANIZATION.** Those are different concepts, and the
security model needs the second one to be durable.

#### 3. The executable evidence — PRESERVED, and not to be weakened

`tests/db/invitations.test.ts`, against PGlite carrying migrations 001–006:

    "THE HAZARD IS REAL: the database does NOT refuse an invitation for an outsider"

It mints across organizations, accepts, and asserts the outsider's credential **was** written. It
depends on nothing 2G.3 added — only `createInvitation`, `acceptInvitation` and the real schema — so
it remains valid evidence whatever happens to the rest of the implementation. A guard whose threat
exists only in a comment is a guard nobody can tell is load-bearing.

#### 4. WHAT WAS SHIPPED IS NOT THE VULNERABILITY, AND THE DIFFERENCE MATTERS

The uncommitted implementation REFUSES this path: `assertMemberOfCallersOrganization` runs inside the
minting transaction, as the minting principal, scoped by `current_org()`. The route answers 404 and
the insert never executes; that is proven at both levels.

So the honest statement of the finding is not "2G.3 nearly shipped a cross-organization credential
write". It is:

> **The minting path would rest on a SINGLE barrier.** Everywhere else in this system the database is
> an independent second barrier — "a bug in the capability table cannot open the database; a bug in
> the database cannot be reached past the capability table". For this one property there is no second
> barrier, because the schema cannot express it.

Production today holds one organization and one user, so the present exposure is nil. That is a fact
about scale, not about the boundary, and it expires the moment a second organization exists.

#### 5. Why the fix is out of scope

A durable fix means the database can evaluate the relationship: a composite foreign key from
`(user_id, organization_id)` to `memberships`, or a policy that can reach one. Both are **schema
changes**, and §28.3 forbids 2G.3 from requiring a GRANT, COLUMN, POLICY, INDEX or ROLE. The test is
mechanical and it has fired.

    the cross-organization invariant requires a schema change
    §28.3 forbids a schema change in 2G.3
    ⇒ the invariant cannot be established inside 2G.3

#### 6. Refused resolutions

Not client-side filtering · not hiding the UI · not a route-only check standing in for the boundary ·
not a new application-role permission · not a third invitation or token system · not a migration
smuggled in as part of the UI work.

#### 7. PATH B — ADOPTED 2026-08-31

`createInvitation`'s INSERT could be written as `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM
memberships WHERE user_id = $2 AND organization_id = current_org())`. The predicate is then evaluated
BY THE DATABASE as part of the write, under RLS, in one statement — no check-then-write window, and
no new schema object. It changes a query shape, not the schema, so §28.3 does not forbid it.

It is weaker than a constraint: it binds THIS statement, not every future writer, so it is a better
barrier rather than a second one. It also modifies a 2G.2 primitive, which deserves its own decision.

**ADOPTED.** `createInvitation` now carries the predicate inside its INSERT, and the refusal is read
from a zero-row result rather than dereferenced past. The pre-check that briefly existed in
`core/auth/directory` was REMOVED rather than kept alongside it: two barriers for one property is two
places to get it wrong, and the check-then-write shape is exactly what Path B replaces.

**The two claims are tested separately, and they must disagree:**

    RAW SQL as ascend_owner    →  SUCCEEDS   proves the SCHEMA still does not encode ownership
    createInvitation()         →  REFUSES    proves the application barrier holds

The first test MUST NOT be deleted when the second goes green. Its purpose changed the moment Path B
landed — from "demonstrate a bug in the application" to "demonstrate that the database itself still
does not encode invitation ownership". The day it starts failing is the day the schema finally
expresses the relationship, and that is a §28.13 milestone rather than a regression.

Path A is NOT superseded. The predicate binds one statement; a constraint would bind every future
writer. Hardening now does not foreclose constraining later, and the application predicate stays
correct underneath a constraint once one exists.

#### 8. What this does and does not block

    BLOCKED    the minting half — POST /api/invitations, the owner surface, and the claim that an
               invitation cannot cross an organization boundary
    NOT IMPLICATED
               the partner surface, capability-shaped navigation, the landing seam, F56/F57/F58.
               None of them touch the invitation authorization path, and F57 independently caught a
               real ordering defect while they were being built

2G.3 is therefore not uniformly blocked, and should not be described as such. **Its minting half is.**

### 28.14 2G.3 IS CLOSED — 2026-08-31

**Closed on committed artifacts, not on a working tree.** The criterion and the evidence are each in
history, and the mapping between them was performed against those two commits:

    579071f   §28.12, the criterion            the contract closure is measured against
    9d5a9c7   the behavioural evidence          the tests that satisfy it

    behavioural claims   6/6 evidenced · 54 tests across 5 suites
    conditions 1–5       satisfied
    schema change        none — 0 lines of .sql diff across 4af69e0..9d5a9c7
    production           no mutation, no connection, no restart, no onboarding
    acceptance path      untouched; prior evidence at 07e7f45, deliberately not re-run
    evidence ledger      corrected (1591808, fbc0430) and guarded against drift
    working tree         clean · nothing pushed

**The one red is permitted BY NAME.** `gate-2g1`'s environment assertion fails because
credential-gated suites did not execute locally, which §28.10 forbids and §28.3 puts outside the
stage. §28.12 condition 1 names that single assertion as its only exception; the suite's other
fifteen assertions pass, and no other locally executable suite fails anywhere in the three phases.
Nothing else hides under that exception.

#### What 2G.3 delivered

    POST /api/invitations     owner-only minting; organization from the principal, never the body;
                              token returned exactly once and never logged
    /partner                  the partner's landing surface — capability-gated, not role-gated
    /admin/invitations        the owner's minting surface, guarded, denying sales for the ordinary
                              reason rather than rendering and failing at the button
    capability-shaped rail    presentation resolved on the server; the layout never sees a principal
    the landing seam          routing only, from an explicitly authenticated user_id
    F56 · F57 · F58           nav totality · hidden-destination direct refusal · invite separation

#### What 2G.3 deliberately did NOT deliver, and must not be assumed

    the database invariant    §28.13 Path B established an APPLICATION barrier inside the
                              zero-schema-change boundary. The schema still does not encode
                              invitation ownership, and `tests/db/invitations.test.ts` proves that
                              PERMANENTLY with raw SQL as `ascend_owner`. That test failing one day
                              is a §28.13 milestone, not a regression.
    invitation revocation     `ascend_owner` holds no UPDATE on `invitations`; multiple live
                              invitations per user are contracted behaviour, mitigated by a short
                              TTL and stated in the UI
    email or delivery         none; the operator copies a link out of band
    user / membership creation  provisioning stays operational
    the 2G.4 findings         `admin`, `admin/import`, `admin/wipe` and `dashboard` still declare
                              `[]` and still render for sales. Parked, and asserted visible ON
                              PURPOSE so nobody "fixes" it by concealment
    production go-live        the live service still serves a pre-006 build; no partner onboarded

#### The lesson this stage cost the most to learn

The contract was amended twice for the same defect: a closure criterion that could only be satisfied
by making the gate object less. First "full phased gate green" against a local-evidence-only stage;
then, in the amendment that fixed it, an unqualified "every suite that can run locally passes"
against a suite that legitimately does not.

> **A contract author is the worst reader of their own clause.** Both were caught by a review step
> that existed only because the stage refused to close on its author's say-so.

### 28.15 §28.13 RESOLVED LOCALLY — the second barrier exists, and is not yet in production

**Local implementation only, 2026-08-31. `007` has NOT been applied to production and doing so is a
separate authorization.**

#### The ruling

    FOREIGN KEY (user_id, organization_id)
      REFERENCES memberships (user_id, organization_id)
      ON DELETE RESTRICT

`memberships` is already `PRIMARY KEY (user_id, organization_id)`, so the composite key this needs
existed all along — the constraint required no new unique index, no new role, and no change to the
acceptance contract. `acceptInvitation` neither reads nor writes `organization_id`.

**CORRECTED 2026-08-31.** This sentence also said "no policy". That was true of the constraint and
stopped being true of the FILE: the `created_by` ruling below replaces `invitations_owner_issues`,
so `007` now carries a `DROP POLICY` / `CREATE POLICY` pair. The constraint still needs no policy;
the migration has one.

**RESTRICT, not CASCADE.** An invitation is historical business evidence — who was invited into which
organization, by whom, and whether they accepted. CASCADE would let a membership deletion erase that
silently. It costs little because REVOCATION DOES NOT DELETE MEMBERSHIPS: it sets
`users.disabled_at`, which principal resolution reads per request, and never reaches the constraint.

**The cost RESTRICT does carry, recorded because 2G.4 will meet it.** Once any invitation names a
`(user_id, organization_id)` pair — including a CONSUMED one, since RESTRICT does not read
`consumed_at` — that membership can no longer be deleted, and **no application role can clear the
reference**: 006 grants `ascend_owner` SELECT and INSERT on `invitations`, and DELETE to nobody. So
removing a person from one organization while they remain a user is repairable only administratively,
over the direct endpoint. That is the intended direction — evidence outranks erasure — but it is a
real constraint on any member-removal surface, and it is accepted deliberately: the same objection
that REJECTED a composite key for `created_by` (it would permanently pin the issuer's membership) is
taken here for `user_id` with the cost written down rather than discovered later.

#### What was MEASURED rather than reasoned about

    RI bypasses RLS            SEE THE CORRECTION BELOW. As first written this row claimed a
                               measurement that had not been made. It now names one that has.
    ON DELETE RESTRICT         a membership with no invitations deletes; one with an invitation is
                               refused and the invitation survives.
    the cascade edge case      deleting a USER cascades to memberships and invitations through their
                               own keys while the new constraint forbids deleting a referenced
                               membership. Whether those conflict depends on the order Postgres
                               processes cascades — it does not. The delete succeeds and no
                               invitation outlives the user it names.

#### CORRECTION, 2026-08-31 — the RI row claimed a measurement nobody had made

**The two tests that carried the "RI bypasses RLS" claim ran as a PostgreSQL superuser.** A superuser
bypasses row security unconditionally, and `FORCE ROW LEVEL SECURITY` does not change that — FORCE
removes the OWNER's exemption, not a superuser's. So `memberships`' `current_org()` policy was never
evaluated in that session, and both tests would have passed identically in a PostgreSQL where RI
checks DID respect row security. The claim was true; the evidence for it was vacuous.

This was an authoring error, not a discovery. The comment beside it — "measured rather than cited:
this insert runs with no `ascend.org_id` set at all" — is a true sentence about the wrong mechanism:
the absent session organization is not what made row security inapplicable. The superuser was.

**Corrected by making the measurement, not by softening the claim** — the repository's own rule is
that an assertion passing for the wrong reason is tightened to what it means, not loosened:

    the superuser test    KEPT, renamed to what it does prove — that a legitimate row is still
                          writable with no session organization set, so migrations, fixtures and
                          administrative repair are not broken, and that the FK's column order is
                          not transposed. It may not use the words "row security".
    the real measurement  a NOSUPERUSER, NOBYPASSRLS role that is not the owner of either table and
                          holds NO PRIVILEGE AT ALL on `memberships` — a stronger construction than
                          mere invisibility. It asserts its own preconditions FIRST and FAILS rather
                          than skipping, then both directions: the legitimate pair inserts, the
                          cross-organization pair is refused with SQLSTATE 23503 specifically, since
                          a 42501 would prove only that the role could not see the table.

It runs in the disposable `probePg` instance that already existed in the suite, so it adds no
instance to a gate whose db phase already times out five files under contention.

**The durable rule, which generalises past this stage:** a test may not claim to measure a
row-security or privilege behaviour from a session that bypasses it. Enforced here as an in-test
precondition assertion. NOT as a fitness rule — a grep over test prose is brittle, and would be
scope creep on §28.13.

**Not covered:** the measurement proves RI ignores the WRITER's visibility and privilege, with
`memberships` owned by `postgres` — production's ownership today. It does not exercise a NOSUPERUSER
OWNER. If that ownership ever changes, this evidence does not carry.

#### What the constraint binds, and what it does not

The unqualified claim — "enforced against every writer, a superuser included" — was FALSE, and is
replaced by a named population.

    ORDINARY WRITERS         every role that cannot suppress or remove constraint enforcement: the
                             login `ascend_app` and every role in `ASSUMABLE_ROLES`, plus any future
                             role provisioned the same way. THE ENTIRE APPLICATION SURFACE IS HERE.
    ADMINISTRATIVE WRITERS   the owner of `invitations`/`memberships`, and any superuser. In
                             production, `postgres` over the direct endpoint — the same identity
                             that applies migrations. Defined by holding ANY of:
                             `SET session_replication_role`, `ALTER TABLE … DISABLE TRIGGER`,
                             `ALTER TABLE … DROP CONSTRAINT`.

An administrative writer CAN still write a cross-organization invitation, and acceptance will honour
it — demonstrated end to end, not theorised. **That is an exclusion, not a hole**, and the reason
must be stated in this exact form: the capability required to forge the row is a STRICT SUPERSET of
the capability required to cause the harm directly. A role that can suppress a trigger can equally
`UPDATE users SET password_hash` or `INSERT INTO memberships`. Routing through a forged invitation
grants it nothing it did not already hold, so the reproduction demonstrates PRIVILEGE, not ESCALATION.

That argument is sound only while the capability stays out of application hands, so that premise is
now MEASURED rather than assumed: no role in `ASSUMABLE_ROLES` can set `session_replication_role`,
disable the triggers, or drop the constraint. The role list is DERIVED from `ASSUMABLE_ROLES`, so a
role added later is covered without anyone remembering to add it. Grant an application role one of
those capabilities and the suite goes red — which is the point.

**Tenant isolation here is the conjunction of five controls, and no single one is "the barrier":**

    i    `organization_id` and `created_by` come from the resolved principal    application + brand
    ii   `invitations_owner_issues` confines organization AND issuer            RLS
    iii  `invitation_targets_a_member` confines (user_id, organization_id)      referential integrity
    iv   no assumable role can escape (iii)                                     role geometry, MEASURED
    v    a credential grants no authority — membership resolution does          `resolvePrincipal`

Control (v) is why the residual severity of a forged row is bounded even where (iii) is suppressed:
the victim's password is rewritten, but `resolvePrincipal` refuses `ambiguous-membership`, so a user
holding memberships in two organizations cannot be used to cross between them. Verified, not assumed.

#### `created_by` is bound to the acting principal, not to a membership

`created_by` had the same shape §28.13 describes, on the other user column, and `007` as first
written did not touch it: an owner could write a row crediting a user in another organization, or
one with no membership anywhere. Measured, both accepted.

**A composite foreign key was REJECTED for it.** It fixes the uninteresting half — an org-A owner
could still credit any other org-A member, satisfying the key while the provenance stays forged —
and it would permanently prevent removing a departed issuer's membership, contradicting the very
reason RESTRICT was chosen for `user_id`.

The asymmetry is deliberate and load-bearing:

    user_id      must STAY a member. The row is meaningless once that membership is gone.
                 Referential, RESTRICT.
    created_by   must be a TRUE STATEMENT ABOUT A PAST MOMENT, and must survive the issuer leaving
                 the organization. Authenticity at write time, no ongoing referential tie.

So it is bound in the INSERT policy to `current_user_id()` — the same GUC `asPrincipal` sets from the
same `ResolvedPrincipal` that supplies `ascend.org_id`. Both facts are witnessed by one act of
authentication rather than being two independent claims that happen to agree. This is the provenance
rule applied to the issuer: the actor of an act is witnessed, not entered.

Expressed as RLS `WITH CHECK`, never a table `CHECK` — a `CHECK` reading a session GUC would bind
migrations, fixtures and administrative repair, none of which act under a resolved principal. A
forged `created_by` now yields 42501, i.e. a 500 rather than a 404, and that is correct: it is
unreachable from any supported caller, so reaching it means the application is broken, not that an
operator made a mistake it could act on.

An operational consequence, recorded as intended rather than discovered later: 006's existing
`created_by → users(id)` is NO ACTION, so an issuer's USER row cannot be deleted while their
invitations exist — while their MEMBERSHIP can be, which is what the asymmetry is for.

#### The hazard test was INVERTED, never deleted

`7a289ba` predicted this exact transition and named it a milestone rather than a regression. The test
kept its subject — what the database does with a cross-organization invitation written by raw SQL,
around every application barrier — and changed only its expected answer:

    before 007   asserts the write SUCCEEDS   proof the schema did not encode ownership
    after  007   asserts the write is REFUSED  proof the schema now does

**Its four-case table was rewritten with it, and the incident row MOVED.** Before `007` the incident
was `application RED + database GREEN`, because the database was never a barrier. After `007` it is
`RED + RED`. A reader who remembers the old table and applies it to the new one misclassifies the
severity of both middle rows — so the new header says so explicitly.

#### The Path B predicate was KEPT

Now redundant as a barrier, and not redundant as an interface: without it a cross-organization mint
surfaces as a raw foreign-key violation and a 500 instead of a 404 the operator can act on. This is
not the check-then-write shape Path B removed — the predicate lives inside the write.

#### What this does NOT do

    production          `007` is not applied. The live service still serves a pre-006 build.
    2G.4                untouched and still locked — a separate set of findings
    the claim itself    §28.13 is resolved IN THE SCHEMA AS WRITTEN LOCALLY. Until the migration is
                        applied, production's invariant is still the application predicate alone,
                        and any claim otherwise is false.

**Seven things this does not cover, named so no reader has to discover them:**

    1  an administrative writer that suppresses, disables or drops the constraint. Legitimate by the
       superset argument above; the premise is measured, not assumed.
    2  `created_by` written by such an actor — the SAME exclusion, not a second caveat.
    3  production — `007` is not applied there; the deployed barrier is the application predicate
       in `core/auth/invitations.ts` alone.
    4  the concurrency case — one writer inserting an invitation while another deletes the
       membership. REASONED (RI takes `FOR KEY SHARE`, so they serialise), NOT demonstrated: PGlite
       is single-connection, and asserting it anyway would recreate the exact vacuous-evidence
       defect corrected above.
    5  a future change of `memberships` ownership — the RI evidence is gathered under `postgres`
       ownership, which is production's today.
    6  revoked users (`disabled_at`) — an invitation may still be minted for one, since revocation
       deliberately leaves the membership in place. Not exploitable: `resolvePrincipal` refuses on
       `disabled_at` before any capability is read. Ruled out of scope, not overlooked.
    7  migration-application ergonomics — `applyMigrations` defaults to the full list and refuses on
       the first already-applied file, so applying `007` to a database at 006 needs the filtered
       call `006`'s own gate uses. Ruled out of scope; it belongs to the production gate, which
       remains REQUIRED and UNBUILT.

---

## §29 — 2G.4, THE PARTNER SECURITY MATRIX

**CONTRACT ONLY, as of 2026-09-01. No code, no test, no schema change, nothing applied.** 2G.1 ·
2G.2 · 2G.3 are CLOSED, and §28.13 is closed at `8a511c5` — §28.15's local resolution, not yet
applied to production. 2G.4 has no unsatisfied ordering precondition against any of them: this
section can be argued with today, before a line of it is built.

### 29.1 THE INVARIANT, stated before any slice

> No authorization outcome in this system is known only from a DECLARED role. For every route and
> every page, both roles' outcomes are demonstrated under a principal that Postgres resolved from a
> membership the partner obtained by ACCEPTING AN INVITATION — and every way authority can be
> refused reaches a surface that names itself.

What was not true before it: `bindTestAuthority("sales")` constructs a sales principal carrying the
OWNER's user id (`tests/support/operator-session.ts` → `__unsafePrincipalForTests(role, ORG_A,
TEST_OWNER_ID)`). Every row §8 currently claims rests on that construction. After 2G.4, deleting the
`memberships` row changes the answer a sales session gets; today it changes nothing, because there
is no row to delete — only a literal standing in for one.

### 29.2 Three corrections to the pre-design survey

Discovery for this section corrected its own inputs before proposing anything to fix, the same
discipline §26.5's two self-found assertion bugs and §28.13's RI correction both used: an error
found while gathering evidence is a correction, not a detail smoothed silently into the design.

**(a) Row 5's production half is already proven.** `tests/db/production-authorization.test.ts:156`
proves per-org RLS isolation on real managed Postgres, `:168` proves a session with no organization
bound sees nothing, and `:180` proves a cross-tenant write is refused by `WITH CHECK`. `gate-2g1.ts:114`
already classifies the suite PROVEN. Only the DIRECT endpoint is IPv6-blocked (§26.3); this suite
runs through the pooler, which answers in 0.2s.

**(b) Row 11's instrument exists and has never run.** `tests/db/production-2f-partner.test.ts:122`
already asserts "ascend_sales cannot read ANY credential material" — proven on paper since 2F. It is
welded into a suite that also PROVISIONS the partner, so `gate-2g1.ts:112` parks the whole file as
one unit: a read-only property trapped inside a mutating one-shot gate. The read half is splittable,
and splitting it changes nothing it proves.

**(c) Parked finding 1 is not "no data leaks" — it is a live disclosure.** `app/admin/wipe/page.tsx`
is `"use client"`, declares `[]` in `PAGE_AUTHORIZATION`, and therefore renders for a `sales`
principal. Its static copy contains, verbatim:

    "Wipes the seeded $4,541 revenue + care plans + overdue"
    "Wipes Pilar's 2 seeded signed approvals + any test ones"
    "Delete decoraciones-pilar CRM folder"
    "Delete tapia-tile-marble CRM folder"

— client identities and a revenue figure, i.e. `clients:*` and `finance:*` material, disclosed in
MARKUP rather than through a reader `sales` is denied elsewhere. `page-denial.test.ts` cannot catch
this by omission, but by construction: its `DENIES_SALES` set is derived by filtering
`PAGE_AUTHORIZATION` for pages whose declaration is NON-EMPTY. A page declaring `[]` is invisible to
that suite's inventory whatever it renders — the suite was never wrong about what it measured, it
was never asked about this page. Unexploitable today only because `users = 1`.

### 29.3 THE FIVE RULINGS

#### Ruling 1 — "a REAL provisioned partner" means local-database-real

§13 item 5 already gates issuing any partner credential on 2G.4's page matrix being green, which
makes production-real self-referential: 2G.4 cannot require a production partner in order to prove
2G.4 safe before a partner may exist. "Real" therefore means a membership row that a real
`acceptInvitation` transaction wrote, in PGlite carrying migrations 001–007, reached through
`resolvePrincipal` exactly as production reaches it — no step simulated between the INSERT and the
principal under test:

    operational INSERT org+users+memberships → createInvitation() as owner through asPrincipal
    → acceptInvitation() (partner chooses password; owner never learns it) → POST /api/auth/login
    → verifySessionToken → resolvePrincipal(pglite, userId) → registerAuthorityResolver

**BINDING.** No file in the provisioned-partner evidence path may reference
`__unsafePrincipalForTests`, `bindTestAuthority`, or `setMembership`. The role under test is a
database row, or the evidence is void. New fitness rule **F59** enforces this by source-text scan
over the new suites.

#### Ruling 2 — fix the three admin pages; reclassify `dashboard`

`app/dashboard/page.tsx` is `redirect("/")` and nothing else — structurally identical to
`app/search/page.tsx`, already on record as a retired permanent redirect whose `[]` is permanent,
not a gap. It does not share admin's failure mode, but the reclassification is DEMONSTRATED rather
than asserted: a test renders it, follows the redirect to `/`, and confirms `/` denies sales.

`admin`, `admin/import` and `admin/wipe` instead follow the pattern §28.4 already established for
`/admin/invitations`.

**BINDING mechanism.** Each becomes a server page whose default export is
`renderOrDenied(area, () => Content(...))`, where `Content` first `await`s a DAL function guarded by
`admin:*` — ALONE, never inside a `Promise.all` (§28.4 records F57 independently catching an
ordering defect once already, during 2G.3's own build). Client components move under `components/`;
no page calls `requireCapability`, `can()`, or reads a role. `PAGE_AUTHORIZATION` and
`NAV_DESTINATIONS` move to `["admin:*"]` TOGETHER — F56 already holds the two equal — and F51 holds
the declaration to measured runtime demand, so F57's direct-request refusal test covers `/admin`
the moment the declaration lands, without a new assertion written for it.

**BINDING content rule.** The client names and the revenue figure quoted in §29.2(c) must not
survive as static strings in a client component. They are either obtained from the `admin:*`-guarded
reader, or deleted — which of the two is undecided (§29.11, Q3).

#### Ruling 3 — finding 2: `NoAuthority` does not convert as a class; the type splits

`renderOrDenied.tsx:38-45` refuses to convert `NoAuthority` into a denial surface because the class
covers an outage, an unbound resolver, and an unidentifiable caller together — and redirecting any
of those is a login loop for someone holding a valid cookie. Both objections stand; neither is
weakened here.

The defect is a conflation IN THE TYPE, not in the refusal. `lib/page-principal.ts` already computes
the distinction the type discards. `PageDenial` splits cleanly:

    ANSWERED     the database answered and the answer denies this person
                 disabled · no-membership · ambiguous-membership · no-such-user
    UNANSWERED   nobody could be identified, or nothing could answer
                 unauthenticated · no-request · unavailable · no-resolver

**BINDING mechanics.**
- `AuthorityAnswer`'s failure arm gains `kind: "refused" | "unidentified"`; `requireCapability`
  throws `AccountRefused` for the first and `NoAuthority` unchanged for the second.
- **`AccountRefused extends NoAuthority`.** The nine existing call sites across `dal-boundary`,
  `portal-token-boundary` and `page-denial` keep their exact meaning under a narrower subclass; a
  sibling class would silently change four of them.
- The `PageDenial → kind` mapping in `lib/authority.ts` is an EXHAUSTIVE SWITCH WITH NO `default`,
  so a reason added later fails to compile rather than falling through unclassified. Prose does not
  enforce this; the switch does.
- `renderOrDenied` converts `AccountRefused` to a new `AccountInactive` surface, checked BEFORE the
  `CapabilityDenied` branch; `page-denial.test.ts:99-105` (outage and unbound-resolver still
  rethrown) is the discriminating control.
- No redirect. The surface offers explicit sign-out (`POST /api/auth/logout`) — a user-initiated
  sign-out is not the automatic redirect that creates a login loop. `Denied`'s "Go to your pipeline"
  link is wrong here: a revoked account has no pipeline.
- The surface names no reason. Revoked, unmembered and ambiguous render identically; naming one
  would be an enumeration oracle, so only the server log distinguishes them.
- Route status codes are unchanged. `threat-model.test.ts:130-172` asserts a uniform 401. The split
  is presentational and page-side only.

#### Ruling 4 — finding 3: defer, with an enforced boundary and a stated retirement condition

§23.4 already ruled this "recorded, not undertaken … an asymmetry, not an escape path." Since slice
4 the property is held by `currentVisibility()` → `requireCapability("search")`, deciding before any
file is opened. Routing `discoverClients`/`discoverSops` through the guarded readers is a DAL
coupling change, not a security fix, and would reopen a question §23.4 already settled.

Retirement condition: the asymmetry retires when EITHER clients/SOPs leave the vault for Postgres
(RLS becomes the boundary) OR a second caller of `assemble()` appears. The second disjunct is the
dangerous one, so it is enforced now rather than left to review.

**BINDING.** F52 is EXTENDED, not replaced, to assert `core/knowledge/index.ts` has exactly one path
into `assemble()` and that it is `currentVisibility()`. F52's existing assertions are
byte-preserved.

#### Ruling 5 — rows 5 and 11 close honestly; neither closes as PASSED

Both rows have a local half and a production half, and the two halves do not share a fate — see
§29.4 for the full table. The ruling is that row 11's production half is PARKED, not BLOCKED. §26.2
already drew this line: *"Nothing prevented these from running; they were withheld, and the manifest
says so rather than borrowing the word 'blocked.'"* The DIRECT-endpoint BLOCKED set (§26.3) is an
infrastructure fact; withholding row 11's production probe is a human decision, and calling it
BLOCKED would launder a choice as an obstacle.

**BINDING.** The read-only assertion at `production-2f-partner.test.ts:122` is split into a
re-runnable read-only gate, following the precedent `gate-2g1.ts` already records for
`production-2g2-invitations`. The provisioning half stays exactly as written and stays PARKED. The
split must not weaken either half.

### 29.4 Row-by-row disposition — §8's eleven rows

    row  what discharges it                                              evidence class
    ───  ─────────────────────────────────────────────────────────────  ───────────────────
    1    2G.4.2 — route matrix under a real, provisioned principal        PROVEN
    2    2G.4.3 — page matrix under a real, provisioned principal         PROVEN
    3    §23.6 (2G.1 slice 4) — index-scoping.test.ts, 11 tests;          PROVEN, predates 2G.4
         predates this stage and is not re-proven by it
    4    §23.2 — tests/api/search-boundary.test.ts; predates this         PROVEN, predates 2G.4
         stage and is not re-proven by it

    5    local        2G.4.1 (new) — PGlite 001–007, two orgs,            PROVEN (new, 2G.4.1)
                       SET LOCAL ROLE ascend_sales
         production   production-authorization.test.ts:156,168,180       PROVEN (existing)
                       (existing)

    6    route-side   2G.4.2 — a real users.disabled_at write, not a      PROVEN
                       stub-map mutation
         page-side    2G.4.3 measures the CURRENT outcome — denial        PROVEN, then the
                       via the generic error boundary — as fact           surface is RENAMED
                       before it is fixed (§23.1's method); 2G.4.5        by 2G.4.5
                       replaces the boundary with the named
                       AccountInactive surface

    7    2G.4.1 (strengthened: real disabled_at, real session) and        PROVEN
         2G.4.3 (page-side)
    8    §27.6 / §27.12 — F53, 18/18 local, both rollback directions;     PROVEN, predates 2G.4
         predates this stage and is not re-proven by it
    9    minimum length and hash stored: §27 (predates 2G.4). The         PROVEN (mixed)
         open half — plaintext never logged — closes in 2G.4.1, WITH
         A POSITIVE CONTROL (I10)
    10   page-isolation.test.ts, already proven against PROBE pages       PROVEN, BOUNDED
         with a two-role STUB resolver — the bound is named in §29.7
         and not closed by 2G.4

    11   local        2G.4.1 (new) — ascend_sales refused reading         PROVEN (new, 2G.4.1)
                       password_hash
         production   instrument split out of production-2f-partner,     PARKED — WITHHELD
                       re-runnable, awaiting authorization (§29.11, Q2)

Row 11's production entry reads **PARKED — WITHHELD**, never BLOCKED. Nothing about the network
prevents it running — the DIRECT-only IPv6 problem (§26.3) is a different set, and this probe would
answer through the pooler in the same 0.2s row 5's production half already does. What withholds it
is a decision, and §26.2 is the reason that distinction is preserved here rather than collapsed:
calling a withheld decision BLOCKED would launder a choice as an obstacle.

### 29.5 The RLS contradiction resolved

§8 row 5 says "cross-organization isolation — RLS returns zero rows." 2D.1's own provisioning
record (`core/db/provision.ts`, `production-app-login.test.ts`, `production-hardening.test.ts`) says
a query outside a principal binding ERRORS, because `ascend_app` holds no table grant of its own.
Both are true, of different acts:

    zero rows   a SELECT under a BOUND-BUT-FOREIGN principal — default-deny, not an error.
                `production-authorization.test.ts:168` is titled exactly that: "default deny, not
                an error."
    error       NO principal bound at all, or any cross-tenant WRITE — a different statement
                shape hitting a different policy branch, not a second description of the same
                event.

### 29.6 The six slices

Dependency-ordered, each independently closeable, each with its own stop.

    2G.4.1  the provisioned partner
            discharges: row 5 local · row 11 local · row 9's open half (plaintext never logged,
            WITH A POSITIVE CONTROL) · row 7 strengthened (real disabled_at, real session)
            production code changed: NONE

    2G.4.2  route matrix under resolved authority
            discharges: row 1 · row 6 route-side. Revocation is a real users.disabled_at write,
            not a stub-map mutation. ROUTE_MATRIX / ROUTE_IMPORTERS extracted to one module
            consumed by both the stubbed and the provisioned harness — see the DO-NOT-MIGRATE
            rule below.
            production code changed: NONE

    2G.4.3  page matrix under resolved authority
            discharges: row 2 · row 6 page-side · row 7. 29 pages × both roles, totality by
            set-equality against the filesystem. RECORDS the three admin pages' current outcome
            as MEASURED FACT — the defect is measured before it is fixed, §23.1's method.
            production code changed: NONE

    2G.4.4  the admin surface, and dashboard reclassified
            discharges: parked finding 1 (§29.2c, §29.8). FIRST SLICE THAT CHANGES PRODUCTION
            CODE. 2G.4.3's matrix flips three rows — a fix demonstrated by an instrument that
            predates it.

    2G.4.5  the named revocation surface
            discharges: parked finding 2 · row 6 page-side (the named form). AuthorityAnswer
            discriminant · AccountRefused · the exhaustive mapping · AccountInactive. Outage and
            unbound-resolver are still RETHROWN; route status codes are unchanged.

    2G.4.6  the gate and the accounting
            manifest entries + phases · the disposition list keyed off frozen PARKED_FINDINGS ·
            this row-by-row table · F52's extension.
            **BINDING: 2G.4.6 DOES NO FIXING.** §26.1 already drew the line this slice must not
            cross — the gate adds no behaviour, fixes no parked finding, touches no page. §26.4
            names tidying-while-assembling as the exact temptation this slice exists to resist.

**BINDING, carried forward from the architecture's own instruction:** `route-matrix`,
`f51-page-demand`, `page-denial` and `nav-boundary` measure DEMAND and DENIAL CLASSIFICATION, which
need no database, and are NOT migrated onto the provisioned harness. The two worlds coexist; the
shared derivation of `ROUTE_MATRIX` / `ROUTE_IMPORTERS` — exactly ONE definition — is what stops
them disagreeing.

### 29.7 Named bounds, recorded as facts rather than footnotes

- The in-process page matrix does not exercise `cookies()` or the `React.cache` memo — `pageAuthority`
  reads `cookies()`, which throws outside a request. Proven separately, and already, by
  `page-principal.test.ts` (22 refusal proofs) and `page-isolation.test.ts`.
- **Row 10 is proven against PROBE pages with a two-role stub resolver, not a database-resolved
  principal.** `page-isolation.test.ts` runs with the database environment deleted, so a PGlite
  instance in that suite cannot reach a spawned dev server. Closing this against a database-resolved
  principal needs a THIRD dev-server suite, and it was REJECTED rather than deferred by omission:
  §26.6 already measured that two dev-server suites need a lockfile over the shared `.next/dev`, and
  §26.7 already measured a dev server's compilation burst starving a database-bound neighbour by CPU.
  A third instance compounds both measured costs instead of retiring either. The bound is written
  down, not hidden behind a green row.

### 29.8 Parked-finding dispositions

**BINDING.** `PARKED_FINDINGS` (`tests/architecture/gate-2g1.ts:176`) is 2G.1's frozen snapshot of
what it closed with, and 2G.4 does not edit it. Editing it to say a finding is proven, or that it
covers a different scope than it did in 2G.1, rewrites history to match a later measurement — the
same provenance rule the parked-finding record already answers to elsewhere in this contract: the
parked record is history and stands, and a disposition is new evidence with its own witness. 2G.4
instead adds a disposition list keyed off the snapshot's six entries, and the gate that lands in
2G.4.6 asserts TOTALITY over it — every snapshot entry has a disposition, whether or not 2G.4 is the
stage that resolves it.

    finding                                          owner       disposition
    ────────────────────────────────────────────────  ──────────  ──────────────────────────────
    admin ×3 + dashboard renderable by sales           2G.4        SPLIT (§29.2c). The render/
      ("no data leaks" is the clause now known false)              route-guard half was always
                                                                    true; the client-identity /
                                                                    revenue-in-markup half
                                                                    discharges via 2G.4.4
    revoked membership reaches the error boundary,     2G.4        DISCHARGED by 2G.4.5
      not a named surface
    discoverClients/discoverSops read the vault        2G.4        DEFERRED — Ruling 4;
      directly — asymmetry, not an escape path                     retirement condition stated,
                                                                    boundary enforced NOW by F52
    invitation tokens hashed and single-use            2G.2        RETIRED — reclassified PROVEN
      (F53, reserved)                                              at 2G.2 closure (§27.12),
                                                                    18/18 local
    partner UI                                         2G.3        RETIRED — delivered, closed
                                                                    at §28.14
    Sheets intake                                      after 2G.4  STILL PARKED — out of scope
                                                                    (§29.9, item 7)

### 29.9 What 2G.4 will NOT cover

     1  production onboarding — no credential, no user, no membership written in production
     2  applying 007 to production — §28.15 stands
     3  row 11's production execution — instrument built, execution WITHHELD
     4  row 10 against a database-resolved principal — bounded in §29.7
     5  the cookie read and the React.cache memo in the page matrix — bounded in §29.7
     6  parked finding 3 — deferred, retirement condition stated, boundary enforced by F52
     7  Sheets intake — after 2G.4 closes
     8  §28.15's administrative-writer exclusion — a superset argument already made, not overlooked
     9  cross-process / worker-realm startup topology — carried forward from §26.9's NOT CLAIMED
    10  invitation revocation, email, new roles, multi-organization membership

### 29.10 Closure criterion — WRITTEN AS OPEN

**Not invented here.** §26.1 already built the mechanism this decision has to answer to: `gate-2g1`
fails closed when a suite classified PROVEN has its environment variable unset, refusing ten claims
on its first run rather than reading a filtered result as a pass. Rows 5, 7, 9 and 11's local halves
add PROVEN entries gated on `ASCEND_TEST_DATABASE_URL`; row 11's production half adds one gated on
whatever variable names its withheld probe. Either those variables are exported when 2G.4 closes, or
the gate reports red on them, and the closure criterion has to say in advance which of those two
states IS closure — not discover it by amendment afterward.

**The decision required (the architecture's Q1):** does 2G.4 close (a) with the db-phase
environment variables exported and the phased gate fully green, or (b) with a §28.12-style SINGLE
NAMED RED, the way 2G.3 closed on `gate-2g1`'s one permitted environment assertion?

This clause has been mis-authored twice already for the same underlying reason — §28.12's first
version demanded "full phased gate green" against a stage that was local-evidence-only by its own
proof obligations, and the amendment that fixed it introduced an unqualified "every suite that can
run locally passes" that then contradicted its own named exception, caught only by §28.14's closure
review. That is why this decision is being forced BEFORE implementation here, rather than risked a
third time at 2G.4's own closure.

**BINDING, per §28.14's own lesson: "a contract author is the worst reader of their own clause."**
The final wording of this criterion must be written by someone other than whoever wrote the rest of
this section, or it is not written at all. Nothing above is that wording — it is the shape the
decision takes and the trap it must not repeat.

### 29.11 Two further open decisions

**Q2 — authorize row 11's production probe?** One read-only, rollback-scoped pair against the
POOLER: `SET LOCAL ROLE ascend_sales; SELECT password_hash FROM users` — expecting `permission
denied`. No write, no credential, no schema touch. Retired the moment it is either authorized and
run, or explicitly declined and recorded as declined rather than left silent.

**Q3 — `admin/wipe`'s demo copy.** Move the target descriptions quoted in §29.2(c) behind the
`admin:*`-guarded reader Ruling 2 already requires (preserving the tool's honesty about what it
destroys), or DELETE the seeded-demo copy since the data it names is gone? A product call, not an
architectural one. **The disclosure itself is fixed either way by 2G.4.4's page conversion** — Q3
decides only whether the descriptions survive behind the guard or are removed, not whether they
keep leaking.
