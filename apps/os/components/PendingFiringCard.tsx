"use client";

// components/PendingFiringCard — one automation waiting on the operator.
//
// Migrated to the Deep Field language: a hairline-separated ROW with a left accent rule, matching
// the AttentionItem treatment used for Decision items, rather than a rounded card of nested boxes.
// It is an ACTION item — the payload is ready and the only question is whether you send it — so the
// actions are the only strongly interactive things in it.
//
// The MUTATION path is unchanged: it still POSTs to /api/automations/dismiss, which remains the sole
// writer. The payload preview is now collapsed by default; it is reference material, and three
// expanded 2,000-character templates stacked on top of each other buried the actions beneath them.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/primitives";

type Props = {
  firing_id: string;
  rule_id: string;
  rule_name: string;
  trigger_type: string;
  clipboard_label: string;
  target_summary: string;
  /**
   * The subject's canonical route, resolved server-side through navigation/routing from the slug
   * the firing context already carries. `null` when the context names no routable subject — the
   * summary then stays plain text rather than becoming an invented link.
   */
  target_href?: string | null;
  payload: string;
  context: Record<string, string | number>;
};

export function PendingFiringCard(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the payload stays visible in the disclosure below */
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

  return (
    <article className="relative border-b border-[var(--color-line)] py-5 pl-5 last:border-b-0">
      <span
        aria-hidden
        className="absolute bottom-5 left-0 top-5 w-px bg-[var(--color-accent)] opacity-45"
      />

      <h3 className="t-h2 max-w-[62ch] text-[var(--color-t1)]">{props.rule_name}</h3>
      <p className="t-body mt-1 max-w-[62ch] text-[var(--color-t2)]">
        {props.target_href ? (
          <Link
            href={props.target_href}
            className="transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
          >
            {props.target_summary}
          </Link>
        ) : (
          props.target_summary
        )}
      </p>
      <p className="t-mono mt-2 text-[var(--color-t3)]">
        ↳ triggered by {props.trigger_type.replace(/[._]/g, " ")} · {props.rule_id}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Ghost, not accent. Signals renders its per-item "Copy brief" the same way; nine accent
            buttons stacked down a page would drown the one accent thing that matters — the count
            of firings actually waiting. */}
        <Button type="button" onClick={copy} variant="ghost">
          {copied ? "Copied ✓" : "Copy payload"}
        </Button>
        <Button type="button" onClick={dismiss} disabled={busy} variant="ghost">
          {busy ? "Marking…" : "Mark done"}
        </Button>
      </div>

      <details className="group mt-3">
        <summary className="t-label cursor-pointer list-none text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>{" "}
          {props.clipboard_label} · {props.payload.length.toLocaleString()} chars
        </summary>
        <pre className="t-meta mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border-l border-[var(--color-line)] pl-3 leading-relaxed text-[var(--color-t2)]">
          {props.payload}
        </pre>
        {/* The matched trigger context, kept for debugging a rule that fired unexpectedly. */}
        <pre className="t-mono mt-2 overflow-x-auto border-l border-[var(--color-line)] pl-3 text-[var(--color-t3)]">
          {JSON.stringify(props.context, null, 2)}
        </pre>
      </details>
    </article>
  );
}