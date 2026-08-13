import type { HealthScore, HealthTier } from "@/lib/healthScore";

const TIER_STYLE: Record<HealthTier, { ring: string; text: string; label: string; bar: string }> = {
  healthy: {
    ring: "border-[var(--color-accent)]",
    text: "text-[var(--color-accent)]",
    label: "HEALTHY",
    bar: "bg-[var(--color-accent)]",
  },
  on_track: {
    ring: "border-amber-400/70",
    text: "text-amber-300",
    label: "ON TRACK",
    bar: "bg-amber-400",
  },
  at_risk: {
    ring: "border-[var(--color-danger)]/70",
    text: "text-[var(--color-danger)]",
    label: "AT RISK",
    bar: "bg-[var(--color-danger)]",
  },
};

export function HealthBadge({ score, size = "md" }: { score: HealthScore; size?: "sm" | "md" | "lg" }) {
  const s = TIER_STYLE[score.tier];
  const dim = {
    sm: "size-10 text-sm",
    md: "size-14 text-lg",
    lg: "size-20 text-2xl",
  }[size];
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`flex ${dim} items-center justify-center rounded-full border-2 bg-[var(--color-surface)] font-mono font-bold ${s.ring} ${s.text}`}>
        {score.score}
      </div>
      <span className={`font-mono text-[9px] tracking-widest ${s.text}`}>{s.label}</span>
    </div>
  );
}

export function HealthBreakdown({ score }: { score: HealthScore }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Bar label="progress" value={score.breakdown.progress} />
      <Bar label="momentum" value={score.breakdown.momentum} />
      <Bar label="schedule" value={score.breakdown.schedule} />
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-surface-hi)]">
        <div
          className={`h-full ${value >= 70 ? "bg-[var(--color-accent)]" : value >= 40 ? "bg-amber-400" : "bg-[var(--color-danger)]"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className={`mt-0.5 font-mono text-[10px] font-semibold ${value >= 70 ? "text-[var(--color-accent)]" : value >= 40 ? "text-amber-300" : "text-[var(--color-danger)]"}`}>
        {value}
      </p>
    </div>
  );
}
