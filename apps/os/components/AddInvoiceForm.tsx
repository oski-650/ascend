"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClientOption = { slug: string; name: string };

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AddInvoiceForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(clients[0]?.slug ?? "");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState(todayISO());
  const [due, setDue] = useState(addDaysISO(todayISO(), 14));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const amountN = Number(amount);
  const valid = client.length > 0 && Number.isFinite(amountN) && amountN > 0 && label.trim().length > 0 && issued && due;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client,
          amount_usd: amountN,
          label: label.trim(),
          issued_at: new Date(`${issued}T00:00:00`).toISOString(),
          due_at: new Date(`${due}T00:00:00`).toISOString(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFlash({ kind: "err", msg: json.error ?? "Failed to add invoice" });
        return;
      }
      setFlash({ kind: "ok", msg: `Invoice added: ${label.trim()}` });
      setAmount("");
      setLabel("");
      router.refresh();
    } catch (err) {
      setFlash({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)]"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-fg)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[var(--color-accent)] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span>+ Add invoice</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">new entry</span>
      </summary>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-[var(--color-border-hi)] p-4 sm:grid-cols-2 sm:p-5">
        <Field label="Client">
          <select value={client} onChange={(e) => setClient(e.target.value)} className={selectClass}>
            {clients.length === 0 && <option value="">(no clients)</option>}
            {clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount (USD)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1248"
            className={inputClass}
          />
        </Field>

        <Field label="Label" className="sm:col-span-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Initial deposit · Phase 2 milestone · Final payment"
            className={inputClass}
          />
        </Field>

        <Field label="Issued date">
          <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={inputClass} />
        </Field>

        <Field label="Due date">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
        </Field>

        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <div className="min-h-[20px] text-xs">
            {flash && (
              <span className={flash.kind === "ok" ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}>
                {flash.kind === "ok" ? "✓ " : "✗ "}
                {flash.msg}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Add invoice"}
          </button>
        </div>
      </form>
    </details>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)]";
const selectClass = inputClass + " appearance-none pr-8";
