// @vitest-environment happy-dom
// A viewport transition must release the mobile modal before its sm:hidden wrapper disappears.
// happy-dom has no layout; this checks the dialog and focus lifecycle, not geometry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { SalesBrowseFilters } from "@/components/sales/SalesBrowseFilters";

const listeners = new Set<(event: MediaQueryListEvent) => void>();
let desktop = false;
let originalMatchMedia: typeof window.matchMedia;

const query = {
  media: "(min-width: 640px)",
  get matches() { return desktop; },
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
} as MediaQueryList;

beforeEach(() => {
  desktop = false;
  listeners.clear();
  originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn(() => query);
});
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  listeners.clear();
});

describe("sales browse filters on rotation", () => {
  it("closes the mobile modal and returns focus to the visible desktop summary", () => {
    render(createElement(SalesBrowseFilters, {
      values: { scope: "team", assignee: "", stage: "", due: "", never: false, within: "", name: "", sort: "name" },
      names: {}, activeCount: 0, clearHref: "/sales/list?scope=team",
    }));
    const trigger = screen.getByRole("button", { name: "Filters & sort" });
    fireEvent.click(trigger);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    desktop = true;
    act(() => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(dialog.open).toBe(false);
    const summary = document.querySelector("summary") as HTMLElement;
    expect(document.activeElement).toBe(summary);
    fireEvent.click(summary);
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  });
});
