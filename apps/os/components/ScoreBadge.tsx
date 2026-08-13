import type { ScoreResult } from "@/lib/score";

const TIER_STYLES: Record<ScoreResult["tier"], { ring: string; text: string; label: string }> = {
  cold: { ring: "border-[var(--color-fg-dim)]/40", text: "text-[var(--color-fg-mute)]", label: "COLD" },
  warm: { ring: "border-sky-400/50", text: "text-sky-300", label: "WARM" },
  hot: { ring: "border-amber-400/60", text: "text-amber-300", label: "HOT" },
  priority: { ring: "border-[var(--color-accent)]", text: "text-[var(--color-accent)]", label: "PRIORITY" },
};

export function ScoreBadge({ result, size = "md" }: { result: ScoreResult; size?: "sm" | "md" | "lg" }) {
  const s = TIER_STYLES[result.tier];
  const dim = {
    sm: "size-10 text-sm",
    md: "size-14 text-lg",
    lg: "size-20 text-2xl",
  }[size];
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex ${dim} items-center justify-center rounded-full border-2 bg-[var(--color-surface)] font-mono font-bold ${s.ring} ${s.text}`}
      >
        {result.score}
      </div>
      <span className={`font-mono text-[9px] tracking-widest ${s.text}`}>{s.label}</span>
    </div>
  );
}

export function ScoreBar({ result }: { result: ScoreResult }) {
  const pct = (result.score / result.max) * 100;
  const s = TIER_STYLES[result.tier];
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-hi)] sm:w-32">
        <div
          className={`h-full rounded-full ${
            result.tier === "priority"
              ? "bg-[var(--color-accent)]"
              : result.tier === "hot"
                ? "bg-amber-400"
                : result.tier === "warm"
                  ? "bg-sky-400"
                  : "bg-[var(--color-fg-dim)]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`font-mono text-xs font-semibold ${s.text}`}>{result.score}</span>
    </div>
  );
}
