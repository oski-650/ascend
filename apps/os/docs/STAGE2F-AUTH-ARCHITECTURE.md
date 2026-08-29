# Stage 2F — Authentication, Membership, Roles, and the Partner-Safe Sales Boundary

**Status: CONTRACT ONLY.** No code, no migrations, no database writes, no partner UI.
**Date:** 2026-08-28

This document is the thing to argue with. Nothing in it has been built.

---

## 1. The two approved decisions

**Decision 1 — extend Ascend's own session layer. Do not adopt Supabase Auth.**
Supabase remains Postgres infrastructure. F41 bans vendor SDKs across `core/`, and adopting
`@supabase/auth` would put the vendor on the critical path of every request — the precise coupling
Stage 2 spent its entire length avoiding. The cost is that password storage, credential rotation and
account recovery become ours to build. That cost is accepted.

**Decision 2 — `asPrincipal` stops accepting an authoritative role.**
The session authenticates a `user_id`. Authorization resolves `organization_id` and `role` from the
database. A forged or altered role claim has no authority because no code path reads one.

### The trust chain

```
credential
   → authenticated user_id          (signed session; the ONLY thing the session asserts)
   → organization membership        (database lookup, per request)
   → database-resolved role         (from memberships.role, never from the caller)
   → DB principal                   (ascend_owner | ascend_sales)
   → RLS + column grants            (the final, non-bypassable boundary)
```

Anything that skips a link is a defect, not a shortcut.

---

## 2. Measured current state

Not recalled — read from the running system today.

| | finding |
|---|---|
| session token | `v1.<expiryEpochMs>.<HMAC>` — **carries no identity and no role** |
| `verifySessionToken` | returns `boolean`, not a principal |
| credentials | **one shared password**, `ASCEND_OS_PASSWORD` |
| middleware | deny-by-default, small public list, **no role awareness** |
| API routes | **27**, including `/api/admin/wipe`, `/api/finance/invoices/*`, `/api/portal/invites` |
| `memberships.role` | `CHECK (role IN ('owner','sales'))` — **exists** |
| policies consulting `memberships.role` | **zero** |
| `membershipFor()` | defined, exported, **called only in tests** |
| `asPrincipal` production call sites | **3**, all inside `core/crm/prospect.ts` |

**Two consequences worth stating plainly.**

Today, anyone holding the one password has `/api/finance`, `/api/admin/wipe` and `/api/portal/invites`.
Giving your partner the password gives him all of it.

And the role passed to `asPrincipal` is trusted, not verified. A caller asserting `role: "owner"` for
any `user_id` receives owner privileges. `memberships` is currently **descriptive, not enforcing** —
a table that records intent nothing consults.

### The `asPrincipal` change is small

The breaking signature change was approved as a large one. It is not: **three call sites, one file**,
all inside the canonical reader. Every other consumer reaches prospects through `listProspects()` /
`getProspect()` and never names a principal — which is F43 paying for itself. Test call sites (6
files) update mechanically.

---

## 3. The constraint that shapes everything: only prospects are in Postgres

| entity | store |
|---|---|
| prospects, events | **Postgres** (Stage 2E) |
| clients, invoices, documents, time entries, contracts | **the vault** — `ASCEND_VAULT_PATH`, an iCloud folder on Oscar's Mac |

A deployed Ascend OS your partner reaches from his own computer **can serve prospects and nothing
else**, because the server has no vault. This is not a limitation to route around; it is the reason
the sales boundary is achievable now:

> The `sales` role is confined to exactly the entities that already live in the shared database.

The "NO ACCESS" list is therefore enforced twice over — by capability, and by those entities not
being in the shared store at all. That is a stronger position than a permission check alone, and it
must not be quietly weakened later by making the deployment read a vault.

**Prerequisite for the future:** extending any role to clients or finance in a deployed context
requires migrating those entities to Postgres first — a separate stage, not a 2F concern. Until
then, vault-backed routes must **fail closed with a clear error** in a deployment, never 500 and
never silently return empty results that read as "you have no clients".

---

## 4. Session format v2

```
v2.<userId>.<expiryEpochMs>.<base64url(HMAC-SHA256(secret, "v2.<userId>.<expiryEpochMs>"))>
```

