# Dependency D1a — prospect mutations against the store that owns them

**ACCEPTED by the owner on 2026-09-20.** Baseline `1fca27f` (Dependency R1 complete).

Authorized scope: extend F43's single-source rule to writers; source-correct promotion on
`prospect_id` identity; safe retry and duplicate-client prevention; staged client writes; truthful
partial outcomes and UI copy; explicit refusals for Postgres-mode deletion and URL intake;
behavioural and adversarial tests. **Not authorized, and not done:** migration 009, hard deletion of
Postgres prospects, any raw DELETE grant to sales, retiring the vault mirror, porting URL intake,
the `PromoteButton` `"growth"` default, D1b, Phase 2, R2.

## 1 · Production identity measurement

One read-only aggregate (the single authorized production contact), `default_transaction_read_only=on`,
verify-full TLS on the pinned CA, counts only — no names, ids, rows or PII. 12 SELECTs, 0 mutating
statements.

| | |
|---|---|
| Measured | 2026-09-20T08:20:55Z · PostgreSQL 17.6 · 1 organization |
| Prospect rows | 3,108 |
| Rows carrying a slug | **6** (the 2E-migrated prospects) |
| Rows with NULL slug, anchored | **3,102** — addressed by ROW ID through the reader's `slug ?? id` |
| Slugs held by more than one row | **0** (max 1 row per slug) |
| Held rows | 2 |

**The conclusion this records:** *slug ambiguity is a SCHEMA risk, not a current-data incident —
there is no duplicate slug today — while UUID-based mutation identity is REQUIRED for almost the
entire current prospect population, because 3,102 of 3,108 prospects have no slug at all.* A
mutation keyed on "the slug" would have addressed 6 rows out of 3,108.

## 2 · The wrong-source behaviour witnessed in the pre-flight

Measured by a temporary probe driving the real route handlers (since deleted, never committed):

| | What the shipping code did |
|---|---|
| P1 | A Postgres-owned promotion answered `ok: true`, left the row `lead`, and **created a phantom vault file** holding only `status: closed-won` and a promotion line |
| P2 | A retry with the same client slug returned 409 although it had succeeded; with a different slug it created a **second client** |
| P4 | Deleting a Postgres-owned prospect returned **404** for a prospect visible on screen; deleting the phantom returned `200 deleted` while the row and its notes survived |
| P5 | Sales deleting a mirrored prospect removed only the **2E rollback copy**, reported success, and left the prospect on `/sales` |
| P6 | A vault file that existed but could not be read was **overwritten with a stub**, destroying its `prospect_id`, name and body |
| P7 | With two rows sharing a slug, promotion silently promoted the first match |

## 3 · The new source-authority invariant

**F43 now binds writers as well as readers.**

- `assertVaultProspectWritable()` throws `VaultProspectWriteRefused` whenever Postgres owns prospects.
  Every vault hit-list writer calls it: `createProspect` (URL intake), the promotion mark's vault arm,
  and `deleteVaultProspect`.
- The writer-side dispatch lives in exactly one place, `core/crm/promote.ts`, which F43's consumer
  list now states alongside the canonical reader.
- Two fitness rules pin it: every writer calls the guard, and the guard refuses on `postgres` rather
  than the other way round (a guard written backwards would satisfy the first rule and permit
  exactly the writes it exists to stop).
- **Mutation identity is `prospect_id`.** A slug or a row id resolves through
  `resolveProspectForMutation` to exactly one row, or the mutation refuses: zero → 404, several →
  409 `ambiguous_prospect`, held (no anchor) → 409 `held_prospect`. Nothing is written in any refusal.

## 4 · Promotion sequence

1. **Resolve** the reference to exactly one anchored row. Refuse otherwise, writing nothing.
2. **Find or create the client** (vault), keyed on `promoted_from_prospect_id`. Creation writes four
   files into `.staging-<slug>-<correlation>/` and publishes them with a **single rename**.
3. **Mark** (Postgres): compare-and-set `status='closed-won'` and append `prospect.promoted` **in one
   transaction**.
4. **Scaffold the project** (best-effort, idempotent). Its failure is reported, never hidden.

