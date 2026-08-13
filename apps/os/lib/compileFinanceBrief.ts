import "server-only";
import { listInvoices, statusOf } from "./finance";
import { computeKpis, buildForecast } from "./forecast";
import { getConfig } from "./config";

function formatUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export async function compileFinanceBrief(): Promise<string> {
  const config = await getConfig();
  const [kpis, buckets, invoices] = await Promise.all([
    computeKpis(config.monthly_target_usd),
    buildForecast(config.monthly_target_usd, 3, 3),
    listInvoices(),
  ]);

  const now = new Date();
  const overdue = invoices.filter((i) => statusOf(i, now) === "overdue");
  const recentPaid = invoices
    .filter((i) => i.paid_at)
    .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
    .slice(0, 5);

  const monthLines = buckets
    .map((b) => {
      const tag = b.isCurrent ? " · CURRENT" : b.isFuture ? " · forecast" : "";
      return `- **${b.label}${tag}** — received ${formatUsd(b.recognized)} · outstanding ${formatUsd(b.outstanding)} · forecast ${formatUsd(b.forecast)} · target ${formatUsd(b.target)}`;
    })
    .join("\n");

  const recentLines =
    recentPaid.length === 0
      ? "_(no paid invoices yet)_"
      : recentPaid.map((i) => `- ${i.paid_at?.slice(0, 10)} · ${i.client} · ${i.label} · ${formatUsd(i.amount_usd)}`).join("\n");

  const overdueLines =
    overdue.length === 0
      ? "_(none — clean)_"
      : overdue.map((i) => `- **${i.client}** · ${i.label} · ${formatUsd(i.amount_usd)} · due ${i.due_at.slice(0, 10)}`).join("\n");

  const parts = [
    `# Finance Brief — ${now.toISOString().slice(0, 10)}`,
    "",
    `_Compiled by Ascend OS. Paste at the top of a new Claude conversation, then ask for: a monthly P&L summary, a stakeholder revenue update, a "where am I drifting from target" diagnosis, or follow-up scripts for overdue invoices._`,
    "",
    `## This month`,
    `- **Received:** ${formatUsd(kpis.thisMonthReceived)} of ${formatUsd(kpis.thisMonthTarget)} target (${kpis.thisMonthTarget > 0 ? Math.round((kpis.thisMonthReceived / kpis.thisMonthTarget) * 100) : 0}%)`,
    `- **Outstanding (sent + overdue):** ${formatUsd(kpis.outstandingTotal)}`,
    `- **Overdue:** ${kpis.overdueCount} invoice${kpis.overdueCount === 1 ? "" : "s"} totaling ${formatUsd(kpis.overdueAmount)}`,
    `- **Weighted pipeline (next 90d):** ${formatUsd(kpis.pipeline90d)}`,
    "",
    `## Monthly window`,
    monthLines,
    "",
    `## Overdue invoices`,
    overdueLines,
    "",
    `## Recent payments`,
    recentLines,
    "",
    `## What I want from you`,
    `Given the above, give me an honest assessment: am I on track for ${formatUsd(kpis.thisMonthTarget)} this month? What's most likely to push me past target (or pull me below it)? If there are overdue invoices, draft a friendly follow-up script for the largest one. Keep it tight — 3 short sections.`,
    "",
    `<!-- Compiled by Ascend OS · finance-brief · ${now.toISOString()} -->`,
    "",
  ];

  return parts.join("\n");
}
