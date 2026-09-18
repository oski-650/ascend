# Phase 1B — active Galaxy phone access and failure recovery

**ACCEPTED by the owner on 2026-09-18.** The implementation matches the intended
failure-containment architecture and the browser evidence was judged sufficient for this slice. The
seven items in §6 are accepted as CARRIED VERIFICATION DEBT — explicitly open, not closed.

Implemented 2026-09-18 against `docs/PHASE-1B-CONTRACT.md`, with the owner's two decisions:
degrade directory-first on `/galaxy` without redirecting, and fold 1A's remaining rendered debt
into this browser pass as verification rather than new design scope.

Baseline: tree clean at `41db118`, whose own gate line was 1,746 passed / 9 skipped / 1 failed.

## 1 · Files changed

| File | Change |
|---|---|
| `components/galaxy/surfaceState.ts` | NEW. The five-state vocabulary, the transition precedence, the notice text, and `detectWebGL`. |
| `components/galaxy/GalaxyNotice.tsx` | NEW. The words on screen, in the cockpit, outside every boundary. |
| `components/galaxy/GalaxyStage.tsx` | Boundary split; capability probe gating `<Canvas>`; context loss/restore listeners; per-pass boundary around `Effects`; cockpit moved outside the renderer boundary; labels held back when not drawing. |
| `components/galaxy/SurfaceBoundary.tsx` | `onFailure` notification from `componentDidCatch`; `children` made optional. |
| `components/galaxy/GalaxyControls.tsx` | Motion controls disabled and status truthful when the scene is not drawing. |
| `components/galaxy/SystemExplorer.tsx` | `degraded` opens the directory on itself; an explicit choice still wins. |
| `app/globals.css` | Canvas hidden in every non-drawing state; `.galaxy-notice` placement at phone, landscape, tablet/small-desktop and desktop; the notice reserves against 1A's timer band. |
| `tests/ui/galaxy-stage-failure.test.ts` | NEW. 23 tests on the shipping renderer. |
| `tests/architecture/gate-2g1.ts` | The new suite classified NOT_APPLICABLE/static with its reason. |

Nothing else was touched. The temporary fault injection used for the rendered evidence was removed
before the acceptance build; `grep -rn "Fault\|__fault" components/galaxy/` returns nothing.

## 2 · Failure containment after the change

```
/galaxy route                     authorized projection; permalink honoured by exact id
└── DOM cockpit                   directory, inspector, notice, controls   ← outside every boundary
    └── renderer boundary         onFailure → "failed"; fallback null
        └── <Canvas> + scene      mounted ONLY after the capability probe says yes
            └── post-chain boundary   fallback null — costs the effect, not the galaxy
```

The two rules that make it work, both forced by what the browser actually did:

- **Detection, not catching.** A failed context creation throws OUTSIDE React. No boundary can see
  it, so `<Canvas>` is not mounted until `detectWebGL()` has answered. An effect alone would have
  been too late — a child's effects run before its parent's.
- **One owner of recovery.** three.js already `preventDefault`s `webglcontextlost` and rebuilds on
  `webglcontextrestored`. We only observe and report. No preventDefault, no remount, no retry, so
  there is no loop to enter.

Transitions are ordered in `surfaceState.ts`: `failed` and `unsupported` are terminal against a
later `contextlost`, and restoration revives only a loss.

## 3 · Browser evidence, per failure class

Headless Chrome over CDP against the authenticated service on 127.0.0.1:3001, owner principal,
live data. Screenshots under `~/.claude/uploads/1b-*.png`.

| Class | Before 1B (witnessed first) | After 1B |
|---|---|---|
| WebGL unavailable | `[uncaught] THREE.WebGLRenderer: Error creating WebGL context`, boundary never fired, no message, inert 300×150 canvas, black void | `unsupported`, no canvas mounted, notice "3D graphics unavailable", directory open with 6 client rows, motion controls disabled, status "Scene unavailable" |
| Context lost | canvas painted **white**, labels kept animating over it, toolbar still read "In motion" | `lost`, canvas hidden so the observatory's black shows, notice "Display interrupted", labels held back, frames identical, `?focus=client:tapia-tile-marble` preserved |
| Context restored | three restored the scene; nothing said so | back to `live`, canvas visible, notice gone, 10 labels, frames differ, one `Context Lost.`/`Context Restored.` pair — no loop |
| Scene throw | (single boundary — would have taken the cockpit) | boundary caught it, `[galaxy] Galaxy failed`, cockpit survived: 6 records, directory open, canonical links live; notice "The sky could not be drawn" |
| Post-pass throw | (unwrapped — would have taken the surface) | `[galaxy] Post-processing failed`, surface stayed `live`, scene still moving, labels up, no notice |

The scene-throw run is also where a defect was caught: unmounting the subtree disposed the renderer,
whose parting `webglcontextlost` overwrote `failed` with `lost` — so a crashed surface invited the
operator to wait for a context that was never coming back. That is what the precedence rules fix,
and `THE WITNESSED RACE` is the test for it.

## 4 · Viewport, principal and reduced-motion results

Every cell measured by rect, not by eye: overlap between notice, directory, inspector, toolbar,
actions and the nav trigger; containment in the viewport; horizontal overflow; two frames ~4s apart.

| Viewport | Live scene | No WebGL |
|---|---|---|
| 320×844 | moving, no overlap, no overflow | notice + directory, no overlap |
| 390×844 | moving, no overlap | notice 12–378, directory 355–760, no overlap |
| 430×932 | moving, no overlap | no overlap |
| 667×375 landscape | moving, no overlap | notice left 10–317, directory right 337–657 |
| 768×1024 tablet | moving, no overlap | docked notice, no overlap |
| 1440×900 desktop | unchanged | centred notice 609–1039, directory ends 502 |

