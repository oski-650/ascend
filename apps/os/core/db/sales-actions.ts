// core/db/sales-actions — the sales COMMANDS: record a contact, move a stage, schedule or resolve a
// follow-up, claim or reassign a prospect (Slice 2A.1b; contract docs/SLICE-2A1B-CONTRACT.md §7–§14).
//
// ─── ONE COMMAND, ONE TRANSACTION, ONE LOCK ────────────────────────────────────────────────────
//
// A mobile Save is several facts that must land together or not at all: the contact, the contact
// dates it moves, perhaps a claim, perhaps a stage change, perhaps the next follow-up, and the events
// that record each. Separate writes would allow a contact without its follow-up — exactly the partial
// state the per-prospect advisory lock (D1b) exists to prevent. So every command here runs inside the
// caller's transaction, under `lockProspect(anchor)`, and in this order:
//
//   1. validate the whole request (pure — nothing read yet)
//   2. resolve the prospect (held → refused), lock it, re-read it (archived → refused)
//   3. receipt: the same command id already committed → its stored outcome (same digest) or
//      `command_id_conflict` (different digest)
//   4. authorize EVERY part against the re-read state — before the first write
//   5. write through the guarded database functions (010) and the follow-up grants
//   6. the receipt, then the events — `correlation_id` = the command id
//
// A refusal in steps 1–4 returns before anything is written. A disagreement discovered in step 5
// (which the lock makes unreachable in practice) throws `SalesCommandAbort`, so the caller's
// transaction rolls back EVERYTHING — there is never a partial contact-only success from a combined
// command. The UI may then send a NEW, contact-only command with a new id.
//
// ─── WHAT THE DATABASE CHECKS AGAIN ────────────────────────────────────────────────────────────
//
// The guarded functions re-validate the actor's membership and role from `memberships`, the
// prospect's organization, anchoring and archival, and compare-and-set the stage and assignee. The
// rules the database cannot see — the 90-day sales backdate limit, who may touch whose follow-up in
// a combined Save — are checked here, and only here.

import "server-only";
import { createHash } from "node:crypto";
import { uuidv7, type ProspectStatus } from "@/domain";
import type { ResolvedPrincipal } from "@/core/auth/principal";
import type { SqlClient } from "./client";
import { appendEvent } from "./events";
import { lockProspect, resolveProspectForMutation } from "./prospects";
import { resolveDue, type DueAtInput } from "@/domain";

// ─── vocabulary (frozen, 2A preflight §20 and 2A.1 amendments) ─────────────────────────────────

export const CONTACT_OUTCOMES = ["no_answer", "voicemail", "spoke", "interested", "not_interested",
  "callback_requested", "meeting_set", "wrong_number", "email_sent", "other"] as const;
export const CONTACT_CHANNELS = ["call", "email", "text", "in_person", "other"] as const;
export const FOLLOWUP_ACTIONS = ["call", "email", "text", "meeting", "other"] as const;
export const LOST_REASONS = ["not_interested", "no_budget", "too_expensive", "chose_competitor", "not_a_fit",
  "unreachable", "wrong_contact", "timing", "duplicate", "other"] as const;
export const STAGE_TARGETS = ["lead", "contacted", "proposal", "closed-lost"] as const;

export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export type FollowUpAction = (typeof FOLLOWUP_ACTIONS)[number];
export type LostReason = (typeof LOST_REASONS)[number];
export type StageTarget = (typeof STAGE_TARGETS)[number];

/** Sales may date a contact at most this far back. Owners may record older history (A6). */
export const SALES_BACKDATE_DAYS = 90;
/** Clock skew tolerated for a contact "in the future" — the database CHECK uses the same bound. */
export const FUTURE_SKEW_MS = 5 * 60_000;
export const NOTE_MAX = 2000;

// ─── commands ─────────────────────────────────────────────────────────────────────────────────

export type SaveCommand = {
  /** Client-generated UUID, reused unchanged on retry. */
  commandId: string;
  /** Slug, anchor or row id — resolved exactly as every prospect mutation is. */
  prospect: string;
  /** The stage the user SAW. Required with `stage`; the compare-and-set value. */
  expectedStage?: ProspectStatus | null;
  contact?: { outcome: ContactOutcome; channel: ContactChannel; note?: string | null; happenedAt?: string | null };
  claim?: boolean;
  stage?: { to: StageTarget; lostReason?: LostReason | null };
  followUp?:
    | { schedule: { action: FollowUpAction; assignee?: string | null; dueOn: string; dueAt?: DueAtInput | null; note?: string | null } }
    | { resolve: "completed" | "cancelled" };
};

