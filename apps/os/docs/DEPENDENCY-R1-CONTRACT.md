# Dependency R1 — current recovery proof

**PRE-FLIGHT ONLY. Nothing implemented, nothing restored, no backup taken.** Baseline `6cb91d2`
(Phase 1C, accepted).

The roadmap row reads: *"Select/repair actual backup path; restore current tables/schema in
isolation. Notes/invites/credentials/events sequence/rows survive; current runbook."* That was
treated as a hypothesis. What follows is what the repository, the backup directory and production
actually show. Where they disagree with the roadmap or with earlier documents, the evidence wins and
the disagreement is stated.

## Question

Can the current authoritative Ascend OS database be backed up and restored into an isolated
environment with enough fidelity to prove recovery of the state the application actually depends on?

**Short answer, today: no.** A mechanism exists and was proven once, on 2026-08-28, against a schema
with no business data. Since then:

- five migrations have landed (004 → 008);
- all real data has arrived (3,108 prospects, 22,811 events);
- no recovery point exists for either;
- both restore proofs are stale against the current schema, and neither has run since;
- the backup's own "contains no credentials" guarantee has been false since migration 005.

The good news is that every piece needed to fix this is already present and isolatable.

## Method and evidence

- **Repository reading:**
  - `scripts/backup-production.sh` and `scripts/RESTORE.template.md`
  - `core/db/{backup,provision,migrate,tls}.ts`
  - `core/db/schema/001–008`
  - `tests/db/{backup-restore,restore-independence}.test.ts`
  - `tests/architecture/gate-2g1.ts`
  - `docs/STAGE2D2-RECOVERY-GATE-REPORT.md`
- **The backup directory `~/AscendBackups`:** file names and sizes only. No artifact was opened.
- **Environment files:** variable **names** and endpoint **kinds** only. No value was printed.
- **One read-only, metadata-only inventory of production.**
  - Connection: the backup script's own verify-full TLS path.
  - The session was forced read-only (`default_transaction_read_only=on`, confirmed `on` by the
    server).
  - Only counts, catalog objects and the migration ledger were read. No row content and no
    credential material. Nothing was written.
- **An in-memory PGlite probe** confirming that the candidate target supports roles, RLS,
  `SET ROLE` and `sha256()`.

---

## 1 · Authoritative data sources

| Category of state | Authoritative store | Evidence |
|---|---|---|
| Organizations, users, memberships | Postgres | `001` |
| Operator credentials (`users.password_hash`, scrypt) | Postgres | `005`; 1 user holds a hash, algorithm `scrypt$32768$8$1` |
| Invitations (`invitations.token_hash`) | Postgres | `006`/`007`; **0 rows** in production |
| Prospects | **Postgres** | `ASCEND_PROSPECT_SOURCE=postgres`; 3,108 rows |
| Prospect notes, new log (`prospect_notes`) | Postgres | `008`; **0 rows** in production |
| Prospect notes, legacy body (`prospects.notes`) | Postgres | `003`; 6 prospects carry one |
| The event spine (`events`, ordered by `seq`) | Postgres | 22,811 rows, `seq` 369–31,384 with gaps, `events_seq_seq = 31384`, dated 2026-07-17 to 09-11 |
| Migration ledger (`schema_migrations`) | Postgres | 001–008; 001–003 flagged `applied_at_is_backfilled` |
| Clients / CRM folders, documents, client uploads, SOPs, the legacy sales hit list | **Vault** (`ASCEND_VAULT_PATH`) | Top-level folders `01`–`05` |
| Invoices, time log, audits, automations fired, portal submissions, portal invites, approval requests (and a legacy `events.jsonl`) | **Vault** JSONL sidecars | Referenced from `core`/`lib`/`app`/`engines` |
| Session signing key, app database password, owner password, API keys | **Environment** (`.env.production.local`) | Names only; see §6 |

### R1's recovery boundary

