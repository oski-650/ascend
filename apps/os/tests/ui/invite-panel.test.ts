// @vitest-environment happy-dom
//
// Layer B — THE OWNER MINTS THROUGH THE UI (2G.3, STAGE2G §28.4/§28.12).
//
// §28.12 requires that "owner mints THROUGH THE UI and copies a link", and adds the clause this
// suite exists to satisfy:
//
//   > presence is not behaviour
//
// F58 proves the panel imports the right invitation primitive. That is a source-text fact and says
// nothing about whether the component works. This mounts it and drives it.
//
// ─── IT IS NOT AN AUTHORIZATION TEST, AND MUST NOT BECOME ONE ──────────────────────────────────
//
// The panel sends a request; the ROUTE decides. So this suite asserts what the component SENDS and
// RENDERS, never who is allowed to send it — `tests/api/invitations-mint.test.ts` owns that, and the
// database owns the boundary underneath it. A test here that asserted "sales cannot mint" would be
// asserting a client-side check that deliberately does not exist.
//
// ─── THE ENVIRONMENT IS FILE-SCOPED ────────────────────────────────────────────────────────────
//
// happy-dom for this file only; the project default stays `node`. happy-dom has fewer browser APIs
// than a real browser and does not implement the clipboard, so `navigator.clipboard` is stubbed
// rather than assumed — a copy assertion that failed for a missing API would be reporting on the
// test environment, not on the panel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { InvitePartnerPanel, type InviteCandidate } from "@/components/InvitePartnerPanel";

const PARTNER: InviteCandidate = {
  id: "0198f3a1-2b4c-7d8e-9f01-00000000cccc",
  email: "partner@test",
  displayName: "Partner Person",
  role: "sales",
};
const SECOND: InviteCandidate = {
  id: "0198f3a1-2b4c-7d8e-9f01-00000000dddd",
  email: "second@test",
  displayName: "Second Person",
  role: "sales",
};

const BASE = "https://os.example";
const TOKEN = "zt7Kq2W9m3Xb5Yc8Nd1Pf4Rg6Sh0Tj2";

let fetchMock: ReturnType<typeof vi.fn>;
let written: string[];

/** A response shaped like the real route's, so the panel is driven by what it will actually meet. */
const minted = (token = TOKEN) =>
  ({ ok: true, json: async () => ({ token, id: "inv-1", expiresAt: "2030-01-01T00:00:00.000Z" }) });
const refused = (status: number, error: string) =>
  ({ ok: false, status, json: async () => ({ error }) });

const mount = (candidates: InviteCandidate[] = [PARTNER, SECOND]) =>
  render(createElement(InvitePartnerPanel, { candidates, baseUrl: BASE }));

beforeEach(() => {
  written = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // happy-dom provides no clipboard. Stubbed so a copy assertion measures the panel, not the DOM.
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    clipboard: { writeText: async (t: string) => { written.push(t); } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InvitePartnerPanel · minting", () => {
  it("offers every candidate, and posts the SELECTED one to the operator route", async () => {
    fetchMock.mockResolvedValue(minted());
    mount();

    // Select the second person, so a panel that always sent the first would fail here.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: SECOND.id } });
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url, "the panel posted somewhere other than the operator route").toBe("/api/invitations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ userId: SECOND.id });
  });

  it("sends NO organization — the route derives it from the principal (§28.4)", async () => {
    fetchMock.mockResolvedValue(minted());
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(Object.keys(body), "the panel volunteered an authorization fact").toEqual(["userId"]);
  });

  it("renders the one-time link built from the returned token", async () => {
    fetchMock.mockResolvedValue(minted());
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await screen.findByText(`${BASE}/invite/${TOKEN}`);
  });

  it("copies THAT link to the clipboard", async () => {
    fetchMock.mockResolvedValue(minted());
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await screen.findByRole("button", { name: /copy link/i });
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(written).toEqual([`${BASE}/invite/${TOKEN}`]));
  });

  it("states the multiple-live-invitation property §28.3 requires, before anything is minted", async () => {
    // Not decoration: the owner role holds no UPDATE on invitations, so a link cannot be revoked —
    // only outlived. An operator who mints twice needs to know the first still works.
    mount();
    expect(screen.getByText(/multiple active invitation links can exist/i)).toBeTruthy();
    expect(screen.getByText(/used once and expires automatically/i)).toBeTruthy();
  });
});

describe("InvitePartnerPanel · refusals", () => {
  it("surfaces the route's reason, and shows NO link", async () => {
    fetchMock.mockResolvedValue(refused(404, "not a member of this organization"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));

    await screen.findByText(/not a member of this organization/i);
    expect(screen.queryByRole("button", { name: /copy link/i }),
      "a refused mint still offered a link to copy").toBeNull();
    expect(document.body.textContent, "a refused mint rendered a token").not.toContain(TOKEN);
  });

  it("a malformed-id 400 is surfaced the same way — the route's 400 reaches the operator", async () => {
    fetchMock.mockResolvedValue(refused(400, "userId must be a uuid"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await screen.findByText(/userId must be a uuid/i);
  });

  it("a network failure does not leave the button stuck", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await screen.findByText(/could not be issued/i);
    // `busy` must clear in the `finally`, or the owner cannot retry without reloading.
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /issue invitation link/i }) as HTMLButtonElement).disabled)
        .toBe(false));
  });

  it("with NOBODY to invite it explains why, and offers no control", () => {
    // Provisioning is operational (§28.2 ruling 1). The empty state has to say so, or an owner will
    // look here for a "create user" button that must never exist.
    mount([]);
    expect(screen.getByText(/nobody to invite/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /issue invitation link/i })).toBeNull();
  });
});

describe("InvitePartnerPanel · it is not an authorization layer", () => {
  it("mints again after a refusal — the client never decides who may", async () => {
    // A panel that disabled itself after a 404 would be enforcing a rule the route owns, and would
    // diverge from it the moment the route changed. It asks again; the route answers again.
    fetchMock.mockResolvedValueOnce(refused(404, "not a member of this organization"));
    fetchMock.mockResolvedValueOnce(minted());
    mount();
    const button = () => screen.getByRole("button", { name: /issue invitation link/i });

    fireEvent.click(button());
    await screen.findByText(/not a member of this organization/i);
    fireEvent.click(button());

    await screen.findByText(`${BASE}/invite/${TOKEN}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the token is never written anywhere but the DOM it renders", async () => {
    // §28.4: the response is the single moment the plaintext exists outside the operator's
    // clipboard. It must not be persisted for a "show it again" affordance that cannot exist.
    fetchMock.mockResolvedValue(minted());
    mount();
    fireEvent.click(screen.getByRole("button", { name: /issue invitation link/i }));
    await screen.findByText(`${BASE}/invite/${TOKEN}`);
    expect(window.localStorage.getItem("ascend-invite")).toBeNull();
    expect(JSON.stringify(window.localStorage), "the token reached localStorage").not.toContain(TOKEN);
    expect(window.location.href, "the token reached the URL").not.toContain(TOKEN);
  });
});
