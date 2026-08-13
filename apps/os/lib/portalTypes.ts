// lib/portalTypes.ts — MOVED to domain (Phase 1 foundation).
// Shared types & constants for portal — pure, safe for client bundles.
// Re-export kept for existing imports (approvalStatus = domain's deriveApprovalStatus).

export { APPROVAL_KINDS, APPROVAL_KIND_LABEL, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/domain";
export { deriveApprovalStatus as approvalStatus } from "@/domain";
export type {
  ApprovalKind,
  ApprovalRequest,
  PortalInvite,
  PortalSubmission,
  Token,
  UploadedFileRef,
} from "@/domain";
