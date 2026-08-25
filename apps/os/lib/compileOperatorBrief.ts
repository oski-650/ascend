import "server-only";
import { listProductionStates } from "./production";
import { listProspects } from "./sales";
import { summarizeByClient, secondsInWindow, currentStreak } from "./timeLog";
import { getClientRevenue, computeEhr } from "./ehr";
import { computeHealthScore } from "./healthScore";
import { detectOpportunities, severityLabel } from "./opportunities";

function fmtHours(seconds: number): string {
  return (seconds / 3600).toFixed(1) + "h";
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * Compiles the full operating picture into a single Markdown payload —
 * paste at the top of a new Claude conversation to ask "what should I focus on?"
 */
export async function compileOperatorBrief(): Promise<string> {
  const [states, prospects, summaries, weekSeconds, streak, opportunities] = await Promise.all([
    listProductionStates(),
    listProspects(),
    summarizeByClient(),
    secondsInWindow(7),
    currentStreak(),
    detectOpportunities(),
  ]);

  const now = new Date();

  // Project lines
  const projectLines: string[] = [];
  for (const s of states) {
    // Skip only projects that are GENUINELY launched. This previously skipped on
    // `activePhaseIndex === null`, which now also matches projects whose phase history is unknown —
    // silently dropping them from the brief. Omission is an assertion: a project absent from this
    // context reads to the model as "nothing here to know", and this is the one channel with no
    // type checking between a fabricated value and a prompt (H4 §2.4).
    if (s.phaseState === "launched") continue;
    const totalSeconds = summaries[s.clientSlug]?.total_seconds ?? 0;
    const revenue = await getClientRevenue(s.clientSlug);
    const ehr = computeEhr(revenue, totalSeconds);
    const hoursLast7 = (await secondsInWindow(7, s.clientSlug)) / 3600;
    const health = computeHealthScore(s, hoursLast7);
    const active = s.activePhaseIndex !== null ? s.phases[s.activePhaseIndex].label : "unknown";
    const dtl = health.daysToLaunch;
    const dtlStr =
      dtl === null
        ? "no launch target"
        : dtl < 0
          ? `${Math.abs(dtl)}d overdue`
          : `${dtl}d to launch`;
    // Every uncertain field says "unknown" in words. Never a bare number the model would read as
    // measured, and never an omitted clause it would read as inapplicable.
    const progressStr = s.overallProgress !== null ? `${s.overallProgress}%` : "progress unknown";
    const healthStr =
      health.score !== null && health.tier !== null
        ? `health ${health.score} (${health.tier.replace("_", " ")})`
        : "health cannot be determined (phase history unknown)";
    projectLines.push(
      `- **${s.clientName}** — ${progressStr} · active: ${active} · ${dtlStr} · ${fmtHours(totalSeconds)} tracked · EHR ${ehr !== null ? fmtUsd(ehr) + "/hr" : "—"} · ${healthStr}`
    );
  }

  // Prospect lines (top 5)
  const topProspects = prospects
    .filter((p) => p.frontmatter.status !== "closed-lost")
    .slice(0, 5)
    .map(
      (p) =>
        `- **${p.frontmatter.name ?? p.slug}** — score ${p.score.score} (${p.score.tier}) · status ${p.frontmatter.status ?? "lead"} · ${p.frontmatter.business_type ?? "—"}${p.frontmatter.location ? `, ${p.frontmatter.location}` : ""}`
    );

  // Signals (opportunities) — group by severity
  const oppLines: string[] = [];
  const bySev = { urgent: [] as typeof opportunities, suggest: [] as typeof opportunities, info: [] as typeof opportunities };
  for (const o of opportunities) bySev[o.severity].push(o);
  for (const sev of ["urgent", "suggest", "info"] as const) {
    if (bySev[sev].length === 0) continue;
    oppLines.push(`\n### ${severityLabel(sev)} (${bySev[sev].length})`);
    for (const o of bySev[sev]) {
      oppLines.push(`- **${o.title}** — ${o.rationale}`);
    }
  }

  const parts = [
    `# Daily Operator Brief — ${now.toISOString().slice(0, 10)}`,
    "",
    `_Compiled by Ascend OS. Paste at the top of a new Claude conversation, then ask: "Given the above, what are the 3–5 highest-leverage things I should focus on today, in order?"_`,
    "",
    `## Activity context`,
    `- **Hours this week:** ${fmtHours(weekSeconds)}`,
    `- **Current streak:** ${streak} day${streak === 1 ? "" : "s"}`,
    "",
    `## Active projects (${projectLines.length})`,
    projectLines.length > 0 ? projectLines.join("\n") : "_(none in flight — all clients launched or unscoped)_",
    "",
    `## Top prospects (${topProspects.length})`,
    topProspects.length > 0 ? topProspects.join("\n") : "_(pipeline empty)_",
    "",
    `## Open signals (${opportunities.length})`,
    oppLines.length > 0 ? oppLines.join("\n").trim() : "_(no signals firing — system is quiet)_",
    "",
    `## What I want from you`,
    `Given the activity, projects, prospects, and signals above, recommend the 3–5 highest-leverage things I should focus on today, in priority order. For each: name the action, name the target, and explain in one sentence why it beats the alternatives. Be honest if I should rest instead.`,
    "",
    `<!-- Compiled by Ascend OS · operator-brief · ${now.toISOString()} -->`,
    "",
  ];

  return parts.join("\n");
}
