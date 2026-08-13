// mission-control/activity.ts — CALLER-OWNED assembly (MC-1: assemble + render; compute nothing).
//
// The Activity Stream is a PURE PROJECTION over the event spine (Phase 3.2). It fetches the
// most-recent events across all domains via the unified reader and returns them newest-first
// for display. Single source of truth: core/events. It performs:
//   • no writes, no event emission, no lifecycle/notification state, no persistence
//   • no enrichment joins (no core/crm|production|finance) — renders from the envelope only
//   • no classification, no scoring, no ranking, no derived metrics
// Interpretation (success/risk/opportunity, recommendations) belongs to engines, never here.

import "server-only";
import { readEvents } from "@/core/events";
import type { EventEnvelope } from "@/domain";

/** How many recent events Mission Control surfaces by default. */
export const ACTIVITY_FEED_LIMIT = 40;

/**
 * The N most recent events across every domain, newest-first.
 *
 * `readEvents({ limit })` already merges the per-domain logs and returns the most-recent-N
 * in ascending order; we reverse the (freshly-allocated) result for newest-first display.
 * Nothing more — this is orchestration, not logic.
 */
export async function getActivityFeed(limit: number = ACTIVITY_FEED_LIMIT): Promise<EventEnvelope[]> {
  const events = await readEvents({ limit });
  return events.reverse();
}
