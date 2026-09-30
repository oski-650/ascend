# GATE-2G1-006 — deterministic DB proof phase

## Defect and reproduction

The accepted task records three failed full DB-phase runs on the unchanged 2A.3a-2 checkpoint tree. Its production authorization trigger inventory saw four `events` triggers where the assertion expected the two on `public.events`. At the same time, the request-isolation and pooled-principal suites create `events` tables in their temporary production schemas. A later read-only catalog check found neither scratch schema, establishing a scheduling race rather than persistent residue.

The task also records failures in local PGlite suites during those parallel full runs. `STACK_TRACE_ERROR` is Vitest's internal stack marker, not a diagnosis of memory exhaustion. On this task's unchanged promoted baseline, an idle full DB diagnostic passed 703 tests, failed 0, and skipped the 79 recovery tests excluded from this phase. The original schedule overlapped as many as nine suite files in a measured run. This evidence identifies parallel file scheduling as the variable to remove; it does not distinguish CPU pressure from memory pressure in the historical failures. No timeout, retry, test classification, or application behavior is changed.

## Repair

- The production authorization catalog checks name the `public` schema for triggers, policies, constraints, and column grants. They still require the original two triggers, the broad read policy, the identity CHECK, and absence of the prohibited grant. Its existing transactional trigger-removal mutant now checks the same public trigger inventory and sees exactly one trigger, showing the scoped query remains discriminating.
- The DB proof runs all selected DB files serially in one Vitest report. The runner rejects a report whose suite time intervals overlap, so removing or bypassing the serialization flag cannot yield receipts. A synthetic overlapping interval is rejected; touching intervals are accepted. The 35 PROVEN DB suites and recovery exclusions are unchanged.
- Each scratch suite retains its own `afterAll` teardown. The pooled-principal teardown now uses a fresh verified admin connection even if its subject pool became unusable. After every DB Vitest exit, including a failed assertion or exited worker, the runner independently drops only the two reserved scratch schemas if present and verifies they are absent. Cleanup failure prevents receipts. An abrupt termination of the entire gate process still requires the normal read-only residue check before another run.

## Controlled evidence and limits

Before the final commit, the serialized full DB diagnostic passed 703, failed 0, skipped 79; an immediate read-only check found zero production scratch schemas. The original parallel schedule also passed on the idle machine, which is why historical intermittent PGlite failures cannot honestly be called a runtime regression or a proven memory defect. The final candidate must pass three consecutive exact-tree full DB-phase executions, each followed by read-only scratch-schema verification. Receipts for static, server, and DB phases must be checked on that same tree before freeze; this document cannot embed those later run results without changing the tree they attest.

The repair uses no production tables beyond the existing proof suites' rolled-back operations and reserved temporary schema lifecycle. It makes no application, migration, gate-classification, or Coordinator change. It does not claim a focused diagnostic as a full gate receipt.
