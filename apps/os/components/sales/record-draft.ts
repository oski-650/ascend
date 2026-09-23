// components/sales/record-draft — what the Record contact sheet MEANS, without any of its pixels
// (Slice 2A.2b).
//
// The sheet holds a DRAFT: what the operator has tapped and typed so far. This module turns that draft
// into the exact Save body the frozen route contract accepts, and into the plain-language reasons the
// Save button is not yet available. It is pure, so every rule below is tested without a DOM.
//
// ─── WHAT THE UI NORMALIZES, AND WHAT IT NEVER INFERS ──────────────────────────────────────────
//
//   normalized   voicemail is always a call, email_sent always an email (the frozen pairs). The UI
//                sends the forced channel; it never shows a validation error for a combination it
//                can make right by itself.
//   never        a stage change from an outcome (a suggestion is offered, and applies only when the
//                operator taps it) · a claim from the actor (the switch starts OFF) · a contact from
//                a tapped Call button (the call only pre-fills WHEN, never WHAT happened).
//
// ─── TIME ──────────────────────────────────────────────────────────────────────────────────────
//
// Every date and time the operator picks is Pacific time, whatever the phone's zone. The instant is
// resolved through the SAME domain function the server validates with (`resolveDue`), so the two
// cannot disagree. A wall-clock time that does not exist (spring forward) or exists twice (fall back)
// is never silently resolved: the first is refused with a suggestion, the second asks which one.

import { followUpPreset, resolveDue, type FollowUpPreset } from "@/domain";
import type {
  ContactChannel, ContactOutcome, FollowUpAction, LostReason, StageTarget,
} from "@/core/crm/sales";
import { FORCED_CHANNEL, formatDay, formatDue, ACTION_LABEL, type Stage } from "./presentation";

export const NOTE_MAX = 2000;
export const LOST_CONTEXT_MAX = 200;

export type FollowChoice = "keep" | "none" | Exclude<FollowUpPreset, "no_time"> | "pick";
export const PRESET_CHOICES: readonly Exclude<FollowUpPreset, "no_time">[] = ["later_today", "tomorrow", "in_2_days", "next_week"];

export type When =
  | { mode: "now" }
  | { mode: "call"; at: string }
  | { mode: "manual"; date: string; time: string; offset: string | null };

export type RecordDraft = {
  outcome: ContactOutcome | null;
  moreOutcomes: boolean;
  channel: ContactChannel;
  note: string;
  noteOpen: boolean;
  when: When;
  stageOpen: boolean;
  stageTo: StageTarget | null;
  lostReason: LostReason | null;
  lostContext: string;
  follow: FollowChoice;
  /** Null → follows the contact's channel. */
  action: FollowUpAction | null;
  pickDate: string;
  pickTime: string;
  pickOffset: string | null;
  claim: boolean;
};

export type OpenFollowUpView = { action: string; dueOn: string; dueAt: string | null; assigneeName: string };

export type SheetContext = {
  /** The stage the operator is looking at — the compare-and-set value sent as `expectedStage`. */
  stage: Stage | null;
  unassigned: boolean;
  openFollowUp: OpenFollowUpView | null;
  now: Date;
};

export function emptyDraft(opts: { channel?: ContactChannel; when?: When; hasOpenFollowUp?: boolean } = {}): RecordDraft {
  return {
    outcome: null, moreOutcomes: false, channel: opts.channel ?? "call", note: "", noteOpen: false,
    when: opts.when ?? { mode: "now" }, stageOpen: false, stageTo: null, lostReason: null, lostContext: "",
    follow: opts.hasOpenFollowUp ? "keep" : "none", action: null, pickDate: "", pickTime: "", pickOffset: null,
    claim: false,
  };
}

// ─── Pacific-time input ───────────────────────────────────────────────────────────────────────

const LA_OFFSETS = ["-07:00", "-08:00"] as const;
const OFFSET_NAME: Record<string, string> = { "-07:00": "PDT", "-08:00": "PST" };

export type PtResolution =
  | { kind: "empty" }
  | { kind: "day"; dueOn: string }
  | { kind: "instant"; dueOn: string; local: string; offset: string; iso: string }
  | { kind: "gap"; message: string; suggestion: string }
  | { kind: "ambiguous"; message: string; options: { offset: string; label: string }[] }
  | { kind: "invalid"; message: string };

/** 13:30 → "1:30 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A date (and optional time) the operator typed, read as Los Angeles wall-clock time.
 * `offset` is the operator's explicit choice for a fall-back hour, and is used only there.
 */
