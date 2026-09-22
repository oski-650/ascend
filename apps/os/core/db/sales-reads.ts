// core/db/sales-reads — what the 2A.2 sales screens READ (Slice 2A.1c).
//
// Three reads, each shaped for one screen, and none of them ships history to a list:
//
//   listSalesQueue          the /sales list: one row per ACTIVE, anchored prospect with its stage, its
//                           assignee, its LATEST contact and its OPEN follow-up — keyset-paginated,
//                           filtered in SQL. Two index lookups per row (the contact timeline index and
//                           the one-open partial unique index), never a scan of either history table.
//   getProspectActionSummary  one prospect: the same facts, plus how much history exists.
//   getProspectTimeline     one prospect's contacts, stage changes and follow-ups, newest first,
//                           paginated. The only read that returns contact notes.
//
// All run in the caller's transaction, bound to a principal (`withProspectDb`), so RLS scopes every
// row to the organization. Read server-side, in the page's own guarded render — the same rule the note
// log follows (no client fetch of prospect data).

import "server-only";
import type { ProspectStatus } from "@/domain";
import type { SqlClient } from "./client";

export type LatestContact = { outcome: string; channel: string; happenedAt: string } | null;
export type OpenFollowUp = { followupId: string; action: string; assignee: string; dueOn: string; dueAt: string | null } | null;

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
};

export type SalesQueueFilter = {
  /** A user id, or "unassigned". Absent → everyone's. */
  assignee?: string;
  stage?: ProspectStatus;
  /** Only prospects whose open follow-up is due on or before this business date (YYYY-MM-DD). */
  dueBy?: string;
  /** Keyset cursor: the `{ name, id }` of the last row of the previous page. */
  after?: { name: string; id: string };
  limit?: number;
};

export const QUEUE_PAGE_MAX = 200;
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

type Row = Record<string, unknown>;
const SUMMARY_COLUMNS = `
  p.id::text AS id, p.prospect_id::text AS anchor, p.slug, p.name, p.status, p.assigned_to::text AS assigned_to,
  p.first_contact::text AS first_contact, p.last_contact::text AS last_contact,
  c.outcome, c.channel, c.happened_at,
  f.followup_id::text AS followup_id, f.action, f.assignee_user_id::text AS followup_assignee, f.due_on::text AS due_on, f.due_at`;
const SUMMARY_JOINS = `
  LEFT JOIN LATERAL (
    SELECT outcome, channel, happened_at FROM prospect_contacts c
     WHERE c.prospect = p.id ORDER BY c.happened_at DESC, c.contact_id DESC LIMIT 1) c ON true
  LEFT JOIN prospect_followups f ON f.prospect = p.id AND f.state = 'open'`;

function toSummary(r: Row): SalesQueueRow {
  return {
    id: String(r.id), anchor: String(r.anchor), slug: (r.slug as string | null) ?? null, name: (r.name as string | null) ?? null,
    status: (r.status as ProspectStatus | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null,
    firstContact: (r.first_contact as string | null) ?? null, lastContact: (r.last_contact as string | null) ?? null,
    latestContact: r.outcome ? { outcome: String(r.outcome), channel: String(r.channel), happenedAt: iso(r.happened_at)! } : null,
    openFollowUp: r.followup_id ? { followupId: String(r.followup_id), action: String(r.action), assignee: String(r.followup_assignee),
      dueOn: String(r.due_on), dueAt: iso(r.due_at) } : null,
  };
}

/** The /sales list: active, anchored prospects, one summary row each, keyset-paginated by (name, id). */
export async function listSalesQueue(tx: SqlClient, filter: SalesQueueFilter = {}): Promise<{ rows: SalesQueueRow[]; next: { name: string; id: string } | null }> {
  const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 100)), QUEUE_PAGE_MAX);
  const where: string[] = ["p.archived_at IS NULL", "p.identity_state = 'anchored'"];
  const params: (string | number)[] = [];
  const bind = (v: string | number) => { params.push(v); return `$${params.length}`; };
  if (filter.assignee === "unassigned") where.push("p.assigned_to IS NULL");
  else if (filter.assignee) where.push(`p.assigned_to = ${bind(filter.assignee)}::uuid`);
  if (filter.stage) where.push(`p.status = ${bind(filter.stage)}`);
  if (filter.dueBy) where.push(`f.due_on <= ${bind(filter.dueBy)}::date`);
  if (filter.after) where.push(`(coalesce(p.name, ''), p.id::text) > (${bind(filter.after.name)}, ${bind(filter.after.id)})`);
  const { rows } = await tx.query<Row>(
    `SELECT ${SUMMARY_COLUMNS} FROM prospects p ${SUMMARY_JOINS}
      WHERE ${where.join(" AND ")}
      ORDER BY coalesce(p.name, '') COLLATE "C", p.id::text COLLATE "C"
      LIMIT ${bind(limit + 1)}`, params);
  const page = rows.slice(0, limit).map(toSummary);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > limit && last ? { name: last.name ?? "", id: last.id } : null };
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

export type TimelineEntry =
  | { kind: "contact"; at: string; id: string; actor: string; outcome: string; channel: string; note: string | null }
  | { kind: "stage"; at: string; id: string; actor: string; from: string | null; to: string; cause: string; lostReason: string | null }
  | { kind: "followup"; at: string; id: string; actor: string; action: string; assignee: string; dueOn: string; dueAt: string | null; state: string };

/** One prospect's action history, newest first; `before` is the `at` of the last entry already shown. */
export async function getProspectTimeline(tx: SqlClient, prospectRowId: string, opts: { limit?: number; before?: string } = {}): Promise<TimelineEntry[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 50)), QUEUE_PAGE_MAX);
  const { rows } = await tx.query<Row>(
    `SELECT * FROM (
       SELECT 'contact' AS kind, happened_at AS at, contact_id::text AS id, author_user_id::text AS actor,
              outcome, channel, note, NULL AS from_status, NULL AS to_status, NULL AS cause, NULL AS lost_reason,
              NULL AS action, NULL AS assignee, NULL::text AS due_on, NULL::timestamptz AS due_at, NULL AS state
         FROM prospect_contacts WHERE prospect = $1
       UNION ALL
       SELECT 'stage', recorded_at, transition_id::text, actor_user_id::text, NULL, NULL, NULL,
              from_status, to_status, cause, lost_reason, NULL, NULL, NULL, NULL, NULL
         FROM prospect_stage_transitions WHERE prospect = $1
       UNION ALL
       SELECT 'followup', created_at, followup_id::text, created_by::text, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, action, assignee_user_id::text, due_on::text, due_at, state
         FROM prospect_followups WHERE prospect = $1
     ) h
     WHERE $2::timestamptz IS NULL OR h.at < $2::timestamptz
     ORDER BY h.at DESC, h.id DESC LIMIT $3`, [prospectRowId, opts.before ?? null, limit]);
  return rows.map((r): TimelineEntry => {
    const base = { at: iso(r.at)!, id: String(r.id), actor: String(r.actor) };
    if (r.kind === "contact") return { kind: "contact", ...base, outcome: String(r.outcome), channel: String(r.channel), note: (r.note as string | null) ?? null };
    if (r.kind === "stage") return { kind: "stage", ...base, from: (r.from_status as string | null) ?? null, to: String(r.to_status), cause: String(r.cause), lostReason: (r.lost_reason as string | null) ?? null };
    return { kind: "followup", ...base, action: String(r.action), assignee: String(r.assignee), dueOn: String(r.due_on), dueAt: iso(r.due_at), state: String(r.state) };
  });
}
