"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Invoice, InvoiceStatus } from "@/lib/finance";

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  paid: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
  overdue: "border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  sent: "border-amber-400/60 bg-amber-400/10 text-amber-300",
  draft: "border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-hi)] text-[var(--color-fg-dim)]",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  sent: "Sent",
  draft: "Draft",
};

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function InvoiceRow({
  invoice,
  status,
  clientName,
}: {
  invoice: Invoice;
  status: InvoiceStatus;
  clientName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/finance/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status === "paid" ? { paid: false } : { paid: true }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--color-border-hi)] py-3 last:border-b-0 sm:grid-cols-[110px_1fr_auto_auto_auto] sm:gap-4">
      <span
        className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-center font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[status]}`}
      >
        {STATUS_LABEL[status]}
      </span>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{invoice.label}</p>
        <p className="truncate font-mono text-[11px] text-[var(--color-fg-dim)]">
          {clientName} · issued {shortDate(invoice.issued_at)} · due {shortDate(invoice.due_at)}
          {invoice.paid_at && <> · paid {shortDate(invoice.paid_at)}</>}
        </p>
      </div>

      <span className="hidden font-mono text-[10px] text-[var(--color-fg-dim)] sm:inline">
        {invoice.client}
      </span>

      <span className="font-mono text-base font-bold tabular-nums text-[var(--color-fg)]">
        {formatUsd(invoice.amount_usd)}
      </span>

      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`shrink-0 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50 ${
          status === "paid"
            ? "border-[var(--color-fg-dim)]/50 text-[var(--color-fg-dim)] hover:border-[var(--color-fg-mute)] hover:text-[var(--color-fg-mute)]"
            : "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
        }`}
      >
        {busy ? "…" : status === "paid" ? "unmark" : "mark paid"}
      </button>
    </li>
  );
}