- `user_id` is **inside the signed payload**. Tampering invalidates the signature.
- **`role` is absent by construction.** It is not "ignored" — there is no field to forge.
- **`organization_id` is absent.** Resolved from membership.
- v1 tokens are **rejected outright**, not upgraded. Every existing session ends at deploy; there is
  one operator and re-login is trivial. Accepting v1 would leave a token type in circulation that
  names no user.
- `verifySessionToken` returns `{ userId } | null`, not a boolean. A perimeter that answers "yes"
  without saying *who* is what produced this whole problem.

TTL stays 12 hours. Rotating `ASCEND_OS_SESSION_SECRET` still invalidates everything.

---

## 5. Per-user credentials

`ASCEND_OS_PASSWORD` (one shared secret) is replaced by per-user credentials.

**Migration 005** adds to `users`:

| column | purpose |
|---|---|
| `password_hash text` | KDF output; never the password |
| `password_algo text` | the algorithm actually used, so it can be rotated per user |
| `password_set_at timestamptz` | when this credential was established |
| `disabled_at timestamptz NULL` | immediate revocation without deleting the person |

**Constraint:** a user is either fully credentialled or has no credential —
`(password_hash IS NULL) = (password_set_at IS NULL)`. A half-set credential is the state where
"can this person log in?" has no answer.

**No grant on `password_hash` for any application role.** Login verification runs as a dedicated
path, not as `ascend_sales`. Neither role may read or write credential material — the same posture
as `schema_migrations`.

**Hashing.** Password verification happens only in `/api/auth/login`, a **Node** route, so it is not
constrained to Edge crypto and can use a memory-hard KDF (scrypt via `node:crypto`). Middleware never
hashes anything — it only verifies an HMAC, which stays Edge-compatible. Keeping those two runtimes
distinct is what allows a strong KDF without breaking the perimeter.

Login must fail identically for unknown user, wrong password, and disabled account — same message,
same timing — so it cannot be used to enumerate who exists.

---

## 6. Role resolution

New, and the heart of 2F:

```
resolvePrincipal(db, userId) → { organizationId, role, userId } | null
```

- reads `memberships` joined to `users` for that `user_id`
- returns `null` if: no membership · user `disabled_at` is set · zero memberships
- **runs per request.** Revoking a membership takes effect on the next request with no session
  invalidation, because the session never carried the role.
- multi-organization membership is **out of scope**; if a user has more than one, resolution
  **fails closed** rather than picking one. The design must not preclude adding explicit
  organization selection later.

`asPrincipal` then takes what resolution produced. Its `DbPrincipal` union loses the caller-supplied
role for human principals. `automation` remains — it is not a human, has no session, and is invoked
only by server-side jobs.

---

## 7. Authentication and authorization are different layers

| layer | runtime | answers | can reach the database |
|---|---|---|---|
| middleware | Edge | *is this a valid session, and for whom?* | **no** |
| route handler | Node | *may this principal do this?* | yes |

Middleware verifies the signature and expiry and extracts `user_id`. It does **not** authorize —
it cannot, having no database access.

Every protected route handler begins with:

```
requirePrincipal(request, capability) → Principal   |   throws 403
```

**This is the security boundary, and UI navigation is not.** Hiding `/finance` from the partner's
menu is UX. A `sales` principal issuing `GET /api/finance/invoices` by hand must receive **403**.

**The forgetting problem.** A new route that omits `requirePrincipal` is authenticated but
unauthorized — the failure mode is silent. Mitigated by a fitness rule (§10), not by discipline.

---

## 8. Route → capability map

Capabilities, not roles, so a future role is defined by composition rather than by editing 27 routes.

**Deny by default: any capability not listed for a role is denied.**

| capability | owner | sales |
|---|---|---|
| `prospects:read` | ✅ | ✅ |
| `prospects:write` (notes, contacts, status, follow-ups) | ✅ | ✅ |
| `prospects:identity` (slug, `prospect_id`, `identity_state`, `hold_reason`) | ✅ | ❌ |
| `pipeline:read` / `pipeline:write` | ✅ | ✅ |
| `clients:*` | ✅ | ❌ |
| `finance:*` | ✅ | ❌ |
| `documents:*` | ✅ | ❌ |
| `time:*` | ✅ | ❌ |
| `portal:admin` (mint client invites) | ✅ | ❌ |
| `admin:*` (incl. `/api/admin/wipe`) | ✅ | ❌ |
| `production:toggle` | ✅ | ❌ |
| `audits:*` | ✅ | ❌ |
| `import:run` | ✅ | ❌ |
| `promote` (prospect → client) | ✅ | ❌ |

