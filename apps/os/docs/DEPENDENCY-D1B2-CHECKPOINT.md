# Dependency D1b.2 — migration 009 in production, and the recovery point re-proven

**Status: ACCEPTED (owner, 2026-09-20). Dependency D1 is COMPLETE.** Committed as a single checkpoint.
Baseline `eb0f8b6` (D1b.1). Contract: `docs/DEPENDENCY-D1B2-EXECUTION-CONTRACT.md`.

**Authorized and performed:** A1 (apply 009), A2 (new encrypted backup under the existing key).
**Not authorized, not performed:** A3 (deployment), A4 (archiving a real prospect).
**Nothing deployed. Nothing pushed.** Phase 2 and R2 not begun.

---

## Outcome

| Stage | Result |
|---|---|
| Final pre-migration abort check | all preconditions passed |
| Migration 009 | **COMMITTED** — one transaction, 622 ms |
| Post-migration verification | **51 / 51** (after one owner-authorized matrix correction, §3) |
| New current recovery artifact | sealed, verified, manifest before = after |
| Manifest delta vs pre-009 | **14 / 14 expected, 0 missing, 0 unexpected** (after one owner-authorized list correction, §6) |
| Full R1b | **61 / 61, 0 skipped** |
| Full R1c, both legs | **31 / 31, 0 skipped**; each leg 56 / 56 manifest keys matched |
| Business data changed | **none** |
| Prospects archived | **0** |
| Cleanup | complete |

**Two defects were found during execution. Both were in specifications I wrote, both were caught by
the checks built to catch them, and both were resolved only by explicit owner authorization — recorded
here as witnessed errors, not silent adjustments.**

---

## 1 · Final pre-migration abort check

Re-run immediately before applying, read-only, through `scripts/apply-migration-009.mjs --check`:

009 checksum `f1c3b225…0cd7062d` ✅ · exactly one migration selected ✅ · direct endpoint, verified TLS,
read-only session ✅ · server **17.6** ✅ · ledger exactly 001–008, head `008_prospect_notes_log.sql` ✅
· zero checksum drift across 8 files ✅ · archival columns/constraint/index all absent ✅ ·
`prospects_update_sales` byte-identical to 001 ✅ · 3,108 prospects / 0 notes / 1 user / 22,811 events ✅.

Also confirmed at the same point: backup key present at mode 0600; retained build unchanged (17.6,
`bin/postgres` hash matching).

## 2 · Migration 009 application

```
node --experimental-strip-types scripts/apply-migration-009.mjs --apply-to-production
```

The real `applyMigrations`, given exactly one migration. No ad-hoc SQL. 009 unaltered.

| Evidence of commit | Value |
|---|---|
| Duration | 622 ms, one transaction |
| Ledger | 9 rows, head `009_prospect_archival.sql` |
| Recorded checksum | `f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d` — the frozen value |
| `applied_at_is_backfilled` | `false` — witnessed, not reconstructed |

The ledger row is written by `applyMigrations` in the **same transaction** as the DDL, so the schema
change and its record could not diverge.

## 3 · Post-migration verification — and the V34 correction

`scripts/verify-migration-009.mjs`, read-only. The first run: **50 passed, 1 failed.**

```
[FAIL] V34   constraint count            got 45, expected 44
```

Per the owner's rule, execution **stopped**: no rollback, no forward-fix. A read-only inventory of all
16 constraints on `prospects` then established the cause:

> ### WITNESSED MATRIX ARITHMETIC ERROR — V34 (owner-authorized correction)
>
> **This was an error in the verification matrix, not in production and not in migration 009.**
>
> - Pre-009 constraint count: **43**.
> - Migration 009 intentionally adds **two** `pg_constraint` rows:
>   1. `archival_has_provenance` — `CHECK ((archived_at IS NULL) = (archived_by IS NULL))`
>   2. `prospects_archived_by_fkey` — `FOREIGN KEY (archived_by) REFERENCES users(id)`
> - Therefore the correct post-009 count is **45**. I froze 44, counting the CHECK and forgetting that
>   a foreign key is also a `pg_constraint` row.
> - **V11** independently proved the FK targets `users.id`; **V12** independently proved its ON DELETE
>   behaviour is `a` (NO ACTION). Both passed on the run that caught the error.
> - The inventory showed exactly these two constraints attributable to 009, and no other.
> - Migration 009 is unchanged; its checksum remains frozen.
>
> Only `constraints: 44 → 45` was changed. No other expected value moved.

