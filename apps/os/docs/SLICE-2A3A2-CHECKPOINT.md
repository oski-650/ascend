# Slice 2A.3a-2 — production rollout of migration 010 and the promoted Sales stack · CHECKPOINT

**Status: COMPLETE.** Migration `010_sales_actions.sql` is applied to production and the promoted
Sales stack is serving, from one owner-authorized stopped-service window executed under
`docs/SLICE-2A3A-EXECUTION-CONTRACT.md` (promoted in 2A.3a1). Every step T0–T13 passed. Non-secret
evidence only: no URL, host, password, email, token, key or row content appears here. Step logs and
records live in `~/AscendDeploy/20260930T023116Z/` (mode 0700), never in the repository.

## Deploy pin

| | |
|---|---|
| Deploy SHA | `ad86aa20c1c9aa53004fe71bc220c02ac741b74a` (promoted baseline at T0; COORD-VAULT-DB-001) |
| Deploy tree | `ee5350841bd338a6cb423c637f409412b02c0511` |
| Old build | `BUILD_ID 2NCS2fCKGRoKqk3tUd4F8` (D1 lineage), schema 009 |
| New build | `BUILD_ID k5DWIdCrqMPfXkxCGDdpW`, Next.js 16.3.0 (Turbopack), schema 010 |

This checkpoint commit is documentation only and is not the deployed tree.

## T0 · owner authorization (recorded in chat, 2026-09-30 UTC)

Deploy SHA `ad86aa2`, window "start now", D1–D6 accepted: D1 one stopped-service window; D2
forward-fix after T7, restore from T2 only as a last resort decided at the time; D3 no automated
write smoke, T13 is one genuine owner contact; D4 partner principal satisfied by
PARTNER-PROVISION-REPAIR-001 and the partner's single sign-in; D5 the latest promoted baseline,
pinned exactly; D6 serving-tree hygiene.

Owner directions recorded alongside T0:

- Roadmap commit `6e41e0b` stays on `work/gate2g1004`, untouched and not part of this slice. The
  serving checkout was switched to the pin detached; the branch is unchanged.
- **P4 deviation (owner-directed).** The live `.next` held 1,016 iCloud `* N.*` duplicates (none in
  source or git). The owner forbade mutating `.next` while launchd served it. Instead, after T6 the
  old `.next` was removed, T9 built a fresh one from the pin, and zero duplicates were verified
  before T10. The T5 rollback clone therefore still contains the old duplicates; it was never used.

## Preconditions (re-established at execution time)

| | Result |
|---|---|
| P1 | Coordinator `verify` OK after fetching `agents/coord` and `review/*`; baseline = pin |
| P2 | `gate-proof.mjs aggregate`: all 79 PROVEN suites valid for tree `ee53508` — static 37, server 2, db 35, recovery fixture 3, R1b and R1c. Required COORD-VAULT-DB-001 first (the db phase could not receive the vault input consumer parity needs) |
| P3 | Serving checkout clean, detached at `ad86aa2`; `next.config.ts` has no local edit |
| P4 | Deferred into the window by owner direction (above); 0 duplicates before T10 |
| P5 | Only the launchd `com.ascend.os` process held 3001; no dev server or other session in the main checkout |
| P6 | Backup key present, 0600; `pg_dump` 18.6; `~/AscendPg17` PostgreSQL 17.6 intact (1,879 entries) |
| P7 | Clean detached worktree at `8ef09f5` with `node_modules`; schema ends at 009; `post-009-v1` profile present |
| P8 | Partner principal provisioned and repaired (PARTNER-PROVISION-REPAIR-001); partner signed in once (owner report) |

## Sequence and evidence (contract section 7)

