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
import { registerAuthorityResolver } from "@/core/auth/authority";
import { peekRequestContext } from "@/core/auth/context";
import { pageAuthority } from "@/lib/page-principal";

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
    return pageAuthority();
  });
}
