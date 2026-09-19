# Phase 1C — operational responsive consistency

**ACCEPTED by the owner on 2026-09-19.** The implementation satisfies the bounded outcome. D1's
corrected diagnosis (§4) is accepted, and the rows that still pass beneath the sticky `/admin/wipe`
bar are accepted as CARRIED UI DEBT, not a blocker: focused controls are no longer stranded under
it, every row stays reachable, nothing overflows, and going further would redesign the sticky
surface rather than correct the operational defect. `/admin/wipe` is not to be redesigned under
this checkpoint.

Implemented 2026-09-18/19 against `docs/PHASE-1C-CONTRACT.md` (committed with this checkpoint),
with the owner's four decisions:

1. **Touch targets:** a 44px floor for touch/coarse-pointer use only, not across the whole desktop.
   It's an interaction target, not a visual enlargement, and compact desktop density is preserved.
2. **Mobile form font:** 16px on phones, accepted as the mobile standard in its own right. It is
   NOT evidence that iOS focus zoom is fixed; that stays unwitnessed debt.
3. **`/login`:** included, bounded, with no redesign.
4. **`/sales`:** the 3,107-row list is deferred to 2C, and no list strategy was invented here.

Baseline: `ce59417` (Phase 1B), tree clean apart from the untracked contract.

## 1 · Final implementation boundary

| File | Change |
|---|---|
| `app/globals.css` | NEW section **Interaction floor (1C)**: the D2 button floor, D3 form-control floor (44px, 16px text) and D4 checkbox floor (24px control, 44px wrapping label), under `@media (pointer: coarse), (max-width: 767px)` and scoped to `.ascend-main:not(:has(> .galaxy-page))` and `.ascend-public`. NEW section **The wipe panel's reserved band (1C · D1)**: `--ascend-wipe-bar-h`, the list's reserved padding, and `scroll-padding-bottom` on the scroller, including a timer variant. |
| `app/layout.tsx` | The unauthenticated `<main>` gets the `ascend-public` class, so `/login` gets the floor. It's a presentation hook only; the session check still picks the branch. |
| `components/admin/WipePanel.tsx` | Three class hooks: `ascend-wipe`, `ascend-wipe-targets`, `ascend-wipe-bar`. No logic, handler, request, target set or copy changed. |
| `tests/ui/touch-floor.test.ts` | NEW. 12 tests: the floor as a stylesheet contract. |
| `tests/ui/wipe-panel.test.ts` | NEW. 10 tests: the first test to mount `WipePanel`. |
| `tests/architecture/gate-2g1.ts` | Both new suites classified NOT_APPLICABLE/static, with reasons. |
| `docs/PHASE-1C-CONTRACT.md`, `docs/PHASE-1C-CHECKPOINT.md` | The pre-flight contract and this record. |

**Not touched:** any `app/**/page.tsx`, the `Button` primitive (the element-level rule reaches it),
`components/primitives/form.ts`, any handler, write path, validation or authorization boundary, the
information architecture, the eight bespoke forms, any Galaxy or graph file (`git diff` over
`components/galaxy`, `app/galaxy` and `components/graph` is empty), and the production workflow.

**Scope against the forecast:** the contract predicted `globals.css`, `primitives/index.tsx`,
`WipePanel.tsx` and tests. The actual diff swaps the primitive edit (not needed) for one class in
`layout.tsx` (needed for `/login` under Decision 3). It stayed inside the predicted small slice.

### The rule's condition

`(pointer: coarse)` is the real rule. The `(max-width: 767px)` term is an **intended, documented
fallback**, not an accident:

- It is the shell's own breakpoint. Below 768px the rail is already replaced by 1A's fixed 44px
  trigger, so a mouse-driven window that narrow is already laid out as a phone.
- The alternative is worse: a phone whose browser reports a fine pointer would keep 27px targets.

At ≥768px with a mouse, no floor rule applies (§3).

### What is deliberately not floored

- **Links.** The audit's small-target count includes prose anchors, and enlarging those would be
  visual modernization.
- **Shell furniture outside the content column:** the command palette, the mobile drawer and the
  stopwatch widget. They sit outside D2–D4; 1A owns the overlays.
