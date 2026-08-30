// lib/page-principal — WHO IS RENDERING THIS PAGE. The Server Component half of the trust chain.
//
// ─── WHY THIS IS NOT `lib/request-context` ─────────────────────────────────────────────────────
//
// `withRequestContext` works because a route handler is a function the framework calls with the
// request: wrapping it in `AsyncLocalStorage.run()` puts the handler and everything it awaits inside
// one async execution tree. Step 7.3 proved that holds under genuine concurrency.
//
// A Server Component is NOT called by its parent. React renders children itself, outside the
// parent's call stack. MEASURED in this app (STAGE2G §9, spike 1): a layout that entered an ALS
// scope and rendered `{children}` inside it produced `null` at the child page. So the mechanism that
// won 7.2/7.3 cannot carry identity between components — and a design that assumed it could would
// have failed closed at every page, which is to say failed entirely.
//
// ─── WHAT CARRIES IT INSTEAD ───────────────────────────────────────────────────────────────────
//
// `React.cache`. Also MEASURED rather than taken from the documentation (§9, spike 2): two requests
// held at a barrier INSIDE the memoized function — so overlap was a precondition of the result, not
// an assumption about it — each saw only its own cookie and received distinct memoized values. Zero
// crossover. The isolation is React's, per render pass, and there is no slot for it to leak through.
//
// The consequence that matters for cost: resolution runs ONCE per render pass no matter how many
// components or data functions ask. Ten callers, one session verification, one membership query.
//
// ─── AUTHORITY STILL COMES FROM THE DATABASE ───────────────────────────────────────────────────
//
// Identical to the route path, deliberately: the cookie names a user and asserts nothing else, and
// `resolvePrincipal` reads `memberships`. There is no parameter here through which a caller could
// supply a role, and `ResolvedPrincipal` is branded, so one cannot be fabricated even by this file.
//
// ─── FAILS CLOSED IN EVERY DIRECTION, AND SAYS WHICH ───────────────────────────────────────────
//
// Absent, malformed, forged, expired or unconfigured session; unknown, unmembered, multiply-membered
// or disabled user; database unreachable; called outside a request at all. Every one is a refusal.
// The `reason` exists for the server log and for tests — never for the response.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readAuthConfig, verifySessionToken } from "@/lib/auth";
import { requireAppDb } from "@/core/auth/connection";
import { resolvePrincipal, type ResolutionFailure, type ResolvedPrincipal } from "@/core/auth/principal";

/**
 * Why a render established no authority.
 *
 * `no-request` and `unavailable` are separated from `unauthenticated` on purpose. All three refuse
 * identically, but they are different operational events: one is a bug (a data function reached from
 * outside a request), one is an outage, one is a visitor. Collapsing them would make a database
 * outage read as "everyone suddenly logged out".
 */
export type PageDenial = "unauthenticated" | "no-request" | "unavailable" | ResolutionFailure;

export type PageAuthority =
  | { ok: true; principal: ResolvedPrincipal }
  | { ok: false; reason: PageDenial };

/** Thrown by `requirePagePrincipal`. Carries the reason for logs; never for the rendered page. */
export class PageNotAuthenticated extends Error {
  constructor(readonly reason: PageDenial) {
    super(`no page authority: ${reason}`);
  }
}

/**
 * Resolve the principal for THIS render pass. Memoized by `React.cache`.
 *
 * NEVER THROWS for an authorization reason — it returns a refusal, so a caller can decide between
 * redirecting and rendering a denial. It is the only place in the render path that reads a session.
 *
 * Outside a React render `cache` does not memoize and simply calls through, which is correct: the
 * memoization is a performance property, never a security one. Correctness here does not depend on
 * being called inside a render.
 */
export const pageAuthority = cache(async (): Promise<PageAuthority> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // `cookies()` throws outside a request scope. That is a programming error — a data function
    // reached from a background job or a build-time render — and the honest answer is "no authority
    // here", never "assume the owner".
    return { ok: false, reason: "no-request" };
  }

  const identity = await verifySessionToken(token, readAuthConfig());
  if (!identity) return { ok: false, reason: "unauthenticated" };

  let lease;
  try {
    lease = requireAppDb();
  } catch (e) {
    // An outage is not a permission decision. It refuses, loudly in the log, and does not degrade to
    // rendering anything.
    console.error(`[page-auth] database unavailable: ${(e as Error).message}`);
    return { ok: false, reason: "unavailable" };
  }

  try {
    return await lease(async (client) => {
      // PER RENDER, which is why a revoked membership or a disabled user takes effect on the next
      // page load rather than at token expiry.
      const resolution = await resolvePrincipal(client, identity.userId);
      return resolution.ok
        ? { ok: true as const, principal: resolution.principal }
        : { ok: false as const, reason: resolution.reason };
    });
  } catch (e) {
    console.error(`[page-auth] resolution failed: ${(e as Error).message}`);
    return { ok: false, reason: "unavailable" };
  }
});

/**
 * The principal for this render, or throw.
 *
 * The shape data functions will use in slice 2: a function that cannot return without authority, so
 * a caller cannot forget to check. Pages catch it, or let it reach an error boundary — what they may
 * not do is proceed.
 */
export async function requirePagePrincipal(): Promise<ResolvedPrincipal> {
  const authority = await pageAuthority();
  if (!authority.ok) throw new PageNotAuthenticated(authority.reason);
  return authority.principal;
}
