# Ascend OS — UI/UX Redesign Proposal

**Status:** Approved · Phases 1–3 implemented (Neural Core slice). Phases 4–7 outstanding.
**Scope:** Presentation layer only. Vault → Core → Engines → Mission Control → API are untouched.
**Baseline verified:** `vitest run` → 212 passed at start; **218 passed after the slice** (6 new F17 rules).
Architecture fitness F1–F17 green; F14 tightened (its exemption was retired, not weakened).

---

## 0. What I inspected

`apps/os` — the OS is a separate Next.js 16.3 app (Tailwind 4, React 19, framer-motion, lucide) nested
inside the marketing site repo. It has its own `package.json`, `middleware.ts`, and test suite.

| Layer | Reality on disk |
|---|---|
| Vault | Real Obsidian vault at `ASCEND_VAULT_PATH`. 5 numbered folders + `.ascend-os/` JSONL sidecar. |
| Core | `core/{vault,crm,production,finance,events,knowledge,notifications,config,command-runtime}` — sole owner of fs + writes + event emission. |
| Engines | 11 pure engines. No fs, no env, no fetch, no module-level mutable state, no cross-engine imports — all machine-enforced. |
| Mission Control | 13 orchestrators. Assemble/invoke/order only; forbidden from computing, and forbidden from importing the graph (F11). |
| Packages | `domain` (pure kernel), `indexer` (KnowledgeIndex producer), `graph`, `search`, `commands`, `markdown`. |
| Surface | `app/` 22 routes, `components/` 50 flat components, `navigation/routing.ts`. |

**The architecture is genuinely good and genuinely frozen.** F1–F16 encode it as executable rules, including
two *named, narrow* exemptions for known violations (`app/dashboard/page.tsx` value-importing `rank`;
`lib/opportunities.readActiveClients`). Nothing in this proposal weakens, widens, or removes any of them.

---

# PART ONE — AUDIT OF THE CURRENT UI

## 1.1 Routes

| Route | Purpose | Verdict |
|---|---|---|
| `/` | `redirect("/dashboard")` | **REPLACE** — becomes the Neural Core |
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

`components/OrbitalDock.tsx` — a fixed 56px left rail of **12 unlabeled icons**, tooltip-on-hover only.
One entry (`Comms`) is `live: false` and links to `/crm` anyway. `Mission` and the logo both go to `/dashboard`.

**Weaknesses:** unlabeled icons force recall over recognition; 12 flat peers with no grouping means no
information architecture at all; a dead nav item ships in production; nothing communicates *where you are*
beyond a 6px dot.

## 1.3 Layout

`app/layout.tsx` renders, for an authenticated operator: `hud-grid` (fixed radial + 56px grid overlay),
`hud-aurora` (a 1200×600 blurred cyan radial bleeding from the top), `OrbitalDock`, `TopMetricStrip`,
`StopwatchWidget`, `CommandPalette`, `JarvisLauncher`, and a `max-w-7xl` centered main.

Two background treatments plus a glass panel system means **three simultaneous depth languages** competing
on every screen.

## 1.4 Information hierarchy — the core failure

`app/dashboard/page.tsx` is **647 lines** rendering **12 vertically stacked full-width panels**:

```
header → JARVIS hero → priorities → inbox → 6 KPI cards → active projects
→ portfolio health → hit list + heatmap → activity → insights → forecast
→ compliance → approvals → site quality → effort → pipeline → documents
```

Every one of them is `glass scanlines rounded-xl p-4`, every header is
`font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400` preceded by a pulsing dot.
Because everything is styled identically, **nothing is emphasised** — the ranked priority feed (the actual
output of the Decision Engine) has the same visual weight as the SOP template-compliance list.

The page also awaits 13 parallel reads and then **9 sequential `await`s** for the Mission Control
assemblers. That is 9 serialised round-trips to the filesystem on every load.

And it is the recorded F14 violation: it value-imports `rank` from `@/engines/decision-engine` and calls it
directly instead of going through `assemblePriorityFeed`.

## 1.5 Data actually available to the home page

All of this is already fetched and real — the problem is presentation, not supply:

