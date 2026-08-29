# Stage 2D — Connection Security Gate Report

**Date:** 2026-08-28
**Scope:** Fix Findings 1 and 2, then run the pooled-principal isolation suite against the real
Supabase transaction pooler.
**Outcome:** **PASS.** No migrations run. No prospects migrated. `ASCEND_PROSPECT_SOURCE` unset.

---

## 1. What was wrong

### Finding 1 — the TLS gate measured the wrong hop

`tests/db/pooled-principal.test.ts` asserted:

```sql
SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()   →   expect(ssl).toBe(true)
```

Through Supavisor, `pg_stat_ssl` describes the **pooler → Postgres** hop, which is internal to the
provider. It says nothing about the **client → pooler** hop, which is the one crossing the public
internet carrying our credentials.

Measured on the live database, in a single run:

| endpoint | client socket | `pg_stat_ssl` |
|---|---|---|
| direct (5432) | TLSv1.3 / TLS_AES_256_GCM_SHA384 | `true` |
| pooler (6543) | TLSv1.3 / TLS_AES_256_GCM_SHA384 | **`false`** |

Both sessions are fully encrypted. The gate would have **failed against the pooler for a bogus
reason** — and, worse, could have **passed a plaintext client link** had the provider's internal hop
been encrypted. It did not measure the property it claimed to.

### Finding 2 — plaintext accepted, and certificates unverified

Two separate results, both confirmed against both endpoints:

- **The server accepts plaintext.** Connecting with `ssl: false` succeeded. Supabase does not refuse
  unencrypted sessions, so a connection that merely omits TLS configuration does not fail — it
  succeeds, shipping the password and the whole commercial record in the clear.
- **`rejectUnauthorized: true` failed** with `SELF_SIGNED_CERT_IN_CHAIN`. Both endpoints chain to
  `Supabase Root 2021 CA`, a private self-signed root deliberately absent from public trust stores.

The usual unblock, `rejectUnauthorized: false`, keeps the ciphersuite and discards what the
ciphersuite is *for*: the session becomes confidential **to whoever answered**. That was not taken.

---

## 2. How the trust anchor was obtained

Taking the root from the database connection would be trust-on-first-use — an already-intercepted
connection would have taught us the attacker's root. It was obtained over an **independent trust
path** and only then compared with the wire.

| source | channel | SHA-256 |
|---|---|---|
| `supabase/cli` (official repo) | public web PKI via GitHub | `80:70:25:AD:…:CA:FA` |
| `estuary/flow` (unrelated repo) | public web PKI via GitHub | `80:70:25:AD:…:CA:FA` |
| direct + pooler endpoints | the Postgres connections themselves | `80:70:25:AD:…:CA:FA` |

All three agree. A forged anchor would have required compromising both the public web PKI and the
database connection simultaneously.

**CA verification, not leaf pinning.** The direct endpoint's leaf certificate was reissued on
2026-08-28, mid-investigation — exactly the event that breaks a leaf pin and tempts someone to
disable verification to get unblocked. Pinning the root survives rotation, so the secure path stays
the convenient one.

---

## 3. What was built

| file | purpose |
|---|---|
| `core/db/tls.ts` | The pinned root, its declared SHA-256, and a load-time integrity check. `verifiedTlsOptions()` takes **no arguments** — there is no parameter that weakens it. Refuses to run under `NODE_TLS_REJECT_UNAUTHORIZED`. |
| `core/db/pool.ts` | The only way the system opens a connection. Parses the URL itself, passes discrete fields, supplies `ssl` as the sole source of TLS truth. `assertVerifiedTls()` checks the socket on **every checkout**, not once at boot. |
| `tests/architecture/fitness.test.ts` | **F44**, pinning all of the above against regression. |

### The subtle one: `connectionString` is refused

The obvious implementation is `new Pool({ connectionString, ssl: verifiedTlsOptions() })`. It is
wrong and it **fails open**. In `pg/lib/connection-parameters.js:60`:

```js
config = Object.assign({}, config, parse(config.connectionString))
```

The parsed URL is assigned **over** the explicit config, and `pg-connection-string` turns `sslmode`
into precisely what this work exists to prevent — `sslmode=require` sets `rejectUnauthorized =
false`; `verify-ca` installs `checkServerIdentity = function () {}`, disabling hostname checking.

So a URL ending `?sslmode=require` — the string most likely to be pasted from a dashboard — would
**silently discard the pinned CA**, while the code still read as though it verified certificates.
The fix is structural: this module never hands `pg` a connection string, and rejects URLs carrying
any SSL parameter rather than merging them.

---

## 4. A defect the gate uncovered: the schema was unusable on managed Postgres

Running the suite for the first time against a real server failed with
`permission denied to set role "ascend_owner"`.

**Cause.** On PostgreSQL 16+, a role with `CREATEROLE` that creates a role receives `admin_option =
true` but **`set_option = false`** — it may administer the role and may not assume it. Supabase's
`postgres` is not a superuser (`rolsuper = false`, `rolcreaterole = true`), so every
`SET LOCAL ROLE` in `asPrincipal` failed.

**Why nothing caught it.** PGlite runs as a superuser, and superusers may assume any role
unconditionally. The entire Stage 2A/2B suite passed while the schema's authorization model was
**inert on any managed Postgres**. It surfaced the first time these roles met a non-superuser login.

**Fix** (`core/db/schema/001_substrate.sql`, alongside role creation):

