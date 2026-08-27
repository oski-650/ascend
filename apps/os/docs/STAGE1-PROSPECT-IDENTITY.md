# Stage 1 — Prospect Identity Backfill

**Status: implemented, reviewed, NOT applied. No vault changes.** The planner, the gate and the verifier exist and are proven against fixtures; the live vault is untouched and the six prospects remain unanchored.

Prerequisite: Stage 0.5 (D-1 … D-4), which introduced `prospect_id` as the anchor and left every existing prospect without one.

> **What does writing `prospect_id` into an existing file assert?**

Exactly one thing: **this file represents this stable identity.** Nothing about when the prospect was created, whether it was contacted, whether it is a real customer, whether it has a website, or whether anybody assessed one.

---

## 1. Why an identity operation needs the migration discipline at all

The change is one line per file. That is the argument for the discipline, not against it.

A one-line change applied to every record at once is the easiest place in this system to smuggle a second change past review — it looks too small to be worth a manifest. The H-series was fought over exactly this class of edit: a field that seemed structural turned out to be an assertion, and nothing in the pipeline could tell the difference afterwards.

So the shape is the one H5 established:

```text
snapshot → plan → validate → [HUMAN REVIEW] → apply → verify
─────────────────────────────                 ─────────────────
read only, no write path                      requires { confirm: true }
```

---

## 2. Discovery is mechanical

The file set comes from `listMarkdownFiles(hitListDir())` — the same reader `listProspects` and `observeProspects` use. Not a list in this document, and not a list in the code.

H7 and H8 both began with a hand-maintained set that had drifted from the vault. `snapshot.ts` has no declared file list to drift.

Templates, `README.md` and dotfiles are excluded by that reader, so they are not prospects here for the same reason they are not prospects anywhere else.

---

## 3. The decision ladder

Per prospect, strongest claim first. Order is the safety argument:

| # | condition | decision | writes |
|---|---|---|---|
| 1 | already carries a `prospect_id` | `already-anchored` | nothing — **an existing identity is never replaced** |
| 2 | named in `DECLARED_HOLDS` | `held` | nothing |
| 3 | flagged by the duplicate detector | `held` | nothing |
| 4 | otherwise | `assign` | one frontmatter line |

**Rule 3 is the general form of rule 2.** `holds.ts` names the pair we already know about; rule 3 catches the pairs we do not, without anyone having to remember to add them. Rule 2 exists anyway so a future change to the detector's heuristics cannot silently release a declared hold — the same belt-and-braces `DECLARED_EXCLUSIONS` gives the migration classifier.

### 3.1 Why a duplicate is held rather than resolved

Assigning an identity is not neutral. Giving two files two different `prospect_id`s **asserts that they are two businesses.**

When they are in fact one business recorded twice, that assertion is false in a way that compounds: every research finding, source row and event later keyed to the losing id has to be re-pointed at a merge whose direction nobody has decided.

> **Where the evidence says two records may be one business, assign neither.**

Not "pick one", not "assign both and reconcile later". An unanchored prospect is a known, reported, blocking state. A wrongly-anchored pair is a silent false claim — and Stage 2's gate is precisely that nothing remains unanchored, so the block is visible rather than forgotten.

---

## 4. Event semantics — nothing is emitted

Stage 1 asked for no event if the architecture permits it. It permits it exactly.

`createProspect` emits `prospect.created` **only when no file existed at that slug**. Every file the backfill touches already exists, so the emission branch is never reached. The backfill is event-silent *by construction*, not by a flag:

```text
existed === true  →  write  →  (no emit branch)
```

`actor: "system"` is passed anyway, defensively. If a future edit made that branch reachable — a file deleted between plan and apply — the escaping event would be system-attributed rather than silently counting toward §19's operator-adoption measurement.

### 4.1 On whether an event assertion here is meaningful

Checked before relying on it, per the H-series posture on test sessions and observation windows.

`migration/evidence.ts` records two windows in which vault records are known to be UI-test artifacts (`TEST_SESSIONS`, 2026-06-20 and 2026-07-17/18). Those windows classify **records already in the vault**; they say nothing about whether a *new* append is genuine. And §19's measurement window is a rolling 90 days over `actor: "operator"` events.

So the assertion that matters is not "no event in a suspicious window" but the stronger, window-independent one:

> **The spine is byte-for-byte identical before and after.**

That is what `verify` check 5 asserts, and it is not weakened by any timestamp classification. Check 6 additionally counts operator business events, because that is the specific number a mistake here would corrupt irreversibly.

**Live baseline, measured 2026-08-27:** 41 events total, 10 operator business events. Both must be unchanged after application. The 10 matches §18's independently-recorded figure.

---

## 5. What proves nothing else changed

Not a diff review. A fingerprint.

The snapshot records, per file, the hash of its content **with every `prospect_id` line removed** (`identitylessSha256`). After application, recomputing it must yield the same value:

