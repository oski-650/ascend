// @vitest-environment happy-dom
//
// Slice 1A — THE SHELL'S OVERLAYS, DRIVEN RATHER THAN READ.
//
// The mobile drawer and the command palette are the only two modal surfaces in the operator shell.
// Their contract is not "the markup contains a dialog" — it is that exactly one of them owns the
// modal layer at a time, that focus lands somewhere deliberate when one opens and returns somewhere
// deliberate when it closes, and that a phone user is never left with navigation they cannot read.
// So this suite mounts the real components and drives them.
//
// ─── WHAT THIS SUITE CANNOT SEE ────────────────────────────────────────────────────────────────
//
// happy-dom applies no stylesheet and has no viewport. Both rails are therefore in the DOM at once
// (`hidden md:block` hides nothing here), which is why every drawer assertion is scoped with
// `within(drawer)` rather than queried globally — an unscoped `getByText("Clients")` would pass on
// the desktop rail while the drawer was empty.
//
// It follows that PLACEMENT is out of reach here: that the drawer is a left-edge full-height panel,
// that the palette clears the software keyboard, and that the timer sits clear of the trigger are
// stylesheet facts, checked by rendered inspection instead. Acceptance criterion 7 says so
// explicitly, and this file does not claim that ground.
//
// `matchMedia` is a stub. happy-dom will not re-evaluate a media query, so the breakpoint test
// drives NavRail's own reaction to the crossing, not the platform's detection of it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

// A stand-in for Link that keeps the one behaviour under test: `onNavigate` fires on activation.
// Next's own router is not exercised here — the assertions are about what the rail does with focus
// when a destination is chosen, never about how the route is resolved.
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, onNavigate, children, ...rest }: Record<string, unknown> & { href: string }) =>
      h(
        "a",
        {
          href,
          ...rest,
          onClick: (event: MouseEvent) => {
            event.preventDefault();
            (onNavigate as ((e: unknown) => void) | undefined)?.(event);
          },
        },
        children as never
      ),
  };
});

import { NavRail } from "@/components/shell/NavRail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { OPEN_PALETTE_EVENT } from "@/components/shell/modal";

const VISIBLE = ["/", "/crm", "/console"];
const COLLAPSE_KEY = "ascend-nav-collapsed";

type MediaListener = (event: { matches: boolean }) => void;

let mediaListeners: MediaListener[] = [];
let realMatchMedia: typeof window.matchMedia;

/** The shell's `<main id="content">`, which the overlays hand focus back to on navigation. */
function mountContent(): HTMLElement {
  const main = document.createElement("main");
  main.id = "content";
  main.tabIndex = -1;
  document.body.appendChild(main);
  return main;
}

const drawer = () => document.getElementById("mobile-navigation-dialog") as HTMLDialogElement;
const palette = () =>
  document.querySelector("dialog.ascend-command-palette") as HTMLDialogElement;
const trigger = () => screen.getByRole("button", { name: "Open navigation" });

/** Open the drawer and settle the queued focus move. */
async function openDrawer() {
  fireEvent.click(trigger());
  await waitFor(() => expect(drawer().open).toBe(true));
}

beforeEach(() => {
  mediaListeners = [];
  realMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: (_type: string, listener: MediaListener) => void mediaListeners.push(listener),
    removeEventListener: (_type: string, listener: MediaListener) => {
      mediaListeners = mediaListeners.filter((entry) => entry !== listener);
    },
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  nav.pathname = "/";
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  document.body.innerHTML = "";
});

