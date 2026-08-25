# Commercial Provenance — what permits Ascend to assert money

**Status: decision document. No code changes, no vault changes.** Step 3 of the H8 §7 sequencing, deliberately isolated from [SOURCE-AUTHORITY.md](./SOURCE-AUTHORITY.md) (Step 2) so the two decisions do not contaminate each other.

> **What evidence qualifies as a contract-value fact?**

Not "which file owns revenue." A field with the right name is not evidence — that is the trap H8 exists to teach.

---

## 1. Four different facts the system currently collapses into one

```text
package / tier      what was selected from the catalog      evidence: agreement, proposal
contract value      what was actually agreed                evidence: signed contract
invoiced            what was billed                         evidence: invoices.jsonl
received            what actually arrived                   evidence: invoices.jsonl paid_at
```

A Growth package **lists** at $2,497. The contract may be discounted, staged, customised, or never signed. These are four separate questions and the OS answers all of them with one number.

---

## 2. Measured on the live vault (read-only)

### 2.1 Contracted revenue

```text
bay-area-custom-shirts-inc   $2,497        ← a lead that was never a client
decoraciones-pilar           $2,497
tapia-tile-marble            $2,497
elite-vac-service            null          ← the only honest answer, and only because no package is recorded
```

**`revenue_usd` is absent from every client in the vault.** So `getClientRevenue`'s override branch has never executed against real data, and **every contracted-revenue figure the OS has ever produced came from `TIER_PRICES[package]`**. The function has one live path, and it is the catalog lookup.

### 2.2 Independent financial evidence

```text
invoices     8 records, $5,790 total
  seeded     6 records, $4,342   (75% of the money is scaffold literals)
  non-seed   2 records, $1,448
               0c3c1b03  tapia-tile-marble   $1,249  paid 2026-06-20
               56eb0b57  decoraciones-pilar  $199    unpaid, "Care plan · Jun 2026"
```

The only *received* money the OS can evidence is **$1,249**.

`56eb0b57` needs classification rather than assumption: it is non-seed and UUID-keyed, but the surrounding care-plan invoices (Mar/Apr/May 2026) are all `seed-inv-*`, so it may be an operator record or a UI artifact. **A UUID is not evidence of genuineness** — H5 §1.1 established that on the documents.

### 2.3 Pipeline

```text
pipeline90d = $3,982.71     100% derived from ASSUMED_DEAL_VALUE
thisMonthReceived = $0      evidence-bearing (no invoice paid this month)
outstandingTotal = $199     evidence-bearing
overdue = 1 / $199          evidence-bearing
```

`lib/forecast.ts:15`:

```ts
/** Assumed deal value when no explicit revenue exists (matches Growth tier). */
const ASSUMED_DEAL_VALUE = 2497;
```

No prospect in the vault carries a quoted value, so every weighted-pipeline dollar the dashboard and `/finance` display is this constant multiplied by a score weight and a probability. **Seventh instance of the pattern**, and the most consequential in dollar terms: a hardcoded catalog price becomes a forecast.

---

## 3. The traceback test

> **Can this number be traced backward to an evidence-bearing fact without passing through a catalog, default, or fallback?**

| number | chain | verdict |
|---|---|---|
| $2,497 contracted | `TIER_PRICES[growth]` ← `package: growth` ← scaffold literal | **FAIL** — terminates in catalog + fiction |
| $3,982.71 pipeline | `ASSUMED_DEAL_VALUE` × score × probability | **FAIL** — terminates in a source constant |
| $1,249 received | invoice record, `paid_at` present, non-seed | **PASS** |
| $199 outstanding | invoice record, non-seed, unverified origin | **PASS structurally**, provenance unclassified |
| $0 received this month | no paid invoice dated this month | **PASS** — see §5 |

**Two of the five monetary outputs the OS displays cannot be traced to evidence at all.** They are the two largest.

---

## 4. Decisions

### 4.1 A catalog may never produce a contract value

> **`TIER_PRICES` is reference data. It answers "what does this package list at". It may never answer "what is this client worth".**

`core/finance/revenue.ts:25-26` is deleted, not adjusted. When no contract value is recorded, `getClientRevenue` returns `null`.

Recommended rename so the boundary cannot be re-crossed by accident: `TIER_PRICES` → keep, but any accessor that turns a tier into money is named for what it is (`listPriceForPackage`), and no finance path may call it.

### 4.2 `revenue_usd` is the only admissible contract value — *if* it survives classification

An explicitly recorded agreed amount is the one field that means "what was agreed" rather than "what the catalog says."

