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
  getProspectActionSummary, getProspectTimeline, listSalesQueue,
  type ActionSummary, type SalesQueueFilter, type SalesQueueRow, type TimelineEntry,
} from "@/core/db/sales-reads";
import { findProspectRef } from "@/core/db";
import type { Capability } from "@/core/auth/capabilities";
import { withProspectDb } from "./source";

export type { SalesResult };

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

export async function salesQueue(filter: SalesQueueFilter = {}): Promise<{ rows: SalesQueueRow[]; next: { name: string; id: string } | null }> {
  return withProspectDb((tx) => listSalesQueue(tx, filter), "prospects:read");
}

export async function prospectActionSummary(ref: string): Promise<ActionSummary | null> {
  return withProspectDb(async (tx) => {
    const id = await findProspectRef(tx, ref);
    return id === null ? null : getProspectActionSummary(tx, id);
  }, "prospects:read");
}

export async function prospectTimeline(ref: string, opts: { limit?: number; before?: string } = {}): Promise<TimelineEntry[]> {
  return withProspectDb(async (tx) => {
    const id = await findProspectRef(tx, ref);
    return id === null ? [] : getProspectTimeline(tx, id, opts);
  }, "prospects:read");
}
