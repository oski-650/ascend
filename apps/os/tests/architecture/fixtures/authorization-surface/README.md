Fixtures for F55 — the non-vacuity control for F54 (STAGE2G §25.5).

`violating/` deliberately breaks F54. It is NEVER imported by the application and lives under
`tests/`, which no production fitness rule scans. It exists so the F54 matcher can be shown to go
RED; a rule that has only ever been green has not demonstrated that it can fail.

`clean/` is the same shape written correctly, so the matcher is shown not to flag everything.
