// lib/request-context — THE TRUST BOUNDARY. Where a signed session becomes an authority.
//
// ─── WHY IT LIVES IN lib/ AND NOT IN core/auth/ ────────────────────────────────────────────────
//
// It is a composition across two layers: `lib/auth` (the perimeter, which verifies a signature and
// nothing else) and `core/auth` (which resolves authority from the database). `lib` depends on
// `core` throughout this codebase and `core` never depends on `lib`; putting this function in `core`
// would have inverted that for one import.
//
// ─── THE FOUR LINKS, IN ORDER, WITH NO SHORTCUT ────────────────────────────────────────────────
//
//   1. signed session      → a user_id, and NOTHING else the token asserts
//   2. membership lookup   → organization_id and role, read from the database per request
//   3. ResolvedPrincipal   → branded, therefore unforgeable outside core/auth/principal
//   4. AsyncLocalStorage   → the principal propagates; it is never re-derived downstream
//
// Anything that skips a link is a defect, not a shortcut. In particular this function CANNOT be
// given a role: there is no parameter for one, and `ResolvedPrincipal` cannot be constructed here.
//
// ─── WHY IT TAKES A TOKEN RATHER THAN A REQUEST ────────────────────────────────────────────────
//
// Cookie extraction is framework-specific; authority is not. Route handlers read
// `req.cookies.get(SESSION_COOKIE)` and pass the value. That also makes the boundary directly
// testable without a running server, which is what the concurrency proof needs.
//
// ─── ONE CONNECTION PER REQUEST ────────────────────────────────────────────────────────────────
//
// The lease is held for the whole request and released when it ends. `asPrincipal` binds identity
// with `SET LOCAL`, scoped to a transaction on that connection — so identity cannot outlive the
// request even if the connection is immediately handed to another one.
//
// FAIL CLOSED IN EVERY DIRECTION: an absent, malformed, expired, forged or unconfigured session; a
// user who does not exist, has no membership, has more than one, or is disabled. Each returns a
// denial. None returns a principal, and none falls through to a default.

import "server-only";
import { readAuthConfig, verifySessionToken } from "@/lib/auth";
import { requireAppDb } from "@/core/auth/connection";
import { resolvePrincipal, type ResolutionFailure, type ResolvedPrincipal } from "@/core/auth/principal";
import { runInRequestContext } from "@/core/auth/context";

/** Why a request established no context. Never surfaced verbatim — a caller learns only "denied". */
export type ContextDenial = "unauthenticated" | ResolutionFailure;

export type ContextOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ContextDenial };

/**
 * Establish the request context for `token`, run `fn` inside it, tear it down.
 *
 * `fn` receives the principal explicitly AND can reach it through `requirePrincipal()` anywhere in
 * its call tree. The explicit parameter is for the route's own authorization decision; the store is
 * for the thirteen consumers that must not learn about identity to keep working.
 */
export async function withRequestContext<T>(
  token: string | undefined,
  fn: (principal: ResolvedPrincipal) => Promise<T>
): Promise<ContextOutcome<T>> {
  const identity = await verifySessionToken(token, readAuthConfig());
  if (!identity) return { ok: false, reason: "unauthenticated" };

  return requireAppDb()(async (client) => {
    // PER REQUEST, deliberately. A revoked membership or a disabled user takes effect on the very
    // next request — no session invalidation, no token blacklist, no waiting for a 12-hour expiry.
    const resolution = await resolvePrincipal(client, identity.userId);
    if (!resolution.ok) return { ok: false, reason: resolution.reason };

    const value = await runInRequestContext(
      { principal: resolution.principal, db: client },
      () => fn(resolution.principal)
    );
    return { ok: true, value };
  });
}
