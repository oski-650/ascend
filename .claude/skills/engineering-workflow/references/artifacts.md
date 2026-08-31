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
## Implementation sequence   — ordered; mark BINDING items the implementer may not vary
## Integration points
## Testing requirements
## Acceptance criteria   — each independently checkable
## Risks
## Rollback
```

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
