// core/auth/capabilities — WHAT A ROLE MAY DO, stated once.
//
// ─── CAPABILITIES, NOT ROLES, AT THE CALL SITE ─────────────────────────────────────────────────
//
// Routes ask "may this principal do X?", never "is this principal an owner?". The difference is not
// stylistic: with roles at the call site, adding a third role means editing 27 route files and
// getting all 27 right. With capabilities, a role is DEFINED by composition here, and the routes do
// not change at all.
//
// ─── DENY BY DEFAULT ───────────────────────────────────────────────────────────────────────────
//
// A capability absent from a role's set is denied. There is no wildcard, no inheritance chain, and
// no "owner can do anything" shortcut — `owner` is spelled out below, so a new capability is denied
// to EVERYONE until somebody grants it deliberately. The failure mode of forgetting is locked out,
// never silently exposed.
//
// ─── THIS IS THE SECOND BARRIER, NOT THE ONLY ONE ──────────────────────────────────────────────
//
// The database enforces the same boundary independently: `ascend_sales` holds no grant on
// `prospects.slug`, `prospect_id`, `identity_state`, `hold_reason`, `source`, `website` or
// `website_quality`, and RLS scopes every row to the principal's organization. A bug in this file
// cannot open the database; a bug in the database cannot be reached past this file. Two barriers,
// neither standing in for the other.

import "server-only";
import type { MembershipRole } from "@/domain";
import type { ResolvedPrincipal } from "./principal";

/**
 * Every capability in the system. Adding a member here denies it to every role until it is listed
 * below — the fail-closed direction.
 *
 * The `:*` suffix is part of the name, not a pattern: nothing here does prefix matching. It reads as
 * "the whole of clients" because that is the granularity 2F chose, and a finer split later is a new
 * capability rather than a change to how matching works.
 */
export type Capability =
  | "prospects:read"
  | "prospects:write"
  | "prospects:identity"
  | "pipeline:read"
  | "pipeline:write"
  | "clients:*"
  | "finance:*"
  | "documents:*"
  | "time:*"
  | "portal:admin"
  | "admin:*"
  | "production:read"
  | "production:toggle"
  | "audits:*"
  | "import:run"
  | "promote"
  | "search"
  // ─── NOT IN §8, AND NAMED HERE RATHER THAN INHERITED ─────────────────────────────────────────
  //
  // §8 maps ROUTES, and no route serves SOPs. But the knowledge index carries three entity kinds —
  // client, prospect, sop — and §9 requires search results to be filtered at assembly, which forces
  // a decision about the third. Letting SOPs ride on some other capability would be a mapping
  // nobody chose; leaving them ungated would be authorization-by-absence, which F49 forbids.
  //
  // So it is named, and it is owner-only, because fail-closed is the reviewable direction: the SOP
  // library is internal operating material and may reference clients by name. Widening it to sales
  // later is one line and a decision; discovering it was never gated is an incident.
  | "sops:read";

// `production:read` is separate from `production:toggle` deliberately. Project state is protected
// data, and a READ must not inherit authorization from a WRITE capability — the same failure shape
// as a DELETE route inheriting `prospects:write` because of where it sat in the path (2F §7.4).

export const CAPABILITIES: readonly Capability[] = [
  "prospects:read", "prospects:write", "prospects:identity",
  "pipeline:read", "pipeline:write",
  "clients:*", "finance:*", "documents:*", "time:*",
  "portal:admin", "admin:*", "production:read", "production:toggle", "audits:*",
  "import:run", "promote", "search", "sops:read",
] as const;

/**
 * The map from STAGE2F §8, transcribed rather than summarised.
 *
 * `owner` is enumerated deliberately instead of being "everything": a new capability must be
 * granted on purpose, and reading this table must never require knowing a rule that lives elsewhere.
 */