```text
sha256(strip_identity(before))  ==  sha256(strip_identity(after))
```

This is also what makes the operation **reversible in a checkable sense**: the applied change is "insert one line", its inverse is "delete that line", and the recorded hash is what proves the inverse lands on the original bytes.

`verify` runs nine checks:

| # | check |
|---|---|
| 1 | every assigned prospect carries the **reviewed** id (not a re-minted one) |
| 2 | **no content changed apart from the identity line** — the decisive one |
| 3 | held prospects are byte-identical and still unanchored |
| 4 | no file was renamed, created or deleted |
| 5 | the event spine is untouched |
| 6 | operator business events unchanged (§19) |
| 7 | no duplicate `prospect_id` anywhere in the vault |
| 8 | the reconciler reports zero business transitions |
| 9 | re-planning proposes no further assignments |

Check 9 is idempotence. Held entries legitimately remain and remain held — that is the blocking state, not an incomplete run.

---

## 6. Determinism, and the one place it is bounded

The **decisions** are fully deterministic: same snapshot in, same slugs assigned, same slugs held, same reasons, same order (sorted by slug, never by filesystem enumeration order).

The minted ids are not, and cannot be — a UUIDv7 encodes the millisecond it was minted. So:

- the id factory is **injectable**, the same discipline the engines apply to the clock;
- tests pin it and compare rendered manifests byte-for-byte;
- **the manifest is the frozen artifact** — `apply` writes the ids the reviewed manifest carries and never re-mints.

`apply` additionally re-hashes every target against the snapshot and **refuses on drift**. A file that changed after the review is skipped, because the human reviewed a file that no longer exists in that form.

---

## 7. What is deliberately NOT done

| | why |
|---|---|
| No file renamed | The `-amp-` filenames are a separate vault decision, and a rename would break the slug addressing events and relationships still depend on. |
| No record merged or deleted | §3.1. |
| No relationship repointed | `promoted_to` is addressed by `structural_meta.promoted_from_prospect`, a **slug**. It stays a slug until the Stage 2 gate. |
| No event backdated or emitted | §4. |
| No business field read for anything but display in the manifest | The manifest shows name/website/phone/email so a human can review. None of it is written. |
| No `bay-area-custom-shirts-inc` correction | It is a declared migration exclusion for asserting that a lead became a client. That is a *history* defect; anchoring is an *identity* operation and does not touch it. See §9. |

---

## 8. The live plan (dry run, 2026-08-27)

```text
prospects discovered   6
would be anchored      4
held for review        2
already anchored       0
business events        none

ASSIGN   bay-area-custom-shirts-inc      sha256(identityless) 34138920863eaf57…
ASSIGN   central-coast-cleaning          sha256(identityless) 8153bac163f23082…
ASSIGN   modesto-hvac-co                 sha256(identityless) 6d7b4254007f96d7…
ASSIGN   valley-roofing-pros             sha256(identityless) d493aa2c6395fbda…
HELD     tapia-tile-amp-marble-co
HELD     tile-amp-marble-installation-in-bay-area

DUPLICATE CANDIDATES  1 — matched on website: tapiatilemarbleco.com
```

The two held records share a website **and** a phone number (`+16503648038`) **and** an email (`tapiatileandmarble@gmail.com`) — three independent corroborating signals, reported under the strongest.

---

## 9. Two findings from the live inventory

**9.1 — `tapia-tile-marble` (the client) has no `promoted_from_prospect`.** So neither Tapia prospect record is structurally linked to the client of the same business. The duplicate is therefore three-way, not two-way, and part of what a human must decide is whether the surviving prospect record should be linked to the existing client at all.

**9.2 — `bay-area-custom-shirts-inc` (the client) *does* carry `promoted_from_prospect: "bay-area-custom-shirts-inc"`.** That is the only `promoted_to` edge in the live structural graph, and it is addressed by slug. It is the concrete thing gate H protects, and it is why the backfill may not touch slugs.

---

## 10. What Stage 2 is gated on

```text
index.unanchored === []
```

After application, four prospects are anchored and **two remain unanchored by design**. Sheets intake stays blocked until a human resolves the Tapia duplicate, because a re-import has nothing stable to match those two records against — which is the entire purpose of the anchor.

Resolving it requires a decision this stage deliberately does not make:

1. which record survives;
2. whether it merges into the existing `tapia-tile-marble` client;
3. what happens to the record that does not survive — and the domain still has no vocabulary for "entered in error" (H5 §6.6, the same gap that excluded Bay Area Custom Shirts from the migration).

Item 3 may need that vocabulary before item 1 can be executed.

---

## 11. Status

```text
identity anchor        SHIPPED (Stage 0.5)
backfill machinery     IMPLEMENTED (this stage) — plan, validate, apply, verify
live vault             UNTOUCHED
prospects anchored     0 of 6
held for human review  2
Stage 2 (intake)       BLOCKED on the Tapia resolution
```

No code was applied to the vault. No event was emitted. No file was renamed.