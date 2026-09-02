# Ascend OS — UI/UX Redesign Proposal

Status: Approved — Presentation-Layer Source of Truth

Implementation Status: Redesign not yet implemented; specification approved

Architectural Scope: Presentation layer only

Implementation Rule: Approval of this specification does not authorize automatic implementation. Implementation proceeds slice-by-slice, with architecture, type, lint, fitness, relevant system-test, accessibility, performance, and visual verification gates before advancing.

---

## 0. How to read this document, and what has already changed under it

**This is a reconciliation, not a second specification.** An approved specification and an existing
in-repository proposal were merged on 2026-09-02. Where they agreed, the existing text was kept.
Where the existing text conflicted with the approved specification, the approved specification wins.
Where the existing text conflicted with the REPOSITORY, the repository wins and the correction is
marked — an audit that describes a codebase which no longer exists is worse than no audit, because it
is read as current.

**"Redesign not yet implemented" is exactly true of the 3D Business Universe this document
specifies, and is NOT true of everything below it.** Recorded here rather than left to be discovered,
because a reader who takes the status line as "nothing exists" will re-do work that is already done.
Measured on disk 2026-09-02:

| Already built | State |
|---|---|
| `/` as the Neural Core | Live. It is the home surface and the operator's landing destination. |
| `/dashboard` | **RETIRED** — a permanent `redirect("/")`. The 647-line HUD is gone. |
| `/search` | **RETIRED** — a permanent redirect to `/console?q=`. |
| `OrbitalDock`, `JarvisLauncher`, `ScrambleTitle`, the "sir" voice | **Deleted.** None exists. |
| `components/` tiering | `primitives/`, `shell/` (`NavRail`, `CommandPalette`), `graph/`, `admin/`, `sales/`, `auth/` all exist. 43 components, not a flat 50. |
| Labeled navigation | `navigation/destinations.ts` + `components/shell/NavRail.tsx`, capability-filtered, live. |
| A graph projection | `graph-view/projection.ts` exists — see Part Three, which was rewritten because it previously proposed introducing something that is already here. |
| A 2D Neural Core | `components/graph/{NeuralCore,GraphCanvas,ContextPanel,simulation}.tsx`. |

| Not built | State |
|---|---|
| The 3D renderer | No Three.js, no WebGL, no `components/galaxy/`. No 3D dependency in `package.json`. |
| `SpatialModel`, `GalaxyLayout` | Do not exist. |
| Constellations, temporal mode, God View, shockwaves | Do not exist. |
| Slices 1–20 (Part Four) | **None started.** |

**The layer boundaries this document must not alter:**

```text
Vault → Core → Engines → Mission Control → API / Surface
```

Preserved from the original proposal's inspection notes, with the counts corrected to 2026-09-02 —
the layer inventory is valid architectural material and is why the redesign is confined to the last
row:

| Layer | Reality on disk |
|---|---|
| Vault | Real Obsidian vault at `ASCEND_VAULT_PATH`. 5 numbered folders + `.ascend-os/` JSONL sidecar. |
| Core | `core/{vault,crm,production,finance,events,knowledge,notifications,config,command-runtime,auth,db,admin,reconciler}` — sole owner of fs + writes + event emission, and since 2G.1 slice 2 the sole owner of the authorization boundary. |
| Engines | 11 pure engines. No fs, no env, no fetch, no module-level mutable state, no cross-engine imports — all machine-enforced. |
| Mission Control | 13 orchestrators. Assemble/invoke/order only; forbidden from computing, and forbidden from importing the graph (F11). |
| Packages | `domain` (pure kernel), `indexer` (KnowledgeIndex producer), `graph`, `search`, `commands`, `markdown`. |
| Surface | `app/` — 29 page routes + 29 API routes; `components/` — 43 files, tiered; `navigation/{routing,destinations}.ts`. |

**The architecture is genuinely good and genuinely frozen.** Fitness rules run **F1–F60** as of this
writing — the document previously said F59; F60, the one-importer-map rule, landed in 2G.4.2 — and
they encode the architecture as executable rules, including named, narrow exemptions. The redesign is
presentation-layer work: nothing in it justifies changing that architecture, and nothing in it
weakens, widens, or removes a rule.

---
# PART ZERO — THE GRAPH AUTHORIZATION BOUNDARY

**This part outranks every other part of this document.** Where a visual requirement and this part
disagree, this part wins, and the visual requirement is the thing that changes.

## 0.1 The rule

> **GraphProjection MUST be constructed for the currently resolved principal, from authorized
> canonical business data.**
>
> **The graph must NEVER be constructed globally and then merely hidden visually.**

A globally-built graph that is filtered at render time is not access control. It has already read the
data, it holds it in process memory, and it will leak it — through a serialized RSC payload, an error
message, a debug log, a search index, a bounding-box calculation, a node count, or a layout that
reserves space for something the viewer may not know exists. **Hiding is a presentation act.
Authorization is a data-access act. This system has spent two stages separating them and the graph
layer does not get an exemption.**

## 0.2 The required flow

```text
PostgreSQL membership
        ↓
Resolved Principal
        ↓
Authorization Policy
        ↓
Authorized Canonical Data
        ↓
GraphProjection
        ↓
SpatialModel
        ↓
GalaxyLayout
        ↓
Neural Core Renderer
```

