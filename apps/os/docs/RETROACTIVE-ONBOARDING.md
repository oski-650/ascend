# Retroactive Onboarding — CLOSED

**Applied to the live vault 2026-08-26.** Two clients Oscar confirmed in the H0 inventory had no vault presence at all. The historical backfill *corrected* records that existed; it never created one — so the original question, *"how do I add my past projects without manually inputting them,"* was still unanswered for the two that actually needed adding.

```text
backup   ~/ascend-vault-backups/ascend-vault-pre-onboarding-20260826-023859.tar.gz
         outside iCloud · restore-verified byte-identical to live BEFORE the run
         (the pre-migration backup was no longer a complete restore point)
created  bedollas-landscaping · the-best-house-cleaning-team
```

> **Entity existence ≠ entity facts.** The brain may know a client existed without knowing what happened.

---

## Result — the ledger diff is four lines

```text
+ client bedollas-landscaping          phaseState=indeterminate prog=null health=null/null rev=null
+ client the-best-house-cleaning-team  phaseState=indeterminate prog=null health=null/null rev=null
- graph subjects=82 relationships=78
+ graph subjects=96 relationships=90
```

Everything else is byte-identical:

```text
signals          4 → 4     no signal appeared or disappeared
operator events  10 → 10   §19 untouched
sync transitions 0
re-plan          empty
system events    4         client.created ×2, project.created ×2
```

## What was recorded, and what was refused

| | recorded | refused |
|---|---|---|
| **confirmed** | client, tier (growth / starter), website | — |
| **derived** | repository, creation date, commit days — as *prose evidence* | any conversion of a commit date into a project date |
| **unknown** | phases, launch date, contract value, contacts, industry — each with the reason | defaults, empty-string "facts", plausible brand values |

The scope body carries the discipline in the file itself:

> *6 commits on 2026-07-24 and 1 on 2026-08-10. PROVES code was written on those days. Does NOT prove the project began on 2026-07-24, nor that it launched on 2026-08-10.*

---

## Three decisions this increment forced

### 1 · `status` is omitted, not written as `"unknown"`

"The engagement is over" does not establish `maintenance`, and `status` is **behaviour-bearing** — it is the sole trigger for `launched_no_retainer` and `launched_checkin`. Writing it would have turned an inference into an actionable OS claim, and the first snapshot run did exactly that: two `launched_no_retainer` signals appeared from a field nobody had confirmed.

Omitting beat writing `"unknown"`, and the difference is not cosmetic:

```text
omitted            observeClients skips the client ("no status field"). When a status is
                   eventually recorded, that is a FIRST SIGHTING — observation.captured only.
                   A baseline is not a birth.
status: "unknown"  the client is observed, and a later `unknown → maintenance` hits the client
                   path in core/reconciler, which has NO epistemic guard (unlike phases). It
                   would emit client.status_changed — claiming the business changed status
                   when Ascend merely learned it.
```

The existing skip-then-baseline machinery gives the right event semantics for free. Pinned by a test that sets a status afterwards and asserts a baseline, not a `client.status_changed`.

### 2 · `createProject` would have fabricated a checklist

The template scaffold writes 17–23 `- [ ]` items, each asserting *that step was not done*. For work that really happened and was simply never tracked that is false — and `[x]` would be equally false. A checkbox cannot say `unknown`.

`core/production.createProject` gained a `retroactive` mode: phases block only, every phase `unknown`, no checklist, no `industry_template` (a defaulted "generic" being exactly what the migration removed from every other client).

### 3 · `actor` is threadable, defaulting to `operator`

The normal path is unchanged — a client created through the OS genuinely is operator activity. Onboarding passes `system`, because reconstructing a client who has existed since May is not the operator working in the OS today, and §19 counts precisely that difference.

---

## Enforcement — F27

- no surface, engine or runtime module may import `onboarding/`
- every `createClient` / `createProject` call passes `actor` explicitly
- no historical business event type (`project.phase_*`, `project.launched`, `invoice.*`, `payment.*`) may appear
- the four retired `project_scope` keys may not be written back into a fresh client — creating one is the easiest place to reintroduce them unnoticed
- subjects are declared as data in one place, so the universe cannot grow by accident

`onboarding/` is also in F12's and F21's scan roots: a new top-level directory is invisible to every rule until it is named in one.

**21 acceptance gates** (O1–O6), **572 tests pass**.

---

## Still open

Unchanged by this increment: `ASSUMED_DEAL_VALUE`, `56eb0b57`'s provenance, Bay Area Custom Shirts' error-record vocabulary, `ProjectStatus`, tier verification.

Newly recorded, from the structural view of the migrated vault:

1. **Seeded approvals survived** — `seed-approval-pilar-design`, `seed-approval-pilar-launch`. The migration registry has no `approval_requests` source; the coverage matrix listed it and the registry never got a row.
2. **The test-session window may be too narrow** — five audits cluster on 2026-06-20 between 23:17 and 23:51, but `TEST_SESSIONS` starts at 23:20, so four sit just outside it. The boundary was drawn from the artifacts found rather than derived.

Neither is a reason to reopen the migration.
