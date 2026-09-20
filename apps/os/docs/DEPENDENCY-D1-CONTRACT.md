# Dependency D1 — prospect source-correct mutations: pre-flight contract

---

> ## ⛔ DEPLOYMENT INVARIANT — D1b.1 IS NOT DEPLOYABLE UNTIL 009 IS APPLIED
>
> D1b.1 (`docs/DEPENDENCY-D1B1-CHECKPOINT.md`) ships the application code for prospect archival and
> authors migration `009_prospect_archival.sql`, but **009 is deliberately NOT applied to
> production**. Production is at ledger head `008_prospect_notes_log.sql`.
>
> The canonical prospect reader now carries `WHERE archived_at IS NULL`, so deploying this code
> against an unmigrated production makes **every** prospect read fail with
> `column "archived_at" does not exist` — `/sales`, `/partner`, the graph, the forecast and the
> intake path all at once. There is no graceful degradation.
>
> **Order is: migration 009 → production FIRST, application afterwards.** D1b.2 owns that
> application, the new encrypted recovery artifact, and the full R1b / two-leg R1c re-proof. Until
> D1b.2 completes, this branch is not pushed and not deployed.

---

**Status: PRE-FLIGHT. Nothing is implemented.** Baseline `1fca27f` (Dependency R1 complete). This
document grounds D1 in the shipping code and the current data. It proposes an implementation boundary
and acceptance cases, and it stops for owner approval.

**Method.**
- **Code:** a read-only trace of the shipping code.
- **Fixture probe:** a temporary suite ran the **real** `promote` and `DELETE` route handlers through
  the real admission chain (session cookie → `withRequestContext` → resolved membership). It used an
  in-process PGlite carrying migrations 001–008 and a throwaway vault, with
  `ASCEND_PROSPECT_SOURCE=postgres`, the deployed setting. The probe was deleted afterwards and is
  not committed. Its observations are quoted as **P1–P7**.
- **Deployed facts:** read locally as counts and booleans only.
- **No production contact.**

---

## 0 · The finding in one paragraph

In the deployed configuration, prospects are **read** from Postgres, but they are **mutated** as if
the vault still owned them:
- **Promotion** creates a vault client correctly. It then marks a vault hit-list file that, for
  3,102 of the 3,108 production prospects, does not exist (measured 2026-09-20, §A), so it **creates
  a phantom vault prospect file**. It never updates the Postgres row, so the prospect stays `lead` everywhere the
  application looks.
- **Deletion** unlinks a vault file and reports success, while the Postgres row and its notes survive.
  For a prospect that exists only in Postgres, it returns 404.
- **Retry:** retrying a promotion with a different client slug creates a second client.
- **Unreadable vault file:** a vault file that exists but can't be read is **overwritten** with a
  stub, erasing its `prospect_id`, name and body.

None of this is reported to the operator.

---

## 1 · Every current representation of a prospect

| # | Representation | Canonical id | Where | Organization | Role today | Created by | Read by |
|---|---|---|---|---|---|---|---|
| R1 | **Postgres `prospects` row** | `prospects.id` (surrogate uuid). The business anchor is `prospect_id` (uuid, UNIQUE, nullable for held rows). `slug` is a display alias, **not unique** (`001_substrate.sql:98,103`). | Supabase Postgres (production) | `organization_id`, enforced by RLS | **Authoritative**, in the deployed mode (`ASCEND_PROSPECT_SOURCE=postgres`) | Sheet intake (`core/intake/projection.ts` → `core/db/prospects.createProspect`); the 2E migration (6 rows) | `core/crm/prospect.listProspects/getProspect/listProspectSources` → every consumer (F43) |
| R2 | **Vault hit-list file** `02 - Sales & Hit List/<slug>.md` | Filename slug. `prospect_id` in frontmatter when anchored. | iCloud vault | None (single tenant implied) | **Authoritative only in vault mode.** In the deployed mode it is **frozen rollback material** from 2E: 8 files (1 `_template`, 1 index/readme-style document, and the 6 migrated prospects: 4 anchored, 2 held). All were last modified on or before 2026-08-27, before the 2E flip. | `core/crm/prospect.createProspect` (vault only; there is no Postgres branch); URL intake; vault-mode sheet import | Vault mode only |
| R3 | **Postgres `prospects.notes` column** | Row | Postgres | Via the row | The legacy markdown body (call log), carried verbatim by 2E | Migration and intake | Rendered as the prospect body; copied into the client's `business_context.md` on promotion |
| R4 | **`prospect_notes` log** | `note_id` → `prospect` = `prospects.id` with **`ON DELETE CASCADE`** (`008:56`) | Postgres | `organization_id`, RLS | **Authoritative, in both modes.** There is no vault equivalent (`core/crm/notes.ts` header). | `addNote` (`prospects:write`) | `listNotes(ref)` via `findProspectRef`: slug first, `LIMIT 1` |
| R5 | **Postgres `events`** (`subject_entity = 'prospect'`) | `event_id`; ordered by `seq` | Postgres | `organization_id` | **Authoritative spine for prospect-domain facts** in the deployed mode: 22,811 events in production (intake, 2E-migrated history, `note_added`) | `core/db/events.appendEvent` from intake, notes, research | `readEvents(tx)`: research log, timeline, R1 proofs |
| R6 | **Vault JSONL events** `.ascend-os/<domain>.events.jsonl` | `event_id`; log position | Vault | Constant `ORGANIZATION_ID` | The spine for **client, production and document** facts, and today **also** where promotion writes `prospect.promoted` | `core/events.emitEvent` | `core/events.readEvents()` |
| R7 | **Client `structural_meta.promoted_from_prospect`** | Prospect **slug** (not `prospect_id`) | Vault client folder | — | **The only durable link** from a client back to its prospect | `core/crm/promote.ts:122` | The graph `promoted_to` edge (`graph-view/projection.ts:250`) |
| R8 | **Derived projections** (knowledge index, graph, search, pipeline, forecast, sales queue) | Slug | Computed per read; **none persisted** | — | Projected from R1 through the canonical reader | — | — |
| R9 | **Reconciler observations** | Slug | Vault event log, via a manual "sync vault" action | — | Observes R2 files and emits `prospect.status_changed` into R6 when a vault file's status changes | `core/reconciler` | — |

