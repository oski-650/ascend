import Link from "next/link";
import type { Opportunity, Severity } from "@/lib/opportunities";
import { CopyTextButton } from "./CopyTextButton";

const SEV_STYLE: Record<Severity, { ring: string; chip: string; dot: string; label: string }> = {
  urgent: {
    ring: "border-[var(--color-danger)]/50",
    chip: "border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
    dot: "bg-[var(--color-danger)] shadow-[0_0_10px_var(--color-danger)]",
    label: "URGENT",
  },
  suggest: {
    ring: "border-amber-400/40",
    chip: "border-amber-400/60 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400 shadow-[0_0_8px_rgb(251_191_36/0.7)]",
    label: "SUGGEST",
  },
  info: {
    ring: "border-sky-400/40",
    chip: "border-sky-400/60 bg-sky-400/10 text-sky-300",
    dot: "bg-sky-400 shadow-[0_0_6px_rgb(56_189_248/0.6)]",
    label: "INFO",
  },
};

export function OpportunityCard({
  opportunity,
  payload,
}: {
  opportunity: Opportunity;
  payload: string;
}) {
  const s = SEV_STYLE[opportunity.severity];
  return (
    <article className={`rounded-lg border-l-4 ${s.ring} border-y border-r border-y-[var(--color-border-hi)] border-r-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5`}>
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-1.5 inline-block size-2 rounded-full shrink-0 ${s.dot}`} />
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${s.chip}`}>
                {s.label}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                {opportunity.kind.replace(/_/g, " ")}
              </span>
              {opportunity.target && (
                <Link
                  href={opportunity.href ?? "#"}
                  className="font-mono text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]"
                >
                  → {opportunity.target.name}
                </Link>
              )}
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-fg)] sm:text-base">
              {opportunity.title}
            </h3>
          </div>
        </div>
      </header>

      <p className="mb-3 text-sm leading-relaxed text-[var(--color-fg-mute)]">{opportunity.rationale}</p>

      <div className="mb-4 rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] p-3">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">action</p>
        <p className="text-sm text-[var(--color-fg)]">{opportunity.action}</p>
      </div>

      <CopyTextButton payload={payload} label="Copy Opportunity Brief" variant="secondary" icon="📋" />
    </article>
  );
}
