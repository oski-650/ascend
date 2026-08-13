import type { MonthBucket } from "@/lib/forecast";
import { formatUsd } from "@/lib/ehr";

export function ForecastChart({ buckets }: { buckets: MonthBucket[] }) {
  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.recognized + b.outstanding + b.forecast, b.target))
  );

  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          Cash flow · monthly
        </h2>
        <Legend />
      </header>

      <div className="relative">
        {/* Target line label & dotted overlay */}
        <p className="mb-1 flex items-center justify-between font-mono text-[10px] text-[var(--color-fg-dim)]">
          <span>max {formatUsd(maxValue)}</span>
          <span className="hidden sm:inline">
            target {formatUsd(buckets[0]?.target ?? 0)}/mo
          </span>
        </p>

        <div className="relative flex h-48 items-end gap-1 border-b border-[var(--color-border-hi)] sm:h-56 sm:gap-2">
          {buckets.map((b) => {
            const pct = (n: number) => (n / maxValue) * 100;
            const recognizedPct = pct(b.recognized);
            const outstandingPct = pct(b.outstanding);
            const forecastPct = pct(b.forecast);
            const targetPct = pct(b.target);
            const total = b.recognized + b.outstanding + b.forecast;

            return (
              <div key={b.key} className="group flex flex-1 flex-col items-center justify-end">
                {/* Stacked bars */}
                <div
                  className="relative w-full overflow-hidden rounded-t bg-transparent"
                  title={`${b.label}: ${formatUsd(total)} (paid ${formatUsd(b.recognized)} · outstanding ${formatUsd(b.outstanding)} · forecast ${formatUsd(b.forecast)})`}
                  style={{ height: "calc(100% - 0px)" }}
                >
                  <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse">
                    {b.recognized > 0 && (
                      <div
                        className="w-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)]"
                        style={{ height: `${recognizedPct}%` }}
                      />
                    )}
                    {b.outstanding > 0 && (
                      <div className="w-full bg-amber-400/80" style={{ height: `${outstandingPct}%` }} />
                    )}
                    {b.forecast > 0 && (
                      <div
                        className="w-full bg-sky-400/40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.15)_3px,rgba(0,0,0,0.15)_6px)]"
                        style={{ height: `${forecastPct}%` }}
                      />
                    )}
                  </div>

                  {/* Target dashed line */}
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-[var(--color-fg-mute)]/70"
                    style={{ bottom: `${targetPct}%` }}
                    aria-hidden
                  />
                </div>

                {/* Month labels */}
                <p
                  className={`mt-1 font-mono text-[9px] uppercase tracking-wider ${
                    b.isCurrent
                      ? "text-[var(--color-accent)]"
                      : b.isFuture
                        ? "text-[var(--color-fg-dim)]"
                        : "text-[var(--color-fg-mute)]"
                  }`}
                >
                  {b.label.split(" ")[0]}
                  {b.isCurrent && <span className="ml-1 text-[8px]">(now)</span>}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
      <LegendDot color="bg-[var(--color-accent)]" label="paid" />
      <LegendDot color="bg-amber-400/80" label="outstanding" />
      <LegendDot color="bg-sky-400/40" label="forecast" />
      <span className="flex items-center gap-1.5">
        <span className="block h-0 w-3 border-t border-dashed border-[var(--color-fg-mute)]" />
        target
      </span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
