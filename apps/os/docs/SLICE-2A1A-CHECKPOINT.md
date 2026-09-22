# Slice 2A.1a — RT-3 recovery provenance and versioning · CHECKPOINT

**Status: ACCEPTED 2026-09-22 — RT-3 CLOSED.** Committed as the 2A.1a checkpoint. Baseline `9ed881e`. No migration 010, no
production contact, no deployment, no push. No accepted artifact was modified (both `.sha256` sidecars
verify; mtimes 2026-09-19 05:05 and 2026-09-20 03:50 unchanged).

## The defect
Recovery verification ran the repository's CURRENT `core/recovery/manifest.sql` against every artifact,
compared the restored ledger (F17) with the repository's CURRENT migrations, and swept per-table checks
over the repository's CURRENT table list. Artifacts (`ascend-backup/2`) recorded neither the manifest
bytes nor the commit. Migration 010 must extend the manifest, so the post-009 artifact would stop being
provable (the manifest would query tables its restore lacks; F17 would stop equalling HEAD). The
pre-009 artifact already fails the old F17 check at HEAD, because 009 landed after it.

## The model
- `ascend-backup/3` (magic `ASCBKUP3`) — every new artifact. Self-describing: members
  `recovery-manifest.sql` (the exact bytes the backup ran) and `PROVENANCE.json`; the same provenance
  in the AAD-authenticated header. `ascend-backup/2` is read-only legacy.
- Provenance: `provenanceFormat`, `artifactFormat`, `manifestFormat`, `manifestMember`,
  `manifestSha256`, `sourceCommit`, `ledger`, `ledgerHead`, `coverageExclusions`. `seal` DERIVES it
  from the members (only the commit comes from outside).
- `core/recovery/contract.ts` resolves exactly one contract: sealed (v3) or a NAMED pinned legacy
  contract (v2, `core/recovery/legacy-contracts.ts`, frozen manifest `contracts/manifest-4f20059f.sql`).
  No fallback to the repository.
- Bounded manifest execution for every manifest: shape check (determinism `SET`s, then one
  `WITH m(k, v) AS (…)`; no DDL/DML/transaction control/meta-commands/dollar quotes/escaping
  functions), then a `READ ONLY` transaction, rolled back.
- `verifyBehaviour` and `manifestOf` take the manifest/contract as REQUIRED arguments.
- R1b and R1c open through one helper, `tests/support/recovery-artifact.ts`; F17 compares with the
  contract's ledger; R1c's per-table sweep uses the contract's tables.
- Backup: refuses without a clean HEAD for manifest + schema; runs and seals `git show HEAD:` bytes;
  seals with `--source-commit`; CONTENTS.md table list derived from F3.
- Runner: `--legacy-contract <id>` passed as `ASCEND_RECOVERY_LEGACY_CONTRACT`; isolation guard unchanged.

## Evidence (2026-09-22)
| Run | Result |
|---|---|
| fixture leg + artifact suites (`recovery:verify`) | 93/93; includes the R1a rehearsal running the real R1b suite against the v3 fixture artifact through the runner |
| R1b, post-009 artifact, `--legacy-contract post-009-20260920` | 102/102, 0 skipped; contract legacy-pinned, manifest `4f20059f…`, ledger head 009 |
| same artifact, no contract named | refused (exit 1): "has no embedded recovery contract … never substituted" |
| R1c, same artifact and contract, PG 17.6 (byte-identical copy, deleted after) | 31/31; both legs 56/56 manifest keys, 10/10 behaviour, 0 tuple delta |
| mutation probes | 18/18 caught (P16 initially not caught → test added; P1/P14/P18 re-run with faithful mutations) |
| `gate:static` | 1 failed — the pre-existing environment check, unchanged; all else passed |
| `gate:db` | 33 files passed; the two 17.6 concurrency suites fail closed without `ASCEND_PG17_BIN`, and pass 14/14 with it |
| typecheck, lint (changed files) | clean |

## RT-3B — application verification profiles (added 2026-09-22 after owner review)

The owner found the remaining gap: the APPLICATION half of R1b/R1c ran HEAD's readers, so an old
artifact with the right manifest and ledger could still fail because a current reader expects a newer
schema. RT-3B makes that half historical too.

- `core/recovery/profile-registry.ts` — data only, no imports: profile id → the EXACT ledger it is
  written for, `forNewArtifacts`, description, recorded corrections. Append-only once depended on.
