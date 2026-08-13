// mission-control/kpis.ts — CALLER-OWNED pure shaper (MC-1/MC-3): select + reshape owned values only.
//
// The KPI summary is a PURE reshaping of read-models the page already fetched from their owners.
// It performs NO fetch and NO business computation — no sums, averages, aggregation, filtering,
// weighting, scoring, or ranking. The only transforms are presentation formatting (currency,
// seconds→hours) of a SINGLE owned value; every number is rendered as its owner produced it.
//
// Owners (fetched exactly once at the page level, passed in here — never fetched by this module):
//   • computeKpis() → FinanceKpis        [Intelligence precursor: lib/forecast]
//   • secondsInWindow(7)                  [core/production]
//   • listCareClients().length            [core/finance] — approved cardinality of an owned list (D-3.4.1)

import type { FinanceKpis } from "@/lib/forecast";

export type KpiCardModel = {
  key: string;
  label: string;
  value: string;
  sub?: string;
};

export type KpiSummaryInput = {
  finance: FinanceKpis;
  hours7dSeconds: number;
  activeCarePlans: number;
};

/**
 * Reshape already-fetched owned read-models into KPI card view-models.
 * Pure and synchronous: selection + single-value presentation formatting only. No fetch, no compute.
 * Order is FIXED and authored (MC-2) — never derived from any attribute; no card is compared to another.
 */
export function buildKpiSummary(input: KpiSummaryInput): KpiCardModel[] {
  const { finance, hours7dSeconds, activeCarePlans } = input;
  return [
    {
      key: "collected-this-month",
      label: "Collected · this month",
      value: usd(finance.thisMonthReceived),
      sub: `target ${usd(finance.thisMonthTarget)}`,
    },
    {
      key: "outstanding",
      label: "Outstanding",
      value: usd(finance.outstandingTotal),
    },
    {
      key: "overdue",
      label: "Overdue invoices",
      value: String(finance.overdueCount),
      sub: usd(finance.overdueAmount),
    },
    {
      key: "pipeline-90d",
      label: "Pipeline · 90d",
      value: usd(finance.pipeline90d),
      sub: "weighted",
    },
    {
      key: "hours-7d",
      label: "Hours · this week",
      value: `${(hours7dSeconds / 3600).toFixed(1)}h`,
      sub: "last 7 days",
    },
    {
      key: "active-care-plans",
      label: "Active care plans",
      value: String(activeCarePlans),
      sub: "recurring",
    },
  ];
}

/** Presentation-only currency formatter for a single owned value (rounds for display; no aggregation). */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
