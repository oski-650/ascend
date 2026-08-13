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

export type HealthScore = {
  score: number; // 0–100
  tier: HealthTier;
  breakdown: {
    progress: number; // 0–100
    momentum: number; // 0–100
    schedule: number; // 0–100
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
  let schedule = 100;
  let daysToLaunch: number | null = null;
  if (state.launchTarget) {
    const target = new Date(state.launchTarget);
    if (!isNaN(target.getTime())) {
      daysToLaunch = daysBetween(new Date(), target);
      if (state.overallProgress >= 100) {
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

  const score = Math.round(
    progress * WEIGHTS.progress + momentum * WEIGHTS.momentum + schedule * WEIGHTS.schedule
  );

  let tier: HealthTier = "at_risk";
  if (score >= 70) tier = "healthy";
  else if (score >= 40) tier = "on_track";

  return { score, tier, breakdown: { progress, momentum, schedule }, daysToLaunch };
}