`PriorityItem[]` (Decision-ranked) · `HealthTile[]` · `KpiCardModel[]` · `EventEnvelope[]` (activity spine)
· `Insight[]` · `Forecast[]` · `ComplianceReport[]` · `Approvals` · `SiteQuality` · `Effort` · `Pipeline`
· `Documents` · `Notification[]` · `ProductionState[]` · `Prospect[]` · time/streak/heatmap.

## 1.6 Visual system

`app/globals.css`, 139 lines, Tailwind 4 `@theme`:

- **Base:** `#030303` pure black, `#0a0a0d`, `#131318`; zinc borders at 30–40% alpha.
- **Accents:** cyan `#22d3ee` (primary) + violet `#a78bfa` ("system-processing") + red/green.
- **Type:** `ui-sans-serif, system-ui` — i.e. **no typeface decision was ever made**. Metrics render in
  the system UI font. `font-feature-settings: "ss01","cv01"` is set globally against fonts that don't have
  those features.
- **Effects:** `.glass` (16px backdrop-blur), `.glass-hi` (20px), `.scanlines`, `.hud-pulse`,
  `.chroma-pulse`, `.hud-aurora`, `.hud-grid`.

This is a **cyan-on-black sci-fi HUD** — precisely the aesthetic the brief rules out. `ScrambleTitle`
renders the literal string `"JARVIS  HUD"` with a text-scramble effect. The JARVIS greeting addresses the
operator as *"sir"*.

## 1.7 Typography — measured