**Deployed data** (local counts; production Postgres not queried):
- Vault: 8 hit-list files. One is a `_template` the reader skips; of the 7 it can see, 6 are the
  migrated prospects and the seventh is an index/readme-style document.
- Clients: 6 CRM client folders. **1** carries `source: hit-list-promotion` (Bay Area Custom Shirts,
  the only promotion in history).
- The vault JSONL holds **0** `prospect.*` events and 3 `client.created` events.
- **The only promotion ever recorded left no `prospect.promoted` event.**

**Is there mixed ownership today?** No evidence of it. 2E migrated every vault prospect into
Postgres, with identical `prospect_id`s, and no vault prospect has been created since. Every
reader-visible vault prospect has a Postgres twin. So **no prospect is vault-only** in production.
What exists is a stale mirror, plus mutation code that still targets it.

---

## 2 · The current promotion path

**Trigger:** `PromoteButton` (on `/sales/[prospect]`) → `POST /api/prospects/[slug]/promote` →
`authorize(req, "promote")`. Authority comes from the session and the database membership (see §8).

| Step | Code | Store | On failure |
|---|---|---|---|
| 1 | Read the prospect: `getProspect(slug)` (`promote.ts:30`) | **Postgres** (selected source). The **first** row whose slug matches (`prospect.ts:136`). | 404 `prospect_not_found` |
| 2 | Build four client files. The body copies `prospects.notes` ("Carried over from prospect notes"). | Memory | — |
| 3 | `createClient`: check the folder exists (`client.ts:122`), then check `client_id` uniqueness | **Vault** | 409 `client_exists` or `duplicate_client_id`. Nothing written yet. |
| 4 | Write `business_context.md`, `brand_identity.md`, `project_scope.md`, `structural_meta.json`: **four separate atomic writes** (`client.ts:137–140`) | **Vault** | Throws → 500. **A partial client folder remains**, and every retry then gets 409 `client_exists`. |
| 5 | `emitEvent(client.created)`, actor `operator` with **no user id** | **Vault JSONL** | Throws → 500. The client exists with no event. |
| 6 | Mark the prospect: `readMarkdownFile(<hit-list>/<slug>.md)` (`promote.ts:134`) | **Vault**. This is the wrong store in the deployed mode. | A read error is swallowed as **"missing"** (`markdown.ts:23`) |
| 7 | `writeMarkdownFileAtomic(... status: closed-won ...)` (`promote.ts:138`) | **Vault** | See P1 and P6 below |
| 8 | `emitEvent(prospect.promoted)`, subject = slug | **Vault JSONL**. The wrong spine for a prospect fact in the deployed mode. | — |
| 9 | Steps 6–8 run inside `try { } catch { }`. A failure becomes `prospectMarked: false` (`promote.ts:146`). | — | Silently non-fatal |
| 10 | Route: `createProject` (`route.ts:49`), best-effort and idempotent | **Vault** | `project_scaffolded: false` + `project_warning` |
| 11 | Response: `ok: true`, plus a random `promotion_id` (`route.ts:69`) that is **recorded nowhere** | — | — |
| 12 | UI: `ok` → navigate to the client. `project_warning` and `prospectMarked` are **ignored** (`PromoteButton.tsx:71`). | — | — |

**Never touched:** the Postgres row (`status` stays `lead`), the Postgres event spine, and the
`prospect_notes` rows. The notes survive because nothing deletes them, not by design.

**Probe evidence:**
- **P1 (Postgres-only prospect, as owner):** 200, `ok: true`.
  - The Postgres row is still `lead`; its note is still attached.
  - **A new vault file was created**, containing only `status: closed-won`, `last_contact` and a
    `## Promotion` line: no `prospect_id`, no name.
  - Vault JSONL gained `client.created` and `prospect.promoted`. The Postgres spine got nothing.
- **P2 (retry):**
  - Same `client_slug`: **409**. The operator is told promotion failed, though it succeeded.
  - Different `client_slug`: **200, a second client**, and a second `prospect.promoted`.
- **P3 (mirrored prospect, as sales):** 200. The vault file became `closed-won`; the Postgres row is
  still `lead`.