describe("Mobile navigation drawer", () => {
  it("is labelled even when the desktop rail is collapsed, and offers no collapse control", async () => {
    // Acceptance 1. The collapse preference is a DESKTOP preference; the phone drawer has room for
    // words and no rail to collapse, so the two must not share a fate.
    localStorage.setItem(COLLAPSE_KEY, "1");
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    const inside = within(drawer());
    expect(inside.getByText("Galaxy")).toBeTruthy();
    expect(inside.getByText("Clients")).toBeTruthy();
    expect(inside.getByText("Console")).toBeTruthy();
    expect(inside.getByText("Command")).toBeTruthy(); // group heading
    expect(inside.getByText("Search")).toBeTruthy();

    expect(inside.queryByRole("button", { name: "Expand navigation" })).toBeNull();
    expect(inside.queryByRole("button", { name: "Collapse navigation" })).toBeNull();

    // The preference itself survives untouched for the desktop rail.
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("1");
  });

  it("states its own expanded state on the trigger", async () => {
    render(createElement(NavRail, { visible: VISIBLE }));
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await openDrawer();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe("mobile-navigation-dialog");
  });

  it("moves focus to the close control on open and back to the trigger on close", async () => {
    // Acceptance 2. Opening a modal and leaving focus behind it is the defect this replaces.
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    const close = within(drawer()).getByRole("button", { name: "Close navigation" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.click(close);
    await waitFor(() => expect(drawer().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("dismisses on the cancel event and restores focus", async () => {
    // Escape on a native dialog arrives as `cancel`. The handler must take it over so that the
    // browser's own close cannot skip the focus restoration.
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    fireEvent(drawer(), new Event("cancel", { bubbles: false, cancelable: true }));
    await waitFor(() => expect(drawer().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("does not let Escape reach the surface behind it", async () => {
    // Astra's clarification: "Escape must not also ascend the Galaxy behind it." The Galaxy listens
    // above the shell, so the drawer has to stop the key rather than merely act on it.
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    fireEvent.keyDown(drawer(), { key: "Escape" });
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener("keydown", behind);
  });

  it("closes on an outside click but not on a click within the panel", async () => {
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    fireEvent.click(within(drawer()).getByText("Clients"));
    // A link click closes by navigating, so assert containment with a non-navigating target first.
    await waitFor(() => expect(drawer().open).toBe(false));

    await openDrawer();
    fireEvent.click(drawer().querySelector("nav") as HTMLElement);
    expect(drawer().open).toBe(true);

    fireEvent.click(drawer()); // the dialog box itself — the region outside the panel
    await waitFor(() => expect(drawer().open).toBe(false));
  });

  it("hands focus to content rather than the trigger when a destination is chosen", async () => {
    // Acceptance 2/3: closing for navigation must not park focus on a launcher the user has left.
    const main = mountContent();
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    fireEvent.click(within(drawer()).getByText("Clients"));
    await waitFor(() => expect(drawer().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(main));
    expect(document.activeElement).not.toBe(trigger());
  });

  it("closes when the viewport crosses to the desktop breakpoint", async () => {
    // Otherwise the drawer survives a rotation as an invisible modal that swallows every click.
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();
    expect(mediaListeners.length).toBeGreaterThan(0);

    await act(async () => {
      mediaListeners.forEach((listener) => listener({ matches: true }));
    });
    await waitFor(() => expect(drawer().open).toBe(false));
  });
});

describe("Drawer to palette handoff", () => {
  it("closes the drawer and opens one palette, returning focus to the trigger", async () => {
    // Acceptance 3, and the "do not stack two competing modal surfaces" clause.
    const opened = vi.fn();
    window.addEventListener(OPEN_PALETTE_EVENT, opened as EventListener);
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    fireEvent.click(within(drawer()).getByText("Search"));
    await waitFor(() => expect(drawer().open).toBe(false));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));

    const event = opened.mock.calls[0][0] as CustomEvent<{ returnFocus?: HTMLElement | null }>;
    expect(event.detail.returnFocus).toBe(trigger());
    window.removeEventListener(OPEN_PALETTE_EVENT, opened as EventListener);
  });

  it("performs the same handoff for the global shortcut, opening the palette exactly once", async () => {
    // Both components listen for ⌘K globally. With the drawer open the rail claims the keystroke,
    // so the palette must open once — not toggle open and shut, and not open beneath a live drawer.
    render(createElement("div", null, createElement(NavRail, { visible: VISIBLE }), createElement(CommandPalette)));
    await openDrawer();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    await waitFor(() => expect(palette().open).toBe(true));
    expect(drawer().open).toBe(false);
    await waitFor(() =>
      expect(document.activeElement).toBe(within(palette()).getByRole("textbox", { name: "Search" }))
    );

    // The load-bearing half. If both components handle the same keystroke, the palette's own
    // listener runs second and overwrites the opener the drawer handed it with whatever happened to
    // hold focus — so closing would strand the user instead of returning them to the trigger. That
    // is the failure the capture-phase claim exists to prevent, and it is only visible on the way
    // back out.
    fireEvent.click(within(palette()).getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(palette().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });
});

describe("Shell layout contract", () => {
  it("gives the content region a programmatic focus target", () => {
    // Layer B, and deliberately a source-text assertion: `focus()` on an element with no tabindex is
    // a silent no-op in a browser, but happy-dom focuses anything — so a mounted test would pass
    // whether or not the attribute survives. The DOM cannot witness this one; the source can.
    const layout = readFileSync(path.resolve(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    const main = layout.match(/<main[^>]*id="content"[^>]*>/);
    expect(main).not.toBeNull();
    expect(main?.[0]).toContain("tabIndex={-1}");
  });
});

describe("Command palette", () => {
  const mount = () => render(createElement(CommandPalette));

  const open = async (returnFocus?: HTMLElement) => {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(OPEN_PALETTE_EVENT, { detail: { returnFocus: returnFocus ?? null } })
      );
    });
    await waitFor(() => expect(palette().open).toBe(true));
  };

  it("opens with the input focused and closes back to its opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    mount();
    await open(opener);

    const input = within(palette()).getByRole("textbox", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.click(within(palette()).getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(palette().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("restores its opener on cancel and keeps Escape off the surface behind it", async () => {
    const behind = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    mount();
    await open(opener);

    window.addEventListener("keydown", behind);
    fireEvent.keyDown(palette(), { key: "Escape" });
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener("keydown", behind);

    fireEvent(palette(), new Event("cancel", { bubbles: false, cancelable: true }));
    await waitFor(() => expect(palette().open).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("clears its term when dismissed, so it never reopens onto a stale search", async () => {
    mount();
    await open();
    const input = within(palette()).getByRole("textbox", { name: "Search" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme" } });
    expect(input.value).toBe("acme");

    fireEvent.click(within(palette()).getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(palette().open).toBe(false));

    await open();
    expect((within(palette()).getByRole("textbox", { name: "Search" }) as HTMLInputElement).value).toBe("");
  });

  it("toggles shut on a second shortcut press when it owns the modal layer alone", async () => {
    mount();
    await open();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => expect(palette().open).toBe(false));
  });
});

describe("Focus containment", () => {
  it("wraps Tab and Shift+Tab inside the open drawer", async () => {
    // Native modal dialogs contain focus in a real browser. The explicit wrap is what makes the
    // edge deterministic — and it is the only part of that behaviour a DOM test can observe.
    render(createElement(NavRail, { visible: VISIBLE }));
    await openDrawer();

    const controls = Array.from(
      drawer().querySelectorAll<HTMLElement>("a[href], button:not([disabled])")
    );
    expect(controls.length).toBeGreaterThan(1);
    const first = controls[0];
    const last = controls[controls.length - 1];

    last.focus();
    fireEvent.keyDown(drawer(), { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(drawer(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
