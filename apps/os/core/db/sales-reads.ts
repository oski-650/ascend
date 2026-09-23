// core/db/sales-reads — what the sales screens READ (2A.1c; extended in 2A.2a).
//
// Four reads, each shaped for one screen, and none of them ships history to a list:
//
//   listSalesSection        one bounded section of the /sales work queue (overdue, due today,
//                           unassigned, never contacted, recently contacted) plus its total. The
//                           default view is five of these, ~70 rows — never the 3,100-row table.
//   listSalesQueue          /sales/list: the same summary row, filtered, sorted and keyset-paged.
//   getProspectActionSummary  one prospect: the same facts, plus how much history exists.
//   getProspectTimeline     one prospect's contacts, stage changes, follow-ups, notes and the
//                           business events that have no table of their own — newest first, paged.
//                           The ONLY read that returns prose.
//
// DUE STATE IS COMPUTED IN SQL, from the database clock in America/Los_Angeles: a timed follow-up is
// overdue when its instant has passed, an untimed one when its business day has. Never in the browser,
// whose clock and zone belong to whoever is holding the phone.
//
// All run in the caller's transaction, bound to a principal (`withProspectDb`), so RLS scopes every
// row to the organization. Read server-side, in the page's own guarded render — the same rule the note
// log follows (no client fetch of prospect data).

import "server-only";
import type { ProspectStatus } from "@/domain";
import type { SqlClient } from "./client";

export type LatestContact = { outcome: string; channel: string; happenedAt: string } | null;
export type OpenFollowUp = { followupId: string; action: string; assignee: string; dueOn: string; dueAt: string | null } | null;
/** Derived, never stored: where the open follow-up stands against Los Angeles "now". */
export type DueState = "overdue" | "today" | "upcoming" | "none";

export type SalesQueueRow = {
  id: string;
  anchor: string;
  slug: string | null;
  name: string | null;
  status: ProspectStatus | null;
  assignedTo: string | null;
  firstContact: string | null;
  lastContact: string | null;
  latestContact: LatestContact;
  openFollowUp: OpenFollowUp;
  dueState: DueState;
};

export type SalesQueueFilter = {
  /** A user id, or "unassigned". Absent → everyone's. */
  assignee?: string;
  /** With `assignee`: also include prospects nobody holds (the sales default scope, 2A.2 Q2). */
  includeUnassigned?: boolean;
  unassignedOnly?: boolean;
  stage?: ProspectStatus;
  dueState?: DueState;
  neverContacted?: boolean;
  contactedWithinDays?: number;
  /** Case-insensitive PREFIX of the business name. */
  search?: string;
  sort?: "name" | "due" | "last_contact";
  after?: Cursor;
  limit?: number;
};

/** Keyset cursor: the sort's leading value, then the row id to break ties. */
export type Cursor = { key: string; id: string };

export const QUEUE_PAGE_MAX = 200;
export const SECTION_PAGE_MAX = 50;
export const SECTION_DEFAULTS: Record<SalesSection, number> = {
  overdue: 20, due_today: 20, unassigned: 10, never_contacted: 10, recently_contacted: 10,
};
export type SalesSection = "overdue" | "due_today" | "unassigned" | "never_contacted" | "recently_contacted";

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
type Row = Record<string, unknown>;

/** Los Angeles "today" and the due-state expression, from the DATABASE clock. */
const TODAY_LA = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;
const DUE_STATE = `CASE
    WHEN f.followup_id IS NULL THEN 'none'
    WHEN (f.due_at IS NOT NULL AND f.due_at < now()) OR (f.due_at IS NULL AND f.due_on < ${TODAY_LA}) THEN 'overdue'
    WHEN f.due_on = ${TODAY_LA} THEN 'today'
    ELSE 'upcoming' END`;

