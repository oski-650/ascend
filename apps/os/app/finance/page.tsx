// app/finance — THE QUANTITATIVE SURFACE.
//
// The financial instrument of the same operating system. The hierarchy answers, in order:
// how much came in · what is owed · what is overdue · what is projected · what happened.
//
// It introduces NO financial calculation. Every figure is read from its canonical owner —
// `computeKpis` and `buildForecast` (lib/forecast), `listInvoices` + `statusOf` (core/finance via
// lib/finance). The surface selects, orders for display, and renders.

import Link from "next/link";
import { listInvoices, statusOf, type Invoice } from "@/lib/finance";
import { buildForecast, computeKpis, sortInvoicesForDisplay } from "@/lib/forecast";
import { getConfig } from "@/lib/config";
import { listClients } from "@/core/crm";
import { compileFinanceBrief } from "@/lib/compileFinanceBrief";
import { formatUsd } from "@/lib/ehr";
import { routeForEntity } from "@/navigation/routing";
import { ForecastChart } from "@/components/ForecastChart";
import { InvoiceRow } from "@/components/InvoiceRow";
import { AddInvoiceForm } from "@/components/AddInvoiceForm";
import { CopyTextButton } from "@/components/CopyTextButton";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import {
  FactGrid,
  FactRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";

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

  // Selection only — bucketing by the status its owner derived.
  const grouped: Record<"overdue" | "open" | "paid", Invoice[]> = { overdue: [], open: [], paid: [] };
  for (const inv of sorted) {
    const s = statusOf(inv, now);
    if (s === "paid") grouped.paid.push(inv);
    else if (s === "overdue") grouped.overdue.push(inv);
    else grouped.open.push(inv);
  }

  const monthPct =
    kpis.thisMonthTarget > 0 ? Math.round((kpis.thisMonthReceived / kpis.thisMonthTarget) * 100) : 0;

  return (
    <PageShell hue={NODE_VISUAL.invoice.color}>
      <SurfaceHeader
        eyebrow="Finance"
        title="Cash flow"
        lede="What has landed, what is owed, and what the pipeline projects — against your monthly target."
        actions={<CopyTextButton payload={brief} label="Copy finance brief" variant="secondary" />}
      />

      {/* ── CASH ─────────────────────────────────────────────────────────────────────────────
          One dominant figure. Collected-this-month is the number the operator actually acts on;
          everything else is context for it. */}
      <section className="mb-14">
        <FactGrid
          lead={
            <FactRow
              lead
              value={formatUsd(kpis.thisMonthReceived)}
              label="Collected · this month"
              detail={`${monthPct}% of ${formatUsd(kpis.thisMonthTarget)} target`}
              tone={monthPct >= 100 ? "good" : undefined}
            />
          }
        >
          <FactRow
            value={formatUsd(kpis.outstandingTotal)}
            label="Outstanding"
            detail={
              kpis.overdueCount > 0
                ? `${kpis.overdueCount} overdue · ${formatUsd(kpis.overdueAmount)}`
                : "none overdue"
            }
            tone={kpis.overdueCount > 0 ? "risk" : undefined}
          />
          <FactRow
            value={formatUsd(kpis.pipeline90d)}
            label="Pipeline · 90d"
            detail="weighted by score + status"
            attribution="Forecast"
          />
          <FactRow
            value={formatUsd(kpis.thisMonthTarget)}
            label="Monthly target"
            detail="config.json"
          />
        </FactGrid>
      </section>

      {/* ── PROJECTION ───────────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionLabel tier="primary" aside={`${buckets.length} months`}>
          Cash flow
        </SectionLabel>
        <ForecastChart buckets={buckets} />
      </section>

      {/* ── ATTENTION — overdue only. Accent/coral is earned here, not decorative. ─────────── */}
      {grouped.overdue.length > 0 && (
        <section className="mb-14">
          <SectionLabel
            tier="decision"
            aside={`${formatUsd(grouped.overdue.reduce((s, i) => s + i.amount_usd, 0))}`}
          >
            Overdue
          </SectionLabel>
          <ul className="flex flex-col">
            {grouped.overdue.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                status="overdue"
                clientName={clientNameBySlug.get(inv.client) ?? inv.client}
                clientHref={routeForEntity("client", inv.client)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── ACTION ─────────────────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <AddInvoiceForm clients={clients.length > 0 ? clients : []} />
      </section>

      {/* ── LEDGER ─────────────────────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel
          tier="primary"
          aside={`${grouped.open.length} open · ${grouped.paid.length} settled`}
        >
          Invoices
        </SectionLabel>

        {sorted.length === 0 ? (
          <QuietEmpty>No invoices yet. Add one above to begin tracking cash.</QuietEmpty>
        ) : (
          <>
            {grouped.open.length > 0 ? (
              <ul className="flex flex-col">
                {grouped.open.map((inv) => (
                  <InvoiceRow
                    key={inv.id}
                    invoice={inv}
                    status={statusOf(inv, now)}
                    clientName={clientNameBySlug.get(inv.client) ?? inv.client}
                    clientHref={routeForEntity("client", inv.client)}
                  />
                ))}
              </ul>
            ) : (
              <QuietEmpty>Nothing outstanding — every issued invoice is settled.</QuietEmpty>
            )}

            {grouped.paid.length > 0 && (
              // Settled money recedes: present, reachable, but never competing with what is open.
              <details className="mt-8 group">
                <summary className="t-label cursor-pointer list-none text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
                  <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                    ▸
                  </span>{" "}
                  Settled · {grouped.paid.length}
                </summary>
                <ul className="mt-2 flex flex-col opacity-70">
                  {grouped.paid.map((inv) => (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      status="paid"
                      clientName={clientNameBySlug.get(inv.client) ?? inv.client}
                      clientHref={routeForEntity("client", inv.client)}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <p className="t-mono mt-8 text-[var(--color-t3)]">
          Invoices are stored in{" "}
          <Link href="/admin" className="hover:text-[var(--color-accent)]">
            .ascend-os/invoices.jsonl
          </Link>
        </p>
      </section>
    </PageShell>
  );
}