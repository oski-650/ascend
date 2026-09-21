# Slice 2A — Sales action persistence · PRE-FLIGHT / DISCOVERY

**Status: ACCEPTED (owner, 2026-09-21), with decisions frozen — see §20. 2A.0 implemented: `docs/SLICE-2A0-CHECKPOINT.md`.**

*As first written:* **DISCOVERY ONLY. Nothing implemented.** No migration 010 written, no production contact, no
deployment, no push. Baseline `d3f96e3` (D1 COMPLETE + DEPLOYED; serving build `2NCS2fCKGRoKqk3tUd4F8`).

**The business question 2A must make answerable:**
*after someone contacts a prospect — what happened, what stage is it now in, who owns the next action,
and when is it due?*

**The headline finding: today, none of that is answerable, because nothing in production can record it.**

---

## 0 · Baseline check

| Frozen baseline item | Found |
|---|---|
| D1 COMPLETE + DEPLOYED | ✅ HEAD `d3f96e3`, tree clean, serving `2NCS2fCKGRoKqk3tUd4F8` (PID 18362) |
| schema 009 · 3,108 prospects · 0 archived · 22,811 events | **Not re-measured** — this pre-flight made no production contact. Last measured at D1 deployment acceptance |
| owner provisioned; no sales partner | consistent with every source read |
| recovery point = post-009 artifact; RT-1 and I1 open; no 2A work | ✅ |

No material difference was discovered. §18 proposes one optional read-only aggregate to size the design
against real data (stage distribution, contact-date and phone coverage).

---

## 1 · Current sales-state source map

