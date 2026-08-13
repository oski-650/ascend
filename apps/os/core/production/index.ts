// core/production — the Delivery layer: Project / Phase / ChecklistItem / TimeEntry (Part IV §IV.5).
// Reads + Project init (idempotent) + checklist toggle + time tracking. All vault I/O via
// core/vault; every write emits its event atomically & exactly-once (routes must not emit).
//
// Project identity is the client (1:1, Decision 3). Owns production_state.md (took over the
// temporary promote-route write in Phase 2.3). Forbidden: health/opportunity/ranking (engines).

export * from "./state";
export * from "./time";
export * from "./project";
