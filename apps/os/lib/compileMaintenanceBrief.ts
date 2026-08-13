import "server-only";
import { listAudits } from "./audits";
import { listCareClients } from "./care";

function fmt(n: number | null): string {
  return n === null ? "—" : String(n);
}

function ms(n: number | null): string {
  return n === null ? "—" : `${(n / 1000).toFixed(2)}s`;
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

export async function compileMaintenanceBrief(clientSlug?: string): Promise<string> {
  const [clients, audits] = await Promise.all([listCareClients(), listAudits()]);
  const active = clients.filter((c) => c.retainer_active);
  const targets = clientSlug ? active.filter((c) => c.slug === clientSlug) : active;

  const lines: string[] = [
    `# Maintenance Brief — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `_Compiled by Ascend OS. Paste at the top of a new Claude conversation, then ask: "Draft a friendly monthly maintenance report email to this client summarizing this month's audits and recommending the top 2-3 things to address."_`,
    "",
  ];

  if (targets.length === 0) {
    lines.push(`_No active retainer clients${clientSlug ? ` matching ${clientSlug}` : ""}._`);
    return lines.join("\n");
  }

  for (const c of targets) {
    const clientAudits = audits.filter((a) => a.client === c.slug);
    const latestMobile = clientAudits.find((a) => a.strategy === "mobile");
    const latestDesktop = clientAudits.find((a) => a.strategy === "desktop");

    lines.push(`## ${c.name}`);
    lines.push(`- **Site:** ${c.website || "—"}`);
    lines.push(
      `- **Retainer:** ${c.retainer_started ? `started ${c.retainer_started}` : "active"} · last payment ${
        c.last_care_invoice
          ? `${c.last_care_invoice.paid_at.slice(0, 10)} ($${c.last_care_invoice.amount_usd})`
          : "—"
      }`
    );
    lines.push("");

    for (const a of [latestMobile, latestDesktop]) {
      if (!a) continue;
      lines.push(`### Latest ${a.strategy} audit — ${a.run_at.slice(0, 10)} (${daysAgo(a.run_at)}d ago)`);
      lines.push(
        `- **Scores:** perf ${fmt(a.scores.performance)} · a11y ${fmt(a.scores.accessibility)} · best practices ${fmt(a.scores.best_practices)} · SEO ${fmt(a.scores.seo)}`
      );
      lines.push(
        `- **CWV:** LCP ${ms(a.cwv.lcp_ms)} · FCP ${ms(a.cwv.fcp_ms)} · CLS ${a.cwv.cls ?? "—"} · TTFB ${ms(a.cwv.ttfb_ms)}${a.cwv.inp_ms !== null ? ` · INP ${a.cwv.inp_ms}ms` : ""}`
      );
      if (a.opportunities.length > 0) {
        lines.push(`- **Top opportunities:**`);
        for (const o of a.opportunities.slice(0, 3)) {
          lines.push(`    - ${o.title}${o.savings_ms ? ` (≈ ${ms(o.savings_ms)} potential savings)` : ""}`);
        }
      }
      lines.push("");
    }
  }

  lines.push(`## What I want from you`);
  lines.push(
    `Draft a friendly, plain-language monthly maintenance report${
      targets.length === 1 ? ` for ${targets[0].name}` : " for each client above"
    }. Acknowledge what's healthy, flag what needs attention, and recommend the top 2–3 concrete actions worth taking this month. Keep it warm — these are care-plan clients who want to feel looked-after, not lectured.`
  );
  lines.push("");
  lines.push(`<!-- Compiled by Ascend OS · maintenance-brief · ${new Date().toISOString()} -->`);
  lines.push("");

  return lines.join("\n");
}