Applied to **every one of the 27 route files** — enumerated, not grouped. F49 requires totality, and
a grouped map (`/api/time/*`) is exactly the implicit default it forbids: the first draft of this
section covered 27 routes in 16 rows, and its own rule caught it.

`backing` marks where the data lives. Every row marked **vault ⚠️** must have its sales-denial test
run twice under F49 — once with the vault absent, once with it present — because today those routes
return nothing for a reason that is not authorization.

| route | capability | sales | backing |
|---|---|:---:|---|
| `/api/admin/wipe` | admin:* | ❌ | vault ⚠️ |
| `/api/audits` | audits:* | ❌ | vault ⚠️ |
| `/api/audits/run` | audits:* | ❌ | vault ⚠️ |
| `/api/auth/login` | — public (credential) | — | — |
| `/api/auth/logout` | — public | — | — |
| `/api/automations/dismiss` | pipeline:write | ✅ | vault ⚠️ |
| `/api/console/search` | search — results scoped per capability (§9) | ⚠️ | vault ⚠️ |
| `/api/documents/[id]` | documents:* | ❌ | vault ⚠️ |
| `/api/documents/[id]/version` | documents:* | ❌ | vault ⚠️ |
| `/api/documents` | documents:* | ❌ | vault ⚠️ |
| `/api/finance/invoices/[id]` | finance:* | ❌ | vault ⚠️ |
| `/api/finance/invoices` | finance:* | ❌ | vault ⚠️ |
| `/api/import/prospects` | import:run | ❌ | Postgres |
| `/api/portal/approval-requests` | portal:admin | ❌ | vault ⚠️ |
| `/api/portal/approvals` | — portal token | — | vault ⚠️ |
| `/api/portal/invites` | portal:admin | ❌ | vault ⚠️ |
| `/api/portal/me` | — portal token | — | vault ⚠️ |
| `/api/portal/submissions` | — portal token | — | vault ⚠️ |
| `/api/production/toggle` | production:toggle | ❌ | vault ⚠️ |
| `/api/prospects/[slug]/promote` | promote | ❌ | both |
| `/api/prospects/[slug]` | prospects:read / prospects:write | ✅ | Postgres |
| `/api/prospects/from-url` | prospects:write | ✅ | Postgres |
| `/api/time/active` | time:* | ❌ | vault ⚠️ |
| `/api/time/log` | time:* | ❌ | vault ⚠️ |
| `/api/time/start` | time:* | ❌ | vault ⚠️ |
| `/api/time/stop` | time:* | ❌ | vault ⚠️ |
| `/api/time/summary` | time:* | ❌ | vault ⚠️ |

`prospects:identity` deserves emphasis: the column grants **already** prevent `ascend_sales` from
writing `slug`, `source`, `website`, `website_quality`, `prospect_id`, `identity_state` or
`hold_reason`. The capability layer states the same rule at the route; the database enforces it
regardless. Two independent barriers, and the database one cannot be bypassed by a bug in the first.

---

## 9. Search is the leak nobody expects

`/api/console/search` and `buildKnowledgeIndex()` traverse **every entity** — clients, invoices,
documents, prospects — and return titles and text excerpts. A capability check on the *route* is not
enough: a `sales` principal must not receive client or finance results in the response body.

**Requirement:** search results are filtered by capability **at the point of assembly**, not at the
route boundary, and the contract requires a test that a `sales` search for a known client name
returns nothing.

Today this is masked by the vault being absent from any deployment, which is luck rather than
design. It must be closed explicitly.

---

## 10. Invariants that must not weaken

Carried forward, non-negotiable:

- **RLS stays enabled and FORCED** on every table. Capabilities are an additional layer, never a
  replacement.
- **`ascend_app` keeps no ambient privilege** — no direct grants, `NOINHERIT`, no `BYPASSRLS`.
- **A hold is a write barrier, not an information barrier.** `sales` must still *see* held prospects
  — the matcher depends on it — while being unable to modify or release them.
