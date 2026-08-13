// lib/ehr.ts — PARTIAL migration (Phase 2.4).
//   getClientRevenue → moved to core/finance (contracted-revenue FACT).
//   computeEhr + formatters STAY here: EHR is profitability INTERPRETATION (engine-bound,
//   Part V §V.10 / clarification 3) — NOT a financial fact, so it does not belong in core/finance.

import "server-only";

export { getClientRevenue } from "@/core/finance";
export { TIER_PRICES } from "@/domain";

/** EHR in dollars per hour, or null if either input is missing/zero. (Interpretation — engine-bound.) */
export function computeEhr(revenueUsd: number | null, totalSeconds: number): number | null {
  if (revenueUsd === null || revenueUsd <= 0) return null;
  if (totalSeconds <= 0) return null;
  const hours = totalSeconds / 3600;
  return revenueUsd / hours;
}

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours < 1) {
    const m = Math.round(totalSeconds / 60);
    return `${m}m`;
  }
  return `${hours.toFixed(1)}h`;
}
