# Structural Relationship Substrate — architectural investigation

**Status: IMPLEMENTED at `aba266e`.** `relationships/{contract,derive,index}.ts` exist; `graph-view/
projection.ts` and `mission-control/cognition.ts` both consume them. This is the prerequisite to N3
(Cognitive Propagation, landed at `ae0f293`), and it is **not** a cognition phase — it is
infrastructure that cognition happens to need, and that `graph-view` already needs today.

> **CORRECTED 2026-08-31.** This line read "investigation. Nothing implemented, nothing approved."
> `aba266e` implemented it and its own message records the approval.

The question: *where should the single canonical structural-relationship owner live, what is its contract, and how does `graph-view` migrate onto it without becoming more permanent than it already is?*

---

## 1. Three findings

**A. The projection conflates three provenance classes into one edge list.** 8 of its 106 edges are not structural truth at all — they are engine judgments. Feeding those to cognition would let a *detected opportunity* propagate activation exactly as a foreign key does. This is the same failure class the structural/learned split exists to prevent, one level down.

**B. Only 9 of the 12 canonical readers are needed.** Three (`detectOpportunities`, `assembleHealthOverview`, `readEvents`) produce interpretation or activity, not structure. The substrate is meaningfully smaller than the projection.

**C. `core/knowledge/` is ruled out by an existing rule, and `core/` by an existing layering fact.** Neither is a judgement call — see §4. The answer that satisfies every current fitness rule with **zero amendments** is a new top-level `relationships/` layer.

---

## 2. What the projection actually derives, measured

Live vault, via `projectGraph()`: **113 nodes, 106 edges.**

| edge kind | count | source of truth | class |
|---|---|---|---|
| `has_task` | 43 | `ProductionState.phases[].tasks` | foreign key |
| `has_phase` | 20 | `ProductionState.phases` | foreign key |
| `measured_by` | 12 | `Audit.client` | foreign key |
| `billed` | 8 | `Invoice.client` | foreign key |
| `owns_document` | 5 | `DocumentFrontmatter.client` | foreign key |
| `has_project` | 4 | `ProductionState.clientSlug` | foreign key |
| `awaits_approval` | 3 | `ApprovalRequest.client_slug` | foreign key |
| `supersedes` | 2 | `DocumentFrontmatter.supersedes` | foreign key |
| `promoted_to` | 1 | `structural_meta.promoted_from_prospect` | foreign key |
| `subscribes` | 0 | `listCareClients()` | foreign key (no instances yet) |
| **`flags`** | **8** | **`detectOpportunities()`** | **engine judgment** |
| `wikilink` | 0 | `buildKnowledgeIndex()` | authored prose (no knowledge notes exist) |

**98 edges are foreign keys. 8 are interpretations. 0 are authored links.**

Node side: 8 of 113 nodes are `opportunity`, which is **not a vault entity**. Opportunities are synthesised per request by `lib/opportunities` and `opportunity-engine`, with ids like `launched_no_retainer:${slug}`. Nothing on disk asserts one exists.

### The three provenance classes

```text
FOREIGN KEY      a field on disk names another entity        deterministic, re-derivable, stable
AUTHORED         the operator wrote [[a link]] in prose      on disk, but prose rather than schema
ENGINE JUDGMENT  a rule decided this is worth flagging       an interpretation, recomputed per request
```

The substrate must carry **only the first**, and should carry the second as a *separately labelled* kind if it carries it at all. It must never carry the third. An `opportunity` is the engine's opinion; propagating through it would let cognition treat an opinion as terrain.

This is the same distinction `Association.structurallyExplained` already draws one layer up — and the reason the projection can mix all three safely today is that it only *draws* them. Cognition would *traverse* them, which is a much stronger claim.

---

## 3. Readers: 9 needed, 3 not

**Needed** — every one is already a canonical public reader, so the substrate opens no files and F15's pinned set does not grow:

