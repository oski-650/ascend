// core/crm/scoring.ts — prospect lead scoring (moved verbatim from lib/score.ts, Phase 2.1).
// Single owner of prospect scoring. Pure function of frontmatter → ScoreResult.
// (Kept in core/crm until a second consumer justifies packages/scoring — second-consumer rule.)

import type { ProspectFrontmatter } from "@/domain";

export type ScoreItem = { label: string; points: number; key: string };

export type ScoreResult = {
  score: number;
  max: number;
  breakdown: ScoreItem[];
  tier: "cold" | "warm" | "hot" | "priority";
};

const MAX = 100;

export function computeScore(fm: ProspectFrontmatter): ScoreResult {
  const breakdown: ScoreItem[] = [];

  const noOrOutdatedWebsite =
    !fm.website || fm.website_quality === "none" || fm.website_quality === "outdated";
  if (noOrOutdatedWebsite) {
    breakdown.push({ key: "no_website", label: "No website / outdated layout", points: 30 });
  }

  if (fm.decision_maker_access === true) {
    breakdown.push({ key: "decision_maker", label: "Direct decision-maker access verified", points: 25 });
  }

  if (fm.project_urgency === "high") {
    breakdown.push({ key: "urgency", label: "High project urgency / active intent", points: 25 });
  }

  if (fm.niche_alignment === true) {
    breakdown.push({ key: "niche", label: "Niche alignment (premium contractor / local pro / artisan)", points: 20 });
  }

  const score = Math.min(MAX, breakdown.reduce((sum, i) => sum + i.points, 0));

  let tier: ScoreResult["tier"] = "cold";
  if (score >= 80) tier = "priority";
  else if (score >= 55) tier = "hot";
  else if (score >= 30) tier = "warm";

  return { score, max: MAX, breakdown, tier };
}
