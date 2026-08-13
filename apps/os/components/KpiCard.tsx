export function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3 sm:p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <p
        className={`mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl ${
          accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-[var(--color-fg-dim)]">{sub}</p>}
    </div>
  );
}
