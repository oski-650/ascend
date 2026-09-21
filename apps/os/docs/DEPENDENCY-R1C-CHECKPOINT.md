# Dependency R1c — the production recovery point, restored onto PostgreSQL 17.6

> **Superseded as the CURRENT recovery point on 2026-09-20 (D1b.2).** Migration 009 changed the
> production schema, so this checkpoint's artifact (`ascend-backup-20260919T120457Z-r1b.ascbk`) is now **HISTORICAL**: retained,
> unchanged, and valid for pre-009 production only. The proof recorded below stands as what it
> proved at the time and is not rewritten. The current point is `ascend-backup-20260920T104952Z-post-009.ascbk`,
> re-proven by the same suites — see `docs/DEPENDENCY-D1B2-CHECKPOINT.md`.

**ACCEPTED by the owner on 2026-09-19.** With R1c, Dependency R1 (PostgreSQL recovery) is complete.

**Same-version HTTP application boot is NOT COVERED.** This is an intentional, accepted limitation, and it
is permanent. Ascend's production database transport requires TLS verification against the production
trust chain (`core/db/tls.ts`). R1c does not weaken that, or introduce alternate trust behaviour, solely
for a recovery test. **`core/db/tls.ts` must not be modified for recovery testing.** The real-server
application proof through Ascend's application database code, the `pg` driver and the restored
`ascend_app` role (§6) is the accepted application-level evidence for R1c.

Baseline `dd46b95` (R1b, fully accepted). Authorized scope:
- download and build official PostgreSQL 17.6 into a temporary root;
- restore the existing R1b artifact into disposable local clusters, over both restore paths;
- a read-only application proof;
- the minimum code and doc changes;
- full cleanup.

**Not authorized, and not done:** any production contact or new backup, any change to the R1b artifact,
its key, the August backups, `.env.production.local` or the running launchd app, Homebrew PostgreSQL,
Docker, any change to `core/db/tls.ts`, D1, R2, B2.

## 1 · Source and build

| | |
|---|---|
| Source | `https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2`, 21,623,975 bytes, HTTPS only (`--proto =https`) |
| SHA-256 | `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`, equal to the published `.sha256` (`shasum -c`: OK) |
| Build | `./configure --prefix=<root>/pg17 --without-icu --without-readline --with-zlib`, then `make` and `make install`. Run in an `env -i` shell. Apple clang 17. No admin rights. |
| Result | `postgres`, `initdb` and `pg_restore` all report **17.6**. Production reports 17.6. |
| Root | `~/.ascend-r1c/20260919T124921Z/` (mode 700; not in the repo, iCloud, Desktop or Documents). Nothing was installed anywhere else. |

## 2 · Preconditions (checked before any production-data run)

- The tree was clean at `dd46b95`, and no other writer appeared during the run.
- **FileVault is on** (`fdesetup status`).
- The artifact passes `shasum -c`: mtime Sep 19 05:05:41, 15,070,041 bytes, mode 600.
- The key file `3b44ac35c74f2ff0.key` is mode 600. Its contents were never read into output.
- Recorded as baselines: the `~/AscendBackups` tree (98 entries: name, size, mtime, mode), the key's
  metadata, the metadata of `.env.production.local`, and the launchd app (pid 36325).

## 3 · Isolation

