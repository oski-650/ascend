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

  // ABSENCE IS NOT EVIDENCE OF ABSENCE (D-1).
  //
  // This read `!fm.website || ...`, so a prospect with no `website` field scored the full +30 for
  // "No website / outdated layout". But a blank website field is equally consistent with two
  // completely different facts:
  //
  //   confirmed absent   somebody looked and this business has no site   → a real opportunity
  //   unresearched       nobody has looked yet                           → we know nothing
  //
  // +30 is exactly the `warm` threshold, so every unresearched prospect was promoted to warm on
  // the strength of a field nobody had filled in. At six prospects that is a curiosity; at the
  // scale of a bulk import it makes the entire ranking meaningless and feeds a weighted-dollar
  // forecast (lib/forecast) and a `hot_lead_untouched` signal (lib/opportunities) built on nothing.
  //
  // `website_quality` is the field that carries an actual STATED claim — `none` means someone
  // asserted this business has no site. It is therefore the only admissible evidence for this
  // rule. Its absence awards zero, matching the three sibling rules below, which already fail
  // toward FEWER claims rather than more.
  //
  // This is the same repair the CSV importer already made one layer up
  // (app/api/import/prospects/route.ts:80, "the one scoring default that failed toward a STRONGER
  // claim"). That fix stopped an omitted column becoming `website_quality: none`; this one stops
  // an omitted VALUE being read as the same assertion inside the scorer itself.
  //
  // NO REPLACEMENT DEFAULT. There is deliberately no `?? "none"`, no `?? "acceptable"`, and no
  // new enum member here — an unstated website quality stays unstated and simply scores nothing.
  const websiteIsStatedWeakness =
    fm.website_quality === "none" || fm.website_quality === "outdated";
  if (websiteIsStatedWeakness) {
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
