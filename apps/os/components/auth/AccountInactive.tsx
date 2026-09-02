// components/auth/AccountInactive — what a REVOKED, UNMEMBERED or UNKNOWN account sees.
//
//   > A refusal must reach the person as a refusal.
//
// ─── WHY THIS IS NOT `Denied` ──────────────────────────────────────────────────────────────────
//
// `Denied` answers "you are signed in, and this area is not yours" — and it offers a way onward,
// because there IS one. This answers "the database was asked about you and said no", where there is
// nothing onward at all. `Denied`'s "Go to your pipeline" link would be a lie here: a revoked account
// has no pipeline.
//
// Until 2G.4.5 this case reached `app/error.tsx` — parked finding 2. The whole of `NoAuthority` was
// rethrown by `renderOrDenied` because the class covered an outage, an unbound resolver AND a
// revoked person at once, and reporting an unreachable database as "you don't have access" is the
// dangerous direction. §29.3 Ruling 3 split the TYPE rather than weakening the refusal:
// `AccountRefused` names the answered half, and only that half arrives here.
//
// ─── IT NAMES NO REASON ────────────────────────────────────────────────────────────────────────
//
// Revoked, unmembered, ambiguously-membered and unknown all render IDENTICALLY. Naming which one
// would be an enumeration oracle — the same rule `Denied`, `lib/route-guard`'s 403 body and
// `core/auth/invitations`'s uniform refusal all follow. Only the server log distinguishes them.
//
// ─── SIGN-OUT IS OFFERED, NEVER PERFORMED ──────────────────────────────────────────────────────
//
// A plain form POST the person chooses to submit. NOT a redirect: `middleware.ts` admits anyone
// holding a signed cookie, and this person's cookie is still perfectly valid — an automatic redirect
// to `/login` would send them straight back here, which is the login loop `renderOrDenied`'s own
// header refuses to build. A user-initiated sign-out is a different act, and it works because
// `/api/auth/logout` clears the cookie and 303s to `/login`.
//
// No JavaScript: a bare `<form method="post">` so the one action on this page cannot fail for
// whatever reason brought the person here.

export function AccountInactive() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="t-label mb-3 text-[var(--color-t3)]">Account</p>
      <h1 className="mb-4 text-2xl font-medium text-[var(--color-t1)]">
        This account isn&rsquo;t active
      </h1>
      <p className="mb-8 text-sm text-[var(--color-t2)]">
        You&rsquo;re signed in, but this account can&rsquo;t be used right now. Ask the account owner
        if you think that&rsquo;s wrong.
      </p>
      <form method="post" action="/api/auth/logout">
        <button
          type="submit"
          className="inline-block rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-t1)] hover:border-[var(--color-accent)]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
