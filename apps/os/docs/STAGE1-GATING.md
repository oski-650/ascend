# Stage 1 Gating — what actually has to be true before Stage 2

**Status: decision document. No code changes, no vault changes.** Written before the Stage 1 manifest is applied, so the gate is settled while it is still free to change.

Prerequisite: [STAGE1-PROSPECT-IDENTITY.md](./STAGE1-PROSPECT-IDENTITY.md), whose §10 states the gate under examination.

> **Does Stage 2 require zero unanchored prospects?**

No. And the reason is stronger than "the gate is too strict": **the gate does not exist.**

---

## 1. The finding that settles it

`index.unanchored` has **zero production consumers.** Traced mechanically across the whole app:

```text
core/vault/identity.ts:133,141,150,166   declared, populated, returned
tests/engines/prospect-hardening.test.ts:353   one assertion
docs/STAGE1-PROSPECT-IDENTITY.md:183           one sentence
```

That sentence is the entire gate. No route, engine, assembler, surface or one-shot reads the field. Nothing branches on it, nothing refuses on it, nothing is blocked by it today.

So the question is not "should we relax an existing constraint" but **"what constraint should we write, now, before anything depends on the wrong one."** Relaxing costs nothing; adopting the wrong invariant would cost the same as every other silent fallback this project has spent months removing.

---

## 2. The full consumer trace

Generated from the repository, not from memory.

### 2.1 `prospect_id`

| consumer | reads | purpose |
|---|---|---|
| `core/crm/prospect.ts:179-195` | disk + incoming + index | the resolution ladder and the uniqueness refusal |
| `core/crm/prospect.ts:41` | frontmatter | populates `Prospect.id` on read |
| `core/vault/identity.ts:103-166` | frontmatter | the seam itself |
| `identity-backfill/*` | manifest | the one-shot |

### 2.2 `Prospect.id` — the read-model field

**Zero consumers.** Nine modules call `listProspects()` / `getProspect()`:

```text
app/sales/page.tsx          app/sales/[prospect]/page.tsx    graph-view/projection.ts
lib/automations.ts          lib/opportunities.ts             lib/forecast.ts
lib/compileOperatorBrief.ts mission-control/pipeline.ts      mission-control/forecast.ts
core/crm/promote.ts
```

**Every one of them keys on `slug`.** Not one reads `.id`. The anchor is, today, write-only.

### 2.3 `buildProspectIdIndex`

Two production consumers, and **neither reads `unanchored`**:

| consumer | reads |
|---|---|
| `core/crm/prospect.ts:185` | `byId`, `violations` — uniqueness on write |
| `identity-backfill/verify.ts:117` | `violations` — check 7 |

### 2.4 `resolveProspectId`

**Zero production consumers.** Tests and one doc comment. It is API surface waiting for Stage 2.

### 2.5 Identity matching

`findDuplicateCandidates` + the three normalizers have **one** production consumer: `identity-backfill/plan.ts:99`.

### 2.6 Relationships

**No prospect_id involvement whatsoever.** The only prospect-sourced edge is `promoted_to`, derived in `relationships/derive.ts:79-90` from `structural_meta.promoted_from_prospect` — a **slug**. Live graph contains exactly one such edge (`bay-area-custom-shirts-inc`).

### 2.7 Import matching

**Does not exist.** The only import path, `app/api/import/prospects/route.ts:137-139`, matches like this:

```ts
const slug = slugify(name);
const exists = (await readTextFile(path.join(dir, `${slug}.md`))) !== null;
```

That is filename-as-identity — the D-4 defect, still live in the only import path in the system. Replacing it is Stage 2's actual job, and it is a much larger fact about intake readiness than how many prospects are anchored.

---

## 3. Can the system support anchored and held as distinct classes?

Yes, and cheaply, precisely because §2 shows nothing depends on the current shape.

But one correction to the proposed framing matters more than the rest.

### 3.1 Quarantine is a WRITE barrier, not a READ barrier

The proposal says held prospects are *"excluded from automated matching"*. Taken literally, that reintroduces the exact failure the hold exists to prevent:

```text
intake row: "Tapia Tile & Marble", tapiatilemarbleco.com
  held records excluded from matching
    → no match found
      → classified NEW
        → a THIRD Tapia record is created
```

**The quarantine would manufacture the duplicate it was built to stop.** Invisibility is not safety; it is the absence-into-fact error wearing a safety label — "we found no match" becoming "there is no match".

So the two must be split:

| | held prospects |
|---|---|
| **excluded from** | identity assignment · any automated write · research writes · scoring writes · outreach queue generation · relationship generation that requires stable identity · promotion |
| **INCLUDED in** | duplicate detection and corroboration — as a **blocking** signal |

A held record must be *visible enough to block* and *inert enough to be safe*. An intake row that corroborates a held record is itself held (`ambiguous`), reported, and written nowhere.

### 3.2 The corollary about outcomes

This means the intake row classification from the earlier design gains a fifth outcome, and it must be distinguishable from a miss:

```text
new         no match anywhere                        → create
matched     resolved to a single anchored prospect   → update
ambiguous   matches 2+ anchored prospects            → hold the row
blocked     corroborates a HELD prospect             → hold the row, name the blocker
conflict    contradicts a human judgment             → hold the row
```

`blocked` is not `new`. Collapsing them is the whole failure mode.

---

## 4. Should the index represent `anchored` / `held` / `unanchored`?

Yes — and the third bucket should end up **empty**, which is the point.

```text
anchored     has a unique prospect_id
held         no prospect_id, and a STATED reason it may not be assigned one
unanchored   no prospect_id, no reason        ← an unexplained residue
```

