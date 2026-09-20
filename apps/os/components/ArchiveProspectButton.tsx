"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

/**
 * ARCHIVE, not Delete (D1b, owner decision 1).
 *
 * The button used to say "Delete" and carry the `danger` variant. After D1b it performs an operation
 * that keeps the row, the identity anchor, the notes, the `prospect_notes` log and every event — so
 * "Delete" would be a claim the system does not honour, which is the same class of untruth D1a spent
 * a slice removing from this exact path. The label, the confirmation copy and the variant all change
 * together: `danger` communicates irreversible destruction, and archival is neither irreversible nor
 * destructive.
 *
 * Hard deletion remains a separate administrative concern and is deliberately not reachable here.
 */
export function ArchiveProspectButton({
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

  async function doArchive() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectSlug}`, { method: "DELETE" });
      const json = (await res.json()) as { outcome?: string; error?: string };
      // The button may only claim what the server proved. `already_archived` is a SUCCESS — it is
      // the idempotent repeat, and treating it as an error would make a retry after a dropped
      // connection read as a failure. `deleted` is the vault arm. Anything else is shown verbatim.
      const done =
        res.ok &&
        (json.outcome === "archived" || json.outcome === "already_archived" || json.outcome === "deleted");
      if (!done) {
        setErr(json.error ?? "Archive failed");
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
        title="Remove from the hit list. Notes and history are kept."
      >
        Archive
      </Button>
    );
  }

  return (
    // The confirmation states what is kept, not only what is removed. An operator deciding whether
    // to archive needs to know the call log survives — that is the whole difference from a delete.
    <div className="flex flex-wrap items-center gap-2">
      <span className="t-label">Archive {prospectName}? Its notes and history are kept.</span>
      <Button type="button" onClick={doArchive} disabled={busy} variant="primary">
        {busy ? "…" : "Confirm"}
      </Button>
      <Button type="button" onClick={() => setConfirming(false)} disabled={busy} variant="quiet">
        Cancel
      </Button>
      {err && <span className="t-meta text-[var(--color-risk)]">{err}</span>}
    </div>
  );
}