Authority enters at the top and is never re-decided further down. `SpatialModel`, `GalaxyLayout` and
the renderer receive an ALREADY-AUTHORIZED projection and make no authorization decision of their
own — they cannot, because they will not be given the principal.

## 0.3 What the boundary must propagate through

Every one of these is a disclosure surface, and each must carry the same boundary as the data it is
derived from:

- **graph nodes** — an unauthorized entity is ABSENT, not dimmed, not `visible: false`
- **graph edges** — an edge to an unauthorized node is absent; an edge is a claim that two things exist
- **events** — the event spine is business history and is scoped like any other read
- **temporal reconstruction** — a past state must be reconstructed from events the viewer may read; history is not an exemption
- **constellations** — a derived subgraph inherits the boundary of the subgraph it derives from
- **search** — already scoped at ASSEMBLY (`core/knowledge`, `visibilityFor`); the graph must not become a second, unscoped index
- **focus** — focusing an entity must not confirm the existence of one the viewer may not read
- **navigation** — a destination offered is a claim the destination is reachable; F57 already holds this for the rail
- **contextual panels** — the panel is a read; it authorizes at its own DAL boundary like every other read

## 0.4 The authorization model this projects (as of 2G.4.7, `2f76f3d`)

```text
Owner          → full normal business universe
               → admin/security-management capabilities

Sales Partner  → full normal business universe
               → admin/security-management excluded
```

Concretely: `owner \ sales === ["admin:*"]`, asserted from the capability table in
`tests/auth/dal-boundary.test.ts` and `tests/auth/landing.test.ts`. There is exactly one sales
partner and he is a trusted business operator.

**The consequence for the graph, stated plainly so nobody builds the wrong thing:** today the two
roles' authorized business universes are IDENTICAL, because `admin:*` guards no entity the graph
projects. A projection that is correct today can therefore be a projection that never learned to
scope anything. **That is the trap.** The boundary must be built as though the universes differ,
because the model permits a future role for which they will, and because a scoping layer first
exercised on the day it matters is a scoping layer nobody has tested.

**Do not build per-entity ownership to satisfy this.** `prospects.assigned_to` was audited in 2G.4.7
and deliberately NOT made an authorization boundary: it has no writer, no RLS policy references it,
and `ascend_sales` holds `UPDATE` on it — making it load-bearing would be authorization the subject
controls. The boundary is capability-based and organization-scoped. It is not a relationship engine.

## 0.5 How this is verified, and what would NOT verify it

Per the testing principle in Part Five, a scoping claim needs a **discriminating witness**: a
principal for whom the projection genuinely differs, and an assertion that fails if the scoping were
removed. Acceptable evidence is a projection built for two principals with different authorized data
where the smaller is provably a subset AND provably smaller. **A node count, a snapshot, or "it looks
right" is not evidence** — and neither is an assertion that passes because the two universes happen
to coincide. That last one is exactly how `index-scoping`'s E5 control and `dal-mutation-gate`'s
crossover detector went vacuous in 2G.4.7 (§29.13), and it will happen here for the same reason
unless the witness is constructed rather than hoped for.

---
# PART ONE — AUDIT OF THE CURRENT UI (as taken; **historical**)

> **READ THIS FIRST.** This audit is a MEASUREMENT TAKEN AT A TIME, and much of what it describes has
> since been fixed. It is kept unedited because it is the evidence the redesign was argued from, and
> rewriting it would leave the argument with no premises. **Do not read it as current state** — §0
> above is current state.
>
> Superseded since the audit: `/` is the Neural Core (it no longer redirects to `/dashboard`);
> `/dashboard` and `/search` are retired permanent redirects; `OrbitalDock`, `JarvisLauncher`,
> `ScrambleTitle` and the "sir" voice are deleted; `components/` is tiered
> (`primitives/ shell/ graph/ admin/ sales/ auth/`) at 43 files, not a flat 50; there are 29 page
> routes and 29 API routes, not 22; fitness runs F1–F60.
>
> Route names that have moved since: `/crm/[client]` is `/clients/[slug]`; `/admin/import` is
> `/sales/import` (moved in 2G.4.7 — importing prospects is sales work, not administration);
> `/onboarding` does not exist; `/partner` and `/admin/invitations` were added by Stage 2G.3.


## 1.1 Routes

| Route | Purpose | Verdict |
|---|---|---|
| `/` | `redirect("/dashboard")` | **REPLACE** — becomes the 3D Neural Core |
| `/dashboard` | The HUD. 12 stacked panels. | **REPLACE** |
| `/crm`, `/crm/[client]`, `/crm/[client]/portal` | Client profiles, portal admin | REWORK |
| `/production`, `/production/[client]` | Phase ladder + checklists | REWORK |
| `/sales`, `/sales/[prospect]` | Hit list + scoring | REWORK |
| `/tasks` | Open checklist items across projects | REWORK |
| `/documents`, `/documents/[id]` | Deal paperwork | REWORK |
| `/finance` | Invoices, revenue | REWORK |
| `/signals`, `/automations`, `/maintenance` | Intelligence surfaces | REWORK → merge |
| `/console` | Search + command runtime, GET-form driven | **KEEP the model**, restyle |
| `/search` | Duplicate of Console face 1 | **REPLACE** — fold into ⌘K |
| `/admin`, `/admin/import`, `/admin/wipe` | System | KEEP |
| `/login`, `/portal/[token]/*` | Auth + client-facing portal | KEEP (portal is a separate design problem) |
| `/onboarding` | Onboarding form | KEEP |