**In scope:** the Postgres `public` schema, meaning:

- all 8 tables and all their rows;
- the `events_seq_seq` sequence state;
- the 3 functions, 2 triggers and 22 policies;
- RLS enabled and FORCED on all 8 tables;
- 28 table-level and 397 column-level grants to the `ascend_*` roles;
- the 6 `ascend_*` roles and their memberships, restored **without** their passwords;
- the migration ledger, including its backfill provenance.

**What a database backup alone does NOT recover:**

1. **The vault.** It holds everything about clients, documents, uploads, invoices, time, audits,
   approvals and portal state. It lives in **iCloud Drive and is not a git repository.** iCloud is
   sync, not backup: a deletion or corruption propagates. This is the largest unprotected state in
   the system, and it is **outside R1** by the roadmap's own row. It needs an owner (§Owner
   decisions, item 1).
2. **The environment secrets.** `.env.production.local` sits inside the repository folder on an
   iCloud-synced Desktop. Losing `ASCEND_OS_SESSION_SECRET` only invalidates sessions. Losing
   `ASCEND_APP_DB_PASSWORD` is recoverable, because `provision.ts` re-keys the login. The Supabase
   project credentials are needed to reach anything at all. None of this belongs in a database
   artifact, and it must not be put there (§6).
3. **Supabase platform objects:**
   - the `auth`, `storage` and `vault` schemas and their extensions;
   - `pg_stat_statements`, `pgcrypto` and `uuid-ossp`, installed in `extensions`.

   Measured: **no `public` function depends on any extension.** They are platform furniture that
   Ascend does not use, so their exclusion is intentional and loses nothing.
4. **Role passwords (SCRAM verifiers).** Excluded deliberately with `--no-role-passwords`.
   `ascend_app` is re-keyed from `ASCEND_APP_DB_PASSWORD` by `core/db/provision.ts`. The other five
   `ascend_*` roles are NOLOGIN and have nothing to lose.

## 2 · Current backup path

There are **two** mechanisms, and they disagree.

### A · `scripts/backup-production.sh`, the real path

| Question | Finding |
|---|---|
| Executable from here? | **Yes.** libpq 18.6 (`pg_dump`, `pg_dumpall`, `psql`, `pg_restore`) is installed. The pinned CA is at `~/AscendBackups/ca/`. `ASCEND_DATABASE_URL_DIRECT` points at the Supabase direct endpoint as `postgres`, which is **not superuser but has `BYPASSRLS`**. That is the property that lets `pg_dump` read FORCE-RLS tables instead of erroring. It is a read of production and has not been run in this pre-flight. |
| Formats | `pg_dump --schema=public` custom format (for `pg_restore`); plain `--inserts` "portable" SQL (replayable by any executor, including PGlite); `pg_dumpall --globals-only --no-role-passwords` |
| Schema and data | Both, for `public` |
| Sequences | Yes. `pg_dump` emits `setval` for `events_seq_seq`, and `seq` values are dumped explicitly. |
| Roles | Via globals, without passwords. The globals file also carries every Supabase platform role, which a restore must tolerate ("already exists" / skip). |
| Grants, RLS, policies, functions, triggers | Inside the `public` dump |
| Extensions | Not in a `public` dump. Not needed (§1.3). |
| Integrity | Per-file SHA-256, bundle SHA-256, and a re-verify after writing |
| Credential exclusion | **Broken since 005; see below** |
| Corresponds to current schema? | **No.** The newest artifact is `20260831T032714Z-pre-006`, whose data file is **62 KB**. Production is at 008 and 34 MB. It predates migrations 006–008 **and** nearly all business data. **There is no current recovery point.** |

