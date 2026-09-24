# Ascend Agent Coordinator v0.1 — Architecture / Preflight

**Status: DESIGN ONLY. Nothing implemented. No tracked file touched, no push, no production contact.**
Author: Claude (architect role) · 2026-09-23.
Location: `.git/ascend-agent/`. This is invisible to `git status` and to worktree fingerprints, so it cannot disturb the active 2A.2c slice. Commit it as `tools/agent/ARCHITECTURE.md` inside task `COORD-0.1` once authorised.

---

## 0 · Measured environment (facts the design depends on)

| # | Fact | Consequence |
|---|---|---|
| E1 | Repo root is `ascend/` (git toplevel). Ascend OS lives in `apps/os/`. Root `package.json` is the marketing site. | Coordinator paths are **repo-root-relative** (`apps/os/core/db/sales-reads.ts`, not `core/db/...`). |
| E2 | Package manager is **npm** (`package-lock.json` in root and `apps/os`). pnpm is not used. | Commands are `npm run agent -- <cmd>` → `node tools/agent/agent.mjs <cmd>`. Introducing pnpm would change lockfiles, so it is not proposed. |
| E3 | git 2.50.1, node v24.12. | `git merge-tree --write-tree` (≥2.38) and `node --test` are available, so zero npm deps are needed. |
| E4 | One remote: `origin = github.com/oski-650/ascend`. Both agents are assumed to push as the same GitHub identity. | Git ref permissions **cannot distinguish Codex from Claude**. Identity in v0.1 is declared, not authenticated (§13). |
| E5 | Local `hardening/p0-p1-production` = `ededb09c…`; `origin/hardening/p0-p1-production` = `41db1183…`, **22 commits behind**. | Today the canonical baseline exists only on Oscar's Mac, and a cloud reviewer cannot see it. Adoption requires one authorised fast-forward push (§15). |
| E6 | `origin/review/2a2c` = `e4abe22c…` and `origin/review/2a2c-fix1` = `ededb09c…` (= local HEAD). Both are already in dev-branch history. | In current practice, review branches are pointers into a dev branch that advanced **before** acceptance. v0.1 inverts this: dev advances **only** by `promote`. |
| E7 | The 2A.2c review was split across two worktree fingerprints (`3361c5b…` → `62ccddc…`) because Codex edited nine files mid-review. | Root cause: **the review object was a mutable working tree**. v0.1 makes the review object an immutable pushed commit. |
| E8 | The repo is on iCloud-synced Desktop, and sync creates `"<name> 2.<ext>"` conflict copies. | `freeze` must refuse these by name pattern. |
| E9 | macOS has no `timeout`. | The tool must not shell out to `timeout`. Gate commands run via `child_process` with the tool's own timer. |

---

## 1 · Goals / non-goals

**Goals (v0.1)**
1. Git is the only transport, and one Git ref is the only coordination source of truth.
2. An agent starts a session with one command (`next`) and receives a complete, deterministic assignment.
3. A review binds to one full commit SHA, and local edits by the builder **cannot** move it.
4. Only the exact accepted bytes reach the development baseline, with proof.
5. Path-level write locks allow disjoint parallel work.
6. Every state change is an append-only, hash-chained event, and task state can be replayed from the log.
7. Oscar approves and overrides. He no longer relays.

**Non-goals (v0.1)**
- Deployment, migrations, production access, secrets, credential handling.
- Authenticated agent identity (identity is declared and audited only, not cryptographically enforced).
- Automatic waking of idle agents (an agent session must be running; `next --wait` polls).
- PR/GitHub-API integration, CI-hosted gates, web UI.
- Sub-file (region) locking, and multiple writers per task.
- Automatic rebase or conflict resolution.

---

## 2 · The design in one paragraph

There are **three kinds of refs and nothing else**:
1. The **baseline ref** (`hardening/p0-p1-production`, configurable). Only `promote` advances it, and only to an accepted SHA or a verified overlay-merge of one.
2. **Review refs** `review/<slug>-r<N>`. They are write-once, and each points at the exact commit under review.
3. The **coordinator ref** `agents/coord`. It is an orphan branch holding all coordination state. Every mutation is one commit pushed **without force**. Git's non-fast-forward rejection acts as the compare-and-swap, so updates are serialised without any lock server, timestamps or shared filesystem.

Locks, inboxes and "whose turn is it" are all **derived** from task records on that ref.

A review is of a pushed commit object, so a builder editing local files cannot affect what the reviewer sees. This **removes the moving-tree failure structurally**. What remains is detecting that a *ref* moved, and every review command checks for that.

---

## 3 · State machine

### 3.1 Simplifications from the candidate (justified)

| Candidate | v0.1 | Why |
|---|---|---|
| AVAILABLE, ASSIGNED | **AVAILABLE** | Assignment is a field (`builder`, `reviewer`) set at task creation. A separate "assigned but not started" state holds no lock and has no effect. |
| FROZEN_LOCAL, PUBLISHED_FOR_REVIEW | **PUBLISHED** | A state visible only on the builder's machine is not coordination state. `freeze` is one idempotent command: commit → gates → push the review ref and coord together. If the push fails, coord still says IMPLEMENTING, which is true, because nobody else can see the commit. |
| COMMITTING, COMMITTED | **PROMOTED** | In a Git transport the implementation is already committed at freeze. The remaining act is advancing the baseline ref. That is one push, recovered idempotently by re-running `promote`, so no in-between state is needed. |
| — | **ABANDONED** (new) | Lets a human terminate a task and release its locks with an audit trail. |

### 3.2 States

`LOCK` = the task's `write_paths` are locked against every other task.

| State | Meaning | Actor who may act | Allowed writes | LOCK | Invalid when |
|---|---|---|---|---|---|
| **AVAILABLE** | Task defined, not claimed. | builder (claim), human | none to feature paths | no | `round>0` with no record of how it returned (only `release` may return here) |
| **IMPLEMENTING** | Builder holds the task and edits in **its own worktree**. | builder | builder: files matching `write_paths`, in the claimed worktree only | yes | no `claim` record; builder ≠ claimant; overlaps another lock-holder |
| **PUBLISHED** | Round N review object pushed, awaiting reviewer. | reviewer (start), builder (withdraw) | **none** to feature paths for this task | yes | `review/<slug>-r<N>` absent or ≠ `review_sha`; no `reviews/<id>/r<N>.json` |
| **REVIEWING** | Reviewer is bound to (round N, `review_sha`). | reviewer | reviewer: a disposable detached review worktree (never pushed), plus the one result object via `review-result` | yes | same as PUBLISHED; `review.reviewer_session` missing |
| **FIX_REQUIRED** | Blocking findings returned to the builder. | builder | builder: `write_paths` in its worktree | yes | no `rN.result.json` with verdict FIX_REQUIRED for the current round and no system finding |
| **ACCEPTED** | Round N SHA accepted; bytes fixed. | builder/human (promote), builder (reopen) | **none** | yes | `accepted_sha` ≠ `rN.result.json.reviewed_sha`; object missing; tree ≠ `accepted_tree` |
| **PROMOTED** | Baseline contains `accepted_sha` (terminal). | — | none | no | `accepted_sha` not ancestor of baseline ref |
| **BLOCKED** | Needs a human decision (`blocked.reason`). | human | none | **yes** (kept) | `blocked.from` missing |
| **ABANDONED** | Terminated by a human (terminal). | — | none | no | — |

### 3.3 Transitions (complete; anything not listed is refused)