- **The event spine stays append-only.** Nothing in 2F may grant `UPDATE`/`DELETE` on `events`.
- **Operator events keep naming their human.** `actor_user_id` now has a real per-user meaning, which
  makes §19's adoption metric genuinely per-person for the first time. It must not be widened.
- **F41** — no vendor SDK in `core/`. Decision 1 exists to preserve this.
- **F43** — one canonical prospect reader; no consumer bypasses it.

### Proposed new fitness rules

- **F46 — every API route authorizes.** Every `app/api/**/route.ts` must reference
  `requirePrincipal`, with a named exemption list (`/api/auth/*`, portal token routes). Closes the
  forgetting problem structurally.
- **F47 — the session never carries a role.** No source file may read `role` or `organization_id`
  from a session/JWT/cookie payload. Mutation-tested: adding such a read must fail the suite.
- **F48 — credentials are never granted to application roles.** No migration may `GRANT` on
  `users.password_hash` to `ascend_owner`, `ascend_sales` or `ascend_automation`.

- **F49 — no authorization-by-absence.** A route may not be considered safe because its data does
  not currently live in Postgres. Enforced two ways, because the principle alone is untestable:

  1. **Total coverage.** The route→capability map must name **every** `app/api/**/route.ts`. A route
     with no entry fails the suite. There is no "n/a", no "no data yet", and no implicit default —
     an unmapped route is an error, not an allow.
  2. **Denial must be independent of the vault.** For every vault-backed route denied to `sales`,
     the denial test runs **twice**: once with `ASCEND_VAULT_PATH` absent, and once with the real
     vault present. Both must return **403**. A route that only "denies" because the data is missing
     passes the first run and fails the second, which is precisely the defect this rule names.

  **Why it exists.** Today `sales → /api/finance` returns nothing because the server has no vault.
  That reads like security and is not. When finance is eventually migrated to Postgres, the same
  route would begin returning everything unless someone remembered to add authorization. F49 forces
  the boundary to be written **before** the data exists, so the future migration cannot silently
  open a door — it makes "we never authorized this route" a failing test today rather than an
  incident later.


---

## 11. Threat model — required tests

Each must be an executable test that **demonstrates the denial**, not an assertion that a check
exists. Where practical, mutation-tested: remove the control, confirm the attack succeeds.

| # | attack | required outcome |
|---|---|---|
| 1 | session tampered to add `role: "owner"` | signature invalid → 401; and no code reads the field |
| 2 | valid sales session, forged `user_id` in payload | signature invalid → 401 |
| 3 | valid sales session, forged `organization_id` | **no effect** — org comes from membership |
| 4 | sales requests `/api/finance/invoices` directly | **403**, not a redirect, not an empty 200 |
| 5 | sales requests `/api/admin/wipe` directly | **403** |
| 6 | sales requests `/api/portal/invites` (mints client tokens) | **403** |
| 7 | sales attempts to release a held prospect | 0 rows affected **and** 403 at the route |
| 8 | sales attempts to write `prospect_id` / `identity_state` / `slug` | permission denied at the column grant |
| 9 | user with **no membership** | `resolvePrincipal` → null → 401 |
| 10 | membership **revoked mid-session** | next request denied; no session invalidation needed |
| 11 | user `disabled_at` set | denied even with a valid unexpired session |
| 12 | expired session | 401 |
| 13 | session signed with a **different secret** | 401 |
| 14 | cross-organization read attempt | RLS returns zero rows |
| 15 | sales searches for a known client name | **no client/finance results in the body** |
| 16 | `ASCEND_OS_SESSION_SECRET` unset | perimeter **fails closed** (deny), never open |
| 17 | login as unknown user vs wrong password | indistinguishable response and timing |

Tests 4–6 must issue **real HTTP requests to the route handlers**, not unit-test a helper. The claim
is about what the server does when someone types a URL.

---

## 12. Decisions — RESOLVED 2026-08-28

All six were decided by the owner. None remain open.

