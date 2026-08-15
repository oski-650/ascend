"use client";

// components/InvoiceRow — one invoice in the ledger.
//
// Migrated to the Deep Field language: a hairline-separated row rather than a pill-and-card row.
// The MUTATION path is unchanged — it still PATCHes /api/finance/invoices/[id], which remains the
// sole writer. This is presentation only.
//
// `clientHref` resolves through navigation/routing (the single owner), so money links back to the
// relationship it belongs to — Finance → Client — rather than dead-ending in a slug.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Invoice, InvoiceStatus } from "@/lib/finance";
import { Button, Status, type Tone } from "@/components/primitives";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  paid: "good",
  overdue: "risk",
  sent: "accent",
  draft: "neutral",
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
  clientHref,
}: {
  invoice: Invoice;
  status: InvoiceStatus;
  clientName: string;
  clientHref?: string | null;
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
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-2.5 border-b border-[var(--color-line)] py-3.5 last:border-b-0">
      {/* Below `sm` the identity takes a full line of its own: cramming label, client, amount,
          status and action onto one row truncated the label AND the client name, which is
          semantic information, not chrome. */}
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <p className="t-body text-[var(--color-t1)] sm:truncate">{invoice.label}</p>
        <p className="t-mono mt-0.5 text-[var(--color-t3)] sm:truncate">
          {clientHref ? (
            <Link href={clientHref} className="transition-colors duration-[120ms] hover:text-[var(--color-accent)]">
              {clientName}
            </Link>
          ) : (
            clientName
          )}
          {" · issued "}
          {shortDate(invoice.issued_at)}
          {" · due "}
          {shortDate(invoice.due_at)}
          {invoice.paid_at && <> · paid {shortDate(invoice.paid_at)}</>}
        </p>
      </div>

      <span className="t-metric shrink-0 text-[var(--color-t1)]">
        {formatUsd(invoice.amount_usd)}
      </span>

      <span className="shrink-0 sm:w-[92px] sm:text-right">
        <Status tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Status>
      </span>

      <Button
        type="button"
        onClick={toggle}
        disabled={busy}
        variant={status === "paid" ? "quiet" : "ghost"}
        className="ml-auto shrink-0 sm:ml-0"
      >
        {busy ? "…" : status === "paid" ? "Unmark" : "Mark paid"}
      </Button>
    </li>
  );
}