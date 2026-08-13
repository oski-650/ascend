import type { Phase, PhaseStatus } from "@/lib/production";

const STATUS_STYLE: Record<
  PhaseStatus,
  { dot: string; pill: string; glyph: string; pct: boolean }
> = {
  complete: {
    dot: "bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]",
    pill: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
    glyph: "✓",
    pct: false,
  },
  skipped: {
    dot: "bg-[var(--color-fg-dim)]",
    pill: "border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-hi)] text-[var(--color-fg-dim)] line-through opacity-70",
    glyph: "—",
    pct: false,
  },
  in_progress: {
    dot: "bg-amber-400 shadow-[0_0_10px_rgb(251_191_36/0.7)]",
    pill: "border-amber-400/60 bg-amber-400/10 text-amber-300",
    glyph: "◐",
    pct: true,
  },
  not_started: {
    dot: "bg-[var(--color-fg-dim)]/40",
    pill: "border-[var(--color-border-hi)] bg-[var(--color-surface)] text-[var(--color-fg-dim)]",
    glyph: "○",
    pct: false,
  },
};

export function PhaseLadder({ phases, size = "md" }: { phases: Phase[]; size?: "sm" | "md" | "lg" }) {
  const dim = {
    sm: { pill: "px-2 py-1 text-[10px]", gap: "gap-1", glyph: "text-[10px]" },
    md: { pill: "px-2.5 py-1.5 text-xs", gap: "gap-1.5", glyph: "text-xs" },
    lg: { pill: "px-3 py-2 text-sm", gap: "gap-2", glyph: "text-sm" },
  }[size];

  return (
    <div className={`flex flex-wrap items-center ${dim.gap}`}>
      {phases.map((p, i) => {
        const s = STATUS_STYLE[p.status];
        return (
          <div key={p.key} className="flex items-center gap-1.5">
            <div
              className={`inline-flex items-center gap-1.5 rounded-md border font-mono uppercase tracking-wider ${s.pill} ${dim.pill}`}
              title={`${p.label} · ${p.status.replace("_", " ")}${s.pct ? ` · ${p.progress}%` : ""}`}
            >
              <span className={dim.glyph}>{s.glyph}</span>
              <span>{p.label}</span>
              {s.pct && <span className="font-mono text-[10px] opacity-80">{p.progress}%</span>}
            </div>
            {i < phases.length - 1 && (
              <span className="text-[var(--color-fg-dim)]/50" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OverallProgressBar({ progress }: { progress: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-[var(--color-surface-hi)] sm:w-48">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold text-[var(--color-accent)]">{progress}%</span>
    </div>
  );
}