| # | decision | outcome |
|---|---|---|
| 1 | `/api/audits/*` | **owner-only.** An internal control and oversight surface, not a sales need. |
| 2 | `/api/time/*` | **owner-only.** |
| 3 | `promote` (prospect → client) | **owner-only.** The partner is a sales operator, not a second owner. |
| 4 | partner account creation | owner invites; partner sets their own password via a single-use token. No self-service signup. |
| 5 | password reset | owner-initiated only. No email infrastructure is introduced. |
| 6 | `ASCEND_OS_PASSWORD` | **REMOVED COMPLETELY.** Not deprecated, not a fallback, not temporarily supported. Once 2F lands the old shared password is invalid. |

### The initial matrix, as approved

| capability | owner | sales |
|---|:---:|:---:|
| prospects (read/write) · pipeline · notes · contacts · outreach · assignments | ✅ | ✅ |
| identity fields · release holds | ✅ | ❌ |
| search | filtered | **filtered** |
| finance · documents · portal · admin · time · promote · audits | ✅ | ❌ |

> **Sales access is determined by database membership, never by what the client or session claims.**

## 13. Out of scope

Sheets intake · bulk import · automated research · scoring changes · outreach · **partner UI** ·
new prospect creation · multi-organization membership · email · self-service signup · SSO/MFA.

**Migrating clients, finance, documents or time to Postgres is explicitly NOT part of 2F**, and not
merely deferred for effort. The current split is a useful property to keep while the multi-user
system is built:

```
                 Ascend OS
                     │
              ┌──────┴──────┐
            OWNER          SALES
              │             │
       Private OS      Shared sales
        domains          substrate
              │             │
        Vault (owner)     Postgres
```

Making those domains collaborative is a separate migration with its own consumer-parity and identity
gates, exactly as prospects had. Doing it inside 2F "so the permissions feel complete" would trade a
clean boundary for a tidy-looking table.

---

## 14. Implementation sequence — AGREED

Each step is a gate, verified before the next begins.

| # | step | note |
|---|---|---|
| 1 | **Verify the off-machine backup** — all 6 manifest files report `OK` | human action; blocks everything |
| 2 | **Fresh pre-flight production backup** | before any 2F production mutation |
| 3 | **Migration 005** — credential columns only | no behaviour change |
| 4 | **`resolvePrincipal(db, userId)`** | membership becomes the role authority |
| 5 | **Update the 3 `asPrincipal` call sites** | no surface change |
| 6 | **Session v2** — signed `user_id`, no role claim; shared-password auth removed | v1 rejected outright |
| 7 | **Authorization + F46–F48** — every route explicitly authorized | credentials never reach application roles |
| 8 | **Search scoping** — filter at assembly, not at the route | its own gate; see below |
| 9 | **F49 full coverage** — 27/27 mapped, vault-backed denial proven vault-present | |
| 10 | **Production multi-user verification** — owner + sales fixtures, escalation, revocation, cross-org | |
| 11 | **Final backup + gate report** | |
| 12 | **STOP.** Do not begin 2G | |

The backup moved to the front because the previous draft listed it last while saying "before any of
this touches production" — self-contradictory as an ordered list.

### Step 8 is not "sales gets 403 on search"

`/api/console/search` **must not** return 403 to `sales`. Sales needs search to do the job — finding
a prospect by name is the core of the surface. A flat denial would be a broken product, and it would
also hide the real defect rather than fix it.

The requirement is that a **successful, 200** sales search returns a result set that respects the
capability boundary:

| principal | route | body must contain | body must NOT contain |
|---|---|---|---|
| owner | `/api/console/search?q=…` | prospects, clients, invoices, documents | — |
| sales | `/api/console/search?q=…` | prospects only | any client, invoice, document or time entry |

The test that matters is therefore a **passing** search, not a denial: search a term that appears in
both a prospect and a client, as `sales`, and assert the client is absent from the response body.
Run with the vault **populated** — with it absent the test passes for the wrong reason (F49).

This is a data-boundary requirement. A correctly authorized route can still leak through its result
construction, because `buildKnowledgeIndex()` traverses every entity by design.

### Target end state

**Owner** — full existing access; role resolved from membership; finance, admin, portal, documents,
time, audits, promote, import.

**Sales** — the shared prospect/sales surface; only the columns `ascend_sales` is granted; cannot
alter identity, release holds, or claim judgment authority; no vault-backed private data; **cannot
discover client or finance information through search**; cannot escalate to owner.

