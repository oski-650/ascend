// @vitest-environment happy-dom
//
// Slice 2A.2b — the prospect workspace and the Record contact sheet, driven the way an operator
// drives them: tap Call, come back, pick an outcome, save — and every answer the frozen route contract
// can give, including the ones that only happen when the network or another salesperson interferes.
//
// These COMPLEMENT the route and domain suites (sales-routes, sales-actions); they do not replace
// them. What is asserted here is what the BROWSER sends and shows: the body, the command id, the
// draft in sessionStorage, and the words on screen.
//
// happy-dom has no layout and no stylesheet, so nothing here claims anything about geometry, focus
// VISIBILITY or touch size — those belong to the rendered CDP pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { CallButton, RecordButton, SalesWorkspace, WorkspaceNotices } from "@/components/sales/SalesWorkspace";
import type { SheetProspect } from "@/components/sales/RecordContactSheet";
import { CALL_KEY, DRAFT_KEY, loadDraft, saveDraft, startCall } from "@/components/sales/command-state";
import { emptyDraft } from "@/components/sales/record-draft";
// The configured test glob is *.test.ts; collect the owner-control JSX tests here until that glob widens.
import "./owner-controls.test";

// 2026-09-22 14:14 PDT
const T0 = Date.parse("2026-09-22T21:14:00Z");
let nowMs = T0;
const clock = () => new Date(nowMs);

