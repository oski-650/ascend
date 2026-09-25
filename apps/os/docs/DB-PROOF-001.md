# DB-PROOF-001 — database proof failure diagnosis (public report)

**Candidate:** the committed 2A.2d candidate tree identified in the private Coordinator diagnostic. The 2A.2d implementation was not changed. This diagnosis made no deployment or production write.

**Evidence:** a retained controlled Vitest JSON report records 777 tests: 682 passed, 17 failed, and 78 skipped. Its 11 failed suite records belong to five test files. The operator verified afterward that diagnostic fixtures and scratch schemas were cleaned up. The JSON reporter compresses expected/actual arrays; one focused, read-only raw-parity assertion on the same candidate tree identified the four field mismatches below. A separate read-only transaction checked row-update and audit-event relationships without emitting row contents. No credentials or connection details were printed.

## 1. Failure classification

| File | Failed assertions | First concrete failure | Classification |
|---|---:|---|---|
| `tests/db/production-2e-consumer-parity.test.ts` | 9 | The prospect list expected the historical six-record 2E fixture and received `[REDACTED: current production materially exceeds the historical 2E fixture baseline]`. Matching, forecast, brief, pipeline, graph, and knowledge-index comparisons inherit the larger current set; target context also observes a changed record. The final "all ten" assertion is secondary: failing comparisons never populate its results map. | **Stale historical parity expectation** after expected post-flip production expansion. No application regression is established. |
| `tests/db/production-2e-raw-parity.test.ts` | 1 | Four fields of the six vault-mirrored rows differ; field-level categories appear below without row identities or values. Its other eight assertions passed. | **Production/vault data drift** and a stale expectation that the frozen vault still equals live production. Field-level provenance has the limits noted below. |
| `tests/db/production-2e-source-flip.test.ts` | 2 | Both failing checks expect six Postgres prospects and receive `[REDACTED: current production materially exceeds the historical 2E fixture baseline]`, including when the vault path points at an empty directory. | **Stale six-row expectation.** The empty-vault probe still demonstrates that the Postgres reader did not silently fall back to the vault; no source-flip regression is evidenced. |
| `tests/db/production-app-login.test.ts` | 1 | The RESIDUE test expects the historical 41 total `events` and observes `[REDACTED: current production event total exceeds the historical 2E baseline]` at line 291. | **Stale absolute event baseline**, a residue-assertion defect. The current total alone does not prove this suite wrote an event. |
| `tests/db/request-isolation.test.ts` | 4 | Each failed test errors with `column "archived_at" does not exist` before its backend-PID or crossover assertion can run. | **Scratch-schema harness defect**, not an observed timing or request-scope failure. |

Repository history documents an authorized post-2E lead-list import and the deployed Postgres source of truth; the vault is a frozen rollback copy. Current record and event totals therefore exceeding the old fixture is expected post-flip drift, not evidence of a new import during this diagnostic. Do **not** overwrite either store to make historical parity tests green.

### Exact failing test names

These are test titles from the committed repository; no assertion payloads are reproduced.

| Suite file | Failing test titles |
|---|---|
| `production-2e-consumer-parity.test.ts` | `1 · prospect list — same prospects, same order, every field raw`; `3 · sales/automations matching — same prospects, scores, tiers, statuses`; `5 · forecast — identical, weighted pipeline included`; `6 · operator brief — identical`; `7 · pipeline digest — identical`; `8 · graph projection — same prospect nodes`; `9 · knowledge index — identical`; `10 · compileTargetContext — the other body consumer — identical`; `ALL TEN consumers compared, and the list is complete` |
| `production-2e-raw-parity.test.ts` | `EVERY frontmatter field survives, raw — including empty strings` |
| `production-2e-source-flip.test.ts` | `FLIPPED: every prospect resolves through Postgres`; `NO CONSUMER SILENTLY READS THE VAULT — proven by taking the vault away` |
| `production-app-login.test.ts` | `RESIDUE: this suite's fixtures are the only rows it added, and it wrote no event` |
| `request-isolation.test.ts` | `PART 1 · four requests are inside their contexts SIMULTANEOUSLY — proven by a barrier`; `PART 3 · repeated interleaved rounds produce ZERO crossover`; `PART 3 · a request that THROWS leaves no principal behind for the next one`; `with the request-scoped store replaced by ONE SHARED SLOT, requests cross over` |

### Four raw differences, in assertion order

| Historical fixture / field | Observed difference | Provenance and limit |
|---|---|---|
| Fixture A · `website` | `[REDACTED: current authoritative value differs from frozen historical vault]`; the difference is URL canonicalization. | A matching website-research audit event and row update were observed after the historical parity checkpoint. This supports a subsequent research update; the URL and timestamp are withheld. |
| Fixture A · `website_quality` | `[REDACTED: current authoritative value differs from frozen historical vault]`. | Same later research-event relationship. The underlying judgment and exact values are withheld; its reasoning was not independently audited here. |
| Fixture B · `name` | `[REDACTED: current authoritative value differs from frozen historical vault]`; the difference is display encoding. | A later row update was observed. A name-specific audit event was not established, so authorization/provenance of the edit is **not independently proven** here. |
| Fixture C · `name` | Same display-encoding difference. | Same provenance limit as Fixture B. |

