# Neural Core — Graph Contract & Projection Spec

**Status:** Implemented — Neural Core vertical slice shipped. Counts below are MEASURED, not predicted.
**Increment goal:** prove what the Neural Core should *feel* like — not to build the permanent graph data layer.
**Hard constraint:** frozen Phase 4 contracts (`packages/indexer`, `core/knowledge`, `packages/graph`) are **not modified**.

---

## 1. The graph contract

Two distinct types, deliberately separated. **The renderer imports only these.** It has no knowledge of
CRM, vault, slugs, invoices, or Next.js.

```ts
// graph-view/contract.ts — the ONLY module the renderer imports.
// Pure types. No fs, no React, no rendering concerns, no CSS, no coordinates.

/** What kind of business object a node stands for. Presentation maps this to color; the model does not. */
export type GraphNodeType =
  | "client" | "project" | "phase" | "task" | "prospect"
  | "invoice" | "document" | "approval" | "audit" | "care_plan"
  | "opportunity" | "sop";

/** What kind of real relationship an edge stands for. Every value is a foreign key that exists on disk. */
export type GraphEdgeType =
  | "has_project" | "has_phase" | "has_task"
  | "billed" | "owns_document" | "supersedes"
  | "awaits_approval" | "measured_by" | "subscribes"
  | "promoted_to" | "flags" | "wikilink";

/**
 * Node state — a PRESENTATION-NEUTRAL summary of a condition its owner already computed.
 * The projection never derives these; it copies them from the owning read-model.
 * `null` means "this dimension does not apply to this node type" — never "zero".
 */
export type GraphNodeState = {
  /** Health band, copied from HealthScore.tier. Owner: engines/health-engine. */
  health: "healthy" | "on_track" | "at_risk" | null;
  /** Lifecycle word already owned by a domain deriver (deriveInvoiceStatus, DocumentStatus, …). */
  status: string | null;
  /** True when an owner has flagged this object as needing attention (overdue, at_risk, blocked). */
  attention: boolean;
};

export type GraphNode = {
  id: string;                          // `${type}:${entityId}` — globally unique, stable across rebuilds
  type: GraphNodeType;
  label: string;                       // human-readable; never a slug when a name exists
  /** The entity id in ITS OWN namespace (slug or record id) — what routing and events resolve against. */
  entityId: string;
  /** The domain EntityKind this node projects, so event subjects can resolve to it. */
  entity: EntityKind;
  /**
   * Relative importance, 0–1. NOT a business metric and NOT a ranking: it is a rendering hint for node
   * radius only, derived from structural position (a client outranks one of its checklist tasks).
   * Deliberately NOT sourced from Decision.priorityScore — ranking stays owned by the engine.
   */
  weight: number;
  state: GraphNodeState;
  /** Opaque display key/value pairs for the context panel. Presentation copies, never computes. */
  meta: { label: string; value: string }[];
};

export type GraphEdge = {
  id: string;                          // `${type}:${source}->${target}`
  type: GraphEdgeType;
  source: string;                      // GraphNode.id
  target: string;                      // GraphNode.id
};

/**
 * Real business activity. NOT ambient motion — ambient is generated in the renderer and never appears
 * here. Every entry originates from a real EventEnvelope read via core/events.
 */
export type GraphActivity = {
  id: string;                          // EventEnvelope.event_id
  eventType: string;                   // EventEnvelope.type, e.g. "invoice.paid"
  occurredAt: string;                  // ISO
  /** The node the event landed on. Events that resolve to no node are DROPPED, never fabricated. */
  nodeId: string;
  /** Human sentence for the ticker and the aria-live region. */
  summary: string;
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activity: GraphActivity[];
  /** Provenance — rendered in the status line so the operator always knows what they're looking at. */
  source: { name: string; builtAt: string; nodeCount: number; edgeCount: number };
};

/** The seam. The projection is one implementation; the future indexer will be another. */
export type GraphSource = () => Promise<GraphModel>;
```