## 1.2 Navigation

`components/OrbitalDock.tsx` — a fixed 56px left rail of **12 unlabeled icons**, tooltip-on-hover only. One entry (`Comms`) is `live: false` and links to `/crm` anyway. `Mission` and the logo both go to `/dashboard`.

**Weaknesses:** unlabeled icons force recall over recognition; 12 flat peers with no grouping means no information architecture at all; a dead nav item ships in production; nothing communicates *where you are* beyond a 6px dot.

## 1.3 Layout

`app/layout.tsx` renders, for an authenticated operator: `hud-grid` (fixed radial + 56px grid overlay), `hud-aurora` (a 1200×600 blurred cyan radial bleeding from the top), `OrbitalDock`, `TopMetricStrip`, `StopwatchWidget`, `CommandPalette`, `JarvisLauncher`, and a `max-w-7xl` centered main.

Two background treatments plus a glass panel system means **three simultaneous depth languages** competing on every screen.

## 1.4 Information hierarchy — the core failure

`app/dashboard/page.tsx` is **647 lines** rendering **12 vertically stacked full-width panels**:

```text
header → JARVIS hero → priorities → inbox → 6 KPI cards → active projects
→ portfolio health → hit list + heatmap → activity → insights → forecast
→ compliance → approvals → site quality → effort → pipeline → documents
```

Every one of them is `glass scanlines rounded-xl p-4`, every header is `font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400` preceded by a pulsing dot. Because everything is styled identically, **nothing is emphasised** — the ranked priority feed (the actual output of the Decision Engine) has the same visual weight as the SOP template-compliance list.

The page also awaits 13 parallel reads and then **9 sequential `await`s** for the Mission Control assemblers. That is 9 serialised round-trips to the filesystem on every load.

And it is the recorded F14 violation: it value-imports `rank` from `@/engines/decision-engine` and calls it directly instead of going through `assemblePriorityFeed`.

## 1.5 Data actually available to the home page

All of this is already fetched and real — the problem is presentation, not supply:

`PriorityItem[]` (Decision-ranked) · `HealthTile[]` · `KpiCardModel[]` · `EventEnvelope[]` (activity spine) · `Insight[]` · `Forecast[]` · `ComplianceReport[]` · `Approvals` · `SiteQuality` · `Effort` · `Pipeline` · `Documents` · `Notification[]` · `ProductionState[]` · `Prospect[]` · time/streak/heatmap.

## 1.6 Visual system

`app/globals.css`, 139 lines, Tailwind 4 `@theme`:

- **Base:** `#030303` pure black, `#0a0a0d`, `#131318`; zinc borders at 30–40% alpha.
- **Accents:** cyan `#22d3ee` (primary) + violet `#a78bfa` ("system-processing") + red/green.
- **Type:** `ui-sans-serif, system-ui` — i.e. **no typeface decision was ever made**. Metrics render in the system UI font. `font-feature-settings: "ss01","cv01"` is set globally against fonts that don't have those features.
- **Effects:** `.glass` (16px backdrop-blur), `.glass-hi` (20px), `.scanlines`, `.hud-pulse`, `.chroma-pulse`, `.hud-aurora`, `.hud-grid`.

This is a **cyan-on-black sci-fi HUD** — precisely the aesthetic the brief rules out. `ScrambleTitle` renders the literal string `"JARVIS  HUD"` with a text-scramble effect. The JARVIS greeting addresses the operator as *"sir"*.

## 1.7 Typography — measured

