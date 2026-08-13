import type { PipelineStatus } from "@/lib/sales";
import { statusLabel } from "@/lib/sales";

const STYLES: Record<PipelineStatus, string> = {
  lead: "border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-hi)] text-[var(--color-fg-mute)]",
  contacted: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  proposal: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  "closed-won": "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  "closed-lost": "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};

export function StatusBadge({ status }: { status?: PipelineStatus }) {
  const s = status ?? "lead";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STYLES[s]}`}
    >
      {statusLabel(s)}
    </span>
  );
}
