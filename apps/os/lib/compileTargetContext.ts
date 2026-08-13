import type { Prospect } from "./sales";
import { displayName, statusLabel } from "./sales";

function fmtScalar(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  return s.length === 0 ? "—" : s;
}

function bullet(label: string, value: unknown): string {
  return `- **${label}:** ${fmtScalar(value)}`;
}

export function compileTargetContext(p: Prospect): string {
  const fm = p.frontmatter;
  const name = displayName(p);
  const status = statusLabel(fm.status);
  const breakdown = p.score.breakdown;

  const scoreLines = breakdown.length
    ? breakdown.map((b) => `- **+${b.points}** — ${b.label}`).join("\n")
    : "- _(no scoring criteria matched yet — research needed)_";

  const callLog = p.body.length > 0 ? p.body : "_(no call log yet)_";

  const parts = [
    `# Target Strategy Brief: ${name}`,
    "",
    `_Compiled by Ascend OS for outbound positioning. Paste at the top of a new Claude conversation, then ask for a tailored cold pitch, voicemail script, or first-touch email._`,
    "",
    `## Snapshot`,
    bullet("Business type", fm.business_type),
    bullet("Location", fm.location),
    bullet("Pipeline status", status),
    bullet("Website", fm.website),
    bullet("Website quality", fm.website_quality),
    "",
    `## Priority Score: **${p.score.score} / ${p.score.max}** (${p.score.tier.toUpperCase()})`,
    "",
    `### Why this score`,
    scoreLines,
    "",
    `## Contact`,
    bullet("Decision-maker access", fm.decision_maker_access),
    bullet("Contact name", fm.contact_name),
    bullet("Phone", fm.contact_phone),
    bullet("Email", fm.contact_email),
    bullet("Source", fm.source),
    bullet("First contact", fm.first_contact),
    bullet("Last contact", fm.last_contact),
    "",
    `## Intent Signals`,
    bullet("Project urgency", fm.project_urgency),
    bullet("Niche alignment", fm.niche_alignment),
    "",
    `## Call Log & Notes`,
    "",
    callLog,
    "",
    `## What I want from you`,
    `Write outreach that leads with the strongest score driver above, speaks to a ${fm.business_type ?? "small business"} owner${fm.location ? ` in ${fm.location}` : ""}, and avoids generic agency-speak. Match the warmth-level appropriate to a ${status} status.`,
    "",
    `<!-- Compiled by Ascend OS · prospect: ${p.slug} · ${new Date().toISOString()} -->`,
    "",
  ];

  return parts.join("\n");
}
