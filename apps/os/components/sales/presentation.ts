// components/sales/presentation — THE ONE PLACE sales vocabulary becomes words (Slice 2A.2b).
//
// The canonical data keeps its enums (`callback_requested`, `closed-lost`, `chose_competitor`). The
// operator never sees them. Every label, every timeline sentence and every time format on the sales
// surfaces comes from this module, so a wording change is one edit and a raw enum reaching the screen
// is a missing key here — which the maps below make a COMPILE error, because each is typed as a total
// `Record` over the domain's own vocabulary.
//
// PRESENTATION ONLY. Nothing here decides anything: no rule, no permission, no default the server
// relies on. Pure, and safe in both server and client components (type-only imports from the server
// modules are erased at build time).

import { losAngelesDate } from "@/domain";
import type {
  ContactChannel, ContactOutcome, FollowUpAction, LostReason,
} from "@/core/crm/sales";
import type { DueState, TimelineEntry } from "@/core/crm/sales";

// ─── vocabulary ───────────────────────────────────────────────────────────────────────────────

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  spoke: "Spoke",
  interested: "Interested",
  callback_requested: "Callback requested",
  meeting_set: "Meeting set",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  email_sent: "Email sent",
  other: "Other",
};

/** The six outcomes a salesperson reaches for after a call, in the order they happen most. */
export const COMMON_OUTCOMES: readonly ContactOutcome[] = [
  "no_answer", "voicemail", "spoke", "interested", "callback_requested", "meeting_set",
];
export const MORE_OUTCOMES: readonly ContactOutcome[] = ["not_interested", "wrong_number", "email_sent", "other"];

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: "Call", email: "Email", text: "Text", in_person: "In person", other: "Other",
};
export const CHANNEL_ORDER: readonly ContactChannel[] = ["call", "email", "text", "in_person", "other"];

/** The frozen semantic pairs (2A.1b): these outcomes only exist on one channel. */
export const FORCED_CHANNEL: Partial<Record<ContactOutcome, ContactChannel>> = { voicemail: "call", email_sent: "email" };

export const ACTION_LABEL: Record<FollowUpAction, string> = {
  call: "Call", email: "Email", text: "Text", meeting: "Meeting", other: "Follow up",
};
export const ACTION_ORDER: readonly FollowUpAction[] = ["call", "email", "text", "meeting", "other"];

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  not_interested: "Not interested",
  no_budget: "No budget",
  too_expensive: "Too expensive",
  chose_competitor: "Chose a competitor",
  not_a_fit: "Not a fit",
  unreachable: "Unreachable",
  wrong_contact: "Wrong contact",
  timing: "Bad timing",
  duplicate: "Duplicate",
  other: "Other",
};
export const LOST_REASON_ORDER = Object.keys(LOST_REASON_LABEL) as LostReason[];

export type Stage = "lead" | "contacted" | "proposal" | "closed-won" | "closed-lost";
/** Matches `statusLabel` in core/crm, which the rest of the app already shows. */
export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead", contacted: "Contacted", proposal: "Proposal", "closed-won": "Closed · Won", "closed-lost": "Closed · Lost",
};
export const stageLabel = (s: string | null | undefined): string =>
  s && s in STAGE_LABEL ? STAGE_LABEL[s as Stage] : "No stage recorded";

const FOLLOWUP_STATE_LABEL: Record<string, string> = {
  open: "Open", completed: "Done", cancelled: "Cancelled", superseded: "Replaced",
};

const EVENT_LABEL: Record<string, string> = {
  "prospect.created": "Added to the pipeline",
  "prospect.promoted": "Promoted to client",
  "prospect.archived": "Archived",
  "prospect.assessed": "Website assessed",
};

const CAUSE_LABEL: Record<string, string> = {
  contact: "after a contact", manual: "changed by hand", closed_lost: "closed", reopen: "reopened", promotion: "promoted",
};

/** Whoever it was, by name — never a raw id. A user who has left the organization is not "unknown". */
export const FORMER_MEMBER = "Former member";
export function personName(id: string | null | undefined, names: Record<string, string>, fallback?: string | null): string {
  if (!id) return fallback ?? FORMER_MEMBER;
  return names[id] ?? fallback ?? FORMER_MEMBER;
}

// ─── time, always in Pacific time and always saying so ─────────────────────────────────────────

