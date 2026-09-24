// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AssignmentMenu } from "@/components/sales/AssignmentMenu";
import { FollowUpEditor } from "@/components/sales/FollowUpEditor";
import { ReopenProspect } from "@/components/sales/ReopenProspect";
import { ProspectNow } from "@/components/sales/ProspectNow";
import type { ActionSummary } from "@/core/crm/sales";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const A = "01920000-0000-7000-8000-00000000000a";
const B = "01920000-0000-7000-8000-00000000000b";
const F = "01920000-0000-7000-8000-00000000000f";
const names = { [A]: "Oscar", [B]: "Maria" };
const followUp = { followupId: F, action: "call", assignee: A, dueOn: "2026-09-25", dueAt: null };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const applied = () => json(201, { ok: true, status: "applied", commandId: "id-1", outcome: {} });
const sent = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
};
let ids = 0;
const mintId = () => `id-${++ids}`;

beforeEach(() => { sessionStorage.clear(); ids = 0; refresh.mockClear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe("owner assignment", () => {
  it("requires an explicit open-follow-up choice, then sends the frozen route body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(applied());
    render(createElement(AssignmentMenu, { slug: "acme", rowId: A, assignedTo: A, names, openFollowUp: followUp, fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Reassign / unassign" }));
    const dialog = screen.getByRole("dialog", { name: "Manage assignment" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Assign to" }), { target: { value: B } });
    expect((within(dialog).getByRole("button", { name: "Save assignment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Transfer it to Maria" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save assignment" })); });
    expect(sent(fetchMock)).toEqual({ url: "/api/prospects/acme/assignment", method: "POST", body: {
      commandId: "id-1", mode: "reassign", expectedAssignee: A, to: B, openFollowUp: "transfer",
    } });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("unassign offers leave or cancel, never transfer, and reuses the id after a lost response", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(applied());
    render(createElement(AssignmentMenu, { slug: "acme", rowId: A, assignedTo: A, names, openFollowUp: followUp, fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Reassign / unassign" }));
    const dialog = screen.getByRole("dialog", { name: "Manage assignment" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Assign to" }), { target: { value: "" } });
    expect(within(dialog).queryByRole("radio", { name: /Transfer/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Cancel the follow-up" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save assignment" })); });
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeTruthy();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Retry" })); });
    expect(sent(fetchMock, 0).body).toEqual(sent(fetchMock, 1).body);
    expect(sent(fetchMock, 1).body).toEqual({ commandId: "id-1", mode: "unassign", expectedAssignee: A, openFollowUp: "cancel" });
  });

  it("requires a second confirmation after assignment_conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(409, { ok: false, error: "assignment_conflict", detail: { current: B } })).mockResolvedValueOnce(applied());
    render(createElement(AssignmentMenu, { slug: "acme", rowId: A, assignedTo: A, names, openFollowUp: null, fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Reassign / unassign" }));
    const dialog = screen.getByRole("dialog", { name: "Manage assignment" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Assign to" }), { target: { value: B } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save assignment" })); });
    expect((within(dialog).getByRole("button", { name: "Save assignment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole("button", { name: "I reviewed the current assignment" })).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("owner follow-up edit and reopen", () => {
  it("sends exact expected values and only the edited fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(applied());
    render(createElement(FollowUpEditor, { slug: "acme", rowId: A, followUp, names, fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));
    const dialog = screen.getByRole("dialog", { name: "Edit open follow-up" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Action" }), { target: { value: "email" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save follow-up" })); });
    expect(sent(fetchMock)).toEqual({ url: `/api/prospects/acme/followups/${F}`, method: "PATCH", body: {
      commandId: "id-1", expected: { action: "call", assignee: A, dueOn: "2026-09-25", dueAt: null }, changes: { action: "email" },
    } });
  });

  it("resolves Pacific time and refuses a DST gap before sending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(applied());
    render(createElement(FollowUpEditor, { slug: "acme", rowId: A, followUp, names, fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));
    const dialog = screen.getByRole("dialog", { name: "Edit open follow-up" });
    fireEvent.change(within(dialog).getByLabelText("Due date · PT"), { target: { value: "2027-03-14" } });
    fireEvent.change(within(dialog).getByLabelText("Time · PT (optional)"), { target: { value: "02:30" } });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/doesn't exist/);
    expect((within(dialog).getByRole("button", { name: "Save follow-up" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Time · PT (optional)"), { target: { value: "03:00" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save follow-up" })); });
    expect((sent(fetchMock).body.changes as Record<string, unknown>).dueAt).toEqual({ local: "2027-03-14T03:00", offset: "-07:00" });
  });

  it("reopen requires an explicit stage and sends expectedStage closed-lost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(applied());
    render(createElement(ReopenProspect, { slug: "acme", rowId: A, stage: "closed-lost", fetchImpl: fetchMock as typeof fetch, mintId }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen prospect" }));
    const dialog = screen.getByRole("dialog", { name: "Reopen closed-lost prospect" });
    expect((within(dialog).getByRole("button", { name: "Reopen" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Contacted" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" })); });
    expect(sent(fetchMock)).toEqual({ url: "/api/prospects/acme/actions", method: "POST", body: {
      commandId: "id-1", expectedStage: "closed-lost", stage: { to: "contacted" },
    } });
  });
});

it("Now card renders follow-up editing only when the server grants manage", () => {
  const summary = { id: A, openFollowUp: followUp, assignedTo: A, dueState: "today", latestContact: null, lastContact: null } as ActionSummary;
  const props = { summary, names, viewer: A, contactName: null, phone: null, email: null, website: null, slug: "acme" };
  const sales = render(createElement(ProspectNow, { ...props, canManage: false }));
  expect(sales.queryByRole("button", { name: "Edit follow-up" })).toBeNull();
  sales.unmount();
  render(createElement(ProspectNow, { ...props, canManage: true }));
  expect(screen.getByRole("button", { name: "Edit follow-up" })).toBeTruthy();
});
