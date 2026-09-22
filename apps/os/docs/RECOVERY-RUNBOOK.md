# Ascend OS — PostgreSQL recovery runbook

**Scope: the PostgreSQL database only (Dependency R1).** Vault and file-backed state have **no proven
recovery path** yet; they belong to Dependency R2 (§8).

**Status (D1b.2, 2026-09-20) — CURRENT RECOVERY POINT:** `ascend-backup-20260920T104952Z-post-009.ascbk`
(key `3b44ac35c74f2ff0`, 15,112,009 B, SHA-256 `5958f3fc…`), taken immediately after migration
009 was applied to production. Ledger **001–009**, manifest before/after identical. Proven by full R1b
(61/61, zero skips) and full two-leg R1c on PostgreSQL 17.6 (31/31, zero skips, both legs 56/56
manifest keys matched). `docs/DEPENDENCY-D1B2-CHECKPOINT.md`. It exists **only on this Mac** until B2
is configured.

**HISTORICAL — not current:** `ascend-backup-20260919T120457Z-r1b.ascbk` is the **pre-009** recovery point. It remains retained, unchanged
and valid **for pre-009 production only**. Restoring it today would restore a schema without the
archival columns, which the application now requires. The two dated R1 status entries below describe
it and are kept as the record of what was proven at the time.

**Status (R1b, 2026-09-19 — HISTORICAL):** a current production recovery point exists and is proven:
`ascend-backup-20260919T120457Z-r1b.ascbk` (key `3b44ac35c74f2ff0`, SHA-256 `3dda2487…`), restored
into isolated PGlite 18.3 and verified F1–F18 with zero skips (`docs/DEPENDENCY-R1B-CHECKPOINT.md`).
It exists **only on this Mac** until off-machine storage (B2) is configured.

**Status (R1c, 2026-09-19, accepted; Dependency R1 complete — HISTORICAL artifact):** the same artifact restored onto a real
PostgreSQL **17.6** server — the production version — over both paths in §5, F1–F18 with no
normalization needed, and consumed read-only by the application as the restored `ascend_app` login
(`docs/DEPENDENCY-R1C-CHECKPOINT.md`). **A same-version HTTP application boot (`next start`) is NOT
COVERED**, intentionally and permanently: the production database transport requires TLS verification
against the production trust chain, and `core/db/tls.ts` is not to be modified for recovery testing.

**Recovery contracts (RT-3, 2A.1a, 2026-09-22):** every artifact is verified against **its own**
recovery contract, never against the repository's current `manifest.sql`. New artifacts are format
**`ascend-backup/3`** and carry their contract (the exact manifest SQL that ran, its SHA-256, the
source commit, the ledger). The two existing artifacts are **`ascend-backup/2`** and are verified only
through a **pinned legacy contract that you name** (§4a). Neither artifact was re-sealed or modified.

| Artifact | Format | Verify with |
|---|---|---|
| `ascend-backup-20260920T104952Z-post-009.ascbk` (CURRENT) | `ascend-backup/2` | `--legacy-contract post-009-20260920` (profile `post-009-v1`) |
| `ascend-backup-20260919T120457Z-r1b.ascbk` (HISTORICAL) | `ascend-backup/2` | `--legacy-contract pre-009-20260919` (profile `pre-009-v1`) — re-proven 2026-09-22 |
| every artifact taken after 2A.1a | `ascend-backup/3` | nothing to name — it carries its contract; naming one is refused |

Written so that someone other than the session that built it can repeat it. Every command names its
target explicitly. None relies on ambient `PG*` variables.

---

## 1 · The pieces