The frozen vault remains a valid historical migration witness, but cannot serve as a timeless equality assertion against an active production source. The two display-encoding changes must not be labeled authorized data corrections from this evidence alone. No data repair is proposed by this task.

### RESIDUE timing

`production-app-login.test.ts` creates three prefixed fixtures in `beforeAll`; the RESIDUE assertion runs as a normal `it`, **before** `afterAll` deletes them. Zero diagnostic fixtures after the run is therefore consistent with the in-run fixture count of three. The failing assertion compares a global, historical event constant with `[REDACTED: current production event total]`. The preceding "real prospects = 6" query passes because `slug NOT LIKE <fixture prefix>` excludes current imported rows with `NULL` slugs; it does not count all production prospects. The exact event delta attributable to this suite was not measured against a pre-suite event baseline, so zero event writes must not be inferred from the global count or from row cleanup. A repaired assertion must compare a captured before/after event baseline or another discriminating suite-scoped measure.

### Request-isolation control

`request-isolation.test.ts` builds its scratch schema from migrations **001–005** (`MIGRATIONS` at lines 66–71). The current `core/db/prospects.ts` reader queries `archived_at`, introduced by `009_prospect_archival.sql`. All four reported errors are the same missing-column error. The barrier is reached before the reader query (`request` lines 229–248); the missing column prevents the distinct-backend and zero-crossover assertions from being evaluated. Nothing in these failures establishes connection-pooling serialization, timing trouble, authority crossover, or an authorization/session regression. The negative control for a non-overlapping barrier passed. The smallest plausible harness repair is to bring the scratch schema to at least migration 009 and rerun the unchanged concurrency assertions; migration dependencies must be checked in the fix task.

## 2. Smallest separate fix tasks — proposals only

No fix was started. Each proposed task needs its own Coordinator authorization and review.

| Proposed task | Concern | Exact allowed write paths | Required proof |
|---|---|---|---|
| `DB-PARITY-001` | Replace obsolete timeless six-row parity assumptions with a test of the historical six-row migration witness and a separate current-source assertion. Preserve a discriminating empty-vault/source-flip control; account for observed field differences without treating either source as automatically correct. | `apps/os/tests/db/production-2e-consumer-parity.test.ts`, `apps/os/tests/db/production-2e-raw-parity.test.ts`, `apps/os/tests/db/production-2e-source-flip.test.ts` | Focused three-file controlled DB proof, including a control that fails on a real source or field regression. No production data writes. |
| `DB-RESIDUE-001` | Replace the absolute 41-event assertion with a before/after, suite-scoped no-event check; make the nonfixture prospect check honest about `NULL` slugs. Preserve cleanup verification. | `apps/os/tests/db/production-app-login.test.ts` | Focused controlled login suite with verified pre/post fixture cleanup and a discriminating event-delta check. |
| `DB-ISOLATION-001` | Update the request-isolation scratch schema to the minimum migration level required by its current reader. Keep the barrier, backend-session, and cross-tenant mutation controls intact. | `apps/os/tests/db/request-isolation.test.ts` | Focused controlled isolation suite proving the real implementation, its negative barrier control, and its deliberately leaking mutant. Verify scratch-schema cleanup. |

No Sales feature, runtime, authorization/session, gate runner, or Coordinator change is justified by the observed failures. The exact parity repair design must respect the provenance limit above; blanket value normalization would weaken the original 2E check.

## 3. Proof receipts and 2A.2d

`scripts/gate-proof.mjs` binds every receipt to the exact Git tree, manifest hash, suite hash, and phase. Focused diagnostic tests are **not** full `gate:db` receipts. Each fix changes the tree and requires fresh applicable proof; receipts from a prior tree cannot be reused. After all authorized fixes are promoted and 2A.2d is refreshed onto that baseline, the **final combined candidate tree** needs fresh `gate:static`, `gate:server`, and full controlled `gate:db` runs, plus `typecheck` as required by 2A.2d. Any recovery/full-gate claim likewise needs its own current-tree receipt under the existing recovery procedure. Do not freeze or publish 2A.2d from this diagnostic or treat the failed run as a pass. Its implementation can remain untouched.

## 4. Commands and safety record

- Read the retained Vitest JSON and extracted assertion names/messages with credential-like strings redacted; the private diagnostic path and raw assertion output are withheld from this report.
- On the exact 2A.2d candidate tree, ran only `production-2e-raw-parity.test.ts` filtered to `EVERY frontmatter field survives` with the verbose reporter. Result: **1 failed, 8 skipped**; it exposed only the four field differences classified above. This test makes read-only SQL queries.
- Used a short-lived, external diagnostic script with the repository's pinned certificate and verified TLS, `BEGIN READ ONLY`, a narrowly scoped timestamp check, and aggregate audit-event types. It ended with `ROLLBACK`. It produced no production mutation or credential output.
- Did not rerun the entire production DB gate, run `production-app-login` or `request-isolation` again, change the vault, or use production to satisfy unrelated gates.
