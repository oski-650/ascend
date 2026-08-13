// domain/enums.ts — canonical lifecycle enums + controlled vocabularies (Part IV §IV.3, D2/D4/D11).
// One owner per lifecycle; derived lifecycles ship as pure functions here, never stored strings.
// PURE: no fs, no vault, no Next.js, no core/engine imports. Client-bundle safe.

// ─── Party lifecycles ─────────────────────────────────────────────────────────

/** Owner: structural_meta.status (reconciled from Project by core). */
export type ClientStatus = "active" | "maintenance" | "archived";

/** Owner: prospect frontmatter `status`. */
export type ProspectStatus = "lead" | "contacted" | "proposal" | "closed-won" | "closed-lost";

export type WebsiteQuality = "none" | "outdated" | "acceptable" | "modern";
export type ProjectUrgency = "low" | "medium" | "high";

// ─── Delivery lifecycles ──────────────────────────────────────────────────────

/** Derived from phase states — never stored. */
export type ProjectStatus = "planning" | "in_progress" | "launched" | "on_hold" | "archived";

export type PhaseStatus = "not_started" | "in_progress" | "complete" | "skipped";

export const PHASE_KEYS = ["onboarding", "strategy", "design", "dev", "launch"] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export const PHASE_LABEL: Record<PhaseKey, string> = {
  onboarding: "Onboarding",
  strategy: "Strategy",
  design: "Design",
  dev: "Dev",
  launch: "Launch",
};

/**
 * D4: time is tracked against a CONTROLLED vocabulary — the 5 build phases plus
 * operational buckets — so aggregation (EHR, health) can't be silently mis-bucketed.
 */
export const TIME_ACTIVITIES = [...PHASE_KEYS, "care", "sales", "admin", "internal"] as const;
export type TimeActivity = (typeof TIME_ACTIVITIES)[number];

export function isTimeActivity(v: unknown): v is TimeActivity {
  return typeof v === "string" && (TIME_ACTIVITIES as readonly string[]).includes(v);
}

export type TaskStatus = "open" | "doing" | "done" | "dropped";

// ─── Revenue lifecycles ───────────────────────────────────────────────────────

/** Derived from issued_at/due_at/paid_at — never stored (D2). */
export type InvoiceStatus = "paid" | "overdue" | "sent" | "draft";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  sent: "Sent",
  draft: "Draft",
};

/** Pure deriver — the single source for invoice lifecycle (was lib/finance.statusOf). */
export function deriveInvoiceStatus(
  inv: { issued_at: string; due_at: string; paid_at: string | null },
  now: Date = new Date()
): InvoiceStatus {
  if (inv.paid_at) return "paid";
  if (new Date(inv.due_at).getTime() < now.getTime()) return "overdue";
  if (new Date(inv.issued_at).getTime() > now.getTime()) return "draft";
  return "sent";
}

export type CarePlanStatus = "active" | "paused" | "canceled";

// ─── Artifact lifecycles ──────────────────────────────────────────────────────

export type DocumentType = "proposal" | "contract" | "sow" | "change_order";
export type DocumentStatus = "draft" | "sent" | "accepted" | "superseded";

export const DOCUMENT_TYPES: DocumentType[] = ["proposal", "contract", "sow", "change_order"];
export const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "sent", "accepted", "superseded"];

export const TYPE_LABEL: Record<DocumentType, string> = {
  proposal: "Proposal",
  contract: "Contract",
  sow: "SOW",
  change_order: "Change Order",
};

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  superseded: "Superseded",
};

// ─── Collaboration lifecycles ─────────────────────────────────────────────────

export type ApprovalKind = "design" | "strategy" | "launch" | "scope_change" | "other";
export const APPROVAL_KINDS: ApprovalKind[] = ["design", "strategy", "launch", "scope_change", "other"];
export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  design: "Design",
  strategy: "Strategy",
  launch: "Launch",
  scope_change: "Scope Change",
  other: "Other",
};

/** Derived from approved_at/due_at — never stored (was lib/portalTypes.approvalStatus). */
export type ApprovalStatus = "approved" | "overdue" | "pending";

export function deriveApprovalStatus(
  req: { approved_at: string | null; due_at?: string },
  now: Date = new Date()
): ApprovalStatus {
  if (req.approved_at) return "approved";
  if (req.due_at && new Date(req.due_at).getTime() < now.getTime()) return "overdue";
  return "pending";
}

/** Canonical 5-state notification lifecycle (Part V §V.5). Built Phase 3. */
export type NotificationStatus = "created" | "viewed" | "snoozed" | "resolved" | "dismissed";

// ─── Automation / AI lifecycles (provisional ⚑ — built Phase 6) ──────────────

export type AgentJobStatus = "queued" | "running" | "waiting" | "completed" | "failed";
export type WorkflowRunStatus = "pending" | "running" | "completed" | "failed" | "canceled";

// ─── Intelligence classification ──────────────────────────────────────────────

/** Signal severity — a classification, not a lifecycle. */
export type Severity = "info" | "suggest" | "urgent";

// ─── Controlled vocabularies (D11) ────────────────────────────────────────────

export const TIERS = ["starter", "growth", "ascend-pro"] as const;
export type Tier = (typeof TIERS)[number];

/** Canonical package prices (from the Ascend marketing site). */
export const TIER_PRICES: Record<Tier, number> = {
  starter: 1257,
  growth: 2497,
  "ascend-pro": 3127,
};

/**
 * Normalize legacy/variant tier spellings ("Ascend Pro", "ascendpro", "ascend-pro" → "ascend-pro").
 * Read-side tolerance per D11: vault files with variant spellings still resolve.
 */
export function normalizeTier(raw: unknown): Tier | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (key) {
    case "starter":
      return "starter";
    case "growth":
      return "growth";
    case "ascendpro":
      return "ascend-pro";
    default:
      return null;
  }
}

export const INDUSTRY_TEMPLATES = ["generic", "events", "contractor", "hvac", "plumbing", "cleaning"] as const;
export type IndustryTemplate = (typeof INDUSTRY_TEMPLATES)[number];

export type AuditStrategy = "mobile" | "desktop";
export type AuditSource = "psi" | "seed" | "manual";