export type AssignmentCommand = {
  commandId: string;
  prospect: string;
  mode: "claim" | "reassign" | "unassign";
  /** reassign/unassign: the assignee the owner SAW (compare-and-set). */
  expectedAssignee?: string | null;
  /** reassign: the new assignee. */
  to?: string | null;
  /** reassign/unassign with an open follow-up: what happens to it. Never inferred (A5). */
  openFollowUp?: "leave" | "transfer" | "cancel";
};

export type CommandOutcome = {
  prospect: string;
  anchor: string;
  contact?: { contactId: string };
  stage?: { transitionId: string; from: ProspectStatus | null; to: ProspectStatus; cause: string };
  assignment?: { result: string; from: string | null; to: string | null };
  followUp?: { created?: string; completed?: string; superseded?: string; cancelled?: string; transferred?: string; updated?: string; changed?: string[] };
};

export type SalesResult =
  | { status: "applied" | "replayed"; commandId: string; outcome: CommandOutcome }
  | { status: "refused"; code: string; detail?: Record<string, unknown> };

/** A refusal discovered after a write: thrown so the caller's transaction rolls back completely. */
export class SalesCommandAbort extends Error {
  constructor(readonly code: string, readonly detail: Record<string, unknown> = {}) { super(`sales command aborted: ${code}`); }
}