| Control | How it was enforced |
|---|---|
| No TCP listener | Every cluster ran with `listen_addresses = ''`. `lsof` showed no postgres TCP listener. |
| Socket only inside the root | `unix_socket_directories = <root>/<leg>/sock`, directory mode 0700, `unix_socket_permissions = 0700` |
| Allowlisted environment | The runner unsets everything except `PATH`, `HOME` and the five recovery variables. Each PostgreSQL binary receives only `PATH=/usr/bin:/bin`, `HOME=<root>`, `LC_ALL`, `LANG`, `TZ`, so `~/.pgpass` and service files can't apply. |
| No inherited connection settings | `assertIsolatedEnvironment` refuses any `PG*` variable, `*DATABASE_URL*` variable, or Supabase host |
| No `.env.production.local` | Not loaded. The runner reads only `ASCEND_OWNER_PASSWORD` from it, as in R1b, and never prints it. |
| No host or URL | `openEphemeralSocketTarget` and `ephemeralSocketConfig` accept a root, a cluster directory and a port. The socket path is derived from them. |
| Post-connect assertions (every privileged connection) | `inet_server_addr() IS NULL`, `listen_addresses = ''`, `server_version = 17.6`, `data_directory` equal to this cluster's directory inside the root, `system_identifier` equal to the value `pg_controldata` reported at initdb |
| Post-connect assertions (every `ascend_app` connection) | Unix socket, empty `listen_addresses`, 17.6, the **same postmaster start time** the privileged connection verified, database `r1c_smoke`, `current_user = ascend_app`, `default_transaction_read_only = on` |
| Node network guard | For the whole suite, `net.Socket.prototype.connect` throws on anything that isn't a Unix path. It proved live against a probe of `127.0.0.1:9`, and that probe was the **only** refusal all run. |
| Forgery | `restoreInto` refuses a socket target that this module didn't construct |

**Every assertion was checked to refuse when violated.** These ran on an empty throwaway cluster with
no production data; the probe script and its cluster were deleted afterwards. The unaltered server
was accepted. Each of these was refused:
- wrong version;
- wrong `system_identifier`;
- cluster outside the root;
- relative root;
- a port with no socket;
- root reached through a symlink;
- socket directory at mode 0750;
- `PGHOST` in the environment;
- `*DATABASE_URL*` in the environment;
- a forged target literal.

The negative cases for `inet_server_addr()` and `listen_addresses` weren't exercised, because that
would have required starting a TCP listener. **The owner accepted this as a minor limitation.** No TCP
listener is to be started merely to create a negative test. The socket-only constructor, the TCP guard,
the positive server assertions on every connection, and the no-listener architecture are sufficient
evidence for this slice.

## 4 · Restore legs (each on its own fresh 17.6 cluster)

