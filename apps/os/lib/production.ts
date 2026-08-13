// lib/production.ts — MOVED to core/production (Phase 2.3). Re-export shim.
// Phase vocabulary + ChecklistItem live in @/domain; reads live in @/core/production.

export { PHASE_KEYS, PHASE_LABEL } from "@/domain";
export type { PhaseKey, PhaseStatus, ChecklistItem } from "@/domain";
export { listProductionStates, getProductionState } from "@/core/production";
export type { Phase, ProductionState } from "@/core/production";
