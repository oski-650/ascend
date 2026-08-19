"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type WipeTarget =
  | "invoices"
  | "time_log"
  | "audits"
  | "automations_fired"
  | "portal_invites"
  | "portal_submissions"
  | "approval_requests"
  | "sample_documents"
  | "client_uploads"
  | "delete_client_pilar"
  | "delete_client_tapia";

type Group = {
  group: string;
  items: { key: WipeTarget; label: string; sub: string; defaultOn?: boolean }[];
};

const GROUPS: Group[] = [
  {
    group: "Transactional sidecars (recommended)",
    items: [
      { key: "invoices", label: "Empty invoices.jsonl", sub: "Wipes the seeded $4,541 revenue + care plans + overdue", defaultOn: true },
      { key: "time_log", label: "Empty time_log.jsonl", sub: "Wipes 22h of seeded time entries + EHR history", defaultOn: true },
      { key: "audits", label: "Empty audits.jsonl", sub: "Wipes 6-month Lighthouse trend (including any real PSI runs)", defaultOn: true },
      { key: "automations_fired", label: "Empty automations_fired.jsonl", sub: "Resets pending firings — they'll re-appear as pending", defaultOn: true },
      { key: "portal_submissions", label: "Empty portal_submissions.jsonl", sub: "Wipes any test onboarding submissions", defaultOn: true },
      { key: "approval_requests", label: "Empty approval_requests.jsonl", sub: "Wipes Pilar's 2 seeded signed approvals + any test ones", defaultOn: true },
      { key: "portal_invites", label: "Empty portal_invites.jsonl", sub: "REVOKES ALL invite tokens — you'll need to issue new ones", defaultOn: false },
    ],
  },
  {
    group: "Sample documents & uploads",
    items: [
      { key: "sample_documents", label: "Delete seeded Pilar + Tapia document trees", sub: "Removes proposals, contracts, SOWs from 04 - Documents/", defaultOn: true },
      { key: "client_uploads", label: "Delete seeded client upload dirs", sub: "Removes the per-client folders under 05 - Client Uploads/", defaultOn: true },
    ],
  },
  {
    group: "CRM client folders — DESTRUCTIVE",
    items: [
      { key: "delete_client_pilar", label: "Delete decoraciones-pilar CRM folder", sub: "Removes the entire client profile. Only check this if you're NOT keeping Pilar as a real client.", defaultOn: false },
      { key: "delete_client_tapia", label: "Delete tapia-tile-marble CRM folder", sub: "Removes the entire client profile. Only check this if you're NOT keeping Tapia as a real client.", defaultOn: false },
    ],
  },
];

const ALL_TARGETS = GROUPS.flatMap((g) => g.items.map((i) => i.key));

export default function WipePage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<WipeTarget>>(
    new Set(GROUPS.flatMap((g) => g.items.filter((i) => i.defaultOn).map((i) => i.key)))
  );
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ target: string; result: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (k: WipeTarget) => {
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
        {GROUPS.map((g) => (
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
