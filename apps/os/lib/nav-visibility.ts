// lib/nav-visibility — WHICH LINKS THE SHELL SHOWS. Presentation, resolved on the server (§28.7).
//
// ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────
//
// It is not an authorization boundary and nothing downstream may treat it as one. Every destination
// it omits still refuses the same principal when that principal requests it directly — F57 asserts
// exactly that, for every hidden destination, by issuing the real request rather than trusting this
// module. If F57 ever fails, the defect is at the destination, and hiding the link is not the fix.
//
// ─── WHY IT LIVES IN `lib/` AND NOT IN THE LAYOUT ──────────────────────────────────────────────
//
// F54 governs all of `app/` (except `app/api/`) and all of `components/`: nothing on that surface
// may reference the decision surface — `can()`, `capabilitiesFor`, `pageAuthority`, the capability
// table, the principal constructor. `app/layout.tsx` is on that surface.
//
// That rule is not being routed around. It exists so a PAGE cannot decide access, and this module
// decides no access: it answers "what should the rail draw?", the answer is a list of strings, and
// every one of those destinations authorizes itself independently. The layout asks a presentation
// question and receives presentation data — it never learns the principal, the role, or the
// capabilities, and so it still cannot authorize anything even by accident.
//
// ─── IT FAILS TO EMPTY, WHICH IS THE SAFE DIRECTION FOR A RAIL ─────────────────────────────────
//
// No session, no membership, a database outage: no links. A rail that rendered everything when
// resolution failed would be the one failure mode worth avoiding here — not because the links grant
// anything, but because the shell would then be showing an unauthenticated visitor the shape of the
// system.

import "server-only";
import { capabilitiesFor } from "@/core/auth/capabilities";
import { NAV_DESTINATIONS } from "@/navigation/destinations";
import { pageAuthority } from "@/lib/page-principal";

/**
 * The hrefs this render's principal should see, in table order.
 *
 * Returns hrefs rather than destinations so the client component receives the smallest possible
 * fact: a set of strings it may draw. It gets no capabilities, no role and no principal, and there
 * is therefore nothing in the browser bundle that could be mistaken for an authorization input.
 */
export async function visibleDestinations(): Promise<string[]> {
  const authority = await pageAuthority();
  if (!authority.ok) return [];

  const held = new Set<string>(capabilitiesFor(authority.principal));
  return NAV_DESTINATIONS
    .filter((d) => d.requires.every((c) => held.has(c)))
    .map((d) => d.href);
}
