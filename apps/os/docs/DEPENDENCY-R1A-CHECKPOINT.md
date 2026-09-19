# Dependency R1a — canonical PostgreSQL recovery machinery

**ACCEPTED by the owner on 2026-09-19.** R1a builds the safe, current, canonical PostgreSQL recovery
machinery **without taking a production backup**. R1b (the first current production recovery point)
is approved in concept but **not authorized for execution**.

Baseline `6cb91d2` (Phase 1C). Contract `docs/DEPENDENCY-R1-CONTRACT.md` (pre-flight plus recorded
owner decisions). Operator procedure `docs/RECOVERY-RUNBOOK.md`.

**The owner's standing instruction:** the `DROP SCHEMA public` regression control (§4) is
**permanent**. A restore that contains every row but leaves the application roles unable to use the
schema is not a successful recovery.

## 0 · Hygiene attested at checkpoint

| Claim | Evidence |
|---|---|
| Production was not contacted during R1a | No connection command ran. `backup-production.sh` was exercised only through its refusal paths (no `--read-production`, no key, world-readable key), each of which exits before `production()` is ever called. The pre-flight's single read-only metadata inventory predates R1a. |
| `~/AscendBackups` untouched | 23 entries, identical to the pre-flight listing. Nothing is newer than 2026-08-31, and there is no `.work-*` directory. |
| No persistent real backup key | `~/.config/ascend` does not exist. No `*.key` exists under any `backup-keys` directory. Every key the suites generate is created in `mkdtemp` and removed in `afterAll`. Smoke-test keys in the session scratchpad were deleted. |
| No production URL can enter the restore path | The restore has no URL parameter and accepts only an in-process PGlite. `assertIsolatedEnvironment` refuses any process with a `PG*` or `*DATABASE_URL*` variable, or a Supabase host in any value. Checked at checkpoint: a direct run with `PGHOST` and a production-style `ASCEND_DATABASE_URL` refused, named both variables, and never printed the value. The runner empties the environment by `unset`, not `env -i NAME=value`, so no value enters argv. |
| Temporary rehearsal artifacts gone | No temp directory with an R1a prefix remains (`ascend-r1a-*`, `ascend-keys-*`, `ascend-out-*`, the keyrings). No `.ascbk` or `.ascbk.partial` exists under `$HOME` or `$TMPDIR`. |
| The dependency is exact-pinned | `@electric-sql/pglite-tools` is at `"0.4.8"`, a devDependency, with one lockfile entry, no transitive packages, and a peer of exactly `@electric-sql/pglite 0.5.8`. |

## 1 · Canonical backup architecture

```
scripts/backup-production.sh --read-production --key-file <id>.key [label]
 ├─ refuses before any connection: missing flags, key not 0600 or inside repo/backup dir/iCloud,
 │  backup dir inside repo/iCloud, missing CA or tools
 ├─ production() subshell ── the ONLY place PG* exists (verify-full TLS, read-only sessions)
 │    ├─ psql -f core/recovery/manifest.sql            → source-manifest.tsv   (before)
 │    ├─ ledger == core/db/schema checksums, or abort   (A5)
 │    ├─ pg_dump --schema=public --format=custom        → ascend-public.dump
 │    ├─ pg_dump --schema=public --inserts              → ascend-public-portable.sql
 │    ├─ pg_dumpall --globals-only --no-role-passwords  → globals-nopw.sql
 │    └─ manifest again; differs → abort (production changed mid-dump)
 ├─ refuse role verifiers; write CONTENTS.md (declares credential hashes and PII) and RESTORE.md
 ├─ node core/recovery/artifact.ts seal   ← outside production(): never sees a connection detail
 │    → ~/AscendBackups/ascend-backup-<TS>.ascbk  (+ .sha256), re-opened from disk and verified
 └─ trap: the plaintext working directory is removed on every exit
```

**One mechanism.** `core/db/backup.ts` is retired (§9).

## 2 · Canonical isolated restore architecture

```
npm run recovery:verify [-- --artifact <.ascbk> --owner-email <email>]
 └─ scripts/recovery-verify.sh: unset every inherited variable except PATH, HOME and the named four
     └─ vitest → core/recovery/restore.ts
          ├─ assertIsolatedEnvironment()                 fail closed
          ├─ open(artifact, keyForId(header.keyId))      in memory; no plaintext on disk
          ├─ restoreInto(PGlite in-process):
          │    refuse a non-empty target → ascend_* roles and memberships from globals
          │    → stub the platform roles the dump grants to → replay the dump, KEEPING the target's
          │    public schema → RESET ALL
          ├─ manifestOf(target) vs source-manifest.tsv   key for key
          ├─ verifyBehaviour()                           sequence, append-only, RLS, column grants
          └─ application readers                         credentialFor + verifyPassword,
                                                         resolvePrincipal, listProspects,
                                                         listProspectNotes, readEvents
```

