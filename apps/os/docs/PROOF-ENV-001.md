# PROOF-ENV-001 · The controlled proof environment required by the 2A.2d gates

**Status: PREFLIGHT REPORT.** Measured 2026-09-24 against baseline `b2bf9e8` (the GATE-2G1-001 promotion).
Coordinator task `PROOF-ENV-001`, builder claude, reviewer codex. Nothing in the code, tests, gates, manifest,
authorization, Coordinator or production was changed. No production credential was read into any process,
and nothing contacted production. The only file this task writes is this one.

---

## 0 · The answer in brief

- `gate:static` fails on **exactly one test** (1,925 of 1,935 pass): `gate-2g1.test.ts › every PROVEN suite's
  environment gate is satisfied in THIS run`. It lists **28 variable/suite pairs** across **15 PROVEN suites** and
  **11 variables**.
- **This is the gate working as designed.** The manifest says a PROVEN entry's variables must be "present in the
  run making the claim" (`tests/architecture/gate-2g1.ts:52-57`). The static phase therefore checks the
  environment of the **whole** gate, including the db and server phases. `gate:static` can only pass in a run whose
  environment holds every PROVEN suite's variables at once.
- Of the 28 pairs, **5 can be satisfied locally and disposably**. They were **executed here and passed**
  (§3). The other **23** need either a **production connection** (14 pairs) or **owner-held recovery material**
  (9 pairs). An agent must not supply either (§2).
- **The 2A.2d consequence:** its required gates are `typecheck`, `gate:static`, `gate:server` and `gate:db`. In a
  safe local environment, `gate:server` and `gate:db` pass, and `gate:static` fails on that one environment check
  (§4). No agent-safe environment makes `gate:static` pass. Choosing how 2A.2d meets that gate is an owner
  decision (§7). This report takes no position that weakens the gate.

---

## 1 · Why `gate:static` fails, in the gate's own words

`tests/architecture/gate-2g1.test.ts:147-160`: for every PROVEN entry, every name in `requires` must be present in
`process.env`, or the test fails with *"Run the gate with the full environment, or reclassify these as BLOCKED —
do not let a skipped suite read as a pass."* Presence only; values are never read.

`package.json`: `gate:static` = `vitest run --exclude 'tests/render/**' --exclude 'tests/db/**'`. The check lives
in `tests/architecture/`, so the **static** script runs it. It still enumerates every PROVEN entry, and all 15 that
declare `requires` are in the `db` or `server` phase. The phases split *when* a suite runs (the harness constraints
A and B, `gate-2g1.ts:31-43`). They do not split *which environment must be present* for the claim.

This check is what stops a skipped suite from reading as a pass. `gate:db` exits **0** while seven files skip
entirely, five of them PROVEN (§4). Only this static check turns the PROVEN ones' absence into a failure.

---

## 2 · The matrix: every missing requirement, by suite

Classes:
- **LOCAL-DISPOSABLE:** created and destroyed on this Mac, with no production data and no credentials.
- **PRODUCTION:** a live connection to the managed Supabase database.
- **OWNER-RECOVERY:** local and offline, but it opens production's encrypted backup with the owner's credentials.

