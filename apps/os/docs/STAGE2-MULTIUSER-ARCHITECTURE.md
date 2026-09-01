# Stage 2 — Multi-User Architecture

**Status: IMPLEMENTED through Stage 2G (`8a511c5`).** Substrate, canonical reader, auth and
invitations all exist; migrations 001–006 are applied to production, `007` is not. Supersedes the
scope of [STAGE2-SHEETS-INTAKE.md](./STAGE2-SHEETS-INTAKE.md), whose intake, research and UI
contracts remain valid, are re-homed here, and remain UNBUILT.

> **CORRECTED 2026-08-31.** This line read "No code, no vault changes, nothing applied." `bfa00f7`
> added this document alongside `001_substrate.sql` and `core/db/*`. Treat this as a living
> architecture doc, not a pre-implementation contract.

> **A second person must be able to sell from his own machine, without my Mac, my iCloud, my Obsidian vault, or my filesystem.**

Treated as a substrate requirement, not a UI one.

---

## 0. Three findings that reframe the question

Traced from the repository before anything else, per the H0–H8 methodology.

### 0.1 Supabase is not in this codebase

```text
grep -rn "supabase|postgres|prisma|drizzle" → 0 hits outside node_modules
apps/os deps: framer-motion geist gray-matter lucide-react marked next react tailwind vitest
```

The premise "Supabase is already part of the broader Ascend architecture" **is not true of this repository.** It may be true of another Ascend project or of an intention; it is recorded here as **unverified**, and §3 evaluates Postgres-with-Supabase on its merits rather than on that premise. The architecture below is deliberately built so this choice stays reversible (§3.4).

### 0.2 Ascend OS is already deployed and already reachable by a second person

`.env.production.local` is not a template. It says:

```text
PRODUCTION runtime config for the launchd service
… this instance is reachable over the tunnel
… the dev password was displayed in a chat transcript
```

So a production instance already runs as a launchd service on the Mac and is exposed over a tunnel with distinct credentials.

**The network problem is already solved. The identity problem is completely unsolved.** Authentication is one shared password with a stateless HMAC session (`lib/auth.ts`) — no users, no roles, no attribution. Two people sharing it produces a system that cannot say who did anything, which makes `created_by`, `assigned_to` and `human_judgment_by` (§7) unimplementable and makes §19's adoption metric meaningless.

Availability is also bounded by one laptop being awake.

### 0.3 An LLM SDK already lives one directory away from F12

```text
ROOT package.json → "@anthropic-ai/sdk"
  consumed by app/api/onboarding/chat/route.ts
             app/api/onboarding/generate-brief/route.ts
```

This does **not** violate F12 — F12 scans `apps/os` directories only, and the marketing site is outside them. But it means the prohibition is **directory-scoped, not repository-scoped**, and a shared backend that both apps reach creates a path around it that no current rule covers. See §O.

---

## A. Current architecture

```text
                    Obsidian vault (iCloud)            ← source of truth, TWO authors
                    ├── 01 CRM & Clients/              markdown + structural_meta.json
                    ├── 02 Sales & Hit List/           6 prospects (4 anchored, 2 held)
                    ├── 03 SOP Library/  04 Documents/  05 Client Uploads/
                    └── .ascend-os/                    8 event logs + 7 record stores
                              ↑
                    core/vault  ── sole fs owner, atomic primitives
                    core/*      ── 16 durable writers, each emitting its own event (F21)
                    core/events ── append-only spine, per-domain JSONL
                    core/reconciler ── observes Obsidian-authored edits → events
                              ↑
                    engines/    ── PURE: no I/O, no clock, no cross-engine imports (F1-F6)
                    mission-control ── the only assembler surfaces may call (F14)
                    app/, components/ ── select and render, never compute (F18, F24)

                    relationships/ ── foreign keys only (F23)
                    graph-view/    ── disposable projection (F17), rebuilt per request, no cache
```

**Principals today: two.** The operator (shared password, full access) and the client portal (per-client invite token, `PUBLIC_PREFIXES = ["/portal/"]`, enforced in-handler). The portal is the only existing precedent for a non-operator principal — and it is token-per-client, not user-per-person.

