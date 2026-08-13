import Link from "next/link";
import type { DocumentRecord, DocumentStatus, DocumentType } from "@/lib/documentTypes";
import { TYPE_LABEL, STATUS_LABEL } from "@/lib/documentTypes";

const STATUS_STYLE: Record<DocumentStatus, string> = {
  draft: "border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-hi)] text-[var(--color-fg-dim)]",
  sent: "border-sky-400/60 bg-sky-400/10 text-sky-300",
  accepted: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
  superseded: "border-[var(--color-fg-dim)]/30 bg-[var(--color-surface-hi)] text-[var(--color-fg-dim)] line-through opacity-70",
};

const TYPE_STYLE: Record<DocumentType, string> = {
  proposal: "text-sky-300",
  contract: "text-emerald-300",
  sow: "text-amber-300",
  change_order: "text-violet-300",
};

function fmtUsd(n?: number): string {
  if (n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function shortDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function DocumentRow({ document, clientName }: { document: DocumentRecord; clientName?: string }) {
  const m = document.meta;
  return (
    <Link
      href={`/documents/${m.doc_id}`}
      className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hi)] sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-4 sm:p-4"
    >
      <span className={`font-mono text-[10px] uppercase tracking-widest sm:w-32 ${TYPE_STYLE[m.type]}`}>
        {TYPE_LABEL[m.type]} · v{m.version}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{m.title}</p>
        <p className="truncate font-mono text-[11px] text-[var(--color-fg-dim)]">
          {clientName ?? m.client} · created {shortDate(m.created_at)}
          {m.sent_at && <> · sent {shortDate(m.sent_at)}</>}
          {m.accepted_at && <> · accepted {shortDate(m.accepted_at)}</>}
        </p>
      </div>
      <span className="hidden font-mono text-xs font-semibold tabular-nums text-[var(--color-fg)] sm:inline">
        {fmtUsd(m.amount_usd)}
      </span>
      <span
        className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[m.status]}`}
      >
        {STATUS_LABEL[m.status]}
      </span>
    </Link>
  );
}
