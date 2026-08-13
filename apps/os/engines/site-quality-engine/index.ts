// engines/site-quality-engine — PURE read-only Site Quality Awareness (Phase 9).
//
// Answers "how are the sites we've shipped actually performing, and which underperform?" — the MEASURED
// EXTERNAL quality dimension, distinct from Health (internal delivery). It classifies each client's
// latest audit's Lighthouse category scores against FIXED STANDARD thresholds; it reports facts only —
// never a recommendation ("sell them SEO" = Opportunity), never a priority (Decision), and it does NOT
// modify Health. Pure: imports ONLY domain types — no fs, no core, no lib, no other engine, no Next.
// FULLY CLOCK-FREE (SQ-5): no `now`, no staleness, no randomness → deterministic.

import type { AuditStrategy, LighthouseScores } from "@/domain";

// The four V1 category scores (SQ-4 — CWV deferred).
const CATEGORIES = ["performance", "accessibility", "best_practices", "seo"] as const;
type Category = (typeof CATEGORIES)[number];

export type QualityBand = "good" | "needs-improvement" | "poor";
export type Classification = QualityBand | "unclassified";

/** Minimal structural input — satisfied by both domain.Audit and lib/audits.Audit (no coupling). */
export type SiteAuditInput = {
  id: string;
  client: string;
  url: string;
  strategy: AuditStrategy;
  run_at: string;
  scores: LighthouseScores;
};

export type CategoryQuality = { category: Category; score: number | null; band: Classification };
export type SiteQuality = {
  clientSlug: string;
  url: string;
  strategy: AuditStrategy;
  runAt: string;
  categories: CategoryQuality[];
  worstBand: Classification;
};
export type SiteQualityDigest = {
  sites: SiteQuality[];
  counts: { poor: number; needsImprovement: number; good: number };
};

/** Fixed standard Lighthouse bands (SQ-3): ≥90 good · 50–89 needs-improvement · <50 poor. Null ⇒ unclassified. */
function classify(score: number | null): Classification {
  if (score === null || !Number.isFinite(score)) return "unclassified";
  if (score >= 90) return "good";
  if (score >= 50) return "needs-improvement";
  return "poor";
}

// Worst-first ordering / worst-band severity: poor (0) < needs-improvement (1) < good (2) < unclassified (3, last).
const BAND_RANK: Record<Classification, number> = { poor: 0, "needs-improvement": 1, good: 2, unclassified: 3 };
const RANK_TO_BAND: readonly QualityBand[] = ["poor", "needs-improvement", "good"];

/**
 * Build the site-quality digest — pure and deterministic. One row per client+strategy using the LATEST
 * audit (by `run_at`, tie-broken by `id`), each category classified against fixed thresholds. `worstBand`
 * is the lowest band across CLASSIFIED categories (unclassified if none). Clients with no audit are simply
 * absent (never a fabricated result). Sites ordered worst band first (MC-2 presentation ordering).
 */
export function buildSiteQualityDigest(audits: readonly SiteAuditInput[]): SiteQualityDigest {
  const latest = new Map<string, SiteAuditInput>();
  for (const a of audits) {
    const key = `${a.client}::${a.strategy}`; // preserve mobile/desktop distinction
    const cur = latest.get(key);
    if (!cur || a.run_at > cur.run_at || (a.run_at === cur.run_at && a.id > cur.id)) latest.set(key, a);
  }

  const sites: SiteQuality[] = [];
  for (const a of latest.values()) {
    const categories: CategoryQuality[] = CATEGORIES.map((c) => {
      const score = a.scores?.[c] ?? null; // resilient: missing metric OR missing scores ⇒ unclassified
      return { category: c, score, band: classify(score) };
    });
    const classifiedRanks = categories.filter((c) => c.band !== "unclassified").map((c) => BAND_RANK[c.band]);
    const worstBand: Classification = classifiedRanks.length === 0 ? "unclassified" : RANK_TO_BAND[Math.min(...classifiedRanks)];
    sites.push({ clientSlug: a.client, url: a.url, strategy: a.strategy, runAt: a.run_at, categories, worstBand });
  }

  sites.sort(
    (x, y) =>
      BAND_RANK[x.worstBand] - BAND_RANK[y.worstBand] ||
      x.clientSlug.localeCompare(y.clientSlug) ||
      x.strategy.localeCompare(y.strategy)
  );

  const counts = { poor: 0, needsImprovement: 0, good: 0 };
  for (const s of sites) {
    if (s.worstBand === "poor") counts.poor += 1;
    else if (s.worstBand === "needs-improvement") counts.needsImprovement += 1;
    else if (s.worstBand === "good") counts.good += 1;
  }

  return { sites, counts };
}
