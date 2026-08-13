// domain/entities.ts — canonical entity shapes (Part IV §IV.1).
// Field names mirror the on-disk formats (vault frontmatter + .ascend-os JSONL records),
// which are snake_case — so no mapping layer is needed between domain and storage.
// PURE: no fs, no vault, no Next.js, no core/engine imports. Client-bundle safe.

import type {
  ApprovalId,
  AssetId,
  AuditId,
  CarePlanId,
  ClientId,
  ClientSlug,
  DocumentId,
  InvoiceId,
  NotificationId,
  OrganizationId,
  PortalInviteId,
  PortalSubmissionId,
  ProspectSlug,
  TaskId,
  TimeEntryId,
} from "./ids";
import type {
  ApprovalKind,
  AuditSource,
  AuditStrategy,
  CarePlanStatus,
  ClientStatus,
  DocumentStatus,
  DocumentType,
  NotificationStatus,
  PhaseKey,
  PhaseStatus,
  ProjectUrgency,
  ProspectStatus,
  Severity,
  TaskStatus,
  TimeActivity,
  WebsiteQuality,
} from "./enums";

// ─── Party layer ──────────────────────────────────────────────────────────────

/** Contact — V1 value-object embedded in a Party (IV.7 #1). */
export type Contact = {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
};

/** structural_meta.json — the machine-managed identity anchor of a Client (D1). */
export type StructuralMeta = {
  client_id: ClientId;
  organization_id: OrganizationId;
  status: ClientStatus;
  tier?: string; // normalized via normalizeTier() on read (D11)
  created_at: string; // ISO
  source?: string;
  website?: string;
  promoted_from_prospect?: string;
};

/** Prospect frontmatter — the scoring-relevant fields (vault 02 - Sales & Hit List). */
export type ProspectFrontmatter = {
  name?: string;
  business_type?: string;
  location?: string;
  status?: ProspectStatus;
  website?: string;
  website_quality?: WebsiteQuality;
  decision_maker_access?: boolean;
  project_urgency?: ProjectUrgency;
  niche_alignment?: boolean;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  source?: string;
  first_contact?: string;
  last_contact?: string;
  [key: string]: unknown;
};

// ─── Delivery layer ───────────────────────────────────────────────────────────

export type ChecklistItem = { text: string; done: boolean };

/**
 * TimeEntry — .ascend-os/time_log.jsonl. `ended === null` ⇒ the single active session.
 * `phase` is a CONTROLLED TimeActivity (D4): build PhaseKeys + care/sales/admin/internal.
 */
export type TimeEntry = {
  id: TimeEntryId;
  client: string; // ClientSlug on disk — branded FK lands with core/crm (Phase 2)
  phase: TimeActivity;
  task: string;
  started: string; // ISO
  ended: string | null;
  duration_seconds: number | null;
  note: string;
};

/** Task ⚑ first-class variant (D8, two-source model) — store built in Phase 3. */
export type Task = {
  id: TaskId;
  title: string;
  status: TaskStatus;
  source: "manual" | "signal" | "agent";
  created_at: string;
  client?: string;
  phase?: PhaseKey;
  due?: string;
  priority?: number;
  origin_signal_key?: string;
};

// ─── Revenue layer ────────────────────────────────────────────────────────────

/** Invoice — .ascend-os/invoices.jsonl. Lifecycle DERIVED via deriveInvoiceStatus (D2). */
export type Invoice = {
  id: InvoiceId;
  client: string;
  amount_usd: number;
  label: string;
  issued_at: string; // ISO
  due_at: string; // ISO
  paid_at: string | null;
  note: string;
};

/** CarePlan ⚑ (D6) — explicit subscription entity; built Phase 2 (care_plan.md per client). */
export type CarePlan = {
  id: CarePlanId;
  client: string;
  status: CarePlanStatus;
  monthly_amount_usd: number;
  started_at: string;
  tier?: string;
  includes?: string[];
  canceled_at?: string;
};

// ─── Artifact layer ───────────────────────────────────────────────────────────

export type DocumentFrontmatter = {
  doc_id: string; // DocumentId — kept string-typed for legacy authored ids ("seed-doc-…")
  type: DocumentType;
  client: string;
  version: number;
  status: DocumentStatus;
  title: string;
  summary?: string;
  amount_usd?: number;
  created_at: string;
  sent_at?: string;
  accepted_at?: string;
  supersedes?: string;
};

export type DocumentRecord = {
  meta: DocumentFrontmatter;
  body: string;
  filePath: string;
};

export type UploadedFileRef = {
  saved_path: string; // absolute path in vault
  saved_name: string; // sanitized filename actually written
  original_name: string; // what the client uploaded
  size: number;
  mime: string;
};

// ─── Collaboration layer ──────────────────────────────────────────────────────

export type PortalInvite = {
  id: PortalInviteId | string;
  client_slug: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
  label?: string;
};

export type PortalSubmission = {
  id: PortalSubmissionId | string;
  client_slug: string;
  invite_id: string;
  submitted_at: string;
  fields: Record<string, string>;
  files: UploadedFileRef[];
};

export type ApprovalRequest = {
  id: ApprovalId | string;
  client_slug: string;
  kind: ApprovalKind;
  title: string;
  description: string;
  created_at: string;
  due_at?: string;
  approved_at: string | null;
  approved_by_name: string | null;
  /** What they typed when signing — preserved as their "signature". */
  signature_text: string | null;
};

/** Notification ⚑ (D5) — persisted operator relationship to a Signal; built Phase 3. */
export type Notification = {
  id: NotificationId;
  signal_key: string; // `${kind}:${target}` idempotency key
  severity: Severity;
  status: NotificationStatus;
  raised_at: string;
  viewed_at?: string;
  snoozed_until?: string;
  resolved_at?: string;
  dismissed_at?: string;
};

// ─── Intelligence layer ───────────────────────────────────────────────────────

export type LighthouseScores = {
  performance: number | null; // 0-100
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
};

export type CoreWebVitals = {
  lcp_ms: number | null;
  fcp_ms: number | null;
  cls: number | null;
  ttfb_ms: number | null;
  inp_ms: number | null;
};

export type AuditOpportunity = {
  id: string;
  title: string;
  savings_ms: number | null;
};

/** Audit — .ascend-os/audits.jsonl, append-only record of an external measurement. */
export type Audit = {
  id: AuditId | string;
  client: string;
  url: string;
  strategy: AuditStrategy;
  run_at: string; // ISO
  scores: LighthouseScores;
  cwv: CoreWebVitals;
  opportunities: AuditOpportunity[];
  source: AuditSource;
  note?: string;
};

// ─── Portal constants (kept with their entities; client-bundle safe) ──────────

/** 32 chars, URL-safe. Generated server-side via crypto. */
export type Token = string;

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // per file (25 MB)
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // per submission (100 MB)

// Referenced-but-later (⚑ Phase 4/6): Asset, AgentJob, WorkflowRun, Memory, KnowledgeObject
// get full shapes when their stores land — Phase 1 code must not depend on them (IV.7).
export type AssetRef = { id: AssetId | string; ref: UploadedFileRef };
export type { ClientSlug, ProspectSlug };
