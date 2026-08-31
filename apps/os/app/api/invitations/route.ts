// app/api/invitations — ISSUING an invitation. The authorized half of the pair (2G.3, STAGE2G §28.4).
//
// ─── READ THIS BESIDE `accept/route.ts`, WHICH SAYS THE OPPOSITE ON PURPOSE ────────────────────
//
//   ACCEPT   unauthenticated · the TOKEN is the authority · every failure looks identical
//   MINT     authenticated owner · a CAPABILITY is the authority · failures are distinguishable
//
// The asymmetry is deliberate and §28.4 requires it to be stated here, because it looks like an
// inconsistency and a future reader will otherwise "standardize" the two endpoints.
//
// Accept collapses unknown, expired, consumed and malformed into ONE response because an
// unauthenticated stranger could otherwise enumerate tokens. This route is reached by an
// authenticated owner acting inside their own organization: there is no token to enumerate, and the
// caller already knows who is in their own tenant — the directory listing tells them. Uniform
// refusal here would buy nothing and would leave the operator unable to tell "no such user" from
// "the database is down".
//
// ─── THE ORGANIZATION IS NEVER READ FROM THE BODY ──────────────────────────────────────────────
//
// It comes from the principal, which the database vouched for. A body-supplied organization would
// either be refused by `invitations_owner_issues` or — worse, if it happened to match — would be an
// authorization fact taken from the request, which is the defect 2F removed.
//
// ─── THE ROUTE IS TRANSPORT. THE BOUNDARY IS IN `core/auth/directory`. ─────────────────────────
//
// F41 forbids `app/` from importing `@/core/db`, and that rule is why the transaction lives in core
// rather than here: a route that opened its own transaction would be a second place where "run as
// this principal" is spelled out. `issueInvitationFor` authorizes, checks membership and inserts
// inside ONE transaction as ONE principal, and this file turns the outcome into a status code.
//
// ─── THE MEMBERSHIP CHECK IS LOAD-BEARING, NOT VALIDATION ──────────────────────────────────────
//
// §28.13 records the measurement in full: `006`'s credential-write policy does not mention
// organizations, so an invitation naming a user from ANOTHER tenant would be inserted (its own
// organization column matches `current_org()`) and accepting it would set that user's password.
//
// Under §28.13 Path B the predicate lives INSIDE `createInvitation`'s INSERT, so the database
// evaluates it as part of the write. This route does not check membership and must not start: a
// second check here would be a second place to get it wrong, and would reintroduce the
// check-then-write shape Path B exists to remove. It maps the refusal to a status code.
//
// ─── THE TOKEN EXISTS ONCE, HERE ───────────────────────────────────────────────────────────────
//
// Only `token_hash` reaches the table. This response is the single moment the plaintext exists
// outside the operator's clipboard, so it is never logged, never put in an error, and never placed
// in a URL something upstream might record.

import { NextResponse } from "next/server";
import { authorize } from "@/lib/route-guard";
import { issueInvitationFor } from "@/core/auth/directory";
import { InvitationTargetRefused } from "@/core/auth/invitations";

export const dynamic = "force-dynamic";
// `createInvitation` uses node:crypto for the token. This route must never reach the Edge runtime.
export const runtime = "nodejs";

/**
 * ONE HOUR, and the number is a security control rather than a convenience.
 *
 * §28.3: `ascend_owner` holds no UPDATE on `invitations`, so a live invitation CANNOT be revoked
 * without a migration — which 2G.3 may not add. Multiple live invitations per user are therefore
 * permitted, and the TTL is the only thing that ends one early. Lengthening it widens that window;
 * that is the trade being made here, in the open.
 */
const INVITATION_TTL_MS = 60 * 60 * 1000;

/**
 * Canonical UUID syntax. SYNTAX ONLY — this decides nothing about authorization.
 *
 * Without it a non-UUID reached `$2::uuid` and Postgres raised `invalid input syntax for type uuid`,
 * which took ordinary bad input down the OUTAGE path: a 500, and the caller's raw string copied into
 * a server log line by the error message. Measured during the §28 evidence review.
 *
 * It is NOT a reinstated membership check. It never touches `memberships`, never queries anything,
 * and cannot answer whether the target exists — so the check-then-write shape §28.13 Path B removed
 * stays removed. The membership predicate remains inside the INSERT, where the database evaluates it.
 *
 * 404 is still reserved for the indistinguishable cases: a well-formed id naming somebody in another
 * organization and a well-formed id naming nobody answer identically, which the review verified.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  return authorize(request, "admin:*", async () => {
    let userId = "";
    try {
      const body = (await request.json()) as { userId?: unknown };
      userId = typeof body.userId === "string" ? body.userId.trim() : "";
    } catch {
      return NextResponse.json({ error: "malformed request body" }, { status: 400 });
    }
    if (userId.length === 0) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!UUID.test(userId)) {
      // Malformed input is the CALLER's error, not an outage. 400, and nothing is logged: the
      // rejected string is attacker-controlled and has no business in a durable file.
      return NextResponse.json({ error: "userId must be a uuid" }, { status: 400 });
    }

    try {
      const issued = await issueInvitationFor(userId, INVITATION_TTL_MS);

      // The token, exactly once. `id` is returned so the operator's UI can distinguish two links
      // minted for the same person; `expiresAt` so the UI can say when this one stops working.
      return NextResponse.json(
        { token: issued.token, id: issued.id, expiresAt: issued.expiresAt },
        { status: 201 }
      );
    } catch (e) {
      if (e instanceof InvitationTargetRefused) {
        // Safe to distinguish: the caller can already list their own organization's members.
        return NextResponse.json({ error: "not a member of this organization" }, { status: 404 });
      }
      // The message is logged, never returned — and it cannot contain a token, because the failure
      // happened before one was returned or after it was already discarded.
      console.error(`[invitations] mint failed: ${(e as Error).message}`);
      return NextResponse.json({ error: "invitation could not be issued" }, { status: 500 });
    }
  });
}
