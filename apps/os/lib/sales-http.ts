// lib/sales-http — the HTTP contract of the sales-action routes (Slice 2A.1c, frozen here).
//
// ─── REQUESTS ARE STRICT ───────────────────────────────────────────────────────────────────────
//
// Every body is an object whose keys are drawn from a closed list, at every level. There is no field
// for an actor, an author, a role, an organization or a prospect id: the actor is the resolved
// principal, the prospect is the URL. A body that tries to name any of them is refused 400 — not
// ignored — so a client that believes it can choose is told plainly that it cannot.
//
// ─── RESPONSES ─────────────────────────────────────────────────────────────────────────────────
//
//   201  applied           the command ran now
//   200  replayed          the same command id and payload already ran; the SAME outcome
//   200  already_yours     a claim of a prospect the caller already holds (nothing written)
//   400  invalid_command, nothing_to_do                        malformed or empty (incl. outcome/channel contradictions)
//   403  *_not_permitted, closed_won_*                         a lifecycle operation this principal may not perform
//   404  prospect_not_found, followup_not_found
//   409  command_id_conflict                                  body is `{ ok: false, error }` and NOTHING else
//   409  stage_conflict (+ current), already_assigned, followup_owned_by_other (+ fallback), held_prospect,
//        archived_prospect, ambiguous_prospect, assignment_conflict (+ current), followup_conflict,
//        followup_not_open, no_open_followup, followup_on_closed_prospect, followup_choice_required,
//        stage_unchanged, assignment_unchanged, database_refused
//   422  due-time refusals, lost_reason_required, contact_in_future, assignee_not_member
//
// `followup_owned_by_other` carries `fallback: { contactOnly: true, newCommandIdRequired: true }` so the
// UI can offer "Save contact only" — as a NEW command with a NEW id, never a retry of this one.

import { NextResponse } from "next/server";
import type { SalesResult } from "@/core/crm/sales";

export class BadRequest extends Error {
  constructor(readonly field: string, readonly why: string) { super(`${field}: ${why}`); }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Refuse any key outside `allowed` — at this level; callers apply it at every level. */
export function strict(v: unknown, field: string, allowed: readonly string[]): Obj {
  if (!isObj(v)) throw new BadRequest(field, "must be an object");
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new BadRequest(`${field}.${k}`, "is not a field of this request");
  return v;
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw new BadRequest("body", "must be JSON"); }
}

/** The Save body, keys checked at every level. Values are validated by the domain command. */
export function parseSaveBody(raw: unknown) {
  const b = strict(raw, "body", ["commandId", "expectedStage", "contact", "claim", "stage", "followUp"]);
  if (b.contact !== undefined) strict(b.contact, "contact", ["outcome", "channel", "note", "happenedAt"]);
  if (b.stage !== undefined) strict(b.stage, "stage", ["to", "lostReason"]);
  if (b.followUp !== undefined) {
    const f = strict(b.followUp, "followUp", ["schedule", "resolve"]);
    if ("schedule" in f && "resolve" in f) throw new BadRequest("followUp", "schedule or resolve, not both");
    if (f.schedule !== undefined) {
      const s = strict(f.schedule, "followUp.schedule", ["action", "assignee", "dueOn", "dueAt", "note"]);
      if (isObj(s.dueAt)) strict(s.dueAt, "followUp.schedule.dueAt", ["local", "offset"]);
    }
  }
  if (b.claim !== undefined && typeof b.claim !== "boolean") throw new BadRequest("claim", "must be a boolean");
  return b as never;
}

export function parseClaimBody(raw: unknown): { commandId: string } {
  const b = strict(raw, "body", ["commandId"]);
  return { commandId: String(b.commandId ?? "") };
}

export function parseAssignmentBody(raw: unknown) {
  const b = strict(raw, "body", ["commandId", "mode", "expectedAssignee", "to", "openFollowUp"]);
  if (b.mode !== "reassign" && b.mode !== "unassign") throw new BadRequest("mode", "reassign or unassign (a claim has its own route)");
  return b as never;
}

export function parseFollowUpEditBody(raw: unknown) {
  const b = strict(raw, "body", ["commandId", "expected", "changes"]);
  strict(b.expected, "expected", ["action", "assignee", "dueOn", "dueAt"]);
  const c = strict(b.changes, "changes", ["action", "assignee", "dueOn", "dueAt", "note"]);
  if (isObj(c.dueAt)) strict(c.dueAt, "changes.dueAt", ["local", "offset"]);
  return b as never;
}

const STATUS: Record<string, number> = {
  invalid_command: 400, nothing_to_do: 400,
  backdate_not_permitted: 403, reopen_not_permitted: 403, closed_won_not_permitted: 403, closed_won_is_final: 403,
  assignment_not_permitted: 403, followup_edit_not_permitted: 403, followup_assignee_not_permitted: 403,
  prospect_not_found: 404, followup_not_found: 404,
  command_id_conflict: 409, stage_conflict: 409, already_assigned: 409, followup_owned_by_other: 409,
  held_prospect: 409, archived_prospect: 409, ambiguous_prospect: 409, assignment_conflict: 409,
  followup_conflict: 409, followup_not_open: 409, no_open_followup: 409, followup_on_closed_prospect: 409,
  followup_choice_required: 409, stage_unchanged: 409, assignment_unchanged: 409, database_refused: 409,
  invalid_due_on: 422, invalid_due_at: 422, offset_required: 422, nonexistent_local_time: 422,
  offset_not_los_angeles: 422, due_at_not_on_due_on: 422, lost_reason_required: 422, contact_in_future: 422,
  assignee_not_member: 422,
};

/** Refusal details a client may see. Everything else a refusal carries stays on the server. */
const SAFE_DETAIL: Record<string, readonly string[]> = {
  invalid_command: ["field", "why"], stage_conflict: ["current"], stage_unchanged: ["current"],
  assignment_conflict: ["current"], backdate_not_permitted: ["maxDays"], followup_not_open: ["state"],
  invalid_due_on: ["why"], invalid_due_at: ["why"], offset_required: ["why"], nonexistent_local_time: ["why"],
  offset_not_los_angeles: ["why"], due_at_not_on_due_on: ["why"], ambiguous_prospect: [],
};

export function salesResponse(r: SalesResult): Response {
  if (r.status !== "refused") {
    const already = r.outcome.assignment?.result === "already_yours";
    return NextResponse.json(
      { ok: true, status: already ? "already_yours" : r.status, commandId: r.commandId, outcome: r.outcome },
      { status: r.status === "applied" && !already ? 201 : 200 });
  }
  const status = STATUS[r.code] ?? 409;
  // THE CONFLICT LEAKS NOTHING: not the stored outcome, payload, actor, prospect or note.
  if (r.code === "command_id_conflict") return NextResponse.json({ ok: false, error: "command_id_conflict" }, { status });
  const detail = Object.fromEntries(Object.entries(r.detail ?? {}).filter(([k]) => (SAFE_DETAIL[r.code] ?? []).includes(k)));
  const body: Obj = { ok: false, error: r.code, ...(Object.keys(detail).length ? { detail } : {}) };
  if (r.code === "followup_owned_by_other") body.fallback = { contactOnly: true, newCommandIdRequired: true };
  return NextResponse.json(body, { status });
}

export function badRequest(e: BadRequest): Response {
  return NextResponse.json({ ok: false, error: "invalid_command", detail: { field: e.field, why: e.why } }, { status: 400 });
}
