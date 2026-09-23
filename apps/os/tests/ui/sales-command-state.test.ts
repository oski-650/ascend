// @vitest-environment happy-dom
//
// Slice 2A.2a — DRAFT ≠ COMMAND, and the pending call.
//
// The rule this suite exists to hold: a retry after an UNKNOWN outcome reuses the command id, and
// anything else gets a new one. Get that backwards in either direction and the operator either loses
// a contact (new id on a retry the server already committed → two contacts) or cannot correct a
// refusal (old id on a changed payload → command_id_conflict for ever).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CALL_KEY, CALL_TTL_MS, DRAFT_KEY, DRAFT_TTL_MS, canonical, clearDraft, clearPendingCall, commandIdFor,
  forgetCommand, loadDraft, rememberUncertain, saveDraft, startCall, takePendingCall,
} from "@/components/sales/command-state";

const PROSPECT = "01920000-0000-7000-8000-000000000001";
const draft = { outcome: "spoke", note: "asked for a quote" };
const payload = { contact: { outcome: "spoke", channel: "call", note: "asked for a quote" } };
let n = 0;
const mint = () => `id-${++n}`;

beforeEach(() => { sessionStorage.clear(); n = 0; });
afterEach(() => sessionStorage.clear());

describe("canonical payloads", () => {
  it("orders keys at every level and drops undefined, so the same command is the same string", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(canonical({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
});

describe("a draft is not a command", () => {
  it("editing stores the draft and mints NOTHING", () => {
    saveDraft(PROSPECT, draft);
    const stored = loadDraft<typeof draft>(PROSPECT);
    expect(stored!.draft).toEqual(draft);
    expect(stored!.command).toBeNull();
    expect(JSON.stringify(stored)).not.toContain("id-");
  });

  it("the id is minted at the first save attempt, and a second attempt of an UNSENT payload mints again", () => {
    saveDraft(PROSPECT, draft);
    const first = commandIdFor(PROSPECT, payload, mint);
    expect(first).toEqual({ id: "id-1", retry: false });
    // Nothing was recorded as uncertain, so this is not a retry of anything.
    expect(commandIdFor(PROSPECT, payload, mint)).toEqual({ id: "id-2", retry: false });
  });

  it("the draft survives a reload and keeps only what is needed to restore it", () => {
    saveDraft(PROSPECT, draft);
    rememberUncertain(PROSPECT, draft, "id-1", payload);
    const raw = sessionStorage.getItem(DRAFT_KEY(PROSPECT))!;
    expect(JSON.parse(raw)).toMatchObject({ v: 1, prospect: PROSPECT, command: { id: "id-1", state: "uncertain", attempts: 1 } });
    // The operator's own unsent note is the draft; nothing else is kept.
    expect(raw).toContain("asked for a quote");
    expect(raw).not.toMatch(/token|session|cookie|secret/i);
  });
});

describe("an uncertain outcome keeps the id; everything else replaces it", () => {
  it("a retry of the SAME payload reuses the id and counts the attempt", () => {
    rememberUncertain(PROSPECT, draft, "id-1", payload);
    expect(commandIdFor(PROSPECT, payload, mint)).toEqual({ id: "id-1", retry: true });
    rememberUncertain(PROSPECT, draft, "id-1", payload);
    const stored = loadDraft<typeof draft>(PROSPECT);
    expect(stored!.command).toMatchObject({ id: "id-1", attempts: 2 });
    expect(stored!.command!.firstAttemptAt).toBe(loadDraft<typeof draft>(PROSPECT)!.command!.firstAttemptAt);
  });

  it("a CHANGED payload is a DIFFERENT command, even while the old one is uncertain", () => {
    rememberUncertain(PROSPECT, draft, "stored-1", payload);
    const changed = { contact: { outcome: "no_answer", channel: "call" } };
    // A distinct mint, so reuse and minting cannot be confused for one another.
    expect(commandIdFor(PROSPECT, changed, () => "fresh-1")).toEqual({ id: "fresh-1", retry: false });
    // …and the unchanged payload still retries the stored one.
    expect(commandIdFor(PROSPECT, payload, () => "fresh-2")).toEqual({ id: "stored-1", retry: true });
  });

  it("a definitive outcome forgets the command but may keep the draft; a save clears both", () => {
    rememberUncertain(PROSPECT, draft, "stored-1", payload);
    forgetCommand(PROSPECT);
    expect(loadDraft<typeof draft>(PROSPECT)!.command).toBeNull();
    expect(loadDraft<typeof draft>(PROSPECT)!.draft).toEqual(draft);
    expect(commandIdFor(PROSPECT, payload, mint).retry).toBe(false);
    clearDraft(PROSPECT);
    expect(loadDraft(PROSPECT)).toBeNull();
  });

  it("drafts are scoped to one prospect, and a stale or malformed one is dropped", () => {
    const other = "01920000-0000-7000-8000-000000000002";
    saveDraft(PROSPECT, draft);
    expect(loadDraft(other)).toBeNull();
    const old = Date.now() - DRAFT_TTL_MS - 1;
    saveDraft(PROSPECT, draft, old);
    expect(loadDraft(PROSPECT)).toBeNull();
    sessionStorage.setItem(DRAFT_KEY(PROSPECT), "{not json");
    expect(loadDraft(PROSPECT)).toBeNull();
  });
});

describe("the pending call", () => {
  it("is written before the hand-off and restored on return, with the call's start time", () => {
    const at = Date.now();
    startCall(PROSPECT, "tapia-tile", at);
    expect(JSON.parse(sessionStorage.getItem(CALL_KEY)!)).toMatchObject({ v: 1, prospect: PROSPECT, ref: "tapia-tile" });
    const call = takePendingCall(PROSPECT, at + 60_000);
    expect(call!.startedAt).toBe(new Date(at).toISOString());
  });

  it("is ignored — and cleared — when stale, when it names another prospect, or when malformed", () => {
    const at = Date.now();
    startCall(PROSPECT, "tapia-tile", at);
    expect(takePendingCall(PROSPECT, at + CALL_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(CALL_KEY)).toBeNull();

    startCall(PROSPECT, "tapia-tile", at);
    expect(takePendingCall("01920000-0000-7000-8000-000000000002", at + 1000)).toBeNull();
    expect(sessionStorage.getItem(CALL_KEY)).toBeNull();

    sessionStorage.setItem(CALL_KEY, "nonsense");
    expect(takePendingCall(PROSPECT)).toBeNull();
  });

  it("is cleared explicitly when the contact is recorded or the offer is dismissed", () => {
    startCall(PROSPECT, "tapia-tile");
    clearPendingCall();
    expect(takePendingCall(PROSPECT)).toBeNull();
  });
});

describe("storage that refuses to work", () => {
  it("degrades to no draft rather than throwing — a private window still saves contacts", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      expect(() => saveDraft(PROSPECT, draft)).not.toThrow();
      expect(loadDraft(PROSPECT)).toBeNull();
      expect(commandIdFor(PROSPECT, payload, mint)).toEqual({ id: "id-1", retry: false });
      expect(() => clearPendingCall()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
