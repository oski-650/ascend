// lib/documentTypes.ts — MOVED to domain (Phase 1 foundation).
// Shared types & constants for documents — pure, safe for client bundles.
// Re-export kept for existing imports. New code: "@/domain".

export { DOCUMENT_TYPES, DOCUMENT_STATUSES, TYPE_LABEL, STATUS_LABEL } from "@/domain";
export type { DocumentType, DocumentStatus, DocumentFrontmatter, DocumentRecord } from "@/domain";