- **P6 (vault file present but unreadable):** 200. The file was **overwritten**, losing
  `prospect_id`, name and body. This is data destruction of the 2E rollback material, triggered by an
  ordinary transient read failure (for example, an iCloud file that hasn't downloaded).
- **P7 (two rows share a slug):** 200. The client was built from **whichever row came first**, with
  no warning.

**Promotion idempotency today:** none. The folder-exists check is the only guard, and it is keyed on
the *client* slug the operator types. The UI's `alreadyWon` reads Postgres `status`, which promotion
never sets, so **the Promote button stays available after a successful promotion.**

**Duplicate-client risk:** real (P2). There is also a race: steps 3 and 4 are check-then-write across
five filesystem calls, with no lock.

---

## 3 · The current deletion path

**Trigger:** `DeleteProspectButton` → `DELETE /api/prospects/[slug]` →
`authorize(req, "prospects:identity")`.

| Step | Code | Store | Behaviour |
|---|---|---|---|
| 1 | Validate the slug syntax | — | 400 |
| 2 | `fs.access(<hit-list>/<slug>.md)` | **Vault** | Missing → **404**, even when the Postgres row exists |
| 3 | `fs.unlink` | **Vault**, a hard delete | — |
| 4 | Response `{ok: true, deleted}` → the UI navigates to `/sales` | — | — |

**Never touched:** the Postgres row, its notes, projections, and either event spine. **No event is
emitted.** The domain has no `prospect.deleted` type.

**Probe evidence:**
- **P4:**
  - A pristine Postgres-only prospect → **404 "not found"**, although the prospect is on screen. The
    row and its note remain.
  - The phantom file that P1 created → **200 "deleted"**, while the row and its note remain.
- **P5 (mirrored, as sales):** 200 `ok`.
  - The vault rollback copy is gone.
  - The Postgres row and its note remain, and **the prospect is still listed on `/sales`.**
  - No event anywhere.

This asymmetry was already recorded in `core/auth/routes.ts:143–146` when sales gained
`prospects:identity` (2G.4.7), and left unresolved.

**If deletion simply pointed at Postgres instead:**
- A hard `DELETE FROM prospects` would **cascade-delete every `prospect_notes` row** (`008:56`),
  silently destroying sales history.
- `ascend_sales` holds **no DELETE grant** on `prospects`. Only `ascend_owner` does
  (`001:252,257`).

So "fix the target store" is not enough. The deletion semantics themselves need a decision (§12).

---

## 4 · Source authority

**How the system knows which store owns a prospect today:** one process-wide environment switch,
`ASCEND_PROSPECT_SOURCE`, resolved in exactly one place (`core/crm/source.resolveProspectSource`).
It applies to **all prospects at once**. There is no per-record metadata, nothing in the id, and no
inference from presence.

**The exact ambiguity:** the switch governs **readers only**. F43 made "the store is chosen in exactly
one place" true for reads. No equivalent rule exists for **mutations**:

| Writer | Store it writes | Honours the switch? |
|---|---|---|
| `promoteProspect` (prospect marking) | Vault | **No** |
| `DELETE /api/prospects/[slug]` | Vault | **No** |
| `createProspect` (URL intake, "Add target") | Vault | **No.** `prospect.ts` states it has no Postgres branch. |
| `importProspectSheet` | Chosen by the switch | Yes |
| `addNote`, `removeNote`, research, website assessment | Postgres | Store-independent by design |

**When both stores hold the same prospect:** the switch decides which one *reads* win, and the rule
is explicit. Nothing decides which one *writes* target, so writes land on the vault mirror, which
nothing reads.

**A second ambiguity: addressing.**
- Every mutation route and reader addresses by **slug**, and `slug` is **not unique**.
- `getProspect` takes the first match, and so does `findProspectRef` (`LIMIT 1`).
- Two rows sharing a slug (P7) are indistinguishable to promotion, deletion and notes.
- Whether production holds duplicate slugs is **unmeasured**. The two held Tapia records are the
  likely candidates. See §12, decision 5.

### Proposed source-authority model: the smallest one that is durable

1. **No new identity system and no per-record owner column.** The evidence (§1) shows no
   mixed-ownership prospects, so a global selector is the right granularity.
2. **Extend F43 from readers to writers.** Every prospect mutation dispatches on
   `resolveProspectSource()` in the canonical module. There is one Postgres implementation and one
   vault implementation, and no caller branches.
3. **In Postgres mode, the vault hit list is read-only rollback material.** A single guard,
   `assertVaultProspectWritable()`, throws when the source is `postgres`. Every vault hit-list writer
   calls it. So a wrong-store mutation is a loud refusal, never a silent write. A fitness rule pins
   the guard to every writer on F43's `STORAGE_OWNERS` list.
4. **Mutations address exactly one row.** Resolve the slug to exactly one row in the organization;
   more than one → **409 `ambiguous_prospect`**, nothing written. The operation's durable key is
   `prospect_id` (the anchor), never the slug. A held row (no `prospect_id`) can't be promoted; see §8.

---

## 5 · Partial outcomes

Promotion in Postgres mode crosses two stores by construction. **Clients remain vault-owned**
(`core/crm/client.ts`), and prospects are Postgres-owned. So it can't be one transaction. D1 replaces
the boolean with a **stated outcome per effect**:

```
{ outcome: "promoted" | "already_promoted" | "incomplete" | "refused",
  client:   { slug, state: "created" | "existing" | "failed" },
  prospect: { state: "marked" | "already_marked" | "not_marked" | "refused", reason? },
  project:  { state: "scaffolded" | "existing" | "failed", reason? },
  operation: { prospect_id, correlation_id },          // the durable key, not a random id
  retry: "safe" | "not_needed" | "refused" }
```

HTTP status:
- `200` for `promoted` or `already_promoted`;
- **`202` for `incomplete`**: not an error, and not a success;
- `404`, `409` or `403` for `refused`;
- `5xx` only for an unexpected fault, with the same body wherever it's knowable.

### Promotion states

| State | What the API returns | What the UI may truthfully say | Safe to retry? | Must not | Evidence for later reconciliation |
|---|---|---|---|---|---|
| Client created; Postgres mark failed | 202 `incomplete`: client `created`, prospect `not_marked` | "Client created. The prospect is still open. Retry to finish." | **Yes.** The retry finds the existing client by `promoted_from_prospect_id` and only marks. | Create another client | Client meta `promoted_from_prospect_id`; vault `client.created` with `correlation_id`; Postgres row not `closed-won` |
| Client write failed partway | 202 or 500: client `failed` | "Promotion did not complete. Nothing was marked." | **Yes**, once staged writes exist (§10): a failed staging folder is invisible and is discarded | Treat the half-written folder as a client | A `.staging-*` folder (ignored by `listSubdirs`) |
| `client.created` emit failed after the files | 202 `incomplete` | "Client created; its history entry is missing." | Retry re-emits **only if** no `client.created` carries this `correlation_id` | Emit a second `client.created` | Client folder exists; no event for this correlation |
| Postgres marked; event append failed | Impossible by design: the status update and `prospect.promoted` commit in **one transaction** | — | — | — | — |
| Unknown outcome (a timeout after the Postgres COMMIT was sent) | The retry answers definitively | — | **Yes.** Compare-and-set sees `closed-won`, and `prospect.promoted` exists for this `prospect_id` → `already_promoted` | — | The Postgres row and event |
| Project scaffold failed | 200 `promoted`, with project `failed` + reason | "Client created. Production tracking could not be set up: <reason>." | Yes (`createProject` is idempotent) | Hide it (today's UI does) | The existing reconcile-on-read |
| Vault mirror present (2E rollback copy) | Not a partial state: the vault is **not written** in Postgres mode | Nothing | — | Write it | Hit-list hash unchanged |

### Deletion states

Postgres mode is single-store, so it's atomic.

| State | API | UI | Retry | Must not | Evidence |
|---|---|---|---|---|---|
| Archived (row and event, in one transaction) | 200 `archived` | "Removed from the hit list. History kept." | Idempotent: already archived → 200 `already_archived` | Hard-delete (it would cascade the notes) | Row `archived_at`; event `prospect.archived` |
| Ambiguous slug, held row, or not found | 409 or 404, with nothing written | States exactly why | — | Guess a row | — |
| Vault rollback copy exists | **Not touched**; reported as `mirror: present (not modified)` | Nothing | — | Unlink it | Hit-list hash |
| Vault mode | Today's unlink, **plus** a `prospect.deleted` event, `ok` only after both | "Deleted" | Retry after the unlink → 404, reported as `already_deleted` if the event exists | Report ok before the unlink | Vault event |

In Postgres mode, deletion has **no** projection-cleanup partial states, because nothing is persisted
downstream (R8). "Unresolved projection cleanup" is therefore a real reportable field only for the
**vault mirror**, and D1 reports it explicitly as untouched rather than cleaned.

---

## 6 · Retry and idempotency

**Mechanisms D1 needs (the smallest set):**

| Mechanism | Needed? | Form |
|---|---|---|
| Operation key | **Yes, and it already exists.** A prospect can become a client at most once, so the key is **`prospect_id`**. The random `promotion_id` is removed or replaced by it. | No new table |
| Deterministic client identity | **Yes.** Client meta gains `promoted_from_prospect_id` (the anchor) beside today's slug. Before creating, scan the six client folders for it. Found → reuse, whatever `client_slug` the retry supplies. | One meta field; a scan of about 6 folders |
| Compare-and-set | **Yes.** `UPDATE prospects SET status='closed-won', last_contact=… WHERE id=$1 AND organization_id=current_org() AND status IS DISTINCT FROM 'closed-won' RETURNING id`, then `appendEvent(prospect.promoted)`, in the same transaction. Zero rows → read the row and answer `already_marked`, `refused_held` or `not_found`. | SQL only |
| Mutation/event evidence | **Yes.** `prospect.promoted` in **Postgres**, carrying `actor_user_id` (the caller), the client slug and id, and a `correlation_id` shared with the vault `client.created`. | The existing event type |
| Source-state assertions | **Yes.** The §4 guard, plus a check that the resolved row is anchored and unique | Code |
| Recovery/reconciliation state | **No new state.** "Incomplete" is derivable: a client with `promoted_from_prospect_id = X` while row X is not `closed-won`. A read-only consistency check can list it. | A pure query over existing facts |
| Staged client write | **Yes, minimal.** Write the four files into `crm/.staging-<slug>-<correlation>/`, then **one directory rename** into `crm/<slug>`. `listSubdirs` already ignores dot folders (`io.ts:56`), so a partial client is never visible. | Local to `createClient` |

**Order:**
1. Resolve and assert (unique, anchored, not archived).
2. Find or create the client (staged, keyed by `prospect_id`), then emit `client.created` once per
   correlation.
3. In one Postgres transaction: compare-and-set the status and append `prospect.promoted`.
4. Scaffold the project (best-effort, idempotent).

Every retry replays from step 1 and converges. At no point can a retry create a second client or a
second `prospect.promoted`.

**Why not the reverse order** (mark Postgres first, then create the client)? That needs a durable
"promotion in progress" state, or the prospect claims `closed-won` with no client. That would be a
schema change for no gain.

---

## 7 · Notes and history continuity

**Promotion, today and under D1:** `prospect_notes` rows stay on the prospect row. They are
**retained and referenced, not moved and not copied.**
- The legacy `prospects.notes` body is copied once into `business_context.md`, which already happens.
- D1 adds the durable back-reference `promoted_from_prospect_id`, so the client can reach its sales
  history by the anchor rather than a renameable slug.
- Whether the client UI *renders* the inherited sales log is a presentation decision (§12,
  decision 4). D1 only guarantees it stays reachable.

**Deletion:**
- A hard delete would orphan nothing. It would **destroy** the notes, by cascade.
- D1's archival keeps the notes readable, as historical evidence attached to an archived row.
- No note is deleted as a side effect of any prospect mutation.

**The event trail D1 must leave**, so later engines can reconstruct what happened:

| Fact | Event | Spine | Status |
|---|---|---|---|
| Promotion completed for this prospect | `prospect.promoted` {client_slug, client_id, correlation_id} | **Postgres** (prospect domain), `actor_user_id` = the caller | Exists as a type; moves spine |
| Client created | `client.created` {…, source, correlation_id} | Vault (client domain) | Exists |
| Promotion began, or source cleanup failed | **No event.** "Began" is not a fact. An incomplete promotion is *derived* from the client-without-mark evidence (§6), never asserted. | — | By design |
| Retry completed an incomplete promotion | The same `prospect.promoted`, whose `correlation_id` matches the earlier `client.created`, carrying `data.completed_after_incomplete: true` | Postgres | New data field |
| Prospect archived | **`prospect.archived`** {reason?} | Postgres, in the same transaction as the row | **New type** |
| Prospect deleted (vault mode) | **`prospect.deleted`** | Vault | **New type** |

The event vocabulary is a closed union in `packages/domain/events.ts`, so adding the two types is a
domain change and belongs inside D1.

---

## 8 · Authorization

**Principals:** owner and sales, each resolved from `memberships`. No mutation path accepts a
declared role. `automation` never reaches either route: it isn't a session principal.

| Action | What sales can do today | What the code appears to intend | Database layer |
|---|---|---|---|
| Promote | **Yes**: holds `promote` and `clients:*` (P3 as sales: 200) | Yes. `routes.ts:120`, and the Sales Partner is owner-minus-admin (2G.4.7). | Sales has UPDATE(`status`, `last_contact`) on **anchored** rows only (`prospects_update_sales`). The D1 compare-and-set will therefore **correctly refuse a held row for sales**, and the refusal must be reported, not read as "already marked". |
| Delete | **Yes**: holds `prospects:identity` (P5 as sales: 200) | Yes. 2G.4.7 moved `prospects:identity` to sales on purpose ("a partner may delete a prospect"). | Sales has **no DELETE** on `prospects`, and no UPDATE on any archive column (none exists). The two layers disagree, and D1 must resolve it (§12, decision 2). |
| Notes | Append only; the owner may delete | Same | Enforced by grants and RLS (`008`) |

**Invariant preserved:** every D1 write runs through `withProspectDb` or `asPrincipal` under the
resolved principal, and events carry `actor_user_id` from that principal. Today's vault events carry
`actor: "operator"` with **no** user, so a sales promotion is currently attributed to nobody, which
matters for §19.

---

## 9 · Tests

**Inventory:**

| Area | Existing coverage |
|---|---|
| Promotion behaviour | **None.** `route-matrix-provisioned` checks status codes only, with slug `does-not-exist`. |
| Deletion behaviour | **None** beyond the same status matrix |
| Source ownership for mutations | **None.** F43 pins *readers* and lists `promote.ts` and the delete route as permitted hit-list writers (`fitness.test.ts:2908,2916`). |
| Partial failure | None |
| Retry / duplicate prevention | None |
| Notes continuity | `prospect-notes.test.ts` covers notes CRUD. Nothing covers notes across promotion or deletion. |
| Authorization | Capability and status only, for both roles |

**Tests exercising non-shipping behaviour:**
- **F43's writer allowlist.** It legitimises `promote.ts` and the delete route writing the hit list,
  which in the deployed mode is exactly the defect.
- **No test asserts** the vault-marking branch of `promoteProspect`. That branch is live code that is
  untested and wrong for the deployed mode.

**Proposed D1 probes.** Each must turn red under the named mutation:

| # | Probe | Mutation that must turn it red |
|---|---|---|
| M1 | Postgres-mode promotion and deletion leave the vault hit list byte-identical (hash before = after) | Remove the source dispatch or the vault-write guard |
| M2 | Retrying with a different `client_slug` yields exactly one client and one `prospect.promoted` | Remove the `promoted_from_prospect_id` lookup |
| M3 | A concurrent double promotion yields one mark and one event | Remove the compare-and-set predicate |
| M4 | An injected failure after client creation → 202 `incomplete`; the retry converges; there is exactly one client | Swallow the mark failure (today's `catch {}`) |
| M5 | An injected Postgres failure → no status change and no Postgres event; the outcome is reported | Split the status update and the event into two transactions |
| M6 | A failure during the client write leaves no visible client folder | Write in place instead of staging |
| M7 | An ambiguous slug → 409, and nothing is written anywhere | Revert to `rows.find` first-match |
| M8 | A held row → refused for sales, reported, nothing written | Treat zero rows as `already_marked` |
| M9 | Archival keeps the note count; the archived row leaves the readers; the event is in the same transaction | Use `DELETE FROM prospects` |
| M10 | `prospect.promoted.actor_user_id` equals the caller, owner and sales alike | Emit through the vault spine |
| M11 | A vault-mode writer called in Postgres mode throws | Remove the guard |
| M12 | An unreadable vault file is never overwritten (P6) | Keep `readMarkdownFile`'s missing-on-error for writers |

---

## 10 · Recommended implementation boundary

Split it, rather than hide a migration inside one slice.

### D1a — source-correct promotion, and deletion that can no longer lie. No schema change.

1. **`core/crm/source`:** `assertVaultProspectWritable()`. It is called by every hit-list writer
   (promotion marking, deletion, `createProspect`). F43 gains a fitness rule: every writer on the
   allowlist calls the guard.
2. **`core/db/prospects`:**
   - `resolveProspectForMutation(tx, slug)`: exactly one row, or `ambiguous`, `not_found` or `held`;
   - `markPromoted(tx, row, …)`: compare-and-set plus `appendEvent(prospect.promoted)`, in one
     transaction, with the caller's `actor_user_id`.
3. **`core/crm/promote`:**
   - the source dispatch;
   - Postgres mode never touches the hit list;
   - `promoted_from_prospect_id` in client meta;
   - find-or-create the client by anchor;
   - the outcome object from §5.
4. **`core/crm/client.createClient`:** a staged directory and a single rename; `client.created` at
   most once per `correlation_id`.
5. **The promote route:** returns the outcome object and HTTP status from §5, and drops the random
   `promotion_id`.
6. **The delete route, in Postgres mode:** refuses with **409 `deletion_unavailable`**
   ("archival is not yet available; nothing was changed") until D1b. In vault mode it keeps the
   unlink, but reports `ok` only after also emitting `prospect.deleted`.
7. **`PromoteButton` / `DeleteProspectButton`:** render the stated outcome (incomplete, project
   warning, refused) instead of navigating on `ok`. Copy only; no redesign.
8. **Domain:** add `prospect.deleted` to the event union.
9. **Tests:** M1–M8, M10–M12, on PGlite plus a temporary vault.

### D1b — archival deletion. Requires migration 009 and an owner decision.

- `prospects.archived_at timestamptz`, `archived_by uuid`, and a column grant per decision 2.
- The canonical reader excludes archived rows; notes stay readable.
- `prospect.archived` is added to the union and appended in the same transaction.
- The delete route performs archival. Hard delete is never exposed.
- Tests: M9, plus R1's F-manifest updated for the new columns. `manifest.sql` digests columns
  (F2), so the recovery proof must be re-run after 009.

**Explicitly outside D1** (named so they are not silently absorbed):
- URL intake (`from-url`) writing only the vault in Postgres mode. D1a's guard makes it **fail
  loudly** instead of creating invisible prospects. Porting it to Postgres is decision 1.
- Rendering the inherited sales log on the client page.
- Retiring or re-sealing the vault hit-list mirror.
- The UI's `packageTier` default of `"growth"` (`PromoteButton.tsx:40`). It re-introduces the
  "certainty default" that `promote.ts` removed. Flagged, not in scope.

**What D1a leaves unresolved:** deletion in Postgres mode is *refused*, not *performed*, until D1b.
That is truthful, but it is a capability regression from "appears to work" to "says it can't yet".

---

## 11 · Acceptance contract

A fixture harness (PGlite with 001–008, or 009 for D1b, plus a temporary vault) runs the real routes
through the real admission chain. Production is not contacted.

| # | Case | Pass criterion |
|---|---|---|
| A1 | **Postgres-owned promotion** (owner) | 200 `promoted`; row `closed-won`; exactly 1 `prospect.promoted` in Postgres with the owner's `actor_user_id`; exactly 1 client carrying `promoted_from_prospect_id`; **vault hit list byte-identical** |
| A2 | **Vault-owned promotion** (vault mode) | Today's vault behaviour minus the P6 overwrite: the file is marked; the vault `prospect.promoted`; no Postgres write |
| A3 | **Postgres-owned deletion** | D1a: 409 `deletion_unavailable`, nothing changed anywhere. D1b: 200 `archived`; row archived and hidden from readers; note count unchanged; `prospect.archived` in the same transaction; vault untouched. |
| A4 | **Vault-owned deletion** | File unlinked **and** `prospect.deleted` emitted before `ok` |
| A5 | Partial: client created, mark failed (injected) | 202 `incomplete`, stated per effect; the UI shows the incomplete copy |
| A6 | Partial: client write fails midway (injected) | No visible client folder; retry succeeds; exactly one client |
| A7 | Partial: project scaffold fails | 200 `promoted` with project `failed` + reason, and the UI surfaces it |
| A8 | **Retry after partial** | Converges to one client, one mark, one `prospect.promoted`; the correlation links it to the earlier `client.created` |
| A9 | **Duplicate prevention** | A retry with a different `client_slug`, and concurrent double submission, each still produce one client |
| A10 | **Notes and history continuity** | Notes are reachable from the prospect after promotion (and after archival, in D1b); the client carries the anchor back-reference; nothing is cascade-deleted |
| A11 | **Owner authorization** | A1 and A3 pass as the owner |
| A12 | **Sales authorization** | Promotion as sales passes on an anchored row, with events attributed to the sales user; a held row is refused and reported. Deletion as sales follows decision 2. |
| A13 | **Wrong-source mutation refusal** | In Postgres mode, every vault hit-list writer throws, and nothing is written (M11); an unreadable vault file is never overwritten (M12) |
| A14 | **Ambiguous address** | A duplicated slug → 409, nothing written anywhere |
| A15 | **Projection and mirror reporting** | The response states `mirror: present (not modified)` when a 2E rollback copy exists. No response claims a cleanup it didn't perform. |
| A16 | **Gates** | `gate:static`, `gate:server` and `gate:db` are green apart from the pre-existing environment list; mutation probes M1–M12 are each shown red, then restored |

---

## 12 · Owner decisions required

1. **URL intake ("Add target").** In Postgres mode it writes invisible vault files. Under D1a's guard
   it will instead **refuse**. Choose one:
   - accept the refusal until a separate slice ports it to Postgres; or
   - include the port in D1a. That adds a Postgres `createProspect` path through
     `core/intake`-style identity resolution; it is larger.
2. **Deletion semantics and who may perform them.**
   - Archival (soft, keeps notes; recommended) or hard delete (cascades notes).
   - Whether **sales** may archive. 2G.4.7 granted sales `prospects:identity` precisely so a partner
     may delete, so the consistent answer is a sales UPDATE grant on the archive columns. The
     alternative is owner-only at the database, which contradicts 2G.4.7.
3. **D1a/D1b split.** Accept D1a shipping with Postgres-mode deletion **refused** (truthful, but a
   visible capability loss) until D1b's migration 009 lands. The alternative is to do both as one
   slice, including a schema migration and an R1 manifest re-proof.
4. **Sales history on the client page.** Guarantee reachability only (D1), or also render the
   prospect's note log on the client (later, presentation).
5. **Duplicate slugs in production.** Authorize one read-only aggregate: the count of
   `(organization_id, slug)` groups with more than one row, with no names. That tells us whether the
   A14 refusal will affect real prospects (likely the two held Tapia rows). Without it, the effect is
   unmeasured.
6. **The vault hit-list mirror.** Keep it frozen as 2E rollback material (D1 never writes it), or
   schedule its retirement. This is not required for D1.

---

## What this pre-flight did and did not do

- **Did:**
  - read the shipping code;
  - ran one temporary fixture probe (PGlite + temporary vault, real route handlers, real sessions),
    since deleted;
  - read local vault **counts** (files, statuses, anchors, client sources, event types) without
    printing names or contents.
- **Did not:**
  - contact production, or read the production database;
  - modify the vault or any source, test or schema file;
  - push anything;
  - begin D1, Phase 2 or R2.
- The only file written is this contract.

---

# D1a — implementation record (2026-09-20)

**Status: IMPLEMENTED, pending owner acceptance. Not committed.** Baseline `1fca27f`. D1b is not started.

## A · The production measurement (owner decision 5)

One read-only aggregate, `default_transaction_read_only=on`, verify-full TLS on the pinned CA, counts
only — no names, ids, rows or PII.

| | |
|---|---|
| Measured | 2026-09-20T08:20:55Z, PostgreSQL 17.6, 1 organization |
| Prospect rows | 3,108 |
| Rows carrying a slug | **6** (the 2E-migrated prospects) |
| Rows with NULL slug (anchored) | **3,102** |
| **Slugs held by more than one row** | **0** — max 1 row per slug |
| Held rows | 2 |

**What it changes.** Slug ambiguity is real in the schema (no UNIQUE constraint) but **not present in
today's data**, so the A14 refusal protects an invariant rather than an existing population. The more
consequential finding is the other one: for 3,102 prospects the route reference is the **row id**
(the reader's `slug ?? id`), so a mutation identity keyed on "slug" would have addressed almost
nothing. `resolveProspectForMutation` accepts either form and keys the operation on `prospect_id`.

## B · Files changed

| File | Change |
|---|---|
| `core/crm/source.ts` | `assertVaultProspectWritable()` + `VaultProspectWriteRefused`; `withProspectDb` now takes the capability to demand and hands the resolved principal to its callback |
| `core/db/prospects.ts` | `resolveProspectForMutation` (exactly one row, else `not_found`/`ambiguous`/`held`); `markProspectPromoted` (compare-and-set + `prospect.promoted`, one transaction) |
| `core/db/index.ts` | exports the two above |
| `core/crm/promote.ts` | rewritten: source dispatch, anchor identity, find-or-create client, typed `PromotionOutcome`, no bare `catch {}` |
| `core/crm/client.ts` | staged directory + single rename; `findClientPromotedFrom(prospectId)` |
| `core/crm/prospect.ts` | `createProspect` calls the guard; `deleteVaultProspect` (unlink + `prospect.deleted`); `prospectFromRow`/`prospectFromMarkdown` exported |
| `core/vault/io.ts` | `renameEntryAtomic`, `removeStagingDir`, `removeFile` |
| `core/vault/markdown.ts` | `readMarkdownFileStrict` — ENOENT is absence, anything else throws |
| `packages/domain/events.ts` | `prospect.deleted` |
| `app/api/prospects/[slug]/promote/route.ts` | outcome-shaped response; 200/202/404/409; `promotion_id` removed |
| `app/api/prospects/[slug]/route.ts` | delegates to core; Postgres mode refuses with 409 |
| `app/api/prospects/from-url/route.ts` | maps the guard refusal to a truthful 409 |
| `components/PromoteButton.tsx` | renders incomplete/partial outcomes; navigates only on a proven promotion |
| `components/DeleteProspectButton.tsx` | claims deletion only on `outcome: "deleted"` |
| `tests/db/d1-promotion.test.ts` | **new** — 19 behavioural tests |
| `tests/architecture/fitness.test.ts` | F21 exemption retired; F43 widened to writers (2 new rules) |
| `tests/architecture/gate-2g1.ts` | registers the new suite |

## C · What holds now

- **Source authority for writes.** Every hit-list writer calls the guard; F43 pins that by source
  scan, and pins that the guard refuses on `postgres` rather than the other way round. The writer-side
  dispatch lives in one place (`promote.ts`), which F43's consumer list now states.
- **Mutation identity.** `prospect_id`. A slug or row id resolves to exactly one row; zero → 404,
  several → 409, held → 409, and nothing is written in any of those cases.
- **Idempotency.** The client is found by `promoted_from_prospect_id`; the status update is a
  compare-and-set; the event is appended in the same transaction. A retry with any client slug, or
  after any partial failure, converges on one client and one `prospect.promoted`.
- **Partial outcomes.** `promoted | already_promoted | incomplete | refused`, each with per-effect
  state and a `retry` verdict, surfaced as 200/202/404/409 and rendered by the UI.
- **History.** Notes are never touched by promotion; deletion of a Postgres-owned prospect is
  refused rather than cascading; vault deletion now emits `prospect.deleted`.

## D · Evidence

- `tests/db/d1-promotion.test.ts`: **19 passed**.
- **Mutation probes: 10 of 10 caught.** Removing the store dispatch, the guard, the compare-and-set,
  the anchor lookup, the shared transaction, the unambiguous resolution, the held refusal, the strict
  read, the staged write, or the event attribution each turns the suite red.
- One probe found a weak test of my own: the original M6 failed before any byte was written, so it
  could not distinguish a staged write from an in-place one. **M6b** was added, failing on the fourth
  file, and it catches that mutation.
- Gates: `tsc` 0 source errors; eslint clean for the changed code (one pre-existing warning in
  `app/api/console/search/route.ts` is untouched); `gate:static` 1,818 passed / 9 skipped / 1 failed
  (the pre-existing environment check); `gate:server` 3 passed / 5 skipped; `gate:db` **466 passed**
  / 199 skipped (447 + the 19 new).

## E · The exact D1b boundary

D1b is **archival**, and nothing else:

1. **Migration `009_prospect_archival.sql`:** `archived_at timestamptz`, `archived_by uuid REFERENCES
   users(id)`, a partial index for the active set, and a **column-level UPDATE grant on those two
   columns to `ascend_sales`** (owner decision 3: sales archives through the bounded operation, never
   through raw DELETE, which sales still must not hold). RLS keeps the existing
   anchored-rows-only predicate for sales.
2. **`prospect.archived`** added to the domain union, appended in the same transaction as the update.
3. **`archiveProspect`** in `core/db/prospects.ts`: compare-and-set on `archived_at IS NULL`, the same
   resolver and refusal vocabulary as promotion.
4. **The canonical reader excludes archived rows**; `prospect_notes` are untouched and stay readable.
5. **The delete route** performs archival and returns `archived | already_archived | refused`; the
   409 added in D1a is removed at that point. Hard delete is not exposed.
6. **Tests:** acceptance case A3's Postgres arm, plus M9 (notes survive; the archived row leaves the
   readers; the event shares the transaction).
7. **R1 impact:** 009 changes the column set, so `manifest.sql`'s F2 digest changes and the recovery
   proof must be re-run against a new artifact. That is part of D1b, not a separate dependency.

Not in D1b: hard deletion as an administrative capability, URL-intake porting, retiring the vault
mirror, the `PromoteButton` `"growth"` default.
