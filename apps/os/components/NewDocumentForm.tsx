"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_TYPES, TYPE_LABEL, type DocumentType } from "@/lib/documentTypes";

type ClientOption = { slug: string; name: string };

export function NewDocumentForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DocumentType>("proposal");
  const [client, setClient] = useState(clients[0]?.slug ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const valid = type && client.length > 0 && title.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          client,
          title: title.trim(),
          summary: summary.trim() || undefined,
          amount_usd: amount ? Number(amount) : undefined,
        }),
      });
      const json = (await res.json()) as { document?: { meta: { doc_id: string } }; error?: string };
      if (!res.ok || !json.document) {
        setFlash({ kind: "err", msg: json.error ?? "Failed to create" });
        return;
      }
      setFlash({ kind: "ok", msg: `Created — opening…` });
      router.push(`/documents/${json.document.meta.doc_id}`);
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
          <span>+ New document</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          starts as draft
        </span>
      </summary>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-[var(--color-border-hi)] p-4 sm:grid-cols-2 sm:p-5">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as DocumentType)} className={selectClass}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>

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

        <Field label="Title" className="sm:col-span-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Website Build Proposal · Phase 1"
            className={inputClass}
          />
        </Field>

        <Field label="Summary (optional)" className="sm:col-span-2">
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="One-line description"
            className={inputClass}
          />
        </Field>

        <Field label="Amount USD (optional)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2497"
            className={inputClass}
          />
        </Field>

        <div className="flex items-end justify-end gap-3 sm:col-span-1">
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
            {busy ? "Creating…" : "Create draft"}
          </button>
        </div>
      </form>
    </details>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
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