const A = "01920000-0000-7000-8000-00000000000a";
const B = "01920000-0000-7000-8000-00000000000b";
const base: SheetProspect = {
  rowId: A, slug: "tapia-tile", name: "Tapia Tile", stage: "lead", assignedTo: null, assigneeName: null,
  viewerIsAssignee: false, openFollowUp: null, lastChannel: null,
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const applied = () => json(201, { ok: true, status: "applied", commandId: "x", outcome: {} });
let ids = 0;
const mintId = () => `id-${++ids}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a parsed request body, probed by shape
const sent = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((f.mock.calls[i][1] as { body: string }).body) as Record<string, any>;

function mount(over: Partial<SheetProspect> = {}, opts: { fetch?: ReturnType<typeof vi.fn>; serverLock?: "held" | "archived" | null; phone?: string | null } = {}) {
  const fetchMock = opts.fetch ?? vi.fn().mockResolvedValue(applied());
  const prospect = { ...base, ...over };
  const utils = render(createElement(SalesWorkspace, {
    prospect, phone: opts.phone === undefined ? "(209) 555-0100" : opts.phone, serverLock: opts.serverLock ?? null,
    more: createElement("span", null, "more"), clock, fetchImpl: fetchMock as unknown as typeof fetch, mintId,
  } as never, createElement(WorkspaceNotices), createElement("div", { "data-testid": "header" }, createElement(CallButton), createElement(RecordButton))));
  return { fetchMock, ...utils };
}

const header = () => within(screen.getByTestId("header"));
const dialog = () => screen.getByRole("dialog", { name: "Record contact" });
const isOpen = () => (document.querySelector("dialog.sales-sheet:not(.sales-sheet--more)") as HTMLDialogElement | null)?.open === true;
const openManually = () => fireEvent.click(header().getByRole("button", { name: /Record contact/ }));
const choose = (name: string | RegExp) => fireEvent.click(within(dialog()).getByRole("radio", { name }));
const saveButton = () => within(dialog()).getByRole("button", { name: /^(Save|Retry|Try again|Save without claiming|Save contact only)$/ });
async function save() { await act(async () => { fireEvent.click(saveButton()); }); }

beforeEach(() => { sessionStorage.clear(); ids = 0; nowMs = T0; refresh.mockClear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

// ─── Call → return ───────────────────────────────────────────────────────────────────────────

describe("Call → return", () => {
  it("Call writes the pending-call state BEFORE the tel: navigation, and is a real tel: link", () => {
    mount();
    const link = header().getByRole("link", { name: "Call Tapia Tile, (209) 555-0100" });
    expect(link.getAttribute("href")).toBe("tel:2095550100");
    let seenAtDefault: string | null = null;
    // Bubble phase at the window runs after React's handler and before the default action.
    const probe = (e: Event) => { seenAtDefault = sessionStorage.getItem(CALL_KEY); e.preventDefault(); };
    window.addEventListener("click", probe);
    fireEvent.click(link);
    window.removeEventListener("click", probe);
    expect(JSON.parse(seenAtDefault!)).toMatchObject({ v: 1, prospect: A, ref: "tapia-tile", startedAt: new Date(T0).toISOString() });
    // Tapping Call is not a contact: nothing is open, nothing is sent.
    expect(isOpen()).toBe(false);
  });

  it("coming back to the page opens Record contact with the call's START time and no outcome chosen", async () => {
    const { fetchMock } = mount();
    startCall(A, "tapia-tile", T0);
    nowMs = T0 + 4 * 60_000; // a four-minute call
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(isOpen()).toBe(true);
    expect(within(dialog()).getByText(/Call started 2:14 PM PT/)).toBeTruthy();
    expect(within(dialog()).getAllByRole("radio", { checked: true }).map((r) => (r as HTMLInputElement).name))
      .not.toContainEqual(expect.stringMatching(/outcome$/));
    choose("No answer");
    await save();
    expect(sent(fetchMock).contact).toEqual({ outcome: "no_answer", channel: "call", happenedAt: new Date(T0).toISOString() });
    expect(sessionStorage.getItem(CALL_KEY)).toBeNull();
  });

  it("the same return via window focus works too — no 'call ended' callback is relied on", async () => {
    mount();
    startCall(A, "tapia-tile", T0);
    nowMs = T0 + 90_000;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(isOpen()).toBe(true);
  });

  it("a stale pending call (> 30 min) is ignored and cleared", async () => {
    startCall(A, "tapia-tile", T0 - 31 * 60_000);
    mount();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(isOpen()).toBe(false);
    expect(sessionStorage.getItem(CALL_KEY)).toBeNull();
  });

  it("a pending call for ANOTHER prospect never opens this one's sheet", async () => {
    startCall(B, "other", T0 - 60_000);
    mount();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(isOpen()).toBe(false);
  });

  it("Record contact is reachable by hand with no call at all", () => {
    mount({}, { phone: null });
    expect(header().queryByRole("link", { name: /^Call/ })).toBeNull();
    openManually();
    expect(isOpen()).toBe(true);
    expect(within(dialog()).getByText(/Just now/)).toBeTruthy();
  });

  it("dismissing the sheet keeps the draft and ends the call offer", async () => {
    mount();
    startCall(A, "tapia-tile", T0);
    nowMs = T0 + 60_000;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    choose("Spoke");
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Close. Your entry is kept." })); });
    expect(isOpen()).toBe(false);
    expect(sessionStorage.getItem(CALL_KEY)).toBeNull();
    expect(loadDraft<{ outcome: string }>(A)!.draft.outcome).toBe("spoke");
  });
});

// ─── the sheet ───────────────────────────────────────────────────────────────────────────────

describe("outcome, channel, note", () => {
  it("six common outcomes are visible; the rest are behind More, and no enum string is shown", () => {
    mount();
    openManually();
    const names = within(dialog()).getAllByRole("radio").filter((r) => (r as HTMLInputElement).name.endsWith("outcome"))
      .map((r) => r.closest("label")!.textContent!.replace("✓", ""));
    expect(names).toEqual(["No answer", "Voicemail", "Spoke", "Interested", "Callback requested", "Meeting set"]);
    fireEvent.click(within(dialog()).getByRole("button", { name: "More…" }));
    choose("Wrong number");
    expect(dialog().textContent).not.toMatch(/no_answer|callback_requested|wrong_number|in_person/);
  });

  it("voicemail is always a call: the other channels are disabled and no error is ever shown", async () => {
    const { fetchMock } = mount({ lastChannel: "text" });
    openManually();
    choose("Spoke");
    expect((within(dialog()).getByRole("radio", { name: "Text" }) as HTMLInputElement).checked).toBe(true);
    choose("Voicemail");
    expect((within(dialog()).getByRole("radio", { name: "Call" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog()).getByRole("radio", { name: "Text" }) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog()).getByText("Voicemail is always a call.")).toBeTruthy();
    await save();
    expect(sent(fetchMock).contact).toEqual({ outcome: "voicemail", channel: "call" });
  });

  it("email sent is always an email", async () => {
    const { fetchMock } = mount();
    openManually();
    fireEvent.click(within(dialog()).getByRole("button", { name: "More…" }));
    choose("Email sent");
    await save();
    expect(sent(fetchMock).contact.channel).toBe("email");
  });

  it("the note is optional, and sent with the contact when written", async () => {
    const { fetchMock } = mount();
    openManually();
    choose("Spoke");
    await save();
    expect(sent(fetchMock).contact).not.toHaveProperty("note");
    fetchMock.mockResolvedValueOnce(applied());
    openManually();
    choose("Interested");
    fireEvent.click(within(dialog()).getByRole("button", { name: "+ Add a note" }));
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Note" }), { target: { value: "  Wants a quote  " } });
    await save();
    expect(sent(fetchMock, 1).contact.note).toBe("Wants a quote");
  });
});

describe("stage", () => {
  it("Lead → Contacted is SUGGESTED after a meaningful contact and applies only when tapped", async () => {
    const { fetchMock } = mount();
    openManually();
    choose("Spoke");
    const suggestion = within(dialog()).getByRole("button", { name: "Move Lead → Contacted?" });
    expect(suggestion.getAttribute("aria-pressed")).toBe("false");
    await save();
    expect(sent(fetchMock)).not.toHaveProperty("stage");

    fetchMock.mockResolvedValueOnce(applied());
    openManually();
    choose("Spoke");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Move Lead → Contacted?" }));
    await save();
    expect(sent(fetchMock, 1)).toMatchObject({ expectedStage: "lead", stage: { to: "contacted" } });
  });

  it("never offered after No answer, and Closed · Won is never a choice", () => {
    mount();
    openManually();
    choose("No answer");
    expect(within(dialog()).queryByRole("button", { name: /Move Lead/ })).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Change stage" }));
    const stages = within(dialog()).getAllByRole("radio").filter((r) => (r as HTMLInputElement).name.endsWith("stage"))
      .map((r) => r.closest("label")!.textContent);
    expect(stages.join("|")).not.toMatch(/Won/);
  });

  it("closed-lost requires a reason, says the open follow-up will be cancelled, and sends the reason", async () => {
    const { fetchMock } = mount({ openFollowUp: { action: "call", dueOn: "2026-09-24", dueAt: null, assigneeName: "you" }, stage: "contacted" });
    openManually();
    fireEvent.click(within(dialog()).getByRole("button", { name: "More…" }));
    choose("Not interested");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Change stage" }));
    choose("Closed · Lost");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).getAllByText("Choose why it was lost.").length).toBeGreaterThan(0);
    expect(within(dialog()).getByText(/This cancels the open follow-up \(Call · Thu, Sep 24 · any time\)/)).toBeTruthy();
    choose("No budget");
    await save();
    expect(sent(fetchMock)).toMatchObject({ expectedStage: "contacted", stage: { to: "closed-lost", lostReason: "no_budget" } });
    expect(sent(fetchMock)).not.toHaveProperty("followUp");
  });
});

describe("a closed-lost prospect (D-2: closed-lost → closed-won only through Promote)", () => {
  it("offers no stage control at all — nothing implies an ordinary reopen — and no follow-up", async () => {
    const { fetchMock } = mount({ stage: "closed-lost" });
    openManually();
    expect(within(dialog()).queryByRole("button", { name: "Change stage" })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /Move .* →/ })).toBeNull();
    expect(dialog().querySelectorAll('input[name$="-stage"]').length).toBe(0);
    expect(within(dialog()).getByText("Closed. Only the owner can reopen it.")).toBeTruthy();
    expect(within(dialog()).getByText(/No follow-up — a closed prospect doesn't get one/)).toBeTruthy();
    // A contact can still be recorded on it; the Save carries no stage and no follow-up.
    choose("Spoke");
    await save();
    expect(Object.keys(sent(fetchMock)).sort()).toEqual(["commandId", "contact"]);
  });
});

describe("claim", () => {
  it("unassigned: a noticeable switch that starts OFF, and nothing is claimed unless it is turned on", async () => {
    const { fetchMock } = mount();
    openManually();
    const sw = within(dialog()).getByRole("switch", { name: /Claim this prospect/ }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    choose("Spoke");
    await save();
    expect(sent(fetchMock)).not.toHaveProperty("claim");
    fetchMock.mockResolvedValueOnce(applied());
    openManually();
    choose("Spoke");
    fireEvent.click(within(dialog()).getByRole("switch", { name: /Claim this prospect/ }));
    await save();
    expect(sent(fetchMock, 1).claim).toBe(true);
  });

  it("assigned: no switch, the assignee is named", () => {
    mount({ assignedTo: "u-maria", assigneeName: "Maria" });
    openManually();
    expect(within(dialog()).queryByRole("switch")).toBeNull();
    expect(within(dialog()).getByText("Assigned to Maria.")).toBeTruthy();
  });
});

describe("follow-up", () => {
  it("a preset shows the resolved Pacific date and time before Save, and sends it with its offset", async () => {
    const { fetchMock } = mount();
    openManually();
    choose("Spoke");
    choose("Tomorrow");
    expect(within(dialog()).getByTestId("follow-preview").textContent).toMatch(/Call · Wed, Sep 23 · 9:00 AM PT.*Pacific time/);
    await save();
    expect(sent(fetchMock).followUp).toEqual({ schedule: { action: "call", dueOn: "2026-09-23", dueAt: { local: "2026-09-23T09:00", offset: "-07:00" } } });
  });

  it("a manual time in the spring-forward gap is explained and blocked, with a one-tap fix", async () => {
    const { fetchMock } = mount();
    openManually();
    choose("Spoke");
    choose("Pick date…");
    fireEvent.change(within(dialog()).getByLabelText("Date"), { target: { value: "2027-03-14" } });
    fireEvent.change(within(dialog()).getByLabelText("Time (optional)"), { target: { value: "02:30" } });
    // Explained at the picker AND beside the disabled Save — never only by disabling it.
    expect(within(dialog()).getAllByText(/2:30 AM doesn't exist on Sun, Mar 14, 2027/).length).toBe(2);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(dialog().textContent).not.toMatch(/nonexistent|offset|UTC/);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Use 3:00 AM instead" }));
    await save();
    expect(sent(fetchMock).followUp.schedule).toMatchObject({ dueOn: "2027-03-14", dueAt: { local: "2027-03-14T03:00", offset: "-07:00" } });
  });

  it("a fall-back hour asks which 1:30 — nothing is chosen for the operator", async () => {
    const { fetchMock } = mount();
    openManually();
    choose("Spoke");
    choose("Pick date…");
    fireEvent.change(within(dialog()).getByLabelText("Date"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dialog()).getByLabelText("Time (optional)"), { target: { value: "01:30" } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    choose("1:30 AM PST (second)");
    await save();
    expect(sent(fetchMock).followUp.schedule.dueAt).toEqual({ local: "2026-11-01T01:30", offset: "-08:00" });
  });

  it("the server's DST refusal is shown in words at the picker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(422, { ok: false, error: "nonexistent_local_time", detail: { why: "x" } }));
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    choose("Tomorrow");
    await save();
    expect(within(dialog()).getByText(/doesn't exist in Pacific time/)).toBeTruthy();
    expect(isOpen()).toBe(true);
  });
});

// ─── the route contract, answer by answer ────────────────────────────────────────────────────

describe("what each answer does", () => {
  it("a lost response keeps the id: Retry resends the SAME id and body, and the form is locked meanwhile", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(200, { ok: true, status: "replayed", commandId: "id-1", outcome: {} }));
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    choose("Tomorrow");
    await save();
    expect(screen.getByTestId("sheet-alert").textContent).toMatch(/couldn't confirm .* Retry is safe/);
    expect((within(dialog()).getByRole("radio", { name: "Interested" }).closest(".sales-sheet-body > fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    // Time moves on — "Tomorrow" must NOT be recomputed into a different command.
    nowMs = T0 + 12 * 3_600_000;
    await save(); // the button now reads Retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(fetchMock, 1).commandId).toBe(sent(fetchMock, 0).commandId);
    expect(sent(fetchMock, 1)).toEqual(sent(fetchMock, 0));
    expect(isOpen()).toBe(false);
  });

  it("an uncertain save survives a reload: the sheet reopens locked, and Retry reuses the stored id", async () => {
    const first = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { unmount } = mount({}, { fetch: first });
    openManually();
    choose("Spoke");
    await save();
    unmount();
    const second = vi.fn().mockResolvedValue(json(200, { ok: true, status: "replayed", commandId: "id-1", outcome: {} }));
    mount({}, { fetch: second });
    expect(screen.getByText(/A save may not have gone through/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review and retry" }));
    await save();
    expect(sent(second).commandId).toBe(sent(first).commandId);
  });

  it("a replay is presented as a normal save — never 'duplicate'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, status: "replayed", commandId: "id-1", outcome: {} }));
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    await save();
    expect(isOpen()).toBe(false);
    expect(screen.getByTestId("workspace-status").textContent).toBe("Saved.");
    expect(document.body.textContent).not.toMatch(/duplicate|replay/i);
    expect(refresh).toHaveBeenCalled();
  });

  it("success clears the draft", async () => {
    mount();
    openManually();
    choose("Spoke");
    expect(loadDraft(A)).not.toBeNull();
    await save();
    expect(loadDraft(A)).toBeNull();
  });

  it("stage_conflict keeps the draft, shows the current stage, asks again, and the resubmission is a NEW command", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "stage_conflict", detail: { current: "proposal" } }))
      .mockResolvedValueOnce(applied());
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Interested");
    fireEvent.click(within(dialog()).getByRole("button", { name: "+ Add a note" }));
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Note" }), { target: { value: "Budget approved" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Move Lead → Contacted?" }));
    await save();
    expect(screen.getByTestId("sheet-alert").textContent).toMatch(/stage changed to Proposal/);
    expect((within(dialog()).getByRole("radio", { name: "Interested" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog()).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe("Budget approved");
    expect(refresh).toHaveBeenCalled();
    // The stage choice was cleared: the operator must re-decide it.
    expect((within(dialog()).getByRole("radio", { name: "Keep Proposal" }) as HTMLInputElement).checked).toBe(true);
    await save();
    expect(sent(fetchMock, 1).commandId).not.toBe(sent(fetchMock, 0).commandId);
    expect(sent(fetchMock, 1)).not.toHaveProperty("stage");
    expect(sent(fetchMock, 1).contact.note).toBe("Budget approved");
  });

  it("already_assigned offers Save without claiming — contact and follow-up kept, new id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "already_assigned" }))
      .mockResolvedValueOnce(applied());
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    choose("Tomorrow");
    fireEvent.click(within(dialog()).getByRole("switch", { name: /Claim this prospect/ }));
    await save();
    expect(screen.getByTestId("sheet-alert").textContent).toMatch(/Someone else claimed/);
    expect(within(dialog()).queryByRole("switch")).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save without claiming" }));
    await act(async () => {});
    const second = sent(fetchMock, 1);
    expect(second).not.toHaveProperty("claim");
    expect(second.contact.outcome).toBe("spoke");
    expect(second.followUp).toEqual(sent(fetchMock, 0).followUp);
    expect(second.commandId).not.toBe(sent(fetchMock, 0).commandId);
  });

  it("followup_owned_by_other offers Save contact only — outcome and note kept, a NEW id, nothing else sent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "followup_owned_by_other", fallback: { contactOnly: true, newCommandIdRequired: true } }))
      .mockResolvedValueOnce(applied());
    mount({ openFollowUp: { action: "call", dueOn: "2026-09-24", dueAt: null, assigneeName: "Maria" }, assignedTo: "u-maria", assigneeName: "Maria" }, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    fireEvent.click(within(dialog()).getByRole("button", { name: "+ Add a note" }));
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Note" }), { target: { value: "Left details" } });
    choose("Tomorrow");
    await save();
    expect(screen.getByTestId("sheet-alert").textContent).toMatch(/Maria owns the open follow-up/);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save contact only" }));
    await act(async () => {});
    const second = sent(fetchMock, 1);
    expect(Object.keys(second).sort()).toEqual(["commandId", "contact"]);
    expect(second.contact).toEqual({ outcome: "spoke", channel: "call", note: "Left details" });
    expect(second.commandId).not.toBe(sent(fetchMock, 0).commandId);
    expect(isOpen()).toBe(false);
  });

  it("command_id_conflict: a generic, safe retry under a new id — nothing about the other command", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "command_id_conflict" }))
      .mockResolvedValueOnce(applied());
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    await save();
    expect(screen.getByTestId("sheet-alert").textContent).toBe("This couldn't be saved. Your entry is kept — try again.");
    // Focus is not left on <body>: it returns to the action the operator must take next.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(document.activeElement?.textContent).toBe("Try again");
    await save(); // "Try again"
    expect(sent(fetchMock, 1).commandId).not.toBe(sent(fetchMock, 0).commandId);
  });

  it.each(["archived_prospect", "held_prospect"])("%s closes the sheet and removes every mutation control", async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(json(409, { ok: false, error: code }));
    mount({}, { fetch: fetchMock });
    openManually();
    choose("Spoke");
    await save();
    expect(isOpen()).toBe(false);
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Call / })).toBeNull();
    expect(screen.getAllByText(code === "archived_prospect" ? /Archived — contacts can't be recorded/ : /On hold for identity review/).length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalled();
    // The draft is kept for the operator to copy from; only the command was forgotten.
    expect(loadDraft<{ outcome: string }>(A)!.draft.outcome).toBe("spoke");
  });

  it("a prospect the server reports as held renders no Record, no Call, and never auto-opens", async () => {
    startCall(A, "tapia-tile", T0 - 60_000);
    mount({}, { serverLock: "held" });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Call / })).toBeNull();
    expect(document.querySelector("dialog.sales-sheet:not(.sales-sheet--more)")).toBeNull();
  });
});

describe("drafts are per prospect, in sessionStorage only", () => {
  it("a reload restores the draft; switching prospects never shows another prospect's draft", () => {
    saveDraft(A, { ...emptyDraft(), outcome: "interested", note: "A's private note", noteOpen: true });
    const { unmount } = mount({ rowId: B, slug: "other", name: "Other Co" });
    openManually();
    expect(within(dialog()).getAllByRole("radio", { checked: true }).map((r) => r.closest("label")!.textContent)).not.toContain("✓Interested");
    expect(dialog().textContent).not.toContain("A's private note");
    unmount();
    mount();
    openManually();
    expect((within(dialog()).getByRole("radio", { name: /Interested/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog()).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe("A's private note");
    expect(sessionStorage.getItem(DRAFT_KEY(A))).toContain("A's private note");
    expect(localStorage.length).toBe(0);
  });
});

describe("dialog semantics", () => {
  it("is a labelled dialog; initial focus is on the outcome question; Escape closes and returns focus", async () => {
    mount();
    const launcher = header().getByRole("button", { name: /Record contact/ });
    launcher.focus();
    fireEvent.click(launcher);
    expect(dialog().getAttribute("aria-labelledby")).toBeTruthy();
    expect((document.activeElement as HTMLInputElement).name).toMatch(/outcome$/);
    await act(async () => { dialog().dispatchEvent(new Event("cancel", { cancelable: true })); });
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it("outcomes, channel, stage and follow-up are native radio groups under a legend", () => {
    mount();
    openManually();
    choose("Spoke");
    for (const name of ["What happened?", "How", "Next step"]) {
      const group = within(dialog()).getByRole("group", { name });
      expect(within(group).getAllByRole("radio").length).toBeGreaterThan(1);
    }
  });
});