| ID | Command | Actor | From → To | Preconditions (all must hold) | Side effects |
|---|---|---|---|---|---|
| T1 | `admin task-add` | human | ∅ → AVAILABLE | valid schema; unique id/slug; path patterns valid; prerequisites exist | writes `tasks/<id>.json`; `task.created` |
| T2 | `claim` | builder | AVAILABLE → IMPLEMENTING | `--as` == `task.builder`; all prerequisites PROMOTED and their `promoted_sha` ancestors of baseline tip; no overlap with any lock-holding task (§7); agent holds no other task in IMPLEMENTING/FIX_REQUIRED; worktree not bound to another active task | sets `claim{session,host,worktree_id,seq}`, `baseline_sha` = current baseline tip; `task.claimed` |
| T2r | `claim --resume` | builder | IMPLEMENTING/FIX_REQUIRED → same | same agent; new session/worktree (after crash) | updates `claim`; `task.claim_resumed` (old+new session) |
| T3 | `freeze` | builder | IMPLEMENTING \| FIX_REQUIRED → PUBLISHED | §10.4 in full | pushes review ref + coord (atomic); writes `reviews/<id>/r<N>.json`; `round=N`; `review.published` |
| T4 | `withdraw` | builder | PUBLISHED → IMPLEMENTING | reviewer has not started | round N marked `withdrawn` (never reused, ref kept); `review.withdrawn` |
| T5 | `review-start` | reviewer | PUBLISHED → REVIEWING | §10.5 checks pass | `review.reviewer_session`; `review.started` |
| T5r | `review-start` | reviewer | REVIEWING → REVIEWING | same reviewer, same round | re-runs all checks; `review.resumed` |
| T6 | `review-result` FIX_REQUIRED | reviewer | REVIEWING → FIX_REQUIRED | §10.6; ≥1 blocking finding; no finding with `requires_scope_change` | writes `rN.result.json`; `open_findings` updated; `review.fix_required` |
| T6b | `review-result` FIX_REQUIRED w/ scope-change finding | reviewer | REVIEWING → BLOCKED(`SCOPE_CHANGE_REQUIRED`) | as T6 | as T6 + `task.blocked` |
| T7 | `review-result` ACCEPT | reviewer | REVIEWING → ACCEPTED | §10.6; 0 blocking findings; every required manual check `pass`; every previously open blocking finding dispositioned `resolved` | writes `rN.result.json`; `accepted_sha`, `accepted_tree`; `review.accepted` |
| T8 | `review-*` detects ref moved/missing, tree or manifest mismatch | reviewer/any | PUBLISHED \| REVIEWING \| ACCEPTED → BLOCKED(`REVIEW_OBJECT_MOVED`) | detection | `review.invalidated` + `task.blocked`; exit 6 |
| T9 | `reopen` | builder | ACCEPTED → FIX_REQUIRED | builder wants to change accepted bytes | `acceptance.voided` (reason required); adds system finding `SYS-REOPEN` |
| T10 | `promote` | builder or human | ACCEPTED → PROMOTED | §10.7 | pushes baseline ref (non-force); `task.promoted`; locks released |
| T10c | `promote`, overlap/rebase needed | builder or human | ACCEPTED → FIX_REQUIRED | overlay not allowed or paths overlap | `acceptance.voided` + system finding `SYS-REBASE` |
| T11 | `block` | builder/reviewer/human | any non-terminal → BLOCKED | reason enum + free text | `blocked{from,reason,note}`; `task.blocked` |
| T12 | `admin unblock` | human | BLOCKED → `blocked.from` | target state's own invariants hold again (re-validated) | `task.unblocked` |
| T13 | `admin release` | human | any lock-holding → AVAILABLE | reason | clears `claim`; current round marked `released`; `lock.released` (`override:true`) |
| T14 | `admin abandon` | human | any non-terminal → ABANDONED | reason | `task.abandoned` |

### 3.4 Explicit answers

- **When may feature files be modified?** Only in IMPLEMENTING or FIX_REQUIRED, only by the task's builder, only in the claimed worktree, and only for paths matching `write_paths` and not `blocked_paths`. This is enforced mechanically at `freeze`, not during editing (§13).
- **When may review files be modified?** Never after creation. `freeze` writes `reviews/<id>/r<N>.json` once, and `review-result` writes `rN.result.json` once. The reviewer's harness edits live only in a detached review worktree that is never committed to a pushed ref.
- **When are Git pushes allowed?** Only via the tool, never with force:
  - `freeze` pushes the new review ref and coord.
  - Every mutating command pushes coord.
  - `promote` pushes the baseline ref.
  - Agents never run `git push` by hand for coordinated work.
- **When are commits allowed?**
  - Builder: local commits on its work branch in IMPLEMENTING/FIX_REQUIRED; `freeze` makes the final one.
  - Baseline ref: only through `promote`.
  - Reviewer: never commits feature code.
  - Coord: only the tool commits.
- **When must a review abort?** Before or during review, if any of these happens:
  - the review ref ≠ `review_sha`, or the ref has disappeared;
  - `review_sha^{tree}` ≠ `review_tree`;
  - the recomputed manifest hash ≠ the recorded hash;
  - the task is no longer REVIEWING at the same round and reviewer;
  - `round_baseline` is no longer an ancestor of the baseline ref;
  - a coord integrity failure occurs;
  - the reviewer would need to modify feature bytes to evaluate the work (this becomes a finding, not a change).

---

## 4 · Core invariants

| ID | Invariant | Enforced by |
|---|---|---|
| **I1 Review immutability** | A round is `(task, N, review_sha, review_tree, round_baseline, manifest_sha256)`, and all of it is fixed at publish. A reviewer reviews exactly `review_sha`. Any mismatch → `REVIEW INVALIDATED` (exit 6), BLOCKED. | `review-start`, `review-result`, `promote` re-verify all fields |
| **I2 No silent evidence carry-forward** | Evidence from round M is valid in round N>M only if it is listed in `evidence_reuse` with its `paths` **and** `git diff --quiet rM_sha rN_sha -- <paths>` holds. The tool verifies this and refuses otherwise. | `review-result` |
| **I3 Accepted SHA** | `accepted_sha` == the round's `review_sha` == `result.reviewed_sha`. After promotion, `accepted_sha` is an ancestor of the baseline ref. For every path the task changed, the promoted tree's blob equals `accepted_sha`'s blob. | `review-result`, `promote` (tree proof) |
| **I4 Acceptance voiding** | Accepted bytes are a commit object and cannot change. Any *intent* to change them (`reopen`, or a rebase needed at promote) voids acceptance with an event and starts a new round. Local worktree edits made after ACCEPT never reach the baseline, because `promote` pushes objects, not worktrees. | `reopen`, `promote` |
| **I5 Single writer** | A task has ≤1 claim, and only the claim's agent may freeze. An agent holds ≤1 task in {IMPLEMENTING, FIX_REQUIRED} at claim time. A worktree is bound to ≤1 active task. | `claim`, `freeze` |
| **I6 Path locking** | For any two lock-holding tasks A≠B: `overlap(A.write_paths, B.write_paths) = ∅`. | `claim`, `task-add`, every state read (whole-state validation) |
| **I7 Diff ⊆ scope** | Every path changed in `round_baseline..review_sha` matches `write_paths` and matches no `blocked_paths` or `coord.forbidden_name_patterns`. | `freeze`; re-checked by `review-start` |
| **I8 Reviewer role** | The reviewer never freezes, promotes, or writes the task's feature paths, and `reviewer ≠ builder`. | `task-add`, `freeze`, `review-*` |
| **I9 No force, no deletion** | The tool never pushes with `--force`, `+refspec`, `--delete` or `--mirror`. It never pushes `main` or any ref outside {baseline ref, `review/*` create, `agents/coord`}. | `lib/git.mjs` guard + static test |
| **I10 Coord linearity** | Every new coord tip descends from the last tip this clone saw. Every coord commit carries tool trailers and a contiguous `seq`. A foreign commit (no trailers) blocks all mutations until `admin attest-repair`. | every command |
| **I11 Log completeness** | `tasks/*.json` == `fold(activity.jsonl)`, so the task files are a cache of the log. The log is hash-chained. | `verify` + every mutating command |
| **I12 Publish ≠ deploy** | No command runs anything other than git and the gate commands in the committed gate registry. No command reads env secrets. Promotion only updates a git ref. | code review + static test |

---

## 5 · Shared state layout

### 5.1 Decision: orphan branch `agents/coord`, not `.ascend-agents/` on the feature branch

Putting coordinator files on the dev/feature branch would cause three problems:
- publishing metadata would change the reviewed feature SHA;
- state edits would appear as unauthorised files in `freeze`'s diff check;
- a cloud reviewer would need the builder's branch just to read state.

An orphan branch avoids all three and provides compare-and-swap for free. The directory name `.ascend-agents/` is not used anywhere.

```
agents/coord  (orphan branch; root of its tree)
├── coord.json                     # config + schema version
├── activity.jsonl                 # append-only, hash-chained event log (source of truth)
├── tasks/<ID>.json                # one per task; derived cache of the log (I11)
└── reviews/<ID>/r<N>.json         # review manifest, write-once (freeze)
    reviews/<ID>/r<N>.result.json  # review result, write-once (review-result)
```

**Dropped from the candidate:**
- `state.json`: it would duplicate `tasks/`, and the index is computed on read.
- `locks/`: locks are a pure function of task state, so a separate lock file could only disagree with it.
- `inbox/`: `next` computes the inbox.

**Committed on the baseline branch (reviewed like code):**
- `tools/agent/**`: the tool, with zero deps.
- `tools/agent/gates.json`: the gate registry. Tasks reference gates **by name only**, so coord state can never inject a command.

**Local only, never canonical:**
- `.git/ascend-agent/session.json`: `{session_id, agent}` per clone.
- `.git/ascend-agent/last_seen_coord`: the last coord tip this clone observed (for I10).

| File | Purpose | Mutable | Append-only | Writer | In Git | Concurrency |
|---|---|---|---|---|---|---|
| `coord.json` | schema_version, baseline_ref, agents, forbidden_name_patterns, stale_after_hours | only via `admin` | no | human | yes (coord) | ref CAS |
| `activity.jsonl` | event log | append | **yes** (tool verifies new = old + suffix) | tool (any actor) | yes (coord) | ref CAS |
| `tasks/<ID>.json` | current task record | yes | no | tool | yes (coord) | ref CAS |
| `reviews/<ID>/rN.json` | manifest + gate evidence | **no** (write-once) | — | tool in `freeze` | yes (coord) | ref CAS + existence check |
| `reviews/<ID>/rN.result.json` | verdict + findings | **no** (write-once) | — | tool in `review-result` | yes (coord) | ref CAS + existence check |
| `tools/agent/gates.json` | gate name → command, cwd, timeout | via normal task | no | builder of a coordinator task | yes (baseline) | normal review |

### 5.2 CAS protocol (the single write path, used by every mutating command)