const SUMMARY_COLUMNS = `
  p.id::text AS id, p.prospect_id::text AS anchor, p.slug, p.name, p.status, p.assigned_to::text AS assigned_to,
  p.first_contact::text AS first_contact, p.last_contact::text AS last_contact,
  c.outcome, c.channel, c.happened_at,
  f.followup_id::text AS followup_id, f.action, f.assignee_user_id::text AS followup_assignee,
  f.due_on::text AS due_on, f.due_at, ${DUE_STATE} AS due_state`;
const SUMMARY_JOINS = `
  LEFT JOIN LATERAL (
    SELECT outcome, channel, happened_at FROM prospect_contacts c
     WHERE c.prospect = p.id ORDER BY c.happened_at DESC, c.contact_id DESC LIMIT 1) c ON true
  LEFT JOIN prospect_followups f ON f.prospect = p.id AND f.state = 'open'`;
/** Every query in this module is scoped to the workable set: active and anchored. */
const WORKABLE = ["p.archived_at IS NULL", "p.identity_state = 'anchored'"];

function toSummary(r: Row): SalesQueueRow {
  return {
    id: String(r.id), anchor: String(r.anchor), slug: (r.slug as string | null) ?? null, name: (r.name as string | null) ?? null,
    status: (r.status as ProspectStatus | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null,
    firstContact: (r.first_contact as string | null) ?? null, lastContact: (r.last_contact as string | null) ?? null,
    latestContact: r.outcome ? { outcome: String(r.outcome), channel: String(r.channel), happenedAt: iso(r.happened_at)! } : null,
    openFollowUp: r.followup_id ? { followupId: String(r.followup_id), action: String(r.action), assignee: String(r.followup_assignee),
      dueOn: String(r.due_on), dueAt: iso(r.due_at) } : null,
    dueState: (r.due_state as DueState) ?? "none",
  };
}

/** A parameter list that numbers itself, so no query counts `$n` by hand. */
function binder() {
  const params: (string | number)[] = [];
  return { params, bind: (v: string | number) => { params.push(v); return `$${params.length}`; } };
}

function scopeWhere(f: SalesQueueFilter, bind: (v: string | number) => string): string[] {
  const where: string[] = [...WORKABLE];
  if (f.unassignedOnly) where.push("p.assigned_to IS NULL");
  else if (f.assignee && f.includeUnassigned) where.push(`(p.assigned_to = ${bind(f.assignee)}::uuid OR p.assigned_to IS NULL)`);
  else if (f.assignee) where.push(`p.assigned_to = ${bind(f.assignee)}::uuid`);
  if (f.stage) where.push(`p.status = ${bind(f.stage)}`);
  if (f.neverContacted) where.push("p.last_contact IS NULL");
  if (f.contactedWithinDays !== undefined) where.push(`p.last_contact >= ${TODAY_LA} - ${bind(Math.trunc(f.contactedWithinDays))}::int`);
  if (f.search) where.push(`p.name ILIKE ${bind(f.search.replace(/[%_\\]/g, "\\$&"))} || '%'`);
  if (f.dueState === "none") where.push("f.followup_id IS NULL");
  else if (f.dueState) where.push(`${DUE_STATE} = ${bind(f.dueState)}`);
  return where;
}

const ORDER: Record<NonNullable<SalesQueueFilter["sort"]>, { expr: string; key: string }> = {
  // The tie-break is always the row id, so a cursor is exact.
  name: { expr: `coalesce(p.name, '') COLLATE "C"`, key: `coalesce(p.name, '')` },
  due: { expr: `coalesce(f.due_at, (f.due_on + time '00:00') AT TIME ZONE 'America/Los_Angeles')`, key: `coalesce(f.due_at, (f.due_on + time '00:00') AT TIME ZONE 'America/Los_Angeles')::text` },
  last_contact: { expr: `p.last_contact DESC NULLS LAST, coalesce(p.name, '') COLLATE "C"`, key: `coalesce(p.last_contact::text, '')` },
};

/** `/sales/list`: the summary row, filtered, sorted, keyset-paged. */
export async function listSalesQueue(tx: SqlClient, filter: SalesQueueFilter = {}): Promise<{ rows: SalesQueueRow[]; next: Cursor | null }> {
  const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 100)), QUEUE_PAGE_MAX);
  const { params, bind } = binder();
  const where = scopeWhere(filter, bind);
  const sort = filter.sort ?? "name";
  const order = ORDER[sort];
  if (filter.after) where.push(`(${order.key}, p.id::text) > (${bind(filter.after.key)}, ${bind(filter.after.id)})`);
  const { rows } = await tx.query<Row>(
    `SELECT ${SUMMARY_COLUMNS}, ${order.key} AS cursor_key FROM prospects p ${SUMMARY_JOINS}
      WHERE ${where.join(" AND ")}
      ORDER BY ${order.expr}, p.id::text COLLATE "C"
      LIMIT ${bind(limit + 1)}`, params);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(toSummary),
    next: rows.length > limit && last ? { key: String(last.cursor_key ?? ""), id: String(last.id) } : null,
  };
}

