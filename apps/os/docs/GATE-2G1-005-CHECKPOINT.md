# GATE-2G1-005 checkpoint — db-phase proof semantics after migration 010

## Boundary and reproduction

Builder: Codex. Reviewer: Claude. Baseline: `ad86aa20c1c9aa53004fe71bc220c02ac741b74a`.
Only the two db suites, their 2G.1 manifest descriptions, and this checkpoint are changed.
No application code, migration, production data, vault content, gate runner, or Coordinator lifecycle is changed.

Before editing, a controlled focused run of the two PROVEN db suites on the baseline produced:

| Suite | Passed | Failed | Failure |
|---|---:|---:|---|
| `production-2e-raw-parity.test.ts` | 8 | 2 | The live `last_contact` differs from the frozen 2E field; both the fixed four-location list and the date-equality assertion rejected it. |
| `production-authorization.test.ts` | 25 | 1 | The invalid-status UPDATE was refused by migration 010's transition trigger before the older CHECK could report `status`; the test expected the older message. |

The diagnostic printed suite and test names, counts, and the field name only. It did not print row values, vault data, credentials, or connection details. A sandboxed attempt before this run did not execute the suites and is excluded from the evidence.

## Correction

- The status refusal now requires either SQLSTATE `23514` from `prospects_status_check` or SQLSTATE `42501` with the specific 010 transition-record message. A generic permission denial is rejected by a separate adversarial test. An invalid INSERT, where the UPDATE trigger does not run, separately proves the original status CHECK still refuses the value. The website-quality refusal remains.
- The original six-row 2E migration witness remains historical. The four previously reviewed difference locations remain a closed exception set that can only shrink; they are not extended for new Sales activity.
- For subsequent live differences, the guarded columns are read from migration 010's `REVOKE UPDATE` declaration. The ledger compares `status`, `first_contact`, and `last_contact`; `assigned_to` has no historical frontmatter field and is not invented as one. A changed value is permitted only when immutable, organization-matched contact or stage-transition records explain that exact current value. Contact dates use the business timezone specified by 010, and the source reads run in one read-only repeatable-read snapshot. An unrecorded change, an unrelated column, or a value beyond the recorded projection still fails.
- The existing non-Sales field mutant remains. New synthetic controls prove an unwitnessed Sales date fails, an exact contact witness passes, and a recorded contact cannot excuse a different date.
- Both suites remain PROVEN in the db phase. The manifest edits describe the corrected evidence; they do not change phase, classification, requires, or totality.

## Production-reading db-suite audit

These are all seven db-phase PROVEN entries whose manifest requires a production database binding:

| Suite | Verdict on stale 2E/009 assumptions |
|---|---|
| `pooled-principal.test.ts` | Counts only its own transaction-scoped visibility and isolation fixtures; no frozen six-row total or invalid-status guard-order assertion. |
| `production-2e-consumer-parity.test.ts` | Uses the six rows only as a historical subset witness and compares current Postgres consumers with a second current Postgres read after removing prospect vault discovery. |
| `production-2e-raw-parity.test.ts` | Had the obsolete fixed difference list and unchanged-date assumption; corrected here. |
| `production-2e-source-flip.test.ts` | Limits the six-row expectation to the migrated historical subset or vault control; current source and no-fallback checks are live. |
| `production-app-login.test.ts` | Uses suite-scoped fixture cleanup and event delta; no frozen 2E total or invalid-status guard-order assertion. |
| `production-authorization.test.ts` | Had the obsolete invalid-status error-text assertion; corrected here. |
| `request-isolation.test.ts` | Uses a scratch schema and request-scoped fixtures; no current production-row parity or invalid-status guard-order assertion. |

No additional in-scope stale assumption was found. No other suite was edited.

## Evidence on the corrected worktree

The final controlled focused run passed: raw parity **11 passed, 0 failed**; production authorization **28 passed, 0 failed**. Typecheck and `git diff --check` passed.

Three temporary mutation probes each turned the appropriate focused test red, then restored the source byte-for-byte: an unwitnessed Sales date accepted without provenance (**1 failure**), a generic permission refusal treated as an acceptable status guard (**1 failure**), and removal of the independent CHECK control's assertion (**1 failure**). The final focused run above was after restoration.

The authoritative full selected proof result belongs to the exact-tree gate receipts attached to the Coordinator review round. This checkpoint deliberately does not assert a prospective full-gate result; the builder must obtain green exact-tree `typecheck`, `gate:static`, `gate:server`, and `gate:db` receipts before freeze. A focused run is diagnostic evidence only, never a full-gate receipt.
