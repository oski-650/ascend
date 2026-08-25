// mission-control/health.ts — CALLER-OWNED assembly (MC-1: assemble · invoke · order · render; compute nothing).
//
// The Health Tiles overview INVOKES the frozen Health Engine — the sole owner of health
// computation — over the current production read-models, and returns per-project HealthScore
// read-models for display. It performs:
//   • no writes, no event emission, no persistence, no fs of its own
//   • no health computation or reinterpretation — computeHealthScore() owns that entirely
//   • ordering by a SINGLE read-model field only (HealthScore.score), per MC-2 — never a
//     comparison across read-model families (that is Decision.rank()'s exclusive job).
//
// Coverage (D-3.3.1): every project that has a ProductionState — launched/maintenance included,
// because health is a project/client property, not an "active project" property.

import "server-only";
import { listProductionStates, secondsInWindow } from "@/core/production";
import { computeHealthScore, type HealthScore } from "@/engines/health-engine";

/** One health tile: the subject's identity + the engine-produced HealthScore (rendered as-is). */
export type HealthTile = {
  clientSlug: string;
  clientName: string;
  health: HealthScore;
};

/**
 * Every project's health, least-healthy first.
 *
 * Invokes the pure Health Engine per project (the only place health is computed), then orders by
 * the engine-produced `HealthScore.score` ascending. Single-read-model presentation ordering
 * (MC-2) — no other signal participates. Nothing is stored; fully rebuildable from core.
 */
export async function assembleHealthOverview(): Promise<HealthTile[]> {
  const states = await listProductionStates();

  const tiles = await Promise.all(
    states.map(async (state) => {
      const hours = (await secondsInWindow(7, state.clientSlug)) / 3600;
      return {
        clientSlug: state.clientSlug,
        clientName: state.clientName,
        health: computeHealthScore(state, hours),
      };
    })
  );

  // MC-2: order within a single read-model family by the producer's own field. The array is
  // freshly allocated by Promise.all, so the in-place sort mutates nothing shared.
  // Uncomputable health sorts LAST rather than as 0. Coercing null to 0 would place the clients
  // Ascend knows least about at the top of a "worst first" list — presenting ignorance as alarm.
  return tiles.sort((a, b) => {
    if (a.health.score === null && b.health.score === null) return 0;
    if (a.health.score === null) return 1;
    if (b.health.score === null) return -1;
    return a.health.score - b.health.score;
  });
}
