"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteProspectButton({
  prospectSlug,
  prospectName,
}: {
  prospectSlug: string;
  prospectName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectSlug}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Delete failed");
        return;
      }
      router.push("/sales");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-hi)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--color-fg-dim)] hover:border-[var(--color-danger)]/60 hover:text-[var(--color-danger)]"
        title="Permanently delete this prospect file from the hit list"
      >
        🗑 Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-2 sm:flex-row sm:items-center">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-danger)]">
        delete {prospectName}?
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={doDelete}
          disabled={busy}
          className="rounded border border-[var(--color-danger)] bg-[var(--color-danger)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-bg)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded border border-[var(--color-border-hi)] bg-transparent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-mute)] hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {err && <span className="font-mono text-[10px] text-[var(--color-danger)]">{err}</span>}
    </div>
  );
}
