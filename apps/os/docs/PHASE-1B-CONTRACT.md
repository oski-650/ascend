# Phase 1B — active Galaxy phone access and failure recovery

Proposed contract. Owner said "go" on the slice on 2026-09-18; this document is the bounded
design that authorization applies to. Format follows the 1A contract in
`ASCEND-OS-V1-COMPLETION-MAP.md`, section "First proposed implementation contract — 1A".

## OBJECTIVE

Make the active Galaxy surface usable on a phone and honest when graphics fail: the business
directory and record context remain reachable when the scene cannot draw, and every failure mode
says which one it is.

## USER OUTCOME

An operator on a phone, on a machine with no WebGL, or on a device that has just lost its GL
context, can still find a client, open a record and reach its canonical page from `/galaxy`. They
are told what happened to the picture rather than shown a black rectangle.

## CURRENT STATE — evidence, not assumption

The active path is `app/galaxy/page.tsx` → `GalaxyClient` → `GalaxyStageMount`
(`next/dynamic`, `ssr: false`, `SurfaceLoading` fallback) → `GalaxyStage`.

1. **One boundary wraps everything.** `components/galaxy/GalaxyStage.tsx:284-329` puts a single
   `SurfaceBoundary` around the `<Canvas>`, the `system-labels` layer, `SystemExplorer` **and**
   `GalaxyControls`. Any throw inside replaces all of them with a centred text panel. The
   directory is lost at exactly the moment 1B exists to keep it — the inverse of the slice's
   stated outcome.
2. **The post chain is unwrapped.** The active boundary is passed no `fallback`, so a failure in
   `Effects` / `Lensing` costs the whole surface. The retired `GalaxyScene3D` did better:
   per-pass boundaries with `fallback={null}` at `GalaxyScene3D.tsx:974,987,1021`. The comment in
   `SurfaceBoundary.tsx` describing a reduced rendering for the post-processing pass now
   documents a capability the active stage does not use.
3. **No WebGL capability detection and no context-loss handling exist anywhere.** A grep for
   `contextlost`, `contextrestored`, `isWebGLAvailable` across `components/`, `app/`,
   `graph-view/` and `lib/` returns nothing; the only `getContext` calls are the retired 2D
   renderers. Context loss — routine on phones after backgrounding or under GPU pressure — is not
   a React render throw, so the boundary cannot see it. The canvas simply freezes or blanks, with
   no message and no recovery.
4. **UNVERIFIED, to be witnessed before it is designed around:** whether a failed GL context
   creation reaches React as a render throw (boundary catches it) or as an async error (boundary
   never sees it, surface goes blank). This determines whether detection must be explicit. No
   claim is made either way until it is observed in a browser.
5. **Reduced motion is implemented but unproven.** `GalaxyStage.tsx:164-186` reads
   `prefers-reduced-motion` once, feeds `effectiveTimeScale` and disables the motion controls;
   `app/globals.css:657` drops the toolbar transition. Nothing verifies it against the active
   renderer. The reduced-motion tests in `tests/ui/galaxy-surfaces.test.ts:650` exercise the
   **retired** 2D `GalaxyView`, not `GalaxyStage`.
6. **The active stage has no test coverage.** `galaxy-system-ui.test.ts` mounts `SystemExplorer`
   in isolation; `galaxy-focus.test.ts` covers the focus contract; `galaxy-surfaces.test.ts`
   belongs to the retired renderer. `GalaxyStage`, `SurfaceBoundary` and `GalaxyControls` are
   mounted by no test.
7. **Phone layout already exists and is not being redone.** `app/globals.css:769-807` is the
   Galaxy slice's phone cockpit, including a `(max-width:767px) and (max-height:500px)` landscape
   block; 1A added the timer reservation at `app/globals.css:248-272`, which the Galaxy bottom
   controls, directory and inspector all honour. 1B measures this at widths 1A did not
   (landscape, tablet) and corrects only what measurement shows to be wrong.

## DESIGN

- **Split the boundary.** The canvas gets its own boundary; `system-labels`, `SystemExplorer` and
  `GalaxyControls` move outside it. A graphics failure then costs the picture and not the
  business. The failure panel renders behind the operating UI rather than replacing it.
- **Wrap the post chain separately** with a reduced rendering, as the retired renderer did:
  losing bloom costs the glow, not the galaxy.