**The credential guarantee is false.** The script prints `credential scan: CLEAN` after grepping
only for `SCRAM-SHA-256|PASSWORD '`, the shape of role verifiers. Since `005`,
`users.password_hash` (scrypt KDF output) is **ordinary row data**, and `006` adds
`invitations.token_hash`. Both are dumped, the scan cannot see them, and `RESTORE.md` still declares
**"CONTAINS NO CREDENTIALS."** Today that means the owner's password hash is in every post-005
artifact, and the script tells the operator to copy the bundle off the machine. This does not
corrupt the backup; it misstates what the artifact is. It is the most important documentation defect
R1 must correct.

### B · `core/db/backup.ts`, the in-app logical snapshot

- It was written when libpq was absent. Its header still says so, which is now false.
- It dumps only `BACKED_UP_TABLES = organizations, users, memberships, prospects, events`. It
  **misses `invitations`, `prospect_notes` and `schema_migrations`**, and restores no schema,
  roles, policies or grants.
- It was proven by `backup-restore.test.ts` in throwaway schemas **on the managed server**.

It is superseded by A and is stale against 006–008. R1 must decide whether it survives (§8).

## 3 · Current restore path

| Artifact | State |
|---|---|
| `scripts/RESTORE.template.md` (copied into every bundle as `RESTORE.md`) | **Stale.** It is frozen at Stage 2D: "migration ledger at 004", "Rows: organizations=0 users=0 …", "captures ZERO business rows", "a new migration beyond 004 invalidates this". It describes an `ascend-public-<TS>.sql` COPY-format file **the script does not produce**. It claims no credentials (false; §2). |
| Template step 1 | `createdb` / `psql -d ascend_recovered -c "DROP SCHEMA public CASCADE"` has **no host**. In a shell where the backup script's `PG*` variables are still exported, those commands would reach the **production cluster** and create a database on it. This is the single most dangerous line in the recovery path (§9, A3). |
| `tests/db/restore-independence.test.ts` | The right design: portable dump replayed into **in-process PGlite**, no vendor, no network. It is **stale in two places that would fail on a current dump:** `ROLES` lacks `ascend_invite` (added in 006), so replay fails on the first grant to that role; and it asserts RLS on `toBe(6)` tables where production now has **8**. Gated on `ASCEND_BACKUP_SQL`, which is set nowhere. |
| `tests/db/backup-restore.test.ts` | Exercises mechanism B by `DROP`/`CREATE SCHEMA` on whatever `ASCEND_TEST_DATABASE_URL` names. The 2D design ran it **on the managed server**, which is **not an acceptable R1 target** under this pre-flight's rule that nothing may restore into or mutate production. Gated on a variable that is set nowhere. |
| Last exercised | **2026-08-28** (`STAGE2D2-RECOVERY-GATE-REPORT.md`: "No prospect data migrated"). That was against the schema at 004 with zero business rows. **Never against 005–008 and never against real data.** |
| Gate standing | Both suites are declared **PROVEN** in `gate-2g1.ts`. They have not run since, and they are among the PROVEN suites the fail-closed check refuses on every static run. That is the "1 failed" carried through 1B and 1C. |

## 4 · Safe isolation target

| Candidate | Verdict |
|---|---|
| Same Supabase project, another schema or database | **Rejected.** It restores onto the production cluster. |
| Second Supabase project | Isolated from production data, but remote, needs new credentials, and is still one wrong URL away. Not preferred. |
| Local PostgreSQL 17 server | **Not available.** libpq ships `initdb`/`pg_ctl` but **no `postgres` binary**, and Docker is absent. Installing one is a system-software decision for the owner. |
| **In-process PGlite (in-memory)** | **Preferred.** It is already a devDependency, already the design of `restore-independence`, and already used by 10+ db suites. |

**Why PGlite is structurally isolated:**

- **Connection boundary.** It is a WASM PostgreSQL inside the test process with **no socket and
  no network client**. It cannot connect to anything, so there is no URL to get wrong.
- **Production writes are structurally impossible.** The restore reads a **file**. The execution
  step must not have any production URL in its environment, and it must **assert** that at start
  (§9, A2).
