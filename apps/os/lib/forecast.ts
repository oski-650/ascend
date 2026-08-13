import "server-only";
import { listInvoices, statusOf, type Invoice } from "./finance";
import { listProspects, type PipelineStatus } from "./sales";

/** Probability mass that a prospect at status X closes in [m+1, m+2, m+3, m+4]. */
const STATUS_PROBABILITY: Record<PipelineStatus, number[]> = {
  proposal:      [0.6,  0.3,  0.1,  0.0],
  contacted:     [0.2,  0.4,  0.3,  0.1],
  lead:          [0.05, 0.2,  0.35, 0.4],
  "closed-won":  [1.0,  0.0,  0.0,  0.0],
  "closed-lost": [0.0,  0.0,  0.0,  0.0],
};

/** Assumed deal value when no explicit revenue exists (matches Growth tier). */
const ASSUMED_DEAL_VALUE = 2497;

export type MonthKey = string; // "YYYY-MM"

export type MonthBucket = {
  key: MonthKey;          // "2026-06"
  label: string;          // "Jun 2026"
  isPast: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  recognized: number;     // sum of paid invoices in this month
  outstanding: number;    // sum of unpaid invoices DUE this month
  forecast: number;       // weighted pipeline expected this month
  target: number;         // monthly_target_usd
};

function monthKey(d: Date): MonthKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: MonthKey): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function shiftMonths(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(1);
  result.setMonth(d.getMonth() + n);
  return result;
}

/**
 * Build a window of monthly buckets centered on the current month.
 * `past` months back + 1 current + `future` months forward.
 */
export async function buildForecast(
  monthlyTarget: number,
  past = 6,
  future = 3
): Promise<MonthBucket[]> {
  const now = new Date();
  now.setDate(1); // anchor to month start for consistent comparisons
  const startMonth = shiftMonths(now, -past);
  const totalMonths = past + 1 + future;

  const buckets: MonthBucket[] = [];
  for (let i = 0; i < totalMonths; i++) {
    const monthStart = shiftMonths(startMonth, i);
    const key = monthKey(monthStart);
    buckets.push({
      key,
      label: monthLabel(key),
      isPast: i < past,
      isCurrent: i === past,
      isFuture: i > past,
      recognized: 0,
      outstanding: 0,
      forecast: 0,
      target: monthlyTarget,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  // Recognized + outstanding from invoices.
  const invoices = await listInvoices();
  for (const inv of invoices) {
    if (inv.paid_at) {
      const k = monthKey(new Date(inv.paid_at));
      const b = byKey.get(k);
      if (b) b.recognized += inv.amount_usd;
    } else {
      const k = monthKey(new Date(inv.due_at));
      const b = byKey.get(k);
      if (b) b.outstanding += inv.amount_usd;
    }
  }

  // Pipeline forecast — only applies to the next 4 months from "now".
  const prospects = await listProspects();
  for (const p of prospects) {
    const status = (p.frontmatter.status ?? "lead") as PipelineStatus;
    const probs = STATUS_PROBABILITY[status];
    const scoreWeight = p.score.score / 100;
    const value = ASSUMED_DEAL_VALUE * scoreWeight;
    for (let m = 0; m < probs.length; m++) {
      const month = shiftMonths(now, m + 1);
      const b = byKey.get(monthKey(month));
      if (b) b.forecast += value * probs[m];
    }
  }

  return buckets;
}

// ─── Aggregate KPIs ─────────────────────────────────────────────────────────

export type FinanceKpis = {
  thisMonthReceived: number;
  thisMonthTarget: number;
  outstandingTotal: number;
  pipeline90d: number;
  /** count of overdue invoices */
  overdueCount: number;
  overdueAmount: number;
};

export async function computeKpis(monthlyTarget: number): Promise<FinanceKpis> {
  const invoices = await listInvoices();
  const now = new Date();
  const thisMonth = monthKey(now);

  let thisMonthReceived = 0;
  let outstandingTotal = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const inv of invoices) {
    if (inv.paid_at && monthKey(new Date(inv.paid_at)) === thisMonth) {
      thisMonthReceived += inv.amount_usd;
    }
    const s = statusOf(inv, now);
    if (s === "sent" || s === "overdue") {
      outstandingTotal += inv.amount_usd;
    }
    if (s === "overdue") {
      overdueCount += 1;
      overdueAmount += inv.amount_usd;
    }
  }

  // Pipeline next 90d ≈ next 3 months of weighted forecast.
  const prospects = await listProspects();
  let pipeline90d = 0;
  for (const p of prospects) {
    const status = (p.frontmatter.status ?? "lead") as PipelineStatus;
    const probs = STATUS_PROBABILITY[status];
    const scoreWeight = p.score.score / 100;
    const value = ASSUMED_DEAL_VALUE * scoreWeight;
    for (let m = 0; m < 3; m++) pipeline90d += value * probs[m];
  }

  return {
    thisMonthReceived,
    thisMonthTarget: monthlyTarget,
    outstandingTotal,
    pipeline90d,
    overdueCount,
    overdueAmount,
  };
}

// ─── Past invoices helper ───────────────────────────────────────────────────

export function sortInvoicesForDisplay(invoices: Invoice[], now: Date = new Date()): Invoice[] {
  const STATUS_RANK: Record<string, number> = { overdue: 0, sent: 1, draft: 2, paid: 3 };
  return [...invoices].sort((a, b) => {
    const sa = STATUS_RANK[statusOf(a, now)];
    const sb = STATUS_RANK[statusOf(b, now)];
    if (sa !== sb) return sa - sb;
    // Within status: unpaid by due_at asc, paid by paid_at desc
    const aPaid = a.paid_at;
    const bPaid = b.paid_at;
    if (aPaid && bPaid) return bPaid.localeCompare(aPaid);
    if (!aPaid && !bPaid) return a.due_at.localeCompare(b.due_at);
    return aPaid ? 1 : -1;
  });
}
