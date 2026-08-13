import type { PriorityItem } from "@/engines/decision-engine";

/** Renders the Decision-ranked priority feed. Pure presentation — no logic. */
export function PriorityFeed({ items }: { items: PriorityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-6 text-sm text-zinc-500">
        Nothing needs your attention right now — no open health risks or opportunities.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={`${it.subject.entity}:${it.subject.id}`}>
          <div className="flex items-start gap-3 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-3 transition-colors hover:border-[var(--color-accent)]/40">
            <span className="mt-0.5 w-6 shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">
              #{it.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{it.subject.name}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{it.explanation}</p>
            </div>
            <span
              className={`shrink-0 font-mono text-[11px] font-bold tabular-nums ${
                it.priorityScore >= 80
                  ? "text-[var(--color-danger)]"
                  : it.priorityScore >= 55
                    ? "text-[var(--color-accent)]"
                    : "text-zinc-500"
              }`}
              title="priority score"
            >
              {it.priorityScore}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