- **Permissions.** The restore runs as PGlite's superuser (the owner of the restored objects). RLS
  proofs then `SET ROLE` into the restored `ascend_*` roles.
- **Cleanup.** The database is in memory, and it is gone when the process exits. The only durable
  thing is the artifact itself, which must stay in `~/AscendBackups` (`drwx------`, outside the
  repository and outside iCloud) and must **never** be written into the repository, the
  scratchpad, the vault or any synced folder.

**Measured limitation:** PGlite 0.5.8 is **PostgreSQL 18.3**, while production is **17.6**. A
PGlite restore proves recovery onto a newer major version, which is the normal upgrade direction.
It is **not** proof of a same-version restore. Recorded as residual; §8 offers R1c if that matters.

## 5 · Recovery fidelity contract

Everything is compared as **source-side facts captured at dump time** (read-only, in the same
session as the dump) against **restored-side facts**. The comparison is by digest and count, never
by printing values.

| # | Property | Belongs in the backup? | Proof |
|---|---|---|---|
| F1 | Tables | Yes | The set of `public` tables is equal (8) |
| F2 | Columns and types | Yes | `(table, column, type, nullability, default)` sets are equal |
| F3 | Row counts | Yes | Per-table counts equal: 1 / 1 / 1 / 3,108 / 22,811 / 0 / 0 / 8, as they stand at dump time |
| F4 | Row content | Yes | Per-table **order-independent digest**: `sha256` over sorted canonical row text, computed server-side on both sides. Plus representative rows, compared by digest: a held prospect, the 6 prospects with a `notes` body, the first and last events by `seq`. |
| F5 | Keys | Yes | PK, FK, UNIQUE and CHECK constraint sets are equal, including `credential_is_whole` and `note_body_is_stated` |
| F6 | Sequence and event ordering | Yes | `last_value(events_seq_seq)` equal (31,384 today). `seq` multiset digest equal, including gaps (min 369, 22,811 distinct). **The next `nextval` exceeds max(`seq`)**, proven inside a rolled-back transaction. |
| F7 | Notes, legacy body | Yes | Covered by F4 on `prospects.notes` |
| F8 | Notes (`prospect_notes`) and invites (`invitations`) | Yes | **Production holds 0 rows of each, so a production restore proves only that the empty table and its policies came back.** Row-level fidelity for these needs a **fixture leg**: seed notes and invitations into a *PGlite* source, dump it with the same `pg_dump`-equivalent path, restore, compare. The data never touches production. This is exactly the gap the roadmap's "notes/invites survive" asks about. |
| F9 | Credentials | Yes (by necessity; see §6) | `sha256(password_hash)` equal per user id, compared as digests; `password_algo` and `password_set_at` equal; `credential_is_whole` holds. **Functional proof:** the application's own `credentialFor` + `verifyPassword` against the restored row with `ASCEND_OWNER_PASSWORD` read in-process and never printed. It must accept, and a wrong password must be refused. |
| F10 | Invitation secrets | Yes | `token_hash` compared by digest in the fixture leg (production has none) |
| F11 | RLS | Yes | `relrowsecurity` and `relforcerowsecurity` true on all **8** tables. Policy set (name, table, command, roles, `qual`, `with_check`) equal: 22. |
| F12 | RLS behaviour | Yes | As `ascend_owner` with `app.current_org` set, rows are visible. As `ascend_sales`, prospects are readable and deletes refused. `users.password_hash` is unreadable to everyone but `ascend_auth`. |
| F13 | Grants | Yes | The 28 table and 397 column grants to `ascend_*` are equal |
| F14 | Roles | Yes, without passwords | The 6 `ascend_*` roles exist with equal LOGIN/NOLOGIN and BYPASSRLS flags and equal memberships. `ascend_app` has **no** password until re-keyed. That is an intentional exclusion. |
| F15 | Functions and triggers | Yes | `current_org`, `current_user_id`, `events_are_append_only` equal by definition digest. `events_no_update`/`events_no_delete` present and **enforcing**: an UPDATE or DELETE on a restored event is refused. |
| F16 | Extensions | **No; intentional exclusion** | Assert that no restored `public` object depends on an extension. Platform extensions are not restored. |
| F17 | Migration ledger | Yes | Versions 001–008 equal, with `applied_at_is_backfilled` true on 001–003 exactly |
| F18 | Artifact integrity | Yes | `SHA256SUMS` verifies before restore. The bundle checksum is recorded. |