There is no scale. Across the dashboard: `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`,
`text-base`, `text-2xl`, `text-3xl`. Labels are ~85% `font-mono text-[10px] uppercase tracking-[0.2em]`
regardless of importance. **9px uppercase mono at `tracking-widest` on `text-zinc-600` (#52525b) against
`#0a0a0d` is roughly 2.1:1 contrast** — well below WCAG AA, and it is used for real information
(compliance detail, forecast metric names, document lineage).

## 1.8 Responsive

`sm:` breakpoint only, in most places. The dock is `hidden sm:flex` with **no mobile replacement** — below
640px there is no navigation at all. Panels collapse to a single column and the dashboard becomes a ~6000px
scroll.

## 1.9 Interaction patterns

- `/console` and `/search` drive everything through **GET form submissions and full page reloads**.
  Architecturally clean (GET never writes; mutations are POST-confirmed), but it means every keystroke-to-result
  cycle is a navigation.
- `CommandPalette.tsx` (399 lines) is a *separate* client-side terminal with **its own regex NL parser**
  (`inferCommand`) mapping "show me X" → `/open X`. This duplicates `packages/commands.matchCommands` with a
  second, fuzzier, non-deterministic matcher — and it does not go through `core/command-runtime`.
- 50 components in one flat directory, no primitives layer. `KpiCard`, `MissionTile`, `OpportunityCard`,
  `PendingFiringCard`, `AuditClientCard`, `ClientCard` are six near-identical card implementations.

## 1.10 KEEP / REWORK / REPLACE

### KEEP — unchanged
- Every architectural layer below the surface, and all 16 fitness rules.
- `navigation/routing.ts` as the single entity→route owner (needs *extension*, not replacement).
- The Console's execution model: discovery ≠ execution; GET never writes; mutation = preview → explicit POST confirm.
- `middleware.ts` deny-by-default perimeter, and the layout's operator-only HUD gating.
- Server Components + `force-dynamic` + Server Actions for mutations.

### REWORK — good information, poor presentation
- Priority feed, health tiles, KPIs, activity stream, notification inbox, insights, forecasts, approvals,
  site quality, effort, pipeline, documents. All of these become **contextual**, surfaced against the graph
  or inside an entity's context, rather than 12 equal-weight stacked panels.
- Production phase ladder and checklists.
- Prospect scoring display.

### REPLACE — deleted outright
- The cyan/violet HUD token set, `.glass`, `.scanlines`, `.hud-grid`, `.hud-aurora`, `.chroma-pulse`.
- `OrbitalDock` (unlabeled icon rail).
- `ScrambleTitle` / `"JARVIS HUD"` / `JarvisOrb` / the "sir" voice.
- `CommandPalette.tsx`'s regex NL inference layer — replaced by `matchCommands` + `runCommand`, the
  deterministic matchers that already exist.
- `/search` as a distinct route.
- The 647-line dashboard.

---

# PART TWO — THE PROPOSAL

## 2.1 Design philosophy

Three principles, in priority order.

**1. The graph is the document, not the decoration.**
Most "graph views" are a picture *of* the data pasted next to the real UI. Here the graph *is* the index of
the business: it is how you find things, how you understand relationships, and where events land. If the
graph were removed, the product should stop working — not just look plainer.

**2. Every rendered pixel is a claim about the business.**
Ambient motion is the one exception, and it is therefore held to a strict rule (§2.8): ambient activity must
be *structurally* incapable of being mistaken for a business event, and must be labelled as such in the UI.

**3. Calm by default; loud only when earned.**
Nothing pulses, glows, or animates because it is "active." Emphasis is spent only on Decision-ranked
attention. Everything else is quiet, dense, and legible.

**What this is not:** not a card grid, not glassmorphism, not a Linear clone, not an AI product. There is no
gradient, no purple, no blur-behind-panel, and no sci-fi chrome in this design.

## 2.2 Visual direction — "Deep Field"

An **observatory instrument**, not a cockpit. The reference points are precision measurement equipment and
editorial data journalism: a deep, cool, non-black ground; thin structural rules instead of floating cards;
generous whitespace around a small number of very large numbers; and light used sparingly and physically.

Concretely, the shift from today:

| | Current | Proposed |
|---|---|---|
| Ground | `#030303` pure black + grid + aurora | `#0B0C0E` cool charcoal, one flat plane, no overlay |
| Containers | Blurred glass cards, everywhere | Hairline rules and negative space; a surface only when it must float |
| Accent | Cyan (state) + violet (system) | One warm accent, reserved *exclusively* for operator focus |
| Depth | backdrop-blur | Value steps + one shadow, used only on true overlays |
| Emphasis | Everything pulses | Only Decision-ranked items and live events |

## 2.3 Typography

**Recommendation: Geist Sans + Geist Mono**, via the `geist` npm package (Vercel; self-hosted, zero
build-time network — unlike `next/font/google`, it cannot break an offline build).

Why Geist over the alternatives:
- **Inter / Plus Jakarta / DM Sans** — the SaaS default. Correct, and instantly reads as "a dashboard."
- **Space Grotesk** — too much character in metadata; it fights information density.
- **IBM Plex Sans** — good, but its personality is IBM's, not Ascend's.
- **Geist** — engineered specifically for interfaces and code: true tabular figures, a genuinely matched
  mono, tight and confident at display sizes, neutral and quiet at 12px. The Sans/Mono pairing gives the
  editorial↔technical duality this product needs from *one* family.

**No editorial serif.** I evaluated it and am recommending against: Ascend OS is an instrument, and a serif
display face would import a magazine's warmth that fights the read. The editorial quality comes from **scale
contrast and whitespace**, not from serifs. (This is a reversible decision — it lives in one token block.)

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

**Minimum rendered size is 11px, and no text below `--text-2` in contrast.** The current 9px/#52525b
combination is deleted, not shrunk further.

**Numbers get the most attention.** Business metrics render at `metric-xl` in tabular figures with the unit
and the label set small and quiet beneath — the number is the object, the label is the caption.

## 2.4 Color

Semantic, restrained, and built on one rule that resolves the usual dashboard color mud:

> **Accent is a UI state (focus / selection / you-are-here). It is never a data value.
> Node color encodes entity *type*. Health encodes as ring + shape, never as fill hue.**

### Base
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B0C0E` | The single ground plane |
| `--surface` | `#111316` | Panels that genuinely float |
| `--surface-2` | `#171A1E` | Hover / nested |
| `--border` | `#22262B` | Hairline structure |
| `--border-strong` | `#2E343B` | Emphasis divider, input outline |
| `--text-1` | `#E8EAED` | Primary |
| `--text-2` | `#9BA3AC` | Secondary — **AA at 12px** |
| `--text-3` | `#6C757E` | Muted — **floor; nothing below this** |

### Semantic
| Token | Value | Meaning |
|---|---|---|
| `--accent` | `#E5A02C` *(Filament)* | **Operator focus only.** Selection, active nav, focus ring, real-event pulse. |
| `--accent-dim` | `#8A6220` | Accent at rest |
| `--good` | `#4FA88B` *(Jade)* | Healthy, paid, accepted, complete |
| `--risk` | `#E06C5A` *(Coral)* | At risk, overdue, blocked |
| `--info` | `#7C9CBF` *(Slate)* | Informational — **and ambient graph activity** |

There is deliberately **no separate "warning" hue.** The middle health band is rendered *neutral*, because a
project that is neither healthy nor at-risk genuinely is not an alarm. This removes the amber/accent
collision that makes most dark dashboards muddy, and keeps the palette to three semantic colors.

### Node types (8) — low chroma, matched luminance, no neon
`client #7FA8D0` · `project #79B89A` · `prospect #C9A15E` · `invoice #A98AC0` ·
`document #8E9AA6` · `sop #6E9E9E` · `approval #C98A8A` · `audit #9AA37F`

Distinguishable at 6px, none of them shouting, and none of them competing with Filament for attention.

### Non-color-only (§17)
Every status carries a second channel: health → ring thickness + a shape glyph; invoice status → a text
label; node type → the legend and the context panel's type row. Removing all color must not remove any
information.

## 2.5 Spacing, radius, shadow, border

- **Spacing:** 4px base — `4 8 12 16 20 24 32 40 56 72 96`.
- **Radius:** `2` (inputs/chips), `4` (buttons), `6` (panels), `10` (overlays). Full-round only for status dots.
- **Shadow:** exactly two. `elev-1` (`0 1px 2px rgb(0 0 0 / .4)`) and `elev-2`
  (`0 16px 48px -12px rgb(0 0 0 / .7)`), the latter only on the command palette and the context drawer.
  **No glow shadows in the DOM** — glow exists only inside the canvas, where it is physically motivated.
- **Border:** the primary structural device. 1px hairlines and dividers replace the card-with-background pattern.

## 2.6 Navigation architecture

Derived from the actual 22 routes, not from the hypothesis in the brief.

```
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

- **Labeled**, 208px rail, collapsible to a 56px icon rail (state persisted); group headers in `section-title`.
- Active route: `--accent` text + a 2px left bar. Recognition, not a 6px dot.
- **Mobile: a real drawer**, opened from a top bar — replacing today's "no navigation below 640px."
- `Comms` (dead link) is removed. `/search` folds into ⌘K. `/dashboard` redirects to `/`.

## 2.7 Home page — the Neural Core

The graph is the ground plane of the page; everything else floats over it with intent.

```
┌──────┬───────────────────────────────────────────────────────────────┐
│      │  ASCEND · NEURAL CORE          ⟨ metrics: 3 quiet numbers ⟩   │
│ nav  │  Thu 14 Aug · vault synced · 62 objects                       │
│ rail │                                                               │
│      │                    ●───────●                                  │
│      │      ┌──────────┐    ╲    ╱  ●        ← the graph IS the page │
│      │      │ ATTENTION│     ●──●                                    │
│      │      │  3 ranked│    ╱     ╲          ┌──────────────────┐   │
│      │      │  items   │   ●       ●─────●   │ CONTEXT          │   │
│      │      └──────────┘                     │ (on selection)   │   │
│      │                                       └──────────────────┘   │
│      │  ◦ ambient   ● live event   [legend]        ⌘K to search     │
└──────┴───────────────────────────────────────────────────────────────┘
```

**Five elements. Not twenty cards.**

1. **Header line** — identity, date, and a *system status* line stating plainly what is loaded
   (`62 objects · 41 relationships · last event 2h ago`). Three metrics maximum, from `buildKpiSummary`,
   set as quiet `metric` numbers on the top right. Not six KPI cards.
2. **The graph canvas** — full bleed behind everything, §2.8–2.10.
3. **The Attention column** (left, floating, max 3 items) — `PriorityItem[]` from
   `assemblePriorityFeed()`, rendered as thin editorial entries, not cards:

   ```
   01  PAYMENT RISK
       Tapia Tile & Marble
       Invoice #1042 is approaching overdue.

       WHY  ▸ invoice past due threshold
            ▸ health 61 · at risk
       [ Focus ]  [ Open client ]
   ```

   `Focus` flies the camera to that subject's node. **This is the load-bearing interaction of the whole
   design:** intelligence and graph are two views of one object, not two panels.
4. **The legend / activity key** (bottom left) — node types, and an explicit two-line statement of what
   ambient vs. real motion means. Not decorative: it is the honesty mechanism for §2.8.
5. **The context panel** (right drawer, on selection only) — §2.10.

Everything currently on the dashboard that is *not* one of these five moves to its own surface (Intelligence,
Finance, Production) where it has room to be read properly. Nothing is deleted; it stops being noise.

## 2.8 Graph behavior — ambient vs. real

**Layout.** Force-directed, deterministic: initial positions seeded from a hash of the node id, so the same
vault always produces the same layout across reloads. Forces: pairwise repulsion, edge springs, weak
centering, plus **per-type radial banding** (clients toward the core, artifacts outward) so the result reads
as structure rather than a hairball. Simulation cools to a fixed point and stops.

**Idle / breathing.** Once cooled, each node drifts on its own low-amplitude sinusoid — amplitude ≈ 1.2px,
period 4–9s, phase derived from the node id hash. Relationships are preserved exactly; nothing re-flows.
Edges carry a very faint opacity shimmer. The graph is alive; it is not moving.

**The two classes of activity — structurally distinguished, not just styled differently:**

| | **AMBIENT** | **REAL EVENT** |
|---|---|---|
| Source | rAF timer | `EventEnvelope` from `core/events` |
| Color | `--info` slate, 25% opacity | Entity-semantic + `--accent` |
| Path | **one** edge, endpoint to endpoint | **2–4 hops** along a real relationship path |
| Nodes | **never illuminated** | each node illuminates as the pulse arrives |
| Ticker | **no entry** | writes a line: type, subject, timestamp |
| Frequency | ≤1 in flight, ~8s apart | exactly when an event exists |
| Sound/label | — | announced to screen readers via a live region |

An ambient particle is incapable of doing the three things a real pulse does (multi-hop, illuminate, log).
A user cannot mistake one for the other, and the legend states the distinction in words.

**Real pulses are traced over real edges only.** `invoice.paid` → the invoice node → its `client` edge →
the client node. If a relationship does not exist in the model, no pulse is drawn. No path is invented.

**`prefers-reduced-motion`:** drift off, shimmer off, ambient particles off entirely, camera transitions
become instant. Real events render as a 600ms static highlight and a ticker line — **the information is
fully preserved**, only the motion is removed.

## 2.9 Rendering technology

**Canvas 2D, no new rendering dependency.**

Justified by measurement, not preference. The real vault contains: 3 clients · 3 projects · 15 phases ·
6 prospects · 5 documents · 8 invoices · 3 approvals · 12 audits · 6 live opportunities = **91 nodes /
85 relationships**, measured (not estimated) against the real vault.

- **SVG/DOM** — 91 nodes × 60fps of transform churn is the one option that genuinely doesn't scale. Rejected.
- **WebGL** — solves a problem (10k+ nodes) that this product does not have, at the cost of a large
  dependency, shader code, and a much harder accessibility and text-rendering story. Rejected as over-engineering.
- **A graph library** (d3-force, cytoscape, sigma) — d3-force is 30KB for a force simulation that, at
  n ≈ 91, is ~90 lines of arithmetic. The brief forbids unjustified dependencies. Rejected.
- **Canvas 2D + a hand-written force simulation** — one element, DPR-aware, full control of the visual
  language (the design *is* the differentiator here), zero new deps.

Performance discipline: rAF halts entirely when cooled + idle + not interacting; `shadowBlur` is banned in
the draw loop (node glows are pre-rendered radial-gradient sprites, cached per type/size); repulsion is
O(n²) with a guard that switches to grid-bucketed neighbor search above n = 400.

## 2.10 Interaction model

| Action | Desktop | Touch |
|---|---|---|
| Pan | drag background | one finger |
| Zoom | wheel / trackpad, 0.4×–3× | pinch |
| Inspect | hover → node + edges highlight, rest dims to 25% | (no hover) |
| Select | click → camera eases in, neighborhood at full opacity, context panel opens | tap |
| Move | drag node → pins it; double-click unpins | long-press then drag |
| Deselect | `Esc` | tap background |
| Traverse | `Tab` / `Shift+Tab` cycles nodes in deterministic order; `Enter` selects; arrows step to neighbors | — |
| Search | `/` focuses graph search; `⌘K` opens the palette | button |

**Context panel** (on selection):

```
CLIENT                                    ●
Tapia Tile & Marble Co.

HEALTH        87   ▰▰▰▰▰▰▰▰▱▱  on track
PROJECTS       1
OPEN INVOICES  0
SIGNALS        3
OPPORTUNITIES  2

RELATIONSHIPS
  → Project · Website Rebuild        phase 4/5
  → Invoice #1042                    $1,250 · paid
  → Document · SOW v2                accepted

[ Open client ]                    [ Focus neighborhood ]
```

Every number shown is produced by its existing owner (`computeHealthScore`, `core/finance`,
`assembleFiringSignals`, `detectOpportunities`). **The panel computes nothing.**

**Mobile is a deliberate design, not a shrink.** Below 768px: the graph renders the client/project/prospect
subgraph only (~25 nodes), ambient motion is off by default to protect battery, the attention column becomes
a bottom sheet, and a **list view toggle** gives full parity — because a 6px node is not a touch target.

## 2.11 Command palette (⌘K)

One palette, replacing both `CommandPalette.tsx` and `/search`, and built on the deterministic matchers that
already exist:

- **Objects** — `buildKnowledgeIndex()` → `packages/search.query()` → `navigation/routing.objectHref()`.
- **Commands** — `core/command-runtime.listCommands()` → `packages/commands.matchCommands()`.
- **Graph** — a third face unique to Ascend: *focus this node in the Neural Core* without leaving the page.

**The regex NL inference layer is deleted.** `matchCommands` is deterministic, tested, and already the
declared owner of matching; a second fuzzy matcher in the client is exactly the duplicate-logic pattern the
architecture forbids.

**Mutations keep the existing gate, unchanged:** discovery never executes; `preview` (read-only) → explicit
POST confirm → `execute`. The palette renders the preview and a confirm affordance. It does not invent a
fast path.

## 2.12 Component strategy

Replace the flat 50-component directory with a two-tier structure. Six near-identical card components
(`KpiCard`, `MissionTile`, `OpportunityCard`, `PendingFiringCard`, `AuditClientCard`, `ClientCard`) collapse
into `Metric` + `Entity` + `Section`.

```
components/
  primitives/   Button IconButton Badge Status Metric Entity EntityPreview
                Section Divider DataTable EmptyState Modal Drawer Tooltip
                Field Toast SkeletonBlock
  graph/        NeuralCore GraphCanvas GraphLegend ContextPanel AttentionColumn
                useGraphSimulation useGraphCamera useGraphInteraction
  shell/        AppShell NavRail NavGroup MobileNav CommandPalette StatusLine
  feature/      (existing components, migrated surface by surface)
```

Primitives are built **first** (Phase 2), against tokens only — no feature knowledge, no data fetching.

## 2.13 Motion language

| Event | Duration | Easing |
|---|---|---|
| Hover / focus state | 120ms | `ease-out` |
| Panel open / drawer | 220ms | `cubic-bezier(.2,.8,.2,1)` |
| Camera fly-to node | 520ms | `cubic-bezier(.32,.72,0,1)` |
| Node activation | 300ms | spring, low bounce |
| Page transition | 180ms fade + 4px rise | `ease-out` |
| Destructive confirm | **0ms** | none — never animate a decision |

Framer Motion is already a dependency and stays for DOM motion; canvas motion is hand-written rAF.
**Nothing loops in the DOM.** No `.hud-pulse`, no `.chroma-pulse`, no scanlines.

## 2.14 Accessibility

- The canvas has a **parallel hidden semantic list** (`<ul>` of nodes with real links) that is the actual
  Tab order — the graph is operable with zero canvas interaction.
- `role="application"` + `aria-activedescendant` on the canvas; every selection announced via `aria-live`.
- Real-event pulses announce to the live region; ambient activity **never** does.
- Focus visible everywhere: 2px `--accent` ring, 2px offset. No `outline: none` without a replacement.
- Contrast floor `--text-3` (`#6C757E` on `#0B0C0E` ≈ 5.1:1). The 9px/2.1:1 combination is gone.
- Full `prefers-reduced-motion` path, per §2.8, preserving all information.

---

# PART THREE — MISSING CAPABILITIES (documented, not silently built)

The brief requires the graph to be **real**. It cannot be, today. Here is exactly what is missing.

### GAP-1 · The KnowledgeIndex covers 3 of 25 entity kinds
`core/knowledge/index.ts` discovers **clients, prospects, and SOPs** only. `domain.EntityKind` declares 25
kinds. Projects, phases, invoices, documents, approvals, audits, tasks, and care plans have **no nodes**.

### GAP-2 · Only `wikilink` edges are produced
`packages/indexer.graphContributor` emits one node per object and one edge per wikilink. The type comment
declares `kind ∈ wikilink | structural | event`, and the code comment says *"(Structural edges are additive
later.)"* — **the structural and event contributors were designed but never built.**

