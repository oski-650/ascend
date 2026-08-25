# Historical Backfill — H1: Fact Inventory

**Status: inventory. No code, no vault writes, no importer.** This records what Ascend OS can and cannot establish about its own past, with every field classified by provenance. H0 (the project universe) is closed above it; the importer is not designed.

The purpose is to answer a question that must precede the frozen `PhaseStatus` decision:

> **What historical facts do we actually need a vocabulary for?**

Designing an enum around hypothetical history is how the last attempt got quarantined.

---

## 1. The classification vocabulary

H0 proposed three classes. The inventory forced a fourth.

| class | means | trustworthy? |
|---|---|---|
| `confirmed` | Oscar stated it directly | yes |
| `derived` | reconstructed from machine evidence, source named | yes, within the limits of what the evidence proves |
| `seeded` | **present in the vault, authored by a development script, never observed** | **no — and it looks exactly like data** |
| `unknown` | no evidence exists | yes (an honest absence) |

`seeded` is the load-bearing addition. It is more dangerous than `unknown`, because `unknown` announces itself and `seeded` does not: it is specific, plausible, internally consistent, and already being read by the engines.

---

## 2. The decisive finding

[`scripts/scaffold-vault.mjs`](../../scripts/scaffold-vault.mjs) — 1,138 lines — authored the vault contents for **Decoraciones Pilar** and **Tapia Tile & Marble** as script literals. Not imported, not remembered. Written.

It authored:

```text
business_context.md · brand_identity.md · project_scope.md
production_state.md  (including every phase date)
invoices.jsonl       (seed-inv-*)
time_log.jsonl       (its own comment: "realistic historical entries summing to ~18h")
audits.jsonl         (seed-aud-*)
```

Line 4 of the script describes it as seeding "a `_template` client + a **real** Decoraciones Pilar client." Both halves are true and that is the trap: the *business* is real, the *record* is fiction. Pilar's neatly consecutive phase dates (2025-05-15 → 2025-07-01) were chosen by a developer to make the OS look populated.

### The boundary — and it holds

The script writes **only files** (`writeFile` / `mkdir` at lines 34 and 43). It never calls `emitEvent`. Grepped and confirmed.

> **The event spine is uncontaminated by seed data.**

This is the state/event separation doing precisely the job it was designed for. Every seeded fact is a *record*; no seeded fact ever became a *witnessed event*. The architecture was right, and it is the reason this inventory is recoverable at all.

### How much genuine operator data exists

Once seed and UI-test artifacts are removed, very little.

| store | entries | genuine |
|---|---|---|
| `time_log.jsonl` | 24 | **0** — 13 seeded; the 11 "real" Tapia entries have durations of **1–2 seconds** (timer start/stop clicks) |
| `production.events.jsonl` | 9 | **~1** — 6 are `item_index 3` toggled on/off/on/off/on/off in 90 seconds; 2 are the intake backfill |
| `crm.events.jsonl` | 1 | 0 — the Elite Vac intake write |
| `invoices.jsonl` | 8 | **1** — Tapia final payment, $1,249, 2026-06-20 (UUID id, plausible amount) |
| `audits.jsonl` | 12 | seeded (`seed-aud-*`) |

This restates a fact already recorded against §19 and does not alter that metric, whose threshold and definition travel unchanged. It is logged here because it establishes what the backfill is starting from: **an almost entirely empty real record**, not a populated one needing correction.

---

## 3. Per-client inventory

### 3.1 Decoraciones Pilar — `decoraciones-pilar`

| field | value | class |
|---|---|---|
| client, real business | yes | `confirmed` |
| domain | decorpilar.com | `confirmed` |
| package | growth | `confirmed` (H0) |
| contact name | Pilar Rodriguez | `seeded` |
| industry, location, languages | Event Planning / Central Valley / EN+ES | `seeded` |
| brand voice, palette, photography | full brand_identity.md | `seeded` |
| all 5 phase dates | 2025-05-15 → 2025-07-01 | `seeded` |
| contract value | $2,497 ($1,248 + $1,249) | `seeded` |
| care plan $199/mo, Mar–Jun 2026 | 4 invoices | `seeded` |
| time tracked (~18h) | 11 entries | `seeded` |
| repository | none on GitHub or disk | `unknown` — site exists, build history does not |
| launch date | 2025-07-01 | `seeded` |

**Net: one confirmed client with a fully fabricated history.** Nothing here except name, domain, and tier survives classification.

### 3.2 Tapia Tile & Marble — `tapia-tile-marble`

| field | value | class |
|---|---|---|
| client, real business | yes | `confirmed` |
| domain | tapiatilemarbleco.com | `confirmed` |
| package | growth | `confirmed` (H0) |
| contact name | Eligio Tapia | `seeded` |
| phases: onboarding + strategy complete, design in_progress | 2026-06-01 → | `seeded` |
| final payment $1,249 paid 2026-06-20 | UUID invoice | `derived` — the only non-seed invoice |
| deposit $1,248 | `seed-inv-tapia-01` | `seeded` |
| 11 time entries | 1–2 second durations | UI artifact, not evidence |
| repository | none | `unknown` |
| launch date | — | `unknown` |

**Tapia carries an active contradiction.** The vault says design `in_progress`, dev `not_started`, launch target 2026-08-15 — as of today (2026-08-25) that reads as a 10-day-overdue project mid-design. But the site is live (you listed it; a PSI audit ran against the real site on 2026-06-22 scoring Performance 64 / A11y 94 / SEO 100), and the final payment cleared 2026-06-20.