| # | Suite | Phase | Variable(s) missing | Source (evidence) | Class | Safe setup | Executed here |
|---|---|---|---|---|---|---|---|
| 1 | `tests/db/d1-concurrency.test.ts` | db | `ASCEND_PG17_BIN` | retained PostgreSQL 17.6 build `/Users/oscar/AscendPg17/pg17/bin`; the suite builds its own Unix-socket cluster | LOCAL-DISPOSABLE | `ASCEND_PG17_BIN=/Users/oscar/AscendPg17/pg17/bin` | **yes: 8/8 pass** |
| 2 | `tests/db/note-idempotency-concurrency.test.ts` | db | `ASCEND_PG17_BIN` | same | LOCAL-DISPOSABLE | same | **yes: 6/6 pass** |
| 3 | `tests/db/sales-actions-concurrency.test.ts` | db | `ASCEND_PG17_BIN` | same | LOCAL-DISPOSABLE | same | **yes: 16/16 pass** |
| 4 | `tests/db/sales-routes-concurrency.test.ts` | db | `ASCEND_PG17_BIN` | same | LOCAL-DISPOSABLE | same | **yes: 6/6 pass; control §3.1** |
| 5 | `tests/render/page-isolation.test.ts` | server | `ASCEND_RENDER_TEST` | a flag (`=1`, `page-isolation.test.ts:36`). The suite **deletes** `ASCEND_DATABASE_URL*` and `ASCEND_PROSPECT_SOURCE` from the server's environment and uses its own two-user stub (`:77-81`) | LOCAL-DISPOSABLE | `ASCEND_RENDER_TEST=1`, run unsandboxed with a real `node_modules` (§5) | **yes: 4/4 pass** |
| 6 | `tests/db/pooled-principal.test.ts` | db | `ASCEND_TEST_DATABASE_URL` | the managed database's **admin pooled** connection: `ASCEND_TEST_DATABASE_URL=$ASCEND_DATABASE_URL_ADMIN_POOLED` (STAGE2G-CONTRACT.md:429; STAGE2F:635). The older STAGE2D-PRODUCTION-PROVISIONING.md:144 derived it from `$ASCEND_DATABASE_URL` instead | PRODUCTION | none for an agent | no |
| 7 | `tests/db/production-authorization.test.ts` | db | `ASCEND_TEST_DATABASE_URL` | same. The suite asserts over "the REAL application connection (the transaction pooler), against the REAL migrated tables"; its login is `postgres` with **BYPASSRLS** (`:4`, `:31`, `:42`) | PRODUCTION | none for an agent | no |
| 8 | `tests/db/production-2e-consumer-parity.test.ts` | db | `ASCEND_DATABASE_URL`, `ASCEND_DATABASE_URL_DIRECT` | production app login and direct endpoint (`.env.production.local`) | PRODUCTION | none for an agent | no |
| 9 | `tests/db/production-2e-raw-parity.test.ts` | db | `ASCEND_DATABASE_URL_DIRECT` | production direct endpoint | PRODUCTION | none for an agent | no |
| 10 | `tests/db/production-2e-source-flip.test.ts` | db | `ASCEND_DATABASE_URL`, `ASCEND_DATABASE_URL_DIRECT` | production | PRODUCTION | none for an agent | no |
| 11 | `tests/db/production-app-login.test.ts` | db | `ASCEND_DATABASE_URL`, `ASCEND_DATABASE_URL_DIRECT` | production. It verifies "the CREDENTIAL the application will actually hold" | PRODUCTION | none for an agent | no |
| 12 | `tests/db/request-isolation.test.ts` | db | `ASCEND_DATABASE_URL`, `ASCEND_TEST_DATABASE_URL` | production app login plus admin pooled | PRODUCTION | none for an agent | no |
| 13 | `tests/render/startup-binding.test.ts` | server | `ASCEND_STARTUP_TEST`, `ASCEND_DATABASE_URL`, `ASCEND_TEST_DATABASE_URL` | the flag enables a boot against the **production** URLs (`:58-60`; its own message at `:197-198`) | PRODUCTION | none for an agent | no (its 2 production tests skip in §4) |
| 14 | `tests/db/restore-independence.test.ts` | db | `ASCEND_BACKUP_ARTIFACT`, `ASCEND_BACKUP_KEYRING`, `ASCEND_RECOVERY_OWNER_EMAIL`, `ASCEND_RECOVERY_OWNER_PASSWORD` | set by `scripts/recovery-verify.sh` under `env -i`: the artifact is `~/AscendBackups/*.ascbk` (production data, encrypted), the keyring is `~/.config/ascend/backup-keys`, the email is typed at a silent prompt (it is in no file), and the password is `ASCEND_OWNER_PASSWORD` from `.env.production.local` | OWNER-RECOVERY | owner runs `scripts/recovery-verify.sh --artifact … --owner-email-prompt` (plus `--legacy-contract post-009-20260920` for the current v2 artifact) | no |
| 15 | `tests/db/restore-same-version.test.ts` | db | the four above plus `ASCEND_R1C_ROOT` | as #14; the root is a per-run 0700 copy of the retained 17.6 build under `~/.ascend-r1c/<TS>`, which the wrapper requires | OWNER-RECOVERY | owner runs `recovery-verify.sh … --r1c-root ~/.ascend-r1c/<TS>` on a fresh, byte-verified copy | no |

Totals: rows 1–5 cover **5 pairs** (LOCAL-DISPOSABLE); rows 6–13 cover **14 pairs** (PRODUCTION); rows 14–15 cover
**9 pairs** (OWNER-RECOVERY). That is 28, matching the measured list.

### 2.1 What is unavailable, and what is only withheld

- **Genuinely unavailable to any process: the owner's login email.** By design it is stored in no file, and the
  recovery wrapper refuses it in argv. It must be typed by the owner.