const ROLE_CAPABILITIES: Record<MembershipRole, readonly Capability[]> = {
  owner: [
    "prospects:read", "prospects:write", "prospects:identity",
    "pipeline:read", "pipeline:write",
    "clients:*", "finance:*", "documents:*", "time:*",
    "portal:admin", "admin:*", "production:read", "production:toggle", "audits:*",
    "import:run", "promote", "search", "sops:read",
  ],
  // ─── 2G.4.7 · THE PARTNER IS A TRUSTED BUSINESS OPERATOR, NOT A NARROW SALESPERSON ───────────
  //
  //     OWNER          full business access + administrative/security management
  //     SALES PARTNER  full business access, and nothing administrative
  //
  // This row WIDENED on 2026-09-02, and it is the first widening of a security boundary in Stage 2G
  // — every prior slice tightened one. Recorded at length because a widening reasoned about after
  // the fact is indistinguishable from one nobody noticed.
  //
  // WHAT CHANGED THE ANSWER: the business model, not the architecture. There is exactly ONE sales
  // partner and he is a business operator. The earlier set answered a question nobody was asking —
  // how to confine one salesperson among several — and the narrowness cost real access without
  // protecting anything, because a partner who may read the pipeline and may not read the clients it
  // converts into cannot do the job the pipeline exists for.
  //
  // WHAT THIS IS NOT. It is not a new role, not a relationship-permission model, and not row-level
  // authorization. `prospects.assigned_to` was audited and deliberately NOT made an authorization
  // boundary — it has no writer, no policy references it, and `ascend_sales` holds UPDATE on it, so
  // making it load-bearing would have been authorization the subject controls. That audit is why
  // this row is a capability list and not a mechanism.
  //
  // THREE ENTRIES WERE JUDGMENT CALLS, decided explicitly rather than by their names:
  //
  //   portal:admin        READS like administration and is not. It is the operator half of the
  //                       CLIENT portal — issuing client invite tokens, reading approval requests —
  //                       and it is REQUIRED to render `/`, `clients/[slug]` and
  //                       `clients/[slug]/project`. Withholding it would have denied the partner the
  //                       home surface over a naming collision.
  //   promote             Its old exclusion note read "turning a prospect into a client creates a
  //                       client". True, and no longer a reason: the partner owns clients too.
  //   prospects:identity  NOT identity anchoring, despite the name — `core/auth/routes.ts` maps it
  //                       to prospect DELETION, and that mapping's own note says "if the intent was
  //                       that a partner may delete a prospect, one line changes." It was intended.
  //
  // THE BOUNDARY IS NOW ONE CAPABILITY. `admin:*` is withheld and everything else is granted, so
  // this row is `owner` minus exactly one entry — ASSERTED as such, not left as a list two readers
  // must diff by eye: `tests/auth/dal-boundary.test.ts` ("THE BOUNDARY IS ONE CAPABILITY WIDE") and
  // `tests/auth/landing.test.ts` ("the roles still DIFFER, by exactly one capability") each derive
  // the difference from this table and name it. A capability added to
  // `owner` later reaches the partner automatically unless it is deliberately withheld, which is the
  // correct default for a business capability and a FAILING TEST for an administrative one.
  sales: [
    "prospects:read", "prospects:write", "prospects:identity",
    "pipeline:read", "pipeline:write",
    "clients:*", "finance:*", "documents:*", "time:*",
    "portal:admin", "production:read", "production:toggle", "audits:*",
    "import:run", "promote", "search", "sops:read",
  ],
};

/** Everything this principal may do. A copy, so a caller cannot edit the table by holding it. */
export function capabilitiesFor(principal: ResolvedPrincipal): Capability[] {
  return capabilitiesForRole(principal.role);
}

/**
 * The table, read by ROLE rather than by principal. Added 2G.4.7 so the capability table can be the
 * single source of truth for tests that must not fabricate a principal to read it.
 *
 * ─── IT CONFERS NOTHING, AND THAT IS WHY IT IS SAFE TO EXPORT ──────────────────────────────────
 *
 * It returns a LIST. `can()` still takes a branded `ResolvedPrincipal`, so no authorization decision
 * anywhere can be reached through this function — reading which capabilities a role would hold is
 * not the same act as holding them, and the brand still makes a forged role inexpressible.
 *
 * ─── THE DUPLICATION IT EXISTS TO DELETE ───────────────────────────────────────────────────────
 *
 * `tests/auth/page-denial` and `tests/db/page-matrix-provisioned` each carried a hand-typed
 * `SALES_HOLDS` set. Two copies of a security fact, in files whose job is to check that fact. They
 * would not have failed silently — a stale copy makes the expected-denial set too LARGE, so the
 * suites go red — but they would have gone red for the wrong reason, and a reader would have had to
 * find three lists to learn one answer. The page matrix in particular CANNOT construct a principal
 * to ask: F59 bans `__unsafePrincipalForTests` from the provisioned-partner evidence path, by
 * source-text scan. This is the seam that lets it read the table without one.
 */
export function capabilitiesForRole(role: MembershipRole): Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}

/**
 * THE authorization question.
 *
 * Takes a `ResolvedPrincipal`, which is branded — so this cannot be called with a role assembled
 * from a cookie, a header or a request body. The only way to hold one is `resolvePrincipal()`,
 * which reads `memberships`.
 */
export function can(principal: ResolvedPrincipal, capability: Capability): boolean {
  return ROLE_CAPABILITIES[principal.role].includes(capability);
}
