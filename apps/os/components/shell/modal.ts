import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

export const OPEN_PALETTE_EVENT = "ascend:open-palette";

export type OpenPaletteDetail = {
  returnFocus?: HTMLElement | null;
};

declare global {
  interface WindowEventMap {
    "ascend:open-palette": CustomEvent<OpenPaletteDetail>;
  }
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function openCommandPalette(returnFocus?: HTMLElement | null): void {
  window.dispatchEvent(
    new CustomEvent<OpenPaletteDetail>(OPEN_PALETTE_EVENT, {
      detail: { returnFocus },
    })
  );
}

export function focusElement(element: HTMLElement | null | undefined): void {
  if (!element?.isConnected) return;
  element.focus({ preventScroll: true });
}

export function focusMainContent(): void {
  requestAnimationFrame(() => focusElement(document.getElementById("content")));
}

/**
 * Native modal dialogs already contain focus in supported browsers. Explicit wrapping keeps the
 * edge behavior deterministic and gives the DOM interaction suite the same contract.
 */
export function containDialogTab(
  event: ReactKeyboardEvent<HTMLElement>,
  dialogRef: RefObject<HTMLDialogElement | null>
): void {
  if (event.key !== "Tab") return;
  const dialog = dialogRef.current;
  if (!dialog) return;

  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
  );
  if (controls.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    focusElement(first);
  }
}
