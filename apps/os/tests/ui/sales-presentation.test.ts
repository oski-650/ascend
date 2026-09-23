// Slice 2A.2b — the sales presentation module and the Record contact draft rules, without a DOM.
//
// Two properties matter most and are asserted against the DOMAIN's own vocabulary lists, not against
// a copy: every enum has a human label (so a raw value cannot reach the screen), and the Save body the
// sheet builds is exactly what the frozen route contract accepts.

import { describe, expect, it } from "vitest";
import {
  CONTACT_CHANNELS, CONTACT_OUTCOMES, FOLLOWUP_ACTIONS, LOST_REASONS, validateSave,
} from "@/core/db/sales-actions";
import { parseSaveBody } from "@/lib/sales-http";
import {
  ACTION_LABEL, CHANNEL_LABEL, COMMON_OUTCOMES, FORMER_MEMBER, LOST_REASON_LABEL, MORE_OUTCOMES, OUTCOME_LABEL,
  groupTimeline, presentDue, presentTimelineEntry, refusalWords, relativeTime,
} from "@/components/sales/presentation";
import { buildSave, emptyDraft, resolvePt, suggestedStage, type RecordDraft, type SheetContext } from "@/components/sales/record-draft";

// 2026-09-22 14:14 PDT
const NOW = new Date("2026-09-22T21:14:00Z");
const ctx = (over: Partial<SheetContext> = {}): SheetContext => ({ stage: "lead", unassigned: true, openFollowUp: null, now: NOW, ...over });
const draft = (over: Partial<RecordDraft> = {}): RecordDraft => ({ ...emptyDraft(), ...over });

/** The body the route would accept, run through the SAME strict parser and domain validator. */
function accepted(body: unknown) {
  const parsed = parseSaveBody(body);
  return validateSave({ ...(parsed as object), commandId: "01920000-0000-7000-8000-000000000001", prospect: "p" } as never);
}

describe("vocabulary — no raw enum reaches the screen", () => {
  it("every domain value has a label, and nothing else does", () => {
    expect(Object.keys(OUTCOME_LABEL).sort()).toEqual([...CONTACT_OUTCOMES].sort());
    expect(Object.keys(CHANNEL_LABEL).sort()).toEqual([...CONTACT_CHANNELS].sort());
    expect(Object.keys(ACTION_LABEL).sort()).toEqual([...FOLLOWUP_ACTIONS].sort());
    expect(Object.keys(LOST_REASON_LABEL).sort()).toEqual([...LOST_REASONS].sort());
    for (const map of [OUTCOME_LABEL, CHANNEL_LABEL, ACTION_LABEL, LOST_REASON_LABEL]) {
      for (const label of Object.values(map)) expect(label).not.toMatch(/_/);
    }
  });

  it("the six common outcomes plus More cover every outcome exactly once", () => {
    expect(COMMON_OUTCOMES).toEqual(["no_answer", "voicemail", "spoke", "interested", "callback_requested", "meeting_set"]);
    expect([...COMMON_OUTCOMES, ...MORE_OUTCOMES].sort()).toEqual([...CONTACT_OUTCOMES].sort());
  });
});