```sql
GRANT ascend_owner, ascend_sales, ascend_automation TO <login> WITH INHERIT FALSE, SET TRUE
```

`INHERIT FALSE` keeps authority deliberate — the login role acquires these privileges only by
assuming the role inside `asPrincipal`, never passively on a bare connection. A plain `GRANT` also
restores `SET ROLE`, but sets `inherit_option = true`, which would hand every unwrapped connection
`ascend_owner`'s rights and quietly contradict this suite's "a released connection carries no
principal" claim. Version-guarded, since `WITH … SET` is PostgreSQL 16+.

This edits a migration that **has not been applied anywhere** — production `public` is still empty.

---

## 5. A second trap in the harness

The suite isolated itself with `SET search_path TO ascend_pool_test` on the setup connection.
Measured against Supavisor, **that works** — session state does persist on a checked-out client —
which is exactly why it must not be used: the suite would rest on session persistence through a
pooler, the very property it exists to prove absent. A miss would have created its tables in
`public` **on the production database**.

Replaced with `options: "-c search_path=ascend_pool_test"`, which travels in the startup packet, so
every connection begins in the test schema regardless of pooling behaviour. Verified to pass through
Supavisor.

The suite also needed `GRANT USAGE ON SCHEMA` — production does not, because its tables live in
`public`, where `USAGE` is granted to `PUBLIC` by default. Postgres reports the shortfall as
`relation "prospects" does not exist`, not as a permission error.

---

## 6. Results — 13/13 against the live Supabase pooler

```
✓ SEQUENTIAL REUSE: request B does not inherit request A's principal
✓ AFTER RELEASE: the connection carries NO principal at all
✓ CONCURRENT: interleaved requests keep their own identity
✓ ROW VISIBILITY follows the request, not the connection
✓ A FAILED REQUEST returns a CLEAN connection to the pool
✓ A ROLLED-BACK write leaves nothing, and leaks no identity
✓ A MISSING principal is refused, not defaulted
✓ AN UNKNOWN organization sees nothing — default deny, not an error
✓ TLS: the CLIENT SOCKET is encrypted — not pg_stat_ssl, which measures the wrong hop
✓ TLS: the server is AUTHENTICATED against the pinned Supabase root, not merely encrypted
✓ TLS: verification is CONFIGURED, not inherited — a weakened config would be refused
✓ TLS: the server ACCEPTS PLAINTEXT — so enforcement is ours, and this proves it is not the server's
✓ guard: announces loudly when the real-database gate has NOT run
```

Run with `max: 1`, forcing every request onto one physical connection, through the production pool
factory — so the suite certifies the connection path the application will actually use. The suite's
local copy of the `SqlClient` adapter was deleted in favour of the production one; a gate that
proves isolation for a look-alike proves nothing about the code that ships.

**F44 mutation-tested** — each control fails against a broken implementation:

| mutation | caught by |
|---|---|
| `rejectUnauthorized: false` added to `core/db/pool.ts` | F44 · verification is never disabled |
| `pool.ts` switched to `connectionString` | F44 · never hands `pg` a connection string |
| pinned fingerprint altered one byte | `core/db/tls.ts` load-time integrity check |

F44's first draft flagged its own documentation — `tls.ts` must *name* the kill-switch in prose and
*compare* against it in the guard. Fixed by stripping comments and requiring an assignment, the same
trap recorded in F41's header.

---

## 7. Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (7 pre-existing warnings) |
| full suite, no live DB | 790 passed, 21 skipped, 35 files |
| full suite, live DB | **802 passed, 9 skipped, 35 files** |
| architecture fitness | 147 passed (F1–F44) |
| vault | untouched — no file modified in 6 h |
| production `public` schema | **0 tables** — migrations still not run |

---

## 8. State of the production database

| | |
|---|---|
| `public` tables | 0 — **no migration has been run** |
| `ascend_pool_test` schema | created and dropped by the suite; gone |
| `ascend_owner` / `ascend_sales` / `ascend_automation` | **exist** — created by the suite's schema run |
| prospect / event data | none |
| `ASCEND_PROSPECT_SOURCE` | unset (vault remains authoritative) |

The three roles are cluster-wide, so `DROP SCHEMA CASCADE` does not remove them. They are exactly
what migration 001 creates, and creation is idempotent — running 001 will not conflict. Flagged
rather than cleaned up, because silently deleting roles is not mine to decide.

---

## 9. Unrelated, pre-existing, NOT fixed

`tests/engines/event-emission.test.ts` → *"holds under a FORCED timestamp collision"* is **flaky**:
1 failure in 5 full-suite runs, 0 in 12 isolated runs. The file is unmodified by this work.

The final assertion, `expect(ids).not.toEqual([...ids].sort())`, proves ordering came from the log
rather than from ids — but it depends on at least one UUIDv7 inversion among ten ids. UUIDv7 sorts
by its 48-bit millisecond prefix, so when all ten emissions land in distinct ascending milliseconds
the ids *are* sorted and the assertion fails. Under full-suite load that happens often enough to
matter. The property under test is sound; the *witness* for it is timing-dependent.

Reported, not touched, per the standing instruction.

---

## 10. Not done, deliberately

Migrations 001–003 · migrating the six prospects · flipping `ASCEND_PROSPECT_SOURCE` · Sheets
intake · the research engine · auth UI · wiring `core/db` to any surface (F41 still holds).