**System** — no `ASCEND_OS_PASSWORD`; no role in the session; no role accepted as caller authority;
no RLS bypass by the application login; no vault fallback while Postgres is authoritative; no
unscoped search leakage; every route mapped and authorization-tested.

**Not started.** Awaiting confirmation that the off-machine copy verifies.

---

## 15. Steps 1–6/7 COMPLETE — state at handoff (2026-08-28)

| | |
|---|---|
| tests | **910 passed / 47 skipped** |
| fitness | **152** (F1–F45) |
| tsc · lint · build | clean · 0 errors · succeeds |
| production | 6 prospects · 4 anchored / 2 held · 41 events · 0 births |
| vault | byte-identical — 66 files, `6fabd12149aff3fa…` |
| migration ledger | `005_user_credentials.sql` |
| pre-2F backup | `ascend-backup-20260828T233207Z-pre-2f.tar.gz`, sha256 `90ffe9efae9c3990f8dfd9c878274f85f40bee5ba1402bcfcf836f93b7c331c7` |

**Delivered:** migration 005 (credential columns; the table-level `GRANT SELECT` on `users` replaced
with column grants, which would otherwise have exposed `password_hash` to `ascend_sales` the moment
it existed) · `ascend_auth` role · `resolvePrincipal` · **`ResolvedPrincipal` branded** so a role
claim is inexpressible rather than merely rejected · session v2 (`v2.<userId>.<expiry>.<HMAC>`, v1
rejected) · scrypt per-user credentials · owner credential provisioned and proven end-to-end
BEFORE removal · **`ASCEND_OS_PASSWORD` removed completely**.

**Known open gap, deliberate:** the prospect binding is NOT registered at startup. It takes a
`{ client, principal }` pair, and a startup principal would be one ambient identity every request
inherits. `instrumentation.ts` registers the auth binding only and *cannot* construct a principal —
the brand prevents it. Prospect reads therefore fail closed until Step 7 lands. That is the correct
state for a half-finished migration, but the UI will not show prospects until then.

---

## 16. Step 7 — DECISION B: request-scoped `AsyncLocalStorage`

Measured before deciding: **13 direct consumers** of `listProspects()`/`getProspect()`, none
receiving request context, each transitively imported by 2–4 more. Threading a principal explicitly
would touch ~25–30 files and push authentication into `lib/forecast`, `lib/opportunities` and
`mission-control/pipeline` — pure derivation modules whose architectural purpose (F2) is not knowing
about I/O. **Rejected on those grounds**, not on effort.

### The distinction the implementation must preserve

> **`AsyncLocalStorage` is the request CONTEXT. `ResolvedPrincipal` is the AUTHORITY.**
> The former may carry the latter. It may never create or modify it.

```
signed session → userId → resolvePrincipal() → ResolvedPrincipal
      → AsyncLocalStorage.run(principal) → request → route capability
      → core/crm → Postgres RLS + column grants
```

Identity is implicit in PROPAGATION and explicit at the TRUST BOUNDARY. A process-global mutable
principal — the thing the "no ambient state" rule targets — is one slot shared by every request,
where a leak is a race. An `AsyncLocalStorage` store is unreachable from any other request; the
isolation is structural, the same shape as `SET LOCAL` in Postgres.

### Non-negotiable properties

- The store holds a **resolved** principal, never a role or user taken from a request value.
- `requirePrincipal()` is the only way to establish context: verify v2 session → `userId` →
  resolve membership → run.
- `listProspects()` / `getProspect()` keep their signatures; derivation modules stay auth-unaware.
- **Fail closed:** reading prospects outside a request context THROWS. No vault fallback, no
  default principal, no inference from headers, query, body, session claims or environment.
- **No module-level mutable principal and no `setPrincipal()`** — with a fitness rule rejecting it.
- Nested async inherits correctly; concurrent requests keep independent principals.
- The `{ client, principal }` binding is request-scoped. `SET LOCAL` remains the database mechanism.

### Required concurrency proof

Not two sequential requests. **Deliberately interleaved** owner/sales requests including real
database operations and prospect reads, proving owner→owner, sales→sales, owner→owner with no
crossover, plus pooled-connection reuse after each.

### Then, and only then

