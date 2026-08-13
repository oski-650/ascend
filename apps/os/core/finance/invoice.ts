// core/finance/invoice.ts — Invoice reads + writes (moved from lib/finance.ts, Phase 2.4).
// I/O via core/vault primitives. Every write follows validate → persist → emitEvent → return.
//
// IMMUTABILITY: the commercial record is immutable — `id`, `client`, `amount_usd`, `issued_at`
// are set once at creation and never rewritten. Only `paid_at` changes (markPaid/markUnpaid).
// There is no operation here that mutates the immutable fields; an amount change would be a new
// capability (credit note / replacement), never silent mutation.

import "server-only";
import { invoiceLogPath } from "@/core/vault/paths";
import { readJsonlFile } from "@/core/vault/io";
import { writeFileAtomic } from "@/core/vault/markdown";
import { emitEvent } from "@/core/events";
import {
  deriveInvoiceStatus,
  INVOICE_STATUS_LABEL,
  newInvoiceId,
  type Invoice,
  type InvoiceStatus,
} from "@/domain";

export type { Invoice, InvoiceStatus };

async function readAll(): Promise<Invoice[]> {
  return readJsonlFile<Invoice>(invoiceLogPath());
}

async function writeAll(entries: Invoice[]): Promise<void> {
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  await writeFileAtomic(invoiceLogPath(), body);
}

export async function listInvoices(): Promise<Invoice[]> {
  return readAll();
}

/** Create an immutable invoice record + emit invoice.created (once). */
export async function createInvoice(args: {
  client: string;
  amount_usd: number;
  label: string;
  issued_at: Date;
  due_at: Date;
  paid_at?: Date | null;
  note?: string;
}): Promise<Invoice> {
  const entries = await readAll();
  const entry: Invoice = {
    id: newInvoiceId(),
    client: args.client,
    amount_usd: Math.round(args.amount_usd * 100) / 100,
    label: args.label,
    issued_at: args.issued_at.toISOString(),
    due_at: args.due_at.toISOString(),
    paid_at: args.paid_at ? args.paid_at.toISOString() : null,
    note: args.note ?? "",
  };
  entries.push(entry);
  await writeAll(entries);

  await emitEvent({
    type: "invoice.created",
    subject: { entity: "invoice", entity_id: entry.id },
    data: { client: entry.client, amount_usd: entry.amount_usd, label: entry.label },
  });
  // Created already-paid is a distinct paid transition.
  if (entry.paid_at) {
    await emitEvent({
      type: "invoice.paid",
      subject: { entity: "invoice", entity_id: entry.id },
      data: { client: entry.client, amount_usd: entry.amount_usd, paid_at: entry.paid_at },
    });
  }
  return entry;
}

/** Mark paid — IDEMPOTENT: already-paid ⇒ no-op (no rewrite, no duplicate event). */
export async function markPaid(id: string, when?: Date): Promise<Invoice | null> {
  const entries = await readAll();
  const inv = entries.find((e) => e.id === id);
  if (!inv) return null;
  if (inv.paid_at) return inv; // already paid — idempotent no-op
  inv.paid_at = (when ?? new Date()).toISOString();
  await writeAll(entries);
  await emitEvent({
    type: "invoice.paid",
    subject: { entity: "invoice", entity_id: inv.id },
    data: { client: inv.client, amount_usd: inv.amount_usd, paid_at: inv.paid_at },
  });
  return inv;
}

/** Revert to unpaid — IDEMPOTENT: already-unpaid ⇒ no-op (no duplicate event). */
export async function markUnpaid(id: string): Promise<Invoice | null> {
  const entries = await readAll();
  const inv = entries.find((e) => e.id === id);
  if (!inv) return null;
  if (inv.paid_at === null) return inv; // already unpaid — idempotent no-op
  inv.paid_at = null;
  await writeAll(entries);
  await emitEvent({
    type: "invoice.unpaid",
    subject: { entity: "invoice", entity_id: inv.id },
    data: { client: inv.client, amount_usd: inv.amount_usd },
  });
  return inv;
}

/** Derived status (paid/overdue/sent/draft) — the single deriver lives in domain. */
export function statusOf(inv: Invoice, now: Date = new Date()): InvoiceStatus {
  return deriveInvoiceStatus(inv, now);
}

export function statusLabel(s: InvoiceStatus): string {
  return INVOICE_STATUS_LABEL[s];
}