- **The Galaxy.** It is excluded by route rather than by specificity, and it keeps its own 1A/1B
  phone geometry.

## 2 · Before/after browser measurements

Headless Chrome over CDP against the authenticated production build on `127.0.0.1:3001`, owner
principal, live data. The same probe ran before and after the change. Screenshots are
`~/.claude/uploads/1c-after-*.png`.

### Representative surfaces at 390×844, coarse pointer

| Surface | Before | After |
|---|---|---|
| Shared `Button`: `/sales/[prospect]`, `/finance`, `/tasks` (43), `/signals` (43), `/maintenance` (13), `/crm`, `/production`, `/clients/*` | 27.2px tall | 44px |
| Shared-class fields: `/admin/invitations`, `/console`, `/search` | 38px tall, 14px text | 44px, 16px |
| Bespoke `/documents` refine controls | 33px, 12.8px text | 44px, 16px |
| Bespoke `/sales/import` paste textarea | 186px, 12px text | 239px, 16px |
| Bespoke `/sales/[prospect]` note textarea | 89px, 14px text | 98px, 16px |
| `/login` | button 34px; fields 38px at 14px | 44px; 44px at 16px |
| `/admin/wipe` confirm input and Execute | 38px at 14px; 42px | 44px at 16px; 44px |
| Checkboxes: `/documents`, `/admin/wipe` | 14px and 13px boxes; `/documents` label 20px | 24px boxes; every wrapping label ≥44px |

### `/admin/wipe`: sticky bar vs the destructive checklist

| Measure | 390×844 | 667×375 | 768×1024 | 1440×900 |
|---|---|---|---|---|
| Bar height, before → after | 145 → 153 | 99 → 105 | 99 → 105 | 99 → 99 |
| **Checkboxes left under the bar after keyboard focus**, before → after | **4 → 0** | **3 → 0** | **1 → 0** | **1 → 0** |
| Covered at the top of the scroll (boxes / rows), before → after | 2/3 → 2/3 | 1/1 → 1/1 | 1/1 → 1/1 | 1/2 → 1/2 |
| Covered at the bottom of the scroll | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Scroller `scroll-padding-bottom`, before → after | auto → 224px | auto → 176px | auto → 176px | auto → 176px |

The bar grew 8px below 640 and 6px in the row layout. The cause is its own confirmation input
meeting the 16px/44px form floor; the band is sized against the post-floor heights.

### Desktop regression at 1440×900, fine pointer

Across all 22 routes, 1440 after matches the before baseline on every measured signature: button
count and minimum height, field count, minimum height and minimum font, checkbox count and minimum
size. The one difference is the wipe checkbox's measured width, 13px at 390 and 16px at 1440. That
is width-dependent flex squashing already recorded in the pre-flight as "13×16", and no 1C rule
applies at 1440 with a mouse. Buttons stay 27.2px and fields stay 38px at 14px.

## 3 · Pointer and viewport matrix

22 routes across 9 combinations, 198 page loads, 0 probe errors, and **0 horizontal overflow on
any route in any combination**. Pointer mode is set independently of width with
`Emulation.setTouchEmulationEnabled`. It was verified with `matchMedia("(pointer: coarse)")`:
coarse only with touch on, at 390 and at 768 alike, and fine with touch off, including at 390.

| Viewport | Pointer | Floor active | Buttons under 44px tall (of 134) | Fields under 44px (of 12) | Fields under 16px text | Smallest checkbox / label |
|---|---|---|---|---|---|---|
| 390×844 | coarse | yes | 0 | 0 | 0 | 24 / 44 |
| 390×844 | fine | **yes (fallback, intended)** | 0 | 0 | 0 | 24 / 44 |
| 667×375 | coarse | yes | 0 | 0 | 0 | 24 / 44 |
| 640×900 | coarse | yes | 0 | 0 | 0 | 24 / 44 |
| 768×1024 | coarse | yes | 0 | 0 | 0 | 24 / 44 |
| 768×1024 | fine | **no** | 134 | 10 | 12 | 13 / 20 |
| 1024×800 | coarse | yes | 0 | 0 | 0 | 24 / 44 |
| 1024×800 | fine | **no** | 134 | 10 | 12 | 14 / 20 |
| 1440×900 | fine | **no** | 134 | 10 | 12 | 14 / 20 |