## 3 · F1–F18 status

| # | Property | R1a status |
|---|---|---|
| F1 | Tables (all 8) | **Proven**, and cannot fall behind: a test fails if migrations add a table the manifest does not digest |
| F2 | Columns, types, nullability, defaults | **Proven** |
| F3 | Row counts (every table non-empty in the fixture) | **Proven** |
| F4 | Row content (order-independent digests; held prospects) | **Proven**. Controls catch an altered note and a renumbered event. |
| F5 | Constraints and indexes | **Proven** |
| F6 | Sequence state, `seq` gaps, seq→event_id order, next value beyond history | **Proven**. Controls catch renumbering and a stripped `setval`. |
| F7 | Legacy `prospects.notes` | **Proven** |
| F8 | `prospect_notes` log (written by `addProspectNote`) | **Proven** (fixture; production holds none) |
| F9 | Credentials (double-hashed digest) plus a real login | **Proven**. A control catches an altered hash. |
| F10 | Invitation token hashes (live and consumed, minted by `createInvitation`) | **Proven** (fixture; production holds none) |
| F11 | RLS enabled and forced ×8; 22 policies | **Proven**. A control catches a lost policy. |
| F12 | RLS behaviour (own org / no org / sales cannot delete / only `ascend_auth` reads `password_hash`) | **Proven** |
| F13 | Grants: relations, columns, schema, **including PUBLIC USAGE** | **Proven**. A control catches the 2D procedure. |
| F14 | Six `ascend_*` roles (including `ascend_invite`), without passwords; memberships | **Proven**. The parser was tested on real `pg_dumpall` lines. |
| F15 | Functions, triggers, append-only enforcement | **Proven** |
| F16 | No extension dependency (an intentional exclusion, proven) | **Proven** |
| F17 | Ledger 001–008, checksums equal to the repository, backfill provenance | **Proven** |
| F18 | Artifact checksum and authenticated decryption | **Proven** on a fixture artifact. **On a production artifact: R1b.** |

"Proven" means on the current schema against a fixture source. Proof against **production data** is
R1b.

## 4 · The `public` schema recovery defect — permanent regression proof

- **The defect.** The 2D `RESTORE.md` said: `DROP SCHEMA public CASCADE`, then replay the dump.
  `pg_dump --schema=public` emits `CREATE SCHEMA public` plus only the *non-default* schema grants;
  the default `USAGE` for `PUBLIC` is assumed to exist already. `ascend_owner`, `ascend_sales` and
  `ascend_automation` hold no schema grant of their own. So the restored database carried every row,
  and **no application role could see a single table** (Postgres silently skips a `search_path`
  schema without USAGE: "relation does not exist").
- **How it was found.** The R1a behaviour checks, not the row comparison. Row counts and digests
  would have passed.
- **The fix.** `restoreInto` never drops `public`: it keeps the target's own schema and skips the
  dump's `CREATE SCHEMA public;`. `RESET ALL` follows the replay, because the dump also leaves
  `row_security = off` and an empty `search_path` in the session.
- **Permanent regression proof, in two independent layers:**
  1. `manifest.sql` `F13.grants.schema` now includes `PUBLIC:USAGE`, so a restore missing it
     disagrees with the source manifest.
  2. `restore-fidelity.test.ts`, test *"the 2D runbook's `DROP SCHEMA public` restore is caught — the
     defect R1a found"*, reproduces the old procedure step for step and requires both
     `F13.grants.schema` to differ and `F12.owner-reads-own-org` to fail.
- **Mutation-verified.** Reintroducing the drop into `restoreInto` turns 5 tests red. Removing PUBLIC
  from the F13 key turns 2 tests red.
- **Where it runs.** Every `gate:db` and every `recovery:verify`.

## 5 · Encryption envelope and key contract