The vault hit list is never touched in Postgres mode; Postgres is never touched in vault mode.

## 5 · Retry and idempotency contract

| Mechanism | Form |
|---|---|
| Operation key | `prospect_id` — a prospect becomes a client at most once. The random `promotion_id` is gone. |
| Deterministic client identity | `promoted_from_prospect_id` in `structural_meta.json`; `promoted_from_prospect` keeps carrying the slug for the existing graph edge |
| Compare-and-set | `WHERE id = $1 AND status IS DISTINCT FROM 'closed-won'`; zero rows is disambiguated by reading the row back, so an RLS refusal is never read as "already promoted" |
| Evidence | `prospect.promoted` on the Postgres spine, correlated with the vault `client.created` |
| Repair | A client folder with no `client.created` is the one case a retry re-emits, checked against the log rather than assumed |

A retry with **any** client slug converges on the same client. Changing the slug cannot produce a
second client from one prospect.

## 6 · Partial-outcome vocabulary

`promoted | already_promoted | incomplete | refused`, each carrying per-effect state:

```
client:   created | existing | failed | not_attempted
prospect: marked  | already_marked | not_marked | refused
project:  scaffolded | failed (+reason)
retry:    safe | not_needed | refused
operation: { prospectId, correlationId, store }
```

HTTP: **200** promoted/already_promoted · **202** incomplete · **404/409** refused. Refusal codes:
`prospect_not_found`, `ambiguous_prospect`, `held_prospect`, `client_exists`, `duplicate_client_id`,
`prospect_unreadable`. **No bare `catch {}` remains**: every failure becomes a stated outcome, and
the UI keeps the operator on the page with the truth and a retry rather than navigating away on `ok`.

## 7 · Staged-write guarantee

Four atomic file writes are not an atomic client. A failure on the second used to leave a folder that
`listSubdirs` reported as a client, so every later attempt answered `client_exists` forever — a
promotion that could never be retried into success. Writes now land in a dot-prefixed staging
directory (invisible to `listSubdirs`) and become a client by one `fs.rename`; a failure discards the
staging directory. Proven by a test that fails on the **fourth** file, with three already written.

## 8 · Notes and history guarantee

- Promotion never touches `prospect_notes`. Tests assert the count before and after, for owner and
  sales promotions alike.
- The legacy `prospects.notes` body is still copied once into `business_context.md`.
- The client now carries the **anchor** back to its prospect, so sales history is reachable by an
  identity that cannot be renamed.
- Postgres-mode deletion is refused, so the `ON DELETE CASCADE` on `prospect_notes` cannot fire.
- Vault deletion emits `prospect.deleted`, which **retires F21's exemption** for that route: the
  unlink moved into `core/crm.deleteVaultProspect`, where the write and its event live together.

## 9 · Event attribution

`prospect.promoted` is appended to the **Postgres** spine, subject `prospect_id` (matching
`prospect.created`), `actor: "operator"`, `actor_user_id` = the membership-resolved caller, sharing a
`correlation_id` with the vault `client.created`. Proven for the owner and for a sales principal.
Before D1a it went to vault JSONL with no user at all, so a sales promotion was attributed to nobody —
which §19's adoption measurement counts.

## 10 · Deletion refusal (pending D1b)

Postgres mode returns **409** `outcome: "unsupported"`, naming archival and D1b, with
`changed: { prospect: none, notes: none, vault: none }`. Tested for owner and sales: the row, its
notes and the 2E mirror are all intact afterwards. The button shows the refusal and does not
navigate. There is no fallback to a vault write.

## 11 · URL-intake refusal (pending its port)

`createProspect` refuses at the core boundary before any write; the route maps that to a truthful 409
directing the operator to sheet intake, which writes Postgres. The core refusal is tested directly.
**Accepted limitation:** the route's 409 mapping is code-level only — exercising it end-to-end would
require an external network fetch, which was deliberately not made.

## 12 · Authorization

| | Owner | Sales |
|---|---|---|
| Promote an anchored prospect | ✅ | ✅, attributed to the sales user |
| Promote a held prospect | refused (no anchor) | refused (no anchor) |
| Delete a Postgres-owned prospect | 409 unsupported | 409 unsupported |
| Delete a vault-owned prospect | ✅ (+ event) | ✅ (+ event) |

