"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Invite = { id: string; token: string; created_at: string };

export function InviteLinkPanel({
  clientSlug,
  invite,
  baseUrl,
}: {
  clientSlug: string;
  invite: Invite | null;
  baseUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = invite ? `${baseUrl}/portal/${invite.token}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  async function rotate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!invite || !url) {
    return (
      <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
        <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)]">
          portal invite
        </h2>
        <p className="mb-3 text-sm text-[var(--color-fg-mute)]">No active invite. Generate one to give this client a unique URL.</p>
        <button
          type="button"
          onClick={rotate}
          disabled={busy}
          className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
        >
          {busy ? "Generating…" : "+ Generate invite"}
        </button>
        {err && <p className="mt-2 font-mono text-[10px] text-[var(--color-danger)]">{err}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)]">portal invite</h2>
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          created {new Date(invite.created_at).toLocaleDateString()}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <code className="flex-1 truncate rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-fg)]">
          {url}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className={`shrink-0 rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
              copied
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
                : "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
            }`}
          >
            {copied ? "✓ Copied" : "📋 Copy link"}
          </button>
          <button
            type="button"
            onClick={rotate}
            disabled={busy}
            className="shrink-0 rounded-md border border-[var(--color-border-hi)] px-3 py-2 text-xs font-semibold text-[var(--color-fg-mute)] hover:border-[var(--color-danger)]/60 hover:text-[var(--color-danger)] disabled:opacity-40"
            title="Generates a new token and revokes the old one. Old URL stops working immediately."
          >
            {busy ? "…" : "↻ Rotate"}
          </button>
        </div>
      </div>
      <p className="mt-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
        Share this URL with the client. Anyone with the link can submit on their behalf.
      </p>
      {err && <p className="mt-2 font-mono text-[10px] text-[var(--color-danger)]">{err}</p>}
    </section>
  );
}