## 6 · Security

| Material | In the artifact? | Handling |
|---|---|---|
| Role SCRAM verifiers | **No** (`--no-role-passwords`) | Keep excluded |
| `users.password_hash` (scrypt) | **Yes**, since 005 | Unavoidable if the restore must preserve logins. It is a KDF output, not a password, but it is still a credential. **The artifact must be labelled as containing credential hashes**, and the false "no credentials" claim removed. |
| `invitations.token_hash` | Yes when rows exist (0 now) | Same treatment. A hash of a bearer token; live tokens expire, and restored ones are still RLS-gated by `expires_at > now()`. |
| PII | **Yes.** 3,108 prospect businesses (names, emails, phones, websites), user email, event payloads, operator notes. | The artifact is sensitive business data |
| Secrets (session key, API keys, DB passwords) | **No.** They live in env only. | Keep them out. The restore must never write env values into the artifact, logs or reports. |

**Proving presence without exposure:**

- Every comparison is a count or a `sha256` computed **inside the database**. Only equality
  booleans and aggregate digests leave it.
- The functional login proof (F9) reads the password into memory and prints pass/fail.
- No row, hash or token is ever printed, logged, snapshotted into a test fixture, or written outside
  `~/AscendBackups`.

**Handling rules for the artifact:**

- It is stored under `~/AscendBackups` (`drwx------`), never in the repository, scratchpad, vault or
  iCloud.
- The script's closing instruction to copy the bundle off the machine stays, but an unencrypted
  bundle with credential hashes and PII should not be copied as-is. **Whether to encrypt it, and
  where the off-machine copy lives, is an owner decision** (item 3).

## 7 · Application-level proof

Database equivalence is necessary but not sufficient. The application depends on role routing, RLS
context, and the credential format being consumable by its own code.

**Proposed bounded read-only smoke, at the core layer, against the restored PGlite:**

- Using the same adapter the db suites already use (`tests/support`), run the application's own
  read paths as the restored roles:
  - `credentialFor` + `verifyPassword` (F9);
  - `resolvePrincipal` for the owner user, which must yield the owner membership and landing;
  - the prospect list/detail readers, whose counts must match F3;
  - event reads ordered by `seq`, whose first and last must match F6.
- All of it inside transactions that are rolled back.
- This proves **the code can consume the recovery**, not merely that rows exist.

**What it does not prove:** that the Next.js server boots against the restored database over TCP.
That needs a socket-speaking Postgres (a local server install, or a new `pglite-socket`
dependency), which is not available without owner authorization. It is offered as optional R1c. It
is not claimed by R1b.

## 8 · Runbook

**None is current.** `RESTORE.template.md` is the only one, and it is stale in every section (§3).

**Minimum runbook for someone other than the implementation session:** a rewritten
`scripts/RESTORE.template.md` plus a short `docs/RECOVERY-RUNBOOK.md`, stating:

1. **What the artifact contains:** schema, data, sequences, roles without passwords, and
   *credential hashes and PII*. **What it does not contain:** the vault, env secrets, platform
   extensions.
2. **Verify first:** `shasum -a 256 -c SHA256SUMS.txt`, and the bundle checksum.
3. **Clear the environment first:** `unset` every `PG*` variable and confirm that no production URL
   is in the environment (§9, A3). Every command names its target **explicitly**; none relies on
   ambient `PG*`.