The unfloored rows are the pre-existing compact density, preserved on purpose.

**Galaxy exclusion, witnessed:** on `/galaxy` at 390 coarse, the floor's scope selector does not
match the scroller. Its 14 buttons keep their own 1A/1B heights (28, 33, 44, 46) and `min-height`
values (`0px`, `28px`, `44px`, `auto`). A floor hit would have lifted all of them to 44.

## 4 · D1: the corrected diagnosis, and why the implementation changed

**The contract's claim:** a sticky bar covering 2 checkboxes and 7 rows. The proposed fix was a
`padding-bottom` reserved band, "so no row ever rests permanently underneath".

**What measurement showed:** that fix alone would have changed nothing.

- The pre-flight counted coverage at the top of the scroll. At the bottom of the scroll, zero rows
  were covered before any change, because a bottom-sticky element parks at its static position at
  the end of the content.
- No row ever rested permanently underneath, so padding alone had nothing to correct.

**The real defect:** keyboard focus. When a covered checkbox takes focus, the browser scrolls it
just inside the scroll area, which on this surface is still underneath the bar. A keyboard or switch
user choosing destructive targets could not see the target they had landed on: 4 of 11 checkboxes
at 390×844, 3 at 667×375, and 1 each at 768 and 1440.

**The fix:** `scroll-padding-bottom` on the scroller tells the browser where its usable bottom
actually is. Three successive measurements drove its final form:

1. **Variable declared only on the panel.** A custom property inherits downwards only, so the
   scroller (the panel's ancestor) could not read it. The declaration was invalid at
   computed-value time, the value fell back to `auto`, and coverage stayed at 4. Fix: declare the
   variable on the scroller as well.
2. **Band too small (bar + offset).** At 6.5rem the band fell 1px short, and focused checkboxes
   still touched the bar at 667×375. Fix: size it against the post-floor bar heights (10rem / 7rem).
3. **Missing third term.** A bottom-sticky element can't move below its static position, so the bar
   parks at the viewport bottom minus the scroller's own 3rem padding, not at its `bottom-4`. At
   390 the bar tops out 217px above the viewport bottom (153 + 16 + 48). Fix: add the 3rem term.
   Focus coverage then went to **0 at all four viewports**.

**What remains, and why it is accepted:** ordinary rows still scroll beneath the bar, and it covers
2 boxes and 3 rows at the top of the scroll on a phone. That is what a sticky bar is. Removing it
would mean removing the stickiness, which is a sticky-surface redesign. It is carried UI debt (§7).

## 5 · Mutation-probe evidence

happy-dom has no stylesheet, viewport or pointer. So the suites claim no geometry: every geometric
fact above is browser evidence. What the suites do claim was mutation-probed: delete the protected
line, re-run, and restore from a byte-identical backup.

| Mutation | Result |
|---|---|
| M1 · drop the Galaxy guard from the button selector | red (1 failed) |
| M2 · drop the checkbox exclusion from the operator-column field rule | **stayed green.** The assertion matched the other column's selector. Tightened to require the exclusion on both field selectors. |
| M2b · drop the public-column checkbox exclusion (tightened test) | red (1 failed) |
| M3 · drop the wipe `scroll-padding-bottom` | red (1 failed) |
| M4 · hoist `--ascend-touch` out of the media query (onto desktop) | red (1 failed) |
| M5 · drop `ascend-public` from the layout | red (1 failed) |
| M6 · make the WIPE confirmation case-insensitive | red (1 failed) |
| M7 · unwrap the checkbox label | **invalid probe** (it produced `<div>…</label>`), so it didn't count. Redone as M7b. |
| M7b · unwrap the checkbox label with valid JSX | red (5 failed) |
| M8 · add a field to the wipe POST body | red (1 failed) |

The two weak points (M2 and M7) were found by this method and fixed before acceptance. The
selector parser in `touch-floor.test.ts` also had to become depth-aware: its first version split
`:where(button, [role="button"])` on the inner comma.

## 6 · Final gate state

| Check | Result |
|---|---|
| `gate:static` | **1,791 passed, 9 skipped, 1 failed**: 1B's 1,769 plus exactly the 22 new tests, nothing broken |
| `gate:server` | 3 passed, 5 skipped |
| `gate:db` | 421 passed, 173 skipped (31 files passed, 5 skipped) |
| `tsc --noEmit` | 0 source errors (see note below) |
| `eslint` on the changed TS/TSX | clean |
| `next build` | succeeds; the served CSS carries the final `10rem` / `7rem`, both `scroll-padding-bottom` forms and the `(pointer:coarse),(max-width:767px)` query |

- **The one static failure** is 1B's pre-existing, environment-dependent check: *"every PROVEN
  suite's environment gate is satisfied in THIS run"*. It fails closed on 17 PROVEN db suites
  whose environment isn't set in this run. It is unchanged by 1C.
- **Typecheck note:** the only `tsc` errors are duplicate identifiers from iCloud copies
  (`routes.d 2.ts`, `cache-life.d 5.ts` and so on) inside the generated `.next/types` folder. They
  are not repository files.

## 7 · Carried debt, exactly as reported

1. **iOS focus zoom is unwitnessed.** The 16px floor is in, but no physical iOS device has
   confirmed the zoom is gone. It is not claimed as solved (continues 1B debt item 5).
2. **The `/admin/wipe` sticky bar still overlaps ordinary rows** at the top of the scroll (2 boxes
   and 3 rows at 390), and it grew 8px because its own input meets the form floor. Accepted as UI
   debt; no redesign under this checkpoint.
3. **The timer variant of the wipe scroll padding is derived, not witnessed.** It mirrors 1A's
   timer band, but no stopwatch was started against production data for this slice.
4. **Some small targets are outside D2–D4 and are not floored:** links, the command palette, the
   mobile drawer and the stopwatch widget.
5. **`/sales` (3,107 rows, ~347k px tall at 390) is untouched.** Owned by 2C (§8).
6. **The eight bespoke forms are still unconverged.** Owned by 5B (§9).
7. **The pre-flight audit ran with a fine pointer at every width.** That's why its small-target
   counts were identical at 390 and 1440. Pointer mode is now measured separately (§3), and future
   rendered passes must set it explicitly.

## 8 · `/sales` → 2C ownership

The prospect list at `/sales` renders 3,107 rows with no pagination or virtualisation: 346,954px
tall at 390 and 254,359px in landscape. This is a **confirmed architectural and operational
problem**, and it is explicitly **owned by 2C (Explainable priority sales home)**. 2C's bounded
outcome already includes a "usable large list".

1C did not attempt it through responsive CSS, truncation or interim pagination. The right list
strategy must come from 2C's priority, scoring, filtering and workflow design, not from a
responsive slice. Until 2C lands, `/sales` stays hard to use on a phone, and that is stated here
rather than hidden.

## 9 · Bespoke-form convergence → 5B ownership

Only 4 files use the shared `INPUT_CLASS` / `SELECT_CLASS`. At least eight carry their own copies:

- `LoginForm`
- `NewDocumentForm`
- `OnboardingForm`
- `ApprovalSignForm`
- `AddInvoiceForm`
- `sales/ProspectNotes`
- `admin/WipePanel`
- `sales/ImportProspectsPanel`

1C reached all of them with the element-level floor and converged none of them. Converging them
touches eight write surfaces for no remaining responsive gain. It is explicitly **owned by 5B
(Dependency/style/utility cleanup)**, which already depends on 1C.

## 10 · Verification hygiene

- **No production data was mutated.** The only non-GET request the harness made was
  `POST /api/auth/login`, which reads the credential and resolves the principal, then issues a
  stateless signed session cookie; it writes nothing. The wipe probes only scrolled and focused
  checkboxes. They never typed the confirmation, never clicked a checkbox and never pressed Execute.
- **No harness or fault code entered source.** The CDP harness lived only in the session
  scratchpad. A grep of every changed file for `cdp`, `scratchpad`, `__fault`, `launchChrome` and
  `127.0.0.1` returns nothing.
- **Galaxy files are untouched:** the `git diff` over `components/galaxy`, `app/galaxy` and
  `components/graph` is empty.
- **The production build was rebuilt before each measurement and the service restarted after it**
  (`launchctl kickstart -k`, after the build, per the known build/restart race).
