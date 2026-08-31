// lib/landing — WHERE AN AUTHENTICATED PERSON IS SENT, and the ONE place that decides it (§28.6).
//
// ─── ROUTING, NEVER AUTHORIZATION ──────────────────────────────────────────────────────────────
//
// A redirect is navigation. The destination enforces its own boundary, so the worst a wrong answer
// here can produce is a denial the person can see — never access they should not have. `/` is
// deliberately NOT modified to redirect by role: it keeps denying what it denies, and its denial is
// the fallback if this seam is ever bypassed.
//
// ─── THE AUTHORITY IS EXPLICIT, BECAUSE INHERITED CONTEXT DOES NOT EXIST HERE ──────────────────
//
// §28.6 requires this seam to name where its authority comes from. It takes a `ResolvedPrincipal` —
// one the database vouched for, resolved by the caller from a freshly authenticated `user_id`. It
// reads no cookie, consults no ambient store, and cannot be called with a role someone asserted:
// the type is branded and unforgeable outside `core/auth/principal`.
//
// Slice 1 measured why that matters: a layout's `AsyncLocalStorage.run()` reads `null` in a child
// page, so "the context will have it" is not an available assumption in this codebase.
//
// ─── NO ROLE NAMES ─────────────────────────────────────────────────────────────────────────────
//
// The choice is made from CAPABILITIES against the declared landing order. An owner lands on `/`
// because they hold what `/` demands; a partner lands on `/partner` for the same reason. Adding a
// third role changes nothing here, which is the property `core/auth/capabilities` exists to give.

import "server-only";
import { capabilitiesFor } from "@/core/auth/capabilities";
import type { ResolvedPrincipal } from "@/core/auth/principal";
import { LANDING_ORDER, NAV_DESTINATIONS } from "@/navigation/destinations";

/**
 * The first landing destination this principal can actually use.
 *
 * Falls back to `/` when nothing matches — a VISIBLE denial rather than a guess. Sending someone to
 * a page they can use is a convenience; inventing a destination for them would be this seam
 * pretending to know something it does not.
 */
export function landingFor(principal: ResolvedPrincipal): string {
  const held = new Set<string>(capabilitiesFor(principal));
  for (const href of LANDING_ORDER) {
    const destination = NAV_DESTINATIONS.find((d) => d.href === href);
    if (destination && destination.requires.every((c) => held.has(c))) return href;
  }
  return "/";
}
