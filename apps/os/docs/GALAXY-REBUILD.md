# Ascend OS Brain — A Living Galaxy

**Design revision: September 15, 2026**  
**Routes:** `/galaxy` and `/galaxy/next` share the authorized business view.  
**Direction:** true black space, moving systems, useful records.

## The experience

The galaxy is an entrance into Ascend OS. A client is a star. Its projects orbit as planets. Documents and invoices become satellites, with their actual ownership preserved. Prospects occupy an outer asteroid belt until a stored conversion connects them to a client.

The opening frame reveals the business at a glance. Selecting a client flies into its system, dims the atmospheric galaxy and reveals its projects and satellites. The inspector shows existing status, metadata and links into the OS. Search offers a direct route when exploring space would take too long.

## Visual language

| Element | Treatment |
|---|---|
| Background | Pure `#000000`; no full-screen gradient or grain |
| Ambient galaxy | Cool spiral stars, restrained rose emission, warm core |
| Client | Warm star with animated surface granulation and limb darkening |
| Project | Blue planet, subtle atmosphere and orbital guide |
| Document / invoice | Smaller satellites with distinct colors and readable labels |
| Prospect | Instanced asteroid in the outer belt |
| Selection | Thin outline, prioritized label, camera follow and inspector |
| Interface | Warm white text, quiet translucent black panels, restrained borders |

Atmospheric stars are decoration; they have no record identity and cannot be selected. Business counts come from the supplied records. No fabricated revenue, health scores or activity indicators.

### Black-hole correction

The shadow and disk now share one centered camera-relative frame. The disk has a local tilt and two halves: the far half renders behind the capture shadow; the near half renders in front. This makes the disk cross the lower shadow instead of leaving the black hole apparently floating above it. A broad Fresnel shoulder shades the complete circumference with a warm key and cool fill, while the centre remains true black. The thin photon ring and slope-preserving lensing remain.

This is an artistic layered approximation, not a relativistic ray tracer.

## Record hierarchy

| OS record | Galaxy role | Relationship |
|---|---|---|
| Client | Star / sun | Center of a business system |
| Project | Planet | Orbits the client connected by `has_project` |
| Document | Moon / satellite | Uses its existing ownership relationship |
| Invoice | Moon / satellite | Uses its existing billing relationship |
| Approval / audit / active care plan | Operational satellite | Orbits the client named by its stored relationship |
| Prospect | Asteroid | Removed from the belt when a valid `promoted_to` edge identifies its client |
| Task, phase and other records | Inspector / directory entries | Remain available without inventing additional planets |

### Ownership is explicit

The current projection connects documents and invoices to clients, rather than directly to projects. When a client has exactly one project, its satellites are displayed beside that project, and the inspector explicitly explains that this is visual placement, not inferred project ownership. With multiple projects, these satellites orbit the client.

Unowned or ambiguous records remain in the directory. They are never assigned to whichever star happens to be closest. Additional file types will need an authorized projection entry and a canonical destination before becoming actionable galaxy records.

### Current live inventory

The production stores currently contain **6 clients**, **6 projects**, **30 phases**, **43 open tasks**, **2 invoices**, **3 approvals**, **5 audits**, and **3,108 prospect records**. One stored prospect has a valid conversion and is suppressed from the belt, so the current opening view shows **3,107 prospect asteroids**. The document vault currently has no document records beyond its README, so the live galaxy correctly shows no document moons yet. These counts are an inventory snapshot, not hard-coded UI data; the route rebuilds them from the authorized readers.

## Navigation and controls

- **Select a star:** reveal its system and fly to it.
- **Select a planet or satellite:** focus the body, follow its orbit and show its record.
- **Open record:** follow the existing canonical OS destination. Invoices open Finance because there is no individual invoice route.
- **Breadcrumbs / Escape:** ascend the record hierarchy. Escape does not intercept typing in a search field.
- **Directory:** search labels, types and status; filter Clients, Projects, Prospects, operational Records or All records. Results paginate in groups of 40.
- **Link to this view:** create a `/galaxy?focus=...` link. The server honors only exact IDs present in the authorized projection.
- **Live refresh:** the app rebuilds the authorized projection every 60 seconds while visible, catches up when the tab regains focus, and also offers a manual refresh.
- **Overview / Core:** fly to the opening composition or black-hole close-up.
- **Pause / Play, 1× / 24×:** control orbital time without resetting phase.
- **Auto orbit:** optional camera motion; direct manipulation cancels it.

Camera flights last 1.8 seconds and can be interrupted. Focus follows the actual moving body. Only the selected client system expands into detailed planets and satellites. Labels are collision-culled and limited; the directory remains the reliable route to every record.

### Prospect conversion

The inspector opens the existing pipeline workflow. After a successful conversion is present in refreshed data, the old asteroid is suppressed and selection resolves to the corresponding client star. The galaxy does not create clients or invent conversion events. An elaborate ignition animation is not implemented.

