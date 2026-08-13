// core/finance/commands — the finance capability's own READ command definitions (Phase 5, Face 2).
//
// Ownership (DC-5.2): finance owns these command DEFINITIONS; it delegates all finance LOGIC to the
// existing core/finance reads (listInvoices, getClientRevenue) — it re-implements nothing. Each command
// has exactly one owning module (this file). These are READ-ONLY: no writes, no events, no mutation,
// no engine access. Both handlers are clock-free → deterministic over the current invoice state.

import "server-only";
import type { CommandDefinition } from "@/core/command-runtime/types";
import { listInvoices, getClientRevenue } from "@/core/finance";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const financeCommands: readonly CommandDefinition[] = [
  {
    metadata: {
      id: "finance-outstanding",
      label: "Outstanding invoices",
      description: "Total count and amount of unpaid invoices.",
      verbs: ["outstanding", "outstanding invoices", "unpaid", "unpaid invoices"],
      kind: "read",
      args: [],
    },
    async execute() {
      // Unpaid = paid_at is null — clock-independent (no overdue derivation), so the result is
      // deterministic over the current invoice records.
      const invoices = await listInvoices();
      const unpaid = invoices.filter((i) => i.paid_at == null);
      const amount = unpaid.reduce((sum, i) => sum + (i.amount_usd ?? 0), 0);
      return {
        ok: true,
        message: `${unpaid.length} outstanding invoice${unpaid.length === 1 ? "" : "s"} totaling ${usd(amount)}.`,
        data: { count: unpaid.length, amountUsd: amount },
      };
    },
  },
  {
    metadata: {
      id: "finance-client-revenue",
      label: "Client contracted revenue",
      description: "Contracted revenue for a client, by slug.",
      verbs: ["client revenue", "revenue", "contracted revenue"],
      kind: "read",
      args: [{ name: "client", required: true, description: "The client's slug." }],
    },
    async execute(args) {
      const slug = args.client;
      const revenue = await getClientRevenue(slug);
      if (revenue == null) return { ok: false, error: `No contracted revenue found for client "${slug}".` };
      return {
        ok: true,
        message: `${slug}: ${usd(revenue)} contracted revenue.`,
        data: { client: slug, revenueUsd: revenue },
      };
    },
  },
];