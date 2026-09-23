# Ascend Agent Coordinator v0.1

The full protocol and schemas are in [ARCHITECTURE.md](./ARCHITECTURE.md). The coordinator uses Git refs only. It does not deploy or access production.

## Agent startup

From the repository root, export `ASCEND_AGENT=codex` or `ASCEND_AGENT=claude`, then run:

```sh
npm run agent -- next --as codex
npm run agent -- next --as claude
```

Use `--json` for machine-readable output. `next --wait 60` waits up to 60 minutes for actionable work. Follow the returned command and path scope. A builder edits only the task's allowed paths in its claimed worktree. A reviewer uses the detached worktree created by `review-start` and submits a result file using `review-result`.

## Human status and setup

```sh
npm run agent -- status
npm run agent -- verify
```

Human administration requires `ASCEND_AGENT` to be unset, `--human <name>`, `--reason <text>`, and an interactive confirmation. `admin init` must only be run after the baseline exists on the remote and the owner authorizes creating `agents/coord`. This implementation is validated in local fixture repositories; it does not initialize the live ref.

## State machine

`AVAILABLE → IMPLEMENTING → PUBLISHED → REVIEWING → ACCEPTED → PROMOTED` is the normal path. A blocking review gives `REVIEWING → FIX_REQUIRED → PUBLISHED` with a new round. The builder may withdraw a review before it starts or reopen an acceptance to make changes. Invalid review objects or decisions requiring human input enter `BLOCKED`. `ABANDONED` and `PROMOTED` are terminal. Locks are held in every state from IMPLEMENTING through ACCEPTED, and in BLOCKED. They never expire automatically.

Every state change appends an event to the hash-chained `activity.jsonl` on `agents/coord`. Task JSON files are checked against replay of that log. Review manifests and results are write-once on the same ref. Review refs are create-only and point to the exact commit SHA.

## Emergency override

Inspect `status` and `verify`, confirm the old builder's worktree is safe, then run:

```sh
env -u ASCEND_AGENT npm run agent -- admin release TASK_ID --human oscar --reason "why this lock is being released"
```

Type `TASK_ID` at the TTY prompt. The command records `lock.released` with `override:true`; it never silently expires a lock. If a review ref moved, restore it to the recorded SHA and use `admin unblock`, or release and create a new review round. If coord was manually amended by a normal non-force commit, run `admin attest-repair` with a reason after validating its files; a rewritten coord ref must be restored instead.

## Local verification

```sh
node --test tools/agent/test/*.test.mjs
```

Tests create throwaway bare repositories and separate clones under the system temporary directory. They do not use the configured GitHub remote.