## Responsive and accessible behavior

Desktop uses a side inspector. Phone uses a scrollable bottom sheet; focus shifts upward and zooms out to keep the body above it. Opening the directory on compact screens hides the inspector until a selection is made.

Buttons expose accessible names and selected states. Search and record lists provide keyboard alternatives to canvas picking. Reduced-motion preferences freeze autonomous animation and make requested camera changes immediate. Hidden tabs stop rendering. Device pixel ratio and atmospheric star counts are bounded by quality tier.

## Architecture

```text
guarded readers → GraphProjection → SpatialModel → SystemMap → GalaxyClient → GalaxyStage
```

- `graph-view/field/systems.ts`: deterministic role mapping, hierarchy, placement, orbit tracks and focus bounds; no I/O.
- `app/galaxy/page.tsx`: authorization-preserving gathering and exact focus-ID validation.
- `app/galaxy/GalaxyClient.tsx`: app-owned automatic, focus and manual refresh seam.
- `components/galaxy/GalaxyStage.tsx`: scene composition, selection, quality and playback.
- `components/galaxy/SystemExplorer.tsx`: directory, breadcrumbs, record inspector and links.
- `components/galaxy/scene/BusinessBodies.tsx`: nested orbital groups, instanced asteroids, body registry and projected labels.
- `components/galaxy/scene/SunSurface.tsx`: animated client-star material.
- `components/galaxy/camera/OrbitRig.tsx`: cancellable flights, body following and panel-aware framing.
- `components/galaxy/scene/GalacticCore.tsx`: centered, layered black-hole assembly.
- `app/globals.css`: scoped galaxy interface styling.

The renderer receives already-authorized records. It cannot query the database, resolve a principal or grant permissions. Read failures propagate to the application boundary; outages are not silently represented as an empty business. Both galaxy routes use the same capability demands. Galaxy is listed in the Command navigation.

The previous graph renderer and homepage Neural Core remain in the repository. This change does not retire those surfaces or alter their data semantics.

## Verification and limits

- Final targeted lint is clean.
- Focused architecture, black-hole, field, hierarchy and inspector suites: **343 tests passed**.
- TypeScript passed with duplicate generated `.next/types/* 2.ts` files excluded by a temporary review configuration. Those pre-existing generated duplicates still block the ordinary typecheck; they were not modified.
- The authenticated live route was checked with the actual 6-client, 6-project and 3,107-active-prospect projection.
- Desktop (1440×900) and phone (390×844) system framing visually checked; Escape ascended from project to client.
- Core close-up visually checked after the full-rim correction. Browser logs contain no shader errors; the existing Three.js Clock deprecation warning remains.
- The source-component preview is isolated from live business data. Its sample conversion button exists only in the temporary preview harness.
- The authenticated real-data development route is `http://localhost:3001/galaxy`. No credentials, permissions or records were changed during visual verification.
- Earlier static regression baseline: 1,712 passed, 9 skipped, one environment-gate failure requiring database/render proof variables. This is not a claim of a successful full deployment gate.
- Sustained performance profiling, a browser reduced-motion check, and authenticated shell verification remain outstanding. Very large single-client systems need measured detail budgets before making scale guarantees.

## Design principles to retain

### Core visual rebuild — September 16

Removed the broad circular dimming veil and ambient amber wash around the core. Only the central shadow and disk material now occlude background stars; the bright rim, curved light and camera-dependent disk remain. Shader lint passed. Final visual verification of this halo removal requires signing into the current development preview on port 3003; port 3001 is serving the older renderer.

The active `GalacticCore` now uses `shaders/black-hole.ts`, a single composited optical image replacing the separate disk, capture, shoulder and ring meshes. A tilted accretion disk crosses the lower shadow; a compressed upper arch and softer lower arc connect both sides. Animated radial filaments follow the existing motion speed and pause controls. The shader uses premultiplied emission, a black occluding center and derivative-based smoothing at overview distances. This is a stylized lens image, not a physical ray-traced simulation.

The disk now has a fixed world-space normal projected into the camera view, so camera orbit changes its apparent inclination and rotation. A warm underside, animated filaments and asymmetric lighting add depth while retaining the compact outer radius. The optical image remains a shader approximation rather than volumetric ray tracing. Visually verified from the default Core view and a dragged camera angle; ESLint passed.

Verified in the live overview and Core close-up; ESLint and 33 black-hole/system tests passed during the initial rebuild. Client, project and prospect visuals and data behavior are unchanged.

1. Black is part of the composition. Glow must belong to a body or cloud.
2. Every selectable object must correspond to a record and useful destination.
3. Visual arrangement must not fabricate business ownership.
4. Camera framing must account for the inspector, including portrait screens.
5. Background atmosphere should recede when the operator is doing work.
6. Keep orbital construction deterministic and outside the renderer.
7. Preserve logarithmic depth, ACES tone mapping and bounded rendering quality.
8. Never mistake a beautiful sample preview for verified live data integration.
