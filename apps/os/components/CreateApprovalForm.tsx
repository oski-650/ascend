"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { FIELD_LABEL_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/components/primitives/form";
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
      className="border-b border-[var(--color-line)]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 [&::-webkit-details-marker]:hidden">
        <span className="t-body flex items-center gap-2 text-[var(--color-t2)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
          <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span>Request an approval</span>
        </span>
        <span className="t-label text-[var(--color-t3)]">immutable once signed</span>
      </summary>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-[var(--color-line)] py-4 sm:grid-cols-2">
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
              <span className={flash.kind === "ok" ? "text-[var(--color-good)]" : "text-[var(--color-risk)]"}>
                {flash.kind === "ok" ? "✓ " : "✗ "}
                {flash.msg}
              </span>
            )}
          </div>
          {/* Accent is earned: this is the single committing action of an opened form. */}
          <Button type="submit" disabled={!valid || busy} variant="primary">
            {busy ? "Creating…" : "Create approval request"}
          </Button>
        </div>
      </form>
    </details>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

// Field styling comes from the shared primitive so every write surface in the OS looks identical.
const inputClass = INPUT_CLASS;
const selectClass = SELECT_CLASS;