const isResult = (v: ValidSave | SalesResult): v is SalesResult => "status" in v && typeof (v as { status: unknown }).status === "string" && ["applied", "replayed", "refused"].includes((v as { status: string }).status);
const refused = (code: string, detail?: Record<string, unknown>): SalesResult => ({ status: "refused", code, ...(detail ? { detail } : {}) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

// ─── the canonical digest ─────────────────────────────────────────────────────────────────────

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export const commandDigest = (normalized: unknown): string => createHash("sha256").update(canonical(normalized), "utf8").digest("hex");

// ─── shared steps ─────────────────────────────────────────────────────────────────────────────

type Target = { id: string; anchor: string; status: ProspectStatus | null; assignedTo: string | null };

/** Resolve, lock, re-read. Refuses held and archived. */
async function lockTarget(tx: SqlClient, reference: string): Promise<{ ok: true; target: Target } | { ok: false; result: SalesResult }> {
  const no = (result: SalesResult) => ({ ok: false as const, result });
  const r = await resolveProspectForMutation(tx, reference);
  if (!r.ok) {
    if (r.reason === "not_found") return no(refused("prospect_not_found"));
    if (r.reason === "ambiguous") return no(refused("ambiguous_prospect", { matches: r.matches }));
    return no(refused("held_prospect"));
  }
  await lockProspect(tx, r.target.prospectId);
  const { rows } = await tx.query<{ id: string; status: ProspectStatus | null; assigned_to: string | null; archived_at: unknown }>(
    "SELECT id, status, assigned_to, archived_at FROM prospects WHERE id = $1", [r.target.id]);
  if (rows.length === 0) return no(refused("prospect_not_found"));
  if (rows[0].archived_at !== null && rows[0].archived_at !== undefined) return no(refused("archived_prospect"));
  return { ok: true, target: { id: rows[0].id, anchor: r.target.prospectId, status: rows[0].status, assignedTo: rows[0].assigned_to } };
}

/** Same id + same digest → the stored outcome. Same id + anything else → conflict. Absent → null. */
async function priorReceipt(tx: SqlClient, commandId: string, digest: string, prospect: string, actor: string): Promise<SalesResult | null> {
  const { rows } = await tx.query<{ prospect: string; actor_user_id: string; payload_sha256: string; outcome: CommandOutcome | string }>(
    "SELECT prospect, actor_user_id, payload_sha256, outcome FROM prospect_command_receipts WHERE command_id = $1", [commandId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.payload_sha256 !== digest || r.prospect !== prospect || r.actor_user_id !== actor) return refused("command_id_conflict");
  const outcome = typeof r.outcome === "string" ? (JSON.parse(r.outcome) as CommandOutcome) : r.outcome;
  return { status: "replayed", commandId, outcome };
}

async function writeReceipt(tx: SqlClient, p: ResolvedPrincipal, commandId: string, target: Target, kind: string, digest: string, outcome: CommandOutcome) {
  await tx.query(
    `INSERT INTO prospect_command_receipts (command_id, organization_id, prospect, actor_user_id, kind, payload_sha256, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [commandId, p.organizationId, target.id, p.userId, kind, digest, JSON.stringify(outcome)]);
}

async function isEnabledMember(tx: SqlClient, userId: string): Promise<boolean> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND m.organization_id = current_org() AND u.disabled_at IS NULL`, [userId]);
  return Number(rows[0].n) === 1;
}

type OpenFollowUp = { followupId: string; assignee: string } | null;
async function openFollowUpOf(tx: SqlClient, prospectRow: string): Promise<OpenFollowUp> {
  const { rows } = await tx.query<{ followup_id: string; assignee_user_id: string }>(
    "SELECT followup_id, assignee_user_id FROM prospect_followups WHERE prospect = $1 AND state = 'open'", [prospectRow]);
  return rows.length ? { followupId: rows[0].followup_id, assignee: rows[0].assignee_user_id } : null;
}

async function resolveFollowUp(tx: SqlClient, p: ResolvedPrincipal, followupId: string, state: "completed" | "cancelled" | "superseded",
  commandId: string, byContact: string | null, supersededBy: string | null) {
  const { rows } = await tx.query(
    `UPDATE prospect_followups
        SET state = $2, resolved_by = $3, resolved_at = now(), resolved_by_command = $4,
            resolved_by_contact = $5, superseded_by = $6
      WHERE followup_id = $1 AND state = 'open' RETURNING followup_id`,
    [followupId, state, p.userId, commandId, byContact, supersededBy]);
  if (rows.length !== 1) throw new SalesCommandAbort("followup_not_resolvable", { followupId });
}

const subject = (t: Target) => ({ entity: "prospect" as const, entity_id: t.anchor });

// ─── the Save ─────────────────────────────────────────────────────────────────────────────────

type ValidSave = {
  contact?: { outcome: ContactOutcome; channel: ContactChannel; note: string | null; happenedAt: string | null };
  claim: boolean;
  stage?: { to: StageTarget; lostReason: LostReason | null };
  schedule?: { action: FollowUpAction; assignee: string | null; dueOn: string; dueAt: string | null; note: string | null };
  resolve?: "completed" | "cancelled";
};

function cleanNote(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (t === "") return null;
  return t.length > NOTE_MAX ? "invalid" : t;
}

/** Step 1: shape and vocabulary. Pure. */
export function validateSave(cmd: SaveCommand): ValidSave | SalesResult {
  const bad = (field: string, why: string) => refused("invalid_command", { field, why });
  if (typeof cmd.commandId !== "string" || !UUID.test(cmd.commandId.toLowerCase())) return bad("commandId", "a UUID is required");
  if (typeof cmd.prospect !== "string" || cmd.prospect.trim() === "") return bad("prospect", "required");
  const out: ValidSave = { claim: cmd.claim === true };
  if (cmd.contact !== undefined) {
    const c = cmd.contact;
    if (!isOneOf(CONTACT_OUTCOMES, c?.outcome)) return bad("contact.outcome", "not a known outcome");
    if (!isOneOf(CONTACT_CHANNELS, c.channel)) return bad("contact.channel", "not a known channel");
    if (c.outcome === "email_sent" && c.channel !== "email") return bad("contact.channel", "email_sent is an email");
    if (c.outcome === "voicemail" && c.channel !== "call") return bad("contact.channel", "voicemail is a call");
    const note = cleanNote(c.note);
    if (note === "invalid") return bad("contact.note", `text of at most ${NOTE_MAX} characters`);
    let happenedAt: string | null = null;
    if (c.happenedAt !== undefined && c.happenedAt !== null) {
      const t = new Date(c.happenedAt);
      if (typeof c.happenedAt !== "string" || Number.isNaN(t.getTime()) || !/([+-]\d{2}:\d{2}|Z)$/.test(c.happenedAt)) {
        return bad("contact.happenedAt", "an ISO instant with an offset");
      }
      happenedAt = t.toISOString();
    }
    out.contact = { outcome: c.outcome, channel: c.channel, note, happenedAt };
  }
  if (cmd.stage !== undefined) {
    if (cmd.stage?.to as string === "closed-won") return refused("closed_won_not_permitted");
    if (!isOneOf(STAGE_TARGETS, cmd.stage?.to)) return bad("stage.to", "lead, contacted, proposal or closed-lost");
    if (cmd.expectedStage === undefined) return bad("expectedStage", "required with a stage change");
    const lr = cmd.stage.lostReason ?? null;
    if (cmd.stage.to === "closed-lost" && !isOneOf(LOST_REASONS, lr)) return refused("lost_reason_required");
    if (cmd.stage.to !== "closed-lost" && lr !== null) return bad("stage.lostReason", "only with closed-lost");
    out.stage = { to: cmd.stage.to, lostReason: lr };
  }
  if (cmd.followUp !== undefined) {
    const f = cmd.followUp as Record<string, unknown>;
    if ("resolve" in f) {
      if (f.resolve !== "completed" && f.resolve !== "cancelled") return bad("followUp.resolve", "completed or cancelled");
      out.resolve = f.resolve;
    } else if ("schedule" in f && f.schedule && typeof f.schedule === "object") {
      const s = f.schedule as { action?: unknown; assignee?: unknown; dueOn?: unknown; dueAt?: DueAtInput | null; note?: unknown };
      if (!isOneOf(FOLLOWUP_ACTIONS, s.action)) return bad("followUp.schedule.action", "not a known action");
      const assignee = s.assignee === undefined || s.assignee === null ? null : String(s.assignee).toLowerCase();
      if (assignee !== null && !UUID.test(assignee)) return bad("followUp.schedule.assignee", "a user id");
      const due = resolveDue(String(s.dueOn ?? ""), s.dueAt ?? null);
      if (!due.ok) return refused(due.code, { why: due.detail });
      const note = cleanNote(s.note);
      if (note === "invalid") return bad("followUp.schedule.note", `text of at most ${NOTE_MAX} characters`);
      out.schedule = { action: s.action, assignee, dueOn: due.dueOn, dueAt: due.dueAt, note };
    } else {
      return bad("followUp", "schedule or resolve");
    }
  }
  if (!out.contact && !out.claim && !out.stage && !out.schedule && !out.resolve) return refused("nothing_to_do");
  return out;
}

/**
 * The combined sales Save. Runs inside the caller's transaction (bound to `principal` by
 * `asPrincipal`). `now` is injectable for the backdate/future rules only; the database stamps times.
 */
export async function executeSave(tx: SqlClient, principal: ResolvedPrincipal, cmd: SaveCommand, now: Date = new Date()): Promise<SalesResult> {
  const v = validateSave(cmd);
  if (isResult(v)) return v;
  const commandId = cmd.commandId.toLowerCase();
  const role = principal.role;
  const me = principal.userId as string;

  const locked = await lockTarget(tx, cmd.prospect.trim());
  if (!locked.ok) return locked.result;
  const target = locked.target;

  const assignee = v.schedule ? (v.schedule.assignee ?? me) : null;
  const normalized = {
    kind: "save", prospect: target.id, actor: me,
    expectedStage: v.stage ? (cmd.expectedStage ?? null) : undefined,
    contact: v.contact, claim: v.claim, stage: v.stage,
    schedule: v.schedule ? { ...v.schedule, assignee } : undefined, resolve: v.resolve,
  };
  const digest = commandDigest(normalized);
  const prior = await priorReceipt(tx, commandId, digest, target.id, me);
  if (prior) return prior;

  // ── 4 · authorize every part against the locked state, before any write ──
  if (v.contact?.happenedAt) {
    const at = new Date(v.contact.happenedAt).getTime();
    if (at > now.getTime() + FUTURE_SKEW_MS) return refused("contact_in_future");
    if (role === "sales" && at < now.getTime() - SALES_BACKDATE_DAYS * 86_400_000) {
      return refused("backdate_not_permitted", { maxDays: SALES_BACKDATE_DAYS });
    }
  }
  if (v.claim && target.assignedTo !== null && target.assignedTo !== me) return refused("already_assigned");

  const from = target.status;
  let finalStage = from;
  let cause: string | null = null;
  if (v.stage) {
    if ((cmd.expectedStage ?? null) !== from) return refused("stage_conflict", { current: from });
    if (from === "closed-won") return refused("closed_won_is_final");
    if (v.stage.to === from) return refused("stage_unchanged", { current: from });
    const reopening = from === "closed-lost";
    if (reopening && role !== "owner") return refused("reopen_not_permitted");
    cause = v.stage.to === "closed-lost" ? "closed_lost" : reopening ? "reopen" : v.contact ? "contact" : "manual";
    finalStage = v.stage.to;
  }

  const open = await openFollowUpOf(tx, target.id);
  const ownsOrOwner = (f: NonNullable<OpenFollowUp>) => role === "owner" || f.assignee === me;
  const closing = finalStage === "closed-lost" || finalStage === "closed-won";
  if (v.resolve) {
    if (!open) return refused("no_open_followup");
    if (!ownsOrOwner(open)) return refused("followup_owned_by_other");
  }
  if (v.schedule) {
    if (closing) return refused("followup_on_closed_prospect");
    if (role === "sales" && assignee !== me) return refused("followup_assignee_not_permitted");
    if (assignee !== me && !(await isEnabledMember(tx, assignee!))) return refused("assignee_not_member");
    if (open && !v.resolve && !ownsOrOwner(open)) return refused("followup_owned_by_other");
  }
  // closed-lost cancels the open follow-up — someone else's only if the actor is the owner (A4).
  const cancelOnClose = v.stage?.to === "closed-lost" && open && !v.resolve ? open : null;
  if (cancelOnClose && !ownsOrOwner(cancelOnClose)) return refused("followup_owned_by_other");

  // ── 5 · writes ──
  const outcome: CommandOutcome = { prospect: target.id, anchor: target.anchor };
  const events: Parameters<typeof appendEvent>[2][] = [];
  const ev = (type: Parameters<typeof appendEvent>[2]["type"], data: Record<string, unknown>) =>
    events.push({ type, subject: subject(target), actor: "operator", actor_user_id: principal.userId, data, correlation_id: commandId });

  let contactId: string | null = null;
  if (v.contact) {
    contactId = uuidv7();
    await tx.query("SELECT public.ascend_record_contact($1, $2, $3, $4, $5, $6, $7, $8)",
      [target.id, me, contactId, commandId, v.contact.outcome, v.contact.channel, v.contact.note, v.contact.happenedAt]);
    const { rows } = await tx.query<{ happened_at: unknown }>("SELECT happened_at FROM prospect_contacts WHERE contact_id = $1", [contactId]);
    outcome.contact = { contactId };
    ev("prospect.contacted", { contact_id: contactId, outcome: v.contact.outcome, channel: v.contact.channel,
      happened_at: new Date(String(rows[0].happened_at)).toISOString() });
  }
  if (v.claim) {
    const r = (await tx.query<{ r: string }>("SELECT public.ascend_assign_prospect($1, $2, 'claim', NULL, $2) AS r", [target.id, me])).rows[0].r;
    if (r !== "applied" && r !== "already_yours") throw new SalesCommandAbort(r);
    outcome.assignment = { result: r, from: target.assignedTo, to: me };
    if (r === "applied") ev("prospect.reassigned", { mode: "claim", from: null, to: me });
  }
  if (v.stage) {
    const transitionId = uuidv7();
    const r = (await tx.query<{ r: string }>(
      "SELECT public.ascend_transition_stage($1, $2, $3, $4, $5, $6, $7, $8, $9, false) AS r",
      [target.id, me, transitionId, commandId, from, v.stage.to, cause, v.stage.lostReason, contactId])).rows[0].r;
    if (r !== "applied") throw new SalesCommandAbort(r, { current: from });
    outcome.stage = { transitionId, from, to: v.stage.to, cause: cause! };
    ev("prospect.status_changed", { transition_id: transitionId, from, to: v.stage.to, cause,
      ...(v.stage.lostReason ? { lost_reason: v.stage.lostReason } : {}) });
  }
  const fu: NonNullable<CommandOutcome["followUp"]> = {};
  if (v.resolve && open) {
    const state = v.resolve;
    await resolveFollowUp(tx, principal, open.followupId, state, commandId, state === "completed" ? contactId : null, null);
    fu[state] = open.followupId;
    ev("prospect.followup_resolved", { followup_id: open.followupId, state, ...(state === "completed" && contactId ? { by_contact: contactId } : {}) });
  }
  if (cancelOnClose) {
    await resolveFollowUp(tx, principal, cancelOnClose.followupId, "cancelled", commandId, null, null);
    fu.cancelled = cancelOnClose.followupId;
    ev("prospect.followup_resolved", { followup_id: cancelOnClose.followupId, state: "cancelled" });
  }
  if (v.schedule) {
    const followupId = uuidv7();
    let supersedes: string | undefined;
    if (open && !v.resolve) {
      // A contact in the same Save IS the action: the old follow-up is completed by it. Otherwise it is
      // replaced without being done.
      if (contactId) {
        await resolveFollowUp(tx, principal, open.followupId, "completed", commandId, contactId, null);
        fu.completed = open.followupId;
        ev("prospect.followup_resolved", { followup_id: open.followupId, state: "completed", by_contact: contactId });
      } else {
        await resolveFollowUp(tx, principal, open.followupId, "superseded", commandId, null, followupId);
        fu.superseded = open.followupId;
        supersedes = open.followupId;
      }
    }
    await tx.query(
      `INSERT INTO prospect_followups (followup_id, organization_id, prospect, action, assignee_user_id, due_on, due_at, note,
                                       created_by, created_by_command, created_by_contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [followupId, principal.organizationId, target.id, v.schedule.action, assignee, v.schedule.dueOn, v.schedule.dueAt,
       v.schedule.note, me, commandId, contactId]);
    fu.created = followupId;
    ev("prospect.followup_scheduled", { followup_id: followupId, action: v.schedule.action, assignee, due_on: v.schedule.dueOn,
      ...(v.schedule.dueAt ? { due_at: v.schedule.dueAt } : {}), ...(supersedes ? { supersedes } : {}) });
  }
  if (Object.keys(fu).length) outcome.followUp = fu;

  // ── 6 · receipt, then events ──
  await writeReceipt(tx, principal, commandId, target, "save", digest, outcome);
  for (const e of events) await appendEvent(tx, principal.organizationId, e);
  return { status: "applied", commandId, outcome };
}

// ─── assignment ───────────────────────────────────────────────────────────────────────────────

export async function executeAssignment(tx: SqlClient, principal: ResolvedPrincipal, cmd: AssignmentCommand): Promise<SalesResult> {
  if (typeof cmd.commandId !== "string" || !UUID.test(cmd.commandId.toLowerCase())) return refused("invalid_command", { field: "commandId" });
  if (!["claim", "reassign", "unassign"].includes(cmd.mode)) return refused("invalid_command", { field: "mode" });
  const to = cmd.mode === "claim" ? principal.userId as string : cmd.mode === "unassign" ? null : (cmd.to ?? "").toLowerCase();
  if (cmd.mode === "reassign" && !UUID.test(to ?? "")) return refused("invalid_command", { field: "to" });
  if (cmd.openFollowUp !== undefined && !["leave", "transfer", "cancel"].includes(cmd.openFollowUp)) return refused("invalid_command", { field: "openFollowUp" });
  const commandId = cmd.commandId.toLowerCase();
  const me = principal.userId as string;

  const locked = await lockTarget(tx, String(cmd.prospect ?? "").trim());
  if (!locked.ok) return locked.result;
  const target = locked.target;
  const expected = cmd.mode === "claim" ? undefined : (cmd.expectedAssignee ?? null);
  const digest = commandDigest({ kind: cmd.mode, prospect: target.id, actor: me, to, expected, openFollowUp: cmd.openFollowUp });
  const prior = await priorReceipt(tx, commandId, digest, target.id, me);
  if (prior) return prior;

  let open: OpenFollowUp = null;
  if (cmd.mode === "claim") {
    if (target.assignedTo === me) return { status: "applied", commandId, outcome: { prospect: target.id, anchor: target.anchor, assignment: { result: "already_yours", from: me, to: me } } };
    if (target.assignedTo !== null) return refused("already_assigned");
  } else {
    if (principal.role !== "owner") return refused("assignment_not_permitted");
    if (expected !== target.assignedTo) return refused("assignment_conflict", { current: target.assignedTo });
    if (to === target.assignedTo) return refused("assignment_unchanged");
    if (cmd.mode === "reassign" && !(await isEnabledMember(tx, to!))) return refused("assignee_not_member");
    open = await openFollowUpOf(tx, target.id);
    if (open && cmd.openFollowUp === undefined) return refused("followup_choice_required", { followupId: open.followupId });
    if (open && cmd.mode === "unassign" && cmd.openFollowUp === "transfer") return refused("invalid_command", { field: "openFollowUp", why: "nobody to transfer to" });
  }

  const r = (await tx.query<{ r: string }>("SELECT public.ascend_assign_prospect($1, $2, $3, $4, $5) AS r",
    [target.id, me, cmd.mode, cmd.mode === "claim" ? null : (expected ?? null), to])).rows[0].r;
  if (r !== "applied") throw new SalesCommandAbort(r);
  const outcome: CommandOutcome = { prospect: target.id, anchor: target.anchor, assignment: { result: r, from: target.assignedTo, to } };
  const events: Parameters<typeof appendEvent>[2][] = [];
  const data: Record<string, unknown> = { mode: cmd.mode, from: target.assignedTo, to };

  if (open && cmd.openFollowUp === "transfer") {
    const { rows } = await tx.query("UPDATE prospect_followups SET assignee_user_id = $2 WHERE followup_id = $1 AND state = 'open' RETURNING followup_id", [open.followupId, to]);
    if (rows.length !== 1) throw new SalesCommandAbort("followup_not_transferable");
    outcome.followUp = { transferred: open.followupId };
    data.followup = { followup_id: open.followupId, choice: "transfer" };
  } else if (open && cmd.openFollowUp === "cancel") {
    await resolveFollowUp(tx, principal, open.followupId, "cancelled", commandId, null, null);
    outcome.followUp = { cancelled: open.followupId };
    data.followup = { followup_id: open.followupId, choice: "cancel" };
    events.push({ type: "prospect.followup_resolved", subject: subject(target), actor: "operator", actor_user_id: principal.userId,
      data: { followup_id: open.followupId, state: "cancelled" }, correlation_id: commandId });
  } else if (open) {
    data.followup = { followup_id: open.followupId, choice: "leave" };
  }
  events.unshift({ type: "prospect.reassigned", subject: subject(target), actor: "operator", actor_user_id: principal.userId, data, correlation_id: commandId });

  await writeReceipt(tx, principal, commandId, target, cmd.mode, digest, outcome);
  for (const e of events) await appendEvent(tx, principal.organizationId, e);
  return { status: "applied", commandId, outcome };
}

// ─── the owner's follow-up edit (2A.1b decision 1) ─────────────────────────────────────────────

/** What the owner SAW (compare-and-set) and what they change. Not an "edit anything" command. */
export type FollowUpEditCommand = {
  commandId: string;
  prospect: string;
  followupId: string;
  expected: { action: FollowUpAction; assignee: string; dueOn: string; dueAt: string | null };
  changes: { action?: FollowUpAction; assignee?: string; dueOn?: string; dueAt?: DueAtInput | null; note?: string | null };
};

export async function executeFollowUpEdit(tx: SqlClient, principal: ResolvedPrincipal, cmd: FollowUpEditCommand): Promise<SalesResult> {
  const bad = (field: string, why: string) => refused("invalid_command", { field, why });
  if (typeof cmd.commandId !== "string" || !UUID.test(cmd.commandId.toLowerCase())) return bad("commandId", "a UUID is required");
  if (typeof cmd.followupId !== "string" || !UUID.test(cmd.followupId.toLowerCase())) return bad("followupId", "a UUID is required");
  const c = cmd.changes ?? {};
  const keys = Object.keys(c).filter((k) => (c as Record<string, unknown>)[k] !== undefined);
  if (keys.some((k) => !["action", "assignee", "dueOn", "dueAt", "note"].includes(k))) return bad("changes", "only action, assignee, dueOn, dueAt, note");
  if (keys.length === 0) return refused("nothing_to_do");
  if (c.action !== undefined && !isOneOf(FOLLOWUP_ACTIONS, c.action)) return bad("changes.action", "not a known action");
  const newAssignee = c.assignee === undefined ? undefined : String(c.assignee).toLowerCase();
  if (newAssignee !== undefined && !UUID.test(newAssignee)) return bad("changes.assignee", "a user id");
  const note = "note" in c ? cleanNote(c.note) : undefined;
  if (note === "invalid") return bad("changes.note", `text of at most ${NOTE_MAX} characters`);
  const e = cmd.expected;
  if (!e || !isOneOf(FOLLOWUP_ACTIONS, e.action) || typeof e.assignee !== "string" || typeof e.dueOn !== "string"
    || (e.dueAt !== null && (typeof e.dueAt !== "string" || Number.isNaN(new Date(e.dueAt).getTime())))) {
    return bad("expected", "the follow-up as it was seen");
  }
  if (principal.role !== "owner") return refused("followup_edit_not_permitted");
  const commandId = cmd.commandId.toLowerCase();
  const followupId = cmd.followupId.toLowerCase();
  const me = principal.userId as string;

  const locked = await lockTarget(tx, String(cmd.prospect ?? "").trim());
  if (!locked.ok) return locked.result;
  const target = locked.target;

  // Scheduling is resolved as a PAIR: a new day with a stored time needs the time restated (or cleared).
  const { rows } = await tx.query<{ state: string; action: FollowUpAction; assignee_user_id: string; due_on: string; due_at: unknown }>(
    "SELECT state, action, assignee_user_id, due_on::text AS due_on, due_at FROM prospect_followups WHERE followup_id = $1 AND prospect = $2",
    [followupId, target.id]);
  const dueTouched = c.dueOn !== undefined || "dueAt" in c;
  const digest = commandDigest({ kind: "followup_edit", prospect: target.id, actor: me, followupId,
    expected: { ...e, assignee: e.assignee.toLowerCase(), dueAt: e.dueAt ? new Date(e.dueAt).toISOString() : null },
    changes: { action: c.action, assignee: newAssignee, dueOn: c.dueOn, dueAt: "dueAt" in c ? (c.dueAt ?? null) : undefined, note } });
  const prior = await priorReceipt(tx, commandId, digest, target.id, me);
  if (prior) return prior;

  if (rows.length === 0) return refused("followup_not_found");
  const f = rows[0];
  if (f.state !== "open") return refused("followup_not_open", { state: f.state });
  const currentDueAt = f.due_at === null || f.due_at === undefined ? null : new Date(String(f.due_at)).toISOString();
  const expectedDueAt = e.dueAt ? new Date(e.dueAt).toISOString() : null;
  if (f.action !== e.action || f.assignee_user_id !== e.assignee.toLowerCase() || f.due_on !== e.dueOn || currentDueAt !== expectedDueAt) {
    return refused("followup_conflict");
  }
  let dueOn = f.due_on, dueAt = currentDueAt;
  if (dueTouched) {
    if (c.dueOn !== undefined && c.dueOn !== f.due_on && currentDueAt !== null && !("dueAt" in c)) {
      return bad("changes.dueAt", "a new day for a timed follow-up needs its time restated, or cleared with null");
    }
    const due = resolveDue(c.dueOn ?? f.due_on, "dueAt" in c ? (c.dueAt ?? null) : currentDueAt);
    if (!due.ok) return refused(due.code, { why: due.detail });
    [dueOn, dueAt] = [due.dueOn, due.dueAt];
  }
  if (newAssignee !== undefined && newAssignee !== f.assignee_user_id && !(await isEnabledMember(tx, newAssignee))) return refused("assignee_not_member");

  const changed: string[] = [];
  const data: Record<string, unknown> = { followup_id: followupId };
  if (c.action !== undefined && c.action !== f.action) { changed.push("action"); data.action = c.action; }
  if (dueOn !== f.due_on) { changed.push("due_on"); data.due_on = dueOn; }
  if (dueAt !== currentDueAt) { changed.push("due_at"); data.due_at = dueAt; }
  if (newAssignee !== undefined && newAssignee !== f.assignee_user_id) { changed.push("assignee"); data.assignee = { from: f.assignee_user_id, to: newAssignee }; }
  if (note !== undefined) changed.push("note");
  if (changed.length === 0) return refused("nothing_to_do");

  const upd = await tx.query(
    `UPDATE prospect_followups
        SET action = $2, due_on = $3, due_at = $4, assignee_user_id = $5, note = CASE WHEN $6::boolean THEN $7 ELSE note END
      WHERE followup_id = $1 AND state = 'open' RETURNING followup_id`,
    [followupId, c.action ?? f.action, dueOn, dueAt, newAssignee ?? f.assignee_user_id, note !== undefined, note ?? null]);
  if (upd.rows.length !== 1) throw new SalesCommandAbort("followup_not_open");
  const outcome: CommandOutcome = { prospect: target.id, anchor: target.anchor, followUp: { updated: followupId, changed } };
  await writeReceipt(tx, principal, commandId, target, "followup_edit", digest, outcome);
  // A note-only edit changes neither ownership nor scheduling: no business event (the receipt records it).
  if (changed.some((k) => k !== "note")) {
    await appendEvent(tx, principal.organizationId, { type: "prospect.followup_updated", subject: subject(target), actor: "operator",
      actor_user_id: principal.userId, data: { ...data, changed: changed.filter((k) => k !== "note") }, correlation_id: commandId });
  }
  return { status: "applied", commandId, outcome };
}

// ─── running a command ────────────────────────────────────────────────────────────────────────

/** Refusals the guarded functions name (010); anything else they raise is `database_refused`. */
const DATABASE_REFUSALS = new Set(["held_prospect", "archived_prospect", "reopen_not_permitted", "assignment_not_permitted"]);

type TxRunner = <T>(fn: (tx: SqlClient) => Promise<T>) => Promise<T>;

/**
 * Run a command in its own transaction (`runInTx` is the caller's `asPrincipal` binding) and turn
 * the two ways a transaction can end badly into refusals:
 *
 *   · `SalesCommandAbort` — a disagreement after a write; the transaction rolled back whole.
 *   · a unique violation on the receipt — the same command id committed concurrently on ANOTHER
 *     prospect (a different lock); after the rollback, the committed receipt decides.
 */
export async function runSalesCommand(runInTx: TxRunner, fn: (tx: SqlClient) => Promise<SalesResult>,
  commandId: string): Promise<SalesResult> {
  try {
    return await runInTx(fn);
  } catch (e) {
    if (e instanceof SalesCommandAbort) return refused(e.code, e.detail);
    const code = (e as { code?: string }).code;
    const message = e instanceof Error ? e.message : String(e);
    if (code === "23505" && /prospect_command_receipts_pkey/.test(message)) {
      return refused("command_id_conflict", { commandId });
    }
    // A guarded function refused (010). Only its named refusals become codes; any other database
    // refusal is reported as one opaque kind — never its message, which may name ids.
    if (code === "42501" && /^ascend: /.test(message)) {
      const named = message.slice("ascend: ".length).split(" ")[0];
      return refused(DATABASE_REFUSALS.has(named) ? named : "database_refused");
    }
    throw e;
  }
}