### GAP-3 · `buildIndex` receives events and discards them
```ts
export function buildIndex(objects, events): KnowledgeIndex {
  void events; // reserved linkage point — intentionally unused in V1
```
The declared linkage point for event-derived edges is unimplemented. Real-event pulses (§2.8) need it.

### GAP-4 · No event → node resolution
`EventSubject.entity_id` is a slug or a UUID. For the 22 entity kinds with no nodes, there is nothing to
resolve an event *to*. A pulse for `invoice.paid` has no invoice node to start from.

### GAP-5 · `navigation/routing.ts` routes 2 of 25 kinds
`prospect → /sales/:id`, `client → /production/:id`, everything else `null` (correctly rendered
non-navigable). Most nodes in a full graph would be un-openable — which undercuts §9 of the brief
("make it obvious how to move from graph exploration into operational work").

### The adapter that is needed

A **`GraphProjection`** that produces `{ nodes, edges }` covering the entities above, built **only** from
existing canonical readers — `core/crm.listClients`, `core/production.listProductionStates`,
`core/finance`, `lib/documents.listDocuments`, `lib/portal`, `lib/audits`, `core/events.readEvents` —
performing **no filesystem access of its own** and **computing no business facts**. Every edge it emits must
be a foreign key that already exists on disk:

```
client ──has──▸ project ──has──▸ phase ──has──▸ task
client ──billed──▸ invoice          client ──owns──▸ document
client ──awaits──▸ approval         client ──measured──▸ audit
prospect ──promoted_to──▸ client    (structural_meta.promoted_from_prospect)
* ──wikilink──▸ *                   (from the existing KnowledgeIndex)
```