`listClients()` · `getClient(slug)` · `listProspects()` — `@/core/crm`
`listProductionStates()` — `@/core/production`
`listInvoices()` · `listCareClients()` — `@/core/finance`
`listDocuments({ includeSuperseded: true })` — `@/lib/documents`
`listApprovalRequests()` — `@/lib/portal`
`listAudits()` — `@/lib/audits`

**Not needed:**

| reader | why not |
|---|---|
| `detectOpportunities()` | Engine judgment. Produces the `flags` edges and `opportunity` nodes that must not enter the substrate. |
| `assembleHealthOverview()` | Health tiers are node *state* for rendering, not relationships. |
| `readEvents({ limit: 60 })` | Events become `activity`, never edges — a rule `GRAPH-CONTRACT.md` already fixes. |
| `buildKnowledgeIndex()` | Authored links, a different provenance class. Also blocked for consumers by F11 (§4). |

---

## 4. Where the owner must live

Five candidates. Four are eliminated by rules or facts that already exist, not by taste.

**`core/knowledge/` — ruled out by F11.** The rule bans `mission-control` from importing `@/core/knowledge`:

```ts
const offenders = importsUnder("mission-control").filter((e) =>
  /^@\/(packages\/(graph|indexer)|core\/knowledge)\b/.test(e.specifier)
);
```

`mission-control/cognition.ts` is precisely where structural context must be read in order to be injected. Putting the substrate there would require amending F11 — weakening a wall to move a dependency, which is the move we have refused at every previous phase.

**`core/relationships/` — ruled out by a layering fact.** The substrate needs `listDocuments`, `listApprovalRequests`, and `listAudits`, all of which live in `lib/`. Verified: **`core/` does not import `lib/` anywhere in the codebase today.** Introducing that inversion for this module would make `core` depend on the layer that re-exports it. No fitness rule forbids it, which is exactly why it would be corrosive — it would pass the tests and quietly invert the layering.

**`packages/` — ruled out by F16.** `packages/domain` may import nothing with I/O. The substrate is defined by reading nine canonical readers.

**`graph-view/` — ruled out by intent.** It is the disposable projection. Making it the source of structural truth for cognition inverts the property that makes it disposable, and is the whole reason this investigation exists.

**`cognition/` — ruled out by F22.4 and by design.** Cognition receives context injected; it never reaches for it.

### The answer: a new top-level `relationships/`

A sibling of `graph-view/`, `mission-control/`, and `navigation/`. Importable as `@/relationships` with no config change (`"@/*": ["./*"]`), exactly as every other top-level layer works.

```text
                     core/*        lib/*
                        │            │
                        └─────┬──────┘
                              ▼
                       relationships/          ← canonical structural truth
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
          graph-view/projection      mission-control/cognition
           (draws them)               (injects them)
                                             │
                                             ▼
                                        cognition/
                                     (traverses them)
```

Why it works with **zero fitness amendments**:

- Top-level layers already import both `core` and `lib` (`mission-control` does), so no inversion is created.
- It is not `core/knowledge`, `packages/graph`, or `packages/indexer`, so F11 is untouched for both `engines` and `mission-control`.
- F17 permits `graph-view` to import `core`/`lib`; importing a peer that only re-expresses them changes nothing about its disposability.
- Cognition still imports nothing (F22.4 unchanged).

---

## 5. Proposed contract

