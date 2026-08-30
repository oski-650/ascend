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

export const CAPABILITIES: readonly Capability[] = [
  "prospects:read", "prospects:write", "prospects:identity",
  "pipeline:read", "pipeline:write",
  "clients:*", "finance:*", "documents:*", "time:*",
  "portal:admin", "admin:*", "production:toggle", "audits:*",
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
    "portal:admin", "admin:*", "production:toggle", "audits:*",
    "import:run", "promote", "search", "sops:read",
  ],
  // THE PARTNER-SAFE SET. Prospects and the pipeline, and search — but search RESULTS are scoped at
  // assembly (core/knowledge), because a capability check on the route would return a 200 full of
  // client names. `promote` is absent on purpose: turning a prospect into a client creates a client.
  sales: [
    "prospects:read", "prospects:write",
    "pipeline:read", "pipeline:write",
    "search",
  ],
};

/** Everything this principal may do. A copy, so a caller cannot edit the table by holding it. */
export function capabilitiesFor(principal: ResolvedPrincipal): Capability[] {
  return [...ROLE_CAPABILITIES[principal.role]];
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
