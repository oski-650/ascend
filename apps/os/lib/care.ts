// lib/care.ts — MOVED to core/finance/care (Phase 2.4). Re-export shim.
// Kept inferred (D6 explicit CarePlan entity deferred). New code: import from "@/core/finance".

export { listCareClients } from "@/core/finance";
export type { CareClient } from "@/core/finance";
