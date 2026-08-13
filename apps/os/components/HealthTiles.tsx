import Link from "next/link";
import type { HealthScore } from "@/engines/health-engine";
import type { HealthTile } from "@/mission-control/health";
import { HealthBadge } from "./HealthBadge";

/**
 * Health Tiles — pure presentation of per-project health (Phase 3.3).
 *
 * Renders exactly what the Health Engine's public HealthScore contract exposes (D-3.3.3): the
 * surface neither knows nor cares whether the breakdown has three subscores today or seven later —
 * it iterates whatever is there. It computes nothing, scores nothing, and re-encodes none of the
 * engine's thresholds. The one good/bad judgment shown is the engine's own `tier` (via HealthBadge);
 * subscore bars are neutral magnitudes. Ordering was done in the assembly (least-healthy first, MC-2).
 */
export function HealthTiles({ tiles }: { tiles: HealthTile[] }) {
  if (tiles.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-6 text-sm text-zinc-500">
        No health data yet. A tile appears here once a client has a production state.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => (
        <HealthTileCard key={tile.clientSlug} tile={tile} />
      ))}
    </div>
  );
}

function HealthTileCard({ tile }: { tile: HealthTile }) {
  const { health } = tile;
  return (
    <article className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/production/${tile.clientSlug}`}
            className="block truncate text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)]"
          >
            {tile.clientName}
          </Link>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--color-fg-dim)]">{launchLabel(health.daysToLaunch)}</p>
        </div>
        <HealthBadge score={health} size="sm" />
      </header>
      <div className="border-t border-[var(--color-border-hi)] pt-3">
        <Subscores breakdown={health.breakdown} />
      </div>
    </article>
  );
}

/** Format the engine-produced `daysToLaunch` field — presentation of an existing value, not a computation. */
function launchLabel(daysToLaunch: number | null): string {
  if (daysToLaunch === null) return "no launch target";
  if (daysToLaunch < 0) return `${Math.abs(daysToLaunch)}d overdue`;
  if (daysToLaunch === 0) return "launches today";
  return `${daysToLaunch}d to launch`;
}

/** Render whatever subscores the HealthScore.breakdown contract exposes — generic over count (D-3.3.3). */
function Subscores({ breakdown }: { breakdown: HealthScore["breakdown"] }) {
  const entries = Object.entries(breakdown);
  return (
    <div className="grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
      {entries.map(([label, value]) => (
        <SubscoreBar key={label} label={label} value={value} />
      ))}
    </div>
  );
}

/** A single subscore as a neutral magnitude bar — length conveys value; color implies no valence. */
function SubscoreBar({ label, value }: { label: string; value: number }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div>
      <p className="truncate font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-surface-hi)]">
        {pct !== null && <div className="h-full bg-zinc-400" style={{ width: `${pct}%` }} />}
      </div>
      <p className="mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-[var(--color-fg)]">{pct !== null ? pct : "—"}</p>
    </div>
  );
}
