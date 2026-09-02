// navigation/destinations — THE DECLARED NAVIGATION SURFACE (2G.3, STAGE2G §28.7).
//
// ─── THIS TABLE DECIDES WHAT IS SHOWN. IT DECIDES NOTHING ABOUT ACCESS. ────────────────────────
//
//     navigation filtering  =  presentation
//     PAGE_AUTHORIZATION    =  authorization
//
// §28.7 forbids conflating them, and F57 is the control that keeps the distinction true after
// somebody edits this file: every destination hidden from a role must still REFUSE that role when
// requested directly. A rail that hides `/finance` while `/finance` would have served it is worse
// than the rail this replaces, because it converts a visible denial into an invisible one.
//
// ─── WHY `requires` IS DUPLICATED HERE AT ALL ──────────────────────────────────────────────────
//
// The authorization contract lives in `tests/architecture/page-authorization`, and nothing reads it
// at runtime — by design, since a page's authority comes from the DAL it reaches, never from a
// table. Production code cannot import from `tests/`, so presentation needs its own declaration.
//
// The duplication is made safe by being MEASURED rather than trusted: F56 asserts that every href
// here names a declared page AND that `requires` equals that page's declared capabilities exactly.
// Drift in either direction fails the gate, so this table cannot quietly diverge into a second,
// more permissive opinion about what a role may reach.
//
// ─── `/admin` WAS DELIBERATELY VISIBLE TO SALES, UNTIL THE PAGE WAS FIXED (2G.4.4) ─────────────
//
// It declared `[]`, so `requires` was `[]`, so everyone saw it — parked finding 1, kept visible on
// purpose by §28.2 ruling 5, because hiding the link would have made the rail look correct while the
// route stayed exactly as reachable. The honest state was a visible link to a page that should have
// been guarded and was not.
//
// 2G.4.4 guarded the page, so the link is hidden for the ONLY admissible reason: the destination now
// refuses. That ordering is the whole point and F57 is what keeps it true — every destination this
// table hides from a role must still REFUSE that role on a direct request. Concealment first would
// have failed that rule; it is not a route this repository leaves open.

import type { Capability } from "@/core/auth/capabilities";

export type NavDestination = {
  /** The URL. `PAGE_AUTHORIZATION` keys it without the leading slash; `/` keys as `/`. */
  readonly href: string;
  readonly label: string;
  /** The rail's visual grouping. Presentation only; carries no authorization meaning. */
  readonly group: string;
  /**
   * The capabilities the DESTINATION PAGE demands, transcribed from its declared contract.
   *
   * A principal holding all of them sees the link. Holding them is also, separately, what lets the
   * page render — but that is the page's own boundary reaching its own DAL, not this array.
   */
  readonly requires: readonly Capability[];
};

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { href: "/", label: "Neural Core", group: "Command",
    requires: ["audits:*", "clients:*", "documents:*", "finance:*", "portal:admin",
               "production:read", "prospects:read", "search", "time:*"] },
  // 2G.3. The partner's landing surface — capability-gated, so an owner holding the superset also
  // sees it. There is no role name here, in this file or in the page.
  { href: "/partner", label: "Partner", group: "Command", requires: ["prospects:read", "search"] },

  { href: "/crm", label: "Clients", group: "Work",
    requires: ["clients:*", "finance:*", "production:read", "time:*"] },
  { href: "/production", label: "Production", group: "Work", requires: ["production:read", "time:*"] },
  { href: "/sales", label: "Pipeline", group: "Work", requires: ["prospects:read"] },
  { href: "/tasks", label: "Tasks", group: "Work",
    requires: ["finance:*", "production:read", "time:*"] },

  { href: "/signals", label: "Signals", group: "Intelligence",
    requires: ["production:read", "prospects:read", "time:*"] },
  { href: "/automations", label: "Automations", group: "Intelligence", requires: ["pipeline:read"] },
  { href: "/maintenance", label: "Maintenance", group: "Intelligence", requires: ["audits:*", "finance:*"] },

  { href: "/documents", label: "Documents", group: "Knowledge", requires: ["clients:*", "documents:*"] },
  { href: "/console", label: "Console", group: "Knowledge", requires: ["prospects:read", "search"] },

  { href: "/finance", label: "Invoices", group: "Finance",
    requires: ["clients:*", "finance:*", "prospects:read"] },

  // 2G.4.4 — moved from `[]` together with `PAGE_AUTHORIZATION["admin"]`, which F56 holds it equal
  // to. `/admin/import` and `/admin/wipe` are not destinations; they are reached from this page, and
  // they demand `admin:*` in their own right.
  { href: "/admin", label: "Admin", group: "System", requires: ["admin:*"] },
  // 2G.3 §28.4 — the owner's minting surface. It reaches a guarded reader, so it demands `admin:*`
  // and denies a sales principal for the ordinary reason.
  { href: "/admin/invitations", label: "Invitations", group: "System", requires: ["admin:*"] },
];

/** The rail's group order. Presentation; a group with no visible destination is not rendered. */
export const NAV_GROUP_ORDER: readonly string[] = [
  "Command", "Work", "Intelligence", "Knowledge", "Finance", "System",
];

/**
 * WHERE AN AUTHENTICATED PRINCIPAL LANDS, in preference order (§28.6).
 *
 * Capability-aware ROUTING, never authorization: the destination enforces its own boundary, and if
 * this list ever chose wrongly the result is a denial the person can see, not access they should not
 * have. There is no role name here — an owner lands on `/` because they hold what `/` demands, and a
 * partner lands on `/partner` for exactly the same reason.
 */
export const LANDING_ORDER: readonly string[] = ["/", "/partner"];

/** `PAGE_AUTHORIZATION` key for an href. `/` stays `/`; everything else drops the leading slash. */
export function pageKeyFor(href: string): string {
  return href === "/" ? "/" : href.replace(/^\//, "");
}
