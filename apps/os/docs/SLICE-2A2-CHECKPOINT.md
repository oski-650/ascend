# Slice 2A.2e · Sales accessibility and polish checkpoint

## Scope

This candidate changes Sales presentation only. No Sales command, route, database, migration, receipt, or Coordinator contract changed.

## Findings and changes

- A server refusal could dismiss Record contact while keyboard focus remained inside the removed dialog. The newly shown lock notice now receives focus. The existing status message supplies the reason.
- The phone More sheet's in-page Notes and Web presence links left the modal open over their destinations. They now close the sheet, retain the URL fragment, scroll to the destination, and place focus there. Closing More without following a link still returns focus to its launcher.
- The Galaxy link on the prospect page contained a button inside an anchor. It is now one styled anchor with the same destination and a 44px touch target.
- Sales dialogs are rendered outside `.ascend-main`, so the Slice 1C touch and field floor did not apply to Record radio chips, buttons, or text fields. The Sales dialog now applies a 44px control floor and 16px text-field floor for coarse pointers and widths below 768px. Desktop fine-pointer density remains compact.
- The Sales queue's Import from CSV action is now a 44px link target.

## Local rendered measurements

Chrome device metrics were set independently of the desktop window size. The fixture server-rendered the real `/sales` and `/sales/list` page components with synthetic queue data, and rendered the real Sales workspace, filters, and Record sheet components. The detail page's surrounding content was represented by a synthetic shell; this does **not** establish exact full-page detail geometry. No production URL, credential, or database was used. Screenshots and raw measurements are local scratch artifacts at `/private/tmp/ascend-2a2e-qa/` (`measurements.json` and `<surface>-<width>x<height>.png`). Page-entry animations were completed before geometry measurements.

| Viewport | Pointer | Queue overflow / small targets | Browse overflow / small targets | Record sheet overflow / small targets |
|---|---|---|---|---|
| 390×844 | coarse | no / 0 of 29 | no / 0 of 5 | no / 0 of 17 |
| 640×900 | coarse | no / 0 of 29 | no / 0 of 5 | no / 0 of 17 |
| 667×375 | coarse | no / 0 of 29 | no / 0 of 5 | no / 0 of 17 |
| 768×1024 | coarse | no / 0 of 29 | no / 0 of 5 | no / 0 of 17 |
| 1024×800 | fine | no / 0 of 29 | no / 0 of 5 | no / 16 of 17 (compact desktop) |
| 1440×900 | fine | no / 0 of 29 | no / 0 of 5 | no / 16 of 17 (compact desktop) |

The mobile filter dialog at 390×844 had no horizontal overflow, 0 of 2 visible buttons below 44px, and 0 of 7 visible fields below 16px text. The synthetic detail shell had no overflow at all six sizes. Screenshot review found no clipped controls in the Record sheet at 390×844, landscape 667×375, or desktop side-panel 1024×800. The landscape sheet scrolls its body while Save remains visible.

With `prefers-reduced-motion: reduce`, Chrome computed `0.001ms` for the Record panel animation and switch transitions through the existing global rule. The Sales-specific rules introduce no animation.

## Keyboard, names, status, and copy

Focused component tests cover Record's labelled dialog, first-outcome focus, Escape and opener restoration, native radio groups, Save and conflict announcements, the new lock-notice focus, the More anchor focus path, and filter-dialog focus on rotation. The visible labels and status text were reviewed against the preflight vocabulary; no raw Sales enum was found in the touched controls. These automated tests do not simulate an iOS screen reader.

## Required manual checks before acceptance

- Oscar must perform the VoiceOver/iOS Save-flow pass on a device, including outcome selection, an optional stage/follow-up, Save, confirmation, and a refusal/retry path. Record the device result before `ACCEPT`.
- The exact full prospect detail route was not rendered in the synthetic Chrome fixture. Review its full page at the six required viewports in a sanctioned local fixture before `ACCEPT`.

This checkpoint supports review of the candidate; it does not claim the two manual checks are complete.
