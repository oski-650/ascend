// domain/ids.ts — branded identifiers + id generation.
//
// PURITY CONTRACT (Part IV §IV.1): this file — like everything under domain/ —
// imports NO fs, NO vault paths, NO Next.js, NO core/engine/agent modules.
// It must stay safe to import from client bundles, server code, CLIs, and MCP alike.

declare const __brand: unique symbol;
/** Nominal (branded) type: a `Brand<string,"ClientId">` is assignable to string, but not vice-versa. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ─── Branded ids (Part IV §IV.2) ─────────────────────────────────────────────
// Human slugs — double as Obsidian note/folder names and [[wikilink]] targets.
export type ClientSlug = Brand<string, "ClientSlug">;
export type ProspectSlug = Brand<string, "ProspectSlug">;
export type SopSlug = Brand<string, "SopSlug">;
export type KnowledgeSlug = Brand<string, "KnowledgeSlug">;

// Machine ids — UUIDv7 (time-sortable) for record entities.
export type OrganizationId = Brand<string, "OrganizationId">;
/**
 * A human principal (Stage 2A).
 *
 * Distinct from `Actor`, which is the KIND of principal. Two people both act as `"operator"`; only
 * `UserId` says which one — and §19's adoption measurement is scoped by it, so that adding a second
 * human does not silently redefine a pre-registered metric (COGNITION-OBSERVATION §19).
 */
export type UserId = Brand<string, "UserId">;
export type ClientId = Brand<string, "ClientId">;
export type ProspectId = Brand<string, "ProspectId">;
export type ProjectId = Brand<string, "ProjectId">;
export type TaskId = Brand<string, "TaskId">;
export type TimeEntryId = Brand<string, "TimeEntryId">;
export type InvoiceId = Brand<string, "InvoiceId">;
export type PaymentId = Brand<string, "PaymentId">;
export type CarePlanId = Brand<string, "CarePlanId">;
export type ContractId = Brand<string, "ContractId">;
export type DocumentId = Brand<string, "DocumentId">;
export type AssetId = Brand<string, "AssetId">;
export type ApprovalId = Brand<string, "ApprovalId">;
export type PortalInviteId = Brand<string, "PortalInviteId">;
export type PortalSubmissionId = Brand<string, "PortalSubmissionId">;
export type AuditId = Brand<string, "AuditId">;
export type EventId = Brand<string, "EventId">;
export type NotificationId = Brand<string, "NotificationId">;
export type AgentJobId = Brand<string, "AgentJobId">;
export type WorkflowRunId = Brand<string, "WorkflowRunId">;
export type MemoryId = Brand<string, "MemoryId">;

/** V1 singleton tenant (D9): field preserved everywhere, machinery deferred. */
export const ORGANIZATION_ID = "ascend" as OrganizationId;

// ─── UUIDv7 (IV.7 default: time-sortable ids so JSONL sorts chronologically) ──

/**
 * RFC 9562 UUIDv7: 48-bit unix-ms timestamp + random. Uses the WebCrypto global
 * (available in Node 20+, edge, and browsers) so this module stays runtime-pure.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ts = Date.now();
  bytes[0] = Math.floor(ts / 2 ** 40) % 256;
  bytes[1] = Math.floor(ts / 2 ** 32) % 256;
  bytes[2] = Math.floor(ts / 2 ** 24) % 256;
  bytes[3] = Math.floor(ts / 2 ** 16) % 256;
  bytes[4] = Math.floor(ts / 2 ** 8) % 256;
  bytes[5] = ts % 256;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Factories — construct new record ids (existing v4 ids on disk remain valid opaque strings).
export const newEventId = (): EventId => uuidv7() as EventId;
export const newTimeEntryId = (): TimeEntryId => uuidv7() as TimeEntryId;
export const newInvoiceId = (): InvoiceId => uuidv7() as InvoiceId;
export const newDocumentId = (): DocumentId => uuidv7() as DocumentId;
export const newApprovalId = (): ApprovalId => uuidv7() as ApprovalId;
export const newPortalInviteId = (): PortalInviteId => uuidv7() as PortalInviteId;
export const newPortalSubmissionId = (): PortalSubmissionId => uuidv7() as PortalSubmissionId;
export const newAuditId = (): AuditId => uuidv7() as AuditId;
export const newTaskId = (): TaskId => uuidv7() as TaskId;
/**
 * A prospect's immutable identity anchor (D-4).
 *
 * Prospects had no stable id at all: identity was the FILENAME, which is `slugify(name)`. That
 * made a rename indistinguishable from a delete-plus-create, and made two spellings of one
 * business two businesses. `ProspectId` is the prospect's `client_id` equivalent — minted once,
 * never derived from the name, and unaffected by anything the operator renames.
 */
export const newProspectId = (): ProspectId => uuidv7() as ProspectId;

// Boundary casters — use at I/O edges (parsing disk/user input), never to launder unknowns mid-flow.
export const asClientSlug = (s: string): ClientSlug => s as ClientSlug;
export const asProspectSlug = (s: string): ProspectSlug => s as ProspectSlug;
export const asClientId = (s: string): ClientId => s as ClientId;
export const asProspectId = (s: string): ProspectId => s as ProspectId;
export const asUserId = (s: string): UserId => s as UserId;
export const asOrganizationId = (s: string): OrganizationId => s as OrganizationId;
