// app/api/invitations/accept — THE ONE CONTRACTED UNAUTHENTICATED WRITE (2G.2, STAGE2G §27).
//
//   > Invitation acceptance is an explicit unauthenticated capability, not a disguised authenticated
//   > request.
//
// PUBLIC BY NECESSITY AND BY DECLARATION. The caller has no session — that is the entire point: they
// are here to establish the credential a session would later be minted from. So this route is listed
// `kind: "public"` in `core/auth/routes`, and F46/F49 hold it to that declaration.
//
// ─── IT AUTHORIZES NOTHING, AND CANNOT ─────────────────────────────────────────────────────────
//
// There is no `authorize()` here because there is no principal to authorize. The authority is the
// DATABASE role `ascend_invite`, assumed inside the acceptance transaction and released with it. It
// is not a principal: it has no `ResolvedPrincipal`, cannot be resolved into one, and satisfies no
// `requireCapability` call. Membership remains the only source of application authority, and
// accepting an invitation creates none — the user and their membership already exist.
//
// ─── EVERY FAILURE LOOKS THE SAME ──────────────────────────────────────────────────────────────
//
// Unknown, expired, consumed and malformed tokens produce ONE response. The database returns zero
// rows from a single predicate for all four, and `acceptInvitation` raises one error class with one
// message, so there is no branch here that could tell them apart. Same posture as `/api/auth/login`.

import { NextResponse } from "next/server";
import { requireAppDb } from "@/core/auth/connection";
import { acceptInvitation } from "@/core/auth/invitations";

export const dynamic = "force-dynamic";

/** One body, one status, for every rejected reason. */
const refused = () => NextResponse.json({ error: "invitation refused" }, { status: 400 });

export async function POST(request: Request): Promise<Response> {
  let token = "";
  let password = "";
  try {
    const body = (await request.json()) as { token?: unknown; password?: unknown };
    token = typeof body.token === "string" ? body.token : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return refused();
  }

  // A password too short to hash is refused HERE with the same body — `hashPassword` throws a
  // descriptive error, and letting that reach the caller would separate "bad password" from
  // "bad token" into two distinguishable outcomes.
  if (token.length === 0 || password.length < 12) return refused();

  try {
    const lease = requireAppDb();
    await lease((client) => acceptInvitation(client, token, password));
  } catch {
    // Deliberately undifferentiated: a refused invitation, an outage and a hash failure are one
    // response. The server log carries the detail; the caller learns only that it did not work.
    return refused();
  }

  // No session is minted. Accepting establishes a credential; signing in is a separate act through
  // the existing perimeter, so a stolen token cannot be traded directly for a live session.
  return NextResponse.json({ ok: true }, { status: 200 });
}