**Organization: a constant.** `ORGANIZATION_ID = "ascend"` is written into every event and every `structural_meta`, and **read for filtering nowhere**. D9's "field preserved everywhere, machinery deferred" is accurate. Two writers bypass the constant and hardcode the literal (`core/crm/promote.ts:118`, `onboarding/apply.ts:124`) — a small inconsistency to fix when the field becomes load-bearing.

---

## B. Proposed shared architecture

### B.1 The decisive structural fact

**A deployed app has no filesystem and no vault.** That single fact settles the private/shared boundary — it is forced by deployment, not chosen by preference:

```text
   PRIVATE / LOCAL                          SHARED / DEPLOYED
   Oscar's Mac                              anywhere, any device
   ─────────────────────                    ────────────────────────
   Obsidian vault                           Postgres
   clients · projects · documents           prospects · imports
   SOPs · knowledge · personal context      research findings · evidence
   finance · production                     human assessments
   the graph / second brain                 sales activity · assignments
   the reconciler                           the event spine
```

### B.2 Why moving prospects OUT of the vault makes their provenance *stronger*

This is the argument that decides it, and it comes from the project's own doctrine rather than from convenience.

`COMMERCIAL-PROVENANCE.md` §5:

> For records Ascend authors exhaustively, absence IS evidence. For facts Ascend records only when it remembers, absence is ignorance.

The vault has **two authors** — Ascend and the operator editing markdown — which is precisely why `core/reconciler` exists and why prospect absence can never be trusted there (`observation.ts:249`: *"a missing file cannot be distinguished from a rename"*).

A Postgres prospects table has **one author: Ascend.** Nobody hand-edits 600 rows. That puts prospects in the `invoices.jsonl` class — exhaustively authored, so absence carries information — instead of the "recorded when we remember" class.

> **The two-author problem does not follow prospects into the shared store. It stays with the notes, where it belongs.**

### B.3 What each layer becomes

| layer | change |
|---|---|
| `packages/domain` | **unchanged.** Pure, storage-agnostic. This migration is only possible because that purity was held. |
| `engines/` | **unchanged.** Pure functions over read-models. |
| `mission-control` | **unchanged** signatures; assembles from whichever adapter owns the entity. |
| `core/vault/*` | **retained**, scoped to vault entities only. |
| `core/db/*` | **new.** The second storage adapter. |
| `core/crm/prospect.ts` | re-homed onto `core/db`; **same exported signatures**, so every one of its nine callers is untouched. |
| `core/events` | moves to Postgres wholesale — see §H. |
| `core/reconciler` | **retained**, now observing vault entities only, emitting into the shared spine. |
| surfaces | split into two deployments — §J. |

**Ascend OS is therefore the superset, not the shared layer.** The local app = vault (private) + Postgres (shared). The partner's app = Postgres only. The domain kernel and engines are shared by both.

---

## C. Data ownership matrix

| entity | lives | source of truth | writes | reads | provenance |
|---|---|---|---|---|---|
| prospect | Postgres | Postgres | Ascend only (import, research, UI) | owner, sales | event + `created_by` |
| prospect identity (`prospect_id`) | Postgres | Postgres | minted once, `UNIQUE` | both | Stage 1 anchor, unchanged |
| identity hold | Postgres | Postgres | human release only | both | `hold_reason`, stated |
| import batch | Postgres | Postgres | import only | both | `file_sha256`, verbatim rows |
| source row | Postgres | Postgres | import only, append-only | both | batch FK, byte-verbatim |
| research finding | Postgres | Postgres | research only, append-only | both | `evidence[]`, non-empty when established |
| human assessment | Postgres | Postgres | **humans only** | both | `assessed_by`, `assessed_at` |
| sales activity | Postgres | Postgres | humans + system | both | event, actor-attributed |
| event spine | Postgres | Postgres | every writer | both | `actor` + `actor_user_id` |
| **client** | vault | vault | owner only | **owner only** | reconciler-observed |
| **project / phases** | vault | vault | owner only | owner only | reconciler-observed |
| document · invoice · time · care | vault | vault | owner only | owner only | existing |
| SOPs · knowledge · notes | vault | vault | owner only | owner only | Obsidian |
| graph projection | derived | **nothing** | never written | owner only | F17 — disposable |