**Two possible homes, and this is the one decision I need from you:**

| | **A · Presentation-layer projection** | **B · Close GAP-1/2/3 in the indexer** |
|---|---|---|
| Location | new `graph-view/`, a sibling of `navigation/` | `core/knowledge` discovery + new indexer contributors |
| Nature | additive, reversible, zero risk to frozen layers | the architecturally *correct* long-term home |
| Fitness rules | touches none — F11 names only `engines` and `mission-control` | touches the frozen Phase 4.1–4.4 index contracts |
| Cost | ~1 day | ~3–4 days, and it modifies a frozen layer |
| Risk | an interim module that must later be retired | changing a frozen contract before the UX has proven what it needs |

**My recommendation: A now, B later.** Build the projection as an explicitly-labelled, presentation-layer,
read-only module for the first slice. It proves what the UX actually requires from the graph. Then close
GAP-1/2/3 properly in the indexer, with the projection's contract as the specification, and delete the
projection. Doing B first means freezing new contracts into `packages/indexer` before a single user has
touched the graph — which is how the current 12-panel dashboard happened.

Whichever you choose: **no fake nodes, no fake edges, no fake events.** If the vault has 57 objects, the
graph shows 57 objects.

---

# PART FOUR — IMPLEMENTATION PLAN

| Phase | Deliverable |
|---|---|
| **1** ✅ | Audit + this proposal |
| **2** | Design system: `geist`, tokens, `globals.css` rewrite, `components/primitives/`, `AppShell` + `NavRail` |
| **3** | **Neural Core** — `GraphProjection`, `GraphCanvas`, attention column, context panel, ⌘K |
| **4** | Vertical workflow: Neural Core → Client → Project → Intelligence |
| **5** | Remaining surfaces: Finance, Production, Pipeline, Documents, Signals |
| **6** | Responsive + accessibility pass |
| **7** | Visual QA, performance profiling, reduced-motion verification |

