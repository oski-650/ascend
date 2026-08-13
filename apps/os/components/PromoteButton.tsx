"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TEMPLATES = [
  { value: "generic", label: "Generic (default)" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "cleaning", label: "Cleaning" },
];

const PACKAGES = [
  { value: "starter", label: "Starter ($1,257)" },
  { value: "growth", label: "Growth ($2,497)" },
  { value: "ascend-pro", label: "Ascend Pro ($3,127)" },
];

export function PromoteButton({
  prospectSlug,
  prospectName,
  alreadyWon,
}: {
  prospectSlug: string;
  prospectName: string;
  alreadyWon: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState(prospectSlug);
  const [template, setTemplate] = useState("generic");
  const [packageTier, setPackageTier] = useState("growth");
  const [launchTarget, setLaunchTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectSlug}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_slug: clientSlug,
          template,
          package_tier: packageTier,
          launch_target: launchTarget || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; links?: { production: string }; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Promotion failed");
        return;
      }
      router.push(json.links?.production ?? `/production/${clientSlug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyWon) {
    return (
      <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
        ✓ already won — see CRM
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
        title="Mark closed-won and create CRM client + production tracking"
      >
        🎉 Promote to client
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
        promote {prospectName} → client
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">client slug</span>
          <input
            type="text"
            value={clientSlug}
            onChange={(e) => setClientSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">production template</span>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">package tier</span>
            <select
              value={packageTier}
              onChange={(e) => setPackageTier(e.target.value)}
              className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            >
              {PACKAGES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">launch target (optional)</span>
          <input
            type="date"
            value={launchTarget}
            onChange={(e) => setLaunchTarget(e.target.value)}
            className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <p className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          Creates: <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5">01 - CRM &amp; Clients/{clientSlug}/</code> with 4 profile files + <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5">production_state.md</code> from the {template} template. Marks prospect <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5">closed-won</code>. Redirects to <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5">/production/{clientSlug}</code>.
        </p>
        {err && <p className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 font-mono text-xs text-[var(--color-danger)]">{err}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-md border border-[var(--color-border-hi)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg-mute)] hover:text-[var(--color-fg)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={promote}
            disabled={busy || !clientSlug}
            className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--color-bg)] hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Promoting…" : "🚀 Promote now"}
          </button>
        </div>
      </div>
    </div>
  );
}