**But it is not authoritative by virtue of its name.** It is absent everywhere today; if it appears during migration for any client, it must be classified like any other field. A scaffold-authored `revenue_usd` is exactly as fictional as a scaffold-authored `package`, and its better name makes it more dangerous, not less.

Location deferred: Step 2 §4.5 kept it in `project_scope.md` precisely so this decision could place it.

### 4.3 Invoices and payments are independent evidence and stay so

`invoices.jsonl` is Ascend-authored and append-only, with its own event stream. It is the strongest commercial evidence the system has and requires no change here — beyond H6 removing the seeded 75%.

### 4.4 `ASSUMED_DEAL_VALUE` may not produce a forecast

A prospect with no quoted value has an **unknown** deal value, not a Growth-sized one. Three options, and this document does not choose between them — it only forbids the status quo:

| option | effect |
|---|---|
| prospects gain an explicit `deal_value`; unvalued prospects excluded | honest, needs a field and back-entry |
| pipeline reports **weighted count**, not currency | honest, loses a number Oscar may want |
| keep the assumption but label it at every surface as an assumption | weakest; a labelled fabrication is still in the total |

`lib/forecast.ts:29` already notes that changing this "would be a forecasting-semantics decision". It is now due.

---

## 5. Unknown is not zero — and the one place where absence *is* evidence

```text
unknown contract value  ≠  $0 contract value
no payment recorded     ≠  $0 received
```

The migration must never use numeric zero as an uncertainty sink, and `getClientRevenue` returning `null` rather than `0` is exactly this rule.

**But the rule has a boundary worth stating, or it becomes paralysis.**

> **For records Ascend authors exhaustively, absence IS evidence. For facts Ascend records only when it remembers, absence is ignorance.**

`invoices.jsonl` is the first kind: Ascend issues every invoice and appends every one, so "no invoice for this client" genuinely means *none was issued* — `$0 invoiced` is a fact, not a guess. `thisMonthReceived = $0` is therefore legitimate.

Contract value is the second kind: nothing guarantees it was ever written down, so its absence means *we do not know*, never *$0*.

This is the same distinction the reconciler already draws between an absent phase **entry** (unknown) and an absent phases **block** (untrustworthy, skip). The pattern generalises: **completeness of the record determines whether absence carries information.**

---

## 6. Consequences

Traced; none implemented.

| consumer | today | after |
|---|---|---|
| `core/finance/revenue.ts` | catalog fallback | `null` unless `revenue_usd` recorded |
| `computeEhr` | `$2,497 / hours` | **already null-safe** (`lib/ehr.ts:13`) — returns null |
| `low_ehr` rule | fires on catalog-derived EHR | **stops firing** — `ehr === null` already skips (`lib/opportunities.ts:172`) |
| `/tasks`, `/api/time/summary` | EHR figure | "—" |
| `compileOperatorBrief` | `EHR $X/hr` | must say *unknown*, not omit (H2 §11.3) |
| `core/finance/commands.ts:50` | revenue in a command | null path needs checking |
| dashboard + `/finance` `pipeline90d` | $3,982.71 | blocked on §4.4 |

**The degradation is graceful by accident, not design:** `computeEhr` already returns null for null revenue and `low_ehr` already skips null EHR. Making `getClientRevenue` honest removes an urgent-severity signal without touching the rule — the same shape as the H4 repair, and the same acceptance criterion applies: it must disappear because its premise disappeared.

---

## 7. Migration implications

1. **`package: growth` is a seeded field and demotes like any other** — but its demotion no longer changes revenue, because §4.1 severs that link first. Sever, then migrate; the reverse order leaves a window where removing `package` silently zeroes revenue instead of unknowing it.
2. **The 6 seeded invoices (75% of recorded money) are removed by H6 as planned.**
3. **`56eb0b57` needs classifying** before H6 treats it as genuine (§2.2).
4. **Bay Area Custom Shirts' $2,497 disappears as a side effect** of §4.1 — the entity remains excluded and still wrong, but it stops asserting revenue.

---

## 8. What this does not decide

1. **Which of §4.4's three options** the pipeline adopts.
2. **Where `revenue_usd` lives** — its authority is settled, its location is not.
3. **Whether `56eb0b57` is genuine** — an evidence question for the coverage matrix.
4. **Care-plan / recurring revenue** as a distinct commercial fact — `core/finance/care.ts` models it separately and was not examined here.

---

## 9. Status

```text
authority             DECIDED — SOURCE-AUTHORITY.md
commercial provenance DECIDED (this document), except §8
coverage matrix       now unblocked
H6 migration          WIP c1556a8, unapplied
live vault            untouched
```

No code changed. No vault touched.