export function resolvePt(date: string, time: string, offset: string | null = null): PtResolution {
  if (!date) return { kind: "empty" };
  if (!resolveDue(date).ok) return { kind: "invalid", message: "That isn't a real date." };
  if (!time) return { kind: "day", dueOn: date };
  const local = `${date}T${time}`;
  const fits = LA_OFFSETS.filter((o) => resolveDue(date, { local, offset: o }).ok);
  if (fits.length === 0) {
    return {
      kind: "gap",
      message: `${clock12(time)} doesn't exist on ${formatDay(date)} — Pacific clocks jump from 2:00 AM to 3:00 AM that night.`,
      suggestion: "03:00",
    };
  }
  let chosen: string = fits[0];
  if (fits.length === 2) {
    if (!offset || !fits.includes(offset as (typeof LA_OFFSETS)[number])) {
      return {
        kind: "ambiguous",
        message: `${clock12(time)} happens twice on ${formatDay(date)} — Pacific clocks go back an hour that night. Which one?`,
        options: fits.map((o, i) => ({ offset: o, label: `${clock12(time)} ${OFFSET_NAME[o]} (${i === 0 ? "first" : "second"})` })),
      };
    }
    chosen = offset;
  }
  const r = resolveDue(date, { local, offset: chosen });
  if (!r.ok || !r.dueAt) return { kind: "invalid", message: "That time can't be used." };
  return { kind: "instant", dueOn: date, local, offset: chosen, iso: r.dueAt };
}

// ─── the rules the sheet shows before Save ────────────────────────────────────────────────────

/** Outcomes that are a real conversation — the only ones after which "Lead → Contacted" is offered. */
const MEANINGFUL: ReadonlySet<ContactOutcome> = new Set(["spoke", "interested", "callback_requested", "meeting_set"]);

/** "Lead → Contacted", offered (never applied) after a meaningful first contact. Never closed-won. */
export function suggestedStage(stage: Stage | null, outcome: ContactOutcome | null): StageTarget | null {
  return stage === "lead" && outcome !== null && MEANINGFUL.has(outcome) ? "contacted" : null;
}

export const effectiveChannel = (d: Pick<RecordDraft, "outcome" | "channel">): ContactChannel =>
  (d.outcome && FORCED_CHANNEL[d.outcome]) || d.channel;

const ACTION_FOR_CHANNEL: Record<ContactChannel, FollowUpAction> = {
  call: "call", email: "email", text: "text", in_person: "meeting", other: "other",
};
export const effectiveAction = (d: RecordDraft): FollowUpAction => d.action ?? ACTION_FOR_CHANNEL[effectiveChannel(d)];

export const isClosed = (s: Stage | null | undefined) => s === "closed-lost" || s === "closed-won";

export type SaveBody = {
  expectedStage?: Stage | null;
  contact?: { outcome: ContactOutcome; channel: ContactChannel; note?: string; happenedAt?: string };
  claim?: true;
  stage?: { to: StageTarget; lostReason?: LostReason };
  followUp?: { schedule: { action: FollowUpAction; dueOn: string; dueAt?: { local: string; offset: string } } } | { resolve: "completed" | "cancelled" };
};

export type BuiltSave = {
  /** Null when there is nothing to send, or something must be fixed first. */
  body: SaveBody | null;
  /** Why Save is not available, in words — shown as text, never only as a disabled button. */
  blockers: string[];
  /** Per-section messages. */
  field: { when?: string; follow?: string; lost?: string; note?: string };
  /** The follow-up this Save will create, worded ("Call · Tue, Sep 23 · 9:00 AM PT"). */
  followPreview: string | null;
  /** What happens to the open follow-up, worded, if anything. */
  consequence: string | null;
  /** Resolutions for the pickers, so the sheet can render DST choices. */
  pick: PtResolution | null;
  whenPick: PtResolution | null;
};

/** The instant a draft's WHEN names, or null for "now" (the server stamps it). */
function contactInstant(w: When): { iso: string | null; res: PtResolution | null } {
  if (w.mode === "now") return { iso: null, res: null };
  if (w.mode === "call") return { iso: w.at, res: null };
  const res = resolvePt(w.date, w.time || "", w.offset);
  return { iso: res.kind === "instant" ? res.iso : null, res };
}

function presetFor(choice: FollowChoice, now: Date) {
  if (choice === "keep" || choice === "none" || choice === "pick") return null;
  return followUpPreset(choice, now);
}

/** Whether a preset can produce a time right now — "Later today" cannot late in the evening. */
export const presetAvailable = (choice: Exclude<FollowUpPreset, "no_time">, now: Date) => followUpPreset(choice, now) !== null;

