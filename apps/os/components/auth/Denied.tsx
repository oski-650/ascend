// components/auth/Denied — what an AUTHENTICATED user sees when the answer is no.
//
// ─── WHY THIS EXISTS AS A COMPONENT ────────────────────────────────────────────────────────────
//
// Until 2G the rendered surface had exactly one negative outcome: not signed in, handled by
// `middleware.ts` redirecting to `/login`. "Signed in, but not permitted" has never existed here,
// because there has only ever been one user.
//
// It must not be expressed as any of the three things that would be easier:
//
//   • an empty page          — indistinguishable from "there is no data", which is the
//                              authorization-by-absence F49 exists to forbid
//   • a redirect to /login   — dishonest; the person IS signed in, and it invites a login loop
//   • `unauthorized()`       — MEASURED (STAGE2G §9, spike 3): a 500 unless
//                              `experimental.authInterrupts` is enabled, and an experimental flag
//                              does not belong on the authorization path
//
// ─── IT NAMES NOTHING ──────────────────────────────────────────────────────────────────────────
//
// No capability, no role, no reason. A denial that explains itself is a map of the system for
// whoever is probing it — the same rule the 403 JSON body follows in `lib/route-guard`. The server
// log carries the detail; the page carries none.

import Link from "next/link";

export function Denied({ area }: { area?: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="t-label mb-3 text-[var(--color-t3)]">Not available</p>
      <h1 className="mb-4 text-2xl font-medium text-[var(--color-t1)]">
        You don&rsquo;t have access to this
      </h1>
      <p className="mb-8 text-sm text-[var(--color-t2)]">
        {area ? `${area} isn't part of your access.` : "This area isn't part of your access."} If you
        think that&rsquo;s wrong, ask the account owner.
      </p>
      <Link
        href="/sales"
        className="inline-block rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-t1)] hover:border-[var(--color-accent)]"
      >
        Go to your pipeline
      </Link>
    </div>
  );
}