The complete 27-route matrix from §8: exactly one capability per route, unmapped routes fail the
suite, default deny, authority exclusively from `ResolvedPrincipal`.

**Do not weaken an existing fitness rule to make the implementation pass.** If a rule catches a
design flaw, stop and fix the design.

**STOP after Step 7.** Not search scoping, F46–F49, partner provisioning, invite UI, 2G, or Sheets.

---

## 17. Step 7 preconditions — CHECK THESE FIRST

### 1. Direct-endpoint reachability — BLOCKING

Supabase's direct endpoint `db.<ref>.supabase.co` has **no A record**. It is IPv6-only; IPv4 is a
paid add-on. The pooler is IPv4 and unaffected.

**THE AUTHORITATIVE TEST IS A REAL DATABASE CONNECTION.** Nothing else.

    PGSSLMODE=verify-full PGSSLROOTCERT=~/AscendBackups/ca/supabase-root-2021.crt \
    PGCONNECT_TIMEOUT=15 psql "$ASCEND_DATABASE_URL_DIRECT" -Atc \
      "SELECT inet_server_addr() || ' TLS=' || (SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid())"

Success looks like an IPv6 address and `TLSv1.3`. That single command exercises DNS, IPv6 routing,
TCP, TLS and certificate verification — every layer the migration and backup paths actually depend
on — and it cannot be satisfied by anything short of a working connection.

#### Do NOT infer reachability from `ping6`

Recorded because this exact mistake was made on 2026-08-28 and cost real time.

`ping6` to a public address reported UNREACHABLE while `nc -6` to the direct endpoint on 5432
reported REACHABLE, and a real `psql` connection then succeeded over IPv6 with TLS 1.3. The network
blocks **ICMPv6** while passing **TCP** — a common configuration. `ping6` was therefore measuring a
protocol the database does not use, and its answer was not merely unhelpful but actively wrong.

The general rule, worth keeping past this stage: **a diagnostic that does not exercise the failing
path is not evidence about the failing path.** The earlier conclusion ("IPv6 egress is down") was
drawn from ICMP and was false; the transient failure that prompted it was real but had already
cleared.

`nc -z -6 <host> 5432` is a reasonable cheap pre-check. It is not sufficient — it proves TCP reaches
the port, not that TLS negotiates or that the certificate verifies.

**If the `psql` test fails, STOP and report. Do not:**

- substitute the pooler for migrations — DDL under a transaction pooler is not reliably
  session-consistent, which is why the runbook specifies direct;
- alter the migration or backup path to route around it;
- weaken any TLS requirement to get connected.

This is not incidental infrastructure. The direct connection is the verified migration path AND the
backup path — `scripts/backup-production.sh` uses it. On the Free plan there is no PITR, so an
unreachable direct endpoint means **no new recovery points can be taken**. Resolve it before the
system advances; do not work around it to keep moving.

### 2. Repository state

    git log --oneline -1        # expect 5b9af09 (or the doc amendment on top of it)
    git status --porcelain      # expect clean

### 3. Test baseline

Establish it BEFORE changing code, so a Step 7 regression is distinguishable from a pre-existing
environmental failure. With the direct endpoint reachable, the baseline is **910 passed / 47
skipped**, fitness 152, tsc/lint/build clean.

### Order of work

1. verify IPv6 → 2. verify repo state → 3. establish the ALS request-context boundary →
4. `ResolvedPrincipal` stays the only authority; ALS may only CARRY it → 5. per-request prospect
binding, never global → 6. `requirePrincipal` → 7. the 27-route matrix → 8. sales search scoping at
assembly → 9. F46–F49 → 10. interleaved owner/sales concurrency proof → 11. full per-route
authorization suite → 12. gate report.

> **`AsyncLocalStorage` = request context. `ResolvedPrincipal` = authority.
> Database membership = source of truth. ALS must never become a second authority system.**

---

## 18. STEP 7 BASELINE — captured 2026-08-29, before any Step 7 code

Recorded so a Step 7 regression is distinguishable from a pre-existing or environmental failure.
Captured at `97ae49a`, clean working tree, **no code modified during capture**.

| | |
|---|---|
| HEAD | `97ae49a` |
| working tree | clean |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| **full suite** | **46 files passed · 910 passed · 47 skipped · 957 total** |
| architecture fitness | **152** (F1–F45) |
| second run (stability) | 46 files passed · 905 passed · 52 skipped |

