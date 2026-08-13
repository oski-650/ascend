# `domain/` — the Ascend OS shared kernel

The pure vocabulary every layer speaks: branded ids, canonical entities, lifecycle
enums, controlled vocabularies, and the event contract. Corresponds to `packages/domain`
in the architecture roadmap (Parts I–V).

## Purity contract (load-bearing)

Nothing under `domain/` may import `node:*` / `fs`, vault paths, Next.js, React,
a database client, or any `@/core` · `@/lib` · engine · agent module. Entities, ids,
enums, invariants, and event **types** only — safe for server, client bundles, CLI, MCP.

> Today this is enforced by discipline + code review. A fitness-function lint rule
> (e.g. `no-restricted-imports` scoped to `domain/`) should land before many hands
> touch this package. Until then: **if you're about to add an import here, stop.**

---

## Tracked transition A — relocate to `packages/domain`

**Status:** deferred (accepted deviation, Phase 1).

- **Current:** lives at `apps/os/domain/`, imported as `@/domain`.
- **Why not `packages/` yet:** this repo is a single Next app, not a monorepo — no
  `packages/` workspace, no workspace tooling. Roadmap **Principle 6** ("extract on the
  second consumer, not the first") says defer the physical package until a second
  deployable needs the kernel.
- **Trigger to relocate:** the first time a **second consumer** (client portal app,
  CLI, or MCP server) needs this kernel *without* pulling in `apps/os`.
- **Steps when triggered:** stand up workspace tooling → move `apps/os/domain` →
  `packages/domain` → add tsconfig project references → replace `@/domain` specifiers
  with the package name. The purity contract already holds, so **the kernel's own code
  does not change** — only import specifiers and build wiring.
- **Risk:** mechanical/low. Guaranteed zero logic change because purity is already satisfied.

---

## Tracked transition B — brand the foreign-key fields

**Status:** deferred (accepted deviation, Phase 1). Do **not** implement in Phase 1 —
it complicates the strangler migration before a consumer needs it.

- **Current:** cross-entity FK fields are typed `string`, not branded — e.g.
  `TimeEntry.client`, `Invoice.client`, `*.client_slug`, `DocumentFrontmatter.doc_id`.
  The branded id/slug **types already exist** in `ids.ts` (`ClientId`, `ClientSlug`, …)
  but are not yet applied to record fields.
- **Why deferred:** applying branded FKs requires the `core/crm` slug↔id resolution
  layer (Phase 2). Forcing it in Phase 1 would demand casts at every read boundary and
  add churn with no consumer yet depending on it.
- **Transition plan (phased):**
  1. **Phase 2 (when `core/crm` lands):** brand FKs at the **`core/*` read boundary** —
     `core` casts raw disk strings to `ClientSlug`/`ClientId` as records enter the domain
     (`asClientSlug`/`asClientId`). On-disk records stay raw, readable strings (D1: vault
     legibility). Branding is an in-memory boundary concern, not a storage format change.
  2. **Enforce:** flip the entity field types `string → ClientSlug/ClientId`, then let
     `tsc` surface every unbranded use; fix each at the boundary (never launder an
     `unknown`/`string` mid-flow).
  3. **Trigger to complete:** the first engine (Health/Opportunity, Phase 2) that
     consumes client references — the "second consumer" that justifies enforcement.
- **Definition of done:** no `string` FK fields remain on domain entities; every
  cross-entity reference is branded; the *only* place a raw string becomes a branded id
  is a `core` boundary caster.
- **Guardrail:** a planned lint rule flagging new `string`-typed fields named
  `client` / `*_id` / `*_slug` on domain entities.
