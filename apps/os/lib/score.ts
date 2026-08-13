// lib/score.ts — MOVED to core/crm/scoring (Phase 2.1). Re-export shim.
// New code: import from "@/core/crm".

export { computeScore } from "@/core/crm";
export type { ScoreResult, ScoreItem } from "@/core/crm";