| Piece | What it is |
|---|---|
| `scripts/backup-production.sh` | The **only** way a production recovery point is taken. Read-only, and it refuses to run without `--read-production` and a valid key file. |
| `core/recovery/manifest.sql` | The fidelity manifest the **next** backup runs and seals. It outputs counts, names and in-database SHA-256 digests only. It is **not** the contract of any existing artifact (RT-3). |
| `core/recovery/artifact.ts` | The envelope (AES-256-GCM): writes `ascend-backup/3` (with provenance), reads `/2` and `/3`; key handling; CLI `keygen`, `check-key`, `seal`, `inspect`, `verify`. Node builtins only. |
| `core/recovery/contract.ts` | RT-3: resolves the ONE contract an artifact is verified against — its sealed one (`/3`), or a named pinned one (`/2`) — or refuses. |
| `core/recovery/legacy-contracts.ts` + `core/recovery/contracts/` | The append-only registry of pinned contracts for accepted `/2` artifacts, each bound to the artifact's SHA-256, with a frozen, hash-checked copy of the manifest it was accepted under. |
| `core/recovery/profile-registry.ts`, `core/recovery/profiles.ts` | RT-3B: application verification profiles — the reviewed, per-ledger business checks (login, principal, members, prospects, notes, events, invitations, isolation, grants) R1b and R1c run as the application roles, instead of today's readers. |
| `core/recovery/restore.ts` | The restore: into an in-process PGlite only, refusing any process that can see connection configuration, then manifest comparison (manifest run shape-checked, read-only, rolled back) and behaviour checks. |
| `scripts/recovery-verify.sh` (`npm run recovery:verify`) | Runs the proofs in an emptied environment. |
| `tests/recovery/artifact.test.ts`, `tests/db/restore-fidelity.test.ts`, `tests/db/restore-independence.test.ts` | The proofs (§6). |

`core/db/backup.ts` (the 2C/2D in-app snapshot) is **retired**. It covered 5 of 8 tables and ran
against the managed server. There is now one mechanism.

## 2 · Keys (one-time, and on rotation)

    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON core/recovery/artifact.ts keygen

- This creates `~/.config/ascend/backup-keys/<id>.key` (mode 600) and prints **the id only**.
- The key must never be placed in the repository, `~/AscendBackups`, iCloud Drive, `~/Desktop` or
  `~/Documents`. The tools refuse all of these.
- **Escrow the key immediately.** Without it, every artifact sealed under that id is unrecoverable.
  The owner's chosen escrow is Apple-native and done by the owner, never by a tool:
  `pbcopy < ~/.config/ascend/backup-keys/<id>.key`, paste into a new **locked** Apple Note titled
  `Ascend Backup Recovery Key — <id>`, reopen it with Apple authentication, then clear the clipboard
  with `printf '' | pbcopy`. The key never goes into chat, a command argument, a B2 bucket, or the
  same item as any B2 credential.
- **Rotation:** run `keygen` again and use the new key file for new backups. **Keep old keys** in the
  keyring, because each artifact opens only with the key its header names. Re-sealing old artifacts
  under a new key is optional and not automated.
- **Never** print, paste, commit or attach a key. Tools print key ids, which are safe to share.

## 3 · Take a recovery point (reads production; needs owner authorization)

    ./scripts/backup-production.sh --read-production --key-file ~/.config/ascend/backup-keys/<id>.key [label]

What happens, in order. Any failure stops the run, and the working directory is always removed:

1. **Preconditions.** Tools, the pinned CA and the key file are checked, and the backup directory is
   confirmed to sit outside the repository and iCloud. No connection has been opened yet.
2. **The manifest is taken from production.** The session is read-only (`verify-full` TLS,
   `default_transaction_read_only=on`). **RT-3:** the backup refuses to run unless `HEAD` is a real
   commit and `core/recovery/manifest.sql` and `core/db/schema` have no uncommitted change; the
   manifest it runs is `git show HEAD:…` copied into the work directory, and **that same copy** is
   sealed as `recovery-manifest.sql`, so the bytes executed and the bytes recorded cannot differ.
3. **The ledger is checked.** Production's ledger must equal `core/db/schema/*.sql`, checksum for
   checksum, or the run aborts.
