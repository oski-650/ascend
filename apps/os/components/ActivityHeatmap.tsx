type Day = { date: string; seconds: number; entryCount: number };

/** Maps seconds → one of 5 intensity steps. */
function intensity(seconds: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0) return 0;
  const h = seconds / 3600;
  if (h < 0.5) return 1;
  if (h < 1.5) return 2;
  if (h < 3) return 3;
  return 4;
}

const CELL_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-[var(--color-surface-hi)]",
  1: "bg-[var(--color-accent)]/15",
  2: "bg-[var(--color-accent)]/35",
  3: "bg-[var(--color-accent)]/60",
  4: "bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)]",
};

export function ActivityHeatmap({
  days,
  streak,
  totalSeconds,
}: {
  days: Day[];
  streak: number;
  totalSeconds: number;
}) {
  const hours = totalSeconds / 3600;
  const activeDays = days.filter((d) => d.entryCount > 0).length;

  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          30-day activity
        </h2>
        <p className="font-mono text-[11px] text-[var(--color-fg-dim)]">
          {hours.toFixed(1)}h across {activeDays}/{days.length} days · streak{" "}
          <span className="font-semibold text-[var(--color-accent)]">{streak}d</span>
        </p>
      </header>

      <div className="flex flex-wrap gap-1">
        {days.map((d) => {
          const lvl = intensity(d.seconds);
          const hLabel = (d.seconds / 3600).toFixed(1);
          return (
            <div
              key={d.date}
              title={`${d.date} · ${hLabel}h · ${d.entryCount} entries`}
              className={`size-4 rounded-sm sm:size-5 ${CELL_BG[lvl]}`}
            />
          );
        })}
      </div>

      <footer className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        <span>less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`size-3 rounded-sm ${CELL_BG[l as 0]}`} />
        ))}
        <span>more</span>
      </footer>
    </section>
  );
}
