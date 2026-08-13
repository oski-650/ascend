import Link from "next/link";
import type { Prospect } from "@/lib/sales";
import { displayName } from "@/lib/sales";
import { StatusBadge } from "./StatusBadge";
import { ScoreBar } from "./ScoreBadge";

export function ProspectRow({ prospect, rank }: { prospect: Prospect; rank: number }) {
  const fm = prospect.frontmatter;
  return (
    <Link
      href={`/sales/${prospect.slug}`}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3 transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hi)] sm:grid-cols-[auto_1fr_auto_auto] sm:gap-4 sm:p-4"
    >
      <span className="font-mono text-xs font-semibold text-[var(--color-fg-dim)] sm:text-sm">
        #{String(rank).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--color-fg)] sm:text-base">
            {displayName(prospect)}
          </h3>
          <span className="hidden font-mono text-[10px] text-[var(--color-fg-dim)] sm:inline">
            {prospect.slug}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-fg-dim)]">
          {[fm.business_type, fm.location].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="hidden sm:block">
        <StatusBadge status={fm.status} />
      </div>
      <ScoreBar result={prospect.score} />
    </Link>
  );
}