- **Present on this Mac, but withheld by policy** (key names checked for presence only; no value was read):
  `.env.production.local` holds non-empty `ASCEND_DATABASE_URL`, `ASCEND_DATABASE_URL_DIRECT`,
  `ASCEND_DATABASE_URL_ADMIN_POOLED` and `ASCEND_OWNER_PASSWORD`. `ASCEND_TEST_DATABASE_URL` is **not** stored; the
  contract derives it at run time from `ASCEND_DATABASE_URL_ADMIN_POOLED`. The backup keyring directory exists.
  Supplying any of these to an agent process is a production authorization decision, not an environment gap.
- **A doc inconsistency to resolve before anyone runs rows 6, 7, 12 or 13:** STAGE2D §144 sets
  `ASCEND_TEST_DATABASE_URL=$ASCEND_DATABASE_URL` (the app login). STAGE2F §635 and STAGE2G §429 set it to
  `$ASCEND_DATABASE_URL_ADMIN_POOLED` (the BYPASSRLS `postgres` login). `production-authorization.test.ts:31`
  documents the `postgres` login, so the later derivation is the one these suites expect.

---

## 3 · Proofs executed here (safe, non-production)

Environment for every command: `apps/os` of a private worktree at `b2bf9e8`. `NODE_ENV`, `ASCEND_DATABASE_URL`,
`ASCEND_DATABASE_URL_DIRECT`, `ASCEND_TEST_DATABASE_URL` and `ASCEND_DATABASE_URL_ADMIN_POOLED` were all **unset**
(checked for presence before running). Suites ran **one at a time**, never in parallel.

PostgreSQL build verified before use: `postgres --version` → `PostgreSQL 17.6`; `sha256(bin/postgres)` =
`ba83fff9cbbc813c500d29ef78dfc53ea911f6c7333e30e5797454addd6e34c7`, equal to the value recorded when it was built.
No `postgres` process was running before or after.

| Command | Exit | Result |
|---|---|---|
| `ASCEND_PG17_BIN=/Users/oscar/AscendPg17/pg17/bin npx vitest run tests/db/d1-concurrency.test.ts` | 0 | 8 passed (8) |
| `… tests/db/note-idempotency-concurrency.test.ts` | 0 | 6 passed (6) |
| `… tests/db/sales-actions-concurrency.test.ts` | 0 | 16 passed (16) |
| `… tests/db/sales-routes-concurrency.test.ts` | 0 | 6 passed (6) |
| `ASCEND_RENDER_TEST=1 npx vitest run tests/render/page-isolation.test.ts` (unsandboxed, real `node_modules`) | 0 | 4 passed (4), 23 s |

### 3.1 Controls: the passes are real runs, not skips

- **Negative control:** `sales-routes-concurrency` with `ASCEND_PG17_BIN` **unset** gives `6 skipped (6)` and
  *"needs a REAL PostgreSQL server: set ASCEND_PG17_BIN. No PGlite fallback."* The pass above is therefore a run.
- **Server evidence:** with the variable set, its first test is *"is 17.6, and eight concurrent requests are eight
  backends"* (passed). The production-scale test read the default queue over ~3,200 prospects in 53.1 ms.
- **Render mutation control, built into the suite:** PART 2 *"MUTATION — a module-level principal LEAKS across
  overlapping renders"* passed, which proves the suite detects a leak. PART 3 *"the real resolver produces ZERO
  crossover, repeatedly"* passed.
- **Environment-check delta:** with `ASCEND_PG17_BIN` and `ASCEND_RENDER_TEST=1` set, the static environment check
  lists **23** pairs instead of 28. Neither variable appears in the remaining list (control: 0 matches). Production
  variables still appear (9 matches). Remaining variables: `ASCEND_BACKUP_ARTIFACT`, `ASCEND_BACKUP_KEYRING`,
  `ASCEND_DATABASE_URL`, `ASCEND_DATABASE_URL_DIRECT`, `ASCEND_R1C_ROOT`, `ASCEND_RECOVERY_OWNER_EMAIL`,
  `ASCEND_RECOVERY_OWNER_PASSWORD`, `ASCEND_STARTUP_TEST`, `ASCEND_TEST_DATABASE_URL`.

After every server-phase run: no `app/2g-probe`, no `.next/dev`, no dev-server lock, `tsconfig.json` and
`apps/os/AGENTS.md` byte-identical to the baseline, port closed, worktree clean.

---

## 4 · What 2A.2d's required gates return in the safe local environment

Each gate was run separately, in sequence, from the same worktree and environment as §3.