### What is deliberately absent from the contract

No `x`/`y`, no color, no radius, no opacity, no pulse timing, no cluster assignment. Layout and all visual
mapping are computed **inside the renderer** from `type`, `weight`, and `state`. This is what lets the data
layer be swapped without touching a line of UI.

---

## 2. Projection sources

`graph-view/projection.ts` implements `GraphSource` by calling **existing exported readers only**.
It opens no file, holds no cache, writes nothing, and computes no business fact.

| Node/edge produced | Reader called | Layer | Owner |
|---|---|---|---|
| `client` | `listClients()`, `getClient()` | `core/crm` | canonical client reader (F15) |
| `project`, `phase`, `task` | `listProductionStates()` | `core/production` | canonical production reader |
| `prospect` | `listProspects()` | `lib/sales` → `core/crm` | prospect reader + `computeScore` |
| `invoice` | `listInvoices()` | `core/finance` | finance record store |
| `care_plan` | `listCareClients()` | `core/finance` | care read-model |
| `document`, `supersedes` | `listDocuments()` | `lib/documents` | document store |
| `approval` | `listApprovalRequests()` | `lib/portal` | portal store |
| `audit` | `listAudits()` | `lib/audits` | audit log |
| `opportunity` | `detectOpportunities()` | `lib/opportunities` | opportunity composer + engine |
| `sop`, `wikilink` | `buildKnowledgeIndex()` | `core/knowledge` | **the existing KnowledgeIndex, read-only** |
| `activity` | `readEvents({ limit })` | `core/events` | the single event reader |
| `state.health` | `computeHealthScore(state, hours)` | `engines/health-engine` | health engine, **type + invoke only** |

**The existing KnowledgeIndex is consumed, not replaced.** Its `sop` nodes and `wikilink` edges are mapped
straight through. The projection adds the entity kinds the index does not yet cover — it never re-derives
what the index already provides.

### Non-negotiable rules encoded in the module header

1. **No `node:fs`, no `path`, no vault paths.** All I/O is somebody else's, through their public reader.
   (This also keeps the F15 pinned-reader set from growing.)
2. **No business computation.** No sums, no averages, no scoring, no ranking, no status derivation.
   Every displayed value is copied from the read-model that owns it.
3. **No persistence.** Built per request, in memory, discarded. Same vault → same graph.
4. **No writes, no events emitted.**
5. **Type-only imports from `engines/`** — preserving F14 in spirit even though the rule's scan set is
   `app/` and `components/`. `computeHealthScore` is reached through Mission Control's
   `assembleHealthOverview()`, not imported directly.

---

## 3. Node taxonomy

| Type | Node id | `entity` | Label source | Weight | State |
|---|---|---|---|---|---|
| `client` | `client:<slug>` | `client` | business name | 1.00 | health from `assembleHealthOverview`; `attention` when `at_risk` |
| `project` | `project:<slug>` | `project` | `"<name> · Build"` | 0.85 | health; `status` = active phase label |
| `phase` | `phase:<slug>:<key>` | `phase` | `PHASE_LABEL[key]` | 0.45 | `status` = `PhaseStatus` |
| `task` | `task:<slug>:<key>:<i>` | `task` | checklist text | 0.20 | `status` = `"open"` |
| `prospect` | `prospect:<slug>` | `prospect` | prospect name | 0.70 | `status` = `ProspectStatus`; `attention` when tier is `priority`/`hot` |
| `invoice` | `invoice:<id>` | `invoice` | `"<label> · $<amt>"` | 0.55 | `status` = `deriveInvoiceStatus()`; `attention` when `overdue` |
| `document` | `document:<docId>` | `document` | `"<title> v<n>"` | 0.50 | `status` = `DocumentStatus` |
| `approval` | `approval:<id>` | `approval` | approval title | 0.50 | `status` = `deriveApprovalStatus()`; `attention` when `overdue` |
| `audit` | `audit:<id>` | `audit` | `"Audit · <strategy>"` | 0.35 | `status` = worst band |
| `care_plan` | `care_plan:<slug>` | `care_plan` | `"Care · <name>"` | 0.45 | `status` = `CarePlanStatus` |
| `opportunity` | `opportunity:<id>` | — (`client`) | `Opportunity.title` | 0.60 | `status` = severity; `attention` when `urgent` |
| `sop` | `sop:<slug>` | `sop` | SOP title | 0.40 | — |

