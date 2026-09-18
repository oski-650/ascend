# Phase 1A — mobile shell and overlays

## Authorized contract

The owner authorized the first phase on 2026-09-16. This run implements only slice **1A**, using the complete objective, user outcome, current-state evidence, design, responsive behavior, architecture, invariants, file scope, non-goals, acceptance criteria, test plan and rollback contract in `ASCEND-OS-V1-COMPLETION-MAP.md`, section “First proposed implementation contract — 1A”. No subsequent slice is authorized in this run.

Astra's implementation clarifications:

- Preserve navigation contents, all authority and command execution boundaries, current tokens and the Galaxy design. Add scoped ordinary CSS selectors for new layout behavior; do not add dependencies or a styling framework.
- Use a properly modal overlay (native dialog is preferred) with initial focus, contained keyboard navigation, background inertness, explicit close button, Escape/backdrop dismissal and return focus. Escape must not also ascend the Galaxy behind it.
- The phone drawer is always labeled regardless of desktop collapse preference. Opening search from it, including the global keyboard shortcut, hands off to one palette; closing search returns to the mobile trigger. Closing for navigation focuses content rather than an obsolete launcher. Handle crossing the desktop breakpoint without leaving an invisible modal open.
- On phones an active timer belongs in a compact bottom region. Reserve its space in the main viewport rather than laying it over content or the Galaxy toolbar. Keep desktop timer placement and all timer mutation semantics unchanged. No graph composition edits are needed; adjust only shell containment as necessary.
- Preserve PageShell's existing mobile top clearance. Add clearance only for legacy/non-fullbleed operational surfaces. Keep Galaxy fullbleed, including its existing safe-area treatment, and keep public pages outside the operator shell.
- Keep palette input, close action and scrollable results within the visual viewport when the keyboard reduces available height. Preserve existing matching, results, canonical routing and Console handoff.

## Baseline protection

Starting tree remains at `9963b62`, ahead two local commits, with the Phase 0 audit's substantial uncommitted Galaxy work. A content-hash manifest, baseline copies and preexisting diff were captured at `/tmp/ascend-1a-baseline` before implementation. Changes must be compared with that baseline, not mistaken for the whole current git diff. No user changes may be reset, deleted or silently staged.

## Validation and disposition

Recorded 2026-09-18, continuing the run interrupted on 09-16.

### What the interrupted run had left undone

`NavRail`, `CommandPalette` and `modal.ts` were written. Nothing else was. Specifically: both dialogs referenced `.ascend-mobile-drawer` and `.ascend-command-palette`, **neither of which existed in any stylesheet** — an unstyled `showModal()` dialog is a small centred box, so the drawer was not a drawer. `globals.css`, `layout.tsx` and `StopwatchWidget.tsx` were untouched, so the timer still occupied the phone's top region over the navigation trigger and legacy surfaces still had no clearance. No shell test existed.

### Completed in this run

- **Overlay placement** (`app/globals.css`): the two dialogs styled as a left-edge full-height drawer and a top-anchored palette, `display` set on `[open]` alone so a closed dialog cannot be forced visible, `dvh` heights so the software keyboard cannot push the palette input out of view, and backdrops.
- **Legacy clearance**: `.ascend-main:not(:has(> [data-fullbleed]))` reserves the trigger's band below 768px. Applied once, on the non-fullbleed branch only, so PageShell's `pt-14` and Galaxy's safe-area rules are neither doubled nor disturbed.
- **Timer**: moved to a bottom region below 640px via the `ascend-timer` hook, with `--ascend-timer-h` reserved by the scrolling column and by the Galaxy's bottom controls and sheets. Placement from `sm` up, and every timer mutation semantic, unchanged.
- **Two defects in the handed-over code**: the breakpoint effect had no dependency array and re-registered its listener on every render; `focusMainContent()` targeted a `<main>` with no `tabIndex`, making every focus handoff to content a silent no-op. Both fixed, the callbacks made stable, and the inherited lint warning cleared rather than suppressed.
- **`tests/ui/shell-overlays.test.ts`**: 16 tests, registered in the 2G.1 manifest as PROVEN/static.