- **One degraded state, explicitly named**, covering: chunk in flight, context creation failed,
  context lost, context restored, and unsupported. Each says which it is, in words, on the
  surface. The directory opens by default whenever the scene is not drawing, so the surface is
  useful in the same gesture that explains itself.
- **Context loss is handled where it actually arrives**: `webglcontextlost` on the canvas element
  with `preventDefault()` so restoration is possible, `webglcontextrestored` to return to the
  scene, and the frame loop held off while lost.
- **Reduced motion gains verification, not behaviour.** No new preference handling; the existing
  single read stays the only one.

## RESPONSIVE BEHAVIOUR

- Phone portrait (320 / 390 / 430): directory and inspector remain reachable and scrollable above
  the toolbar and above any reserved timer band; controls stay thumb-sized.
- Phone landscape (667×375) and tablet (768): measured this slice. 1A left both unmeasured.
- Desktop (1440): unchanged. The split boundary must not move a single control.

## ARCHITECTURE

`GalaxyStage` remains the only component that asks environment questions, per its own
file-header rule. Degraded state is owned there and handed down as values. No change to the
projection, the spatial adapter, `buildSystemMap`, routing or any reader. The renderer continues
to receive records and canonical links and cannot widen access.

## INVARIANTS

- Authorization stays in middleware/request/DAL/SQL. A directory that survives a graphics failure
  shows exactly what the authorized projection already contained — no wider set, no different set.
- `?focus=` keeps its exact-identity rule: honoured only when the authorized projection contains
  that exact id, never parsed, never an oracle.
- No business writes. 1B is read-only.
- Existing artwork, palette, shaders, camera framing and the locked field of view are untouched.
- No new dependency, no styling framework, no Tailwind.

## LIKELY FILES

`components/galaxy/GalaxyStage.tsx`, `components/galaxy/SurfaceBoundary.tsx`,
`components/galaxy/GalaxyStageMount.tsx`, `app/globals.css` (bounded), and a new
`tests/ui/galaxy-stage-failure.test.ts`. `SystemExplorer.tsx` only if measurement demands it.

## NON-GOALS

Camera state lifecycle (3B). Retiring the old renderers or their tests (5A). Any change to
`/galaxy/next` beyond what already landed. Performance work (6A). New scene features or artwork.
Sales or production surfaces (1C).

## ACCEPTANCE CRITERIA

1. With WebGL unavailable, `/galaxy` still lists and opens records, and says why there is no
   picture.
2. A forced context loss leaves the directory usable, is stated on screen, and a restore returns
   the scene without a reload.
3. A throw inside the post chain costs the effect only; the scene and the directory survive.
4. A throw inside the scene costs the picture only; the directory and controls survive and remain
   operable.
5. Reduced motion holds the scene still, reports "Reduced motion", and leaves selection, the
   directory and every link working identically.
6. Directory, inspector, toolbar and any active timer remain reachable without overlap at
   320/390/430 portrait, 667×375 landscape, 768 tablet and 1440 desktop.
7. Desktop behaviour and all existing focus/permalink behaviour are unchanged.

## TEST PLAN

- Behaviour tests that mount the stage and drive it: boundary split (scene throw leaves the
  directory mounted and clickable), post-chain fallback, and the context-loss/restore reducer.
  Mutation-probe each rather than assuming it fails when the guard is removed.
- Rendered inspection against the authenticated service, as 1A did: WebGL disabled, context loss
  forced through `WEBGL_lose_context`, reduced motion emulated, at each viewport above.
- `gate:static` compared by name against the pre-implementation baseline; no new failure.

## ROLLBACK / RISK

Main risks: moving the explorer outside the boundary changes stacking and could alter z-order or
pointer-events; `preventDefault` on context loss without a restore path can leave a permanently
blank canvas; a degraded state that opens the directory could fight the existing
`directoryChoice ?? (!compact && !selectedId)` default. Each is a small reversible diff in one
file. No migration, no destructive action, no data involved.

## OPEN — owner decision before implementation

1. When WebGL is unavailable, should `/galaxy` stay on itself directory-first (recommended), or
   redirect to a non-graph route?
2. Should 1B also close 1A's outstanding rendered debt — landscape, tablet and a sales-principal
   session — inside this slice's verification pass? Recommended: yes, it is the same pass.
