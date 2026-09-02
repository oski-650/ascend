// components/auth/renderOrDenied — HOW A PAGE COPES WITH A REFUSAL IT DID NOT MAKE.
//
//   > The page may decide how to respond to denial. It may never decide that denial should occur.
//
// ─── WHY THIS IS NOT THE `authorizeEverything()` WRAPPER THAT WAS RULED OUT ─────────────────────
//
// It accepts no capability, resolves no principal, reads no data-access layer, and reaches no
// authority. Its only inputs are a subtree and a label, and its only decision is which of several
// ALREADY-THROWN values it recognises. Authorization still happens exactly where slice 2 put it —
// inside the data functions, at `requireCapability`. Coping can be shared; deciding cannot.
//
// ─── WHY THE SERVER, AND NOT `app/error.tsx` ───────────────────────────────────────────────────
//
// Not a preference. `next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:111`:
//
//   > "Errors forwarded from Server Components show a generic message with an identifier. This is
//   >  to prevent leaking sensitive details."
//
// The client boundary receives a redacted message and a digest, so in production it CANNOT tell a
// denial from an outage. `catchError` is also a client boundary and inherits the limitation, and
// `forbidden()` still requires `experimental.authInterrupts` — measured in STAGE2G §9 spike 3 as a
// 500 without it, and an experimental flag does not belong on the authorization path.
//
// ─── `unstable_rethrow` IS FIRST, AND THAT ORDERING IS LOAD-BEARING ────────────────────────────
//
// `notFound()`, `redirect()` and `permanentRedirect()` work by THROWING, as do request-time APIs
// under some segment configurations. A catch that does not rethrow them turns every missing
// document into a denial page. Five of the thirteen wrapped pages throw one of these inside the
// region this handler wraps, so it is a live hazard rather than a precaution.
//
// ─── IT RECOGNISES ONE THING, BY TYPE ──────────────────────────────────────────────────────────
//
// Only `CapabilityDenied` — the refusal of a caller who IS identified — becomes a denial surface.
// Matching on an error message was considered and rejected: any unrelated failure could imitate the
// text, and a denial page shown for a parser bug is the same lie as the vault message this replaces,
// inverted.
//
// ─── IT NOW RECOGNISES TWO THINGS, STILL BY TYPE (2G.4.5, §29.3 Ruling 3) ──────────────────────
//
// `NoAuthority` was NOT converted, as a class, and the reasoning stood: it covers an outage, an
// unbound resolver, and a caller nobody could identify — none of which is a permission decision, and
// reporting an unreachable database as "you don't have access" is the dangerous direction. §22's
// first draft routed its authentication reasons to `/login`; that is not implemented, because
// `middleware.ts` already redirects an unauthenticated page request before a render begins, so a
// redirect from here could only fire for a caller who HOLDS a valid cookie — which is a login loop.
//
// The defect was a conflation IN THE TYPE, not in the refusal. `AccountRefused` — a SUBCLASS of
// `NoAuthority` — names the half where the database ANSWERED and the answer denies this person, and
// only that half becomes a surface. The outage and the unbound resolver are still rethrown,
// unchanged, and `page-denial.test.ts`'s two controls are what prove it: if this handler ever caught
// `NoAuthority` wholesale again, they fail.
//
// Order matters below and is asserted, not assumed: `AccountRefused` is checked BEFORE
// `CapabilityDenied`. They are disjoint classes today, so the ordering costs nothing and forecloses
// the reading where a future common ancestor makes the first match win.

import "server-only";
import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { AccountRefused, CapabilityDenied } from "@/core/auth/authority";
import { AccountInactive } from "./AccountInactive";
import { Denied } from "./Denied";

/**
 * Render `view`, or — if authority refused this caller — the denial surface instead.
 *
 * `area` is a human label for the copy ("Finance"). It is not a capability, it is not consulted for
 * any decision, and it never appears in a log line that could be used to enumerate the system.
 */
export async function renderOrDenied(area: string, view: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await view();
  } catch (e) {
    // FIRST. Framework control flow is not an error and must never be classified.
    unstable_rethrow(e);

    if (e instanceof AccountRefused) {
      // The REASON goes to the SERVER LOG and nowhere else — revoked, unmembered, ambiguous and
      // unknown render identically, so the page is not an enumeration oracle.
      console.warn(`[account-refused] ${area}: ${e.reason}`);
      return <AccountInactive />;
    }

    if (e instanceof CapabilityDenied) {
      // The detail goes to the SERVER LOG and nowhere else. The rendered page names nothing.
      console.warn(`[page-denial] ${area}: role ${e.role} does not hold ${e.capability}`);
      return <Denied area={area} />;
    }

    // Everything else is a real failure and belongs to the error boundary, unchanged.
    throw e;
  }
}
