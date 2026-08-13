"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { APPROVAL_KINDS, APPROVAL_KIND_LABEL, type ApprovalKind } from "@/lib/portalTypes";

export function CreateApprovalForm({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ApprovalKind>("design");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const valid = title.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/portal/approval-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientSlug,
          kind,
          title: title.trim(),
          description: description.trim(),
          due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFlash({ kind: "err", msg: json.error ?? "Failed" });
        return;
      }
      setFlash({ kind: "ok", msg: "Created. Share the approval link from the list below." });
      setTitle("");
      setDescription("");
      setDueDate("");
      router.refresh();
    } catch (e) {
      setFlash({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)]"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-fg)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[var(--color-accent)] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span>+ Request an approval</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">immutable on sign</span>
      </summary>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-[var(--color-border-hi)] p-4 sm:grid-cols-2 sm:p-5">
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as ApprovalKind)} className={selectClass}>
            {APPROVAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {APPROVAL_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date (optional)">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Title" className="sm:col-span-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Approve homepage design v2"
            className={inputClass}
          />
        </Field>
        <Field label="Description (shown to client)" className="sm:col-span-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What exactly are they approving? Reference files, mockups, scope changes, etc. The client sees this verbatim."
            className={inputClass}
          />
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
            className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create approval request"}
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