**The 910 vs 905 difference is not a flake.** It is exactly the five `restore-independence` tests,
which skip when `ASCEND_BACKUP_SQL` is unset. Both runs had zero failures. To reproduce 910, export:

    ASCEND_TEST_DATABASE_URL=$ASCEND_DATABASE_URL_ADMIN_POOLED
    ASCEND_BACKUP_SQL=~/AscendBackups/20260829T010319Z-pre-step7/ascend-public-20260829T010319Z-pre-step7-portable.sql

The 47 skips are the one-shot mutation gates (`ASCEND_MIGRATE_DATABASE_URL`,
`ASCEND_MIGRATE_PROSPECTS_URL`, `ASCEND_HARDEN_DATABASE_URL`). They are deliberately unset: each
writes schema or credentials to production and none belongs in a baseline. **Do not set them during
Step 7.**

### Production state at baseline — unchanged by the run

    prospects 6   anchored 4   held 2
    events   41   births 0
    ledger   005_user_credentials.sql

### Recovery point in force

    ascend-backup-20260829T010319Z-pre-step7.tar.gz
    sha256 4112e5bff88ab3c090edbf7ad98d8e33a69b55db29997d3bf53782001d2ff2c8

Verified off-machine, restorable into vanilla PostgreSQL (6/6), credential scan clean, carrying
6 prospects · 41 events · 4 anchored ids · 6 sets of operator notes.

**Step 7 may now begin.** Any deviation from the numbers above is a Step 7 effect and must be
explained, not absorbed.

---

## 19. STEP 7 — execution plan

Start from `1c6eab2` · baseline **910 passed / 47 skipped / fitness 152** (§18).

### 7.1 Hygiene, committed separately

`docs/stage2e/consumer-parity.json` rewrites `verifiedAt` on every suite run, dirtying the working
tree each time. Stop writing the timestamp, or write the artifact somewhere gitignored — that file
records the 2E verification, not whenever someone last ran tests. Re-establish the baseline
afterwards and confirm the counts are unchanged.

### 7.2 The request-context boundary

Request-scoped `AsyncLocalStorage`; per-request `ResolvedPrincipal`; per-request prospect DB
binding; `requirePrincipal`. **No module-level principal state anywhere.**

### 7.3 THE CRITICAL GATE — the concurrency proof

Not one test. **Three properties, in order**, and the middle one is what makes the other two mean
anything:

1. **Real overlap.** Prove owner and sales requests are genuinely in flight simultaneously, using
   explicit synchronisation or barriers — *not* by assuming `Promise.all()` produces meaningful
   interleaving. If the awaits happen to serialise, or the pool hands out one connection at a time,
   nothing overlapped and the test measures nothing.
2. **Mutation sensitivity.** Replace the request-scoped store with a module-level principal and
   confirm the test **fails with observable cross-request authorization**. A security test that
   cannot detect removal of the security mechanism is not a security test.
3. **Correct implementation.** Restore `AsyncLocalStorage` and prove repeated interleaved
   owner/sales requests produce **zero crossover** — against the real application path, not an
   isolated mock.

> the requests overlap → the broken architecture demonstrably leaks → the intended architecture
> prevents the leak

**This is the vacuity trap that has already bitten this project three times**: a Stage 1 gate
comparing `[]` to `[]`; a 2C filter on `.type` where the shape had `.entity`, matching nothing; a
parity ledger that omitted `body` and reported success while dropping it. Each passed while proving
nothing. Assume this test is vacuous until a mutation proves otherwise.

**If 7.3 fails, STOP and fix the context boundary before touching the route matrix further.**

### 7.4 Then, in the contract's order

27-route authorization matrix (§8) → search-result scoping at assembly (§9) → F46–F49 (§10) →
partner provisioning, server-side only → full security suite (§11) → final gate report.

Do not let the route work grow organically ahead of 7.3.

### Governing invariant

> **ALS carries context. `ResolvedPrincipal` carries authority. `memberships.role` determines
> authority. Postgres enforces the boundary.**

The ALS store must never hold an independently supplied role or organization — only the
already-resolved authority for that request.

**No UI. No Sheets. No expansion of the data boundary.**