The whole matrix was then re-run from the beginning: **51 / 51.**

| Section | Result |
|---|---|
| A · ledger (V1–V4) | 9 rows, head 009, checksum frozen, not backfilled |
| B · columns (V5–V10) | `archived_at timestamptz`, `archived_by uuid`; both nullable, neither with a default |
| C · FK + constraint (V11–V14) | FK → `users.id`, ON DELETE NO ACTION; `archival_has_provenance` present and correct |
| D · index (V15–V17) | `prospects_org_active_idx`, partial on `archived_at IS NULL`, non-unique |
| E · RLS (V18–V23) | sales `USING` carries `archived_at IS NULL`; **`WITH CHECK` does not** (the trap); anchored-only kept; owner policy unchanged; RLS enabled **and** forced |
| F · grants (V24–V29) | sales UPDATE on exactly `archived_at, archived_by`; sales table grants still only `INSERT, SELECT`; **no DELETE**; no table-level UPDATE; automation nothing; 30 column grants |
| G · catalog shape (V30–V36) | 31 / 78 columns, 8 tables, 27 indexes, 45 constraints, 22 policies, 6 on `prospects` |
| H · business data (V37–V51) | **0 archived**; every count unchanged |

## 4 · Zero archived prospects; data unchanged

**V37: 0 prospects archived.** Migration 009 backfills nothing, and A4 was not authorized.

| | Before 009 | After 009 |
|---|---|---|
| prospects | 3,108 | 3,108 |
| anchored / held | 3,106 / 2 | 3,106 / 2 |
| closed-won / closed-lost / no status | 1 / 0 / 0 | 1 / 0 / 0 |
| slugged | 6 | 6 |
| **non-empty legacy `prospects.notes` bodies** | **6** | **6** |
| **`prospect_notes` log rows** | **0** | **0** |
| users / organizations / memberships / invitations | 1 / 1 / 1 / 0 | 1 / 1 / 1 / 0 |
| events | 22,811 | 22,811 |

The running application was re-checked after the DDL: `/` → 307, `/login` → 200, same PID 36325.

## 5 · The corrected legacy-note statement

The D1b.1 checkpoint and the `eb0f8b6` commit message said the markdown body was carried by "every one
of the 3,108 rows". **It is carried by 6.** Corrected in `docs/DEPENDENCY-D1B1-CHECKPOINT.md` as a
dated correction block — the commit message is immutable, so the document records why they disagree.

This is now confirmed by **three independent instruments**: the pre-migration read (`with_body = 6`),
verification V45 (`6`), and the recovery manifest's `F7.notes.legacy.count` (`6 → 6`, digest
unchanged). The last also proves the six bodies are **byte-identical** across the migration.

The architectural conclusion is unchanged: hard deletion releases the identity anchor, orphans the
event and client back-references, and would cascade away every future `prospect_notes` row.

## 6 · New recovery artifact — and the §8 delta correction

```
bash scripts/backup-production.sh --read-production \
  --key-file ~/.config/ascend/backup-keys/3b44ac35c74f2ff0.key post-009
```