const TZ = "America/Los_Angeles";
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const TIME = fmt({ hour: "numeric", minute: "2-digit" });
const DAY = fmt({ weekday: "short", month: "short", day: "numeric" });
const DAY_YEAR = fmt({ weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** `YYYY-MM-DD` (a Los Angeles business day) as "Tue, Sep 23". Noon UTC keeps it on the same day. */
export function formatDay(day: string, now: Date = new Date()): string {
  const d = new Date(`${day}T12:00:00Z`);
  return (day.slice(0, 4) === losAngelesDate(now).slice(0, 4) ? DAY : DAY_YEAR).format(d);
}

/** An instant as "2:14 PM PT". */
export const formatTime = (iso: string): string => `${TIME.format(new Date(iso))} PT`;

/** An instant as "Tue, Sep 23 · 2:14 PM PT". */
export function formatInstant(iso: string, now: Date = new Date()): string {
  return `${formatDay(losAngelesDate(new Date(iso)), now)} · ${formatTime(iso)}`;
}

/** A follow-up's due moment: a day, or a day and a time. */
export function formatDue(dueOn: string, dueAt: string | null, now: Date = new Date()): string {
  return dueAt ? formatInstant(dueAt, now) : `${formatDay(dueOn, now)} · any time`;
}

/** Whole calendar days between two Los Angeles business days (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "Today", "Yesterday", "Tomorrow", or the day itself. */
export function relativeDay(day: string, now: Date = new Date()): string {
  const d = dayDiff(losAngelesDate(now), day);
  return d === 0 ? "Today" : d === -1 ? "Yesterday" : d === 1 ? "Tomorrow" : formatDay(day, now);
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  const days = dayDiff(losAngelesDate(new Date(iso)), losAngelesDate(now));
  if (days === 0) return `${Math.floor(ms / 3_600_000)} h ago`;
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return formatDay(losAngelesDate(new Date(iso)), now);
}

// ─── due state: words and a glyph, never colour alone ──────────────────────────────────────────

export type DuePresentation = { label: string; glyph: string; tone: "risk" | "accent" | "neutral" };

/** The server computed the state; this only words it (and adds how late, from the same day). */
export function presentDue(state: DueState, dueOn: string | null, now: Date = new Date()): DuePresentation | null {
  if (state === "none" || !dueOn) return null;
  if (state === "overdue") {
    const late = dayDiff(dueOn, losAngelesDate(now));
    return { label: late <= 0 ? "Overdue" : `Overdue · ${late} ${late === 1 ? "day" : "days"}`, glyph: "!", tone: "risk" };
  }
  if (state === "today") return { label: "Due today", glyph: "●", tone: "accent" };
  return { label: `Due ${relativeDay(dueOn, now).replace(/^Tomorrow$/, "tomorrow")}`, glyph: "○", tone: "neutral" };
}

// ─── the timeline ─────────────────────────────────────────────────────────────────────────────

export type TimelineLine = {
  id: string;
  at: string;
  /** The Los Angeles business day it belongs to, for grouping. */
  day: string;
  kind: TimelineEntry["kind"];
  title: string;
  /** A short second line: channel, reason, due time. */
  detail: string | null;
  /** The operator's own prose — a contact note or a standalone note. Shown once, verbatim. */
  prose: string | null;
  /** A state word shown beside the title (a follow-up's resolution). */
  badge: string | null;
  who: string | null;
};

export function presentTimelineEntry(e: TimelineEntry, names: Record<string, string>, now: Date = new Date()): TimelineLine {
  const base = { id: `${e.kind}:${e.id}`, at: e.at, day: losAngelesDate(new Date(e.at)), kind: e.kind };
  switch (e.kind) {
    case "contact":
      return {
        ...base,
        title: OUTCOME_LABEL[e.outcome as ContactOutcome] ?? "Contact",
        detail: `by ${(CHANNEL_LABEL[e.channel as ContactChannel] ?? "other channel").toLowerCase()}`,
        prose: e.note, badge: null, who: personName(e.actor, names, e.actorName),
      };
    case "stage": {
      const reason = e.lostReason ? LOST_REASON_LABEL[e.lostReason as LostReason] ?? null : null;
      return {
        ...base,
        title: `${e.from ? stageLabel(e.from) : "No stage"} → ${stageLabel(e.to)}`,
        detail: reason ? `Reason: ${reason}` : CAUSE_LABEL[e.cause] ?? null,
        prose: null, badge: null, who: personName(e.actor, names, e.actorName),
      };
    }
    case "followup":
      return {
        ...base,
        title: `${ACTION_LABEL[e.action as FollowUpAction] ?? "Follow-up"} scheduled`,
        // The assignee is named only when it is not the person who scheduled it — otherwise the line
        // would read "… · Maria · Maria".
        detail: `for ${formatDue(e.dueOn, e.dueAt, now)}${e.assignee !== e.actor ? ` · assigned to ${personName(e.assignee, names)}` : ""}`,
        prose: null, badge: FOLLOWUP_STATE_LABEL[e.state] ?? null, who: personName(e.actor, names, e.actorName),
      };
    case "note":
      return { ...base, title: "Note", detail: null, prose: e.body, badge: null, who: personName(e.actor, names, e.actorName) };
    case "event":
      return {
        ...base,
        title: EVENT_LABEL[e.type] ?? "Recorded",
        detail: null, prose: null, badge: null,
        // An imported or system event has no person behind it; saying "Former member" would be false.
        who: e.actor ? personName(e.actor, names, e.actorName) : null,
      };
  }
}

/** Newest-first entries grouped under their Los Angeles day, in order. */
export function groupTimeline(lines: readonly TimelineLine[], now: Date = new Date()): { day: string; label: string; lines: TimelineLine[] }[] {
  const groups: { day: string; label: string; lines: TimelineLine[] }[] = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (last && last.day === l.day) last.lines.push(l);
    else groups.push({ day: l.day, label: relativeDay(l.day, now), lines: [l] });
  }
  return groups;
}

/** The wall-clock time of an entry, for the timeline's left column. */
export const entryTime = (iso: string): string => formatTime(iso);

// ─── what a refusal means to the operator ─────────────────────────────────────────────────────
//
// The route contract names refusals by code (`lib/sales-http`). The sheet decides what to DO about
// each; this decides only what it SAYS, and where — beside the field it concerns, or for the sheet.

export type RefusalWords = { where: "when" | "follow" | "lost" | "sheet"; text: string };

const DUE_WORDS = "That follow-up time can't be used — pick another date or time.";
const REFUSAL_WORDS: Record<string, RefusalWords> = {
  contact_in_future: { where: "when", text: "That time hasn't happened yet." },
  backdate_not_permitted: { where: "when", text: "That's too long ago to record here — contacts can go back 90 days." },
  lost_reason_required: { where: "lost", text: "Choose why it was lost." },
  followup_on_closed_prospect: { where: "follow", text: "A closed prospect can't have a follow-up." },
  invalid_due_on: { where: "follow", text: "That isn't a real date." },
  invalid_due_at: { where: "follow", text: DUE_WORDS },
  offset_required: { where: "follow", text: DUE_WORDS },
  offset_not_los_angeles: { where: "follow", text: DUE_WORDS },
  due_at_not_on_due_on: { where: "follow", text: DUE_WORDS },
  nonexistent_local_time: { where: "follow", text: "That time doesn't exist in Pacific time (the clocks jump forward). Pick another time." },
  followup_assignee_not_permitted: { where: "follow", text: "You can only schedule follow-ups for yourself." },
  no_open_followup: { where: "follow", text: "There's no open follow-up any more — the page has been refreshed." },
  reopen_not_permitted: { where: "sheet", text: "Only the owner can reopen a closed prospect." },
  closed_won_not_permitted: { where: "sheet", text: "Winning a prospect happens through Promote to client." },
  closed_won_is_final: { where: "sheet", text: "This prospect is already won — its stage can't change." },
  nothing_to_do: { where: "sheet", text: "There's nothing to save yet." },
  invalid_command: { where: "sheet", text: "Something in this entry couldn't be read. Check it and save again." },
  prospect_not_found: { where: "sheet", text: "This prospect no longer exists." },
  database_refused: { where: "sheet", text: "This couldn't be saved. Refresh the page and try again." },
};

export function refusalWords(code: string): RefusalWords {
  return REFUSAL_WORDS[code] ?? { where: "sheet", text: "This couldn't be saved. Check the entry and try again." };
}
