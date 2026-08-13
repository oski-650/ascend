// lib/vault.ts — MOVED to core/crm (Phase 2.1). Re-export shim.
// New code: import from "@/core/crm".

export { listClients, getClient } from "@/core/crm";
export type { Client, ProfileSection, Frontmatter } from "@/core/crm";