| | Leg 1 · portable SQL (`restoreInto`, unchanged) | Leg 2 · custom dump (`pg_restore -L`) |
|---|---|---|
| Server | 17.6 | 17.6 |
| Roles | 17 `ascend_*` statements. Stubs: `anon`, `authenticated`, `postgres`, `service_role` | Same 17 statements and the same 4 stubs (from `pg_restore -s -f -`, which renders no rows) |
| Filtering | `\restrict` meta lines stripped: 2. `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines: 12. `CREATE SCHEMA public` commented out. | Of 160 TOC entries, **exactly 4 skipped**: `SCHEMA - public pg_database_owner`; `DEFAULT ACL … FOR SEQUENCES supabase_admin`; `… FOR FUNCTIONS supabase_admin`; `… FOR TABLES supabase_admin`. 156 restored, with `--exit-on-error --single-transaction`. |
| `pg_restore` binary | — | **17.6 (the server's own build) reads the archive written by `pg_dump` 18.6.** The 18.6 fallback wasn't needed. |
| Plaintext | Held in memory only | The archive was streamed on stdin. The list file holds TOC descriptors only. |
| Time | 956 ms | 314 ms |

## 5 · F1–F18 on the same version

On **both legs**, all **56 manifest keys match production** (0 differing, 0 missing, 0 unexpected):
- F17: the ledger (001–008) and its checksums equal the repository's.
- F18: the checksum matches, and the artifact opened under the key it names.
- The behaviour checks passed: 9 of 9 per leg.

**F5 matched with no normalization.** On PostgreSQL 17 there are no `contype = 'n'` rows, so R1b's
exclusion is a no-op here. This is the same-version confirmation R1b could not give.

## 6 · The application consumes it (both legs)

Everything ran through the real `pg` driver, over the socket, as the **restored `ascend_app`
login**, re-keyed with a throwaway 64-hex password. That login is a non-superuser: it can reach data
only by switching into `ascend_auth` or `ascend_owner`, which R1b's in-process superuser could not
show. Each transaction was `BEGIN READ ONLY`, on the `r1c_smoke` clone.

| Check | Leg 1 | Leg 2 |
|---|---|---|
| `credentialFor` + `verifyPassword`: real password accepted, wrong one refused | pass | pass |
| `resolvePrincipal` returns `owner`, in the owner's restored organization | pass | pass |
| `listProspects` | 3,108 of 3,108 | 3,108 of 3,108 |
| `readEvents`: count, envelope shape, same id set, `occurred_at, seq` order, F6 order digest | 22,811 of 22,811, all true | 22,811 of 22,811, all true |
| `listProspectNotes` over every prospect | 0 = 0 restored | 0 = 0 |
| Invitations under the owner principal, through row-level security (no application reader exists; only create and accept, which write) | 0 = 0 restored | 0 = 0 |
| `listOrganizationMembers` via `requireCapability` and `requireAppDb` (the registered read-only lease was used exactly once) | 1 = 1 | 1 = 1 |

The owner email arrived through a non-echoing prompt (`--owner-email-prompt`). It never appeared in
argv, shell history, a log, or this checkpoint.

## 7 · Write safety

1. **The verified restore wasn't touched.** The application ran against `r1c_smoke`, a clone created
   with `CREATE DATABASE … TEMPLATE r1c_restore` after verification. Every application connection
   asserted `current_database() = 'r1c_smoke'`.
2. **Write-refusal triggers.** The clone has a statement-level `BEFORE INSERT OR UPDATE OR DELETE OR
   TRUNCATE` trigger on all 8 tables (`r1c_guard.refuse_write`).
3. **Read-only by default.** `ALTER ROLE ascend_app IN DATABASE r1c_smoke SET default_transaction_read_only = on`, plus `BEGIN READ ONLY` in the harness.
4. **Reader paths only.** The harness imported readers only. There were no routes and no writers.
5. **Deliberate writes, all refused, on both legs:**

   | Path | Result |
   |---|---|
   | `ascend_app` as `ascend_owner`, read-only session: `INSERT INTO organizations` | **25006** (read-only transaction) |
   | `ascend_app` **explicitly `READ WRITE`**, as `ascend_owner`: `INSERT INTO prospects` | **P0001, R1C guard** |
   | Cluster superuser, `READ WRITE`: INSERT, UPDATE, DELETE and TRUNCATE on each of the 8 tables (32 statements) | **all 32 refused: P0001, R1C guard** |

6. **After-the-fact check:**
   - Tuple changes in `pg_stat_user_tables` stayed at inserted 0, updated 0, deleted 0.
   - A positive control showed the application's reads were actually recorded: 3,119 new table scans
     after its backends exited.
   - All 56 manifest keys of the clone were identical before and after.

## 8 · No production contact

- There was no production credential, DSN or Supabase host in any process: the environment gate and
  the log scan both show this.
- No TCP connection was attempted by the proof process. The network guard's only refusal was its own
  liveness probe.
- The PostgreSQL servers had no TCP listener.
- The only network traffic in R1c was:
  - the PostgreSQL source download from ftp.postgresql.org;
  - during the preflight, Homebrew and npm package metadata reads.

## 9 · Cleanup

| Check | Result |
|---|---|
| Every temporary PostgreSQL process stopped (`pg_ctl -m fast`) | No `postgres` process remains |
| Processes referencing the R1c root | 0 |
| `~/.ascend-r1c/` (build, source, both leg clusters, probe cluster, password files, list files, server logs) | **Removed entirely** |
| PostgreSQL sockets under `/tmp`, `/private/tmp`, `$HOME` | 0 |
| Artifact | `shasum -c` OK; same mtime, size and mode 600 |
| `~/AscendBackups` tree | Identical to the baseline (98 entries) |
| Key file | Identical metadata, mode 600 |
| `.env.production.local` | Identical metadata |
| launchd app | Untouched (same pid, 36325) |

**Log scan.** Run over the fixture, pass-1 and final logs and the 3 server logs, before deleting them:
- **Absent:** the owner password, `ASCEND_APP_DB_PASSWORD`, the session secret, both DSNs, the key
  (raw, hex, decoded), every cluster superuser password, the Supabase host, scrypt markers, row
  `INSERT` SQL, and any email address.
- The scanner printed booleans only.
- All logs were then deleted.

**Pass 1.** A first run used a placeholder email. It proved both legs; the application section
stopped by design. Its clusters were removed before the final run.

## 10 · Gates

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 source errors (the iCloud ` 2.*` copies are confined to the gitignored `.next/` and were left alone) |
| `eslint` on the changed code | clean |
| `recovery:verify` fixture leg, after the `restoreInto` refactor | 53 of 53, as in R1b |
| `recovery:verify --r1c-root` (final) | **31 passed, 0 skipped, 0 failed** |
| `gate:static` | 1,816 passed, 9 skipped, 1 failed: the fail-closed environment check (below) |
| `gate:server` | 3 passed, 5 skipped |
| `gate:db` | 447 passed, 199 skipped. That is R1b's 455 minus `restore-independence`'s 8, which skip without the recovery variables; the skips are R1b's 160 + those 8 + this suite's 31. |

**The environment check lists 11 suites:**
- the 9 pre-existing ones from R1b;
- `restore-independence`, because this gate run didn't set the recovery variables;
- the new `restore-same-version`, which needs a build root that R1c destroyed on purpose.

Its PROVEN claim rests on §4–§7. It fails the environment gate until a root is rebuilt, the same
convention R1a used for `restore-independence`.

## 11 · Files

| File | Change |
|---|---|
| `core/recovery/restore.ts` | The `postgres-ephemeral-socket` target: `openEphemeralSocketTarget`, `ephemeralSocketConfig` and `assertEphemeralServer`, with a WeakSet against forgery. Steps 0–2 extracted as `assertRestorableTarget` and `createRestoreRoles`; `restoreInto` behaves the same (fixture leg 53/53). |
| `tests/db/restore-same-version.test.ts` | New: both legs, F1–F18, behaviour, the application proof, the write guards, the network guard |
| `tests/support/r1c-cluster.ts` | New: `initdb`, start and stop a disposable cluster; `pg_restore` over stdin |
| `scripts/recovery-verify.sh` | `--r1c-root` (must be under `~/.ascend-r1c/`, mode 0700, contain a build); owner email from `ASCEND_RECOVERY_OWNER_EMAIL` or `--owner-email-prompt`; R1c refuses an email in argv |
| `tests/architecture/gate-2g1.ts` | Registers `restore-same-version` as PROVEN, requiring the five variables |
| `docs/RECOVERY-RUNBOOK.md` | Status; §5 rewritten as the proven procedure with the exact skip list; §7 |
| `docs/DEPENDENCY-R1-CONTRACT.md` | R1c executed note |
| `docs/DEPENDENCY-R1C-CHECKPOINT.md` | This file |

## 12 · Limitations, and recovery work outside R1

**Accepted limitations of R1c:**

- **Same-version HTTP boot: NOT COVERED** (neither failed nor claimed; see the status block at the top).
  A real replacement server that doesn't present the production trust chain would need a separate,
  reviewed TLS decision before `next start` could use it.
- **`inet_server_addr()` / `listen_addresses` were tested positively only** (§3). Accepted.
- **The collation differs.** The clusters used `--locale=C`, the setting under which the PGlite restore
  matched. Every text ordering in `manifest.sql` is pinned to `COLLATE "C"`, and the only other
  orderings are over the integer `seq`, so this doesn't affect fidelity. A replacement server with an
  ICU or `en_US` locale would order text differently in user-facing sorts.
- **Source provenance is a digest.** The source tarball was verified against the `.sha256` from the
  same host, over HTTPS. No PGP signature was checked.

**Tracked separately. The owner ruled that these are NOT prerequisites for R1 completion:**

- **R2** owns vault and file-backed state recovery. The vault isn't in this artifact.
- **B2** owns off-machine replication. The artifact exists only on this Mac.
- **Deployment-secret escrow** remains open recovery and security work.
- **The August 2026 backups** are a retention-cleanup decision.
