---
name: engineering-workflow
description: Run a request through phased engineering — discovery, architecture, plan, implement, test, review, release — with the phase set chosen by risk. Use when a change is non-trivial, crosses module boundaries, or touches auth, persistence, migrations, tenant isolation, or provenance. Also use when asked to "do this properly", "full workflow", or when a change has already failed review once.
---

# Engineering workflow

Turn a request into a verified repository change, spending reasoning where the difficulty actually is.

The goal is not maximum agent activity. It is **the smallest number of capable agents doing the right cognitive work at the right time.**

## First: do not use this skill for everything

Most requests do not need it. A copy change, a one-line fix, a question about the code — answer it directly. Invoking a seven-phase workflow on a two-line change is a failure of judgment, not an abundance of rigour.

Use it when a change is genuinely non-trivial, or when the risk triggers in `references/risk.md` fire.

## The loop

```
1. Understand the task.          Read the request literally. Note every sentence that is a requirement.
2. Classify risk.                references/risk.md — LOW / MEDIUM / HIGH.
3. Select phases.                Table below. Justify any phase you skip, in one line, to the user.
4. Execute in dependency order.  Each phase gets the smallest sufficient context.
5. Persist artifacts.            references/artifacts.md — only where they will be read again.
6. Verify outputs.               Re-run gates yourself; do not inherit a claim as evidence.
7. Escalate when the rules say to.
8. Release only after the gates pass.
```

## Phase selection

| Risk | Phases |
|---|---|
| **LOW** | discovery (brief) → implement → test → release |
| **MEDIUM** | discovery → architecture → plan → implement → test → review → release |
| **HIGH** | discovery → architecture → plan → implement → test → **adversarial review** → independent review → final gate → release |

Phases are not all subagents. Cost and context decide:

| Phase | Runs as | Model | Why |
|---|---|---|---|
| Discovery | `discovery` subagent | haiku | Mechanical enumeration; keeps file dumps out of the main context |
| Architecture | `architect` subagent | opus | The hardest reasoning in the workflow |
| **Plan** | **main thread** | — | You hold discovery + architecture already; a fresh agent would re-derive them at full cost |
| Implementation | `implementer` subagent | sonnet | Capable coding, not expensive reasoning |
| Test | `tester` subagent | sonnet | Must be a different agent than the implementer — see below |
| Review | `reviewer` subagent | opus | Independence is the entire value |
| Adversarial | `adversary` subagent | opus | High-risk only |
| **Release** | **main thread** | — | Needs user authorization and git ownership; never delegate a push |

Run independent phases in parallel where they do not depend on each other — a second discovery pass on an unrelated subsystem, or review and adversarial review on the same finished diff.

## The rule that carries the most weight

**The agent that implements a change is never the sole authority that it is correct.**

Whenever practical, the tester is a different agent than the implementer, and the reviewer is a different agent than both. An implementer verifying its own work reliably finds its own assumptions reasonable.

## Context discipline

Pass forward the artifact, not the transcript. Never hand a phase the whole conversation or the whole repository.

```
REQUEST → DISCOVERY REPORT → ARCHITECTURE → PLAN → (plan + relevant files) → DIFF + TEST RESULTS → REVIEW
```

Do not rediscover the repository at every phase. If you find yourself re-reading files a prior phase already reported on, the artifact was too thin — fix the artifact.

## Evidence over confidence

Every agent labels claims **FACT / INFERENCE / ASSUMPTION / UNKNOWN**, and so do you when reporting to the user.

Do not say a change works because the code looks right. Evidence is: a passing gate, a type check, a build, a query result, a reproduction. A subagent's report is a **claim** — for anything high-risk, re-run the gate yourself before repeating it to the user.

Treat a handoff or checkpoint summary as a **hypothesis to verify**, not a finding. Where a packet and the repository disagree, the repository wins.

## Verification vocabulary

```bash
npm --prefix apps/os run typecheck     # tsc --noEmit
npm --prefix apps/os run gate:static   # engine + source-text tests
npm --prefix apps/os run gate:server   # tests/render/
npm --prefix apps/os run gate:db       # tests/db/
npm --prefix apps/os run gate          # all three, in order
npm --prefix apps/os run build
```

Architecture in this repo is enforced by tests (`apps/os/tests/architecture/`), not only by documents. A design change that no fitness test would catch is a design change that will not hold.

## Escalate to the user when

- requirements conflict, or the repository contradicts the plan
- the change requires an architectural change not yet agreed
- a security or tenant boundary is affected in a way the plan did not anticipate
- a destructive or production operation is required — **build it inert and stop**
- a `cognition/` phase beyond the authorized one is needed
- repeated fixes fail (two failed attempts at the same root cause: stop, report, do not attempt a third blind)
- you cannot establish correctness with the evidence available

Escalation is stating what you found and what you need. It is not a request for permission to keep guessing.

## Release

Never push merely because implementation finished. Before release:

- working tree understood — **`git status` first.** Multiple sessions share this tree; uncommitted files may belong to another session. Never stage what you did not write.
- gates pass, and you ran them
- required review gates satisfied for the risk class
- diff inspected in full, containing no unrelated work
- commit message describes the change accurately

Commit or push **only when the user asks.** Never force-push, never disable a check to make a task pass, never commit secrets.

## Definition of done

1. The requested behaviour exists — all of it, checked sentence by sentence against the request.
2. Behaviour that had to stay intact still works.
3. Relevant tests pass, and you have their output.
4. Type check and build pass where appropriate.
5. Architecture was not violated.
6. High-risk changes received adversarial review.
7. The diff contains no accidental unrelated work.
8. The repository is releasable.

Code written is not the same as task complete. If part of the scope is blocked, finish everything else and say plainly what you left and why — scaling the work down is the user's call.

## References

- `references/risk.md` — classification, and the repo-specific triggers that force HIGH
- `references/artifacts.md` — artifact templates and when they are worth writing
