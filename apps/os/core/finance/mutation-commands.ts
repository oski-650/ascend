// core/finance/mutation-commands — the finance capability's own MUTATION command definitions (Phase 5.x).
//
// Write authority (DC-5x.1): these handlers DELEGATE exclusively to the existing frozen core/finance
// write APIs (markPaid / markUnpaid) — the sole writers + sole event emitters (invoice.paid /
// invoice.unpaid, exactly-once, idempotent, atomic). This module opens NO new write path and NEVER
// calls emitEvent or the filesystem. `preview` is READ-ONLY (describes the change; no write, no event);
// `execute` performs the single atomic core write. The pair is its own undo (DC-5x.7/8).

import "server-only";
import type { CommandDefinition } from "@/core/command-runtime/types";
import { listInvoices, markPaid, markUnpaid, statusOf, statusLabel, type Invoice } from "@/core/finance";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

async function findInvoice(id: string): Promise<Invoice | null> {
  const invoices = await listInvoices();
  return invoices.find((i) => i.id === id) ?? null;
}

function describe(inv: Invoice): string {
  return `Invoice ${inv.id} · ${inv.client} · ${usd(inv.amount_usd)} · currently ${statusLabel(statusOf(inv)).toUpperCase()}`;
}

export const financeMutationCommands: readonly CommandDefinition[] = [
  {
    metadata: {
      id: "mark-invoice-paid",
      label: "Mark invoice paid",
      description: "Mark an invoice as paid, by invoice id.",
      verbs: ["mark paid", "mark invoice paid", "pay invoice"],
      kind: "mutation",
      args: [{ name: "invoice", required: true, description: "Invoice id" }],
    },
    // READ-ONLY preview — no write, no event.
    async preview(args) {
      const inv = await findInvoice(args.invoice);
      if (!inv) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      if (inv.paid_at) return { ok: true, message: `${describe(inv)} — already PAID; confirming makes no change.`, data: { changes: false } };
      return { ok: true, message: `${describe(inv)} → will mark PAID.`, data: { changes: true } };
    },
    // WRITE — delegates to core/finance.markPaid (idempotent, exactly-once invoice.paid).
    async execute(args) {
      const before = await findInvoice(args.invoice);
      if (!before) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      const changed = before.paid_at === null;
      const result = await markPaid(args.invoice);
      if (!result) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      return {
        ok: true,
        message: changed ? `Invoice ${args.invoice} marked PAID.` : `Invoice ${args.invoice} was already paid — no change.`,
        data: { changed },
      };
    },
  },
  {
    metadata: {
      id: "mark-invoice-unpaid",
      label: "Mark invoice unpaid",
      description: "Revert an invoice to unpaid, by invoice id. (The inverse of mark-invoice-paid.)",
      verbs: ["mark unpaid", "mark invoice unpaid", "unpay invoice"],
      kind: "mutation",
      args: [{ name: "invoice", required: true, description: "Invoice id" }],
    },
    async preview(args) {
      const inv = await findInvoice(args.invoice);
      if (!inv) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      if (inv.paid_at === null) return { ok: true, message: `${describe(inv)} — already UNPAID; confirming makes no change.`, data: { changes: false } };
      return { ok: true, message: `${describe(inv)} → will mark UNPAID.`, data: { changes: true } };
    },
    // WRITE — delegates to core/finance.markUnpaid (idempotent, exactly-once invoice.unpaid).
    async execute(args) {
      const before = await findInvoice(args.invoice);
      if (!before) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      const changed = before.paid_at !== null;
      const result = await markUnpaid(args.invoice);
      if (!result) return { ok: false, error: `Invoice "${args.invoice}" not found.` };
      return {
        ok: true,
        message: changed ? `Invoice ${args.invoice} reverted to UNPAID.` : `Invoice ${args.invoice} was already unpaid — no change.`,
        data: { changed },
      };
    },
  },
];