```
loop attempt = 1..3:
  git fetch origin +refs/heads/agents/coord:refs/remotes/origin/agents/coord   (local tracking ref only; never pushed with +)
  T  := rev-parse origin/agents/coord
  require is-ancestor(last_seen_coord, T)                  else exit 3 COORD_REWRITTEN
  for each commit in last_seen..T: require tool trailers + contiguous seq   else exit 3 COORD_FOREIGN_COMMIT
  S  := read tree T; validate schemas; validate I6, I11, chain   else exit 3 COORD_INVALID
  (S', events) := transition(S, command, ctx)              # pure function; may refuse → exit 1
  build new tree with a temp index (GIT_INDEX_FILE), never touching any worktree
  C  := commit-tree tree -p T  (message + trailers Ascend-Coord-Seq / -Op / -Actor / -Task)
  git push --atomic origin C:refs/heads/agents/coord [extra refspecs]   # no force
  on success: last_seen_coord := C; exit 0
  on "non-fast-forward"/"fetch first": continue (re-evaluate FROM SCRATCH, not replay)
  on other error: fetch; if origin tip == C → success; else exit 5 OUTCOME_UNKNOWN (rerun is safe)
exit 4 CONTENTION after 3 attempts
```
If the server does not advertise `atomic`, the extra refs are pushed first and coord last. An orphaned review ref without a coord record is harmless, and the idempotent retry adopts it (§10.4 F9).

---

## 6 · Schemas

All JSON on coord is **canonical JSON**: UTF-8, sorted keys, no floats, 2-space pretty for files, compact single-line for `activity.jsonl`. All SHAs are **40 lowercase hex characters**, and abbreviations are rejected everywhere. Paths are repo-root-relative POSIX, with no `.`/`..` segments or leading `/`.

### 6.1 `coord.json`
```json
{
  "schema_version": 1,
  "baseline_ref": "refs/heads/hardening/p0-p1-production",
  "remote": "origin",
  "agents": { "codex": {"kinds": ["builder","reviewer"]}, "claude": {"kinds": ["builder","reviewer"]} },
  "humans": ["oscar"],
  "forbidden_name_patterns": ["**/* 2.*", "**/.env*"],
  "stale_after_hours": 8,
  "genesis": { "baseline_sha": "<40hex>", "seq": 1 }
}
```

### 6.2 Task record `tasks/<ID>.json`
| Field | Type | Notes |
|---|---|---|
| `id` | string `^[0-9A-Z][0-9A-Za-z.\-]{0,31}$` | e.g. `2A.2c` |
| `slug` | `lowercase(id)` with non-alnum removed; unique | `2a2c`; used in ref names |
| `kind` | `implement` \| `preflight` \| `docs` | a preflight is a task whose write paths are its report file |
| `title` | string | |
| `priority` | int (lower = sooner) | ties in `next` are broken by `id` |
| `builder` / `reviewer` | agent id; must differ | |
| `state` | enum §3.2 | |
| `baseline_sha` | 40hex \| null | set at claim; may advance at freeze |
| `round` | int ≥0 | last published round; 0 = never |
| `rounds[]` | `{n, branch, sha, tree, baseline, status: published\|withdrawn\|invalidated\|fix_required\|accepted\|released}` | append-only in practice |
| `review` | `{round, branch, sha, tree, reviewer_session}` \| null | current round |
| `accepted_sha` / `accepted_tree` | 40hex \| null | |
| `promoted` | `{sha, mode: ff\|overlay\|recovered\|legacy, baseline_before, tree_proof_sha256}` \| null | |
| `write_paths` | pattern[] (§7.2), non-empty (for kind≠implement too) | locked |
| `read_paths` | pattern[] | not locked; used for staleness/overlay safety |
| `blocked_paths` | pattern[] | must never appear in the diff (e.g. `apps/os/migration/**`) |
| `prerequisites` | task id[] | must be PROMOTED before claim |
| `required_gates` | gate name[] | run by `freeze` |
| `promotion_gates` | gate name[] | run by `promote` in overlay mode |
| `required_manual_checks` | `{id, description}`[] | ACCEPT must report each one |
| `open_findings` | finding[] (§6.4) | outstanding blocking findings |
| `read_first` | string[] | docs/files `next` tells the agent to read |
| `promote_policy` | `approval` \| `auto` | `approval` = human `admin approve-promote` required |
| `promote_mode` | `ff_only` \| `overlay_allowed` | `ff_only` for auth/migration/authority work |
| `claim` | `{agent, session, host, worktree_id, seq}` \| null | |
| `blocked` | `{from, reason, note, seq}` \| null | reason ∈ `SCOPE_CHANGE_REQUIRED, REVIEW_OBJECT_MOVED, BASELINE_REWRITTEN, NEEDS_DECISION, EXTERNAL_DEPENDENCY` |
| `legacy` | bool | imported, not witnessed (§15) |
| `updated_seq` | int | seq of last event touching the task |

**Example: 2A.2c as it would look if imported mid-review of round 2**
```json
{
  "id": "2A.2c", "slug": "2a2c", "kind": "implement",
  "title": "Bounded sales queue and browse",
  "priority": 10, "builder": "codex", "reviewer": "claude",
  "state": "REVIEWING",
  "baseline_sha": "53f33ec6bc7d5fad0a10c278ef753712c7d99348",
  "round": 2,
  "rounds": [
    {"n":1,"branch":"review/2a2c","sha":"e4abe22cff88de15e4a1d69c41707698f3c3c3df",
     "tree":"0dd342be507715b7bb3ed92c43ec2bf8ac3cd52b","baseline":"53f33ec6bc7d5fad0a10c278ef753712c7d99348","status":"fix_required"},
    {"n":2,"branch":"review/2a2c-fix1","sha":"ededb09c846008ec63dd56c4081204fe05aaa27f",
     "tree":"eadbd948d5044d5fb173fb6e8fb15183e46983fd","baseline":"53f33ec6bc7d5fad0a10c278ef753712c7d99348","status":"published"}
  ],
  "review": {"round":2,"branch":"review/2a2c-fix1","sha":"ededb09c846008ec63dd56c4081204fe05aaa27f",
             "tree":"eadbd948d5044d5fb173fb6e8fb15183e46983fd","reviewer_session":"claude-7f3c…"},
  "accepted_sha": null, "accepted_tree": null, "promoted": null,
  "write_paths": [
    "apps/os/app/sales/**",
    "apps/os/app/globals.css",
    "apps/os/components/sales/SalesBrowseFilters.tsx",
    "apps/os/components/sales/SalesQueueRow.tsx",
    "apps/os/core/crm/sales.ts",
    "apps/os/core/db/sales-reads.ts",
    "apps/os/lib/sales-queue-url.ts",
    "apps/os/tests/architecture/f51-page-demand.test.ts",
    "apps/os/tests/architecture/page-authorization.ts",
    "apps/os/tests/auth/page-denial.test.ts",
    "apps/os/tests/db/page-matrix-provisioned.test.ts",
    "apps/os/tests/db/sales-reads.test.ts",
    "apps/os/tests/ui/sales-browse-filters.test.ts"
  ],
  "read_paths": ["apps/os/core/auth/**", "apps/os/docs/SLICE-2A-PREFLIGHT.md"],
  "blocked_paths": ["apps/os/migration/**", "apps/os/core/auth/**", "apps/os/scripts/**"],
  "prerequisites": ["2A.2b"],
  "required_gates": ["typecheck", "gate:static", "gate:server", "gate:db"],
  "promotion_gates": ["typecheck", "gate:static"],
  "required_manual_checks": [
    {"id":"MC1","description":"/sales/list renders bounded rows as owner and as Sales Partner in a fresh server compiled from the reviewed SHA"},
    {"id":"MC2","description":"Scope bar and filters round-trip through the URL (lib/sales-queue-url.ts)"}
  ],
  "open_findings": [],
  "read_first": ["apps/os/docs/SLICE-2A-PREFLIGHT.md"],
  "promote_policy": "approval", "promote_mode": "ff_only",
  "claim": {"agent":"codex","session":"codex-legacy","host":"legacy","worktree_id":"legacy","seq":2},
  "blocked": null, "legacy": true, "updated_seq": 4
}
```
The 16 write paths are the measured `53f33ec..ededb09` diff; `apps/os/app/sales/**` covers four of them. The finding shape is in §6.4.

### 6.3 Review manifest `reviews/<ID>/r<N>.json` (written by `freeze`, immutable)
```json
{
  "task": "2A.2c", "round": 3, "branch": "review/2a2c-r3",
  "sha": "<40hex>", "tree": "<40hex>", "baseline": "<40hex>", "previous_round_sha": "<40hex>|null",
  "builder": "codex", "session": "codex-…", "published_seq": 57,
  "changes": [ {"status":"M","path":"apps/os/core/db/sales-reads.ts","old_blob":"<40hex>","new_blob":"<40hex>","old_mode":"100644","new_mode":"100644"} ],
  "changes_sha256": "<sha256 of canonical JSON of changes>",
  "delta_from_previous": [ {"status":"M","path":"…"} ],
  "gates": [
    {"name":"typecheck","command":["npm","run","typecheck"],"cwd":"apps/os","exit_code":0,
     "duration_ms":41210,"log_sha256":"<hex>","log_tail":"…≤4096 bytes…",
     "ran_on":{"sha":"<40hex>","tree":"<40hex>","clean_before":true,"clean_after":true}}
  ],
  "gate_evidence_kind": "builder_attested"
}
```
`changes` is produced by `git diff --raw --no-renames --abbrev=40 -z <baseline> <sha>`. The reviewer recomputes it and never trusts the stored copy.