4. **Three read-only dumps are taken:**
   - `pg_dump` custom format;
   - `pg_dump --inserts` (portable);
   - `pg_dumpall --globals-only --no-role-passwords`.
5. **The manifest is taken again.** If production changed during the dump, the run aborts.
6. **Role verifiers are refused**, and `CONTENTS.md` declares the credential-derived material and
   PII.
7. **The artifact is sealed** as `ascend-backup/3` into `~/AscendBackups/ascend-backup-<TS>.ascbk`
   plus a `.sha256`, with `PROVENANCE.json` (manifest SHA-256, source commit, ledger) derived from the
   sealed members, then re-opened from disk and verified — including every provenance binding.

Connection details exist only inside the subshell that runs `psql`/`pg_dump`. The sealing step never
sees them.

## 4 · Prove a recovery point (isolated; touches nothing outside the process)

    npm run recovery:verify -- --artifact ~/AscendBackups/ascend-backup-<TS>.ascbk --owner-email <owner email>

- It empties the environment. Only `PATH`, `HOME` and the four variables the proof needs remain; the
  owner password travels in the environment and is never an argument.
- It opens the artifact in memory and restores it into an in-process PGlite (no network, no socket).
- It verifies **F1–F18** (§6) against the manifest production produced, then checks behaviour, then
  logs in as the owner through the application's own `credentialFor` + `verifyPassword`.

**PASS means every test passed with none skipped.** A skipped `restore-independence` means the
artifact was not found or was not given.

### 4a · Which contract (RT-3)

- **`ascend-backup/3`:** give nothing. The verifier checks the provenance bindings (header ↔
  `PROVENANCE.json` ↔ `recovery-manifest.sql` checksum ↔ the ledger production reported) and runs the
  sealed manifest. Passing `--legacy-contract` for it is refused.
- **`ascend-backup/2`:** add `--legacy-contract <id>` (table at the top). The verifier refuses unless the
  artifact's SHA-256 is the one that contract pins, the frozen manifest hashes to the value it records,
  and the artifact's own source ledger is the one it records. Without the flag it refuses — it never
  falls back to the repository's `manifest.sql`.

      npm run recovery:verify -- --artifact ~/AscendBackups/ascend-backup-20260920T104952Z-post-009.ascbk \
        --legacy-contract post-009-20260920 --owner-email-prompt

- The F17 check compares the restored ledger with the **contract's** ledger, not the repository's
  migrations — so the post-009 artifact stays provable after migration 010 lands.

The restore **refuses to run** in any process that can see a `PG*` variable, a `*DATABASE_URL*`
variable, or a Supabase host. It reports the variable names and never their values. If it refuses, you
are in the wrong shell.

## 5 · Restoring onto a real server — PROVEN on PostgreSQL 17.6 (R1c)

Both paths below were executed against the R1b artifact on a PostgreSQL 17.6 server and verified
F1–F18. The automated form is the proof itself:

    ASCEND_RECOVERY_OWNER_EMAIL=… ./scripts/recovery-verify.sh --artifact <.ascbk> --r1c-root ~/.ascend-r1c/<TS>
    (or --owner-email-prompt instead of the variable; R1c refuses an email in argv)

`<root>/pg17/bin` must hold a PostgreSQL 17 build (R1c built official 17.6 source with
`./configure --prefix=<root>/pg17 --without-icu --without-readline --with-zlib`). The suite creates a
fresh cluster per path under the root — `initdb --auth=scram-sha-256 --locale=C`, then
`listen_addresses = ''` (no TCP listener) and a mode-0700 socket directory inside the root — and every
connection proves the server's version, data directory and system identifier before use.

**For a real recovery**, onto a server you are standing up to REPLACE production:

1. A PostgreSQL **17** server that is not the production cluster, reached with **explicit** `--host`
   and `--dbname` on every command, from a shell with no production `PG*` variables.