| Concept | Where it lives | **Writer in the deployed (Postgres) mode** | Readers |
|---|---|---|---|
| **Stage** | `prospects.status` — CHECK `lead \| contacted \| proposal \| closed-won \| closed-lost`, nullable | **Import only** (a sheet `status` column, `core/intake/projection.ts:92`) and **promotion** (`closed-won`, D1). **Nothing else.** | `/sales` (groups by stage), `/partner` (open = not won/lost), forecast, pipeline engine, automations (`prospect.status_is`), operator brief, knowledge/search |
| Stage history | `prospect.status_changed` event | **Only the VAULT reconciler** (`core/reconciler`), observing Obsidian frontmatter edits, as `actor: "system"`. It never writes Postgres | — |
| First / last contact | `prospects.first_contact`, `last_contact` (`date`) | **Promotion only** sets `last_contact = current_date` (the database's date, not a business date). **Import does not map them** | prospect page "intel", AI target context |
| **Contact attempt** | `prospect.contacted` event type | **Declared, zero emitters** | — |
| **Contact outcome** | **nothing** | — | — |
| **Owner / salesperson** | `prospects.assigned_to` (uuid → users) | **No writer anywhere** | no reader either |
| **Next action / follow-up** | **nothing** | — | — |
| Legacy notes body | `prospects.notes` | migration/vault only; **6 non-empty of 3,108** | prospect page, target context |
| Notes log | `prospect_notes` (008), append-only, attributed | `POST …/notes` under `prospects:write` | prospect page |
| Human judgment | `website_opportunity` + provenance | `assessWebsiteOpportunity` — **no caller** | — |
| Vault hit list | 8 files (the 2E mirror) | refused in Postgres mode (D1a) | vault mode only |
| Score | computed — reads **only** qualification and website fields | — | `/sales` order, pipeline |

**In the deployed mode, a stage change, a contact, an owner and a follow-up have no write path at all.**
For the 3,102 imported prospects there is no contact history of any kind. Stage for them is whatever
the import sheet said, and there is no route to move it.

**Constraints the map imposes:**

- `/tasks` states it must never gain a standalone task entity ("every task belongs to a project phase").
  2A's next action must be **prospect-scoped**, not a generic task model.
- The forecast (`lib/forecast.ts`) and pipeline engine hard-code exactly the five stages. **An
  unmodelled stage is silently excluded from the forecast**, with only a console warning. Extending the
  stage vocabulary is not free.
- `computeScore` does not read stage or contact data, so 2A changes **no score**. That's correct: clean
  facts first, and the Sales Engine later.

---

## 2 · Domain model proposal

**Three concepts. One existing column stays authoritative, and two new structures are added.**

| Concept | Kind | Home |
|---|---|---|
| **Stage** — where the prospect is | current state | **`prospects.status` (existing, stays the single authority)** |
| **Contact attempt** — what happened, when, by whom | immutable fact, append-only | **new:** `prospect_contacts` |
| **Follow-up** — what happens next, when, whose job | a single stateful slot per prospect | **new:** `prospect_followups` |
| **Owner** — whose prospect it is | current state | **`prospects.assigned_to` (existing, first writer arrives in 2A)** |

`first_contact` / `last_contact` remain as **projections**, maintained in the same transaction as each
contact, so every existing reader keeps working unchanged.

---

## 3 · Outcome vs stage — kept separate on purpose

**Outcome** is a fact about **one attempt**. **Stage** is a judgment about **the relationship**. Merging
them is how a single "no answer" would regress a qualified prospect, and how the same idea ends up in
two fields that drift apart.

**Rules:**

1. `prospects.status` stays the **only** stage. No parallel `stage` column.
2. **Keep the existing five stages for 2A.** "Meeting set", "callback requested" and "interested" are
   **outcomes**, not stages. Adding `qualified`/`meeting` is an owner decision (§18). If taken, it must
   ship with the forecast probability model and the pipeline engine updated in the same slice.
3. **Outcomes never change stage by themselves**, with one exception presented as a **suggestion the
   user confirms**: the first contact on a `lead` suggests `contacted`.
4. **`closed-won` is refused as a 2A stage change.** Winning goes through **Promote** (D1's
   source-correct path, which creates the client). A bare stage flip to `closed-won` would bypass that.
5. `closed-lost` is settable through 2A. Reopening from `closed-lost` is an owner decision (§18).

**Candidate outcome vocabulary** — derived from the workflow, since the repository has none. **Not
frozen:**

| Outcome | Meaning |
|---|---|
| `no_answer` | rang, nobody picked up |
| `left_voicemail` | left a message |
| `spoke` | a real conversation happened |
| `callback_requested` | they asked us to call back |
| `meeting_set` | a meeting or site visit was agreed |
| `not_interested` | explicit decline |
| `wrong_number` | contact data is bad |
| `email_sent` / `text_sent` | written outreach |

`interested` is deliberately **not** an outcome. It is a judgment that belongs in stage and in the
existing qualification fields (`decision_maker_access`, `project_urgency`), which already feed the score.

**Channel** is a separate small field (`call | email | text | in_person | other`), so "what was tried" and
"what happened" don't multiply into a combinatorial enum.

---

## 4 · Next-action model

**One open follow-up per prospect**, enforced by the database rather than the UI.

| Field | Why |
|---|---|
| `action` — `call \| email \| text \| meeting \| other` | what to do |
| `due_on` (date, required) + `due_at` (timestamptz, optional) | day-level due state; a time only when it matters ("call at 3") |
| `assignee_user_id` | whose job it is |
| `note` (optional, short) | the context the next person needs |
| `state` — `open \| completed \| cancelled \| superseded` | lifecycle |
| `created_by`, `created_at`, `created_from_contact` | provenance |
| `resolved_by`, `resolved_at`, `resolved_by_contact`, `superseded_by` | how it ended, and by whom |

**Why exactly one open slot:** the question is "what is *the* next action". Several open actions make
the partner's queue ambiguous and let stale ones rot as overdue. Scheduling a new one **supersedes**
the open one in the same transaction, so history is kept and nothing is overwritten. This also keeps
2A clear of `/tasks`' rule: a follow-up is a prospect's single next step, not a task entity.

---

## 5 · Ownership model

| Question | Canonical answer |
|---|---|
| Whose prospect is it? | `prospects.assigned_to`. **NULL means unassigned** — never defaulted to the owner, because absence stays absence |
| Who does the next action? | `prospect_followups.assignee_user_id`, defaulting to `assigned_to`, else the actor |
| Who created or completed it? | `created_by`, `resolved_by` — always the **membership-resolved principal**, never a request field |
| Reassignment | an update to `assigned_to` (and optionally the open follow-up's assignee), evented with from/to |

Every actor comes from `resolvePrincipal` → `withProspectDb` → `asPrincipal`, as in D1. No request body
can name an actor. The 2A tables carry a `WITH CHECK (… = current_user_id())` policy for sales, the
same construction `008` uses for note authorship.

---

## 6 · Owner workflow

From `/sales`, each row gains: **last contact** (relative, e.g. "3d ago"), **latest outcome**,
**next follow-up** with its due state (overdue / today / upcoming), and **owner**. Sorting by overdue
first is a *view*, not a new score.

From the prospect page, the header gains a **Call** button (a `tel:` link — today the phone is plain
text), **Record contact**, **Next action**, and **Stage**. The body gains **one timeline** (§8). The
owner can reassign, and edit or cancel any follow-up.

## 7 · Mobile sales-partner workflow — seconds, not a form

```
open prospect → tap Call (tel:) → return to the page
  → sheet opens: "How did it go?"   [outcome chips, one tap]
  → optional note                    [single line, may be empty]
  → next action: SUGGESTED from the outcome, editable
       no_answer / voicemail   → call · +2 business days
       callback_requested      → call · the date they gave (asked)
       meeting_set             → meeting · the agreed date
       spoke                   → call · +7 days
       not_interested          → no follow-up; suggest stage closed-lost (confirm)
       wrong_number            → no follow-up; flag contact data
  → stage: SUGGESTED only on the first contact of a lead (confirm)
  → Save  (one request, one transaction)
```

**What is safe to default:** channel (Call when started from the Call button), `occurred_at` (server
time, so no clock is trusted from the phone), assignee (self), and the follow-up action and date (from
the outcome table above, always shown and editable).

**What is never defaulted:** the outcome — one tap, but it must be chosen — and any stage change, which
is always an explicit confirm.

The **Save** is one request carrying a client-generated command id (§11), so a double-tap or a retry on
a bad mobile connection cannot record the attempt twice.

---

## 8 · Notes and history integration

**The canonical record for "what happened on this attempt" is the `prospect_contacts` row**, including
its optional note. That prose is **not** copied into `prospect_notes`, and **not** into the event
payload.

| Store | Holds | 2A behaviour |
|---|---|---|
| `prospects.notes` (legacy, 6 bodies) | the imported vault document | **untouched**, read-only history |
| `prospect_notes` | free-form notes not tied to an attempt | **unchanged**; still the place for "general notes" |
| `prospect_contacts.note` | what was said on **this** attempt | written **once**, with the attempt |
| events | the facts: who, what, when, with ids | **no prose** — they reference `contact_id` / `followup_id` |

**Read model:** the prospect page renders **one timeline**, a merge of contacts, follow-up lifecycle,
stage changes and `prospect_notes`, ordered by time. It's a **projection at read time**, not a fourth
store. Nothing is overwritten: contacts are immutable, follow-ups change state and are never deleted,
and prior attempts stay visible.

**Archival:** history survives. The new tables reference `prospects(id)` with **`ON DELETE RESTRICT`**,
not CASCADE, so no prospect deletion can take contact history with it. That is D1's lesson applied from
the start (§18 asks you to confirm it).

---

## 9 · Due-state semantics

**One business timezone, one clock, one place.** Today there is **no timezone convention**: several
places use `toISOString().slice(0,10)`, which is the **UTC** date and rolls over at **5 pm Pacific**. 2A
must not inherit that.

- **Business timezone:** an explicit constant, **`America/Los_Angeles`** (owner decision).
- **"Today"** is computed **in the database**: `(now() AT TIME ZONE 'America/Los_Angeles')::date`.
  That's one clock for every reader, and never the browser's.
- **Derived at read time, never stored:**

| State | Rule |
|---|---|
| **overdue** | `state = open` and `due_on < today` |
| **due today** | `state = open` and `due_on = today` (`due_at`, if set, only orders within the day) |
| **upcoming** | `state = open` and `due_on > today` |
| **completed** | `state = completed` — resolved by a contact or explicitly |
| **cancelled** | `state = cancelled` — deliberately dropped, with actor |
| **superseded** | `state = superseded` — replaced by a newer follow-up, which `superseded_by` names |

- **Multiple open actions: not allowed** (§4). A new follow-up supersedes the open one atomically.
- **Queue hygiene without touching D1:** follow-ups on **archived** or **closed** prospects are excluded
  from queues by the query (joined to `archived_at IS NULL` and an open stage). D1's archival path is not
  modified.

---

## 10 · Authorization matrix

**No new capability.** STAGE2F §8 already defines `prospects:write` as *"notes, contacts, status,
follow-ups"*, and both roles hold it. 2G.4.7 made the partner "owner minus admin". The **database** already
grants sales `UPDATE` on `status`, `assigned_to`, `first_contact`, `last_contact` and `updated_at`, and
its RLS already refuses held and archived rows.

| Action | Owner | Sales | Enforced by |
|---|---|---|---|
| Record a contact | ✅ | ✅ as **self** only | `prospects:write` + RLS `author = current_user_id()` |
| Set stage `lead/contacted/proposal` | ✅ | ✅ | `prospects:write`; existing column grant; CAS |
| Set `closed-lost` | ✅ | ✅ *(§18)* | same |
| Reopen from `closed-lost` | ✅ | *(§18)* | same |
| Mark `closed-won` | **only via Promote** | **only via Promote** | 2A refuses it; `promote` (both hold it) |
| Create a follow-up for self | ✅ | ✅ | `prospects:write` + RLS `created_by = self` |
| Assign a follow-up to another member | ✅ | *(§18)* | as above |
| Reassign a prospect's owner | ✅ | *(§18)* | existing grant on `assigned_to` |
| Complete / cancel **own** follow-up | ✅ | ✅ | CAS on `state = open` |
| Complete / cancel **another's** follow-up | ✅ | *(§18)* | as above |
| View history | ✅ | ✅ | `prospects:read` |
| Anything on a **held** or **archived** prospect | refused *(§18 for held)* | refused | resolver + existing RLS |
| Automation | ✗ | ✗ | `ascend_automation` gets **no grant** on either table |

Recommendation for the open cells: **allow sales, attributed.** This follows the 2G.4.7 model — one trusted
partner — and needs no new capability. Every reassignment and cross-member action is evented with its
actor. The alternative, owner-only, would need a **new capability**, because `admin:*` is the only
owner-exclusive one and doesn't fit. That is the "casual expansion" of the capability model in the other
direction, so it's flagged rather than assumed.

---

## 11 · Concurrency and idempotency

**UI disabling is never the control.** It's a courtesy.

| Hazard | Mechanism |
|---|---|
| **Double-tap Save / retry after a network failure** | The client generates a **command id** (UUIDv7) when the sheet opens and reuses it on every retry. It **is** the primary key of the contact row and of the follow-up it creates. `INSERT … ON CONFLICT DO NOTHING`, then read back → `already_recorded` with the original result. **No duplicates, by construction** |
| **Owner and partner at nearly the same time / two tabs** | Every "save" runs in **one transaction under D1's prospect-scoped advisory lock** (`lockProspect`, transaction-scoped, pooler-safe). The lock serializes *replace the open follow-up*; the partial unique index `one open follow-up per prospect` backs it structurally |
| **Stage race** | CAS: `UPDATE … SET status = $new WHERE id = $1 AND status IS NOT DISTINCT FROM $expected AND archived_at IS NULL`. Zero rows → read back → `stage_conflict` with the current stage, so the user re-decides. Nothing is silently overwritten |
| **Reassigned while being completed** | Completion is a CAS on `followup_id AND state = 'open'`; reassignment is a CAS on the same row. Whoever commits first wins; the other gets a truthful `already_resolved` / `superseded` |
| **Out-of-order or backdated records** | `last_contact = GREATEST(coalesce(last_contact, d), d)`, so the projection never moves backward |
| **Archived or held target** | Resolved through D1's `resolveProspectForMutation`; the archived check is repeated under the lock |

**The existing notes path is not idempotent.** `POST …/notes` accepts only `{body}` and the server mints
`note_id`, so a retry after a lost response **duplicates the note**. It relies on the button's `busy` state
alone. Carried as a finding (§18). 2A's own writes are built correctly; whether to retrofit notes is a
separate, small decision.

---

## 12 · Event model — facts, not writes

| Event | Status | Data (ids and enums, **no prose**) |
|---|---|---|
| `prospect.contacted` | **already declared, zero emitters — reused**, not reinvented | `contact_id`, `channel`, `outcome`, `occurred_at` |
| `prospect.status_changed` | **already declared** (vault reconciler, `actor: system`) — now also written by the Postgres path as `actor: operator` | `from`, `to` |
| `prospect.followup_scheduled` | new | `followup_id`, `action`, `due_on`, `assignee`, `supersedes` (the replaced id, if any) |
| `prospect.followup_resolved` | new | `followup_id`, `resolution: completed \| cancelled`, `by_contact` (if completed by an attempt) |
| `prospect.reassigned` | new | `from`, `to` |

**Not events:** "superseded" is carried by `followup_scheduled.supersedes`, not a separate event. Editing
a follow-up's note or time is a state edit, not a business fact; if audit is wanted, it's
`followup_scheduled` again.

**Every event** has subject = the prospect **anchor** (surrogate id only for held rows, following
`createProspect`), `actor: operator` + `actor_user_id` (the resolved principal), `occurred_at` = when it
happened, and `correlation_id` = **the command id**, so all events from one Save share it and a retry is
recognisable. Events are appended in the **same transaction** as the rows. They automatically count
toward §19 operator activity, which counts every operator event except `observation.captured`.

---

## 13 · Is migration 010 required?

**Yes.**

| Approach | Verdict |
|---|---|
| **A · extend `prospects`** (`next_action_*`, `last_outcome` columns) | ✗ — overwrites history (only the latest attempt survives), can't hold a follow-up lifecycle, and widens the most-read table |
| **B · one `prospect_actions` table** (contacts and follow-ups as row kinds) | ✗ — mixes an immutable fact with a stateful slot. "One open follow-up" and "contacts are append-only" can't both be constraints on one table without partial-constraint gymnastics |
| **C · `prospect_contacts` (immutable) + `prospect_followups` (stateful, one open)** | ✅ **recommended** — each concept gets the constraints it needs. The active-queue query is a partial index. It's additive, archive-safe (RESTRICT) and import-neutral |
| **E · events only** (fold the event log, as `core/notifications` does) | ✗ for 2A — "one open follow-up" can't be enforced in an append-only log; the overdue queue across 3,108 prospects would fold the whole spine; and there's no unique idempotency key. Events stay the **audit trail**, not the store |

## 14 · Proposed schema shape — **not authored; for review only**

```sql
-- 010 (shape only)
CREATE TABLE prospect_contacts (
  contact_id      uuid PRIMARY KEY,               -- = the client command id (idempotency)
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect        uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  author_user_id  uuid NOT NULL REFERENCES users(id),
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  channel         text NOT NULL CHECK (channel IN ('call','email','text','in_person','other')),
  outcome         text NOT NULL CHECK (outcome IN (/* §3, once frozen */)),
  note            text CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT not_from_the_future CHECK (occurred_at <= recorded_at + interval '5 minutes')
);
CREATE INDEX prospect_contacts_by_prospect ON prospect_contacts (prospect, occurred_at DESC);

CREATE TABLE prospect_followups (
  followup_id       uuid PRIMARY KEY,             -- = the client command id
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect          uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  action            text NOT NULL CHECK (action IN ('call','email','text','meeting','other')),
  due_on            date NOT NULL,
  due_at            timestamptz,
  assignee_user_id  uuid NOT NULL REFERENCES users(id),
  note              text,
  state             text NOT NULL DEFAULT 'open'
                      CHECK (state IN ('open','completed','cancelled','superseded')),
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_from_contact uuid REFERENCES prospect_contacts(contact_id),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  resolved_by_contact uuid REFERENCES prospect_contacts(contact_id),
  superseded_by     uuid REFERENCES prospect_followups(followup_id),
  CONSTRAINT resolution_has_provenance CHECK ((state = 'open') = (resolved_at IS NULL)
                                          AND (state = 'open') = (resolved_by IS NULL)),
  CONSTRAINT superseded_names_successor CHECK ((state = 'superseded') = (superseded_by IS NOT NULL))
);
CREATE UNIQUE INDEX prospect_followups_one_open ON prospect_followups (prospect) WHERE state = 'open';
CREATE INDEX prospect_followups_queue ON prospect_followups (organization_id, assignee_user_id, due_on)
  WHERE state = 'open';
-- RLS enabled + forced on both. Read: organization. Sales: INSERT as self; UPDATE only the lifecycle
-- columns of follow-ups; NO UPDATE and NO DELETE on contacts for anyone (§18). Automation: nothing.
```

**No existing object changes.** `prospects` keeps its columns, CHECKs, policies and grants. 010 is purely
additive.

---

## 15 · Rollout compatibility

**The order D1 had to learn is designed in from the start:**

```
old app + schema 009                (today)
→ 010 applied (additive: new tables only)      old app ignores them — SAFE
→ verify matrix (frozen before, as in D1b.2)
→ new backup + R1b + two-leg R1c re-proof
→ deploy the 2A app                  new app requires 010 — only ever against it
```

**A finding that must be fixed before 010 exists.** The recovery manifest lists its F3 (row count) and
F4 (content digest) tables **explicitly**, and `MANIFEST_TABLES` is **derived from that same list**. A
table added by 010 would appear in F1's catalog listing but have **its rows neither counted nor
verified**. It would also silently drop out of the fixture's "every table has rows" check and out of
R1c's write-refusal loop. **Recovery would go green while the new tables went completely unverified.**
Nothing compares F1's catalog tables with F3's. This is repaired as **RT-2** (§16), and 010's slice
extends `manifest.sql` for its two tables.

> ### ⚠️ CORRECTION (2026-09-21, found while implementing 2A.0) — the gap was narrower than stated
>
> "Nothing compares F1's catalog tables with F3's" was **wrong**. `tests/db/restore-fidelity.test.ts`
> already compared a live `pg_class` query of the migrated fixture against the F3 list. So a table added
> by a migration without extending `manifest.sql` **would** have been caught at development time.
>
> **The real gaps, all closed by RT-2:**
> 1. **F4 was never checked** — a table could be counted but never content-verified.
> 2. The comparison ran **only on the fixture**, never on an actual restored artifact (R1b/R1c).
> 3. It pinned `toHaveLength(8)`, which invites "just bump the number".
> 4. It covered `relkind = 'r'` only, with no stated exclusion policy.
>
> The recommendation stands; the severity was overstated.

---

## 16 · Recovery-test repair contract

### RT-1 — recovery proofs that assume every prospect is active

**Must land before the first real archival.** 2A itself archives nothing.

| # | Where | Today | Repair |
|---|---|---|---|
| **1** | `tests/db/restore-independence.test.ts:134–137` (**R1b**) | `listProspects(tx)` length == `count(*) FROM prospects` | assert **three** numbers: active reader == `count(*) … WHERE archived_at IS NULL`; `listProspects(tx, {includeArchived:true})` == total; active + archived == total |
| **2** | `tests/db/restore-same-version.test.ts:345–351` (**R1c AC4**) | `listProspects` length == `exp.prospects` (the total) | `exp` gains `prospectsActive` and `prospectsArchived` from the restored database; same three assertions, per leg |
| **3** | `tests/db/restore-same-version.test.ts:372–380` (**R1c notes**) | sums `listProspectNotes` over `listProspects(tx)` — **notes on archived prospects are silently skipped** | iterate `listProspects(tx, {includeArchived:true})`; still equal to `exp.notes`, which already joins every prospect |
| **4** | `tests/db/restore-fidelity.test.ts` (R1a fixture) | 3 prospects, none archived — **nothing exercises the gap** | add **one archived prospect carrying a note**; the fixed-3 assertion becomes active / total / archived |

**Proof of the repair:** mutation probes on the fixture leg. Revert #3 to walking the active reader → R1a
must go red on the archived prospect's note. Revert #1/#2 to comparing active with total → red. Against
the real post-009 artifact (0 archived), R1b and R1c must stay green with active = total.

**Boundary:** test files only — no runtime code, no migration, no production contact.

### RT-2 — recovery coverage totality (new, from this pre-flight)

A test asserting that **the set of tables in `F1.tables` equals the set in the F3 list**, and the F4
list, **both** in the fixture manifest and in every artifact's manifest. It passes today: 8 tables in
each. It **fails loudly** the moment 010 adds a table without extending `manifest.sql`. Test-only.

---

## 17 · Explicit scope exclusions

Not in 2A: the Sales Engine or any AI scoring or ranking change · new stages (unless decided, §18) ·
email/SMS sending or dialer integration (`tel:` links only) · calendar integration · notifications or
reminders pushed to devices · bulk actions · client-side (post-promotion) follow-ups · a generic task
model · retrofitting notes idempotency (unless decided) · vault-mode support (2A writes are refused in
vault mode, as D1a's `assertVaultProspectWritable` does) · archival changes (D1 frozen) · I1, R2, B2.

---

## 18 · Risks and unresolved decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Stage vocabulary: keep 5, or add `qualified` / `meeting` | **Keep 5** in 2A; meeting and callback are outcomes. If added later, change the forecast and pipeline models in the same slice |
| 2 | Freeze the outcome list (§3) | Review the candidate list; it's frozen into 010's CHECK |
| 3 | Sales: reassign owners, assign others' follow-ups, complete or cancel others' follow-ups | **Allow, attributed**, per 2G.4.7. Owner-only would need a **new capability** |
| 4 | Sales may set `closed-lost`; who may **reopen** from it | Sales may set it; reopening allowed for both, attributed |
| 5 | Business timezone | **`America/Los_Angeles`**, computed in the database |
| 6 | Contacts and follow-ups on **held** prospects | **Refuse** in 2A, as D1 does; revisit if held rows need working |
| 7 | Can a recorded contact be corrected or deleted | **No update, no delete** — correct by recording a new attempt. Owner DELETE as in `prospect_notes` is the alternative |
| 8 | `ON DELETE RESTRICT` on the prospect FK | **Yes** — history must block deletion, D1's lesson applied up front |
| 9 | Retrofit idempotency onto `POST …/notes` (duplicates on retry today) | A small separate fix, before or with 2A.2 — your call |
| 10 | One **read-only production aggregate** to size the design (§0) | Recommended: stage distribution; counts of non-null `assigned_to`, `first_contact`, `last_contact`; prospects with a phone; `SHOW timezone`. **Counts only.** Not run |
| 11 | `promote` sets `last_contact = current_date`, the **database's** date (likely UTC) | Leave D1 frozen; 2A's projection uses the business date. Record the inconsistency |
| 12 | RT-1 + RT-2 before 010 | **Yes** — as slice 2A.0 |

**Risks:** stage/outcome overlap drifting (mitigated by §3's rules and by keeping 5 stages); a queue
flooded by 3,102 never-contacted prospects (that's a view problem, not a data problem — "never contacted"
is a filter); timezone bugs (mitigated by one database clock); recovery blind spots (RT-2).

---

## 19 · Recommended implementation slices

| Slice | Contents | Production contact |
|---|---|---|
| **2A.0 · Recovery-test repair** | RT-1 (4 sites + archived fixture) and RT-2 (coverage totality), with mutation probes | none |
| **2A.1 · Schema and domain** | migration 010 authored and applied **locally only**; `manifest.sql` extended for the two tables; the event types; repository commands (`recordContact`, `scheduleFollowUp`, `resolveFollowUp`, `changeStage`, `reassign`) under `lockProspect`, with command-id idempotency and CAS; PGlite tests plus **real-17.6 concurrency proofs** (double-save, two tabs, reassign-vs-complete, stage race) | none |
| **2A.2 · Routes and UI** | `tel:` Call; the record-contact sheet (mobile first); next action; stage control; the timeline; `/sales` and `/partner` columns (last contact, outcome, next follow-up + due state, owner). Route and page authorization tests | none |
| **2A.3 · Production** | the D1b.2 pattern: frozen runner, apply 010, 51-style verification matrix, new backup, R1b + two-leg R1c, then deployment with the D1 deployment pattern and a frozen smoke | yes — each step authorized |

2A.0 is independent and small, and it's the prerequisite for the first archival and for 2A.3's recovery
re-proof.

---

---

## 20 · Owner decisions — FROZEN (2026-09-21)

| # | Decision |
|---|---|
| Stages | Exactly `lead`, `contacted`, `proposal`, `closed-won`, `closed-lost`. `prospects.status` is the only stage field. `closed-won` only through Promote |
| Outcomes | `no_answer`, `voicemail`, `spoke`, `interested`, `not_interested`, `callback_requested`, `meeting_set`, `wrong_number`, `email_sent`, `other`. One attempt each; **never** changes stage by itself; the UI may suggest, a person confirms |
| Timezone | `America/Los_Angeles`; timestamps stored as `timestamptz`; overdue/today/upcoming derived, never persisted |
| Held | readable for audit; **not workable** — no contact, stage, follow-up or ownership change; never silently unheld |
| Contact history | immutable: no delete, no destructive edit; corrections later only by an explicit corrective record; restrictive FKs |
| Follow-ups | at most one OPEN per prospect; replacement supersedes transactionally; resolved ones stay queryable |
| Sales may | record contacts (+ note); set stage among `lead`/`contacted`/`proposal`; schedule follow-ups; complete/cancel their **own** follow-ups; assign an **unassigned** prospect to **themselves**; set `closed-lost` **with a structured reason** |
| Sales may not | set `closed-won`; reopen a closed prospect; reassign to anyone else; change another's assignment; resolve another's active follow-up; work held prospects |
| Owner/admin | the broader lifecycle and reassignment |
| `closed-lost` | requires structured provenance; the transition and actor preserved permanently; reopening is owner/admin only |
| Assignment | `prospects.assigned_to` is the current sales owner; NULL = unassigned; never defaulted, never inferred from who last called; changed only by explicit, attributed operations |
| Model | `prospect_contacts` (immutable) + `prospect_followups` (one open); stage on `prospects.status`; no generic activity table; events are not the only store |
| Events | reuse `prospect.contacted`, `prospect.status_changed`; add `followup_scheduled`, `followup_resolved`, `reassigned`; ids/enums/provenance, no prose; the command id correlates row and events |

**The pre-flight is closed.** 2A.0 is recorded in `docs/SLICE-2A0-CHECKPOINT.md`.