**The partner never reads a vault-backed row.** Not by permission check — by the deployed app having no filesystem.

---

## D. User / role model

Minimum viable, deliberately small.

```text
organization (id, name)          ← ORGANIZATION_ID stops being a constant
   └── membership (user_id, organization_id, role)
          role ∈ { owner, sales }
```

| capability | owner | sales |
|---|---|---|
| prospects, research, evidence, assessment, pipeline, outreach, assignments | ✅ | ✅ |
| import a sheet | ✅ | ✅ |
| release an identity hold | ✅ | ❌ |
| clients, projects, production, documents | ✅ | **absent from the app** |
| finance, invoices, time, care plans | ✅ | **absent from the app** |
| SOPs, knowledge, graph, personal context | ✅ | **absent from the app** |
| admin, wipe, portal invites | ✅ | ❌ |

Two roles, not a permission matrix. `role` is a column, so a third role later is data, not a refactor.

**Hold release is owner-only** because a hold encodes an unresolved identity question, and releasing one is the decision Stage 1 refused to automate.

---

## E. Prospect lifecycle

```text
sheet row ──▶ identity matching ──┬─▶ blocked      corroborates a HELD prospect → create nothing
                                  ├─▶ client_match corroborates an existing client → report
                                  ├─▶ matched      one anchored prospect → append source row
                                  ├─▶ ambiguous    2+ anchored → human review
                                  └─▶ new          nothing → CREATE, mint prospect_id
                                                       │
                          research queue ◀─────────────┘
                                  │
                          findings appended (never overwritten)
                                  │
                          human assessment (green/yellow/red)   ← humans only
                                  │
                          pipeline: lead → contacted → proposal → won/lost
                                  │
                          promote → CLIENT (vault, owner-only)
```

### E.1 Held prospects survive the move intact — and get stronger

Stage 1's semantics were enforced by tests. In SQL they become **constraints**:

```sql
prospect_id     uuid UNIQUE                      -- NULLABLE, by design
identity_state  text CHECK (identity_state IN ('anchored','held'))
hold_reason     text
CHECK ((identity_state = 'anchored') = (prospect_id IS NOT NULL))
CHECK ((identity_state = 'held')     = (hold_reason IS NOT NULL))
```

The surrogate row PK is **not** the business identity — that distinction is load-bearing and must be stated in the schema comment, or the next reader will use the PK as the anchor and re-commit D-4.

P3 becomes enforceable in the database rather than by convention:

```sql
-- automation may not write a held row
CREATE POLICY automation_writes ON prospects FOR UPDATE
  USING (identity_state = 'anchored');
```

And P4 — held rows remain **readable** by the matcher — is unaffected, because the policy restricts UPDATE, not SELECT. **A hold is a write barrier, not an information barrier**, expressed exactly.

---

## F. Research lifecycle

Unchanged in substance from STAGE2-SHEETS-INTAKE §3; the store changes, the epistemics do not.

```text
candidate ──▶ DNS ──▶ HTTP ──▶ corroboration ──▶ established | rejected | no_candidate
                                                  │                        | source_unavailable
                                        confirmed URL only                 | not_attempted
                                                  ▼
                                            PageSpeed / defects
```

Preserved verbatim, and each is a mutation gate (§O):

- a **blank website** is `unknown`, never "no website"
- a **resolving domain** is a *candidate*, never a confirmed website
- a **failed request** is `source_unavailable`, never absence
- `confirmed absent` requires an **enumerating source** and is therefore currently unreachable
- `value IS NULL` whenever `outcome <> 'established'` — a `CHECK` constraint, not a convention
- evidence is non-empty whenever `outcome = 'established'` — likewise

Research writes go to `research_findings` (append-only) and **never** to `prospects.website_opportunity`.

---

## G. Import lifecycle

