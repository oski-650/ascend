// components/ForecastChart — monthly cash flow.
//
// THE DEFECT THAT MADE THIS RENDER EMPTY: each month column was a flex child under `items-end`
// with no height of its own, so it sized to its content. The bar wrapper's `height: 100%` then
// resolved against an auto-height parent and computed to zero — every bar collapsed. The month
// label also lived inside that column, so simply adding `h-full` would have overflowed the plot.
//
// The fix separates the plot from the axis: the plot row has a definite height, each column is
// `relative h-full`, and bars are absolutely positioned from the baseline — percentages now resolve
// against a real box. Month labels moved to their own row beneath, sharing the same column widths.
//
// The forecast ARITHMETIC is untouched: every value is read from the MonthBucket that lib/forecast
// produced. This component computes only percentage-of-max for drawing.

import type { MonthBucket } from "@/lib/forecast";
import { formatUsd } from "@/lib/ehr";

/**
 * Series colors follow the finance semantics: settled money is jade, money owed to you is amber
 * (attention), projection is quiet slate and hatched so it can never be mistaken for actual cash.
 */
const SERIES = {
  recognized: "var(--color-good)",
  outstanding: "var(--color-accent)",
  forecast: "var(--color-info)",
} as const;

export function ForecastChart({ buckets }: { buckets: MonthBucket[] }) {
  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.recognized + b.outstanding + b.forecast, b.target))
  );
  const targetPct = ((buckets[0]?.target ?? 0) / maxValue) * 100;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="t-mono text-[var(--color-t3)]">max {formatUsd(maxValue)}</p>
        <Legend />
      </div>

      {/* Plot — definite height, so the bars' percentage heights have a basis to resolve against. */}
      <div className="relative flex h-52 items-end gap-1.5 border-b border-[var(--color-line-strong)] sm:h-64 sm:gap-2">
        {/* Target line spans the whole plot; it is one value, not a per-column value. */}
        {targetPct > 0 && targetPct <= 100 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--color-t3)]/70"
            style={{ bottom: `${targetPct}%` }}
            aria-hidden
          />
        )}

        {buckets.map((b) => {
          const pct = (n: number) => (n / maxValue) * 100;
          const total = b.recognized + b.outstanding + b.forecast;
          return (
            <div
              key={b.key}
              className="relative h-full flex-1"
              title={`${b.label}: ${formatUsd(total)} — paid ${formatUsd(b.recognized)} · outstanding ${formatUsd(
                b.outstanding
              )} · forecast ${formatUsd(b.forecast)}`}
            >
              {/* Stack grows from the baseline.
                  `inset-0` (not just `bottom-0`) is load-bearing: an absolutely positioned box with
                  no top gets an AUTO height, and the segments' percentage heights would resolve
                  against it to zero — the same defect one level down. Spanning the full column
                  gives them a definite basis; `flex-col-reverse` packs them from the bottom. */}
              <div className="absolute inset-0 flex flex-col-reverse overflow-hidden rounded-t-[2px]">
                {b.recognized > 0 && (
                  <div style={{ height: `${pct(b.recognized)}%`, background: SERIES.recognized }} />
                )}
                {b.outstanding > 0 && (
                  <div style={{ height: `${pct(b.outstanding)}%`, background: SERIES.outstanding }} />
                )}
                {b.forecast > 0 && (
                  <div
                    className="[background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.25)_3px,rgba(0,0,0,0.25)_6px)]"
                    style={{
                      height: `${pct(b.forecast)}%`,
                      backgroundColor: `color-mix(in srgb, ${SERIES.forecast} 45%, transparent)`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Axis — same column widths as the plot, so labels stay aligned without living inside it. */}
      <div className="mt-2 flex gap-1.5 sm:gap-2">
        {buckets.map((b) => (
          <p
            key={b.key}
            className={`t-mono flex-1 text-center ${
              b.isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-t3)]"
            }`}
          >
            {b.label.split(" ")[0]}
            {b.isCurrent && <span className="ml-1">now</span>}
          </p>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <LegendKey color={SERIES.recognized} label="paid" />
      <LegendKey color={SERIES.outstanding} label="outstanding" />
      <LegendKey color={SERIES.forecast} label="forecast" />
      <span className="t-label flex items-center gap-1.5 text-[var(--color-t3)]">
        <span
          aria-hidden
          className="block h-0 w-3.5 border-t border-dashed border-[var(--color-t3)]"
        />
        target
      </span>
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="t-label flex items-center gap-1.5 text-[var(--color-t3)]">
      <span aria-hidden className="size-2 rounded-[1px]" style={{ background: color }} />
      {label}
    </span>
  );
}