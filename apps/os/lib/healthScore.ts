// lib/healthScore.ts — MOVED to engines/health-engine (Phase 2.5). Re-export shim.
// New code: import from "@/engines/health-engine".

export { computeHealthScore } from "@/engines/health-engine";
export type { HealthScore, HealthTier } from "@/engines/health-engine";
