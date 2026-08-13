// middleware.ts — the operator authentication PERIMETER (hardening pass).
//
// SCOPE: a request-level gate, not an architectural layer. It introduces no engine, no read-model,
// no derivation, no scoring, no ranking, and no persistence, and it does not participate in any
// frozen contract. It only decides: does this request carry a valid operator session?
//
// POSTURE: DENY BY DEFAULT. Everything is protected unless it appears in PUBLIC_PATHS below. A new
// route added later is therefore protected automatically — the failure mode of forgetting to update
// this file is "locked out", never "silently exposed".
//
// FAIL CLOSED: if ASCEND_OS_PASSWORD / ASCEND_OS_SESSION_SECRET are unset, the perimeter cannot
// verify anyone, so it denies rather than allowing (see readAuthConfig / configured:false).
//
// CLIENT PORTAL: the portal is authenticated by its own invite token (lib/portal.findInviteByToken)
// and must stay reachable by clients who have no operator password. Those paths are public HERE and
// enforce their own token check in the handler. The distinction is deliberate and load-bearing:
//   PUBLIC  — /portal/*, /api/portal/{me,approvals,submissions}   (client-facing, token-authenticated)
//   OPERATOR— /api/portal/{invites,approval-requests}             (mints tokens / creates requests)
// `/api/portal/invites` in particular issues valid portal tokens for any client, so leaving it public
// would let anyone mint client-portal access. It is protected.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readAuthConfig, verifySessionToken } from "@/lib/auth";

/** Exact paths and prefixes reachable WITHOUT an operator session. */
const PUBLIC_EXACT = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/portal/me",
  "/api/portal/approvals",
  "/api/portal/submissions",
]);

/** Prefixes reachable WITHOUT an operator session (client portal pages). */
const PUBLIC_PREFIXES = ["/portal/"] as const;

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const config = readAuthConfig();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifySessionToken(token, config);

  if (authenticated) return NextResponse.next();

  // Unauthenticated. APIs get a machine-readable 401; pages get redirected to the login form.
  // Neither response discloses whether the perimeter is unconfigured vs. the session merely invalid.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  // Preserve the intended destination so login can return the operator there.
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets. Deny-by-default depends on this
  // matcher being broad: narrowing it is how routes silently become unprotected.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};