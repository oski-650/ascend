import Link from "next/link";
import type { ProductionState } from "@/lib/production";
import type { HealthScore } from "@/lib/healthScore";
import { PhaseLadder, OverallProgressBar } from "./PhaseLadder";
import { HealthBadge, HealthBreakdown } from "./HealthBadge";
import { formatUsd, formatHours } from "@/lib/ehr";
import { formatDuration } from "@/lib/timeLog";

export function MissionTile({
  state,
  health,
  totalSeconds,
  revenue,
  ehr,
}: {
  state: ProductionState;
  health: HealthScore;
  totalSeconds: number;
  revenue: number | null;
  ehr: number | null;
}) {
  const active = state.activePhaseIndex !== null ? state.phases[state.activePhaseIndex] : null;
  const daysLabel =
    health.daysToLaunch === null
      ? "no launch target"
      : health.daysToLaunch < 0
        ? `${Math.abs(health.daysToLaunch)}d overdue`
        : health.daysToLaunch === 0
          ? "launches today"
          : `${health.daysToLaunch}d to launch`;

  return (
    <article className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/production/${state.clientSlug}`}
            className="block truncate text-base font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] sm:text-lg"
          >
            {state.clientName}
          </Link>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">
            {active ? `active: ${active.label}` : "all phases resolved"} · {daysLabel}
          </p>
        </div>
        <HealthBadge score={health} size="md" />
      </header>

      <div className="mb-3">
        <OverallProgressBar progress={state.overallProgress} />
      </div>

      <PhaseLadder phases={state.phases} size="sm" />

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--color-border-hi)] pt-3">
        <Stat label="Tracked" value={totalSeconds > 0 ? formatDuration(totalSeconds, "compact") : "—"} />
        <Stat label="Revenue" value={revenue !== null ? formatUsd(revenue) : "—"} />
        <Stat label="EHR" value={ehr !== null ? `${formatUsd(ehr)}/hr` : "—"} accent={ehr !== null} />
      </div>

      <div className="mt-3 border-t border-[var(--color-border-hi)] pt-3">
        <HealthBreakdown score={health} />
      </div>
    </article>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <p
        className={`mt-0.5 font-mono text-xs font-bold tabular-nums sm:text-sm ${
          accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