/** One bounded section of the `/sales` work queue, with the total behind it. */
export async function listSalesSection(
  tx: SqlClient, section: SalesSection,
  scope: { assignee?: string; includeUnassigned?: boolean; limit?: number; recentDays?: number } = {},
): Promise<{ rows: SalesQueueRow[]; total: number; limit: number }> {
  const limit = Math.min(Math.max(1, Math.trunc(scope.limit ?? SECTION_DEFAULTS[section])), SECTION_PAGE_MAX);
  const base: SalesQueueFilter = { assignee: scope.assignee, includeUnassigned: scope.includeUnassigned };
  const filter: SalesQueueFilter =
    section === "overdue" ? { ...base, dueState: "overdue", sort: "due" }
    : section === "due_today" ? { ...base, dueState: "today", sort: "due" }
    // The unassigned section is the ONE that ignores the scope: it is the pool everyone draws from.
    : section === "unassigned" ? { unassignedOnly: true, sort: "name" }
    : section === "never_contacted" ? { ...base, neverContacted: true, sort: "name" }
    : { ...base, contactedWithinDays: scope.recentDays ?? 7, sort: "last_contact" };

  const { params, bind } = binder();
  const where = scopeWhere(filter, bind);
  const total = Number((await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM prospects p ${SUMMARY_JOINS} WHERE ${where.join(" AND ")}`, params)).rows[0].n);
  const { rows } = await listSalesQueue(tx, { ...filter, limit });
  return { rows, total, limit };
}

export type ActionSummary = SalesQueueRow & { archived: boolean; held: boolean; contacts: number; transitions: number };

/** One prospect's action summary, by row id. Null when the row is not visible to this principal. */
export async function getProspectActionSummary(tx: SqlClient, prospectRowId: string): Promise<ActionSummary | null> {
  const { rows } = await tx.query<Row>(
    `SELECT ${SUMMARY_COLUMNS}, p.archived_at IS NOT NULL AS archived, p.identity_state = 'held' AS held,
            (SELECT count(*) FROM prospect_contacts x WHERE x.prospect = p.id)::int AS contacts,
            (SELECT count(*) FROM prospect_stage_transitions t WHERE t.prospect = p.id)::int AS transitions
       FROM prospects p ${SUMMARY_JOINS} WHERE p.id = $1`, [prospectRowId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...toSummary({ ...r, anchor: r.anchor ?? "" }), archived: r.archived === true, held: r.held === true,
    contacts: Number(r.contacts), transitions: Number(r.transitions) };
}

// ─── the timeline ─────────────────────────────────────────────────────────────────────────────
//
// Sourced from the CANONICAL tables, plus only those events that have no table of their own. The
// events a table already represents (`prospect.contacted`, `status_changed`, `followup_*`,
// `note_added`) are deliberately excluded: rendering both would show the same fact twice.

export const TIMELINE_EVENT_TYPES = ["prospect.created", "prospect.promoted", "prospect.archived", "prospect.assessed"] as const;

export type TimelineEntry =
  | { kind: "contact"; at: string; id: string; actor: string; actorName: string | null; outcome: string; channel: string; note: string | null }
  | { kind: "stage"; at: string; id: string; actor: string; actorName: string | null; from: string | null; to: string; cause: string; lostReason: string | null }
  | { kind: "followup"; at: string; id: string; actor: string; actorName: string | null; action: string; assignee: string; dueOn: string; dueAt: string | null; state: string }
  | { kind: "note"; at: string; id: string; actor: string; actorName: string | null; body: string }
  | { kind: "event"; at: string; id: string; actor: string | null; actorName: string | null; type: string };

// ─── THE TIMELINE'S TOTAL ORDER (2A.2b) ─────────────────────────────────────────────────────────
//
// One command writes its contact, stage change and follow-up in ONE transaction, so all three carry
// the SAME timestamp (`now()` is the transaction's start). A cursor on the timestamp alone therefore
// skipped entries at a page boundary. Every entry now has a unique position:
//
//     (at DESC, rank DESC, id DESC)
//
//   at     the entry's instant, compared at full database precision (never a JS Date, which would
//          drop the microseconds)
//   rank   a FIXED number per source table — contact 1 · stage 2 · follow-up 3 · note 4 · event 5 —
//          so entries sharing an instant always fall in the same order: within one command,
//          newest-first reads follow-up → stage → contact, the reverse of the order they were written
//   id     the source row's UUID, compared bytewise (`COLLATE "C"`); unique within a source, and the
//          rank already separates the sources
//
// The cursor is that tuple for the last entry shown, encoded as an OPAQUE string: the UI passes it
// back and never reads it. Keyset only, so an entry inserted after page 1 was read cannot shift page 2.

export const TIMELINE_RANK = { contact: 1, stage: 2, followup: 3, note: 4, event: 5 } as const;
export const TIMELINE_PAGE = 50;

type TimelineCursor = { a: string; r: number; i: string };

export function encodeTimelineCursor(c: TimelineCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** Null for anything that is not a cursor this module wrote — a tampered URL starts at the top. */
export function decodeTimelineCursor(raw: string | null | undefined): TimelineCursor | null {
  if (!raw || raw.length > 400) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<TimelineCursor>;
    if (typeof c.a !== "string" || Number.isNaN(Date.parse(c.a)) || !Number.isInteger(c.r) || c.r! < 1 || c.r! > 5
      || typeof c.i !== "string" || !/^[0-9a-f-]{36}$/.test(c.i)) return null;
    return { a: c.a, r: c.r!, i: c.i };
  } catch { return null; }
}

export type TimelinePage = { entries: TimelineEntry[]; next: string | null };

/**
 * One prospect's action history, newest first, one page at a time. `cursor` is the `next` of the
 * previous page. `anchor` is needed because events are keyed by the identity anchor, not the row id.
 */
export async function getProspectTimeline(
  tx: SqlClient, target: { prospectRowId: string; anchor?: string | null }, opts: { limit?: number; cursor?: string | null } = {},
): Promise<TimelinePage> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? TIMELINE_PAGE)), QUEUE_PAGE_MAX);
  const after = decodeTimelineCursor(opts.cursor);
  const { rows } = await tx.query<Row>(
    `SELECT h.*, h.at::text AS at_exact, u.display_name AS actor_name FROM (
       SELECT 'contact' AS kind, 1 AS rank, happened_at AS at, contact_id::text AS id, author_user_id::text AS actor,
              outcome, channel, note, NULL AS from_status, NULL AS to_status, NULL AS cause, NULL AS lost_reason,
              NULL AS action, NULL AS assignee, NULL::text AS due_on, NULL::timestamptz AS due_at, NULL AS state, NULL AS type
         FROM prospect_contacts WHERE prospect = $1
       UNION ALL
       SELECT 'stage', 2, recorded_at, transition_id::text, actor_user_id::text, NULL, NULL, NULL,
              from_status, to_status, cause, lost_reason, NULL, NULL, NULL, NULL, NULL, NULL
         FROM prospect_stage_transitions WHERE prospect = $1
       UNION ALL
       SELECT 'followup', 3, created_at, followup_id::text, created_by::text, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, action, assignee_user_id::text, due_on::text, due_at, state, NULL
         FROM prospect_followups WHERE prospect = $1
       UNION ALL
       SELECT 'note', 4, created_at, note_id::text, author_user_id::text, NULL, NULL, body,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
         FROM prospect_notes WHERE prospect = $1
       UNION ALL
       SELECT 'event', 5, occurred_at, event_id::text, actor_user_id::text, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, type
         FROM events
        WHERE $2::text IS NOT NULL AND subject_entity = 'prospect' AND subject_entity_id = $2::text
          AND type = ANY($3::text[])
     ) h
     LEFT JOIN users u ON u.id::text = h.actor
     WHERE $4::timestamptz IS NULL
        OR (h.at, h.rank, h.id COLLATE "C") < ($4::timestamptz, $5::int, $6::text COLLATE "C")
     ORDER BY h.at DESC, h.rank DESC, h.id COLLATE "C" DESC
     LIMIT $7`,
    [target.prospectRowId, target.anchor ?? null, [...TIMELINE_EVENT_TYPES] as unknown as string,
     after?.a ?? null, after?.r ?? null, after?.i ?? null, limit + 1]);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const entries = page.map((r): TimelineEntry => {
    const base = { at: iso(r.at)!, id: String(r.id), actor: String(r.actor), actorName: (r.actor_name as string | null) ?? null };
    if (r.kind === "contact") return { kind: "contact", ...base, outcome: String(r.outcome), channel: String(r.channel), note: (r.note as string | null) ?? null };
    if (r.kind === "stage") return { kind: "stage", ...base, from: (r.from_status as string | null) ?? null, to: String(r.to_status), cause: String(r.cause), lostReason: (r.lost_reason as string | null) ?? null };
    if (r.kind === "followup") return { kind: "followup", ...base, action: String(r.action), assignee: String(r.assignee), dueOn: String(r.due_on), dueAt: iso(r.due_at), state: String(r.state) };
    if (r.kind === "note") return { kind: "note", ...base, body: String(r.note) };
    return { kind: "event", at: base.at, id: base.id, actor: r.actor === null ? null : String(r.actor), actorName: base.actorName, type: String(r.type) };
  });
  return {
    entries,
    next: rows.length > limit && last ? encodeTimelineCursor({ a: String(last.at_exact), r: Number(last.rank), i: String(last.id) }) : null,
  };
}

// ─── who is who (2A.2b) ───────────────────────────────────────────────────────────────────────
//
// The detail page names people — the assignee, the follow-up's owner, every timeline author — and
// must not fetch from the browser to do it. So the page reads the organization's members ONCE, here,
// and builds the id → display-name map on the server. Only the name travels to the UI.
//
// Disabled members are included on purpose: they still authored history. A user who is no longer a
// member at all is absent from the map, and the UI shows a neutral fallback rather than an id.

export type MemberDirectory = { viewer: string; names: Record<string, string> };

export async function listMemberNames(tx: SqlClient): Promise<MemberDirectory> {
  const { rows } = await tx.query<{ id: string; name: string; viewer: string }>(
    `SELECT u.id::text AS id,
            coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)) AS name,
            current_user_id()::text AS viewer
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = current_org()`);
  const viewer = rows[0]?.viewer
    ?? String((await tx.query<{ viewer: string }>("SELECT current_user_id()::text AS viewer")).rows[0].viewer);
  return { viewer, names: Object.fromEntries(rows.map((r) => [r.id, r.name])) };
}
