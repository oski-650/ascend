# Artifacts

Artifacts exist so a later phase does not re-derive what an earlier one established. Write one when it will be **read again** — by a later phase, a reviewer, or the user in a future session.

Do not create artifacts for ceremony. On a LOW-risk change, the report in the conversation is the artifact.

## Where they go

Working artifacts for an in-flight task: the session scratchpad, or `.discovery.md` / `.architecture.md` / `.plan.md` / `.review.md` in the working directory — untracked, deleted when the work lands.

Durable artifacts belong in `apps/os/docs/`, following the conventions already there:

- `*-CONTRACT.md` — a boundary's contract, written and committed **before** the implementation it governs
- `*-GATE-REPORT.md` — the evidence that a stage closed, as claim → result tables

## Templates

### DISCOVERY REPORT

```
## Request restated
## Where the behaviour lives          file:line
## Existing contracts that govern it
## Existing tests that cover it
## Established patterns to follow
## Dependencies and blast radius
## Risks
## FACT / INFERENCE / ASSUMPTION / UNKNOWN
```

### ARCHITECTURE

```
## Problem the design must solve
## Decision
## Boundaries and ownership
## Interfaces
## Data flow
## Invariants          — and where each is ENFORCED, not merely stated
## Failure modes
## Compatibility and migration
## Testing strategy
## Alternatives rejected, and why
## Open questions for the user
```

### IMPLEMENTATION PLAN

```
## Objective
## Scope
## Non-goals             — what this deliberately does not do
## Invariants to preserve
## Affected areas
## MANIFEST IMPACT          — MANDATORY for any slice that adds, removes or renames a file
## Implementation sequence   — ordered; mark BINDING items the implementer may not vary
## Integration points
## Testing requirements
## Acceptance criteria   — each independently checkable
## Risks
## Rollback
```

### MANIFEST IMPACT — mandatory, and not from memory

**A plan for an implementation slice is incomplete without this section.** It exists because the same
omission broke `gate:static` twice in consecutive slices: 2G.4.1 needed a manifest entry, it was
fixed, and 2G.4.2's plan then omitted it again and reproduced the identical failure. The lesson lived
in one person's recollection instead of in the template.

Answer every line explicitly. "None" is a valid answer; a blank is not.

    files ADDED                    → which manifests must gain an entry?
    files REMOVED / RENAMED        → which manifests must lose or change one?
    exports or registrations moved → who imports the old path?
    generated / index / barrel     → does anything enumerate this directory?
    verification                   → which gate asserts the manifest, and have you RUN it?

**Ascend-specific registries a new or moved file may need to appear in.** Derive this list from the
repository rather than trusting the one below — it is a starting point that will rot, not an
authority:

    tests/architecture/gate-2g1.ts   GATE_2G1 — asserts set-equality with every *.test.ts on disk.
                                     A new test file WILL fail gate:static without an entry.
                                     Note the phase field must agree with the directory.
    core/auth/routes.ts              ROUTE_AUTHORIZATION — F49 asserts set-equality with app/api/**
    tests/architecture/page-authorization.ts   PAGE_AUTHORIZATION — F51 pairs it with app/**/page.tsx
    navigation/destinations.ts       NAV_DESTINATIONS — F56 holds it equal to the page declarations
    core/db/migrate.ts               MIGRATIONS — the ordered schema list
    tests/support/route-surface.ts   ROUTE_IMPORTERS — hand-written; F60 forbids a second copy

**The verification line is the one that actually catches it.** Naming the gate is not enough — the
plan must say which gate was run and what it returned. A new file under `tests/db/` is asserted by a
rule that runs under `gate:static`, so running `gate:db` alone will miss it. That is precisely the
mistake that produced the second failure.

A plan states **what must be true and why**. It does not prescribe line numbers, variable names, or obvious mechanics — the implementer decides those. Write:

> Add membership integrity enforcement at the persistence boundary.

not:

> Open file X at line 143 and add function Y.

### TEST REPORT

```
## Cases derived, and the invariant each attacks
## Tests added            path → what it would catch
## Results                command → actual output
## Defects found          severity + reproduction
## Coverage gaps I could not close, and why
```

### REVIEW

```
APPROVE | REQUEST_CHANGES | ESCALATE

## Why
## Findings              severity · file:line · what breaks · reproduction
## Requirement coverage checklist
## Adjacent observations (not blocking)
```

## Writing rules

- Record what was **actually run**, never what was intended to run. A gate report that says a step ran when it did not is the most expensive defect this repo has produced — it has happened, and it was caught late.
- State the negative explicitly: "production migration NOT run", "acceptance NOT executed". Silence reads as done.
- Prefer claim → result tables over narrative for evidence.
- Convert relative dates to absolute.
- When an artifact is amended, say what changed and why the earlier version was wrong. Do not silently rewrite history.