### Evidence

- Targeted lint clean. `tsc --noEmit` clean. Production build succeeds.
- `gate:static`: **1,741 passed, 9 skipped, 4 failed** — the same four failures, by name, as the pre-implementation baseline captured at `/tmp/ascend-1a-baseline-static.log` (1,725 passed). This slice adds 16 passes and no failure. The four are: F19 hand-built focus URL, the 2G.1 manifest-totality gate (two *Galaxy-slice* suites still unclassified), the PROVEN-environment gate (db suites, variables unset in a static run), and the `galaxy/next` row in the sales reachable set. None is 1A's, and none is hidden.
- **Mutation-tested rather than assumed.** Three probes: removing the Escape `stopPropagation` fails the suite; removing `tabIndex={-1}` fails it; removing `stopImmediatePropagation` fails it. The third initially did **not** fail — the test was rewritten, because the real damage from double-handling the shortcut is a clobbered return-focus target that is only visible on the way back out, not a palette that fails to open.
- **Rendered inspection** (acceptance criterion 7), headless Chrome over CDP against the authenticated service on 127.0.0.1:3001, screenshots in `~/.claude/uploads/1a-*.png`:
  - Phone 390×844 — drawer at x=0, 304×844, all 14 destinations labelled, focus on Close; palette top 16, width 366, within the viewport, input focused, drawer closed (one modal at a time); timer 792→832 in an 844 viewport, no overlap with the trigger, 108px reserved below the column.
  - Legacy `/sales/import` at 320, 390 and 430 — 56px clearance, content top exactly at the trigger's bottom, nothing under the button, no horizontal overflow at any width.
  - Desktop 1440×900 — rail 208×900, mobile trigger hidden, collapse control present; palette 560px, centred, focused. Unchanged.
  - Galaxy phone — still fullbleed, canvas 390×844, two frames 4s apart differ (the scene is moving, not frozen); console carries only the pre-existing `THREE.Clock` deprecation warning.
- Verification was read-only against live data. The active-timer check injects an element carrying the stylesheet's class to measure placement; it starts no timer and writes no time entry, and claims nothing about the widget's data behaviour.

### A build blocker that was not 1A's, and had to be fixed anyway

`app/galaxy/next/page.tsx` contained `export { default, dynamic } from "../page"`. Next cannot parse a route's segment config through a re-export, so **the tree did not build at all** — meaning the Galaxy slice's own claim of live-route verification cannot have been made against a production build in this state. Holding the file aside was not an option (`tests/architecture/f51-page-demand.test.ts` imports the route, so the typecheck breaks either way), so the re-export is now an explicit `export const dynamic = "force-dynamic"`. This is a one-line repair to Galaxy-slice work, made only because no rendered acceptance was reachable without it. It is called out here rather than folded silently into 1A.

The previously reported typecheck blocker was four Finder-duplicate files (`.next/types/* 2.ts`) inside the gitignored build directory. Deleted; `tsc --noEmit` is now clean with no configuration weakened, no include narrowed and no tracked file changed.

### Disposition — NOT checkpointed, and why

The slice is complete and verified, but it **cannot be committed as a slice-only diff**. This run's CSS lives in `app/globals.css`, which already carries ~242 lines of uncommitted Galaxy work, so no commit of this file can satisfy the contract's invariant that no unrelated Galaxy change be included. The work is left in the tree. Committing requires an owner decision on how to separate or land the Galaxy body of work first.

### Still outstanding

- Keyboard-only traversal, 200% zoom and a real virtual keyboard remain unverified: headless emulation does not raise a software keyboard, and `dvh` containment is argued from the stylesheet rather than witnessed.
- 667×375 landscape and 768px tablet were not measured; 320/390/430 portrait and 1440 desktop were.
- A second principal was not checked. Rendered inspection used the owner only, so acceptance criterion 6 (sales-visible links unchanged) rests on the existing `nav-visibility` and `nav-boundary` suites, not on a rendered sales session.
- The two Galaxy suites missing from the 2G.1 manifest are that slice's debt and were deliberately left.