Every principal is membership-resolved through the real admission chain; no path accepts a declared
role. Sales's database ceiling is unchanged: it holds no DELETE on `prospects`, and D1a adds no grant.

## 13 · Mutation-probe evidence — 10 of 10 caught

| Mutation | Caught by |
|---|---|
| The store dispatch removed (always the vault arm) | M1, M2, M4, M5, M6, M7, M8, M10 + 2 more |
| The vault writer guard made a no-op | M9 ×2, M11 |
| Compare-and-set predicate removed | M2 |
| Find-client-by-anchor removed | M2, M4, M5 |
| The event append swallowed instead of failing the transaction | M5 |
| Unambiguous resolution replaced by first match | M7 |
| The held-prospect refusal removed | M8 |
| Strict vault read replaced by the swallowing reader | M12 |
| Staged client write replaced by writing in place | **M6b** |
| Event attribution dropped | M1, M10 |

**A probe found a weak test of mine.** The original staged-write test failed *before* the first byte
was written, so it could not distinguish a staged write from an in-place one — the mutation left it
green. **M6b** was added, failing on the fourth file, and it catches that mutation. The weakness is
recorded rather than quietly fixed.

## 14 · Final gate state

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 source errors |
| `eslint` on the changed code | clean (one pre-existing warning in `app/api/console/search/route.ts`, untouched) |
| `tests/db/d1-promotion.test.ts` | **19 passed** |
| `gate:static` | 1,818 passed · 9 skipped · 1 failed — the pre-existing fail-closed environment check (11 suites needing absent variables, unchanged by D1a) |
| `gate:server` | 3 passed · 5 skipped |
| `gate:db` | **466 passed** · 199 skipped (447 + the 19 new) |

Verified before commit: the working diff holds only the D1a implementation, its tests and the
contract; the pre-flight probe is absent; no mutation-probe edit remains; **no production mutation
occurred** (the one authorized contact was the read-only aggregate); and the real vault mirror is
untouched — 8 hit-list files, newest mtime 2026-08-27, 6 client folders, no staging directories, and
no test-fixture name anywhere in it.

## 15 · Carried verification debt

**A true concurrent double-promotion is not tested.** PGlite is a single in-process connection, so
concurrency was proven indirectly: by the compare-and-set predicate, by the anchor lookup, and by the
mutation probe that removes each. Owner-accepted as carried debt, **explicitly carried into D1b's
acceptance contract**, where migration 009 and its real-database recovery proof provide the natural
place to exercise concurrent promotion and archival. D1a was deliberately not expanded to build a
server-backed concurrency harness.

## 16 · The exact D1b boundary

1. **`009_prospect_archival.sql`:** `archived_at timestamptz`, `archived_by uuid REFERENCES users(id)`,
   a partial index for the active set, and a **column-level UPDATE grant on those two columns to
   `ascend_sales`** — the bounded operation, never a raw DELETE grant. RLS keeps the existing
   anchored-rows-only predicate for sales.
2. **`prospect.archived`** in the domain union, appended in the same transaction as the update.
3. **`archiveProspect`** in `core/db/prospects.ts`: compare-and-set on `archived_at IS NULL`, reusing
   `resolveProspectForMutation` and the D1a refusal vocabulary.
4. **The canonical reader excludes archived rows**; `prospect_notes` stay readable and are never
   cascaded.
5. **The delete route** performs archival and returns `archived | already_archived | refused`; D1a's
   409 is removed at that point. Hard deletion is not exposed.
6. **Tests:** the Postgres arm of acceptance case A3, M9 (notes survive, the row leaves the readers,
   the event shares the transaction), **and the carried concurrency case from §15**.
7. **R1 impact:** 009 changes the column set, so `manifest.sql`'s F2 digest changes and the recovery
   proof must be re-run against a new artifact. That work belongs to D1b.

Not in D1b: hard deletion as an administrative capability, URL-intake porting, retiring the vault
mirror, the `PromoteButton` `"growth"` default.
