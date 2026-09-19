# Phase 1C — operational responsive consistency

**PRE-FLIGHT ONLY. Nothing implemented.** Baseline `ce59417` (Phase 1B, accepted).

The roadmap's section E was the starting inventory. What follows is what the shipping application
actually does, measured in a browser against live data as the owner principal, not what the map
predicted. Where the two disagree, the measurement wins and the disagreement is stated.

## Method

22 authenticated routes, driven over CDP at 390×844, 640×900, 667×375 landscape, 768×1024,
1024×800 and 1440×900. Every route audited by measured rect, not by eye: horizontal overflow and
which element causes it; interactive targets under 44px; form controls under a 16px font; fixed and
sticky furniture with z-index; controls whose own centre point belongs to another element; wide
tables and whether anything scrolls them; and whether each surface's scroll container can actually
reach its own bottom.

**One probe produced false positives and was corrected rather than reported.** The "obscured
control" check flagged selects and inputs on `/documents` and `/tasks`; all of them proved to be
inside `<details open=false>`, where a collapsed disclosure's children keep measurable rects.
`Element.checkVisibility()` returns false for every one. They are NOT defects and are excluded. The
same check's hits on `/admin/wipe` survived verification — `checkVisibility()` true, no collapsed
ancestor — and became finding D1.

## Routes inspected

`/dashboard` (redirects to the Galaxy), `/sales`, `/sales/[prospect]`, `/sales/import`, `/crm`,
`/clients/[slug]`, `/clients/[slug]/project`, `/clients/[slug]/portal`, `/production`,
`/production/[client]`, `/tasks`, `/documents`, `/finance`, `/console`, `/search`, `/admin`,
`/admin/invitations`, `/admin/wipe`, `/partner`, `/signals`, `/automations`, `/maintenance`, plus
`/login` as the public control. `/galaxy` is 1B's and was not re-opened.

## What is already acceptable — do not touch

These were suspected by section E and are clean under measurement:

- **Horizontal overflow: none.** Not one element on any route at any of the six viewports extends
  past the viewport. Section E's "verify wide tables and horizontal scroll containment" resolves
  clean: there are no `<table>` elements on the operational routes at all.
- **Scroll reachability: complete.** Every surface's `.ascend-main` scrolls (`overflow-y: auto`)
  and reaches its own bottom at every viewport, landscape included. Nothing is stranded.
- **1A's trigger clearance holds.** The fixed 44×44 mobile trigger sits at 12,12 with z-index 50 on
  every legacy and PageShell route, and no content overlaps it. Section E's "global `.ascend-main`
  padding alone does not reserve the mobile trigger area" was fixed by 1A and re-measures clean.
- **Landscape (667×375).** No overflow, no obscured controls, every surface scrolls. The only
  landscape-specific finding is D1's severity.
- **Desktop is not regressed and never was.** 1024 and 1440 measure identically to phone on every
  structural check: no overflow, no tables, no stranded content. The small-target counts are also
  *identical at every width* — 52 on `/tasks`, 48 on `/signals`, 14 on `/admin/wipe`, at 390 and at
  1440 alike. These are design-system constants, not responsive breakage, which is precisely why
  the correction must be conditioned on the pointer rather than applied flat (Decision 1).
- **Legacy vs PageShell makes no difference to responsive behaviour.** `/dashboard`, `/search`,
  `/sales/import`, `/admin/wipe` and `/production/[client]` do not use `PageShell`, and none of them
  shows a layout defect attributable to that. Age is not a defect, and 1C will not convert them.

## Witnessed defects

### D1 · `/admin/wipe` — the sticky confirm bar covers the targets it is confirming

