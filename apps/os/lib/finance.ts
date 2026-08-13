// lib/finance.ts — MOVED to core/finance/invoice (Phase 2.4). Re-export shim.
// New code: import from "@/core/finance".

export { listInvoices, createInvoice, markPaid, markUnpaid, statusOf, statusLabel } from "@/core/finance";
export type { Invoice, InvoiceStatus } from "@/core/finance";