- **Tablet defect found and fixed by measurement.** At 768 the centred notice ran straight through
  the directory. The notice now docks to a bottom band below 1320px and the panels reserve its
  height, the same arrangement as 1A's `--ascend-timer-h`. The threshold is 1320 and not the 1200
  first guessed, because the observatory is inset by the navigation rail — measured overlap at 1200
  was 13px. Verified at 768, 1024, 1199, 1200, 1319, 1320, 1440.
- **A CSS ordering defect found the same way.** The first tablet block sat before the base rule, and
  a media query adds no specificity, so only its `bottom` applied and the notice stretched to 457px.
- **Reduced motion, against the ACTIVE `GalaxyStage` for the first time**: at 390×844 and 1440×900
  two frames 4s apart are byte-identical, status reads "Reduced motion", motion controls disabled,
  selection and every link unaffected.
- **1A's timer band**: with an element carrying `.ascend-timer` injected to measure placement — it
  starts no timer and writes no time entry — the notice, directory and toolbar clear each other at
  390×844 in both the live and degraded states.
- **Sales principal: NOT verified.** See §6.

## 5 · Tests

`tests/ui/galaxy-stage-failure.test.ts`, 23 tests, mounting `GalaxyStage`, `SystemExplorer`,
`GalaxyControls` and `SurfaceBoundary` — the components that actually ship. The retired `GalaxyView`
suite is not counted as evidence for any of them.

Mutation probes, each deleting the guard and re-running:

| Guard removed | Result |
|---|---|
| `{drawing && …}` on the labels | 2 failed |
| `degraded` in the directory default | 3 failed |
| the `webglAvailable !== true` gate on `<Canvas>` | 1 failed |
| `!drawing` in `motionDisabled` | 1 failed |
| `onFailure` call in `componentDidCatch` | 1 failed |
| terminal-state precedence in `afterContextLost` | 2 failed |

One probe initially did **not** fail: the directory-first test passed with the behaviour deleted,
because happy-dom answers every media query as a desktop, where the pre-existing rule already opens
the directory. The test was rewritten onto a phone, where only degradation opens it.

Gates: `tsc --noEmit` clean, targeted lint clean, production build succeeds. `gate:static` is
**1,769 passed, 9 skipped, 1 failed** against a 1,746-pass baseline — 23 added, none broken. The one
failure is the PROVEN-environment gate refusing to let db suites read as passing in a run where
their variables were unset, the same failure by name that 41db118 recorded. It clears only under a
full `npm run gate` with the database environment, which is owner-authorized.

## 6 · Carried verification debt — open, not closed

Recorded at the owner's instruction as part of accepting 1B. None of these is discharged by this
slice, and none may be treated as closed by a later slice without its own evidence.

| # | Debt | Why it is still open | What would discharge it |
|---|---|---|---|
| 1 | Sales-principal browser session | No sales credential exists in `.env.production.local`, and a read-only query for which principals exist in production was denied by policy. **No production sales account was provisioned or modified** — that is a production write and an account creation, and it was explicitly out of scope for this commit. | An existing sales login, or owner authorization to provision one. Acceptance criterion 6 rests on the `nav-visibility` and `nav-boundary` suites until then — for 1A as well as 1B. |
| 2 | Genuinely WebGL-less physical device | `unsupported` was reached by making `getContext` return null. That is the same code path, not the same machine: no driver, GPU blocklist or enterprise policy was involved. | The surface opened on a real device or profile with WebGL genuinely unavailable. |
| 3 | Real mobile background → foreground context restoration | Loss and restore were driven programmatically through `WEBGL_lose_context`, which restores immediately. A real phone may restore slowly, partially, or never. | A real device backgrounded and returned to, with the surface observed across the whole cycle. |
| 4 | Keyboard-only traversal | Carried from 1A. Never exercised against the Galaxy's cockpit, whose controls changed in this slice. | A keyboard-only pass over the cockpit, directory, inspector and toolbar in a real browser. |
| 5 | Software keyboard | Carried from 1A. Headless emulation raises no keyboard, so `dvh` containment is argued from the stylesheet rather than witnessed. | A real on-screen keyboard raised over the surface on a phone. |
| 6 | 200% zoom | Carried from 1A. Not measured at any viewport. | A rendered pass at 200% across the acceptance viewports. |
| 7 | Mid-session reduced-motion preference change | The stage re-reads on media change and the listener is registered, but the change was only ever set BEFORE load. A change made while the scene is running was not exercised. | Toggling the preference with the scene live, and observing both the motion and the status. |

Separately, and not 1B's: the retired `GalaxyView` suite still describes a renderer no route mounts.
That is 5A's, deliberately untouched here.

## 7 · Architectural invariant — recorded at acceptance

**The 3D Galaxy is the primary normal experience.** Directory-first is a DEGRADATION PATH, entered
only when the renderer capability is unavailable or has failed. Future Galaxy and Ascend Core work
must not invert that relationship.

This is why `isDegraded` deliberately excludes `starting`: a chunk still in flight is an ordinary
load, and opening the directory underneath it would make the normal path look like a failure. It is
also why `SystemExplorer` keeps the directory CLOSED on a phone whenever the scene is drawing, and
why an explicit choice by the operator still outranks the degraded default in both directions. A
future slice that opens the directory by default on a working scene, or that treats the list as the
primary surface with the Galaxy as an enhancement, is changing this invariant and needs to say so.