| | |
|---|---|
| Format | `ascend-backup/2`: `"ASCBKUP2"` · u32 header length · header JSON · AES-256-GCM ciphertext · 16-byte tag |
| Header (plaintext, authenticated as AAD) | format, cipher, **key id**, nonce, createdAt, bundle SHA-256, member index (name, size, SHA-256). Nothing sensitive. |
| Bundle | u32 index length · index · member bytes. Every member is checksum-verified on open. |
| Key | 32 random bytes, base64, in `~/.config/ascend/backup-keys/<keyId>.key`, mode 600. Refused if group/other-readable, or if inside the repository, the backup directory, iCloud Drive, `~/Desktop` or `~/Documents`. `keygen` never overwrites. |
| Key id | The first 16 hex of SHA-256("ascend-backup-key-id\0" + key). It names the key and cannot open anything (tested). |
| Key never in an artifact | `seal` refuses any input containing the key in raw, base64 or hex form. Every seal is tested to contain no encoding of its key. |
| Rotation | `keygen` creates a new id. Old keys stay in the keyring; each artifact opens only with the key its header names (tested). |
| Failure | Wrong key → refused by id before decryption. Missing key → error names the id to recover from escrow. Any tamper in header (including a **well-formed** forged header, which only AAD can catch), body or tag, or truncation → refused with **no plaintext released**. Writes go to `.partial`, are fsynced, re-opened and verified, then renamed; failure leaves neither file. Existing artifacts are never overwritten. |
| Verification without exposing the key | The key is read from its file into memory only. Every tool prints ids, names, sizes and checksums, never key material or member content. |
| Open | The off-machine destination and key escrow (§12). |

## 6 · Production-target guards

1. **Structural.** The restore API has no URL and accepts only `kind: "pglite-in-process"`, which has
   no socket and no network client.
2. **Environment.** `assertIsolatedEnvironment` fails closed on `PG*`, `*DATABASE_URL*`, or any
   Supabase host value. It names variables and never echoes values.
3. **Target.** A non-empty target is refused, as is any other target kind.
4. **Runner.** `recovery-verify.sh` unsets all inherited variables except PATH, HOME and four named
   ones. Tested: a poisoned caller environment still yields a clean child.
5. **Backup side.** Connection details live only in the `production()` subshell, with read-only
   sessions, verify-full TLS, a host that must be the Supabase direct endpoint, and an explicit
   `--read-production` flag.
6. **Runbook.** Every command names its target explicitly. The old ambient-`PG*` commands are gone.

**Consequence, by design:** `gate:db` run from a shell that sourced `.env.production.local` fails the
recovery suites. Run them with `npm run recovery:verify`.

## 7 · Fixture and rehearsal evidence

- **Fixture source.** Migrations applied as production's ledger records them (001–003 backfilled,
  004–008 witnessed) and `ascend_app` provisioned. Every table has rows, written where possible
  through the application's own writers (`setUserCredential`, `addProspectNote`,
  `createInvitation`).
- **Edge cases covered:** unicode, quotes, newlines and tabs in notes; empty string beside NULL; a
  held prospect; jsonb with nested nulls; `seq` gaps with the sequence advanced past them.
- **Path.** The real canonical path: manifest → WASM `pg_dump --schema=public --inserts` (flags
  asserted equal to the backup script's) → seal → open → restore → manifest → behaviour →
  application readers.
- **Rehearsal of R1b.** The sealed fixture artifact is written to disk with its `.sha256` and
  restored through `scripts/recovery-verify.sh --artifact …`, exactly as R1b will. The
  production-leg suite must pass with **no test skipped**, and the fixture password must not
  appear in output. Planting a failure in the production-leg suite turns the rehearsal red.
- **Mutation probes.** Each of the following turned the recovery suites red, with every source
  restored byte-identical afterwards:
  1. dropping `public`;
  2. removing `RESET ALL`;
  3. disabling the guard;
  4. removing AAD on decrypt;
  5. removing the key-leak check;
  6. dropping PUBLIC from F13;
  7. removing the F9 digest;
  8. removing `--inserts`;
  9. removing the key-mode check;
  10. stripping `setval`;
  11. removing AAD on both sides (this one first survived; §5's forged-header test was added and
      it now fails).

## 8 · Stale PROVEN disposition

Nothing was relabelled, waived or grandfathered.

| Suite | Before | After |
|---|---|---|
| `tests/db/backup-restore.test.ts` | PROVEN on 2026-08-28 evidence (schema 004, zero rows, managed server) | **Retired** with the mechanism it tested. Its property (a backup restores row for row) is now proven by `restore-fidelity`. |
| `tests/db/restore-independence.test.ts` | PROVEN on the same stale evidence; would fail on a current dump (no `ascend_invite`; RLS count 6 vs 8) | **Rewritten** for the current artifact format and F1–F18. **Still PROVEN, and still failing the environment gate on purpose** until R1b supplies a current artifact. |
| `tests/db/restore-fidelity.test.ts` | — | **New, PROVEN**, runs in every `gate:db` |
| `tests/recovery/artifact.test.ts` | — | **New, PROVEN**, static phase |

## 9 · `backup.ts` retirement

`core/db/backup.ts` had **no runtime caller**: only the `core/db/index.ts` re-export and its own
managed-server test. It covered 5 of 8 tables and restored no schema. It was removed with its
re-export and test. Its two fitness rules were carried to the canonical restore:

- "a restore never emits an event" now targets `core/recovery/restore.ts`.
- The credential-column rule names `core/recovery/restore.ts` as its one non-auth member, because the
  restore names `password_hash` only to prove it is **refused** to non-auth roles.

## 10 · R1b limitations (what R1a could not establish locally)

1. **libpq has not been exercised under the new script.** The `pg_dump`/`pg_dumpall` 18.6 binaries
   have not produced an artifact under it. The fixture used the WASM `pg_dump` and a
   `pg_dumpall`-format globals stand-in, and the parser is proven on real `pg_dumpall` lines.
2. **Cross-version manifest agreement is untested.** Both sides are PGlite 18 locally. Deparse or
   format differences between PostgreSQL 17 (source) and 18 (target) would show up as differing keys,
   which fails closed. If they arise, R1b stops and reports them; it does not loosen the manifest.
3. **Real data sizes are unmeasured.** A 34 MB database with 22,811 events has not been restored
   into PGlite yet, so time and memory are unknown.
4. **The backup script's production half is untested.** Its `production()` path (TLS, read-only
   sessions, before/after manifest, ledger check) cannot run without production.