**`weight` is structural, not editorial.** It is a fixed constant per type — a rendering hint for node
radius, nothing more. It is explicitly *not* `Decision.priorityScore`: importing ranking into the graph
would move a business judgement into the presentation layer. Attention is expressed by the
**attention column**, which is Decision-ranked, and by the `state.attention` flag its owner set.

### Why there is no `signal` node

`assembleFiringSignals()` = health signals ∪ opportunity signals. Health is a *property of a project*, so it
is modeled as node **state** on `client`/`project`. Opportunities are first-class attention objects, so they
are **nodes**. Together they cover 100% of firing signals with **zero duplication**. Adding a `signal` node
type would create a second representation of data already on the graph — precisely the duplicate-read-model
pattern F15 exists to prevent.

---

## 4. Edge taxonomy

Every edge is a foreign key that **already exists on disk**. No edge is inferred, weighted, or invented.

| Edge | Direction | The fact on disk |
|---|---|---|
| `has_project` | client → project | `production_state.md` lives in the client's folder |
| `has_phase` | project → phase | `ProductionState.phases[]` |
| `has_task` | phase → task | `Phase.checklist[]` where `done === false` |
| `billed` | client → invoice | `Invoice.client` |
| `owns_document` | client → document | `DocumentFrontmatter.client` |
| `supersedes` | document → document | `DocumentFrontmatter.supersedes` |
| `awaits_approval` | client → approval | `ApprovalRequest.client_slug` |
| `measured_by` | client → audit | `Audit.client` |
| `subscribes` | client → care_plan | `CareClient.slug` |
| `promoted_to` | prospect → client | `structural_meta.promoted_from_prospect` |
| `flags` | opportunity → client \| prospect | `Opportunity.target.{kind,slug}` |
| `wikilink` | any → any | `KnowledgeIndex.edges` — mapped straight through |

**Dangling-edge policy, inherited from `packages/graph` (DG-4.4.2):** an edge whose source or target does not
resolve to a node is **dropped**. No placeholder node is ever fabricated.

### Events are activity, not edges

An event does **not** become an edge. `EventSubject` resolves to a node via `` `${entity}:${entity_id}` `` and
the renderer animates a pulse **outward along the structural edges that already exist**. Verified against the
real log: `{entity:"project", entity_id:"tapia-tile-marble"}` → `project:tapia-tile-marble` ✓.
Events that resolve to no node are dropped. This sidesteps GAP-4 without fabricating anything.

---

## 5. Example graph — generated from the CURRENT REAL VAULT

Counted directly from `ASCEND_VAULT_PATH`, not estimated.

### Nodes — 85 deterministic (+ runtime) → **91 measured**

| Type | Count | Actual instances |
|---|---:|---|
| `client` | 3 | bay-area-custom-shirts-inc · decoraciones-pilar · tapia-tile-marble |
| `project` | 3 | one per client (`production_state.md` present for all three) |
| `phase` | 15 | 5 phases × 3 projects |
| `task` | 30 | 17 open (bay-area) + 0 (pilar, complete) + 13 (tapia) |
| `prospect` | 6 | central-coast-cleaning · modesto-hvac-co · valley-roofing-pros · tile-amp-marble-installation-in-bay-area · tapia-tile-amp-marble-co · bay-area-custom-shirts-inc *(closed-won)* |
| `invoice` | 8 | 6 pilar (5 paid, **1 overdue** — Care plan · Jun 2026, $199, due 2026-06-15) + 2 tapia (paid) |
| `document` | 5 | pilar: contract v1 *(superseded)* → v2 *(draft)*, proposal v1 *(superseded)* → v2 *(accepted)*; tapia: SOW v1 *(draft)* |
| `approval` | 3 | pilar: design ✓ · launch ✓ · revised sitemap ✓ |
| `audit` | 12 | pilar 10 (8 mobile, 2 desktop) · tapia 2 (1/1) |
| `sop` | **0** | The SOP Library's only top-level file is `README.md`, which `listMarkdownFiles` deliberately excludes. Zero is the honest answer — the earlier "1" was a miscount. |
| `care_plan` | runtime | inferred by `listCareClients()` |
| `opportunity` | runtime | `detectOpportunities()` — clock-dependent |

