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
// ─── IT NAMES NO CAUSE, AND THAT IS A CORRECTION ───────────────────────────────────────────────
//
// This copy used to say "Something failed while reading from the vault … most often a malformed
// record in a .jsonl log". It could not know that, and by 2G.1 it was wrong twice over: 2E moved
// prospects to Postgres, so a read failure is at least as likely to be the database; and an
// authorization refusal is not a failure at all, yet a `CapabilityDenied` landed here and told a
// partner the vault was corrupt. It sent operators hunting for a broken file that did not exist.
//
// Denials no longer arrive here — `components/auth/renderOrDenied` classifies them on the SERVER,
// because a client boundary receives a redacted message and cannot tell a refusal from an outage
// (next docs, file-conventions/error.md:111). Since 2G.4.5 a REVOKED, unmembered or unknown account
// does not arrive either: `AccountRefused` reaches `components/auth/AccountInactive` instead, which
// was parked finding 2 — a person whose account was turned off being told the system had broken.
//
// An OUTAGE still arrives here, deliberately, and that is the half Ruling 3 refused to move: an
// unreachable database is a genuine failure of unknown cause, so the copy states what IS known —
// nothing was written, and the digest matches the log.
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
        Your data has not been changed — every read path in Ascend OS is read-only. The reference below
        matches this failure in the server log.
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