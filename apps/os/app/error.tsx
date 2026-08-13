"use client";

// app/error.tsx — route-level error boundary (hardening pass).
//
// Ascend OS previously had no error boundary of any kind, so any throw from any reader produced an
// unstyled Next.js error page in dev and a bare "Application error" in production, with no way back.
// This boundary keeps the operator inside the application and gives them a recovery path.
//
// It renders NO stack trace and NO error message: those routinely contain absolute vault paths and
// internal structure. The digest is a Next-generated correlation id (safe to display) that maps to
// the full error in the server logs.
//
// This is presentation + recovery only — no read-model, no derivation, no frozen contract.

import { useEffect } from "react";
import Link from "next/link";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side console only; the server already logged the real error with its stack.
    console.error("[ascend-os] route error", error.digest ?? "");
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-danger)]">
        section unavailable
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This view could not be loaded.</h1>
      <p className="mt-3 text-sm text-[var(--color-fg-mute)]">
        Something failed while reading from the vault. Your data has not been changed — every read path in
        Ascend OS is read-only. This is most often a malformed record in a <code>.jsonl</code> log or a
        vault file that could not be read.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          reference · {error.digest}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={reset}
          className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-[var(--color-border-hi)] px-3 py-2 font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)] transition-colors hover:text-[var(--color-fg)]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}