| | |
|---|---|
| Current behaviour | A `position: sticky` panel ("TYPE WIPE TO CONFIRM", the text input and Execute) floats over the target checklist. |
| Witnessed | 390×844: bar 145px tall, **2 of 11 checkboxes and 7 rows covered**, 17% of the viewport. 667×375: 99px, 26% of the viewport, 1 checkbox and 3 rows. 768: 1 checkbox, 3 rows. 1440: 1 checkbox, 5 rows. |
| Viewports | All. Worst at phone portrait and landscape. |
| Risk class | Layout-only — but on the destructive surface, where what is covered is what is about to be deleted. No behaviour changes; the rows scroll past the bar, so nothing is permanently unreachable. |
| Writes to preserve | `POST /api/admin/wipe`, the typed-WIPE confirmation, the target selection set, owner-only access. None of it is touched by a layout fix. |
| Existing tests | 4 test files reference wipe (API/authorization). **No test mounts `WipePanel`.** |
| Smallest correction | The list reserves the bar's height (`padding-bottom` by a `--wipe-bar-h` variable), so no row ever rests permanently underneath. Keeps the sticky affordance, the IA and every word of the copy. Same reserved-band idiom as 1A's timer and 1B's notice. |

### D2 · Every action button is 27px tall

| | |
|---|---|
| Current behaviour | `components/primitives/index.tsx` `Button` is `t-label … px-2.5 py-1.5` → a measured **27px** height on every operational route. |
| Witnessed | 27px at 390 on `/sales/[prospect]` ("Promote to client", "Delete", "Find website"), `/crm`, `/production`, `/finance` ("Mark paid"), `/signals` (48 targets), `/automations`, `/maintenance` (20 targets), `/clients/[slug]/portal` ("Rotate — revokes current link"). `/maintenance` also has a 45×27 button. |
| Viewports | All. Only a defect where the pointer is coarse. |
| Risk class | CSS-only. No component API changes. |
| Writes to preserve | Every one of these buttons submits something — promote, delete, mark paid, snooze, rotate a portal link. A height change touches none of that, and no handler is edited. |
| Existing tests | 32 files import the primitives. **No test mounts `Button`.** |
| Smallest correction | A minimum height at coarse pointer / below `md` only, in one place. Desktop density is unchanged — see Decision 1. |

### D3 · Form controls are 38px tall with a 14px font

| | |
|---|---|
| Current behaviour | `INPUT_CLASS` is `px-3 py-2 text-sm` → 38px tall, 14px text. Bespoke copies on other surfaces match it. |
| Witnessed | 38px/14px on `/sales` intake, `/tasks` (7 controls), `/documents` (9), `/finance` (5), `/clients/[slug]/portal` (4), `/console`, `/search`, `/admin/invitations`, `/sales/[prospect]` note textarea, `/login` (2). |
| Viewports | All; the font size matters on phones only. |
| Risk class | CSS-only, but **keyboard-sensitive**: iOS zooms the page on focus for any control under 16px, which is the mechanism behind "form obscured by keyboard" complaints. This was NOT witnessed — headless Chrome raises no software keyboard — it is a documented platform behaviour, and it stays a stated inference until a real device confirms it (debt item 5 from 1B). |
| Writes to preserve | Intake, notes, invitations, approvals, documents, invoices, wipe confirmation, login. No handler, validation or submit path is touched by type scale. |
| Existing tests | Write paths are well covered at API/db level (notes 17 files, import 48, console/search 21/18, invitations 6). **No test mounts any of these forms as components.** |
| Smallest correction | 16px font and a 44px minimum height for `input, select, textarea` at phone widths, applied once. See Decision 2. |

### D4 · Checkboxes are 13–16px

| | |
|---|---|
| Current behaviour | `CHECKBOX_CLASS` is `size-3.5` (14px); `/admin/wipe` uses `size-4` (16px). |
| Witnessed | 14×14 on `/sales` intake options; 13×16 and 15×16 on `/admin/wipe`, where each box selects a destructive target. |
| Viewports | All. |
| Risk class | CSS-only. |
| Writes to preserve | The wipe target set and the intake option set are read from these inputs. Their `name`/`checked` semantics must not change — only the hit area. |
| Existing tests | None at component level. |
| Smallest correction | Enlarge the hit area at coarse pointer (padding or a larger control), leaving the control's value semantics untouched. |

### D5 · Two divergent form vocabularies