| Gate | Extra local variables | Exit | Result |
|---|---|---|---|
| `npm run gate:static` | none | **1** | 80 of 81 files, 1,925 of 1,935 tests pass (9 skipped). The **only** failure is the environment check (§1) |
| `npm run gate:db` | `ASCEND_PG17_BIN` | **0** | 41 files pass and 7 skip. 693 tests pass and 187 skip; 0 fail. 65 s |
| `npm run gate:server` | `ASCEND_RENDER_TEST=1` | **0** | 2 files pass; 6 tests pass and 2 skip (startup-binding's production part). 20 s |

The seven `gate:db` files that skip entirely are `production-2e-consumer-parity`, `production-2e-raw-parity`,
`production-2e-source-flip`, `production-2g2-provision`, `production-2g4-007`, `restore-independence` and
`restore-same-version` (from the JSON reporter's per-file status). By manifest class, five are PROVEN,
`production-2g4-007` is PARKED and `production-2g2-provision` is NOT_APPLICABLE. The two `gate:server` skips are
both in `startup-binding` (2 passed, 2 skipped; `page-isolation` 4 passed). **These exit-0 results do not certify
those suites.** That is exactly what the static environment check exists to refuse.

**Unexplained observation, recorded rather than resolved:** an equivalent `gate:db` invocation with
`--reporter=json` exited **1** once. Its JSON report says `success: true`, 0 failed tests and 0 failed suites.
stderr for that run had been discarded, so its cause is **not established**. The run before it and the identical
re-run after it both exited 0 with no stderr errors. It is reported, not attributed.

---

## 5 · Harness facts an agent must know to reproduce §3–§4

1. **The agent sandbox blocks loopback.** Inside it, `fetch("http://127.0.0.1:<port>")` gets `ECONNREFUSED` even
   while `next dev` is listening (measured). Server-phase proofs must run outside the sandbox, or they fail with
   `ECONNREFUSED 127.0.0.1:3211` for a reason unrelated to the code.
2. **Turbopack rejects a symlinked `node_modules`.** A worktree whose `apps/os/node_modules` links to another
   checkout panics with *"Symlink [project]/node_modules is invalid, it points out of the filesystem root"* on the
   first route compile. Boot alone still prints `Ready`. The fix is a real directory: an APFS clone
   (`cp -Rc <checkout>/apps/os/node_modules apps/os/node_modules`, 6 s, ignored by `/.gitignore:44`) or `npm ci`.
   The db and static phases are unaffected.
3. **The server-phase suites run `next dev` without `-H`, so it also binds the LAN address** (measured:
   `Network: http://192.168.1.234:<port>`) for the suite's lifetime. The production service is loopback-only on
   purpose; this dev-server exposure lasts only while the suite runs, but it is an exposure.
4. `page-isolation` starts its server with `stdio: "ignore"` and ignores readiness after 90 attempts. A server that
   never came up shows only as three `ECONNREFUSED` failures. The cause is visible only by booting it by hand with
   output captured.
5. The PG 17.6 suites need no network, credentials or long setup: about 3 s each on this Mac.

---

## 6 · What this report does not claim

- It does not claim that any PRODUCTION or OWNER-RECOVERY suite (rows 6–15) passed. None was run.
- It does not claim a full gate pass. `gate:static` exited 1, and `gate:db` / `gate:server` passed with seven and
  one files respectively skipping their production parts.
- No variable value was invented, printed or passed to a test. The only values used are the local build path and
  the literal flag `1`.
- No test, gate, manifest entry, script or runtime file was changed, and nothing was reclassified.

---

## 7 · Owner decisions this report surfaces (none taken)

1. **How 2A.2d satisfies `gate:static`.** As defined, it passes only in a run holding all 11 variables at once,
   and 9 of them are production connections or owner-held recovery material. The gate's own message names two
   routes: *run it with the full environment*, or *reclassify as BLOCKED*. Each changes what the gate claims, and
   neither is an agent's decision:
   - a **full-environment run by the owner**, in the owner's terminal. It contacts production and requires the
     recovery prompt; this is how 2G.1 closed;
   - a **manifest change** that reclassifies production-only suites for non-production runs. That permanently
     changes the gate's claim and would be its own reviewed task;
   - an owner change to **2A.2d's required gates** in the Coordinator task, recording which evidence the slice
     must carry. That is also a governance decision.
2. **Which `ASCEND_TEST_DATABASE_URL` derivation is authoritative** (§2.1), before any production-row run.
3. **Whether server-phase suites should bind `127.0.0.1` only** (§5.3). That would be a separate, reviewed test
   change.