describe("timeline wording", () => {
  const names = { u1: "Maria", u2: "Oscar" };
  it("contacts, stages, follow-ups, notes and events read as sentences; unknown people are neutral", () => {
    const c = presentTimelineEntry({ kind: "contact", at: "2026-09-22T21:00:00Z", id: "c", actor: "u1", actorName: null, outcome: "callback_requested", channel: "in_person", note: "Call after 3" }, names, NOW);
    expect(c).toMatchObject({ title: "Callback requested", detail: "by in person", prose: "Call after 3", who: "Maria" });
    const s = presentTimelineEntry({ kind: "stage", at: "2026-09-22T21:00:00Z", id: "s", actor: "gone", actorName: null, from: "contacted", to: "closed-lost", cause: "closed_lost", lostReason: "chose_competitor" }, names, NOW);
    expect(s).toMatchObject({ title: "Contacted → Closed · Lost", detail: "Reason: Chose a competitor", who: FORMER_MEMBER });
    const f = presentTimelineEntry({ kind: "followup", at: "2026-09-22T21:00:00Z", id: "f", actor: "u2", actorName: null, action: "call", assignee: "u1", dueOn: "2026-09-23", dueAt: "2026-09-23T16:00:00Z", state: "superseded" }, names, NOW);
    expect(f).toMatchObject({ title: "Call scheduled", badge: "Replaced" });
    expect(f.detail).toBe("for Wed, Sep 23 · 9:00 AM PT · assigned to Maria");
    // Scheduled for oneself: the name is not repeated ("… · Maria · Maria").
    const own = presentTimelineEntry({ kind: "followup", at: "2026-09-22T21:00:00Z", id: "g", actor: "u1", actorName: null, action: "call", assignee: "u1", dueOn: "2026-09-23", dueAt: null, state: "open" }, names, NOW);
    expect([own.detail, own.who]).toEqual(["for Wed, Sep 23 · any time", "Maria"]);
    const e = presentTimelineEntry({ kind: "event", at: "2026-09-22T21:00:00Z", id: "e", actor: null, actorName: null, type: "prospect.created" }, names, NOW);
    expect(e).toMatchObject({ title: "Added to the pipeline", who: null });
    for (const line of [c, s, f, e]) expect(JSON.stringify(line)).not.toMatch(/callback_requested|closed-lost|chose_competitor|in_person|prospect\./);
  });

  it("groups by Pacific day — 11 PM PT on the 21st is not the 22nd, whatever UTC says", () => {
    const at = "2026-09-22T06:00:00Z"; // 23:00 PDT on the 21st
    const lines = [presentTimelineEntry({ kind: "note", at, id: "n", actor: "u1", actorName: null, body: "x" }, names, NOW)];
    expect(groupTimeline(lines, NOW)[0]).toMatchObject({ day: "2026-09-21", label: "Yesterday" });
  });

  it("due state is words and a glyph, and 'overdue' says by how much", () => {
    expect(presentDue("overdue", "2026-09-20", NOW)).toEqual({ label: "Overdue · 2 days", glyph: "!", tone: "risk" });
    expect(presentDue("today", "2026-09-22", NOW)).toMatchObject({ label: "Due today", glyph: "●" });
    expect(presentDue("upcoming", "2026-09-23", NOW)).toMatchObject({ label: "Due tomorrow", glyph: "○" });
    expect(presentDue("none", null, NOW)).toBeNull();
    expect(relativeTime("2026-09-19T21:14:00Z", NOW)).toBe("3 days ago");
  });

  it("a refusal code becomes a sentence; an unknown one is still a sentence", () => {
    expect(refusalWords("nonexistent_local_time").text).not.toMatch(/nonexistent|local_time/);
    expect(refusalWords("some_future_code").text).toMatch(/couldn't be saved/);
  });
});

describe("Pacific-time input", () => {
  it("a spring-forward time is refused with a suggestion; a fall-back time asks which one", () => {
    expect(resolvePt("2027-03-14", "02:30")).toMatchObject({ kind: "gap", suggestion: "03:00" });
    expect((resolvePt("2027-03-14", "02:30") as { message: string }).message).toMatch(/2:30 AM doesn't exist/);
    const amb = resolvePt("2026-11-01", "01:30");
    expect(amb).toMatchObject({ kind: "ambiguous" });
    expect((amb as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(["1:30 AM PDT (first)", "1:30 AM PST (second)"]);
    expect(resolvePt("2026-11-01", "01:30", "-08:00")).toMatchObject({ kind: "instant", iso: "2026-11-01T09:30:00.000Z" });
    expect(resolvePt("2026-11-01", "01:30", "-07:00")).toMatchObject({ kind: "instant", iso: "2026-11-01T08:30:00.000Z" });
    expect(resolvePt("2026-09-23", "")).toEqual({ kind: "day", dueOn: "2026-09-23" });
  });
});

describe("the Save body", () => {
  it("normalizes the forced pairs instead of refusing them", () => {
    const b = buildSave(draft({ outcome: "voicemail", channel: "text" }), ctx()).body!;
    expect(b.contact).toEqual({ outcome: "voicemail", channel: "call" });
    expect(buildSave(draft({ outcome: "email_sent", channel: "call" }), ctx()).body!.contact!.channel).toBe("email");
    expect(accepted(b)).not.toHaveProperty("status");
  });

  it("never changes stage from an outcome; the suggestion is only a suggestion", () => {
    expect(suggestedStage("lead", "spoke")).toBe("contacted");
    expect(suggestedStage("lead", "no_answer")).toBeNull();
    expect(suggestedStage("contacted", "spoke")).toBeNull();
    expect(buildSave(draft({ outcome: "spoke" }), ctx()).body).not.toHaveProperty("stage");
    const b = buildSave(draft({ outcome: "spoke", stageTo: "contacted" }), ctx()).body!;
    expect(b).toMatchObject({ expectedStage: "lead", stage: { to: "contacted" } });
    expect(accepted(b)).not.toHaveProperty("status");
  });

  it("closed-lost needs a reason, says what happens to the open follow-up, and sends no follow-up", () => {
    const open = { action: "call", dueOn: "2026-09-24", dueAt: null, assigneeName: "you" };
    const missing = buildSave(draft({ outcome: "not_interested", stageTo: "closed-lost", follow: "tomorrow" }), ctx({ openFollowUp: open }));
    expect(missing.body).toBeNull();
    expect(missing.blockers).toContain("Choose why it was lost.");
    const ok = buildSave(draft({ outcome: "not_interested", stageTo: "closed-lost", lostReason: "other", lostContext: "Went with a cousin", follow: "tomorrow" }), ctx({ openFollowUp: open }));
    expect(ok.body!.stage).toEqual({ to: "closed-lost", lostReason: "other" });
    expect(ok.body!.followUp).toBeUndefined();
    expect(ok.body!.contact!.note).toBe("Closed-lost: Went with a cousin");
    expect(ok.consequence).toMatch(/cancels the open follow-up \(Call · Thu, Sep 24 · any time\)/);
    // `other` without a contact: no second write, no context anywhere.
    const noContact = buildSave(draft({ stageTo: "closed-lost", lostReason: "other", lostContext: "ignored" }), ctx());
    expect(noContact.body).toEqual({ expectedStage: "lead", stage: { to: "closed-lost", lostReason: "other" } });
  });

  it("a claim is sent only when chosen and only when nobody holds the prospect", () => {
    expect(buildSave(draft({ outcome: "spoke" }), ctx()).body).not.toHaveProperty("claim");
    expect(buildSave(draft({ outcome: "spoke", claim: true }), ctx()).body!.claim).toBe(true);
    expect(buildSave(draft({ outcome: "spoke", claim: true }), ctx({ unassigned: false })).body).not.toHaveProperty("claim");
  });

  it("presets resolve in Pacific time with the offset Los Angeles is actually at", () => {
    const b = buildSave(draft({ outcome: "spoke", follow: "tomorrow" }), ctx());
    expect(b.body!.followUp).toEqual({ schedule: { action: "call", dueOn: "2026-09-23", dueAt: { local: "2026-09-23T09:00", offset: "-07:00" } } });
    expect(b.followPreview).toBe("Call · Wed, Sep 23 · 9:00 AM PT");
    expect(accepted(b.body)).not.toHaveProperty("status");
    // "Later today" late in the evening: refused with an alternative, never silently moved.
    const late = buildSave(draft({ outcome: "spoke", follow: "later_today" }), ctx({ now: new Date("2026-09-23T03:30:00Z") }));
    expect(late.body).toBeNull();
    expect(late.field.follow).toMatch(/Tomorrow/);
  });

  it("with an open follow-up: keep by default, or say exactly what replaces or resolves it", () => {
    const open = { action: "email", dueOn: "2026-09-24", dueAt: null, assigneeName: "you" };
    expect(emptyDraft({ hasOpenFollowUp: true }).follow).toBe("keep");
    expect(buildSave(draft({ outcome: "spoke", follow: "keep" }), ctx({ openFollowUp: open })).body).not.toHaveProperty("followUp");
    const replace = buildSave(draft({ outcome: "spoke", follow: "tomorrow" }), ctx({ openFollowUp: open }));
    expect(replace.consequence).toMatch(/Replaces the open follow-up .* marked done by this contact/);
    const done = buildSave(draft({ outcome: "spoke", follow: "none" }), ctx({ openFollowUp: open }));
    expect(done.body!.followUp).toEqual({ resolve: "completed" });
    expect(buildSave(draft({ follow: "none" }), ctx({ openFollowUp: open })).body!.followUp).toEqual({ resolve: "cancelled" });
  });

  it("a note without an outcome, an empty sheet, and a future contact time each explain themselves", () => {
    expect(buildSave(draft({ note: "hi" }), ctx()).blockers[0]).toMatch(/Choose what happened/);
    expect(buildSave(draft(), ctx()).blockers).toEqual(["Choose what happened, or set a follow-up."]);
    const future = buildSave(draft({ outcome: "spoke", when: { mode: "manual", date: "2026-09-22", time: "18:00", offset: null } }), ctx());
    expect(future.field.when).toBe("That time hasn't happened yet.");
    const call = buildSave(draft({ outcome: "spoke", when: { mode: "call", at: "2026-09-22T21:02:11.000Z" } }), ctx());
    expect(call.body!.contact!.happenedAt).toBe("2026-09-22T21:02:11.000Z");
  });
});
