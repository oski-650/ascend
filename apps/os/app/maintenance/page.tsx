import { listAudits, historyFor } from "@/lib/audits";
import { listCareClients } from "@/lib/care";
import { compileMaintenanceBrief } from "@/lib/compileMaintenanceBrief";
import { KpiCard } from "@/components/KpiCard";
import { AuditClientCard } from "@/components/AuditClientCard";
import { CopyTextButton } from "@/components/CopyTextButton";

export const dynamic = "force-dynamic";

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

export default async function MaintenancePage() {
  const [clients, allAudits, brief] = await Promise.all([
    listCareClients(),
    listAudits(),
    compileMaintenanceBrief(),
  ]);

  // KPI math
  const activeRetainers = clients.filter((c) => c.retainer_active).length;

  const latestPerfPerClient: number[] = [];
  for (const c of clients) {
    const clientAudits = allAudits.filter((a) => a.client === c.slug);
    const latest = clientAudits[0]; // listAudits sorts newest first
    if (latest && typeof latest.scores.performance === "number") {
      latestPerfPerClient.push(latest.scores.performance);
    }
  }
  const avgLatestPerf =
    latestPerfPerClient.length > 0
      ? Math.round(latestPerfPerClient.reduce((s, n) => s + n, 0) / latestPerfPerClient.length)
      : null;

  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const auditsThisMonth = allAudits.filter((a) => a.run_at.slice(0, 7) === thisMonthKey).length;

  const staleClients = clients.filter((c) => {
    if (!c.retainer_active) return false;
    const clientAudits = allAudits.filter((a) => a.client === c.slug);
    if (clientAudits.length === 0) return true;
    return daysSince(clientAudits[0].run_at) > 30;
  }).length;

  // Build histories upfront (avoid awaits in component tree)
  const histories = await Promise.all(
    clients.map(async (c) => ({
      slug: c.slug,
      mobile: await historyFor(c.slug, "mobile", 8),
      desktop: await historyFor(c.slug, "desktop", 8),
    }))
  );
  const historiesBySlug = new Map(histories.map((h) => [h.slug, h]));

  const recentAudits = allAudits.slice(0, 10);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 09</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Maintenance · Retainer Audits</h1>
        </div>
        <CopyTextButton payload={brief} label="Copy Maintenance Brief" variant="secondary" icon="🛠️" />
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Active retainers"
          value={String(activeRetainers)}
          sub={`${clients.length - activeRetainers} not on retainer`}
        />
        <KpiCard
          label="Avg latest perf"
          value={avgLatestPerf !== null ? String(avgLatestPerf) : "—"}
          sub={
            avgLatestPerf === null
              ? "no audits yet"
              : avgLatestPerf >= 90
                ? "healthy · ≥90"
                : avgLatestPerf >= 50
                  ? "watch · 50–89"
                  : "below baseline"
          }
          accent={avgLatestPerf !== null && avgLatestPerf >= 90}
        />
        <KpiCard
          label="Audits · this month"
          value={String(auditsThisMonth)}
          sub={`${allAudits.length} all-time`}
        />
        <KpiCard
          label="Stale (>30d)"
          value={String(staleClients)}
          sub={
            staleClients === 0
              ? "all current"
              : `${staleClients} retainer client${staleClients === 1 ? "" : "s"} need a fresh run`
          }
          accent={staleClients === 0}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          clients ({clients.length})
        </h2>
        {clients.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
            No clients yet. Add a CRM client first.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {clients.map((c) => {
              const h = historiesBySlug.get(c.slug) ?? { mobile: [], desktop: [] };
              return (
                <AuditClientCard
                  key={c.slug}
                  client={c}
                  mobileHistory={h.mobile}
                  desktopHistory={h.desktop}
                />
              );
            })}
          </div>
        )}
      </section>

      {recentAudits.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            recent audits ({recentAudits.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-surface-hi)] text-left font-mono uppercase tracking-widest text-[10px] text-[var(--color-fg-dim)]">
                <tr>
                  <th className="px-3 py-2">when</th>
                  <th className="px-3 py-2">client</th>
                  <th className="px-3 py-2">strategy</th>
                  <th className="px-3 py-2 text-right">perf</th>
                  <th className="px-3 py-2 text-right">a11y</th>
                  <th className="px-3 py-2 text-right">SEO</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">LCP</th>
                  <th className="px-3 py-2 font-mono text-[10px]">src</th>
                </tr>
              </thead>
              <tbody>
                {recentAudits.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--color-border-hi)]">
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
                      {a.run_at.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-fg)]">{a.client}</td>
                    <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                      {a.strategy}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[var(--color-fg)]">
                      {a.scores.performance ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-fg-mute)]">
                      {a.scores.accessibility ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-fg-mute)]">
                      {a.scores.seo ?? "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-[var(--color-fg-mute)] sm:table-cell">
                      {a.cwv.lcp_ms !== null ? `${(a.cwv.lcp_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[9px] uppercase text-[var(--color-fg-dim)]">{a.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