export function buildSave(d: RecordDraft, ctx: SheetContext): BuiltSave {
  const blockers: string[] = [];
  const field: BuiltSave["field"] = {};
  const body: SaveBody = {};
  const open = ctx.openFollowUp;
  const openWords = open ? `${ACTION_LABEL[open.action as FollowUpAction] ?? "Follow-up"} · ${formatDue(open.dueOn, open.dueAt, ctx.now)}` : null;

  // ── contact ──
  const note = d.note.trim();
  if (note.length > NOTE_MAX) { field.note = `Keep the note under ${NOTE_MAX.toLocaleString()} characters.`; blockers.push(field.note); }
  const when = contactInstant(d.when);
  let whenPick: PtResolution | null = null;
  if (d.outcome) {
    if (d.when.mode === "manual") {
      whenPick = when.res;
      if (!d.when.time) field.when = "Add the time it happened.";
      else if (when.res?.kind === "gap" || when.res?.kind === "ambiguous" || when.res?.kind === "invalid") field.when = when.res.message;
      else if (when.iso && Date.parse(when.iso) > ctx.now.getTime() + 5 * 60_000) field.when = "That time hasn't happened yet.";
      if (field.when) blockers.push(field.when);
    }
    const contextLine = d.stageTo === "closed-lost" && d.lostReason === "other" && d.lostContext.trim()
      ? `Closed-lost: ${d.lostContext.trim().slice(0, LOST_CONTEXT_MAX)}` : "";
    const fullNote = [note, contextLine].filter(Boolean).join("\n\n");
    body.contact = {
      outcome: d.outcome, channel: effectiveChannel(d),
      ...(fullNote ? { note: fullNote } : {}),
      ...(when.iso ? { happenedAt: when.iso } : {}),
    };
  } else if (note) {
    field.note = "Choose what happened — a note is saved with the contact.";
    blockers.push(field.note);
  }

  // ── claim: only ever an explicit choice, and only when nobody holds the prospect ──
  if (d.claim && ctx.unassigned) body.claim = true;

  // ── stage ──
  if (d.stageTo && d.stageTo !== ctx.stage) {
    if (d.stageTo === "closed-lost" && !d.lostReason) { field.lost = "Choose why it was lost."; blockers.push(field.lost); }
    body.expectedStage = ctx.stage;
    body.stage = { to: d.stageTo, ...(d.stageTo === "closed-lost" && d.lostReason ? { lostReason: d.lostReason } : {}) };
  }

  // ── follow-up ──
  let followPreview: string | null = null;
  let consequence: string | null = null;
  let pick: PtResolution | null = null;
  const closing = isClosed(ctx.stage) || body.stage?.to === "closed-lost";
  if (body.stage?.to === "closed-lost" && open) consequence = `This cancels the open follow-up (${openWords}).`;
  if (!closing) {
    const action = effectiveAction(d);
    if (d.follow === "pick") {
      pick = resolvePt(d.pickDate, d.pickTime, d.pickOffset);
      if (pick.kind === "empty") field.follow = "Pick a date for the follow-up.";
      else if (pick.kind === "gap" || pick.kind === "ambiguous" || pick.kind === "invalid") field.follow = pick.message;
      else if (pick.kind === "day" || pick.kind === "instant") {
        body.followUp = { schedule: { action, dueOn: pick.dueOn, ...(pick.kind === "instant" ? { dueAt: { local: pick.local, offset: pick.offset } } : {}) } };
        followPreview = `${ACTION_LABEL[action]} · ${pick.kind === "instant" ? formatDue(pick.dueOn, pick.iso, ctx.now) : formatDue(pick.dueOn, null, ctx.now)}`;
      }
      if (field.follow) blockers.push(field.follow);
    } else if (d.follow !== "keep" && d.follow !== "none") {
      const p = presetFor(d.follow, ctx.now);
      if (!p) {
        field.follow = "Later today isn't available this late — choose Tomorrow or pick a time.";
        blockers.push(field.follow);
      } else {
        body.followUp = { schedule: { action, dueOn: p.dueOn, ...(p.dueAt ? { dueAt: p.dueAt } : {}) } };
        const r = p.dueAt ? resolveDue(p.dueOn, p.dueAt) : null;
        followPreview = `${ACTION_LABEL[action]} · ${formatDue(p.dueOn, r?.ok ? r.dueAt : null, ctx.now)}`;
      }
    } else if (d.follow === "none" && open) {
      body.followUp = { resolve: d.outcome ? "completed" : "cancelled" };
      consequence = d.outcome ? `Marks the open follow-up done (${openWords}).` : `Cancels the open follow-up (${openWords}).`;
    }
    if (body.followUp && "schedule" in body.followUp && open) {
      consequence = d.outcome ? `Replaces the open follow-up (${openWords}) — marked done by this contact.` : `Replaces the open follow-up (${openWords}).`;
    }
  }

  const empty = !body.contact && !body.claim && !body.stage && !body.followUp;
  if (empty && blockers.length === 0) blockers.push("Choose what happened, or set a follow-up.");
  return { body: blockers.length || empty ? null : body, blockers, field, followPreview, consequence, pick, whenPick };
}