5. **The DB gate fails in a production-env shell.** It fails the recovery suites when
   `.env.production.local` is sourced. That is intended; use `recovery:verify`.
6. **Old unencrypted artifacts remain.** The 2026-08-28…31 artifacts are still in `~/AscendBackups`,
   untouched, awaiting an owner decision.

## 11 · R1c and R2 requirements

- **R1c is required** before PostgreSQL disaster recovery is called production-proven. PGlite 0.5.8 is
  PostgreSQL 18.3; production is 17.6. R1a/R1b evidence proves a restore onto a newer major version,
  **not** a same-version recovery. R1c needs a PostgreSQL 17 target that is not production, a
  `pg_restore` of the custom dump that keeps `public`, a re-keyed `ascend_app`, a manifest comparison
  and a read-only application boot. It needs software the owner has not yet authorized.
- **R2 is required** and separate (completion map). The vault (clients, CRM, documents, uploads, SOPs,
  invoices, time log, audits, automations, portal state, approvals) is in iCloud Drive, not versioned,
  outside every database backup, and has **no proven recovery path**. R1 does not cover it.

## 12 · Exact remaining recovery decisions

1. **Off-machine destination** for `.ascbk` artifacts. Required; not chosen.
2. **Independent key escrow**, held separately from the artifacts. Required; not chosen.
3. **Authorization for R1b**: key generation, one read-only production read, and the proof.
4. **Disposition of the pre-R1a unencrypted artifacts**: re-seal, delete, or keep.
5. **R1c**: which PostgreSQL 17 target, and authorization to install or provision it.
6. **R2**: its contract and scope, after R1.

## 13 · Files

- **New:**
  - `core/recovery/{manifest.sql, artifact.ts, restore.ts}`
  - `scripts/recovery-verify.sh`
  - `tests/db/restore-fidelity.test.ts`, `tests/recovery/artifact.test.ts`
  - `docs/{DEPENDENCY-R1-CONTRACT, DEPENDENCY-R1A-CHECKPOINT, RECOVERY-RUNBOOK}.md`
- **Rewritten:** `scripts/backup-production.sh`, `scripts/RESTORE.template.md`,
  `tests/db/restore-independence.test.ts`
- **Edited:**
  - `core/db/index.ts`
  - `tests/architecture/{fitness.test.ts, gate-2g1.ts}`
  - `tests/db/invitations.test.ts` (one comment)
  - `docs/ASCEND-OS-V1-COMPLETION-MAP.md` (R1 split, R2, status rows)
  - `package.json`: `recovery:verify` and the pinned devDependency
  - `package-lock.json`
- **Deleted:** `core/db/backup.ts`, `tests/db/backup-restore.test.ts`

## 14 · Final gate state (at checkpoint)

All runs used a shell with no `PG*` or `*DATABASE_URL*` variable, and no production contact.

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 source errors. The only errors are the iCloud duplicate files (`"<name> 2.ts"`) inside the generated `.next/types`, which are not repository files. |
| `eslint` on the changed code | clean |
| `npm run recovery:verify` | **51 passed**, 0 skipped (25 artifact + 26 fixture leg, including the R1b rehearsal) |
| `gate:static` | 1,816 passed, 9 skipped, **1 failed**: the environment check, which now fails because `restore-independence` has no current artifact until R1b (§8). That is intended. |
| `gate:server` | 3 passed, 5 skipped |
| `gate:db` | 445 passed, 167 skipped; `restore-fidelity` 26/26 |
