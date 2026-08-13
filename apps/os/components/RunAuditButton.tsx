"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuditStrategy } from "@/lib/audits";

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
      <button
        type="button"
        onClick={run}
        disabled={busy || !url}
        title={!url ? "No website URL on this client" : `Run a fresh Lighthouse audit (${strategy})`}
        className="inline-flex items-center justify-center gap-1.5 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
      >
        {busy ? "running…" : `▶ ${strategy}`}
      </button>
      {err && (
        <span
          className="font-mono text-[10px] text-[var(--color-danger)] break-words"
          title={err}
        >
          {err.length > 100 ? err.slice(0, 100) + "…" : err}
        </span>
      )}
    </div>
  );
}
