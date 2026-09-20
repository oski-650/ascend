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
      const json = (await res.json()) as { outcome?: string; error?: string };
      // D1a · The button may only claim what the server proved. A Postgres-owned prospect cannot be
      // deleted yet (archival is D1b), and the server says so with a 409 — which must read as
      // "not done, and here is why", never as a silent success or a generic failure.
      if (!res.ok || json.outcome !== "deleted") {
        setErr(json.error ?? "Delete failed");
        setConfirming(false);
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
        title="Remove this prospect from the hit list"
      >
        Delete
      </Button>
    );
  }

  return (
    // Destructive confirmation: stated in words and carried by the danger variant, never by a
    // tinted panel. Deletion applies to the store that owns prospects; where that store has no
    // deletion operation yet, the server refuses and the refusal is what gets shown.
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