4. **Restore paths:**
   - (a) the PGlite proof procedure (the committed test, pointed at the artifact by env);
   - (b) a real PostgreSQL ≥17 target: create the roles from globals, tolerating "already exists";
     `pg_restore` of the custom dump with platform `DEFAULT ACL` entries filtered out; then re-key
     `ascend_app` with `provision.ts`.
5. **Verify** with the §5 checks: the committed test, or its SQL equivalents.
6. **What invalidates a recovery point:** any migration beyond the ledger it records, and any
   business write after it was taken (i.e. it ages). The runbook states the *date* of the last
   proven restore rather than claiming currency.
7. **Where the vault's recovery lives.** Today: nowhere. Stated as such.

## 9 · Failure and abort conditions

R1 execution **stops and reports** rather than improvising if any of these hold:

| # | Condition |
|---|---|
| A1 | Any restore target other than an in-process PGlite (or an owner-approved local server) is proposed, or any target resolves to a Supabase host. |
| A2 | The restore/verification process can see a production URL. It must assert at start that `ASCEND_DATABASE_URL*` and `ASCEND_MIGRATE_DATABASE_URL` are **absent** from its environment, and that no `PG*` variable is set. |
| A3 | Any step would run `psql`/`createdb`/`pg_restore`/`DROP` without an explicit target, i.e. relying on ambient `PG*`. |
| A4 | Taking the backup would require anything other than read-only access to production. `pg_dump` takes only `ACCESS SHARE` locks. Any error suggesting a write or DDL, or any `DROP`/`CREATE` on the production cluster, aborts. |
| A5 | The artifact's migration ledger differs from `core/db/schema/` (001–008), or production has moved past 008 between inventory and dump. Re-plan; do not restore a schema the repository doesn't describe. |
| A6 | The dump fails RLS reads (a `row-level security` error). That would mean the dumping role lost `BYPASSRLS`, and a partial dump must not be accepted. |
| A7 | Any fidelity check can only be satisfied by printing a hash, token, password, env value or PII row. |
| A8 | The artifact would have to be written anywhere other than `~/AscendBackups`, or checksums fail. |
| A9 | The restore needs a platform object the backup cannot carry: an extension-dependent `public` object appears, or the replay fails on anything except the documented platform-ACL and psql-meta lines. |
| A10 | A proof would need to be reclassified to pass. The gate must go green by the suites **running**, not by relabelling PROVEN to something weaker without owner approval. |

## Expected implementation and execution, as smaller checkpoints

R1 should be **split**. It mixes code changes that need no production contact with a production
read that does, and the two carry different risk.

### R1a · Make the recovery path honest and current (code only, no production contact)

1. `backup-production.sh`:
   - replace the credential scan's false CLEAN with an explicit declaration that the artifact
     contains credential hashes and PII;
   - keep the SCRAM refusal;
   - record the full ledger and all 8 table counts, not the 2D five;
   - export `PG*` only inside the script's subshell so it never leaks into the calling shell (A3).
2. Rewrite `scripts/RESTORE.template.md` per §8, and add `docs/RECOVERY-RUNBOOK.md`.
3. Make `restore-independence.test.ts` current:
   - derive `ROLES` from the globals file or the migrations, instead of a list that went stale at
     006;
   - derive the RLS table count from the dump, not a pinned `6`;
   - add §5's fidelity checks, where F3/F4/F6 compare against a **source manifest** the backup script
     writes beside the dump (counts and digests only);
   - add the A2 environment assertion.
4. Add the **fixture leg** (F8/F10): seed notes and invitations in PGlite, dump, restore, compare.
   This is fully local.
5. Decide mechanism B (`core/db/backup.ts` and `backup-restore.test.ts`): retire, or retarget to
   PGlite. It cannot stay pointed at the managed server under R1's isolation rule.
6. Gates: static and db. The fixture leg runs in the ordinary db phase.

### R1b · Take the current recovery point and prove it (one production read, owner-authorized)