| | |
|---|---|
| Current behaviour | Only 4 files use the shared `INPUT_CLASS`/`SELECT_CLASS`. At least 8 carry their own `rounded-md border …` copies: `LoginForm`, `NewDocumentForm`, `OnboardingForm`, `ApprovalSignForm`, `AddInvoiceForm`, `sales/ProspectNotes`, `admin/WipePanel`, `sales/ImportProspectsPanel`. |
| Why it matters here | It decides 1C's shape. A fix applied to the primitives alone would correct the Button everywhere but reach almost none of the inputs. |
| Risk class | Converging them is a refactor of eight write surfaces — application-behaviour risk, not layout risk. |
| Smallest correction for 1C | **Do not converge.** Apply the responsive floor as element-level CSS in `globals.css` (`input, select, textarea` within the operator shell at phone widths), which reaches both vocabularies and edits no component. Convergence is a separate concern — see Extraction E2. |

## Proposed 1C implementation boundary

**In:** D1's reserved band on `/admin/wipe`; D2, D3 and D4 as a single responsive floor for touch
targets and form controls, applied at phone widths and coarse pointers in `app/globals.css` and, for
the Button, in the one primitive that defines it; a rendered re-measure of all 22 routes at all six
viewports; and the first component-level tests for the touched surfaces.

**Out:** no surface is redesigned, no legacy route is converted to `PageShell`, no information
architecture moves, no form is rewritten, no write path, validation or authorization boundary is
edited, and no route's content changes. The Galaxy is not reopened, and 1B's invariant stands: the
3D Galaxy remains the primary `/galaxy` experience and directory-first remains degradation-only.

Expected diff: `app/globals.css`, `components/primitives/index.tsx`, `components/admin/WipePanel.tsx`
(or its stylesheet rule alone), plus new tests. No `app/**/page.tsx` edits are anticipated.

## Recommended for extraction

| | Surface | Why it must not be in 1C |
|---|---|---|
| E1 | `/sales` list | The prospect list renders **346,954px tall at 390px** (254,359 in landscape) — 3,107 rows, no pagination or virtualisation. That is a real usability and performance problem, but the fix is paging or a priority queue, which is 2C's bounded outcome, and its cost is 6A's to measure. A responsive slice must not quietly invent a list strategy. |
| E2 | The eight bespoke forms | Converging them onto the shared primitives touches eight write surfaces for no responsive gain once the element-level floor is in. It belongs to 5B (dependency/style/utility cleanup), which already owns "remove proven dead deps/aliases/shims". |
| E3 | `/production/[client]` checklist editing | Section E warns "do not remove checklist editor". It measures clean responsively. Any interaction work there is production-workflow scope, not 1C. |

## Tests currently missing or misleading

- **Missing:** no test mounts any operational form, list, table or editor. `tests/ui/` contains six
  files, covering the Galaxy (four), the shell overlays and the invite panel — nothing else. Every
  surface 1C would touch has zero component-level coverage, so the slice must bring its own.
- **Not missing:** the write paths themselves are well covered at API/db level. A layout slice that
  edits no handler inherits that safety net, which is a further argument for the CSS-only shape.
- **Misleading:** `tests/ui/galaxy-surfaces.test.ts` still exercises the retired `GalaxyView`,
  including a reduced-motion section, and reads as Galaxy coverage in the suite count. Flagged in
  1B, owned by 5A, and named here so it is not mistaken for coverage of anything 1C touches.
- **Vacuity risk:** happy-dom applies no stylesheet and has no viewport, so it cannot witness a
  44px target or a 16px font. Every claim in this slice is geometric, which means the evidence is
  the rendered pass and the component tests may only assert behaviour — never placement.

## Decisions required before implementation

1. **Touch-target policy.** Raise the floor to 44px at coarse pointer and phone widths only,
   leaving desktop density exactly as it is (recommended), or raise it everywhere? The second
   changes the look of every desktop screen, which reads as visual modernization and is against the
   slice's stated purpose.
2. **16px form font on phones.** This is the only way to stop iOS zooming on focus, and it will make
   phone forms visibly larger. Confirm that is wanted, given that the zoom behaviour itself remains
   an inference until a real device is available.
3. **Is `/login` in scope?** It is outside the operator shell, has the same 38px/14px controls and a
   34px submit button, and section E says to verify it without adding operator navigation. Include
   it in the floor (recommended, it is one selector) or leave public routes untouched?
4. **Confirm E1's deferral.** The `/sales` list is the largest real problem this pass found. It is
   out of 1C by the roadmap's own division of labour, and it should be said out loud that it stays
   broken on a phone until 2C.