2. Create the roles first, from `globals-nopw.sql`: the `CREATE ROLE ascend_*` / `ALTER ROLE ascend_*`
   lines and the `GRANT ascend_* TO ascend_*` memberships with `GRANTED BY` removed
   (`ascendRoleStatements`). Then a `NOLOGIN` stub for every other role the dump references
   (`rolesReferencedByDump` over `pg_restore -s -f -`). On R1b these were `anon`, `authenticated`,
   `postgres`, `service_role`.
3. **Path A — portable SQL** (`restoreInto`): apply `ascend-public-portable.sql` with only `\restrict`
   lines and `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines removed (R1b: 2 and 12), and its
   `CREATE SCHEMA public` commented out.
   **Path B — custom dump** (`pg_restore`): `pg_restore -l`, then comment out EXACTLY these entries
   and nothing else, then `pg_restore -L <list> --exit-on-error --single-transaction`:
   - `SCHEMA - public` (keep the target's own `public`; § "Never" in `RESTORE.md`)
   - every `DEFAULT ACL … supabase_admin` entry (R1b: SEQUENCES, FUNCTIONS, TABLES)

   R1b's archive has 160 TOC entries; 156 are restored. `pg_restore` **17.6 reads the archive written
   by `pg_dump` 18.6** (proven); the archive can be streamed on stdin, so no plaintext dump touches disk.
4. Verify with **the artifact's recovery contract** (§4a) — the sealed `recovery-manifest.sql` of a
   `/3` artifact, or the frozen manifest of a `/2` artifact's pinned contract — against the artifact's
   `source-manifest.tsv`: every key must match. Never the repository's current `manifest.sql`. On 17
   the F5 `contype <> 'n'` exclusion is a no-op, and F5 matches unnormalized.
5. Re-key `ascend_app` with `core/db/provision.ts` (`provisionAppLogin`) from `ASCEND_APP_DB_PASSWORD`
   (R1c used a throwaway password on the disposable server).
6. Point the application at it. **Not proven over HTTP:** the application's pool accepts only a
   Supabase-CA-verified TLS session, so a replacement server must present that chain, or the TLS
   trust must be deliberately changed by a separate, reviewed decision. R1c proved the application's
   readers against the restored server through the real `pg` driver instead.

## 6 · The fidelity contract (what "restored" means)

| # | Proven by |
|---|---|
| F1 tables, F2 columns, types and **nullability** (`attnotnull`), F3 row counts, F4 row content (order-independent digests, plus held prospects) | manifest |
| F5 relational constraints and indexes — `contype = 'n'` excluded: PostgreSQL 18 records NOT NULL as constraint rows and 17 does not (R1b); nullability is F2's | manifest |
| F6 sequence state; `seq` values *with their gaps*; seq→event_id order; next value beyond history | manifest + behaviour |
| F7 legacy `prospects.notes`; F8 `prospect_notes` | manifest + application readers |
| F9 credentials (hashed again before aggregating); a **real login** | manifest + `credentialFor`/`verifyPassword` |
| F10 invitation token hashes | manifest |
| F11 RLS enabled **and forced** on all 8 tables; policies | manifest |
| F12 RLS behaviour: owner sees own org, no org sees nothing, sales cannot delete, only `ascend_auth` may read `password_hash` | behaviour |
| F13 grants: relations, columns, and **schema USAGE including PUBLIC** | manifest |
| F14 roles (without passwords) and memberships among them | manifest |
| F15 functions, triggers, and append-only enforcement | manifest + behaviour |
| F16 no dependency on any extension (an intentional exclusion, proven) | manifest |
| F17 migration ledger, checksums equal to the repository, backfill provenance intact | manifest + repository |
| F18 artifact checksum and authenticated decryption | artifact |

**Intentional exclusions:** role passwords (`ascend_app` is re-keyed on restore; the others are
NOLOGIN), Supabase platform roles, schemas and extensions (platform roles the dump grants to are
stubbed NOLOGIN), and the vault (R2).

## 7 · Open decisions and required work

| Item | State |
|---|---|
| **Off-machine storage of artifacts** | **Required.** Backblaze B2 selected by the owner; **not configured**. It will be separate bounded work after R1b, with a dedicated bucket, restricted credentials, versioning and Object Lock. Copy the `.ascbk` and its `.sha256`, never a key. |
| **Key escrow** | Owner decision: Apple-native. Key `3b44ac35c74f2ff0` is escrowed in a locked Apple Note (owner-performed, R1b). Deployment secrets not yet escrowed; an offline physical recovery record is planned. The B2 credential and the key must never share an item, and the key never goes to B2. |
| **Pre-R1a artifacts in `~/AscendBackups`** (2026-08-28 … 08-31) | Unencrypted, and stale in schema and data. Owner decision: keep them unchanged until R1b is accepted, then decide whether to re-seal or retire them. |
| **R1b** | Done and accepted (2026-09-19). |
| **R1c** | Same-version 17.6 restore over both paths, F1–F18, and a read-only application proof as `ascend_app` (§5): done and accepted (2026-09-19). HTTP boot NOT COVERED. |
| **D1b.2 re-proof** | Migration 009 applied 2026-09-20; new current artifact `ascend-backup-20260920T104952Z-post-009.ascbk` proven by full R1b and two-leg R1c on 17.6 (2026-09-20). The pre-009 artifact is HISTORICAL and retained. |
| **RT-1 · recovery proofs assume every prospect is active** (debt, bounded — recorded 2026-09-20, D1b.2) | **Not yet failing; will fail on the first real archival.** Since D1b.1, `listProspects(tx)` returns the **active** set (`archived_at IS NULL`). Three recovery assertions still treat it as "every prospect", and pass today only because production has 0 archived rows: **(a)** `tests/db/restore-same-version.test.ts` R1c AC4 — `listProspects` length vs the manifest's total `F3.rows.prospects`; **(b)** the same file's notes check — it collects notes by iterating `listProspects`, so notes on an **archived** prospect would be silently skipped and "every restored note" would under-count; **(c)** `tests/db/restore-independence.test.ts` R1b — `listProspects` length vs `count(*) FROM prospects`. (The fixture leg in `restore-fidelity.test.ts` asserts a fixed 3 on a fixture with no archived rows and is unaffected.) **Fix, when taken:** compare the active reader to `count(*) … WHERE archived_at IS NULL`, assert the archived count separately against the manifest, and collect notes over `listProspects(tx, { includeArchived: true })`. Add an archived-with-notes row to the R1a fixture so the gap is proven closed rather than assumed. **Trigger:** must land before, or together with, the first production archival — otherwise the next backup's R1b/R1c fails for a reason unrelated to recovery. Not changed in D1b.2, which was not authorized to modify the recovery suite. |
| **RT-3 · recovery contracts** (2A.1a, 2026-09-22) | Done in code (uncommitted at 2026-09-22), manifest AND application verification (RT-3B profiles). Post-009: R1b 118/118, R1c 19/19 (both legs), and still green with a deliberately future-incompatible current reader. Pre-009: R1b 8/8, R1c 19/19 under `pre-009-v1`. No contract named → refused (`docs/SLICE-2A1A-CHECKPOINT.md`). New backups are `ascend-backup/3`. **No `/3` production artifact exists yet**: the first is taken by 2A.3 after migration 010, and is verified with no contract named. |
| **R2** | Vault and file-backed state recovery (§8). |

## 8 · What this runbook does not recover

- **The vault** (`ASCEND_VAULT_PATH`) holds clients, CRM folders, documents, client uploads, SOPs,
  invoices, the time log, audits, automations, portal submissions, portal invites and approval
  requests. It lives in iCloud Drive, is not a git repository, and has **no proven recovery path**.
  iCloud is sync, not backup: a deletion propagates. Owned by **Dependency R2**.
- **Environment secrets** (`.env.production.local`): the session key, database credentials and API
  keys. They are not in any artifact, by design.
