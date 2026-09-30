# RECOVERY-CURRENT-001 — the post-010 artifact becomes the CURRENT recovery point · CHECKPOINT

Bookkeeping only. No backup was generated, no artifact was opened, decrypted or restored, no
production connection was made, and no recovery receipt is claimed by this task.

## Why

`prove --owner` restores whichever artifact `selectArtifact` (scripts/proof-orchestrator.mjs) finds
marked "CURRENT recovery point". That was still the 2026-09-20 post-009 `ascend-backup/2` artifact.
Its F9 login proof signs in with `ASCEND_OWNER_PASSWORD` from `.env.production.local`, which since
2026-09-29 holds the owner's current password (the previous value made 2A.3a-2 T1 return 401). The
post-009 artifact carries the previous password hash, so R1b could not pass for any tree, blocking
the owner proof for GATE-2G1-005 and 2A.3a-2's checkpoint.

2A.3a-2 T12 had already produced and proven the replacement. The registry did not yet say so.

## The accepted artifact (2A.3a-2 T12, 2026-09-30)

| | |
|---|---|
| Artifact | `ascend-backup-20260930T030242Z-post-010.ascbk` |
| Format | `ascend-backup/3` (seals its own manifest, ledger and application profile) |
| SHA-256 | `3fddddcf37cb6b6abe97e6f848311d4c463f52287547b2df97fb5691d1b1a70f` |
| Key id | `3b44ac35c74f2ff0` |
| Source commit | `ad86aa20c1c9aa53004fe71bc220c02ac741b74a` |
| Ledger | 10 migrations, head `010_sales_actions.sql` |
| Application profile | `post-010-v1` |
| Proof | R1b 8 passed; R1c (two-leg, PostgreSQL 17.6) 19 passed; both recorded for tree `ee5350841bd338a6cb423c637f409412b02c0511` |

## What changed

| | Before | After |
|---|---|---|
| `core/recovery/recovery-points.ts` | did not exist | append-only v3 pins; one entry, the artifact above, CURRENT |
| `LEGACY_CONTRACTS` post-009-20260920 `acceptedIn` | `…; CURRENT recovery point` | `…; HISTORICAL since 2A.3a-2 (2026-09-30)` |
| every other field of every legacy entry | — | byte-identical; post-009 stays verifiable with `--legacy-contract post-009-20260920` |
| `selectArtifact` | one CURRENT among legacy contracts | exactly one CURRENT across legacy contracts and v3 points; refuses zero or two; also refuses an envelope whose format differs from its pin |

All existing selection checks are unchanged: canonical path inside `~/AscendBackups`, name pattern,
regular file, envelope magic, header bounds and JSON, whole-file SHA-256 equal to the pin. A v3
selection returns no legacy contract; a v2 selection still returns its contract id.

## Evidence

- `tests/architecture/proof-orchestrator.test.ts`: 14 passed. New cases: format mismatch refused;
  no CURRENT refused; one CURRENT in each registry refused as ambiguous; a HISTORICAL v2 beside a
  CURRENT v3 selects the v3 point with no legacy contract; the shipped registries name exactly one
  CURRENT and it is the post-010 v3 pin, whose profile fits its ledger head; post-009 changed its
  `acceptedIn` and nothing else (every other field compared to its prior value).
- Mutants: marking post-009 CURRENT again turns 2 tests red; removing the format check turns 1 red.
- `typecheck` clean; `gate:static` via freeze.

## Follow-ups (outside this task's write paths)

1. `docs/RECOVERY-RUNBOOK.md` still names the post-009 artifact as the CURRENT recovery point, and
   `tools/agent/PROOF-ORCHESTRATION.md` says the current artifact comes from the legacy registry
   alone. Both need a documentation update.
2. Off-machine copy of the post-010 artifact (never a key).
