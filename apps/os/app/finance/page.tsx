import { listInvoices, statusOf, type Invoice } from "@/lib/finance";
import { buildForecast, computeKpis, sortInvoicesForDisplay } from "@/lib/forecast";
import { getConfig } from "@/lib/config";
import { listClients } from "@/lib/vault";
import { compileFinanceBrief } from "@/lib/compileFinanceBrief";
import { formatUsd } from "@/lib/ehr";
import { KpiCard } from "@/components/KpiCard";
import { ForecastChart } from "@/components/ForecastChart";
import { InvoiceRow } from "@/components/InvoiceRow";
import { AddInvoiceForm } from "@/components/AddInvoiceForm";
import { CopyTextButton } from "@/components/CopyTextButton";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const config = await getConfig();
  const [clients, invoices, buckets, kpis, brief] = await Promise.all([
    listClients(),
    listInvoices(),
    buildForecast(config.monthly_target_usd, 6, 3),
    computeKpis(config.monthly_target_usd),
    compileFinanceBrief(),
  ]);

  const clientNameBySlug = new Map(clients.map((c) => [c.slug, c.name]));
  const now = new Date();
  const sorted = sortInvoicesForDisplay(invoices, now);
  const grouped: Record<"unpaid" | "paid", Invoice[]> = { unpaid: [], paid: [] };
  for (const inv of sorted) {
    const s = statusOf(inv, now);
    if (s === "paid") grouped.paid.push(inv);
    else grouped.unpaid.push(inv);
  }

  const monthPct =
    kpis.thisMonthTarget > 0 ? Math.round((kpis.thisMonthReceived / kpis.thisMonthTarget) * 100) : 0;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 06</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Finance · Cash Flow &amp; Forecast</h1>
        </div>
        <CopyTextButton payload={brief} label="Copy Finance Brief" variant="secondary" icon="💵" />
      </div>

      {/* KPI strip */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="This month · received"
          value={formatUsd(kpis.thisMonthReceived)}
          sub={`${monthPct}% of ${formatUsd(kpis.thisMonthTarget)} target`}
          accent={monthPct >= 100}
        />
        <KpiCard
          label="Target"
          value={formatUsd(kpis.thisMonthTarget)}
          sub="monthly · editable in .ascend-os/config.json"
        />
        <KpiCard
          label="Outstanding"
          value={formatUsd(kpis.outstandingTotal)}
          sub={
            kpis.overdueCount > 0
              ? `${kpis.overdueCount} overdue · ${formatUsd(kpis.overdueAmount)}`
              : "no overdue · clean"
          }
          accent={kpis.overdueCount === 0 && kpis.outstandingTotal > 0}
        />
        <KpiCard
          label="Pipeline · next 90d"
          value={formatUsd(kpis.pipeline90d)}
          sub="weighted by prospect score + status"
        />
      </section>

      {/* Chart */}
      <div className="mb-6">
        <ForecastChart buckets={buckets} />
      </div>

      {/* Add invoice form */}
      <AddInvoiceForm clients={clients.length > 0 ? clients : []} />

      {/* Invoices table */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          invoices ({sorted.length})
        </h2>

        {sorted.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
            <p className="font-semibold text-[var(--color-fg)]">No invoices yet.</p>
            <p className="mt-2">
              Open <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">+ Add invoice</code> above to log your first one.
            </p>
          </div>
        ) : (
          <>
            {grouped.unpaid.length > 0 && (
              <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] px-4 py-2 sm:px-5">
                <ul className="flex flex-col">
                  {grouped.unpaid.map((inv) => (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      status={statusOf(inv, now)}
                      clientName={clientNameBySlug.get(inv.client) ?? inv.client}
                    />
                  ))}
                </ul>
              </div>
            )}

            {grouped.paid.length > 0 && (
              <details className="mt-4 group">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
                  ▸ Paid ({grouped.paid.length})
                </summary>
                <div className="mt-3 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] px-4 py-2 opacity-80 sm:px-5">
                  <ul className="flex flex-col">
                    {grouped.paid.map((inv) => (
                      <InvoiceRow
                        key={inv.id}
                        invoice={inv}
                        status="paid"
                        clientName={clientNameBySlug.get(inv.client) ?? inv.client}
                      />
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