### Edges — 79 structural (+ `flags`) → **85 measured**

`has_project` 3 · `has_phase` 15 · `has_task` 30 · `billed` 8 · `owns_document` 5 · `supersedes` **2** ·
`awaits_approval` 3 · `measured_by` 12 · `promoted_to` **1** (bay-area-custom-shirts-inc) · `flags` **6**

**Measured at runtime: 91 nodes / 85 relationships.** The delta from the 86/79 prediction is +6 live
`opportunity` nodes with their 6 `flags` edges, −1 SOP (see above), and 0 care plans (the last paid care
invoice is >60d old, so `listCareClients` reports no active retainer — again, honest rather than padded).

### The shape it produces

```
                 central-coast-cleaning ○      valley-roofing-pros ○
                              modesto-hvac-co ○      ○ tile-amp-marble-…
                                        ╲    │    ╱
   bay-area-custom-shirts-inc ○ ─promoted_to─▶ ◉ bay-area-custom-shirts-inc
        (prospect, closed-won)                 │
                                               ├─▶ ◆ project ─▶ 5 phases ─▶ 17 tasks
                                               │
   ◉ decoraciones-pilar ────────────────────┐  │
     ├─ billed ─▶ 6 invoices  (1 ⚠ overdue) │  │
     ├─ owns ───▶ 4 documents  (v1 ◀─supersedes─ v2 ×2)
     ├─ awaits ─▶ 3 approvals  (all signed)
     ├─ measured ▶ 10 audits
     └─ has ────▶ ◆ project ─▶ 5 phases ─▶ 0 open tasks   ← launched
   ◉ tapia-tile-marble
     ├─ billed ─▶ 2 invoices (paid)
     ├─ owns ───▶ 1 document (SOW v1, draft)
     ├─ measured ▶ 2 audits
     └─ has ────▶ ◆ project ─▶ 5 phases ─▶ 13 open tasks  ← in flight
```

**This is a real graph.** It has three genuinely different client shapes — one launched and quiet, one
mid-build and busy, one freshly promoted with a full task backlog — plus a live overdue invoice and a real
document supersession chain. It is dense enough to prove the UX and contains nothing invented.

**Density question the prototype must answer:** 30 of 91 nodes are checklist tasks. A `detail` control
(`core` / `+ artifacts` / `+ tasks`) will be included so we can *measure* the right default rather than guess.

---

## 6. Temporary vs. permanent

| | Lifetime | Why |
|---|---|---|
| `graph-view/contract.ts` | **PERMANENT** | The seam. The indexer will eventually satisfy it. |
| `graph-view/projection.ts` | **TEMPORARY — disposable** | Composes canonical readers because the index cannot yet. Header states its retirement condition. |
| `graph-view/taxonomy.ts` (type/edge → color, radius) | **PERMANENT** | Presentation mapping; independent of data origin. |
| `components/graph/*` renderer | **PERMANENT** | Consumes `GraphModel` only. |
| Node id scheme `${type}:${entityId}` | **PERMANENT** | The indexer must adopt it for the swap to be transparent. |
| Everything under `packages/indexer`, `core/knowledge`, `packages/graph` | **UNTOUCHED** | Frozen this increment. |

`projection.ts` ships with this in its header:

