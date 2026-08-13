// core/finance — the Revenue layer: financial FACTS only (Part IV §IV.5, clarification 3).
// Owns: Invoice reads+writes (+ invoice.* events), contracted-revenue resolution, inferred care.
// Every write is atomic + exactly-once (validate → persist → emit → return); routes don't emit.
//
// Forbidden (INTERPRETATION → engines): profitability/EHR, health scoring, opportunity detection,
// forecasting. Deferred: explicit CarePlan (D6), first-class Payment, Contract entity.

export * from "./invoice";
export * from "./revenue";
export * from "./care";
