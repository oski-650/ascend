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
4. Run discovery.                Mechanical first, then judgment.
5. CHECK OWNERSHIP.              One of five states, below. Not every state continues.
6. Execute remaining phases.     Each phase gets the smallest sufficient context.
7. Persist artifacts.            references/artifacts.md — only where they will be read again.
8. Verify outputs.               Re-run gates yourself; do not inherit a claim as evidence.
9. Escalate when the rules say to.
10. Release only after the gates pass.
```

## Phase selection

| Risk | Phases |
|---|---|
| **LOW** | discovery (brief) → **ownership** → implement → test → release |
| **MEDIUM** | discovery → **ownership** → architecture → plan → implement → test → review → release |
| **HIGH** | discovery → **ownership** → architecture → plan → implement → test → **adversarial review** → independent review → final gate → release |

Adversarial review is **HIGH only**, plus a MEDIUM change where you can name a concrete reason
independent attack materially improves confidence. Not every task passes through every agent.

Phases are not all subagents. Cost and context decide:

| Phase | Runs as | Why |
|---|---|---|
| Discovery | `discovery` subagent | Keeps file dumps out of the main context |
| **Ownership** | **main thread** | Cheap judgment over discovery's output; can stop the whole run |
| Architecture | `architect` subagent | Boundaries and invariants |
| **Plan** | **main thread** | You hold discovery + architecture; a fresh agent re-derives them at full cost |
| Implementation | `implementer` subagent | Capable coding |
| Test | `tester` subagent | Must be a different agent than the implementer |
| Review | `reviewer` subagent | Independence is the entire value |
| Adversarial | `adversary` subagent | HIGH, or justified MEDIUM |
| **Release** | **main thread** | Needs user authorization and git ownership; never delegate a push |

## Model routing — opus is an ESCALATION, not a default

Optimise **tokens per successful verified work unit** — not tokens per agent, and not agent count.
Use the cheapest model reliably capable of the phase in front of you, and escalate on evidence.

| Phase | LOW | MEDIUM | HIGH |
|---|---|---|---|
| Discovery | haiku ¹ | sonnet | sonnet |
| Architecture | sonnet / main thread | sonnet | **opus** |
| Plan | main thread | main thread / sonnet | main thread / sonnet ² |
| Implementation | sonnet | sonnet | sonnet |
| Test | sonnet | sonnet | sonnet |
| Adversarial | — | only if justified | **opus** |
| Review | sonnet | sonnet | **opus** |

¹ haiku only for genuinely mechanical enumeration — file lists, counts, metadata. The moment
discovery must interpret a contract or reconstruct a stage's status, it is sonnet.
² escalate the plan to opus only when the architecture is unusually intricate; say why.

**Do not downgrade a phase that genuinely needs opus in order to save tokens, and do not wake opus
because a task feels important.** A MEDIUM feature does not get an opus architect, adversary and
reviewer. A HIGH security boundary does not get forced through sonnet because sonnet is cheaper.

Agent definitions now default to the model their phase uses *most often*; the table above is
authoritative, and you override with the `model` parameter when the risk tier calls for it.

### Adaptive routing — five inputs, not one

Risk sets the baseline. Then adjust for:

- **cognitive difficulty** — enumeration vs interpretation vs design
- **context size** — a 2,900-line contract to reconcile is not the same task as a 200-line module
- **failure history** — a phase that has already failed once, or a change that failed review, earns
  an escalation; a third attempt at the same root cause is an escalation *and* a stop
- **model availability** — see below
- **blast radius** — what is reachable if this is wrong

Say in one line why you escalated or downgraded. An unexplained model choice is an unpriced one.

## When the model you need is unavailable

A 429 or a model error is **not a task failure**, and it must never become a silent downgrade.

**REQUIRED model unavailable** — the phase genuinely needs it (opus architecture or opus adversarial
review on HIGH risk):

    → STOP that phase. Preserve every artifact produced so far.
    → Record the phase as BLOCKED_BY_MODEL_LIMIT, with the model, the error, and the reset time.
    → Report it. Resume from the artifact later — do NOT redo completed phases.

**PREFERRED model unavailable** — the phase can run safely one tier down:

    → Record: original model · fallback model · why the downgrade is safe here.
    → Continue, and carry that record into the phase's output and the final report.

Never substitute sonnet for opus without writing down that you did. A downgraded phase whose
provenance is lost is indistinguishable from a phase that never needed the stronger model.

## Resource-aware parallelism

**Reasoning parallelises. Resource-heavy verification does not.**

Run independent reasoning agents concurrently — a second discovery pass on an unrelated subsystem,
or review and adversarial review on the same finished diff. But schedule `gate:db`, `gate:server`,
the full `gate`, and `build` **deliberately**, with no subagents running: parallel agents compete for
CPU and turn a green gate red.

**Never classify a gate failure as contention without a control run.** Re-run the failing files
individually, or the whole gate at HEAD in a worktree. A red gate under load can equally be a real
regression, and a green gate on a quiet machine does not prove the earlier red was imaginary — say
which run carried what load.

## Token accounting

At the end of each work unit, record: task · risk · phases run · model per phase · agents used ·
subagent tokens · retries and 429s · findings · gates run and their outcomes · final state.

The metric that matters is **tokens per successful verified work unit**. Use the record to route
better next time — a phase that repeatedly returns nothing at opus should drop a tier; a phase that
repeatedly needs a second pass at sonnet should rise one.

## Ownership check

Discovery establishes what is true. The ownership check asks a different question: **is this task mine to do?** It runs in the main thread, costs one turn, and can stop the entire workflow before an expensive agent wakes up.

Answer with exactly one state:

| State | Meaning | Next |
|---|---|---|
| `AVAILABLE` | Unblocked, unowned, safe to proceed | Continue to the next phase |
| `OWNED_BY_OTHER_AGENT` | Another session or person is mid-flight on it | **STOP.** Report; change nothing |
| `ALREADY_COMPLETE` | The work exists and the evidence shows it holds | **STOP.** Report the evidence |
| `BLOCKED_BY_HUMAN` | Needs authorization, a product decision, or an action only the user can take | **STOP.** Name what you need |
| `BLOCKED_BY_DEPENDENCY` | A prerequisite phase or gate is locked or unmet | **STOP.** Name the prerequisite |

Only `AVAILABLE` continues. The other four are successful outcomes, not failures — **an autonomous system that always produces a diff is dangerous**, and "nothing for me to change" is frequently the correct answer.

Evidence this check must consider:

- `git status` and file mtimes — uncommitted work belonging to another session is `OWNED_BY_OTHER_AGENT`, and being able to improve it is not a claim on it
- contract and gate documents that mark a stage LOCKED, NOT AUTHORIZED, or closed
- anything requiring a production mutation, a restart, or a credential the user holds
- whether the requested behaviour already exists and passes its gates

When a task decomposes, classify each part separately and continue only on the `AVAILABLE` ones — then say plainly which parts you left and under which state.

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

## Evidence classes — record what actually happened

Every phase and every gate reports exactly one:

    PASSED                  it ran, and it passed
    FAILED                  it ran, and it failed
    BLOCKED                 something prevented it running — name what
    SKIPPED                 deliberately not run — name why
    NOT RUN                 never attempted
    BLOCKED_BY_MODEL_LIMIT  the model the phase required was unavailable (see above)

**SKIPPED is never PASSED. BLOCKED is never PASSED. NOT RUN is never PASSED.** An unavailable
environment, an env-gated suite, or a proof that could not execute is not evidence of success — and
a report that quietly omits it is worse than one that says BLOCKED, because it cannot be corrected
by a reader who does not already know.

Distinguish BLOCKED from SKIPPED honestly: BLOCKED is an obstacle, SKIPPED is a choice. Calling a
withheld decision "blocked" launders it as something outside your control.

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
