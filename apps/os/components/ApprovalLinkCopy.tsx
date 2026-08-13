"use client";

import { useState } from "react";

export function ApprovalLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        copied
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
          : "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
      }`}
      title={url}
    >
      {copied ? "✓" : "📋"} link
    </button>
  );
}