```
TEMPORARY — RETIRE WHEN GAP-1/2/3 CLOSE.
This module exists because the KnowledgeIndex covers 3 of 25 EntityKinds and emits only wikilink
edges. It is a disposable UI read-model adapter, NOT a source of truth. It reads nothing from disk
itself and computes no business fact. When packages/indexer gains structural + event contributors,
replace this with `indexerGraphSource` and DELETE this file. The UI must not change.
```

---

## 7. Rendering technology

**Canvas 2D + a hand-written force simulation. No new rendering dependency.**

Decided against the measured n = **86 nodes / 79 edges** (≈ 56 nodes with tasks hidden):

- **SVG / DOM** — 86 elements re-transformed at 60fps is the one option that genuinely doesn't scale, and it
  makes glow and layered depth expensive. Rejected.
- **WebGL** — solves the 10k-node problem this product does not have, at the cost of a large dependency,
  shader code, and a far worse text and accessibility story. Over-engineering. Rejected.
- **d3-force / cytoscape / sigma** — d3-force is ~30KB for a simulation that at n = 86 is ~90 lines of
  arithmetic. The brief forbids unjustified dependencies. Rejected.
- **Canvas 2D + own simulation** — one DPR-aware element, total control of the visual language (which *is*
  the differentiator here), zero new deps, and easy to profile. **Chosen.**

Performance discipline: O(n²) repulsion (86² = 7,396 pair ops/frame — trivial) with a grid-bucketed fallback
above n = 400; node glows are pre-rendered radial-gradient sprites cached per type (**`shadowBlur` is banned
in the draw loop**); rAF halts entirely when the simulation has cooled and the pointer is idle.

Accessibility is a *requirement of the slice*, not a follow-up: a parallel hidden `<ul>` of real links is the
actual Tab order, so the graph is fully operable without touching the canvas.

---

## 8. How the projection is replaced without rewriting the UI

The UI depends on the **contract**, never on the projection.

```
   TODAY                                      LATER
   ─────                                      ─────
   projection.ts ─┐                           indexerGraphSource.ts ─┐
   (temporary)    │                           (permanent)            │
                  ├──▶ GraphSource ──▶ UI                            ├──▶ GraphSource ──▶ UI
                  │    (contract)      ▲                             │    (contract)      ▲
                  ┘                    │                             ┘                    │
                                  UNCHANGED                                          UNCHANGED
```

```ts
// app/page.tsx — the only line that changes at swap time.
import { projectGraph as graphSource } from "@/graph-view/projection";
//   →  import { indexerGraphSource as graphSource } from "@/graph-view/indexer-source";

const model = await graphSource();
return <NeuralCore model={model} />;
```

Three properties make the swap a one-line change:

1. **`NeuralCore` accepts `GraphModel` as a prop.** It never imports `projection.ts`, `core/*`, or `lib/*`.
   A component-level import test can enforce this.
2. **Node ids are `${type}:${entityId}`, not filesystem paths.** The indexer must produce the same ids;
   this spec is that requirement, written down in advance.
3. **Presentation mapping lives in `taxonomy.ts`**, keyed by `GraphNodeType` / `GraphEdgeType` — both of
   which are contract vocabulary, not projection internals.

**What the prototype is expected to teach us**, and which we will feed into the permanent design: the right
default density; whether `weight` needs to be data-driven rather than a per-type constant; whether `phase`
and `task` deserve to be nodes at all or should collapse into project state; whether `wikilink` edges add
signal or noise beside structural ones; and which of the 25 `EntityKind`s the indexer actually needs to
cover first.

---

## 9. What this increment does not do

No vault, core, engine, or Mission Control file is modified. `packages/indexer`, `core/knowledge`, and
`packages/graph` are untouched. No fitness rule is weakened, disabled, or exempted. No fake node, fake edge,
or fake event is created. No new event infrastructure is added — `core/events.readEvents()` is the only
event source. No AI/agent layer. One dependency is added for the whole redesign: `geist` (a self-hosted
typeface).