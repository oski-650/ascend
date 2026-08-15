// mission-control — the orchestration surface layer (MC-1).
// Assembles read-models/signals via caller-owned adapters and invokes Decision.rank().
// It computes no business metrics, detects nothing, scores nothing, ranks nothing itself.

export { assemblePriorityFeed } from "./assemble";
export { healthToSignals, opportunityToSignals } from "./adapters";
export { getActivityFeed, ACTIVITY_FEED_LIMIT } from "./activity";
export { assembleHealthOverview, type HealthTile } from "./health";
export { buildKpiSummary, type KpiCardModel, type KpiSummaryInput } from "./kpis";
export { buildGreeting, type GreetingLine, type GreetingInput, type GreetingStatus } from "./jarvis";
export { assembleFiringSignals } from "./signals";
export { assembleNotifications } from "./notifications";
// Site quality was already orchestrated here but never exported, so the Maintenance surface
// hand-coded the Lighthouse bands the engine already owns. Exporting it — behavior unchanged —
// is what lets that duplicate classification be deleted.
export { assembleSiteQuality } from "./site-quality";
export type { SiteQuality, SiteQualityDigest, QualityBand, Classification } from "@/engines/site-quality-engine";