1. Run the corrected `backup-production.sh`, a read-only `pg_dump` of production.
2. Verify checksums, then run the R1a suite **in a clean environment** with `ASCEND_BACKUP_SQL`
   pointing at the new portable dump: fidelity F1–F18 plus the §7 core-layer smoke.
3. Record a checkpoint with the artifact's timestamp, ledger, counts and checksum. Record no
   content.
4. The two PROVEN recovery entries in `gate-2g1.ts` are either satisfied by this run or explicitly
   re-dated. They are not silently relabelled (A10).

### R1c · Optional: same-version and server-level proof (needs a software decision)

A local PostgreSQL **17** server (or `pglite-socket`), a `pg_restore` of the custom dump, and a
read-only Next.js boot against it on loopback. Only if the owner wants the 17→17 and HTTP-level
evidence that R1b cannot give.

## Owner decisions required

1. **Vault recovery ownership.** The vault is iCloud-only, not versioned and not in any backup. R1
   does not cover it. Name its owner slice (4C or 6B), or open a sibling dependency. It is the
   largest unprotected state in the system.
2. **Authorize R1b's production read:** one read-only `pg_dump`/`pg_dumpall` of production using the
   existing script.
3. **The artifact's sensitivity:** accept that a login-preserving backup contains the scrypt hash
   and PII. Decide encryption at rest and where the off-machine copy lives. Today the script tells
   the operator to copy an unencrypted bundle.
4. **Mechanism B:** retire `core/db/backup.ts` and its managed-server test, or retarget it to PGlite.
5. **Same-version and HTTP proof:** whether R1c (a local PostgreSQL 17 install or a new dependency)
   is wanted, or whether the PG 18 PGlite restore plus the core-layer smoke is sufficient for V1.
6. **Gate reclassification**, if the owner prefers to downgrade stale PROVEN entries rather than
   re-prove them. Not recommended.

## What this pre-flight did NOT do

It took no backup, restored nothing, and opened no backup artifact. It wrote nothing to production,
modified no script, test or schema, and printed no secret, hash or row. Its only production contact
was one read-only, metadata-only inventory.

---

## Owner decisions (2026-09-19), recorded at R1a

The pre-flight was accepted. R1a was authorized alone; R1b is approved in concept but **not yet
authorized for execution**.

1. **Vault recovery is Dependency R2.** It is separate from R1, 4C and 6B. R1 owns PostgreSQL only.
   Recorded in the completion map, with the fact that the vault is outside every database backup and
   has no proven recovery path.
2. **R1b's production read** is conceptually approved. It may be authorized only after R1a is
   reviewed and accepted.
3. **Durable backups are encrypted at rest.** R1a establishes the format (`ascend-backup/2`,
   AES-256-GCM), the key source (a 0600 file in `~/.config/ascend/backup-keys`, never inside an
   artifact), rotation by key id, and failure behaviour. **The off-machine destination and key escrow
   stay open.**
4. **`core/db/backup.ts`** had no runtime caller. It is retired, leaving one canonical mechanism.
5. **R1c is required** before PostgreSQL disaster recovery is called production-proven. A PGlite 18.3
   restore of production 17.6 state is not a same-version proof.
6. **Stale PROVEN evidence is re-proven, not relabelled.** The fixture leg re-proves the mechanism
   now. The production leg keeps its PROVEN entry and fails the environment gate until R1b supplies a
   current artifact.

### A defect found during R1a

The 2D restore procedure (`DROP SCHEMA public CASCADE`, then replay the dump) produces a database in
which Ascend's application roles cannot see any table. `pg_dump --schema=public` does not re-grant the
default `USAGE` to `PUBLIC`, and `ascend_owner`, `ascend_sales` and `ascend_automation` hold no schema
grant of their own. The canonical restore keeps the target's `public`. The manifest now carries the
PUBLIC grant (`F13.grants.schema`), and a control test reproduces the old procedure and proves it is
caught.