```text
CSV export ──▶ upload ──▶ batch row (file_sha256, column_map, row_count)
                            │
                            ├─▶ source_rows: every cell VERBATIM, empties included
                            │
                            └─▶ dry-run classification ──▶ [HUMAN REVIEW] ──▶ apply
```

Blank-cell semantics (unchanged, and the second mutation gate): *column absent*, *column present but empty*, and *column present with a value* are three distinct states. **An empty cell is a fact about the sheet, never a value on the prospect.**

Dry run is the default. `blocked`, `ambiguous`, `conflict` and `client_match` write nothing and are never folded into `new`.

---

## H. Event model

### H.1 The whole spine moves, and the ordering contract gets stronger

Splitting the spine would break `readEvents`' unified merge and its tie-break on log position. Moving it whole does not — it **improves** it:

```text
today  occurred_at  →  log position  →  (event_id is NOT ordering)
after  occurred_at  →  seq BIGSERIAL →  (event_id is NOT ordering)
```

`core/events`' header argues log position is "the strongest causal signal available". A database sequence is strictly stronger: durable, total, and immune to file merges. **The rule that `event_id` (UUIDv7) must never order anything carries over unchanged** — its sub-millisecond bits are still pure random.

### H.2 Actor must gain a subject

```text
today   actor: "operator" | "client" | "system" | `agent:${string}`
after   actor      — the KIND, unchanged vocabulary
        actor_user_id — WHICH human, null for system/agent
```

The kind vocabulary is not widened. "operator" keeps meaning *a human working in the OS*; the new column says which one.

### H.3 §19 must be scoped, not redefined

`COGNITION-OBSERVATION` §19 pre-registers the metric and its failure semantics:

> No widening the definition of an active day… the metric and threshold recorded here travel with it unchanged.

A second human generating operator events would inflate it silently — **an accidental redefinition, which the pre-registration forbids.** So:

> **§19 continues to measure the original operator's events only, scoped by `actor_user_id`.**

Partner adoption, if wanted, is a **separate** metric with its own pre-registration. Import and research remain `actor: "system"` (D-3), so a 600-row import still produces zero operator events.

| origin | actor | actor_user_id | counts toward §19 |
|---|---|---|---|
| operator action in the OS | `operator` | Oscar | ✅ |
| partner action in the sales app | `operator` | partner | ❌ (separate metric) |
| import | `system` | null | ❌ |
| automated research | `system` | null | ❌ |
| reconciliation | `system` | null | ❌ |
| historical onboarding | `system` | null | ❌ |
| client portal | `client` | null | ❌ |

---

## I. Second-brain integration

**The graph stays local and stays a projection.** It reads the vault, so it cannot be deployed; and F17 already declares it disposable. Nothing about multi-user changes that.

`buildStructuralContext` becomes a **cross-store join** — vault clients/projects/documents plus Postgres prospects/batches/findings. It is already an in-memory join across nine readers; adding a second backing store does not change its shape.