### 6.4 Review result `reviews/<ID>/r<N>.result.json` (written by `review-result`, immutable)
```json
{
  "task": "2A.2c", "round": 3, "reviewed_sha": "<40hex>", "reviewed_tree": "<40hex>",
  "verdict": "FIX_REQUIRED",
  "reviewer": "claude", "session": "claude-…", "result_seq": 61,
  "findings": [
    {
      "id": "2A.2c-r3-F1",
      "blocking": true,
      "severity": "high",
      "paths": ["apps/os/core/db/sales-reads.ts"],
      "line": 142,
      "observed": "browse query omits the row bound when scope=all",
      "expected": "every browse read is LIMIT-bounded (SLICE-2A §x)",
      "minimal_repair": "apply BROWSE_ROW_LIMIT in the scope=all branch",
      "regression_proof": {"kind":"test","description":"tests/db/sales-reads.test.ts: scope=all returns ≤ limit rows with limit+5 seeded"},
      "requires_scope_change": false,
      "suggested_patch": null
    }
  ],
  "prior_findings": [ {"id":"2A.2c-r2-F2","disposition":"resolved","evidence":"r2..r3 diff adds bound; test at sales-reads.test.ts:210"} ],
  "manual_checks": [ {"id":"MC1","result":"pass","evidence":"fresh server on :3101 built from <sha>; screenshots sha256 …"} ],
  "evidence_reuse": [ {"from_round":2,"item":"gate:db run","paths":["apps/os/tests/db/**","apps/os/core/db/**"]} ],
  "notes": "…"
}
```
(The finding content above is illustrative, not a real 2A.2c finding.)

Rules:
- `FIX_REQUIRED` ⇒ at least one new blocking finding or a previously open blocking finding marked `still_open`.
- Both verdicts must disposition every previously open blocking finding in `prior_findings` as `resolved` or `still_open`. A `still_open` finding remains in `open_findings` with its original evidence; new blocking findings are added to that list.
- `ACCEPT` requires all of the following:
  - no blocking findings (non-blocking findings are recorded as follow-ups);
  - `manual_checks` covers every `required_manual_checks[].id` with `pass`;
  - `prior_findings` dispositions every previously open blocking finding as `resolved`.
- `severity` ∈ `critical|high|medium|low`.
- `regression_proof.kind` ∈ `test|gate|manual`.
- `suggested_patch` (optional unified diff text) is informational. The builder applies it under its own lock.

### 6.5 Event (`activity.jsonl`, one compact canonical JSON object per line)
| Field | Required | Notes |
|---|---|---|
| `seq` | yes | contiguous from 1 |
| `prev` | yes | sha256 of previous line's bytes (genesis: 64 zeros) |
| `ts` | yes | ISO-8601 UTC from the actor's clock; **informational only, ordering comes from `seq`** |
| `type` | yes | see below |
| `actor` | yes | `{kind: agent\|human, id, session, host}` |
| `task` | if task-scoped | |
| `round`, `sha`, `tree`, `baseline` | when applicable | full 40hex |
| `from`, `to` | on state changes | |
| `witnessed` | yes | `false` only for `task.imported` |
| `override` | yes | `true` for every `admin` op except task-add/approve-promote |
| `data` | optional | type-specific (reason, findings ids, refused-because, snapshot for import) |

Types: `coord.initialized, task.created, task.imported, task.claimed, task.claim_resumed, review.published, review.withdrawn, review.started, review.resumed, review.invalidated, review.stale_rejected, review.fix_required, review.accepted, acceptance.voided, promote.approved, task.promoted, task.blocked, task.unblocked, lock.released, task.abandoned, coord.repair_attested`.

`review.stale_rejected` and `review.invalidated` are logged even though they refuse, because they are the evidence that the protocol caught a failure.

---

## 7 · Lock model

1. **Task-level or path-level?** Both, derived from one record. The *task* lock is the single-writer claim (I5). The *path* lock is the task's `write_paths`, held in every lock-holding state (§3.2). There is no separate lock object.
2. **Glob overlap:** see the grammar and algorithm below. Two patterns overlap iff **some path could match both**. This is exact, not heuristic.
3. **Shared file (`apps/os/core/db/sales-reads.ts`):** v0.1 has no shared-write mode. The file belongs to whichever lock-holding task lists it. Any other task that must edit it has two options:
   - list it, and be refused at `claim` until the holder is PROMOTED or ABANDONED; or
   - declare the holder as a prerequisite.
   Read-only use needs no claim, but the file should be listed in `read_paths` so overlay promotion can detect a change underneath it. Splitting a hot file into modules is the builder's architectural choice, not the coordinator's.
4. **Stale locks:** locks **never expire automatically**, because a builder's uncommitted work may still exist on a machine the coordinator can't see. `status` flags `STALE?` when `now - ts(last event on task) > stale_after_hours`. Recovery is either `claim --resume` by the same agent or `admin release` by a human (audited).
5. **Timestamps?** Recorded for humans only; they never decide correctness. Ordering and exclusion come from ref CAS and `seq`.
6. **Process, machine or session IDs?**
   - Agent id: authorisation.
   - Session id: a random UUID per clone per session, for audit and resume.
   - Host: audit.
   - `worktree_id` = sha256(host + absolute worktree path); it enforces one active task per worktree.
   - No PIDs, because they are meaningless across machines.
7. **How does isolated Claude see Codex's locks?** By fetching `agents/coord`. Locks exist only there. Local runtime state is never consulted for exclusion.
8. **Canonical source:** the **tip of `origin/agents/coord`**. Review branches are canonical only for *bytes*, and those bytes are cross-checked against the SHA recorded on coord. Local state is a cache.

### 7.2 Path pattern grammar and overlap

