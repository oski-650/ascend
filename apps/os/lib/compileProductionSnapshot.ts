import type { ProductionState, Phase } from "./production";

function phaseGlyph(p: Phase): string {
  switch (p.status) {
    case "complete":
      return "✓";
    case "skipped":
      return "—";
    case "in_progress":
      return "◐";
    default:
      return "○";
  }
}

function phaseLine(p: Phase): string {
  const glyph = phaseGlyph(p);
  const pct = p.status === "in_progress" ? ` (${p.progress}%)` : "";
  const dates = [p.started ? `started ${p.started}` : null, p.completed ? `completed ${p.completed}` : null]
    .filter(Boolean)
    .join(", ");
  const datePart = dates ? ` — ${dates}` : "";
  return `- ${glyph} **${p.label}** · ${prettyStatus(p.status)}${pct}${datePart}`;
}

function prettyStatus(s: Phase["status"]): string {
  return s.replace("_", " ");
}

function checklistBlock(p: Phase): string {
  if (p.checklist.length === 0) return "";
  const lines = p.checklist.map((c) => `  - [${c.done ? "x" : " "}] ${c.text}`).join("\n");
  return `\n${lines}`;
}

export function compileProductionSnapshot(state: ProductionState): string {
  const active = state.activePhaseIndex !== null ? state.phases[state.activePhaseIndex] : null;
  const launch = state.launchTarget ?? "_(no launch target set)_";

  const phaseSummary = state.phases.map(phaseLine).join("\n");

  const checklistDetail = state.phases
    .filter((p) => p.checklist.length > 0)
    .map((p) => `### ${p.label} checklist${checklistBlock(p)}`)
    .join("\n\n");

  const parts = [
    `# Production Snapshot: ${state.clientName}`,
    "",
    `_Compiled by Ascend OS as a client status-update payload. Paste at the top of a new Claude conversation, then ask for a friendly status email, a teams/slack update, or a stakeholder-facing summary._`,
    "",
    `## Headline`,
    `- **Overall progress:** ${state.overallProgress}%`,
    `- **Active phase:** ${active ? active.label : "All phases complete or skipped"}`,
    `- **Launch target:** ${launch}`,
    state.industryTemplate ? `- **Industry template:** ${state.industryTemplate}` : "",
    "",
    `## Phase Status`,
    phaseSummary,
    "",
    checklistDetail ? `## Checklists\n\n${checklistDetail}` : "",
    "",
    `## What I want from you`,
    `Write a brief, warm status update for ${state.clientName} suitable for sending by email. Lead with what's done and what's actively moving${active ? ` (currently in ${active.label})` : ""}. Be specific about progress, avoid jargon, and end with what's next from us and from them.`,
    "",
    `<!-- Compiled by Ascend OS · production: ${state.clientSlug} · ${new Date().toISOString()} -->`,
    "",
  ]
    .filter((s) => s !== "")
    .join("\n");

  return parts;
}