There is no scale. Across the dashboard: `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`, `text-base`, `text-2xl`, `text-3xl`. Labels are ~85% `font-mono text-[10px] uppercase tracking-[0.2em]` regardless of importance. **9px uppercase mono at `tracking-widest` on `text-zinc-600` (#52525b) against `#0a0a0d` is roughly 2.1:1 contrast** — well below WCAG AA, and it is used for real information (compliance detail, forecast metric names, document lineage).

## 1.8 Responsive

`sm:` breakpoint only, in most places. The dock is `hidden sm:flex` with **no mobile replacement** — below 640px there is no navigation at all. Panels collapse to a single column and the dashboard becomes a ~6000px scroll.

## 1.9 Interaction patterns

- `/console` and `/search` drive everything through **GET form submissions and full page reloads**. Architecturally clean (GET never writes; mutations are POST-confirmed), but it means every keystroke-to-result cycle is a navigation.
- `CommandPalette.tsx` (399 lines) is a *separate* client-side terminal with **its own regex NL parser** (`inferCommand`) mapping "show me X" → `/open X`. This duplicates `packages/commands.matchCommands` with a second, fuzzier, non-deterministic matcher — and it does not go through `core/command-runtime`.
- 50 components in one flat directory, no primitives layer. `KpiCard`, `MissionTile`, `OpportunityCard`, `PendingFiringCard`, `AuditClientCard`, `ClientCard` are six near-identical card implementations.

## 1.10 KEEP / REWORK / REPLACE

### KEEP — unchanged
- Every architectural layer below the surface, and all fitness rules (F1–F59).
- `navigation/routing.ts` as the single entity→route owner (needs *extension*, not replacement).
- The Console's execution model: discovery ≠ execution; GET never writes; mutation = preview → explicit POST confirm.
- `middleware.ts` deny-by-default perimeter, and the layout's operator-only HUD gating.
- Server Components + `force-dynamic` + Server Actions for mutations.

### REWORK — good information, poor presentation
- Priority feed, health tiles, KPIs, activity stream, notification inbox, insights, forecasts, approvals, site quality, effort, pipeline, documents. All of these become **contextual**, surfaced against the graph or inside an entity's context, rather than 12 equal-weight stacked panels.
- Production phase ladder and checklists.
- Prospect scoring display.

### REPLACE — deleted outright
- The cyan/violet HUD token set, `.glass`, `.scanlines`, `.hud-grid`, `.hud-aurora`, `.chroma-pulse`.
- `OrbitalDock` (unlabeled icon rail).
- `ScrambleTitle` / `"JARVIS HUD"` / `JarvisOrb` / the "sir" voice.
- `CommandPalette.tsx`'s regex NL inference layer — replaced by `matchCommands` + `runCommand`, the deterministic matchers that already exist.
- `/search` as a distinct route.
- The 647-line dashboard.

---

# PART TWO — THE PROPOSAL

## 2.1 Design philosophy & Core Principles

Five principles govern the presentation layer, in strict priority order:

1. **The graph is the business universe, not decoration.**  
   Every rendered business object, relationship, movement, event, and constellation must be grounded in canonical Ascend data or a clearly labeled cosmetic system. If the graph were removed, the product should stop working — not just look plainer.
2. **Every rendered pixel is a claim about the business.**  
   Ambient motion is the one exception, and it is therefore held to a strict rule (§2.9): ambient activity must be *structurally* incapable of being mistaken for a business event, and must be labelled as such in the UI.
3. **Calm by default; loud only when earned.**  
   Nothing pulses, glows, or animates because it is "active." Emphasis is spent only on Decision-ranked attention. Everything else is quiet, dense, and legible.
4. **The galaxy is allowed to be spectacular. Spectacle is not the enemy; meaningless spectacle is.**  
   The 3D universe should genuinely impress, but every visual effect must have a defined semantic or presentation role.
5. **Visual animation is a projection of business state; it is never a source of business state.**  
   Animation reflects canonical events and states downstream; it never creates or mutates business facts.

## 2.2 Visual direction — "Deep Field Galaxy"

An **observatory instrument**, not a cockpit or a neon video game. The reference points are precision measurement equipment and astronomical deep-field observation: a deep, cool, non-black space ground; thin structural rules instead of floating cards; generous whitespace around large metrics; and light used sparingly and physically.

**Explicitly rejected, by name:** cockpit · neon gaming · glassmorphism · AI-hacker / JARVIS. These are named rather than implied because each was in the product at audit time and each has an obvious gravitational pull during implementation — a glass panel is one utility class away, and a cyan glow always looks like progress.

Concretely, the shift from today:

| | Current | Proposed |
|---|---|---|
| Ground | `#030303` pure black + grid + aurora | `#05070D` space ground, `#080B14` deep space, `#182033` dust |
| Containers | Blurred glass cards, everywhere | Hairline rules and negative space; a surface only when it must float |
| Accent | Cyan (state) + violet (system) | Restrained warm gold (`#E5A02C`), reserved *exclusively* for operator focus |
| Depth | backdrop-blur | Spatial orbits + value steps + shadow on true overlays |
| Emphasis | Everything pulses | Only Decision-ranked items and real business events |

## 2.3 Typography

**Geist Sans + Geist Mono**, via the `geist` npm package (Vercel; self-hosted, zero build-time network dependency).

Why Geist:
- Engineered specifically for interfaces and code: true tabular figures, a matched mono, tight display sizes, quiet at 12px.
- The Sans/Mono pairing gives the editorial↔technical duality this product needs from *one* family.

| Role | Face | Size / line | Tracking | Weight |
|---|---|---|---|---|
| `display` | Geist Sans | 44 / 1.02 | −0.03em | 500 |
| `metric-xl` | Geist Sans, `tabular-nums` | 34 / 1.0 | −0.02em | 500 |
| `metric` | Geist Sans, `tabular-nums` | 22 / 1.1 | −0.015em | 500 |
| `page-title` | Geist Sans | 22 / 1.15 | −0.02em | 500 |
| `section-title` | Geist Mono | 11 / 1.2 | +0.14em, UPPER | 500 |
| `body` | Geist Sans | 14 / 1.5 | 0 | 400 |
| `meta` | Geist Sans | 12.5 / 1.45 | 0 | 400 |
| `label` | Geist Mono | 11 / 1.2 | +0.10em, UPPER | 500 |
| `number` | Geist Mono, `tabular-nums` | 13 / 1.3 | 0 | 500 |
| `code` | Geist Mono | 12.5 / 1.5 | 0 | 400 |
| `nav` | Geist Sans | 13.5 / 1.2 | −0.005em | 450 |

**Minimum rendered size is 11px, and no text below `--text-2` in contrast.** The current 9px/#52525b combination is deleted.

## 2.4 Color & Galaxy Color System

Semantic, restrained, and built on one rule that resolves dashboard color mud:

> **Accent is a UI state (focus / selection / you-are-here). It is never a data value. Node color encodes entity type. Health encodes as ring + shape, never as fill hue.**

### Base Space Palette
| Token | Value | Use |
|---|---|---|
| `--bg-space` | `#05070D` | Base space ground plane |
| `--bg-deep` | `#080B14` | Deep space background depth |
| `--bg-dust` | `#182033` | Restrained galaxy dust / nebula texture |
| `--surface` | `#111316` | Floating UI overlays / cards |
| `--surface-2` | `#171A1E` | Hover / nested surfaces |
| `--border` | `#22262B` | Hairline structural rules |
| `--border-strong` | `#2E343B` | Emphasis dividers, input outlines |
| `--text-1` | `#E8EAED` | Primary text |
| `--text-2` | `#9BA3AC` | Secondary text — AA compliant at 12px |
| `--text-3` | `#6C757E` | Muted text — floor; nothing below this |

### Semantic Palette
| Token | Value | Meaning |
|---|---|---|
| `--accent` | `#E5A02C` *(Filament Gold)* | **Operator focus only.** Selection, active nav, focus ring, real-event pulse. |
| `--accent-dim` | `#8A6220` | Accent at rest |
| `--good` | `#4FA88B` *(Jade)* | Healthy, paid, accepted, complete |
| `--risk` | `#E06C5A` *(Coral)* | At risk, overdue, blocked |
| `--info` | `#7C9CBF` *(Slate)* | Informational & ambient graph activity |

### Celestial Body Colors (By Entity Type)
- **Ascend Core:** `#FFFFFF` → `#E5A02C` (White-hot center to warm gold)
- **Client Suns:** `#F59E0B` / `#D97706` (Warm Gold / Amber)
- **Project Planets:** `#38BDF8` / `#0284C7` (Cyan / Blue)
- **Task Moons:** `#34D399` (Jade / Green)
- **Document Moons:** `#94A3B8` / `#CBD5E1` (Silver / Pale Blue)
- **Invoice Orbitals:** `#A855F7` (Violet)
- **Prospect Stars/Comets:** `#F97316` (Warm Orange / Amber)
- **Signal Celestial:** `#F43F5E` (Coral)
- **SOP Celestial:** `#14B8A6` (Teal)

Distinguishable, matched luminance, no screaming RGB neon or cyberpunk aesthetics.

## 2.5 Spacing, radius, shadow, border

- **Spacing:** 4px base — `4 8 12 16 20 24 32 40 56 72 96`.
- **Radius:** `2` (inputs/chips), `4` (buttons), `6` (panels), `10` (overlays). Full-round for celestial orbs & status dots.
- **Shadow:** `elev-1` (`0 1px 2px rgb(0 0 0 / .4)`) and `elev-2` (`0 16px 48px -12px rgb(0 0 0 / .7)`), the latter only on command palette and context drawers. **No DOM glow shadows** — glow exists physically inside the 3D canvas.
- **Border:** 1px hairlines and dividers replace floating card borders.

## 2.6 Navigation architecture

Derived from the route surface (29 pages as of 2026-09-02):

```text
◆ ASCEND                        ⌘K

COMMAND
  Neural Core          /

WORK
  Clients              /crm
  Production           /production
  Pipeline             /sales
  Tasks                /tasks

INTELLIGENCE
  Signals              /signals
  Automations          /automations
  Maintenance          /maintenance

KNOWLEDGE
  Documents            /documents
  Console              /console

FINANCE
  Invoices             /finance

SYSTEM
  Admin                /admin
```

- **Labeled**, 208px rail, collapsible to a 56px icon rail (persisted state); group headers in `section-title`.
- Active route: `--accent` text + a 2px left bar.
- **Mobile: a real drawer**, opened from top bar.
- `⌘K` is the command palette. `/search` folds into it.

**RECONCILED WITH THE LIVE RAIL, 2026-09-02.** The model above is already implemented in
`navigation/destinations.ts` and `components/shell/NavRail.tsx`, and the live table carries **two
destinations this sketch omitted** — both from Stage 2G.3 and neither optional:

| Destination | Group | Requires |
|---|---|---|
| `/partner` | Command | `prospects:read`, `search` |
| `/admin/invitations` | System | `admin:*` |

Two properties of the live rail are load-bearing and must survive the redesign:

- **It is capability-filtered, not role-branched.** `requires` per destination, compared against the
  resolved principal. No role name appears in the navigation layer.
- **F56 and F57 hold it honest.** F56 asserts each destination's `requires` equals its page's
  declared capabilities; F57 asserts every destination HIDDEN from a role still REFUSES that role on
  a direct request. **Hiding a link is not authorization** — a rail that concealed a reachable route
  would be worse than the unlabeled dock it replaced. A redesign that reorganizes navigation
  inherits both rules unchanged.

`Comms` was removed and `/dashboard` already redirects to `/` — both done before this document was
reconciled; listed here as completed, not pending.

---

## 2.7 Home Page — Neural Core 3D Galaxy & Business Universe

Neural Core is a **3D-first interactive business universe**.

### Renderer-Agnostic Spatial Architecture
The underlying architecture separates business truth, spatial arrangement, and rendering:

```text
Canonical Ascend Data
        ↓
GraphProjection (Business Truth)
        ↓
SpatialModel (Spatial Boundaries)
        ↓
GalaxyLayout (Orbital Mathematics)
        ↓
3D Renderer (WebGL / Three.js / Canvas 3D)
```

- `GraphProjection` contains business truth.
- `SpatialModel` determines 3D spatial properties.
- `GalaxyLayout` calculates orbital paths and collisions.
- `3D Renderer` handles visual rendering.
- Business data **never** depends on 3D coordinates.

### The Galaxy Metaphor
Neural Core represents Ascend OS as a living business universe:

```text
                    ASCEND CORE
                         │
              ┌──────────┼──────────┐
              │          │          │
          CLIENT       CLIENT      CLIENT
            ☀            ☀          ☀
            │            │          │
        PROJECTS      PROJECTS    PROJECTS
        PLANETS       PLANETS     PLANETS
          │
       ┌──┴──┐
      TASK  DOCUMENT
      MOONS   MOONS
```

- **Ascend Core:** Central artificial star / root orb representing Ascend OS itself.
- **Clients:** Solar-system Suns (major gravitational centers).
- **Projects:** Planets orbiting their Client Sun.
- **Phases:** Planetary orbital rings / band structures.
- **Tasks & Documents:** Moons / smaller orbiting bodies.
- **Invoices & Approvals:** Finance-colored orbital bodies / satellites.
- **Prospects:** Emerging stars / comets heading toward orbital capture.
- **Signals & SOPs:** Attention & knowledge celestial bodies.

### Ascend Core
The center of the universe is the **Ascend Core**. It represents Ascend OS itself (not a client, AI assistant, business record, or event).

- **Visual Direction:** White-hot core, warm gold primary body, subtle blue/violet corona, restrained halo, subtle surrounding stardust.
- **Cosmetic Breathing Pulse:** Continuous 100% cosmetic pulse. It does **not** represent events or business state — it simply keeps the universe feeling alive.

### Orbital Systems & Mathematics
Orbital hierarchy is deterministic. Objects receive derived spatial properties:
```text
parent, orbitRadius, orbitSpeed, orbitPhase, orbitInclination, size, visualType
```
These are derived presentation properties, not business facts. Physics are constrained (no chaotic Newtonian instability).

---

## 2.8 3D Galaxy Layout Engine & Spatial Memory

### Spatial Engine Architecture
```text
GalaxyLayout
├── SystemLayout
├── OrbitLayout
├── SpatialPacking
├── CollisionResolver
├── CameraFraming
├── LevelOfDetail
├── TemporalLayout
└── UserPinnedPositions
```
- **SystemLayout:** Arranges client solar systems around Ascend Core.
- **SpatialPacking & CollisionResolver:** Allocates spatial footprints based on system density (larger systems get more spatial radius).
- **OrbitLayout:** Computes stable planetary and moon orbits.
- **UserPinnedPositions:** Persists user-dragged node/system positions as presentation metadata without altering business truth.

### Stable Spatial Memory
Deterministic layout seeded from entity IDs + canonical relationships. New entities occupy available space without shifting existing systems. Manual pins are respected across sessions.

### Dynamic Screen Fitting & Level of Detail (LOD)
The camera dynamically frames the universe based on focus and bounding volumes:
- **Far Zoom:** Only Client Suns visible (`☀ ☀ ☀`).
- **Medium Zoom:** Client Suns + Project Planets visible.
- **Close Zoom:** Projects + Task/Document Moons visible.
- **Very Close Zoom:** Individual object details, relationship edges, and metadata.

### Camera as Navigation & God View
- Camera transitions smoothly through levels: Universe → Galaxy → Solar System → Planetary System → Object → Operational Surface.
- **God View / Universe View Button:** Dedicated UI button that pulls camera back to center on Ascend Core and frame the complete universe.

---

## 2.9 Motion Categories & Event Visualization

### Three Motion Categories
```text
COSMETIC MOTION     → Ascend Core breathing, ambient stardust, celestial drift (No business meaning)
REAL EVENT MOTION   → Core events, relationship path pulses, 24–48h shockwaves (Business meaning)
HISTORICAL EVENT    → Permanent append-only event log (Business history)
```

### Real Event Visualization & 24–48h Shockwaves
Real events travel along actual modeled edges (`invoice.paid` → Invoice node → Client edge → Client Sun). 
- Major events trigger a 24–48 hour visual shockwave/illumination on the affected system.
- After 48 hours, the visual shockwave fades while the event remains permanently recorded in the append-only event log.
- Never invent relationship paths for event pulses.

### Prospect Transformation
Prospects appear as comets/emerging stars. On canonical conversion (`prospect → client`), the comet transitions into a Client Solar System role.

---

## 2.10 Constellations & Temporal Mode

### Constellations
Constellations are derived subgraphs interpreted spatially:
- **Structural Constellations:** Solid lines connecting canonical relationships.
- **Activity Constellations:** Animated lines for active interaction paths.
- **Cognitive Constellations:** Dotted/faint lines for Cognition-inferred associations.
- **Thresholds:** Deterministic threshold policies (minimum node count, structural coherence, relationship density). No random spatial proximity constellations; no hardcoded pre-saved templates (like Orion).

### Temporal Mode
Timeline scrubber controls (`Now`, `7 Days`, `30 Days`, `90 Days`, `1 Year`):
- Reconstructs actual historical universe states from append-only event history.
- Visually shows clients appearing, prospects converting, projects starting/ending, and invoices changing state over time.

---

## 2.11 Command Palette (⌘K)

One palette replacing `CommandPalette.tsx` and `/search`:
- **Objects** — `buildKnowledgeIndex()` → `packages/search.query()` → `navigation/routing.objectHref()`.
- **Commands** — `core/command-runtime.listCommands()` → `packages/commands.matchCommands()`.
- **Graph** — Focus node in the 3D Neural Core without navigating away.

Non-deterministic NL regex parsing is deleted. Mutations retain the strict preview → POST confirm path.

---

## 2.12 Component Strategy

Flat 50-component directory collapses into two tiers:

```text
components/
  primitives/   Button IconButton Badge Status Metric Entity EntityPreview
                Section Divider DataTable EmptyState Modal Drawer Tooltip
                Field Toast SkeletonBlock
  galaxy/       NeuralCore GalaxyCanvas GalaxyLegend ContextPanel AttentionColumn
                GodViewControl TemporalScrubber useGalaxyLayout useGalaxyCamera
  shell/        AppShell NavRail NavGroup MobileNav CommandPalette StatusLine
  feature/      (existing components, migrated surface by surface)
```

---

## 2.13 Motion Language

| Event | Duration | Easing |
|---|---|---|
| Hover / focus state | 120ms | `ease-out` |
| Panel open / drawer | 220ms | `cubic-bezier(.2,.8,.2,1)` |
| Camera fly-to node | 520ms | `cubic-bezier(.32,.72,0,1)` |
| Node activation | 300ms | spring, low bounce |
| Page transition | 180ms fade + 4px rise | `ease-out` |
| Destructive confirm | **0ms** | none — never animate a decision |

---

## 2.14 Accessibility & Mobile

### Accessibility Architecture
- **Parallel Semantic DOM:** Hidden `<ul>` tree of nodes with real links mirroring the 3D scene for screen readers and `Tab` navigation.
- **Live Regions:** `aria-live` announces real business events only; ambient/cosmetic motion is **never** announced.
- **Focus Rings:** 2px `--accent` focus ring with 2px offset.
- **Reduced Motion:** `prefers-reduced-motion` disables breathing, drift, particles, and camera motion, providing a static 3D/2D representation.

### Mobile Breakpoint Path
Below 768px:
- Simplified Galaxy LOD (Client/Project nodes prioritized).
- Reduced ambient visual effects.
- Attention column becomes a bottom sheet.
- **List View Fallback Toggle:** Provides 100% functional parity for touch targets.

---

## 2.15 Business Universe States & Background

- **Universe States:** Calm, Active, Attention Required, Syncing, Offline (communicated through quiet UI overlays, not Core color distortion).
- **Galaxy Background:** Procedural dark space (`#05070D`), subtle depth, galaxy dust texture (`#182033`), background stardust. Background is purely cosmetic and never represents business facts.

---

# PART THREE — GraphProjection, SpatialModel, and the adapter that already exists

**CORRECTED 2026-09-02.** This part previously read *"we introduce `GraphProjection`"*. A projection
adapter is already in the repository, and proposing to introduce it would have produced a second one.

## 3.1 What exists today

`graph-view/projection.ts` — the UI-facing graph read-model adapter, consumed by `app/page.tsx` as
`graphSource()`. Its own header declares it **TEMPORARY**, to be retired when GAP-1/2/3 of
`docs/GRAPH-CONTRACT.md` close and `packages/indexer` gains structural and event contributors. It is
a disposable adapter, explicitly not a source of truth, and the UI depends on `graph-view/contract`
rather than on it.

**Its hard rules already state most of what the approved specification requires**, and they are kept
verbatim rather than restated: no fs, no business computation, no persistence or module-level mutable
state, no writes or event emission, engines reached through Mission Control and never imported as
values.

**It is already authorization-bound, by construction rather than by intent.** It reads through
`core/crm`, `core/production`, `core/finance` and `core/events` — canonical readers which since 2G.1
slice 2 each require a capability at their own boundary. A caller without `clients:*` does not get a
filtered client list; the read throws. That is the right shape and it is why Part Zero's flow is a
formalization of what the data path already does, not a new mechanism.

**Two gaps, recorded rather than fixed here:**
- Its header cites `tests/architecture/graph-view.test.ts` as enforcing its hard rules. **That file
  does not exist.** The rules are currently held by review alone. A fitness rule is the correct
  remedy and belongs to the slice that first depends on those rules — not to this document.
- `app/page.tsx:39-40` wraps `graphSource()` in an unfiltered `.catch()` with no `unstable_rethrow`,
  over a chain that reaches `requireCapability("clients:*")`. It fails CLOSED (an empty graph, never
  another tenant's), but a capability refusal degrades to an empty universe rather than a denial.
  Recorded as §29.6e of `STAGE2G-CONTRACT.md`; the obstacle is that F54 forbids a page importing
  `@/core/auth/authority`, so the fix needs a helper under `lib/`. **Slice 1 must not inherit this
  pattern.**

## 3.2 The future shape

```text
Authorized Canonical Readers (core/{crm,production,finance}, lib/{documents,portal,audits}, core/events)
        ↓
GraphProjection      business truth, for THIS principal — nodes & edges across the EntityKinds
        ↓
SpatialModel         presentation-space data — sizes, kinds, parents, stable identity
        ↓
GalaxyLayout         spatial and orbital mathematics — radii, phases, inclination, collision
        ↓
3D Renderer          renders the resulting model, and nothing else
```

Each layer's responsibility is separate and stays separate. `GraphProjection` represents business
truth; `SpatialModel` represents presentation-space data; `GalaxyLayout` performs the mathematics;
the renderer renders.

### GraphProjection MUST NOT

- read the filesystem
- access environment variables
- fetch
- compute business facts
- import engines
- own authorization policy
- depend on React
- depend on Three.js

It CONSUMES an authorization decision made upstream (Part Zero). It does not make one — a projection
that owns policy is a second place authorization lives, which is exactly what Stage 2G removed.

### The renderer MUST NOT become a business-data source

Business data never depends on 3D coordinates. A coordinate is an output of the pipeline, never an
input to a business fact, and no business question may be answerable only by asking the renderer.

---

# PART FOUR — IMPLEMENTATION SEQUENCE, AND THE GATE THAT GOVERNS IT

## 4.1 The twenty slices

Recorded as the future implementation sequence. **They are sequential. None is authorized by the
approval of this document.**

1. `GraphProjection` — all required entity types
2. `SpatialModel` contract
3. Stable orbital hierarchy
4. `GalaxyLayout` / collision
5. 3D renderer
6. Ascend Core
7. Client systems
8. Project planets / rings
9. Moons / orbiting entities
10. Camera / LOD
11. Persistent user positioning
12. Real event pulses
13. 24–48h shockwaves
14. Constellation derivation
15. Temporal mode
16. God View
17. Direct navigation
18. Responsive / accessibility
19. Performance / visual QA
20. Final cinematic polish

## 4.2 The implementation gate

**Every future slice must:**

1. Re-read this approved proposal.
2. Inspect the existing architecture.
3. Preserve the authorization boundary (Part Zero).
4. Implement ONLY that slice.
5. Run relevant architecture / fitness tests.
6. Run `npm run typecheck`.
7. Run `npm run lint`.
8. Run relevant system tests.
9. Perform accessibility / visual verification where applicable.
10. Report exact files and behaviour changed.
11. **STOP before the next slice.**

**Approval of this proposal does NOT authorize implementation of multiple slices.**

---

# PART FIVE — THE TESTING AND QUALITY PRINCIPLE THIS WORK INHERITS

Carried forward from Stage 2G, where it was learned three separate times at real cost.

> **Tests must establish the actual property they claim to protect.**
>
> Do not use incidental measurements, arbitrary thresholds, timing assumptions, or counts as
> substitutes for the property itself — unless the threshold IS the contractual property.
>
> When a test is intended to establish a security or architectural invariant, prefer a
> **discriminating witness** or a **mutation-proven** assertion: one that would fail if the invariant
> were actually violated.

The three instances, because the pattern is easier to recognize than to describe:

| Substitute | What it actually measured | §  |
|---|---|---|
| "fails 11 tests", "2,198 bytes", a test count in a commit message | the state of the code on the day it was written | §29.6c |
| `expect(vaultDenied.length).toBeGreaterThanOrEqual(15)` | the size of the denial population under a role that later widened | §29.13 |
| `expect(ids).not.toEqual([...ids].sort())` | whether the machine appended ten log lines within one millisecond | §29.6h |

Each was true when written. Each stopped measuring its property without ever going red for the right
reason — and the third went red for the WRONG reason, intermittently, which is worse.

**What this means for the galaxy specifically.** A visual layer is unusually good at producing
assertions that look like evidence: a snapshot, a node count, a frame time, "it renders". None of
those establishes that the graph is scoped, that motion is tied to a real event, or that a
constellation derives from canonical structure. Each of those is a property with a discriminating
witness available — a principal whose universe genuinely differs, an event log with and without the
event, a subgraph that does and does not meet the threshold — and the witness is what the test must
use.

This is a design and testing principle to preserve. **It does not authorize a test refactor now.**

---

## Definition of Done — per slice, not for the whole redesign

Deliberately stated as properties rather than counts. Earlier versions of this document required
"all 218 unit & fitness tests pass" and "`1165+` tests" — figures that were accurate when written and
are wrong today (fitness alone is 199 tests; the phased gates run 1151 / 3 / 347). **A pinned count
is the substitute the principle above forbids**, and it would fail on the first slice that adds a
test.

A slice is done when:

- The phased gates are in their documented state — `gate:static`, `gate:server`, `gate:db` — with no
  NEW failure. The one permitted red is the environment assertion named in `STAGE2G-CONTRACT.md`
  §29.10; a second red means the slice is not done.
- `npm run typecheck` exits 0 and `npm run lint` reports no errors.
- Every fitness rule still holds. No rule was weakened, widened, or exempted to let the slice land.
- The slice's own property has a discriminating witness (Part Five), and the authorization boundary
  (Part Zero) holds for every surface the slice touches.
- Ambient cosmetic motion and real business events remain structurally distinct.
- The surface is keyboard- and screen-reader-operable via the parallel semantic DOM.
- The report names the exact files and behaviour changed, and stops.
