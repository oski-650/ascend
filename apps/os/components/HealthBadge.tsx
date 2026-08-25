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

/**
 * The indeterminate treatment. NOT a variant of `at_risk` and not a blank: an uncomputable score
 * is rendered as its own visible state, because hiding it would make absence look like either
 * "fine" or "not applicable" (H2 §11.3).
 */
const INDETERMINATE = {
  ring: "border-dashed border-[var(--color-border-hi)]",
  text: "text-[var(--color-fg-dim)]",
  label: "UNKNOWN",
};

export function HealthBadge({ score, size = "md" }: { score: HealthScore; size?: "sm" | "md" | "lg" }) {
  const s = score.tier !== null ? TIER_STYLE[score.tier] : INDETERMINATE;
  const dim = {
    sm: "size-10 text-sm",
    md: "size-14 text-lg",
    lg: "size-20 text-2xl",
  }[size];
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex ${dim} items-center justify-center rounded-full border-2 bg-[var(--color-surface)] font-mono font-bold ${s.ring} ${s.text}`}
        title={score.score === null ? "Health cannot be determined — phase history unknown" : undefined}
      >
        {score.score ?? "?"}
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

/**
 * A null value renders an explicit "unknown" bar — never a zero-width bar, which would be visually
 * identical to a genuine 0 and would make "no evidence" read as "nothing done".
 */
function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-surface-hi)]">
        {value === null ? (
          <div className="h-full w-full bg-[repeating-linear-gradient(45deg,var(--color-border-hi)_0px,var(--color-border-hi)_2px,transparent_2px,transparent_4px)]" />
        ) : (
          <div
            className={`h-full ${value >= 70 ? "bg-[var(--color-accent)]" : value >= 40 ? "bg-amber-400" : "bg-[var(--color-danger)]"}`}
            style={{ width: `${value}%` }}
          />
        )}
      </div>
      {value === null ? (
        <p className="mt-0.5 font-mono text-[10px] font-semibold text-[var(--color-fg-dim)]">unknown</p>
      ) : (
        <p className={`mt-0.5 font-mono text-[10px] font-semibold ${value >= 70 ? "text-[var(--color-accent)]" : value >= 40 ? "text-amber-300" : "text-[var(--color-danger)]"}`}>
          {value}
        </p>
      )}
    </div>
  );
}
