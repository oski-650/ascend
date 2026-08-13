// core/crm — the Party layer: Client, Prospect, and prospect scoring (Part IV §IV.5).
// Reads (2.1) + Client creation & Prospect promotion writes (2.2). All vault I/O via
// core/vault primitives; every write emits its event atomically (routes must not emit).
//
// Forbidden (per contract): health scoring, opportunity detection, ranking — those are engines.
// Production scaffolding (production_state.md) is NOT owned here — Phase 2.3 / core/production.

export * from "./client";
export * from "./prospect";
export * from "./scoring";
export * from "./promote";