The seeded state is not merely unverified — it is **counterfactual**, and the engines are currently deriving health, velocity and stall flags from it.

### 3.3 Elite Vac Service — `elite-vac-service`

| field | value | class |
|---|---|---|
| client, real business | yes | `confirmed` |
| domain | **elitevacservice.co** | `confirmed` (H0) — vault says `.com`, needs correction in place |
| launch | 2022-03, month precision | `derived` — portfolio entry, self-annotated |
| onboarding/strategy/design/dev | `not_started` | **the vocabulary lie** — actually `unknown` |
| contract value, contacts, tier | blank | `unknown`, correctly |

Written by the quarantined intake run on 2026-08-17, and it is **the best-behaved record in the vault**. Its decisions log says so out loud:

> `entered via intake from repo data only; contract value, contacts and phase dates before launch are UNKNOWN, not zero`

The markdown tells the truth while the frontmatter cannot. That gap *is* the frozen `PhaseStatus` problem, sitting in the vault as a working example rather than a hypothetical.

Note also: a 2022 launch predates all other work by roughly three years.

### 3.4 Bedolla's Landscaping — **not in vault**

| field | value | class |
|---|---|---|
| client, paid | yes | `confirmed` (H0) |
| package | growth | `confirmed` (H0) |
| domain | bedollaslandscaping.com | `confirmed` |
| repository | `oski-650/bedollas-landscaping` (private) | `derived` |
| repo created | 2026-07-24T14:11:42Z | `derived` |
| dev window | 6 commits 2026-07-24, 1 commit 2026-08-10 | `derived` |
| artifacts built | About/FAQ/Gallery pages, schema + internal linking, branded confirmation email, Vercel Analytics, sharp 0.35.3 | `derived` — commit subjects |
| local working copy | `~/Desktop/Bedolla's Site` with `.vercel` linked to project `bedollas-landscaping` | `derived` |
| launch date | — | `unknown` (recoverable via Vercel) |
| contract value, contact, phases | — | `unknown` |

### 3.5 The Best House Cleaning Team — **not in vault**

| field | value | class |
|---|---|---|
| client, paid | yes | `confirmed` (H0) |
| package | starter | `confirmed` (H0) |
| domain | thebesthousecleaningteam.com | `confirmed` |
| repository | `oski-650/the-best-house-cleaning-team` (private) | `derived` |
| repo created | 2026-05-12T09:44:17Z | `derived` |
| dev window | 2026-05-12, 05-15 ×3, 05-16, 05-26 | `derived` |
| local working copy | none — GitHub only | `derived` |
| launch date | — | `unknown` (recoverable via Vercel) |
| contract value, contact, phases | — | `unknown` |

### 3.6 Bay Area Custom Shirts — **lead, not a client**

Currently sits in the vault as an *active, growth-tier client*, promoted from the hit list 2026-06-22 as `closed-won`. H0 classified it as a **lead**. It has no invoices, no production events, and its site is not an Ascend build.

This is not a backfill target. It is a **reconciliation target**: existing state asserts a client relationship that never existed. Removing it is a separate decision from importing history, and should not ride along inside the importer.

---

## 4. What the evidence can and cannot prove

Stated explicitly, because the importer will be tempted by all four.

| evidence | proves | does **not** prove |
|---|---|---|
| repo `createdAt` | a build began | the project began, or a client signed |
| last push | code stopped changing | the site launched |
| commit subjects | which artifacts were built | that they were delivered or approved |
| a live domain | a web artifact exists | who built it, when, or for how much |

Git honestly yields a **development window** and nothing else. Launch dates for Bedolla's and Cleaning Team are recoverable only from Vercel's first production deployment — the CLI token is currently expired (`vercel login` required). Until then both are `unknown`, and must not be back-filled from last-push.

---

## 5. What this changes about the PhaseStatus question

H1 was supposed to tell us what vocabulary the real history needs. It does, and the answer is not the one the intake work assumed.

The intake design treated historical uncertainty as the rare case — a few gaps in otherwise-known histories. The inventory shows the inverse:

> **For every client in the universe, the phase history is either `unknown` or `seeded`. Not one is genuinely known.**

- Pilar and Tapia *appear* to have complete phase histories. Both were written by a script.
- Elite Vac has an honest `unknown` history the vocabulary cannot express.
- Bedolla's and Cleaning Team have dev windows and nothing else.

So the vocabulary problem is not an edge case to be patched. **It is the entire dataset.** A `PhaseStatus` that cannot say "unknown" cannot represent a single real client's past.

That is a much stronger basis for the decision than the intake work had — and it argues the decision is now unavoidable rather than deferrable, because Pass 1 has almost nothing left to import once seeded fields are excluded.

---

## 6. Open items

1. **`vercel login`** — unlocks first-production-deploy for the two new projects, converting two `unknown` launch dates into `derived` ones. The only outstanding automated evidence channel.
2. **Gmail** — the richest remaining source (deposits, kickoff threads, contracts). Connector not authorized; would need authorizing in claude.ai connector settings.
3. **Seeded-data disposition** — what happens to Pilar's and Tapia's fabricated fields is a decision, not a cleanup. They currently feed health, velocity and forecast.
4. **Tapia's counterfactual state** — live and paid, recorded as mid-design.
5. **Elite Vac domain** — correct `.com` → `.co` in place; do not create a second identity.
6. **Bay Area Custom Shirts** — reconcile the false client relationship, separately from the importer.

Nothing above authorizes writing the importer.