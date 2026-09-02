// lib/authority — binds the DATA-ACCESS boundary to whichever carrier this request is using.
//
// Two surfaces, two carriers, one answer:
//
//   route handler     → AsyncLocalStorage request context   (7.2, proven under overlap in 7.3)
//   Server Component  → React.cache memo                    (2G.1 slice 1, proven under overlap)
//
// ALS is checked first because a route handler has already resolved the principal — asking again
// would re-read the session and re-query `memberships` for an answer that is already in hand, and
// two lookups in one request are two chances to disagree.
//
// This lives in `lib` for the same reason `lib/request-context` does: it composes the perimeter with
// core, and `core` must not depend on either. The direction stays lib → core, never the reverse.

import "server-only";
import { registerAuthorityResolver, type AuthorityFailure } from "@/core/auth/authority";
import { peekRequestContext } from "@/core/auth/context";
import { pageAuthority, type PageDenial } from "@/lib/page-principal";

/**
 * WHICH KIND OF FAILURE A PAGE DENIAL IS (2G.4.5, STAGE2G §29.3 Ruling 3).
 *
 * ─── THE `default` IS ABSENT ON PURPOSE, AND THAT IS THE WHOLE ENFORCEMENT ─────────────────────
 *
 * `PageDenial` is a closed union today and will not stay one — `ResolutionFailure` is exactly the
 * kind of type a later slice extends. With no `default` arm and a declared return type, adding a
 * reason makes this function fail to COMPILE (TS2366) instead of silently falling through to
 * whichever classification happened to be last. Prose cannot enforce that; the switch does.
 *
 * A `default` returning "unidentified" would look safe and be the dangerous direction: a new
 * REFUSAL reason would be reported as an outage, and the person it refuses would see the error
 * boundary rather than the surface built for them. A `default` returning "refused" is worse still —
 * a genuine outage rendered as "your account is not active".
 */
function failureKind(reason: PageDenial): AuthorityFailure {
  switch (reason) {
    // ANSWERED: the database was reachable, was asked, and its answer denies this person.
    case "disabled":
    case "no-membership":
    case "ambiguous-membership":
    case "no-such-user":
      return "refused";

    // UNANSWERED: nobody could be identified, or nothing could answer.
    case "unauthenticated":
    case "no-request":
    case "unavailable":
      return "unidentified";
  }
}

/**
 * Called once at startup. Idempotent.
 *
 * Deliberately a function rather than an import side effect: a module that binds a security seam
 * merely by being imported binds it in whatever order the bundler happens to choose.
 */
export function bindAuthorityResolver(): void {
  registerAuthorityResolver(async () => {
    const ctx = peekRequestContext();
    if (ctx) return { ok: true, principal: ctx.principal };
    // The ROUTE carrier never reaches the classification: `withRequestContext` has already resolved
    // a principal, so an authority failure on that path was refused before this resolver was asked.
    const answer = await pageAuthority();
    if (answer.ok) return answer;
    return { ok: false, kind: failureKind(answer.reason), reason: answer.reason };
  });
}
