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
      values: { scope: "team", assignee: "", stage: "", due: "", never: false, within: "", name: "", priority: false, sort: "name" },
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

describe("2A.3b · the priority filter control", () => {
  const values = { scope: "team" as const, assignee: "", stage: "", due: "", never: false, within: "", name: "", priority: false, sort: "name" as const };
  it("offers a Priority only toggle that submits priority=1, and offers priority order only when the filter is on", () => {
    render(createElement(SalesBrowseFilters, { values, names: {}, activeCount: 0, clearHref: "/sales/list?scope=team" }));
    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="priority"]'));
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of toggles) expect([t.type, t.value, t.checked]).toEqual(["checkbox", "1", false]);
    expect(document.querySelectorAll('select[name="sort"] option[value="priority"]')).toHaveLength(0);
    cleanup();
    render(createElement(SalesBrowseFilters, { values: { ...values, priority: true, sort: "priority" as never }, names: {}, activeCount: 1, clearHref: "/sales/list?scope=team" }));
    for (const t of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="priority"]'))) expect(t.checked).toBe(true);
    const sorts = Array.from(document.querySelectorAll<HTMLSelectElement>('select[name="sort"]'));
    for (const sel of sorts) expect(sel.value).toBe("priority");
  });
});
