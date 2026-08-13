// engines/pipeline-engine — PURE read-only Sales Pipeline Funnel (Phase 11).
//
// GOVERNING INVARIANT: Pipeline = what the sales funnel looks like, NOT what to do about it.
// It groups prospects by stage and reports STRUCTURE ONLY (counts, share, score summary). It:
//   • CONSUMES the pre-derived Prospect score/tier — it NEVER re-scores (computeScore stays authority);
//   • computes NO weighted-$ projection (no STATUS_PROBABILITY / pipeline90d — that is Forecast);
//   • emits NO signals and wires into NO Opportunity/composer;
//   • performs NO ranking/priority/recommendation (fixed pipeline-stage ordering is presentation only).
// Pure: imports only the domain `ProspectStatus` type. No fs, no core/lib, no writes/events, no clock,
// no randomness → deterministic.

import type { ProspectStatus } from "@/domain";

/** Fixed funnel order (presentation ordering only — NOT prioritization). */
const PIPELINE_ORDER: readonly ProspectStatus[] = ["lead", "contacted", "proposal", "closed-won", "closed-lost"];
const OPEN_STATUSES = new Set<string>(["lead", "contacted", "proposal"]);
const HOT_TIERS = new Set<string>(["hot", "priority"]);

/** Minimal structural input — the orchestrator maps Prospect → this. `score`/`tier` are CONSUMED, not derived. */
export type PipelineProspectInput = { status: string | undefined; score: number; tier: string };

export type PipelineStage = {
  status: string;
  label: string;
  count: number;
  share: number;
  avgScore: number | null; // null when the stage is empty (never a fabricated 0)
  hotCount: number;
};
export type PipelineDigest = { stages: PipelineStage[]; openCount: number; totalCount: number };

/** Display-only humanization (presentation, not scoring/business logic): "closed-won" → "Closed-Won". */
function humanize(status: string): string {
  return status
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join("-");
}

/**
 * Build the pipeline funnel — pure and deterministic given `prospects`. All 5 known stages are always
 * shown (even at count 0, so a missing stage like "0 proposals" is visible); unknown/missing statuses are
 * preserved literally as appended buckets (PL-5). Score summary reuses the passed-in score. Clock-free.
 */
export function buildPipelineDigest(prospects: readonly PipelineProspectInput[]): PipelineDigest {
  const buckets = new Map<string, { count: number; scoreSum: number; hot: number }>();
  for (const p of prospects) {
    const status = p.status && p.status.trim() ? p.status : "unknown";
    let b = buckets.get(status);
    if (!b) {
      b = { count: 0, scoreSum: 0, hot: 0 };
      buckets.set(status, b);
    }
    b.count += 1;
    b.scoreSum += Number.isFinite(p.score) ? p.score : 0; // CONSUMED, not recomputed
    if (HOT_TIERS.has(p.tier)) b.hot += 1;
  }

  const total = prospects.length;
  const extra = [...buckets.keys()].filter((s) => !(PIPELINE_ORDER as readonly string[]).includes(s)).sort();
  const orderedStatuses: string[] = [...PIPELINE_ORDER, ...extra];

  const stages: PipelineStage[] = orderedStatuses.map((status) => {
    const b = buckets.get(status) ?? { count: 0, scoreSum: 0, hot: 0 };
    return {
      status,
      label: humanize(status),
      count: b.count,
      share: total > 0 ? Math.round((b.count / total) * 100) : 0,
      avgScore: b.count > 0 ? Math.round(b.scoreSum / b.count) : null,
      hotCount: b.hot,
    };
  });

  let openCount = 0;
  for (const [status, b] of buckets) if (OPEN_STATUSES.has(status)) openCount += b.count;

  return { stages, openCount, totalCount: total };
}
