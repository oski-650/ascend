// core/crm/sales — the sales actions as the APPLICATION calls them (Slice 2A.1c).
//
// Each function demands its capability BEFORE a connection is leased, takes the principal
// `requireCapability` resolved from memberships (never anything the request says), and runs the domain
// command inside the request's own transaction through `withProspectDb` — the same admission path the
// note log and Promote use. The domain command and the guarded database functions then re-check
// everything they can; this layer adds nothing to the rules and removes nothing from them.

import "server-only";
import { requireCapability } from "@/core/auth/authority";
import {
  executeAssignment, executeFollowUpEdit, executeSave, runSalesCommand,
  type AssignmentCommand, type FollowUpEditCommand, type SaveCommand, type SalesResult,
} from "@/core/db/sales-actions";
import {
  getProspectActionSummary, getProspectTimeline, listMemberNames, listSalesQueue, listSalesSection,
  type ActionSummary, type Cursor, type MemberDirectory, type SalesQueueFilter, type SalesQueueRow, type SalesSection,
  type TimelinePage,
} from "@/core/db/sales-reads";
import { findProspectRef } from "@/core/db";
import type { Capability } from "@/core/auth/capabilities";
import { withProspectDb } from "./source";

export type { SalesResult };
// The vocabulary and read shapes, for the sales UI. Type-only: nothing server-side reaches a client
// bundle, and `components/` never imports `@/core/db` directly (F41).
export type {
  ContactChannel, ContactOutcome, FollowUpAction, LostReason, StageTarget,
} from "@/core/db/sales-actions";
export type { ActionSummary, DueState, MemberDirectory, TimelineEntry, TimelinePage } from "@/core/db/sales-reads";

/** The command, in the request's own transaction, bound to the principal `withProspectDb` resolves. */
async function run(capability: Capability, commandId: string,
  command: Parameters<typeof runSalesCommand>[1]): Promise<SalesResult> {
  return runSalesCommand((fn) => withProspectDb((tx) => fn(tx), capability), command, commandId);
}

/** The combined sales Save (contact · claim · stage · follow-up) — `prospects:write`. */
export async function saveSalesAction(ref: string, cmd: Omit<SaveCommand, "prospect">): Promise<SalesResult> {
  const principal = await requireCapability("prospects:write");
  return run("prospects:write", cmd.commandId, (tx) => executeSave(tx, principal, { ...cmd, prospect: ref }));
}

/** Claim for oneself — `prospects:write`. */
export async function claimProspect(ref: string, commandId: string): Promise<SalesResult> {
  const principal = await requireCapability("prospects:write");
  return run("prospects:write", commandId, (tx) => executeAssignment(tx, principal, { commandId, prospect: ref, mode: "claim" }));
}

/** Reassign or unassign — owner-level CRM management (`prospects:manage`). */
export async function changeAssignment(ref: string, cmd: Omit<AssignmentCommand, "prospect">): Promise<SalesResult> {
  const principal = await requireCapability("prospects:manage");
  return run("prospects:manage", cmd.commandId, (tx) => executeAssignment(tx, principal, { ...cmd, prospect: ref }));
}

/** Edit an open follow-up — owner-level CRM management (`prospects:manage`). */
export async function editFollowUp(ref: string, cmd: Omit<FollowUpEditCommand, "prospect">): Promise<SalesResult> {
  const principal = await requireCapability("prospects:manage");
  return run("prospects:manage", cmd.commandId, (tx) => executeFollowUpEdit(tx, principal, { ...cmd, prospect: ref }));
}

// ─── reads for 2A.2 (server-side, `prospects:read`) ───────────────────────────────────────────

export async function salesQueue(filter: SalesQueueFilter = {}): Promise<{ rows: SalesQueueRow[]; next: Cursor | null }> {
  return withProspectDb((tx) => listSalesQueue(tx, filter), "prospects:read");
}

/** One bounded section of the /sales work queue, with its total (2A.2a). */
export async function salesSection(
  section: SalesSection, scope: { assignee?: string; includeUnassigned?: boolean; limit?: number; recentDays?: number } = {},
): Promise<{ rows: SalesQueueRow[]; total: number; limit: number }> {
  return withProspectDb((tx) => listSalesSection(tx, section, scope), "prospects:read");
}

export async function prospectActionSummary(ref: string): Promise<ActionSummary | null> {
  return withProspectDb(async (tx) => {
    const id = await findProspectRef(tx, ref);
    return id === null ? null : getProspectActionSummary(tx, id);
  }, "prospects:read");
}

export async function prospectTimeline(ref: string, opts: { limit?: number; cursor?: string | null } = {}): Promise<TimelinePage> {
  return withProspectDb(async (tx) => {
    const id = await findProspectRef(tx, ref);
    if (id === null) return { entries: [], next: null };
    // Events are keyed by the identity ANCHOR, not the row id, so the summary supplies it.
    const summary = await getProspectActionSummary(tx, id);
    return getProspectTimeline(tx, { prospectRowId: id, anchor: summary?.anchor ?? null }, opts);
  }, "prospects:read");
}

/**
 * Everything the prospect detail page needs from the sales tables, read ONCE (2A.2b): the action
 * summary, one page of the timeline, and the organization's member names. One lease, one
 * authorization — `prospects:read`, the capability the page already demands.
 *
 * Takes the ROW id the canonical reader attached (`Prospect.rowId`). A vault-sourced prospect has
 * none, and the caller does not ask; this module never consults the store setting itself (F43).
 */
export type ProspectSalesView = { summary: ActionSummary; timeline: TimelinePage; directory: MemberDirectory };

export async function prospectSalesView(rowId: string, opts: { cursor?: string | null } = {}): Promise<ProspectSalesView | null> {
  return withProspectDb(async (tx) => {
    const summary = await getProspectActionSummary(tx, rowId);
    if (summary === null) return null;
    const timeline = await getProspectTimeline(tx, { prospectRowId: rowId, anchor: summary.anchor || null }, { cursor: opts.cursor });
    const directory = await listMemberNames(tx);
    return { summary, timeline, directory };
  }, "prospects:read");
}
