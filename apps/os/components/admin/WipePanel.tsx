// components/admin/WipePanel — the destructive vault surface, as a client component.
//
// It moved here from `app/admin/wipe/page.tsx` in 2G.4.4. The target descriptions — which name two
// clients and a revenue figure (§29.2(c)) — are no longer literals in this file: the page awaits
// `listWipeTargets()`, guarded by `admin:*`, and passes them down. That is §29.11 Q3 answered by
// MOVING the copy rather than deleting it; a destructive tool that stops saying what it destroys is
// a worse tool, and the disclosure is closed by the guard either way.
//
// This file decides nothing. The route it posts to authorizes independently.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WipeTargetGroup, WipeTargetId } from "@/core/admin/tools";

export function WipePanel({ groups }: { groups: readonly WipeTargetGroup[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<WipeTargetId>>(
    new Set(groups.flatMap((g) => g.items.filter((i) => i.defaultOn).map((i) => i.key)))
  );
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ target: string; result: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (k: WipeTargetId) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };

  const canSubmit = confirm === "WIPE" && selected.size > 0 && !busy;

  async function execute() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/admin/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "WIPE", targets: Array.from(selected) }),
      });
      const json = (await res.json()) as { results?: typeof results; error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Wipe failed");
        return;
      }
      setResults(json.results ?? []);
      setConfirm("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 border-b border-[var(--color-border-hi)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">admin · destructive</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Wipe Demo Data</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-mute)]">
          Transitions Ascend OS from seeded demo state into live production. The default selection clears
          transactional sidecars (invoices / time / audits / approvals / etc.) and seeded sample documents,
          while leaving your CRM client folders and automation rules intact.
        </p>
        {/* Coral, not accent: this is a caution on a destructive page, and the accent now reads
            as "go". A warning must never be rendered in the same hue as a safe affordance. */}
        <p className="mt-2 max-w-prose text-xs text-[var(--color-risk)]">
          ⚠ Do NOT re-run <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5 font-mono text-[10px]">npm run scaffold:vault</code> after wiping — it&apos;ll re-seed everything.
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        {groups.map((g) => (
          <section
            key={g.group}
            className={`rounded-lg border bg-[var(--color-surface)] p-4 sm:p-5 ${
              g.group.includes("DESTRUCTIVE")
                ? "border-[var(--color-danger)]/40"
                : "border-[var(--color-border-hi)]"
            }`}
          >
            <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">{g.group}</h2>
            <ul className="flex flex-col gap-2">
              {g.items.map((item) => (
                <li key={item.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded border border-transparent p-2 hover:bg-[var(--color-surface-hi)]">
                    <input
                      type="checkbox"
                      checked={selected.has(item.key)}
                      onChange={() => toggle(item.key)}
                      className="mt-1 size-4 accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-fg)]">{item.label}</p>
                      <p className="font-mono text-[11px] text-[var(--color-fg-dim)]">{item.sub}</p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="sticky bottom-4 z-40 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-bg)]/95 p-4 backdrop-blur sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-1 flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              type WIPE to confirm ({selected.size} target{selected.size === 1 ? "" : "s"} selected)
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="WIPE"
              className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-danger)]"
            />
          </div>
          <button
            type="button"
            onClick={execute}
            disabled={!canSubmit}
            className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-5 py-2.5 text-sm font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)] hover:text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Wiping…" : `🔥 Execute wipe`}
          </button>
        </div>
        {err && <p className="mt-2 font-mono text-xs text-[var(--color-danger)]">{err}</p>}
      </section>

      {results && (
        <section className="mt-6 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            wipe complete ({results.length} action{results.length === 1 ? "" : "s"})
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {results.map((r, i) => (
              <li key={i} className="font-mono text-xs">
                <span className="text-[var(--color-accent)]">✓</span>{" "}
                <span className="text-[var(--color-fg)]">{r.target}</span>{" "}
                <span className="text-[var(--color-fg-dim)]">— {r.result}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