New subjects and edges, each backed by a foreign key that exists on disk (§0's rule: *if a kind cannot name the field that asserts it, it does not belong in the substrate*):

| edge | FK | precedent |
|---|---|---|
| `imported_in` prospect → import_batch | `source_rows.batch_id` | — |
| `evidenced_by` prospect → research_finding | `research_findings.prospect_id` | **`measured_by` client → audit** |
| `promoted_to` prospect → client | `structural_meta.promoted_from_prospect` | existing, unchanged |

`evidenced_by` is legal for the same reason `measured_by` is: an audit and a finding are both Ascend-authored records joined by an FK. The edge asserts *this record exists and refers to this prospect*, not *this prospect has a bad website*.

**Prohibited, per F23.7:** `has_opportunity`, priority, "ready to hit", flags. These have no record and no FK — `lib/opportunities` synthesises them per request. graph-view may draw them; nothing may traverse them as structure.

**Human assessment stays a property**, not an edge. It is a scalar on the prospect, not terrain.

---

## J. UI architecture

### J.1 Two deployments, one codebase, enforced by a rule

```text
apps/os      LOCAL   · vault + Postgres · owner only · full OS + graph
apps/sales   HOSTED  · Postgres only    · owner + sales · responsive, phone-first
             └── may never import core/vault  ← fitness rule, not a config flag
```

A config flag that disables finance is a silent fallback. **A build that cannot import the module is a structural guarantee** — the same philosophy as F1/F14, applied to a deployment boundary.

### J.2 The sales surface answers seven questions in order

```text
WHO is this?            name · category · locality · source batch
WHAT do we know?        sheet values, verbatim, attributable
WHAT did Ascend find?   website · confirmed/rejected/unknown · evidence
WHAT don't we know?     three distinct blanks, never one empty cell
WHAT did a human judge? 🟢🟡🔴 — visually separate from findings, always
WHY contact them?       the observed defects, stated as observations
WHAT next?              assign · contact · follow-up · note · advance stage
```

Three blank renderings, never collapsed:

```text
— never researched     (not_attempted)       → research it
— not identified       (rejected/no_candidate) → supply a URL
— unavailable          (source_unavailable)  → retry later
```

**Human judgment and automated findings never share a component**, let alone a field. On the card they are separate labelled blocks with different visual weight.

Responsive: phone is the primary target for the sales role (a salesperson is not at a desk); desktop for review and import. Filters: assessment colour, website status, research status, assignment, stage.

---

## K. Security model

| concern | decision |
|---|---|
| authentication | real user accounts; email + password or magic link. **The shared password is retired.** |
| session | server-verified; the existing stateless HMAC is fine for one operator and cannot express two |
| authorization | **server-side, always.** Role checks in the UI are cosmetic |
| isolation | every table carries `organization_id`; **RLS on every table**, default deny |
| enforcement | RLS is the backstop; the app must not be the only gate |
| audit | the event spine, now with `actor_user_id` |
| secrets | never in the client bundle; research API keys server-only |
| least privilege | the research runner uses a role that can write findings and **cannot** write assessments |
| the tunnel | reassessed — a hosted app makes the launchd tunnel unnecessary for the partner |

The `automation_writes` policy (§E.1) and a research role that structurally cannot touch `website_opportunity` turn F31 from a source-text rule into a database permission.

---

## L. Scale analysis

### L.1 The O(N²) path, measured

`createProspect` calls `buildProspectIdIndex()`, which reads **every** prospect file, so importing N rows performs O(N²) reads. Measured on a local temp vault (SSD, no iCloud):

```text
N=  50   170 ms   (3.4 ms/row)
N= 100   396 ms   (4.0 ms/row)
N= 200  1411 ms   (7.1 ms/row)
N= 400  5722 ms  (14.3 ms/row)     ← ms/row doubles as N doubles
```

Fitting T = kN², k ≈ 0.0358 ms → **600 ≈ 13 s · 1,200 ≈ 52 s · 5,000 ≈ 15 min**, before iCloud sync.

**The architectural correction, required in Stage 2A:** the uniqueness check becomes a `UNIQUE` index. O(N) total instead of O(N²), and it is *enforced* rather than *checked* — a race between two importers cannot produce a duplicate, which the filesystem version could not guarantee at all.

If the vault were retained, the correction would instead be to build the index once per batch and thread it through `createProspect`. That is strictly worse: it is correct only while one process writes.

### L.2 Projected

| | 100 | 600 | 1,200 | 5,000 |
|---|---|---|---|---|
| import (vault, today) | 0.4 s | 13 s | 52 s | ~15 min |
| import (Postgres) | <1 s | ~2 s | ~4 s | ~15 s |
| `listProspects` (vault) | 3 ms | ~15 ms | ~30 ms | ~125 ms |
| prospect query (Postgres, indexed) | <5 ms | <5 ms | <10 ms | <20 ms |
| **graph rebuild** | fine | **degrades** | **degrades** | **unusable** |
| markdown files in iCloud | fine | risky | risky | **conflict-copy hazard** |

### L.3 The graph is the next bottleneck after the import

`graph-view/projection` reads **thirteen sources per request with no cache**, including `listProspects()` and `detectOpportunities()` (which itself calls `listProspects()`). Prospects entering the graph as subjects makes every render O(prospects + findings).

**Correction:** the graph must be *scoped* — a prospect enters the projection only when it participates in an edge a human cares about (assigned, contacted, promoted), not because it exists. 5,000 unvisited prospects are rows, not nodes.

### L.4 iCloud is a demonstrated hazard, not a hypothetical

During Stage 1 verification the **repository itself**, on iCloud-synced Desktop, produced **13 byte-identical `" 2"` conflict copies** of build output, one of which broke `tsc`. `isVaultArtifact` defends the vault against exactly this shape and has never been exercised past six files. This is evidence, not risk.

### L.5 Other limits

Research is rate-limited by politeness and PSI quota (25k/day with a key), not by storage. Concurrent writes become real with two users — the vault has no locking; Postgres has transactions.

---

## M. Migration path

Small in volume, large in consequence. Same discipline as H5: **snapshot → plan → validate → [review] → apply → verify → reversible.**

```text
6 prospects (4 anchored, 2 held) · 41 events · 7 record stores
```

1. **Dual-read, vault-authoritative.** Schema created; nothing reads it. Verified against the vault.
2. **Backfill + verify.** Every prospect and event copied with identity preserved; the two held rows arrive `identity_state='held'` with their reasons; verification proves counts, ids, hold state and event ordering match.
3. **Flip the read for prospects + events only.** Vault files retained, read-only, as the rollback.
4. **Retire prospect markdown** only after a stated soak period.

**Invariants across the move:** `prospect_id` values are preserved exactly — never re-minted. No event is re-timestamped, re-actored or re-ordered. The two Tapia records stay held, unmerged, unrenamed. The migration emits **no business event**; it is an identity-and-storage operation, exactly as Stage 1 was.

---

## N. Failure modes

| failure | mechanism | guard |
|---|---|---|
| **held → new on import** | matcher excludes held rows | mutation gate §O.1; RLS keeps SELECT open |
| **blank → "no website"** | empty cell read as absence | mutation gate §O.2; `CHECK` on value/outcome |
| research overwrites judgment | one field, two writers | separate columns + research role lacks the grant |
| PK mistaken for identity | surrogate `id` treated as the anchor | schema comment + `prospect_id UNIQUE` nullable |
| §19 silently inflated | partner events counted as operator | scope by `actor_user_id` (§H.3) |
| 500 operator events from one import | actor default | `actor: "system"`, F33 |
| partner reads finance | role check only in UI | module absent from the build + RLS |
| vendor lock-in | Supabase client scattered through code | all access via `core/db` (§3.4) |
| dual source of truth | vault and DB both writable | one-way flip, vault read-only after |
| graph collapse | 5,000 prospects as nodes | scope the projection (§L.3) |
| iCloud conflict copies | many files, synced | prospects leave the vault |
| offline | hosted app, no connection | **UNKNOWN — see §19.11** |
| F12 bypass | shared package imported by the root site, which has the SDK | extend F12 scanning (§O) |

---

## O. Fitness / enforcement requirements

Existing rules that must be updated, not merely respected:

| rule | change |
|---|---|
| **F12** | scan `core/db`, `apps/sales`, and any new shared package. §0.3 makes this urgent: the prohibition is directory-scoped and an SDK already exists in the monorepo |
| **F15** | the canonical reader set gains DB-backed readers; the "one reader per read-model" rule is unchanged |
| **F21** | every DB writer emits its own event, exactly as vault writers do |
| **F23** | `imported_in` / `evidenced_by` added; `has_opportunity` still prohibited |
| **F29** | `prospect_id` still minted in one place; the surrogate PK is never identity |

New:

| | |
|---|---|
| **F31** | no research/ingest module references `website_opportunity`; a full run leaves it byte-identical |
| **F32** | `outcome='established'` ⟺ non-empty evidence; `outcome<>'established'` ⟹ `value IS NULL` |
| **F33** | ingest and research emit explicit `actor:"system"` (F25/F27 shape) |
| **F34** | source rows and findings are append-only |
| **F38** | no automated writer accepts a held prospect |
| **F39** | `apps/sales` never imports `core/vault` — the deployment boundary, structurally |
| **F40** | every table carries `organization_id` and has an RLS policy; default deny |

### O.1 / O.2 — the two mutation gates

Not "tested" — **mutation-tested**, because both are one-line shortcuts that would poison 600 records in one import.

```text
GATE A   mutation: remove held rows from the matcher's candidate set
         expected: the Tapia row classifies as `new` → a THIRD Tapia is created
         → the test MUST fail

GATE B   mutation: treat an empty website cell as evidence of absence
         expected: website_exists becomes `confirmed absent` with no enumerating source
                   → 484 prospects assert they have no website
                   → each collects +30 in computeScore
         → the test MUST fail
```

Stage 0.5 and Stage 1 each found real defects this way, including one vacuous gate of my own. Inspection would have caught neither.

---

## P. Stage breakdown

| stage | delivers | gate |
|---|---|---|
| **2A · shared substrate** | schema, `core/db` adapter, org/user/membership, RLS, auth, event spine migration, **the O(N²) correction**. No new features. | dual-read verification: DB and vault agree on all 6 prospects and 41 events; hold state preserved; ordering preserved |
| **2B · identity + hold semantics** | `identity_state` constraints, matcher with five outcomes, hold-release as an owner-only action | **Gate A mutation-tested** |
| **2C · sheet intake** | batch, verbatim source rows, dry-run review UI | dry-run the real sheet and review by hand before one write |
| **2D · research** | collectors, corroboration engine, append-only findings, website + existence only | **Gate B mutation-tested**; pre-registered precision *and blank rate* recorded before results are seen |
| **2E · sales workspace** | `apps/sales`, responsive, assessment control, evidence drawer, pipeline actions | partner completes a full outreach loop from a phone without touching Obsidian |
| **2F · graph integration** | `import_batch` + `research_finding` subjects, two edges, scoped projection | F23 green; graph render time flat as prospects grow |

2A is the only stage that must land before any other. 2C–2E are independently reviewable.

---

## Final decisions

### 1 · Shared backend — **Postgres, accessed only through `core/db`**

**Evidence:** deployed apps have no filesystem (§B.1); the O(N²) uniqueness check becomes a `UNIQUE` index (§L.1); the vault has no transactions or locking and two users introduce concurrent writes; iCloud conflict copies are demonstrated, not hypothetical (§L.4); RLS turns three convention-enforced rules into database constraints (§E.1, §K).
**Rejected:** JSONL + iCloud — cannot serve a second machine, cannot lock, and its conflict behaviour is already observed. Retaining the vault with a batch-threaded index — correct only while one process writes.
**Consequence:** the vault stops being the single source of truth and becomes the *private* source of truth. This is the largest architectural change since the spine was built.
**Verification:** dual-read parity on 6 prospects and 41 events; ordering preserved; hold state preserved.
**Supabase specifically: RECOMMENDED BUT UNVERIFIED (§0.1).** Postgres + Auth + RLS in one product matches the requirement closely. Because all access is through `core/db`, the vendor is replaceable — that adapter is what makes this decision reversible, and it is not optional.

### 2 · Private/local boundary — **notes stay, records move**

**Evidence:** §B.2 — the vault's two-author problem is what the reconciler exists for, and it should not follow machine-authored records into a shared store.
**Rejected:** moving everything (destroys Obsidian as a thinking tool); moving nothing (fails the requirement).
**Consequence:** the partner structurally cannot reach client, finance, production or knowledge data.
**Verification:** F39 — `apps/sales` cannot import `core/vault`.

### 3 · Prospect storage — **Postgres rows; markdown retained only for the 6 existing, read-only, then retired**

**Evidence:** §L.2; §L.4.
**Rejected:** markdown-per-prospect at 5,000 (conflict hazard, quadratic writes, graph collapse).
**Consequence:** prospects leave Obsidian. Mitigation: an owner-only export can materialise a note for a prospect under active work.
**Verification:** import 600 rows in <5 s with zero duplicate ids.

### 4 · Authentication — **real user accounts; the shared password is retired**

**Evidence:** §0.2 — one password cannot attribute anything, making `created_by`, `assigned_to` and `human_judgment_by` unimplementable.
**Rejected:** password-per-role (still unattributable); portal-style tokens (per-client, not per-person).
**Consequence:** `lib/auth.ts` is superseded for the shared app.
**Verification:** every event carries a resolvable `actor_user_id`.

### 5 · Authorization — **server-side, RLS as backstop, default deny**

**Evidence:** §K; the existing middleware is already deny-by-default and that posture is kept.
**Rejected:** UI-only role checks.
**Verification:** F40; an authenticated `sales` user is refused at the data layer with the app bypassed.

### 6 · Organization model — **`organization_id` becomes real now; one org, many users**

**Evidence:** the field already exists on every event and every `structural_meta` (§A) — D9 deferred the machinery, not the field.
**Rejected:** deferring again (retrofitting a tenant key later is the painful path §15 warns about); building multi-tenancy now (unneeded).
**Consequence:** future multi-tenancy is a policy change, not a schema migration.
**Verification:** F40; two seeded orgs cannot see each other's rows.

### 7 · Event semantics — **kind unchanged, `actor_user_id` added, §19 scoped not redefined**

**Evidence:** §H.3 — §19's pre-registration explicitly forbids widening the metric.
**Rejected:** counting partner activity toward §19 (silent redefinition); a new actor kind per person (breaks the frozen vocabulary).
**Verification:** a 600-row import produces **zero** operator events; §19 recomputed over `actor_user_id = Oscar` matches its pre-move value.

### 8 · Second-brain boundary — **the graph stays local, stays a projection, and gets scoped**

**Evidence:** §I, §L.3; F17 already declares it disposable.
**Rejected:** a shared graph (requires the vault); prospects as nodes by default (collapses at 5,000).
**Verification:** F23 green; render time flat as prospects grow.

### 9 · F12 — **CLOSED, and its scope must be widened**

**Evidence:** §F — every research question is decidable by DNS, HTTP, corroboration or PageSpeed. The one thing a model does well here is invent a plausible URL for a business that has none, which is the exact failure this pipeline exists to prevent. §0.3: the prohibition is directory-scoped and an SDK already exists in the monorepo.
**Rejected:** opening F12 because "research" sounds like an AI task.
**Consequence:** GBP presence stays `not_attempted` and `confirmed absent` stays unreachable until a Places API is separately authorised — **not an LLM question.**
**Genuinely open, recorded rather than silently resolved:** interpreting established evidence and ranking outreach. Downstream of the trust boundary; needs its own contract, with one rule fixed in advance — **model output may never become an established finding, only a candidate a human confirms.**
**Verification:** F12 extended to `core/db`, `apps/sales`, and every shared package.

### 10 · Stage 2A scope — **substrate only**

Schema · `core/db` · org/user/membership · RLS · authentication · event-spine migration · the O(N²) correction. **No importer, no research engine, no sales UI, no graph changes.**
**Verification:** dual-read parity, then a reviewed one-way flip for prospects and events only, vault retained read-only as the rollback.

---

## Unknowns — recorded, not guessed

1. **Is Supabase actually intended?** Not in this repo (§0.1). Decision 1 holds for any Postgres; the vendor needs confirmation.
2. **Offline behaviour.** Not specified. A hosted app requires connectivity; whether the partner needs offline capture is unknown and would change the client architecture materially.
3. **Hosting target and cost.** Vercel is used elsewhere in the monorepo but is unconfirmed for the OS.
4. **The tunnel.** Its mechanism is not recorded here; a hosted sales app may make it unnecessary.
5. **Whether the owner app should also be hosted.** It needs the vault, so it is local by default — unless the vault itself is later reconsidered, which this document does **not** propose.

---

## Status

```text
identity            4 anchored · 2 held · 0 residue      (applied, Stage 1)
gate                P1-P4                                 (adopted)
this contract       WRITTEN, not implemented
live vault          untouched
code                unchanged
F12                 CLOSED, scope widening required
blocking            decisions 1 and 3 need sign-off before 2A
```

No code changed. No vault touched. Nothing applied.