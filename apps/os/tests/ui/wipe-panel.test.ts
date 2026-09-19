// @vitest-environment happy-dom
//
// Slice 1C — THE WIPE PANEL, DRIVEN. The first test that has ever mounted it.
//
// D1 is a layout correction on the one surface in the product that destroys data. The layout claim
// itself (a 153px bar that parks 217px above the viewport bottom; a focused checkbox that no longer
// lands underneath it) is geometric and is measured in the browser — NOT here, and not claimed here.
//
// What this suite is for is the other half of that risk: proving that the surface still DOES what it
// did before the class hooks were added. The contract's own note is that the wipe write path is well
// covered at API level while no test had ever mounted the component, so the thing a layout slice
// could break silently — the selection, the typed confirmation, the exact request — was the thing
// nothing watched. It is watched now.
//
// Every assertion below is behaviour or structure. None of them is placement.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WipePanel } from "@/components/admin/WipePanel";
import type { WipeTargetGroup } from "@/core/admin/tools";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Shaped like the real groups — one default-on target, one default-off, one destructive — without
// naming real clients. The component receives these as data; it holds no target knowledge itself.
const GROUPS = [
  {
    group: "TRANSACTIONAL SIDECARS",
    items: [
      { key: "invoices", label: "Empty invoices.jsonl", sub: "seeded revenue", defaultOn: true },
      { key: "portal_invites", label: "Empty portal_invites.jsonl", sub: "revokes tokens", defaultOn: false },
    ],
  },
  {
    group: "DESTRUCTIVE — CRM FOLDERS",
    items: [{ key: "delete_client_pilar", label: "Delete a CRM folder", sub: "removes the profile", defaultOn: false }],
  },
] as unknown as readonly WipeTargetGroup[];

const mount = () => render(createElement(WipePanel, { groups: GROUPS }));
const executeButton = () => screen.getByRole("button", { name: /Execute wipe/ });
const confirmField = () => screen.getByPlaceholderText("WIPE");
const box = (label: string) => screen.getByRole("checkbox", { name: new RegExp(label) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Wipe panel · the selection", () => {
  it("opens with exactly the default-on targets checked", () => {
    mount();
    expect((box("Empty invoices.jsonl") as HTMLInputElement).checked).toBe(true);
    expect((box("Empty portal_invites.jsonl") as HTMLInputElement).checked).toBe(false);
    expect((box("Delete a CRM folder") as HTMLInputElement).checked).toBe(false);
    // The count in the confirmation label is derived from the selection, not maintained separately.
    expect(screen.getByText(/1 target selected/)).toBeTruthy();
  });

  it("toggles both ways and keeps the count honest", () => {
    mount();
    fireEvent.click(box("Delete a CRM folder"));
    expect(screen.getByText(/2 targets selected/)).toBeTruthy();
    fireEvent.click(box("Empty invoices.jsonl"));
    expect(screen.getByText(/1 target selected/)).toBeTruthy();
    fireEvent.click(box("Delete a CRM folder"));
    expect(screen.getByText(/0 targets selected/)).toBeTruthy();
  });

  it("gives every checkbox a wrapping label — the target the floor enlarges", () => {
    // Structural, not geometric: the 1C floor puts the 44px minimum on the LABEL, because
    // activating a label is what toggles the input it wraps. A checkbox that stopped being wrapped
    // would keep passing every behaviour test above while quietly losing its enlarged hit area.
    mount();
    for (const input of screen.getAllByRole("checkbox")) {
      expect(input.closest("label"), `${input.getAttribute("name") ?? "checkbox"} has no wrapping label`)
        .not.toBeNull();
    }
  });
});

describe("Wipe panel · the confirmation gate", () => {
  it("refuses to execute until the word is typed exactly", () => {
    mount();
    expect((executeButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirmField(), { target: { value: "wipe" } });
    expect((executeButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirmField(), { target: { value: "WIPE " } });
    expect((executeButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    expect((executeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses to execute with the word typed but nothing selected", () => {
    mount();
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    fireEvent.click(box("Empty invoices.jsonl"));
    expect(screen.getByText(/0 targets selected/)).toBeTruthy();
    expect((executeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends nothing at all while the gate is shut", async () => {
    mount();
    fireEvent.click(executeButton());
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

describe("Wipe panel · the request", () => {
  it("posts the typed confirmation and the CURRENT selection, and nothing else", async () => {
    mount();
    fireEvent.click(box("Delete a CRM folder"));
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    fireEvent.click(executeButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/wipe");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ confirm: "WIPE", targets: ["invoices", "delete_client_pilar"] });
    // The route authorizes independently; this only proves the panel asks for what was chosen.
    expect(Object.keys(body).sort()).toEqual(["confirm", "targets"]);
  });

  it("clears the confirmation and refreshes after a successful wipe", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ target: "invoices", result: "emptied" }] }), { status: 200 })
    );
    mount();
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    fireEvent.click(executeButton());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Re-arming is deliberate: a second wipe must be typed out again.
    expect((confirmField() as HTMLInputElement).value).toBe("");
    expect((executeButton() as HTMLButtonElement).disabled).toBe(true);
    const results = screen.getByText(/wipe complete/);
    expect(within(results.closest("section")!).getByText("invoices")).toBeTruthy();
  });

  it("shows the server's refusal and does NOT refresh", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    mount();
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    fireEvent.click(executeButton());

    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
    // The typed confirmation survives a refusal — the operator is not made to retype after a 403.
    expect((confirmField() as HTMLInputElement).value).toBe("WIPE");
  });

  it("reports a transport failure instead of looking like a success", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    mount();
    fireEvent.change(confirmField(), { target: { value: "WIPE" } });
    fireEvent.click(executeButton());

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/wipe complete/)).toBeNull();
  });
});