- `core/recovery/profiles.ts` — the implementations. Fixed read-only SQL per schema, run AS THE
  APPLICATION ROLES (`asPrincipal`-style binding, rolled back) on the application's connection and
  compared with superuser ground truth. Imports only `node:crypto` and the registry (test-enforced);
  its own scrypt check; grants read from the catalog, never by attempting a write.
- Profiles: `pre-009-v1` (001–008) and `post-009-v1` (001–009, the profile new backups seal today).
- The profile id is part of authenticated v3 provenance and required in every legacy contract.
  Resolution refuses a missing, unknown or wrong-ledger profile; the run refuses again; each profile
  also checks the restored schema is the one it was written for.
- R1b and both R1c legs run `runApplicationProfile(artifact.contract, …)` and import no application
  reader. The R1a fixture leg still exercises today's readers against the current schema.
- The backup selects the profile for the ledger production reported (`profile-registry.ts
  for-ledger`) and refuses when none is registered: migration 010 must add its profile.
- Fitness rule "only the auth layer names the credential columns" now also admits
  `core/recovery/profiles.ts` (reads `password_hash` as `ascend_auth` on the disposable restore only;
  reports accepts/refuses; never returns the value). Recorded in the rule.

## Evidence — final (2026-09-22)
| Run | Result |
|---|---|
| fixture + artifact + profile suites (`recovery:verify`) | 110/110 — incl. real 001–008 and 001–009 fixture restores under both profiles, today's `listProspects` failing on 001–008 while its profile passes |
| R1b · post-009 · `post-009-20260920` / `post-009-v1` | 118/118; profile 18/18 |
| R1c · post-009 · both legs on 17.6 | 19/19; 56/56 manifest keys and profile 18/18 on each leg; 0 tuple delta |
| R1b · **pre-009** · `pre-009-20260919` / `pre-009-v1` | 8/8; profile 17/17 — first re-proof since RT-3 |
| R1c · **pre-009** · both legs on 17.6 | 19/19; 56/56 and profile 17/17 on each leg; 0 tuple delta |
| future-incompatible reader simulated (`listProspects` selects a post-010 table) | current-schema fixture proof FAILS (1 test, as intended); post-009 R1b 8/8 and R1c 19/19 still PASS under `post-009-v1` |
| post-009 artifact with no contract named | refused |
| RT-3B mutation probes | **15 caught + 1 equivalent mutant** (owner-accepted). Q15 (tenant isolation) was first missed → leak test added. **Q6 is equivalent:** the prospect identity digest already commits to each prospect's archived state, so removing the separate total/active/archived comparison cannot admit a distinct incorrect active/archived partition while that identity invariant holds. No artificial test was added. **If a later change weakens or removes the identity binding, Q6 must be reconsidered.** |
| RT-3 mutation probes (regression, after RT-3B) | 18/18 caught |

Every R1c run used its own fresh, byte-verified copy of the 17.6 build (tree digest `79b404ab…`), deleted after. An earlier attempt reused one root for three R1c runs; the harness refused the existing cluster directory before restoring — a wrapper error, rerun correctly.

## Not covered / residual
- The pre-009 manifest contract is RECONSTRUCTED from the accepted historical checkpoint/manifest
  (dd46b95) and is NOT proven byte-identical to the exact unrecorded manifest bytes used when the
  artifact was created. On PostgreSQL 17 both candidates produce identical output. The accepted
  artifact is nevertheless re-proven under that pinned contract on PostgreSQL 17.6, including
  application-profile verification (R1b 8/8, R1c 19/19).
- `pre-009-v1` restates the 2026-09-19 R1b/R1c application acceptance (credential, principal,
  members, every prospect, events set/order/F6, notes, invitations) as SQL against 001–008; it is a
  faithful re-expression, not the historical reader code. It adds prospect identity, tenant isolation
  and grant checks that the original acceptance did not assert.
- No production `/3` artifact exists yet; the first is 2A.3's post-010 backup.

## Owner acceptance (2026-09-22)
RT-3 CLOSED. Invariant: historical recovery verification is independent of repository HEAD in BOTH
dimensions — database/schema and application/business. Accepted profiles `pre-009-v1`, `post-009-v1`.
Fitness exception approved for `core/recovery/profiles.ts` ONLY (not a recovery-directory exemption);
recovery-profile suite approved as a proven gate.
