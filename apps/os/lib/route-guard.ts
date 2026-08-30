// lib/route-guard — THE ONE PLACE A ROUTE BECOMES AUTHORIZED.
//
// ─── THE ORDER IS THE POINT ────────────────────────────────────────────────────────────────────
//
//   session cookie → verified signature → user_id → membership → ResolvedPrincipal
//     → AsyncLocalStorage context → capability check → handler → RLS
//
// Every link is here, in that order, once. A route that wants to authorize cannot skip a step,
// because it never sees the intermediate values: it hands over a capability and a handler and gets
// back a Response.
//
// ─── WHY NOT MIDDLEWARE ────────────────────────────────────────────────────────────────────────
//
// `middleware.ts` AUTHENTICATES and cannot do more. It runs in the Edge runtime, which has no
// database, and role resolution requires reading `memberships`. Authorizing there would mean
// trusting something the request carried — the exact defect 2F removes. So the perimeter answers
// "is this a valid session?" and this guard answers "may this person do this?", and the second
// question is answered where the answer can be looked up rather than believed.
//
// ─── WHY THE HANDLER RUNS INSIDE THE CONTEXT ───────────────────────────────────────────────────
//
// So that `listProspects()` and its nine consumers reach the right principal without any of them
// learning what a principal is. The handler also receives it explicitly, for its own decisions.
//
// ─── FAILURES SAY LITTLE, AND SAY IT CONSISTENTLY ──────────────────────────────────────────────
//
// 401 for "we do not know who you are", 403 for "we know, and no". Never a redirect and never an
// empty 200: an empty 200 is indistinguishable from "the data happens to be missing", which is the
// authorization-by-absence F49 exists to forbid. The reason for a denial is logged, never returned.

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { withRequestContext } from "@/lib/request-context";
import { can, type Capability } from "@/core/auth/capabilities";
import type { ResolvedPrincipal } from "@/core/auth/principal";

/**
 * Read the session cookie off a plain `Request`.
 *
 * Deliberately not `NextRequest.cookies`: the guard must work against an ordinary `Request`, so the
 * security suite can issue real requests to these handlers without a running server.
 */
export function sessionTokenFrom(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

const unauthenticated = () => NextResponse.json({ error: "authentication required" }, { status: 401 });
const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

/**
 * Run `handler` only if the caller holds `capability`.
 *
 * `capability` is a compile-time union, so a typo is a build error rather than a route that
 * authorizes against a capability nobody has — which would look like a working denial.
 */
export async function authorize(
  req: Request,
  capability: Capability,
  handler: (principal: ResolvedPrincipal) => Promise<Response>
): Promise<Response> {
  const outcome = await withRequestContext(sessionTokenFrom(req), async (principal) => {
    // INSIDE the context: the capability check and the handler see the same principal, and no
    // window exists between deciding and acting in which the principal could change.
    if (!can(principal, capability)) {
      // Logged with the capability, never returned with it: a 403 that names what was missing is a
      // map of the system for whoever is probing it.
      console.warn(`[authz] denied ${principal.role} → ${capability}`);
      return forbidden();
    }
    return handler(principal);
  });

  if (outcome.ok) return outcome.value;
  console.warn(`[authz] no context (${outcome.reason})`);
  return unauthenticated();
}
