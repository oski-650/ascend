"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

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
      <Button
        type="button"
        onClick={() => setConfirming(true)}
        variant="quiet"
        title="Permanently delete this prospect file from the hit list"
      >
        Delete
      </Button>
    );
  }

  return (
    // Destructive confirmation: stated in words and carried by the danger variant, never by a
    // tinted panel. Deleting a prospect removes a real file from the vault.
    <div className="flex flex-wrap items-center gap-2">
      <span className="t-label text-[var(--color-risk)]">Delete {prospectName}?</span>
      <Button type="button" onClick={doDelete} disabled={busy} variant="danger">
        {busy ? "…" : "Confirm"}
      </Button>
      <Button type="button" onClick={() => setConfirming(false)} disabled={busy} variant="quiet">
        Cancel
      </Button>
      {err && <span className="t-meta text-[var(--color-risk)]">{err}</span>}
    </div>
  );
}