- A pattern is `/`-separated segments. A segment is either `**` (only as a whole segment) or a string of literal chars and `*` (`*` never matches `/`).
- **Rejected at `task-add`:** `?`, `\`, empty segments, `.`, `..`, a leading `/`, and `**` inside a segment. Brackets, braces, and `!` are literal path characters.
- A trailing `/` is sugar for `/**` (a directory subtree).

`matches(pattern, path)`: a segment NFA in which `**` consumes zero or more segments.

`overlap(p, q)`: DP over segment positions (i, j), starting from (0,0).
- If `p[i]=='**'`, move to (i+1,j) or (i,j+1). The same applies symmetrically when `q[j]=='**'`.
- Otherwise, move to (i+1,j+1) iff `segOverlap(p[i], q[j])`.
- Accept if (len p, len q) is reachable.

`segOverlap(a, b)`: DP over character positions (x, y).
- If `a[x]=='*'`, move to (x+1,y), or to (x,y+1) if `b[y]` exists. The same applies symmetrically when `b[y]=='*'`.
- If both characters are literal and equal, move to (x+1,y+1).
- Accept at (len a, len b).

Required test vectors (overlap → expected):

| p | q | overlap |
|---|---|---|
| `apps/os/core/db/sales-reads.ts` | same | **yes** (exact) |
| `apps/os/core/**` | `apps/os/core/db/sales-reads.ts` | **yes** (parent/child) |
| `apps/os/core/` | `apps/os/core/db/x.ts` | **yes** (dir sugar) |
| `apps/os/app/sales/**` | `apps/os/app/partner/**` | no |
| `apps/os/tests/**/*.test.ts` | `apps/os/tests/db/sales-reads.test.ts` | **yes** |
| `apps/os/tests/**/sales*.ts` | `apps/os/tests/**/auth*.ts` | no |
| `apps/os/*/x.ts` | `apps/os/core/*.ts` | **yes** (`apps/os/core/x.ts`) |
| `**` | anything | **yes** |
| `a/*b` | `a/c*` | **yes** (`a/cb`) |
| `a/*.css` | `a/*.ts` | no |

Overlap also applies between a task's own `write_paths` and `blocked_paths`. If they overlap, `task-add` refuses, because those write paths could never freeze. The exception is when `blocked_paths` is strictly narrower (a carve-out); that is accepted with a warning.

---

## 8 · Git review transport

| Topic | Rule |
|---|---|
| Naming | `review/<slug>-r<N>`, N = 1,2,3…; `slug` per §6.2. Legacy names (`review/2a2c`, `review/2a2c-fix1`) are recorded verbatim in `rounds[].branch`. The **recorded** name is authoritative, and the convention applies to new rounds only. |
| Immutability | Write-once. The tool only *creates* review refs, and `freeze` refuses if the ref exists at another SHA. Recommended (Oscar, GitHub ruleset on `review/**`): block force-push, block deletion, restrict updates. The tool does not rely on the ruleset; it verifies SHAs itself. |
| Deletion | Not deleted in v0.1. After PROMOTED the commit is reachable from the baseline anyway, so the ref costs nothing. GC is v0.2. |
| Round increment | N = `task.round + 1`, assigned by `freeze` and committed via CAS. Withdrawn, invalidated and released rounds are never reused. |
| Full SHA | `rev-parse` output (40hex), stored in `rounds[]`, `review` and the manifest. The tree SHA is stored alongside. |
| Baseline | `round_baseline` = the newest baseline-ref commit contained in the review SHA (§10.4 F2). It must be an ancestor of both the review SHA and the baseline ref. |
| Changed-file manifest | `git diff --raw --no-renames --abbrev=40 -z <round_baseline> <sha>` → `changes[]`, canonically hashed. `delta_from_previous` is the same for `r(N-1)..rN`, for incremental review. |
| Gate evidence | Stored in the manifest on coord as `builder_attested`: gates ran in a worktree verified clean and at HEAD == sha before and after each gate. Only a ≤4 KiB tail and the full log's sha256 are stored; full logs stay in the builder's `.git/ascend-agent/logs/`. |
| Manifest location | **Coord state only.** The review commit contains only feature bytes, so publishing never changes the reviewed SHA. When `freeze` creates the commit, its message *may* carry trailers `Ascend-Task:`/`Ascend-Round:`/`Ascend-Baseline:` (all known before the commit exists). These are informational and never relied on. |
| Reviewer verification | §10.5: ref == recorded sha; object is a commit; tree == recorded; baseline ancestry holds; recomputed manifest hash == recorded; paths ⊆ write_paths. |

---

## 9 · Review result transport

**Decision: the result is a write-once file on `agents/coord`, committed by the same CAS as every other mutation.**

| Option | Rejected because |
|---|---|
| Commit on the review branch | moves the write-once review ref, which violates I1 |
| Dedicated `review-result/*` branch per round | needs ref discovery and a second consistency domain, and still needs coord for the state change |
| Git notes | `refs/notes/*` is a single ref with the same CAS semantics, but it is not fetched by default, merges awkwardly, and adds nothing over coord |
| File outside Git (inbox) | not visible across isolated environments |

The result and the state transition land in **one commit**, so a verdict can never be recorded without its state change, or the reverse. The builder's next `next` fetches coord and receives TASK: FIX with the findings inline. Oscar copies nothing.

**Assumption A1:** the reviewer's environment can push to `origin`, specifically to `agents/coord`. This is true for this Mac. For a cloud environment without push credentials, the degraded mode is:
- `review-result --emit-only` writes the validated result JSON;
- any agent that can push runs `ingest <file>`, which applies **identical validation** (round, SHA, reviewer, ref re-check). The event actor and coord commit actor are the ingesting agent; the result and event record the declared reviewer and session separately.
That is still a one-file relay, so it is a fallback, not the design.

---

## 10 · CLI contracts

### 10.1 Global
- **Invocation:** `npm run agent -- <cmd> [args]`, via the root `package.json` script `"agent": "node tools/agent/agent.mjs"`. The requested `pnpm agent:*` names map 1:1 to subcommands.
- **Identity:**
  - Every agent session exports `ASCEND_AGENT=codex|claude`.
  - Mutating agent commands require `--as <agent>` equal to `$ASCEND_AGENT`; a mismatch exits 2.
  - `admin` commands refuse when `ASCEND_AGENT` is set. They require `--human <name>` (listed in `coord.humans`), `--reason "<text>"`, and an interactive TTY where the human types the task id to confirm.
- **Output:** `KEY: value` lines (stable, grep-able). `--json` gives one JSON object.
- **Exit codes:**

| Code | Meaning |
|---|---|
| `0` | ok (including an idempotent no-op) |
| `1` | refused: a precondition failed; state unchanged |
| `2` | usage or identity error |
| `3` | coord integrity failure (invalid, foreign or rewritten); **stop all work** |
| `4` | git or network failure; **state unchanged and known** |
| `5` | **outcome unknown**; re-run the same command (safe) |
| `6` | REVIEW INVALIDATED / STALE |
| `7` | gate failed |

- No command accepts `--force`. Every mutating command is idempotent: re-running after a success or an exit 5 converges.

### 10.2 Read-only

**`status [--task ID] [--json]`**
- Precondition: the fetch succeeds (otherwise exit 4).
- Output:
  - a per-task table (`id state round builder reviewer review_sha(12) claim-age STALE?`);
  - a lock map (path pattern → task);
  - integrity status;
  - the baseline tip.
- Git: fetch only. Push: never.

**`verify`**
- Runs the full integrity check:
  - I6 and I10;
  - I11 replay: fold(log) must reproduce `tasks/*.json` byte-for-byte;
  - every recorded SHA exists and matches its tree.
- Output: `VERIFY: OK` or the list of violations. Exit 0 or 3. Never mutates.

**`next --as <agent> [--wait <minutes>] [--json]`: the session-start command**
- Input: the agent id. `--wait` polls every 60 s until the result is actionable or the timeout passes.
- Precondition: the fetch succeeds. Otherwise it prints `TASK: HALT  REASON: coordinator unreachable — do not start writes` and exits 4.
- **Never mutates.** Rules are checked in a fixed order. The first match wins; ties are broken by `priority`, then `id`.
  1. Coord integrity failure → `TASK: HALT`.
  2. The agent is the reviewer of a task in REVIEWING → `TASK: REVIEW (resume)`.
  3. The agent is the reviewer of a PUBLISHED task → `TASK: REVIEW`. This comes before the agent's own work because it unblocks the other agent.
  4. The agent is the builder of a task in FIX_REQUIRED → `TASK: FIX`.
  5. The agent is the builder of a task in IMPLEMENTING → `TASK: IMPLEMENT (resume)`.
  6. The agent is the builder of an ACCEPTED task that is promotable (policy `auto`, or approval recorded) → `TASK: PROMOTE`.
  7. The agent is the builder of a claimable AVAILABLE task (prerequisites promoted, no overlap, no other write task) → `TASK: CLAIM`, with the exact claim command.
  8. Otherwise → `TASK: WAIT`, showing what the agent is waiting on and `AVAILABLE_READ_ONLY_WORK` (the agent's AVAILABLE tasks that are blocked by locks or prerequisites; these are suitable for read-only preflight).
- Output examples:
```
TASK: REVIEW
SLICE: 2A.2c
ROUND: 3
BRANCH: review/2a2c-r3
SHA: 9c1e…(40)
TREE: 4ab0…(40)
BASELINE: 53f33ec6bc7d5fad0a10c278ef753712c7d99348
MODE: READ_ONLY
CHANGED_FILES: 16   DELTA_FROM_PREVIOUS: 3
PRIOR_OPEN_FINDINGS: 2A.2c-r2-F1, 2A.2c-r2-F2
MANUAL_CHECKS: MC1, MC2
READ_FIRST: apps/os/docs/SLICE-2A-PREFLIGHT.md
COMMAND: npm run agent -- review-start 2A.2c --as claude
```
```
TASK: FIX
SLICE: 2A.2c
ROUND_REVIEWED: 3
MODE: WRITE
ALLOWED_PATHS: apps/os/app/sales/** | apps/os/core/db/sales-reads.ts | …
BLOCKED_PATHS: apps/os/migration/** | apps/os/core/auth/**
FINDINGS:
  2A.2c-r3-F1 [blocking/high] apps/os/core/db/sales-reads.ts:142
    observed: …  expected: …  repair: …  proof: test — …
GATES: typecheck, gate:static, gate:server, gate:db
COMMAND_WHEN_DONE: npm run agent -- freeze 2A.2c --as codex
```
```
TASK: WAIT
WAITING_ON: 2A.2c REVIEWING by claude (round 3, 42m)
AVAILABLE_READ_ONLY_WORK: 2A.3 (blocked: overlap apps/os/core/db/sales-reads.ts held by 2A.2c)
```
- Failures: fetch failure (exit 4), integrity failure (HALT, exit 3), unknown agent (exit 2).

### 10.3 `claim <task> --as <agent> [--resume] [--worktree <path>]`
- **Input:** task id, agent, and optionally a worktree (default: the current git worktree root).
- **Preconditions:** T2 or T2r (§3.3).
- **Transition:** AVAILABLE → IMPLEMENTING, or a resume.
- **Output:** the `next` TASK: IMPLEMENT block.
- **Failures (all exit 1):** `ALREADY_CLAIMED`, `PATH_CONFLICT <pattern> held by <task>`, `PREREQ_NOT_PROMOTED`, `AGENT_HAS_ACTIVE_WRITE_TASK`, `WORKTREE_BOUND`.
- **Git:** a coord commit only. **Push:** coord.
- **Branch:** creates the local branch `work/<slug>` at the baseline tip if it is absent, and prints `git switch work/<slug>`. It does not check the branch out; the tool never switches the builder's checkout itself.

### 10.4 `freeze <task> --as <builder> [--dry-run]` (freeze + publish in one command)
Steps; any failure leaves coord unchanged:

| Step | Action | On failure |
|---|---|---|
| F1 | CAS-read. State must be IMPLEMENTING or FIX_REQUIRED. `--as` == builder == claim.agent. The current worktree_id must equal claim.worktree_id (otherwise use `claim --resume`). | exit 1 |
| F2 | Fetch the baseline ref → D. Set **round_baseline**: D if `is-ancestor(D, HEAD)`; otherwise `task.baseline_sha`, which must be an ancestor of both D and HEAD (if not, exit 1 `BASELINE_REWRITTEN` → BLOCKED). If round_baseline ≠ D, let G = paths changed in round_baseline..D. If G overlaps `write_paths ∪ read_paths` → exit 1 `BASELINE_MOVED_CONFLICT` (merge D into the work branch and re-freeze). | exit 1 |
| F3 | Build the candidate set: `git diff --name-only -z round_baseline HEAD` ∪ `git status --porcelain=v1 -z --untracked-files=all` (tracked modifications and deletions **and** untracked non-ignored files). Every path must match `write_paths` and must match neither `blocked_paths` nor `forbidden_name_patterns`. No submodule/gitlink changes. | exit 1 `UNAUTHORIZED_PATHS`, listing each path and the reason. Nothing is staged. |
| F4 | If the tree is dirty: `git add -A -- <exact paths from F3>`, then `git commit` (message `<id> r<N>` + trailers). Hooks are allowed to run. | exit 1 |
| F5 | `git status --porcelain --untracked-files=all` must be empty. | exit 1 `TREE_DIRTY_AFTER_COMMIT` (the local commit remains; the builder fixes and re-runs) |
| F6 | S = HEAD (40hex), T = S^{tree}. If S == the previous round's sha, or T == the previous round's tree → exit 1 `NO_CHANGES`. Re-run F3's path check on round_baseline..S. | exit 1 |
| F7 | Load the gate registry from the fetched baseline commit D, record its blob SHA, and run `required_gates` **one at a time** (commands via `execFile`, no shell, tool-enforced timeout). Before and after each gate, the status must be clean and HEAD == S. | gate fails → exit 7; tree dirtied → exit 1 `GATE_DIRTIED_TREE`. Coord is untouched either way. |
| F8 | Build the manifest (§6.3), with N = round+1. | — |
| F9 | `ls-remote origin refs/heads/review/<slug>-r<N>`. Absent → proceed. Equal to S → proceed (idempotent resume of an interrupted attempt). Any other SHA → exit 1 `BRANCH_COLLISION` (a human decides). | exit 1 |
| F10 | Re-read coord and recheck task, claim, round, S, clean status, baseline path movement, and gate registry blob SHA. CAS push `--atomic`: `S:refs/heads/review/<slug>-r<N>` plus coord (state PUBLISHED, round N, `reviews/<id>/rN.json`, `review.published`). On non-FF, retry the recheck and push; gates run once for S. | network → exit 5. Re-running is idempotent: F9 finds the ref == S, and F1 finds the task already PUBLISHED with review_sha S → exit 0 `ALREADY_PUBLISHED`. |
| F11 | Output `PUBLISHED 2A.2c r<N> <S> <branch>` plus a manifest summary. | — |

`--dry-run` runs F1–F3 and F7 without committing or pushing. Git mutation: a local commit (F4). Push: the review ref and coord.

### 10.5 `review-start <task> --as <reviewer> [--worktree <path>]`
Steps:
- **R1:** CAS-read. State must be PUBLISHED, or REVIEWING by this reviewer (→ resume). `--as` == reviewer.
- **R2:** `git fetch origin refs/heads/<branch>`. The ref must equal `review.sha` exactly, `cat-file -t` must be `commit`, and `S^{tree}` must equal `review.tree`.
- **R3:** `round_baseline` must be an ancestor of S and of the baseline ref.
- **R4:** Recompute `changes`. Its sha256 must equal `changes_sha256`, and every path must be ⊆ write_paths.
- **R5:** CAS → REVIEWING; `review.started`.
- **R6:** `git worktree add --detach <path, default in OS temporary directory as ascend-review-<checkout-hash>-<slug>-r<N>> S`. Print the manifest, the delta from the previous round, prior findings, manual checks, gate evidence, and `MODE: READ_ONLY`.

Failures:
- A mismatch in R2, R3 or R4 → T8 (event `review.invalidated`, BLOCKED `REVIEW_OBJECT_MOVED`). Print `REVIEW INVALIDATED` and exit 6.
- A state or role mismatch → exit 1.

Git: a local worktree only. Push: coord.

**Reviewer harness:** it exists only inside that detached worktree, is never committed to a pushed ref, and is deleted after the result. A needed regression test goes into a finding as `regression_proof`, optionally with a `suggested_patch`.

### 10.6 `review-result <task> --as <reviewer> --result <file.json>`
The file holds the §6.4 object without `reviewer/session/result_seq`; the tool fills those in.

Refuse with **exit 6 `REVIEW_STALE`**, and log `review.stale_rejected`, if any of these hold:
- state ≠ REVIEWING;
- `result.round` ≠ `task.review.round`;
- `result.reviewed_sha` ≠ `task.review.sha`;
- `reviews/<id>/rN.result.json` already exists.

Refuse with **exit 6 `REVIEW INVALIDATED`** (T8) if the re-fetched ref ≠ S, or if S^{tree} or the manifest hash ≠ recorded.

Refuse with exit 1 if any of these hold:
- `--as` ≠ reviewer, or ≠ the agent of `review.reviewer_session`;
- the findings schema is invalid;
- the ACCEPT or FIX_REQUIRED rules in §6.4 are violated;
- an `evidence_reuse` entry fails its `git diff --quiet rM rN -- paths` proof.

On success: CAS writes the result file and applies T6, T6b or T7. Push: coord.

### 10.7 `promote <task> --as <builder>` | `admin promote <task> --human oscar`

**P1: preconditions**
- State is ACCEPTED.
- Policy is `auto`, or a `promote.approved` event exists for (task, accepted_sha) (`admin approve-promote <task> --human oscar`).
- Re-verify the accepted object: it is a commit, its tree == `accepted_tree`, `rN.result.json.verdict == ACCEPT`, and `reviewed_sha == accepted_sha`.
- The review ref must still equal accepted_sha; otherwise T8 BLOCKED.

**P2: choose the promotion mode.** Fetch the baseline → D. Let A = accepted_sha and B = round_baseline.
- **FF:** D == B, or D is an ancestor of A → `git push origin A:<baseline_ref>` (no force). promoted = {sha: A, mode: ff}. The baseline tree **is** A's tree.
- **OVERLAY:** allowed only when B is an ancestor of D, D is not an ancestor of A, **and** all of the following hold:
  - `promote_mode == overlay_allowed`;
  - F = changed(B..A) and G = changed(B..D) are disjoint;
  - no path in G matches `read_paths`.

  Steps:
  1. `git merge-tree --write-tree D A` → MT (exit 0 = conflict-free).
  2. **Independently construct the expected tree E**: take `ls-tree -r -z D`, then for each path in F replace or delete the entry with A's.
  3. Require `ls-tree -r -z MT` == E, byte for byte.
  4. M = `commit-tree MT -p D -p A`.
  5. Run `promotion_gates` on M. The builder's worktree must be clean: `git switch --detach M`, run the gates, then `git switch -` back.
  6. `git push origin M:<baseline_ref>`. promoted = {sha: M, mode: overlay, tree_proof_sha256: sha256(E listing)}.

  A is M's second parent, so `is-ancestor(A, baseline)` holds and I3 stays checkable permanently.
- **Otherwise:**
  - Overlapping paths, or `ff_only` → T10c: FIX_REQUIRED + `SYS-REBASE`. The builder merges D and freezes a new round; unchanged evidence may be reused under I2.
  - D does not descend from B → BLOCKED `BASELINE_REWRITTEN`.

**P3:** If the baseline push is rejected as non-FF (the baseline moved), go back to P2 (at most 3 times).

**P4:** CAS coord → PROMOTED; `task.promoted`; locks released.

**Crash recovery:** re-run the command.
- If the state is ACCEPTED and `is-ancestor(A, D)`, record PROMOTED with mode `recovered` and baseline_before = D, without pushing.
- If the state is already PROMOTED, exit 0.

The tool **never pushes `main`**. The baseline ref comes from `coord.json`, which only `admin` can change.

### 10.8 Other commands
| Command | Actor | Transition | Push |
|---|---|---|---|
| `withdraw <task> --as` | builder | T4 | coord |
| `reopen <task> --as --reason` | builder | T9 | coord |
| `block <task> --as --reason <ENUM> --note` | builder/reviewer | T11 | coord |
| `admin init --human --baseline-ref` | human | creates orphan `agents/coord` (fails if it exists) | coord |
| `admin task-add <file.json>` / `admin task-edit <id> <file.json>` | human | T1; edit allowed only in AVAILABLE or BLOCKED(`SCOPE_CHANGE_REQUIRED`), re-validating I6 | coord |
| `admin import <file.json>` | human | `task.imported` (witnessed:false, full snapshot) | coord |
| `admin approve-promote <task>` | human | records `promote.approved` for (task, accepted_sha) | coord |
| `admin unblock / release / abandon <task>` | human | T12 / T13 / T14 | coord |
| `admin attest-repair --reason` | human | after a manual coord fix, appends `coord.repair_attested` covering the foreign commits; I10 then passes | coord |
| `ingest <file>` | any | degraded mode of §9 | coord |

---

## 11 · Failure recovery

| # | Failure | Detection | Recovery |
|---|---|---|---|
| 1 | Builder crashes while IMPLEMENTING | `status` shows `STALE?` | The same agent runs `claim --resume` from any session or worktree; uncommitted work is recovered from the old worktree if it still exists. If the builder is gone, a human runs `admin release`. The lock stays until then, because the coordinator cannot prove the work is dead. |
| 2 | Freeze pushes but the push fails | exit 4/5 | Re-run `freeze`; F9 and F1 make it idempotent. An orphan review ref left by a non-atomic push is adopted if it equals S. |
| 3 | Reviewer crashes during REVIEWING | `STALE?` | The same reviewer re-runs `review-start` (T5r), which re-verifies everything. In-progress findings live only in the reviewer's session, so nothing partial is ever recorded. |
| 4 | Review branch moves unexpectedly | R2 / P1 ref check | T8 → BLOCKED `REVIEW_OBJECT_MOVED`, exit 6. A human investigates, then either runs `admin unblock` back to PUBLISHED (only if the ref is restored to the recorded SHA) or runs `admin release` (the builder re-freezes a new round). Nothing is carried forward except under I2. |
| 5 | Result for an old round | §10.6 | exit 6; `review.stale_rejected` logged; no state change |
| 6 | Two agents claim overlapping paths | the CAS loser re-evaluates | The loser gets exit 1 `PATH_CONFLICT`; only one push can win. |
| 7 | Task is ACCEPTED, then the builder changes local files | not needed for safety | `promote` pushes only A (or a verified overlay of A), so local edits never travel. `promote` prints `WARNING: local changes in write_paths are NOT being promoted` when the worktree is dirty in write_paths. To include them, run `reopen` → new round. |
| 8 | Coord state malformed | exit 3 on every command | All mutation stops. A human repairs it with a normal commit on `agents/coord` (no force), then runs `admin attest-repair`. `verify` must pass before work resumes. |
| 9 | State says REVIEWING but the review branch is deleted | R2 / `status` | T8 → BLOCKED. If the object still exists (`cat-file -e`), a human may restore the ref at the recorded SHA and unblock; otherwise release and re-freeze. |
| 10 | A human needs to override a stale lock | — | `admin release <task> --human oscar --reason "…"`, with TTY confirmation and an `override:true` event; the task's round is marked `released`. |
| + | Coord force-pushed or rewritten | I10 | exit 3 `COORD_REWRITTEN`. A human restores the previous tip, which every clone's `last_seen_coord` retains. |
| + | Baseline rewritten | F2/P2 | BLOCKED `BASELINE_REWRITTEN` |

---

## 12 · Parallelism rules

1. Any number of tasks may hold locks at the same time, as long as their `write_paths` are pairwise disjoint (I6).
2. **Pure read-only work needs no claim** and never blocks a writer. This covers reading, running tests in a disposable worktree, and exploring.
3. **Read-only activity that produces an artifact is a write.** A preflight *report* is a task of `kind: preflight` whose `write_paths` is its doc (e.g. `apps/os/docs/SLICE-2A3-PREFLIGHT.md`). It follows the same claim → freeze → review → promote loop, so Claude can preflight N+1 while Codex implements N.
4. If a preflight finds that N+1 must edit a path held by N, the N+1 implement task lists that path and is refused at claim until N is PROMOTED. `next` reports this under `AVAILABLE_READ_ONLY_WORK` instead of waiting silently.
5. **One active write task per worktree.** Parallel builders on one machine use separate `git worktree`s. A second builder's dirty files in the same worktree would (correctly) make `freeze` refuse.
6. Promotion is first-come, first-served. The second of two disjoint tasks promotes by overlay (§10.7), with a tree proof and promotion gates, and needs no re-review. `ff_only` tasks re-enter review instead.

---

## 13 · Security boundaries

- **v0.1 never** deploys, runs migrations, touches production, reads or prints env secrets, rotates credentials, pushes `main`, force-pushes, or deletes refs.
- `lib/git.mjs` is the only module that spawns git. It uses argument arrays (no shell). It rejects any push whose args contain `--force`, `-f`, `--force-with-lease`, `+` refspecs, `--delete`, `-d` or `--mirror`. It also rejects any destination other than the configured baseline ref, `refs/heads/review/*` (create-only) or `refs/heads/agents/coord`.
- **Gate commands come only from `tools/agent/gates.json` on the baseline branch**, so coord state cannot introduce a command. Gate commands inherit the environment. `gate:db` is already local-only under existing project rules, and the coordinator adds no new access.
- **Honest limits:**
  - Agent identity is **declared** (`ASCEND_AGENT` + `--as`) and audited, not authenticated. It prevents mistakes, not a malicious agent, because both agents push as one GitHub identity.
  - Write-path enforcement happens **at freeze**, not during editing.
  - The human gate on `admin` is procedural (env var + TTY confirmation).
  - v0.2 closes these gaps with per-environment SSH commit signing of coord commits, verified against a committed `allowed_signers` file.
- **Production authority is entirely outside the coordinator.** Promotion advances a git ref. It is not a deploy signal, and nothing may treat it as one.

---

## 14 · Test plan

**U = pure unit tests** of the state/transition function, paths, schemas and canonical JSON. No git.

**G = real-Git integration tests.**
- Setup: a temp bare repo acts as `origin`, and two separate clones (`codex/`, `claude/`) share nothing but that bare repo. This simulates the isolated environments.
- Runner: `node:test`, with everything under `os.tmpdir()`. The tests never touch the real remote or the network.
- Fault injection: through the git runner's test seam (`ASCEND_AGENT_TEST_FAULT=<point>`) and `pre-receive` hooks in the bare repo.

| # | Test | Kind | Expectation |
|---|---|---|---|
| 1 | Two agents claim the same task (both read tip T, both push) | G | exactly one IMPLEMENTING; the loser exits 1 `ALREADY_CLAIMED` |
| 2 | Overlap vectors (§7.2 table) + 200 random pattern/path fuzz cases checked against brute-force enumeration over a small alphabet | U | exact agreement |
| 3 | Disjoint paths claimed concurrently | G | both succeed (the second after a CAS retry) |
| 4 | Freeze with an unauthorised modified file / untracked file / `x 2.ts` / blocked path | G | exit 1 with the exact path listed; no commit; coord unchanged |
| 5 | A gate fails / a gate dirties the tree | G | exit 7 / exit 1; coord unchanged; no review ref |
| 6 | Review branch moved (the harness force-updates it in the bare repo) before start / during review / before promote | G | exit 6, `review.invalidated`, BLOCKED |
| 7 | Wrong review SHA / abbreviated SHA in the result | U+G | exit 6 / exit 2 |
| 8 | Stale FIX_REQUIRED: round-1 result submitted after round 2 is published | G | exit 6, `review.stale_rejected`, state unchanged |
| 9 | Stale ACCEPT (same setup) | G | same |
| 10 | Accepted → builder edits local files → promote | G | baseline tree == accepted tree; the local edit is absent; warning printed |
| 11 | Result from the wrong reviewer (`--as codex` on a claude-reviewed task; `--as` ≠ `ASCEND_AGENT`) | U | exit 1 / exit 2 |
| 12 | Malformed state: bad JSON, unknown state, overlapping locks, broken hash chain, tasks ≠ fold(log) | U+G | exit 3 on every mutating command; `verify` lists each problem |
| 13 | Interrupted push: fault after the review ref and before coord (non-atomic mode); fault after a successful push and before the ack | G | exit 4/5; re-run converges; exactly one `review.published` |
| 14 | Stale lock recovery: `claim --resume` by the same agent; `admin release` refused when `ASCEND_AGENT` is set; succeeds for a human | U+G | as specified; `override:true` |
| 15 | Duplicate review round (`rN.json` exists; `rN.result.json` exists) | U | refused |
| 16 | Branch-name collision (the ref exists at another SHA) | G | exit 1 `BRANCH_COLLISION` |
| 17 | Promotion of the wrong SHA (tampered `accepted_sha` ≠ result.reviewed_sha) | G | exit 3 |
| 18 | Overlay promotion: disjoint → success + tree proof; overlapping → FIX_REQUIRED `SYS-REBASE`; read_paths hit → same; `ff_only` → same | G | as specified; `is-ancestor(A, baseline)` |
| 19 | Baseline moved during the promote push (a pre-receive hook advances it once) | G | retries; ends PROMOTED with a correct proof |
| 20 | Coord force-pushed / foreign commit without trailers | G | exit 3 `COORD_REWRITTEN` / `COORD_FOREIGN_COMMIT`; `attest-repair` clears the foreign-commit case |
| 21 | **Log completeness:** after every G scenario, `fold(activity.jsonl)` == `tasks/*.json` and the seq/prev chain is intact | G | always |
| 22 | Full transition matrix: every (state × command × actor) combination not in §3.3 is refused | U | exhaustive |
| 23 | Static: no `--force`/`+refs`/`--delete` literals in `tools/agent/lib`; the git runner guard is unit-tested with each forbidden form; no `process.env` reads except `ASCEND_AGENT*` | U | pass |
| 24 | `next` priority: fixture states for each of rules 1–8, including ties | U | deterministic, byte-identical output |
| 25 | Evidence reuse: a claim on unchanged paths is accepted; on changed paths it is refused | G | as specified |
| 26 | Crash between the baseline push and the coord update in promote | G | re-run → PROMOTED with mode `recovered`; no second push |

---

## 15 · Adoption plan

| Phase | Action | Authorisation |
|---|---|---|
| **A0 (now)** | **2A.2c finishes under the current manual freeze→review protocol.** It is not migrated mid-review. | none new |
| **A1** | Task `COORD-0.1` (Codex builds, Claude reviews) runs **manually** under the existing protocol, as that protocol's last use. Write paths: `tools/agent/**`, root `package.json` (the `agent` script only) and root `AGENTS.md` (the session-start paragraph). It touches nothing under `apps/os/**`, so it cannot collide with Sales work. | Oscar authorises the slice and its commit |
| **A2** | Oscar authorises three items: (a) **a fast-forward push of `hardening/p0-p1-production` to origin**, which currently has 22 commits that exist only locally (E5); without it a cloud reviewer cannot see the baseline. (b) Recommended GitHub rulesets: `review/**` blocks force-push, deletion and updates; `agents/coord` blocks force-push and deletion. (c) `admin init`, which creates `agents/coord` with a genesis event binding `baseline_ref` and the tip SHA. | Oscar, explicitly, per item |
| **A3** | `admin import 2A.2c`. If 2A.2c is closed by then, import it as PROMOTED with `legacy:true`, `promoted.mode:"legacy"`, and rounds r1 (`review/2a2c`, e4abe22…) and r2 (`review/2a2c-fix1`, ededb09…) recorded verbatim. If it is still open, import it at its **actual** state; r3 onward use the new naming. Imported history carries `witnessed:false`, consistent with the provenance rule "state may be entered, events must be witnessed". **Historical slices are not imported at all.** | Oscar |
| **A4** | First native task: the next Sales slice (e.g. 2A.3), plus a parallel `kind: preflight` task for the slice after it, which exercises disjoint parallelism. | Oscar adds the tasks |
| **Retire the manual protocol** | Once three conditions hold: (1) one full cycle, including a FIX_REQUIRED round and a promote, completed with zero relays by Oscar; (2) one disjoint parallel pair both promoted, one of them by overlay; (3) `verify` green throughout. The freeze→review memory rule is then superseded (the fingerprint becomes a commit SHA). | Oscar |

Legacy caveat: 2A.2c's commits are already in the dev branch (E6). Promoting an accepted legacy r2 is therefore a verified no-op (`is-ancestor`), not an exception to I3.

---

## 16 · Exact v0.1 scope

**In:**
- the `agents/coord` layout (§5);
- the state machine (§3): 9 states and transitions T1–T14;
- invariants I1–I12;
- the schemas in §6;
- the path grammar with exact overlap (§7.2);
- the CAS protocol (§5.2);
- the commands:
  - `status`, `verify`
  - `next` (+`--wait`)
  - `claim` (+`--resume`)
  - `freeze` (+`--dry-run`), `withdraw`
  - `review-start`, `review-result` (+`--emit-only`), `ingest`
  - `reopen`, `block`, `promote`
  - `admin {init, task-add, task-edit, import, approve-promote, unblock, release, abandon, attest-repair, promote}`
- FF and overlay promotion with a tree proof;
- the gate registry;
- tests 1–26;
- the `AGENTS.md` session-start paragraph.

**Out:** everything in §17.

## 17 · Deferred to v0.2+

- Cryptographic agent identity (signed coord commits + `allowed_signers`) and per-agent push credentials.
- Lease heartbeats and time-based auto-expiry.
- Sub-file/region locks and multiple writers per task.
- Independent gate evidence (CI or reviewer-run gates recorded as `reviewer_verified`).
- Waking agents (webhooks or schedulers) beyond `next --wait`.
- GitHub PR/Checks integration and a dashboard.
- Review-ref GC and activity-log compaction/snapshots.
- Automatic rebase/merge assistance.
- Multiple reviewers or a review quorum.
- Task dependency graphs beyond prerequisite lists.
- Multiple baseline refs.
- Any deploy/production authorisation path (a separate system by design).

---

# IMPLEMENTATION CONTRACT FOR CODEX — Coordinator v0.1

**Task id `COORD-0.1`. Builder: Codex. Reviewer: Claude. Run under the current manual freeze→review protocol.**

**Write paths (exhaustive):**
- `tools/agent/**`
- root `package.json`: add exactly `"agent": "node tools/agent/agent.mjs"` to `scripts`
- root `AGENTS.md`: append one "Session start" section

**Forbidden:** `apps/**`, `.github/**`, any lockfile, and new npm dependencies.

**Stop conditions (report them, do not solve them):**
- a change is needed outside the write paths;
- tests would need network or real-remote access;
- a force or delete push would be needed;
- the work contradicts this document.

**Runtime:** Node ≥ 22, ESM `.mjs`, **zero dependencies** (node built-ins only). JSDoc types are allowed. Git is invoked only via `child_process.execFile('git', args)`.

**Files:**
```
tools/agent/agent.mjs          CLI: parse argv, resolve identity, dispatch, map errors → exit codes (§10.1)
tools/agent/gates.json         {"typecheck":{"cmd":["npm","run","typecheck"],"cwd":"apps/os","timeout_s":900},
                                "gate:static":{…"npm","run","gate:static"…}, "gate:server":{…}, "gate:db":{…}}
tools/agent/lib/canon.mjs      canonicalJSON(v, {pretty}), sha256(bytes), isSha40(s)
tools/agent/lib/paths.mjs      validatePattern, matches(pattern,path), overlap(p,q), anyOverlap(A,B)  (§7.2 exactly)
tools/agent/lib/schema.mjs     validators for coord.json, task, manifest, result, finding, event; return [errors]
tools/agent/lib/state.mjs      PURE: transition(state, cmd, ctx) → {ok, state', events[]} | {ok:false, code, reason}
                               + fold(events) → tasks (I11), validateWhole(state) (I6, per-record invariants), nextFor(agent, state)
tools/agent/lib/git.mjs        the ONLY git spawner; push guard (§13); helpers: revParse, isAncestor, fetch, lsRemote,
                               diffRaw, statusPorcelain, lsTree, mergeTreeWriteTree, commitTree, worktreeAdd; test fault seam
tools/agent/lib/coord.mjs      readTip, verifyLinearity(I10), loadState, casMutate(mutator, extraRefspecs) (§5.2)
tools/agent/lib/manifest.mjs   buildChanges(base, sha), changesSha, deltaFromPrevious
tools/agent/lib/gates.mjs      runGates(names, {sha, registry}) with registry loaded from the baseline commit and clean/HEAD checks around each gate; own timer (no `timeout` binary)
tools/agent/lib/promote.mjs    ffOrOverlay(), expectedOverlayTree(), treeProof()
tools/agent/test/*.test.mjs    node --test; U + G suites per §14 (tests 1–26, each named "T<nn> …")
tools/agent/README.md          operator summary; link to ARCHITECTURE.md
tools/agent/ARCHITECTURE.md    this document, verbatim
```

**Non-negotiable behaviours:**
1. All state lives on `refs/heads/agents/coord`. Coord trees are written with a temporary `GIT_INDEX_FILE` + `commit-tree`. The tool **never** checks out coord, and never touches the user's index or worktree except for the explicit freeze commit (F4) and the promote-overlay gate run (§10.7, clean-tree precondition).
2. Every mutating command goes through `casMutate`. The transition logic is the pure `state.mjs`, re-evaluated from scratch on each CAS retry (max 3).
3. SHAs are always full 40hex; anything shorter is refused with exit 2.
4. Coord commits carry the trailers `Ascend-Coord-Seq`, `Ascend-Coord-Op`, `Ascend-Coord-Actor` and `Ascend-Coord-Task`. Every read verifies contiguity from `.git/ascend-agent/last_seen_coord`.
5. `activity.jsonl`:
   - each new version must be the old bytes plus appended lines;
   - `prev` = sha256(previous line);
   - `tasks/*.json` must equal `fold(activity)` after every mutation. Assert this before pushing, and refuse your own write if it fails.
6. `freeze` implements F1–F11 exactly. `review-start` implements R1–R6. `review-result` implements §10.6. `promote` implements P1–P4, comparing the overlay tree proof on `ls-tree -r -z` bytes.
7. Push guard: the destination must be one of the configured baseline ref, `refs/heads/review/*` (create-only: `ls-remote` shows it absent or already equal), or `refs/heads/agents/coord`. Reject force flags, `+` refspecs and deletes. Test 23 covers this.
8. `next` never mutates and prints exactly the §10.2 formats; `--json` gives the same fields.
9. `admin *` refuses when `ASCEND_AGENT` is set. It requires `--human`, `--reason` and TTY confirmation. The test seam `ASCEND_AGENT_TEST_CONFIRM=1` is honoured **only** when `NODE_ENV=test`.
10. Exit codes are exactly those in §10.1.

**AGENTS.md addition (text):** "Before any work, run `npm run agent -- next --as $ASCEND_AGENT` and do exactly what it says. Write only inside the reported ALLOWED_PATHS. Never push, commit to the baseline, or edit review refs by hand. `REVIEW INVALIDATED`, `HALT`, or exit 3 means stop and report."

**Definition of done (evidence to hand back):**
- `node --test tools/agent/test` is green, with T01–T26 present by name.
- `git diff --name-only <baseline>..HEAD` ⊆ the write paths.
- The static guard test passes.
- A transcript of one scripted end-to-end run in a temp bare repo: claim → freeze → review-start → FIX_REQUIRED → freeze r2 → ACCEPT → promote, with `verify` OK after each step.
- **No** push to the real origin and no `admin init` against the real remote; those are Phase A2, separately authorised.
- STOP after reporting.
