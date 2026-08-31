# Risk classification

Classify **before** implementing. When a task spans classes, it takes the highest one that any part of it touches.

## LOW

Copy and content changes · isolated styling · documentation · mechanical refactors with no behaviour change · bug fixes with an obvious, contained cause and an existing test that covers the area.

```
discovery (brief) → implement → test → release
```

## MEDIUM

New feature · multiple files · new API behaviour · meaningful business logic · non-trivial refactor · anything crossing a module boundary · new dependency.

```
discovery → architecture → plan → implement → test → review → release
```

## HIGH

```
discovery → architecture → plan → implement → test → adversarial review → independent review → final gate → release
```

Any one of these forces HIGH, regardless of how small the diff looks:

- authentication, authorization, session, or invitation flow
- RLS policies, principal binding, `asPrincipal`, role grants
- database constraints, schema changes, **any migration**
- organization / tenant isolation, cross-org read or write paths
- event sourcing, the reconciler, provenance, anything writing a witnessed event
- destructive operations — delete, overwrite, truncate, backfill, or anything irreversible
- financial or commercial logic (pricing, retainers, care)
- production database or production environment operations
- changes to core architecture or to a documented contract (`apps/os/docs/*-CONTRACT.md`)
- `cognition/` — and note this layer additionally requires **explicit per-phase user approval**; an unauthorized phase is not a risk to manage, it is a stop

## Diff size is not risk

A one-line change to an RLS policy is HIGH. A three-hundred-line copy update is LOW. Classify by **what the change can break**, never by how much text moved.

Two questions settle most cases:

1. If this is wrong, what is the worst reachable outcome — a visual glitch, or data crossing a tenant boundary?
2. Is it reversible? A migration that has run on production data is not.

## Escalating mid-flight

Discovery routinely reveals that a LOW task touches a HIGH surface. Re-classify immediately and pick up the phases you skipped. Tell the user you re-classified and why — this is normal, not a setback.

Never re-classify **downward** to avoid work. If a phase seems unnecessary for a HIGH change, that is a judgment for the user, stated openly, not a quiet omission.