| Step | Evidence |
|---|---|
| T1 baseline smoke (old build) | `28 passed · 0 failed · 10 checks failed AS EXPECTED` — expected-fail list C1–C7, R2–R4; no UNEXPECTED-PASS. Record `baseline.json` sha256 `dcb98e03…5a76b1f5`: ledger head 009 (9 rows), prospects 3108 (all active), events 22811, max seq 31384, notes 0, users 2 |
| T2 backup of 009 | `ascend-backup-20260930T024253Z-pre-010.ascbk`, `ascend-backup/3`, sha256 `183ad0646cfb78d871a644cd0c7d7a764cdca3b4f835850e5f8ab9ab84b0ae91`; commit `8ef09f5`; ledger 9, head 009; profile `post-009-v1`; 8 members, every checksum and provenance binding agrees |
| T3 proof of T2 | R1b 8 passed; R1c (two-leg, 17.6) 19 passed; none skipped |
| T4 check (read-only) | every precondition `[ok]`; record `pre-010.json` sha256 `2a523fe9ef4b7f304fb322990780c7ecc4a582c2bc687e4618a3f12582b424e0`; sessions active 0, unknown 0 |
| T5 rollback clone | 3002/3002 files, same paths, `BUILD_ID 2NCS2fCKGRoKqk3tUd4F8`; valid only until T7; not used |
| T6 outage start | `2026-09-30T02:58:10Z`; port 3001 free |
| T7 apply | `APPLIED 010_sales_actions.sql (757 ms)`; ledger 10 rows, head `010_sales_actions.sql`; checksum = frozen pin `5cb6802a…`; database matched the 12-minute-old record; not backfilled |
| T8 verify | `51 passed, 0 failed`; counts unchanged; the four new tables empty |
| T9 build | fresh `.next` from the clean pinned tree; `BUILD_ID k5DWIdCrqMPfXkxCGDdpW`; tree still clean; 0 iCloud duplicates |
| T10 outage end | `2026-09-30T02:59:49Z`; `/login` 200. **Outage 1 min 39 s** |
| T11 post smoke | `44 passed · 0 failed` for owner and partner: C1–C7, R0–R5 (R4 now 403), D1 head 010, D4 22811 → 22811, D8 0/0/0/0, P1–P4 unchanged across the deployment; new log bytes are expected authorization denials only |
| T12 after-backup | `ascend-backup-20260930T030242Z-post-010.ascbk`, `ascend-backup/3`, sha256 `3fddddcf37cb6b6abe97e6f848311d4c463f52287547b2df97fb5691d1b1a70f`; commit `ad86aa2`; ledger 10, head 010; profile `post-010-v1`; R1b 8 passed, R1c 19 passed |
| T13 acceptance | owner recorded one genuine contact on a prospect he is working; saved, visible on the timeline and in the queue (owner-confirmed) |

**Recovery points.** The T12 artifact is the current recovery point. The T2 artifact is historical,
valid for schema 009 only, and must not be presented as current.

## What went wrong on the way, and how it was handled

- **T1 first attempt: `ECONNRESET`.** The smoke's in-script owner-email prompt paused long enough
  for the server to close the idle keep-alive socket (the D1 keep-alive race). Re-run with the owner
  email set in the environment beforehand, as the contract specifies. Nothing was written.
- **T1 second attempt: owner login 401.** The owner password had been reset earlier the same day
  through the invitation flow (the only listed person was the owner), leaving
  `ASCEND_OWNER_PASSWORD` in `.env.production.local` stale. The owner updated that one key himself.
  Nothing was written.
- **T2 environment file.** `backup-production.sh` reads `.env.production.local` from its own tree;
  the P7 worktree has none. A temporary symlink (gitignored, worktree still clean) was created for
  the run and removed after.
- **R1c intermittency before the window.** During P2 preparation, R1c passed once in three runs
  (the failing runs' output was withheld or cut off). Inside the window, T3 and T12 R1c both passed
  first time. Cause not established.

## Post-rollout gate state (recorded, not waived)

P2 was proven on the deploy tree before the window. After the rollout, the db phase run for this
checkpoint's own tree (`f270acfb…`) FAILED: 697 passed, 3 failed, 79 pending, across two PROVEN
suites. Both failures are production having legitimately moved; neither is a regression in the
deployed code, and neither guard stopped refusing what it must refuse:

1. `tests/db/production-authorization.test.ts` — "absence stays absence" (line 375). It expects
   `UPDATE prospects SET status = 'maybe'` to fail with an error naming `status`. Since 010 the
   BEFORE UPDATE trigger `prospects_status_has_transition` refuses the statement before the CHECK
   constraint is evaluated, with its own message. The invalid value is still refused; the test's
   expectation encodes the 009 guard order.
2. `tests/db/production-2e-raw-parity.test.ts` — "every frontmatter field outside the four observed
   drift locations matches the frozen vault" and "DATES are identical as written". The suite holds
   production's historical 2E rows equal to the frozen vault. It passed at `ee53508` before the
   window; the owner's genuine T13 contact then changed contact fields on a historical prospect.
   The suite's semantics assume production data never changes after 2E, which ordinary Sales work
   now does by design.

**Owner decision:** 2A.3a-2's required gates are NOT reduced. The obsolete proof semantics are
corrected in a separately reviewed task (GATE-2G1-005); after it is promoted, this checkpoint is
re-proven and frozen against the corrected gate model. Until then no tree can pass the full
aggregate, and this task stays claimed and unfrozen.

## Follow-ups (not part of this slice)

1. Off-machine copy of the T12 artifact (never a key) — required by the backup tool, destination not
   yet chosen.
2. Contract hygiene: P7 should name the environment-file step for the historical worktree, and T3
   should state the owner-password input when run from a worktree without `.env.production.local`.
3. Investigate R1c intermittency before the next rollout that depends on it.
4. The Stage 2F partner one-shot's revocation proof must restore `disabled_at` in `finally` and set
   an explicit timeout (recorded in PARTNER-PROVISION-REPAIR-001).
5. The Sales slices 2A.3b onward (preflight Q1–Q6, 2A.3c `/partner` redirect) can now start from a
   production that serves the 2A.2 stack.