| | |
|---|---|
| File | `~/AscendBackups/ascend-backup-20260920T104952Z-post-009.ascbk` (mode 0600) + `.sha256` |
| Size | 15,112,009 bytes |
| SHA-256 | `5958f3fcbde0e0e6f942017bf68e1cbc261ee11042489af70e8526e5302e314f` |
| Key id | `3b44ac35c74f2ff0` — the existing key, **not rotated** |
| Members | 6, every checksum agreeing: `CONTENTS.md`, `RESTORE.md`, `ascend-public-portable.sql`, `ascend-public.dump`, `globals-nopw.sql`, `source-manifest.tsv` |
| Ledger | 9 migrations, checksums matching the repository (the script's own A5 guard) |
| **Manifest before = after** | **identical** — enforced by `cmp -s`; the script dies on any difference, and it exited 0 |
| Toolchain | `pg_dump` 18.6, the same that produced the R1b artifact |
| Plaintext | none: 0 work directories, 0 loose `.sql`/`.dump`/`.tsv` |

The previous artifact `ascend-backup-20260919T120457Z-r1b.ascbk` (15,070,041 B) was verified unchanged
by its own `.sha256`.

**The delta check against the pre-009 manifest**, run in memory by `scripts/compare-manifests-009.mjs`,
first reported **2 unexpected deltas**, and execution stopped again:

> ### WITNESSED ENUMERATION DEFECT — §8 delta list (owner-authorized correction)
>
> **A defect in the frozen delta specification — not a recovery defect, not a data correction.**
>
> | Key | Observed |
> |---|---|
> | `F3.rows.schema_migrations` | 8 → 9 |
> | `F4.digest.schema_migrations` | changed |
>
> Migration 009 adds exactly one row to `schema_migrations` — its own ledger entry. F3 counts that
> table's rows and F4 digests its content, so both must move. `F17.ledger` was correctly predicted to
> change; these are two more representations of **the same intentional ledger mutation**. R1b had
> already passed 61/61 with zero skips. **Exactly these two keys were added. Nothing else was
> widened.**

Re-run: **14 of 14 expected deltas present, 0 missing, 0 unexpected, 42 keys unchanged, key set
56 → 56.**

| Moved, as specified | |
|---|---|
| `F2.columns.count` | 76 → 78 |
| `F5.constraints.count` | 43 → 45 — independently confirming the V34 correction |
| `F5.indexes.count` | 26 → 27 |
| `F13.grants.columns.count` | 60 → 62 (all tables, so it differs from V29's prospects-only 28 → 30) |
| `F3.rows.schema_migrations` | 8 → 9 |
| digests | `F2.columns`, `F4.prospects`, `F4.held`, `F4.schema_migrations`, `F5.constraints`, `F5.indexes`, `F11.policies`, `F13.grants.columns`, `F17.ledger` |

**Unchanged, proving no business data moved:** every other F3 row count and F4 content digest —
events (22,811), users, organizations, memberships, invitations, `prospect_notes`; `F6` event sequence
(min 369, max 31,384, 22,811 distinct, order digest identical); `F7` legacy notes (6, digest identical);
`F8` (0); `F9` credentials (1, 0 disabled, digest identical); `F10`; `F4.held.count` (2).
`F4.digest.prospects` moved only in the predicted way — two empty archival columns added to every row's
rendering — while `F3.rows.prospects` stayed 3,108.

## 7 · Full R1b re-proof

`./scripts/recovery-verify.sh --artifact …post-009.ascbk --owner-email-prompt`, run in the owner's
Terminal panel; the owner typed the email at the silent prompt, so it never entered a file, `argv` or
shell history. The wrapper's `env -i` guard was unchanged.

**3 suites, 61 / 61, 0 skipped**:

- `tests/recovery/artifact.test.ts` — 25, the format proof;
- `tests/db/restore-fidelity.test.ts` — 28, the fixture-leg mechanism proof, including its own "no test
  skipped" assertion and every negative control (renumbered events, a lost policy, a lost credential
  hash, the 2D `DROP SCHEMA` defect, an altered note body, the F5/NOT-NULL cross-version rule);
- `tests/db/restore-independence.test.ts` — 8, the new artifact restored off-vendor into isolated
  PGlite, F1–F18 against the manifest production produced at dump time, plus the owner's real login.

## 8 · R1c build — temporary copy, byte-proven

The unchanged wrapper accepts an R1c root only under `~/.ascend-r1c/`. Per owner decision (Option 1),
the retained build was **copied, not rebuilt**, and the wrapper was not modified:

| | |
|---|---|
| Temporary root | `/Users/oscar/.ascend-r1c/20260921T054659Z`, mode 0700, parent mode 0700 |
| Copied | `/Users/oscar/AscendPg17/pg17` **only** — no clusters, logs, artifacts or data |
| Deterministic inventory | 1,879 entries (sorted path, mode, SHA-256 of every file, symlink targets) |
| Inventory SHA-256, original = copy | `bde2aaf1647f2d0f0e57022f0cd95bc233be2b1842ca391e024b5be1876ec092` — **identical** |
| `postgres` / `initdb` / `pg_restore` | **17.6 / 17.6 / 17.6** |
| `bin/postgres` SHA-256 | `ba83fff9…4addd6e34c7` — the accepted value |

## 9 · Full R1c re-proof — both legs

`./scripts/recovery-verify.sh --artifact …post-009.ascbk --r1c-root <temporary root> --owner-email-prompt`,
owner-typed email, unchanged wrapper. **`tests/db/restore-same-version.test.ts`: 31 / 31, 0 skipped.**

**F18** — the artifact matches its recorded checksum and opened under key `3b44ac35c74f2ff0`.

| | **Leg 1 — portable SQL** | **Leg 2 — `pg_restore -L`** |
|---|---|---|
| Server | 17.6 | 17.6 |
| Restore | 17 Ascend role statements, 4 platform role stubs, 2 meta lines + 12 platform-ACL lines stripped · 472 ms | 166 TOC entries, **162 restored, exactly 4 skipped** (`SCHEMA public`, three `DEFAULT ACL … supabase_admin`) · 169 ms |
| F17 ledger = repository | ✅ | ✅ |
| **F1–F17 manifest** | **56 matched, 0 differing, 0 missing, 0 unexpected** | **56 matched, 0 differing, 0 missing, 0 unexpected** |
| Behaviour (F6/F12/F15) | 9 checks, 0 failed | 9 checks, 0 failed |

**Application-level recovery**, each leg, read-only as the restored `ascend_app` login through the
real `pg` driver:

| Check | Leg 1 | Leg 2 |
|---|---|---|
| AC3 socket auth + every connection proves the isolated server | ✅ | ✅ |
| AC4 F9 `credentialFor` + `verifyPassword` (right accepted, wrong refused) | ✅ | ✅ |
| AC4 `resolvePrincipal` from restored memberships | owner | owner |
| AC4 `listProspects` | 3,108 / 3,108 | 3,108 / 3,108 |
| AC4 `readEvents` — envelopes, same set, contracted order, consistent with F6 | 22,811 ✅ | 22,811 ✅ |
| AC4 `listProspectNotes` over every prospect | 0 / 0 | 0 / 0 |
| AC4 invitations under RLS | 0 / 0 | 0 / 0 |
| AC4 `listOrganizationMembers` | 1 / 1 | 1 / 1 |
| Reads reached the server (positive control) | 3,119 scans | 3,119 scans |

**Write-refusal, each leg — 34 probes, every one refused:** the read-only app session's insert
(`25006`), the read-write app insert into `prospects` (guard), and every `INSERT/UPDATE/DELETE/TRUNCATE`
as the superuser on all eight tables (guard). **Post-smoke: 0 inserted, 0 updated, 0 deleted, clone
manifest identical (56 matched).** Guard triggers present: 8 per leg.

**Isolation:** `network_guard.tcp_refusals = 1` — no TCP path existed.

## 10 · Cleanup

| Check | Result |
|---|---|
| Temporary `~/.ascend-r1c/20260921T054659Z` | **deleted** — it held two stopped cluster directories of restored production data and 4 generated credential files; the empty `~/.ascend-r1c` parent removed too |
| Retained `/Users/oscar/AscendPg17` | **unchanged** — re-inventoried, identical to the pre-copy snapshot (1,879 entries), 17.6, mode 0700, 0 cluster/dump/artifact/credential files inside |
| PostgreSQL processes | 0 `postgres`, 0 `pg_ctl` |
| Sockets | 0 under `/tmp`, 0 under home |
| Credential files (`pwfile`/`passfile`) | 0 anywhere under home or `/tmp` |
| Restored data directories | 0 under `/tmp` |
| New artifact | unchanged (`shasum -c` OK) |
| Pre-009 artifact | unchanged (`shasum -c` OK) |
| Backup plaintext | 0 work directories, 0 loose files |

## 11 · Production-data mutation accounting

**The only production write in D1b.2 was migration 009's DDL and its one ledger row**, in one
transaction, through the accepted runner.

- No ad-hoc SQL; no business row inserted, updated or deleted; **0 prospects archived**.
- Verified from **two independent directions**: the V37–V51 counts, and the F3 row counts **plus F4
  content digests** of every business table in the manifest delta.
- Every other production contact was read-only: the final `--check`, the 51-check verification (run
  twice), one diagnostic constraint inventory, and the backup's `pg_dump`
  (`default_transaction_read_only=on`, `ACCESS SHARE` only).
- **No production contact after the backup.** The delta check, R1b and R1c all read local encrypted
  artifacts only.

## 12 · Recovery-point status

| Artifact | Status |
|---|---|
| `ascend-backup-20260920T104952Z-post-009.ascbk` | **CURRENT** — proven by full R1b and two-leg R1c |
| `ascend-backup-20260919T120457Z-r1b.ascbk` | **HISTORICAL** — pre-009; retained unchanged; valid for pre-009 production only |
| August 2026 backups (pre-R1a, unencrypted) | **retained**, untouched — their disposition is separate work |

The pre-009 artifact was **not renamed**. Its `.sha256` names the file, and the R1b/R1c checkpoints
reference it by name, so renaming would break both its own integrity check and the evidence trail.
Its status is recorded in `RECOVERY-RUNBOOK.md` and in a dated supersession note at the top of each
R1 checkpoint instead.

Still true and unchanged: **both artifacts exist only on this Mac.** Off-machine storage (B2) is
separate, required work.

## 13 · Files changed for D1b.2

| File | Change |
|---|---|
| `docs/DEPENDENCY-D1B2-EXECUTION-CONTRACT.md` | **new** — the frozen contract, plus the §8 correction and an executed-status header |
| `docs/DEPENDENCY-D1B2-CHECKPOINT.md` | **new** — this document |
| `scripts/apply-migration-009.mjs` | **new** — the runner. Now fails closed if re-run: the ledger is no longer 001–008 |
| `scripts/verify-migration-009.mjs` | **new** — the matrix, with the V34 correction recorded inline |
| `scripts/compare-manifests-009.mjs` | **new** — the §8 delta check, so it can be reproduced |
| `docs/DEPENDENCY-D1B1-CHECKPOINT.md` | legacy-note correction block; deployability banner updated |
| `docs/DEPENDENCY-D1-CONTRACT.md`, `docs/DEPENDENCY-D1B-CONTRACT.md` | deployability banner updated |
| `docs/RECOVERY-RUNBOOK.md` | current vs historical recovery point |
| `docs/DEPENDENCY-R1B-CHECKPOINT.md`, `docs/DEPENDENCY-R1C-CHECKPOINT.md` | dated supersession note only; the proofs are not rewritten |
| `docs/ASCEND-OS-V1-COMPLETION-MAP.md` | R1 current point; D1 status |

**Unchanged:** `core/db/schema/009_prospect_archival.sql` (checksum frozen), all application code,
`scripts/recovery-verify.sh`, `scripts/backup-production.sh`, `core/recovery/*`, every test.

## 14 · Is Dependency D1 complete?

Every completion criterion from the execution contract §10 is met:

| Criterion | |
|---|---|
| 009 applied to production and the matrix passing with zero failures | ✅ 51/51 |
| Post-migration security/grant shape proven | ✅ V18–V29 |
| New artifact proven through full R1b | ✅ 61/61, 0 skipped |
| Full two-leg R1c passed on it | ✅ 31/31, 0 skipped, 56/56 per leg |
| No production business data changed | ✅ counts and content digests |
| D1a/D1b.1 marked deployable against schema 009 | ✅ banners updated |
| Pre-009 artifact retained and marked historical | ✅ |
| Checkpoint written; runbook, R1 checkpoints and completion map updated | ✅ |
| D1b.1 legacy-note correction applied | ✅ |

**Dependency D1 is COMPLETE** — accepted by the owner on 2026-09-20, together with both witnessed
specification corrections (§3, §6), which are permanent and remain visible here.

## 15 · Deployment has NOT occurred

The `com.ascend.os` service is the same process (PID 36325) on the same 2026-09-18 build. That build
predates D1a and D1b.1, never names the archival columns, and kept serving normally throughout.
**D1a/D1b.1 code is deployable against schema 009, and not deployed.** Deploying it needs your explicit
authorization. Nothing was pushed.

## 16 · Carried forward

1. **Sales archival is not witnessed against a production sales principal**, because no sales-partner
   account exists in production (`users = 1`). It is proven through the real authority machinery in
   fixtures and on a real 17.6 server.
2. **Recovery proofs assume every prospect is active — debt RT-1** (`docs/RECOVERY-RUNBOOK.md` §7).
   Since D1b.1, `listProspects` is the **active-set** reader. **Three** recovery assertions still treat
   it as "every prospect", and pass only because 0 prospects are archived: R1c AC4, R1c's notes check
   (which collects notes by walking `listProspects`, so an archived prospect's notes would be silently
   skipped), and R1b's prospect-count check in `restore-independence.test.ts`. The pre-flight named
   only the first; tracing the call sites found all three. Must be fixed before, or with, the first
   production archival. The fix belongs to the recovery suite, which D1b.2 was not authorized to
   change.
3. **D1a is also undeployed**, so its promotion/deletion correctness fixes are not live either.
4. Off-machine artifact storage (B2) and the August-backup disposition remain open, outside D1.

---

**Accepted. Deployment remains unauthorized.**
