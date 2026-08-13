// engines/approvals-engine — PURE read-only Approvals Awareness (Phase 8).
//
// Answers "what am I blocked on / waiting on the client for, and what's overdue?" — a FACTUAL
// blocking-status read-model over approval records. It classifies + groups; it never ranks, never
// recommends, never acts (no score/priority — prioritizing "who to chase" is Decision; signing is the
// portal write authority). Pure: imports ONLY domain types + the existing status deriver — no fs, no
// core, no lib, no other engine, no Next. Deterministic: `now` is INJECTED (the deriver's overdue test
// is the only time use); stable ordering. Status logic is REUSED from @/domain.deriveApprovalStatus —
// never duplicated (DA-2).

import { deriveApprovalStatus, type ApprovalRequest, type ApprovalStatus, type ApprovalKind } from "@/domain";

export type ApprovalEntry = {
  id: string;
  clientSlug: string;
  kind: ApprovalKind;
  title: string;
  status: ApprovalStatus;
  due: string | null;
};

export type ApprovalsDigest = {
  overdue: ApprovalEntry[];
  pending: ApprovalEntry[];
  approved: ApprovalEntry[];
  counts: { overdue: number; pending: number; approved: number; total: number };
};

/** Stable order: earliest due first, undated last, then id — deterministic, no ranking/priority. */
function byDueThenId(a: ApprovalEntry, b: ApprovalEntry): number {
  if (a.due && b.due) return a.due.localeCompare(b.due) || a.id.localeCompare(b.id);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return a.id.localeCompare(b.id);
}

/**
 * Build the approvals digest — pure and deterministic given (records, now). Each approval's status
 * comes from @/domain.deriveApprovalStatus (missing `due_at` ⇒ pending, never overdue). Empty input ⇒
 * empty groups + zero counts (honest).
 */
export function buildApprovalsDigest(records: readonly ApprovalRequest[], now: Date): ApprovalsDigest {
  const overdue: ApprovalEntry[] = [];
  const pending: ApprovalEntry[] = [];
  const approved: ApprovalEntry[] = [];

  for (const r of records) {
    const status = deriveApprovalStatus(r, now);
    const entry: ApprovalEntry = {
      id: String(r.id),
      clientSlug: r.client_slug,
      kind: r.kind,
      title: r.title,
      status,
      due: r.due_at ?? null,
    };
    if (status === "overdue") overdue.push(entry);
    else if (status === "pending") pending.push(entry);
    else approved.push(entry);
  }

  overdue.sort(byDueThenId);
  pending.sort(byDueThenId);
  approved.sort(byDueThenId);

  return {
    overdue,
    pending,
    approved,
    counts: { overdue: overdue.length, pending: pending.length, approved: approved.length, total: records.length },
  };
}