## The first vertical slice

**ASCEND NEURAL CORE** — the new `/`, end to end, at production quality:

1. `geist` + the full token layer + the primitives the Core needs (`Button`, `Badge`, `Status`, `Metric`,
   `Entity`, `Section`, `Drawer`).
2. `AppShell` + labeled `NavRail` + mobile drawer, replacing `OrbitalDock`.
3. `GraphProjection` — real nodes and edges from canonical readers only.
4. `GraphCanvas` — Canvas 2D, deterministic force layout, breathing idle, ambient particles, real-event
   pulses from `core/events`, pan/zoom/hover/select/drag, reduced-motion path, hidden semantic list.
5. Attention column wired to `assemblePriorityFeed()` — **via Mission Control, which also retires the
   recorded F14 violation** rather than carrying it forward.
6. Context panel wired to existing owners.
7. `/dashboard` → `/`.

**Explicitly not in this slice:** every other route keeps its current UI and keeps working. No engine, core,
vault, or Mission Control file is modified. No fitness rule is touched.

**Definition of done:** `vitest run` still green at 212 passed; `tsc --noEmit` clean; the Core renders the
real vault; ambient and real activity are visually and structurally distinguishable; the whole page is
operable by keyboard alone; `prefers-reduced-motion` loses motion and no information.

