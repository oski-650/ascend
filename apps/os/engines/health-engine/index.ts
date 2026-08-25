// engines/health-engine — pure client/project health scoring (Part V §V.1).
//
// PURITY (Phase 2.5): a pure transform — ProductionState + hours → HealthScore.
//   • NO filesystem access, NO vault writes, NO event emission.
//   • NO recommendations/actions, NO priorities, NO cross-client ranking.
//   • Reads nothing itself — the caller fetches from core/production and passes data in.
// Imports ONLY the ProductionState output TYPE from core/production (erased at runtime).
//
// Behavior preserved verbatim from the former lib/healthScore.ts. Deferred (not built here):
//   richer multi-subscore health (finance/revenue/SEO/audits), migration to domain.HealthScore,
//   and health.snapshotted history events (a Phase-5 core reconciler — never this engine).

import type { ProductionState } from "@/core/production";

export type HealthTier = "at_risk" | "on_track" | "healthy";

/**
 * NULLABILITY (docs/HISTORICAL-BACKFILL-H2.md §11) — `null` means "insufficient evidence to
 * calculate", never zero and never "fine". Unknown propagates along the dependency graph and stops
 * at independence: `momentum` and `daysToLaunch` read the time log and the launch target, neither
 * of which depends on phase history, so they survive total phase ignorance.
 *
 * A null score is NOT rankable. Consumers must route it to unranked attention rather than letting
 * it fall through a weighting ternary — see mission-control/signals.ts.
 */
export type HealthScore = {
  score: number | null; // 0–100, or null when any term is unknown
  tier: HealthTier | null; // null when score is null
  breakdown: {
    progress: number | null; // 0–100, or null when phase history is unknown
    momentum: number; // 0–100 — independent evidence, never null
    schedule: number | null; // 0–100, or null when there is no schedule to judge against
  };
  daysToLaunch: number | null;
};

const WEIGHTS = { progress: 0.5, momentum: 0.3, schedule: 0.2 };

/** Hours-in-last-7-days that map to full momentum credit. */
const FULL_MOMENTUM_HOURS = 3;

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (86400 * 1000));
}

export function computeHealthScore(state: ProductionState, hoursLast7Days: number): HealthScore {
  // 1) Progress — straight from production overall.
  const progress = state.overallProgress;

  // 2) Momentum — recent activity. 0h = 0 score; 3h+ in past week = 100.
  const momentum = Math.min(100, Math.round((hoursLast7Days / FULL_MOMENTUM_HOURS) * 100));

  // 3) Schedule — relationship between completion and launch_target.
  //
  // NO SCHEDULE IS NOT ON SCHEDULE. This initialised to 100, so a project with no launch target
  // received full marks for being on schedule — two-thirds of Elite Vac's score of 30 was credit
  // for having no deadline (H2 §11.2). Absent target and unknown progress both yield null: there
  // is nothing to judge against, and judging anyway is the defect this repair exists to remove.
  let schedule: number | null = null;
  let daysToLaunch: number | null = null;
  if (state.launchTarget) {
    const target = new Date(state.launchTarget);
    if (!isNaN(target.getTime())) {
      // Pure date arithmetic — independent of phase history, so it survives an unknown project.
      daysToLaunch = daysBetween(new Date(), target);
      if (progress === null) {
        schedule = null; // cannot tell "past target, incomplete" from "past target, delivered"
      } else if (progress >= 100) {
        schedule = 100; // launched or all phases resolved
      } else if (daysToLaunch < 0) {
        schedule = 0; // past launch target, incomplete
      } else if (daysToLaunch < 14) {
        schedule = 50; // crunch window
      } else {
        schedule = 100; // plenty of runway
      }
    }
  }

  // A weighted sum with a missing term is missing — NOT the sum of the terms that happen to be
  // present. Renormalising the weights over available terms would silently redefine the metric.
  const score =
    progress === null || schedule === null
      ? null
      : Math.round(progress * WEIGHTS.progress + momentum * WEIGHTS.momentum + schedule * WEIGHTS.schedule);

  let tier: HealthTier | null = null;
  if (score !== null) {
    tier = "at_risk";
    if (score >= 70) tier = "healthy";
    else if (score >= 40) tier = "on_track";
  }

  return { score, tier, breakdown: { progress, momentum, schedule }, daysToLaunch };
}
