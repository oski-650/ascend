// @vitest-environment happy-dom
//
// Slice 2A.2a — `useSalesCommand`: what the browser does with an outcome it cannot be sure of.
//
// The hook is the only place that decides whether a retry is the SAME command. These tests drive it
// with fake network outcomes, because the failure that matters — "the response was lost and the save
// silently happened twice" — cannot be produced by a happy path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSalesCommand } from "@/components/sales/useSalesCommand";
import { loadDraft } from "@/components/sales/command-state";

const PROSPECT = "01920000-0000-7000-8000-00000000000a";
const url = "/api/prospects/tapia-tile/actions";
const payload = { contact: { outcome: "spoke", channel: "call" } };
const draft = { outcome: "spoke" };

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sent = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body) as Record<string, unknown>;

let ids = 0;
const setup = (fetchMock: ReturnType<typeof vi.fn>) =>
  renderHook(() => useSalesCommand<typeof draft>({
    prospectRowId: PROSPECT, url, fetchImpl: fetchMock as unknown as typeof fetch, mintId: () => `id-${++ids}`,
  }));

beforeEach(() => { sessionStorage.clear(); ids = 0; });
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("a command that lands", () => {
  it("201 → saved, and the draft and its id are cleared", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { ok: true, status: "applied", commandId: "id-1", outcome: { contact: { contactId: "c1" } } }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state).toMatchObject({ phase: "saved", result: { status: "applied" } });
    expect(sent(fetchMock).commandId).toBe("id-1");
    expect(loadDraft(PROSPECT)).toBeNull();
  });

  it("200 replayed is presented exactly like a save — the operator is not told their retry was 'late'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, status: "replayed", commandId: "id-1", outcome: { contact: { contactId: "c1" } } }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state.phase).toBe("saved");
    expect((result.current.state as { result: { outcome: unknown } }).result.outcome).toEqual({ contact: { contactId: "c1" } });
  });
});

describe("an outcome nobody knows", () => {
  it("a dropped connection keeps the id, and RETRY reuses it — one contact, not two", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(json(200, { ok: true, status: "replayed", commandId: "id-1", outcome: {} }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state).toMatchObject({ phase: "uncertain", reason: "network", canRetry: true });
    expect(loadDraft(PROSPECT)!.command).toMatchObject({ id: "id-1", state: "uncertain", attempts: 1 });
    await act(async () => { await result.current.send(payload, draft); });
    expect(sent(fetchMock, 1).commandId).toBe("id-1");
    expect(result.current.state.phase).toBe("saved");
  });

  it("a 5xx is uncertain too — the server may have committed before it failed to answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(503, { error: "unavailable" }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state).toMatchObject({ phase: "uncertain", reason: "server" });
    expect(loadDraft(PROSPECT)!.command!.id).toBe("id-1");
  });

  it("offline does not even try, and keeps the id for when the network returns", async () => {
    const fetchMock = vi.fn();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      const { result } = setup(fetchMock);
      await act(async () => { await result.current.send(payload, draft); });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.state).toMatchObject({ phase: "uncertain", reason: "offline" });
      expect(loadDraft(PROSPECT)!.command!.id).toBe("id-1");
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("a retry after a reload still reuses the id, because the uncertainty outlived the page", async () => {
    // Page one: the request fails with an unknown outcome, then the page goes away.
    const first = vi.fn().mockRejectedValue(new Error("network"));
    const before = renderHook(() => useSalesCommand<typeof draft>({
      prospectRowId: PROSPECT, url, fetchImpl: first as unknown as typeof fetch, mintId: () => "id-lost" }));
    await act(async () => { await before.result.current.send(payload, draft); });
    expect(loadDraft(PROSPECT)!.command!.id).toBe("id-lost");
    before.unmount();

    // Page two — a fresh hook, a fresh mint — reuses the id `sessionStorage` remembers.
    const second = vi.fn().mockResolvedValue(json(200, { ok: true, status: "replayed", commandId: "id-lost", outcome: {} }));
    const after = renderHook(() => useSalesCommand<typeof draft>({
      prospectRowId: PROSPECT, url, fetchImpl: second as unknown as typeof fetch, mintId: () => "id-new" }));
    await act(async () => { await after.result.current.send(payload, draft); });
    expect(sent(second).commandId).toBe("id-lost");
    expect(after.result.current.state.phase).toBe("saved");
  });
});

describe("a refusal", () => {
  it("is definitive: the draft stays, the id does not — the next attempt is a DIFFERENT command", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "stage_conflict", detail: { current: "contacted" } }))
      .mockResolvedValueOnce(json(201, { ok: true, status: "applied", commandId: "id-2", outcome: {} }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state).toMatchObject({ phase: "refused", refusal: { code: "stage_conflict", status: 409, detail: { current: "contacted" } } });
    expect(loadDraft(PROSPECT)?.command ?? null).toBeNull();
    await act(async () => { await result.current.send({ ...payload, expectedStage: "contacted" }, draft); });
    expect(sent(fetchMock, 1).commandId).toBe("id-2");
  });

  it("carries the follow-up fallback through untouched, and never invents detail the server withheld", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { ok: false, error: "followup_owned_by_other", fallback: { contactOnly: true, newCommandIdRequired: true } }))
      .mockResolvedValueOnce(json(409, { ok: false, error: "command_id_conflict" }));
    const { result } = setup(fetchMock);
    await act(async () => { await result.current.send(payload, draft); });
    expect(result.current.state).toMatchObject({ phase: "refused", refusal: { fallback: { contactOnly: true } } });
    await act(async () => { await result.current.send({ contact: { outcome: "spoke", channel: "call", note: "x" } }, draft); });
    expect(result.current.state).toMatchObject({ phase: "refused", refusal: { code: "command_id_conflict" } });
    expect((result.current.state as { refusal: { detail?: unknown } }).refusal.detail).toBeUndefined();
  });
});

describe("one in flight per command", () => {
  it("a second submit while a request is pending is ignored, not queued", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((res) => { release = res; }));
    const { result } = setup(fetchMock);
    let first: Promise<unknown> = Promise.resolve();
    await act(async () => { first = result.current.send(payload, draft); await Promise.resolve(); });
    await act(async () => { await result.current.send(payload, draft); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(json(201, { ok: true, status: "applied", commandId: "id-1", outcome: {} })); await first; });
    await waitFor(() => expect(result.current.state.phase).toBe("saved"));
  });
});
