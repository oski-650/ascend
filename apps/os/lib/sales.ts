// lib/sales.ts — MOVED to core/crm (Phase 2.1). Re-export shim.
// New code: import from "@/core/crm".

export { listProspects, getProspect, displayName, statusLabel } from "@/core/crm";
export type { Prospect, PipelineStatus, ProspectFrontmatter, WebsiteQuality } from "@/core/crm";
