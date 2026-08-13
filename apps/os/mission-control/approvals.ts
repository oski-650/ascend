// mission-control/approvals — the Approvals-Awareness ORCHESTRATOR (Phase 8, MC-1/MC-3).
//
// Mission Control GATHERS approval records (via the existing lib/portal reader — DA-4, portal not
// migrated) and INVOKES the pure engine; it computes no status/digest itself. `now` is read HERE (the
// surface boundary) and INJECTED into the engine, keeping the engine deterministic. Read-only: no
// writes, no events.

import "server-only";
import { listApprovalRequests } from "@/lib/portal";
import { buildApprovalsDigest, type ApprovalsDigest } from "@/engines/approvals-engine";

export async function assembleApprovals(now: Date = new Date()): Promise<ApprovalsDigest> {
  const records = await listApprovalRequests();
  return buildApprovalsDigest(records, now);
}