`unanchored` today means two incompatible things at once: "not processed yet" and "deliberately withheld". A consumer cannot branch correctly on a bucket that means both. Splitting them makes the residue visible, and an empty residue is a far better gate than a zero count of a conflated field.

This is the same doctrine `enums.ts:33` records for `PhaseStatus`: one `unknown` in the value vocabulary, and the "why" in metadata. Here the reason genuinely is load-bearing — one bucket says *process me*, the other says *block me* — so it earns a classification with a stated reason, not a second null.

### 4.1 Where a hold has to live, and why it must not be derived alone

`DECLARED_HOLDS` currently lives in `identity-backfill/holds.ts`, and **F30 forbids every runtime module from importing `identity-backfill`.** So Stage 2 cannot read it where it is.

Two candidate mechanisms, and the answer is both:

| | risk alone |
|---|---|
| **derived** (a prospect is held if it participates in a duplicate pair) | A silent fallback. Edit one Tapia record's `website` field and the pair stops matching — the hold **evaporates**, and the record silently becomes eligible. |
| **declared** (a named list) | Cannot cover duplicates nobody has noticed yet. |

So the Stage 1 ladder is already the right shape and simply needs to move: **`DECLARED_HOLDS` relocates to `core/vault/identity.ts`** (the seam runtime may read), with the detector as the generalisation on top. A declared hold can only be released by a human deleting it, which is the property that makes it a hold rather than a hint.

No new store, no new writer, no held-state written into the prospect files — which also preserves Stage 1's byte-identical guarantee for the two Tapia records.

---

## 5. The proposed gate

Replacing `index.unanchored === []`:

> **Stage 2 may proceed when, across the whole hit list:**
>
> **P1** — every prospect classified `anchored` carries a unique `prospect_id`
> **P2** — every prospect that is not `anchored` is classified `held`, **with a stated reason** — the `unanchored` residue is empty
> **P3** — no automated path can WRITE to a held prospect
> **P4** — every automated matcher READS held prospects, and treats a corroborating match as a **blocking** outcome, never as a miss

**P2 is the anti-fallback clause.** It does not require zero held records; it requires zero *unexplained* ones. "We haven't got to it yet" is not a state Stage 2 may run alongside, because it is indistinguishable from "we decided not to".

**P4 is the correction from §3.1**, and it is the clause most likely to be quietly dropped during implementation, because it reads like an optimisation and is actually the safety property.

After the Stage 1 manifest is applied, the live vault satisfies P1 and P2 exactly:

```text
anchored     4    bay-area-custom-shirts-inc · central-coast-cleaning
                  modesto-hvac-co · valley-roofing-pros
held         2    the Tapia pair, reason stated, declared and detected
unanchored   0    ← the residue is empty
```

P3 and P4 are properties of code that does not exist yet, so they are **obligations on Stage 2**, verified when it is built — not preconditions that can be checked today.

---

## 6. What would need to change

Nothing in this document is implemented. Recorded so the work is visible before it is authorised.

| # | change | risk |
|---|---|---|
| 1 | `DECLARED_HOLDS` moves `identity-backfill/holds.ts` → `core/vault/identity.ts` | none functional; F30's definition-site assertion updates with it |
| 2 | `ProspectIdIndex` gains `held` and narrows `unanchored` to the unexplained residue | no consumer reads `unanchored` (§2.3) |
| 3 | `identity-backfill/plan.ts` reads holds from core instead of owning them | the ladder is unchanged; only the import moves |
| 4 | `STAGE1-PROSPECT-IDENTITY.md` §10 restated to P1–P4 | documentation |
| 5 | Stage 2 intake honours P3/P4 | **the real work**, and where P4 will be under pressure |
| 6 | A fitness rule that no runtime module writes to a held prospect | needed only once a runtime writer exists |

**Not changed:** relationships, the event spine, the reconciler, slug addressing, the frozen Stage 1 manifest, and the two Tapia files.

---

## 7. Tests required

None to change the gate — it is a sentence with no consumers. The tests below become necessary **when §6 items 1–3 are implemented**, and each proves a specific way P1–P4 could be violated:

1. the index classifies the Tapia pair as `held`, not `unanchored`, and reports the reason
2. after the Stage 1 apply, `unanchored` is empty while `held` has two members
3. a held prospect that is edited so the detector no longer matches is **still held** by the declared list — the anti-evaporation control
4. an intake row corroborating a held prospect is classified `blocked`, **not** `new` — the §3.1 control, and the one that would have created a third Tapia
5. no automated writer accepts a held slug

Control 3 and control 4 are the two that must fail against a naive implementation; the others are structural.

---

## 8. Can Stage 1 be applied now?

**Yes — to the four ASSIGN records, with the two HELD records untouched.**

The trace is what licenses this. Anchoring four prospects changes no behaviour anywhere, because `Prospect.id` has no consumers (§2.2), `unanchored` has no consumers (§2.3), `resolveProspectId` has no consumers (§2.4), and relationships never touch `prospect_id` (§2.6). The write is additive, byte-verified, event-silent, and reversible.

Applying it does not depend on this document being adopted — the gate governs **Stage 2**, not the Stage 1 apply. And leaving four prospects unanchored to keep a number at zero would be optimising a metric against the thing it measures, which is the precise pressure §3.1 of the Stage 1 document warns about.

---

## 9. Status

```text
gate as written        DOES NOT EXIST — one sentence, zero consumers
proposed gate          P1–P4 (§5), not yet adopted
holds                  declared + detected; must move to core for Stage 2 to read
Stage 1 apply          UNBLOCKED, awaiting the operator
Tapia resolution       untouched, and deliberately not required by the new gate
live vault             UNTOUCHED
```

No code changed. No vault touched. No merge decided.