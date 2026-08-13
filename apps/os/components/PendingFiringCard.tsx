"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  firing_id: string;
  rule_id: string;
  rule_name: string;
  trigger_type: string;
  clipboard_label: string;
  target_summary: string;
  payload: string;
  context: Record<string, string | number>;
};

export function PendingFiringCard(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/automations/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firing_id: props.firing_id,
          rule_id: props.rule_id,
          context: props.context,
        }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const charCount = props.payload.length;

  return (
    <article className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            {props.trigger_type.replace(/[._]/g, " ")}
          </p>
          <h3 className="text-sm font-semibold text-[var(--color-fg)] sm:text-base">{props.rule_name}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">▸ {props.target_summary}</p>
        </div>
      </header>

      <details
        open
        className="mb-3 rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)]"
      >
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          <span>{props.clipboard_label}</span>
          <span>{charCount.toLocaleString()} chars</span>
        </summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-xs leading-relaxed text-[var(--color-fg)]">
          {props.payload}
        </pre>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
            copied
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
              : "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
          }`}
        >
          <span>{copied ? "✓" : "📋"}</span>
          <span>{copied ? "Copied" : "Copy payload"}</span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-hi)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--color-fg-mute)] transition-colors hover:border-[var(--color-fg-mute)] hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          {busy ? "Marking…" : "✓ Mark done"}
        </button>
        <button
          type="button"
          onClick={() => setShowRaw((s) => !s)}
          className="ml-auto font-mono text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]"
        >
          {showRaw ? "hide" : "show"} context
        </button>
      </div>

      {showRaw && (
        <pre className="mt-3 overflow-x-auto rounded border border-[var(--color-border-hi)] bg-[var(--color-bg)] p-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
{JSON.stringify(props.context, null, 2)}
        </pre>
      )}
    </article>
  );
}