```ts
// relationships/contract.ts — types only.

import type { EventSubject } from "@/domain";

/**
 * Only kinds backed by a field that exists on disk. `flags` is deliberately absent: an opportunity
 * is an engine judgment, not terrain. `wikilink` is absent from THIS union and, if ever added,
 * belongs to a separate authored-link kind with its own provenance.
 */
export type StructuralRelationshipKind =
  | "has_project" | "has_phase" | "has_task"
  | "billed" | "subscribes" | "owns_document" | "supersedes"
  | "awaits_approval" | "measured_by" | "promoted_to";

/** Where the claim comes from — the field that asserts it, so a relationship can be audited. */
export type StructuralProvenance = {
  /** e.g. "core/production:ProductionState.clientSlug" */
  reader: string;
  /** e.g. "clientSlug" */
  field: string;
};

export type StructuralRelationship = {
  source: EventSubject;
  target: EventSubject;
  kind: StructuralRelationshipKind;
  provenance: StructuralProvenance;
};

export type StructuralContext = {
  subjects: readonly EventSubject[];
  relationships: readonly StructuralRelationship[];
  builtAt: string;
};
```

**Identity is `EventSubject`** — the same domain pair cognition already uses, and deliberately *not* the `${type}:${entityId}` string, which F19 makes `graph-view`'s sole property. The projection maps to its own id format on the way out, as it does today.

**No layout, no colour, no weight, no health, no status.** Those are projection concerns. This carries relationships and the subjects they connect, nothing else.

**Provenance is mandatory**, matching the rule cognition already enforces on associations: a relationship must be able to say which field asserted it.

---

## 6. How `graph-view` migrates without becoming permanent

The migration must make `graph-view` *less* load-bearing, not more.

1. `relationships/` derives the 10 foreign-key kinds from the 9 readers.
2. `graph-view/projection.ts` stops deriving them and consumes `StructuralContext`, mapping `EventSubject` → its own id format and attaching the visual concerns it owns (weight, health, status, meta).
3. `projection.ts` **keeps** what is genuinely its own: `opportunity` nodes and `flags` edges (engine judgments it may draw but must not export as structure), event `activity`, node `state`, and the KnowledgeIndex passthrough.
4. Its retirement notice **stays**. It gets shorter, not more permanent — roughly 100 lines of edge derivation move out, and what remains is presentation plus the interpretive extras.

The disposability test is unchanged and still meaningful: deleting `projection.ts` and replacing it with an indexer-backed source must still be possible without touching the UI, because `components/graph/*` still depends only on `./contract`.

Worth stating plainly: this migration makes `projection.ts` **easier** to retire, because the part of it that was quietly authoritative — structural derivation — is the part that moves to an owner designed to keep it.

---

## 7. Fitness implications

**No existing rule is weakened, and no exemption is added.** New rules to add when this is built, modelled on F17/F22:

| Rule | Enforces |
|---|---|
| F23.1 | `relationships/` performs no `fs`/`node:*` of its own — all I/O through canonical readers |
| F23.2 | no module-level mutable state; built per request, never cached |
| F23.3 | writes nothing, emits no events |
| F23.4 | value-imports no engine, and never imports `@/graph-view`, `@/cognition`, `@/app`, `@/components` |
| F23.5 | no business computation — no scoring, ranking, or status derivation |
| F23.6 | the graph id format never appears (F19 extended, as it was for cognition) |
| F23.7 | `flags`/`opportunity` appear nowhere — engine judgments cannot enter the substrate |
| F23.8 | `relationships/` is added to F12's roots, as `cognition` was |

The `statSync` trap applies as before: the directory must exist with a `.ts` file **before** its name appears in any root array.

---

## 8. What this does not decide

- **Whether `wikilink` belongs here at all.** Zero exist in the vault (no knowledge notes have been written), so the question is currently unfalsifiable. Deferred rather than guessed.
- **Whether relationships are directed for traversal purposes.** They are directed as stored; whether cognition may traverse `client → project` backwards is an N3 decision, not a substrate one.
- **Any propagation mechanism.** `MAX_PROPAGATION_HOPS` and `HOP_DECAY` stay reserved in `cognition/bounds.ts`, untouched, until N3 is formally opened.
- **Whether this is worth building at all if N3 never opens.** Honest framing: `graph-view` works today. The substrate's value is that it stops structural truth living inside a module marked for deletion — real, but it is a prerequisite, not a feature. If N3 is abandoned, this should be abandoned with it.
