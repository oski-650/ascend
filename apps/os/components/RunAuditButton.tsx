"use client";

// components/RunAuditButton — trigger a fresh Lighthouse run.
//
// Restyled for the Deep Field language. Two things changed beyond tokens:
//   • It was accent-filled. Accent is reserved for operator ATTENTION, and "you could run an audit"
//     is not attention — it is an available action. It is now the standard ghost affordance.
//   • Its label repeated the strategy ("▶ MOBILE") directly beside the "MOBILE" column heading.
//     The label is now just "Run"; the strategy stays in the heading that already states it, and
//     the accessible name still carries it via aria-label.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuditStrategy } from "@/lib/audits";
import { Button } from "@/components/primitives";

export function RunAuditButton({
  client,
  url,
  strategy,
}: {
  client: string;
  url: string;
  strategy: AuditStrategy;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (busy || !url) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/audits/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, url, strategy }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Audit failed");
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button
        type="button"
        onClick={run}
        disabled={busy || !url}
        aria-label={`Run a fresh ${strategy} audit`}
        title={!url ? "No website URL on this client" : `Run a fresh Lighthouse audit (${strategy})`}
      >
        {busy ? "Running…" : "Run"}
      </Button>
      {err && (
        <span className="t-mono break-words text-[var(--color-risk)]" title={err}>
          {err.length > 100 ? err.slice(0, 100) + "…" : err}
        </span>
      )}
    </div>
  );
}