---

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| **A small vault looks like an empty graph.** 3 clients is not a neural network. | Full structural coverage yields ~57 nodes / ~110 with tasks — genuinely dense. The honest answer to sparsity is more real data, never generated data. |
| **The interim projection becomes permanent.** Every "temporary" adapter does. | It ships with an explicit retirement condition written into the module header, referencing GAP-1/2/3. Recommend a tracking item. |
| **Canvas is invisible to assistive tech.** | The parallel semantic list is a *requirement* of the slice, not a follow-up. Non-negotiable in the definition of done. |
| **Ambient motion misleads.** The single worst failure this design could have. | Structural separation (§2.8), not just styling — ambient literally cannot illuminate, multi-hop, or log. Plus a written legend. |
| **Beauty at the cost of performance.** | Pre-rendered sprites, no `shadowBlur`, rAF halts when idle, hard n=400 threshold. Profiled in Phase 7. |
| **A big-bang redesign strands the app half-migrated.** | Strict vertical slices. Every other route keeps working untouched after each phase. |
| **Losing something good in the current UI.** | The Console's execution model, the deny-by-default perimeter, and Server Components + Server Actions are explicitly in KEEP and carry forward unchanged. |

## What this proposal does not do

No vault rewrite · no core rewrite · no engine rewrite · no business logic in components · no bypassing
canonical readers · no second source of truth · no weakened or disabled fitness tests · no modified frozen
responsibilities · no AI/agent infrastructure · no unjustified dependencies.

One dependency is added: **`geist`** (a self-hosted typeface). That is the entire delta.