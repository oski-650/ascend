// core/auth/routes — THE ROUTE → CAPABILITY MAP. Total, enumerated, no wildcards.
//
// ─── WHY EVERY ROUTE IS SPELLED OUT ────────────────────────────────────────────────────────────
//
// F49 forbids authorization-by-absence, and a grouped row (`/api/time/*`) is exactly the implicit
// default it names: it decides for routes that do not exist yet, and it hides the ones that do. The
// first draft of STAGE2F §8 covered 27 routes in 16 grouped rows, and its own rule caught it.
//
// The keys are REPOSITORY PATHS, not URLs. That makes totality a set comparison against the
// filesystem rather than a judgement about whether two path patterns mean the same thing: a route
// file with no entry here fails the suite, and an entry naming no file fails it too.
//
// ─── PUBLIC IS A DECISION, NOT A GAP ───────────────────────────────────────────────────────────
//
// Five routes carry no capability, and each states WHY in the row. "Public" here never means "we
// did not get to it" — it means the route authenticates by a different credential (a password at
// login, a portal token for a client who has no operator account) and that this was chosen.
//
// ─── THE SALES COLUMN IS DOUBLE-ENTRY BOOKKEEPING ──────────────────────────────────────────────
//
// `sales` below is not consulted at runtime — `can()` is. It is recorded so the two can be checked
// against each other: F49 asserts that every row's stated verdict matches what the capability table
// actually produces. A row that says `deny` while the capability says otherwise is a mapping
// mistake, and without the second entry nothing would notice.

import "server-only";
import type { Capability } from "./capabilities";

/** What `sales` gets. `scoped` means a 200 whose CONTENTS are filtered — see §9 and core/knowledge. */
export type SalesVerdict = "allow" | "deny" | "scoped" | "n/a";

export type RouteAuthorization =
  | { kind: "capability"; capability: Capability; sales: SalesVerdict; backing: "postgres" | "vault" | "both" }
  | { kind: "public"; why: string };

/**
 * Every `app/api/**\/route.ts` in the repository. Transcribed from STAGE2F §8.
 *
 * `backing` records where the data lives, and it is load-bearing rather than documentation: F49
 * requires every `vault`-backed denial to be tested TWICE — once with the vault absent, once with it
 * present — because a route that returns nothing today because the server has no vault is not
 * authorized, it is merely empty.
 */
export const ROUTE_AUTHORIZATION: Record<string, RouteAuthorization> = {
  "app/api/admin/wipe/route.ts":
    { kind: "capability", capability: "admin:*", sales: "deny", backing: "vault" },
  "app/api/audits/route.ts":
    { kind: "capability", capability: "audits:*", sales: "deny", backing: "vault" },
  "app/api/audits/run/route.ts":
    { kind: "capability", capability: "audits:*", sales: "deny", backing: "vault" },
  "app/api/auth/login/route.ts":
    { kind: "public", why: "the credential IS the authentication; there is no session yet to authorize" },
  "app/api/auth/logout/route.ts":
    { kind: "public", why: "clears a cookie; refusing to let an unauthenticated caller log out protects nothing" },
  "app/api/automations/dismiss/route.ts":
    { kind: "capability", capability: "pipeline:write", sales: "allow", backing: "vault" },
  "app/api/console/search/route.ts":
    { kind: "capability", capability: "search", sales: "scoped", backing: "both" },
  "app/api/documents/[id]/route.ts":
    { kind: "capability", capability: "documents:*", sales: "deny", backing: "vault" },
  "app/api/documents/[id]/version/route.ts":
    { kind: "capability", capability: "documents:*", sales: "deny", backing: "vault" },
  "app/api/documents/route.ts":
    { kind: "capability", capability: "documents:*", sales: "deny", backing: "vault" },
  "app/api/finance/invoices/[id]/route.ts":
    { kind: "capability", capability: "finance:*", sales: "deny", backing: "vault" },
  "app/api/finance/invoices/route.ts":
    { kind: "capability", capability: "finance:*", sales: "deny", backing: "vault" },
  "app/api/import/prospects/route.ts":
    { kind: "capability", capability: "import:run", sales: "deny", backing: "both" },
  "app/api/portal/approval-requests/route.ts":
    { kind: "capability", capability: "portal:admin", sales: "deny", backing: "vault" },
  "app/api/portal/approvals/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/portal/invites/route.ts":
    { kind: "capability", capability: "portal:admin", sales: "deny", backing: "vault" },
  "app/api/portal/me/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/portal/submissions/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/production/toggle/route.ts":
    { kind: "capability", capability: "production:toggle", sales: "deny", backing: "vault" },
  "app/api/prospects/[slug]/promote/route.ts":
    { kind: "capability", capability: "promote", sales: "deny", backing: "both" },
  // ─── A DELIBERATE TIGHTENING OF §8, FLAGGED RATHER THAN SILENT ───────────────────────────────
  //
  // §8 records this path as `prospects:read / prospects:write` with sales ✅, anticipating a route
  // that reads and edits a prospect. The file implements ONE method: DELETE, which removes the
  // prospect record entirely.
  //
  // §8 defines `prospects:write` as "notes, contacts, status, follow-ups". Deleting the record is
  // none of those — it destroys the identity anchor, and it does so by unlinking a FILE, which
  // means the column grants that stop `ascend_sales` writing `prospect_id` or `identity_state` are
  // not in the path at all. Granting sales this route would let the weaker capability accomplish
  // what the stronger one is specifically denied.
  //
  // So it is mapped to `prospects:identity`. This is a TIGHTENING, never a weakening, and it is
  // recorded here rather than absorbed: if the intent was that a partner may delete a prospect,
  // one line changes.
  "app/api/prospects/[slug]/route.ts":
    { kind: "capability", capability: "prospects:identity", sales: "deny", backing: "both" },
  "app/api/prospects/from-url/route.ts":
    { kind: "capability", capability: "prospects:write", sales: "allow", backing: "both" },
  "app/api/time/active/route.ts":
    { kind: "capability", capability: "time:*", sales: "deny", backing: "vault" },
  "app/api/time/log/route.ts":
    { kind: "capability", capability: "time:*", sales: "deny", backing: "vault" },
  "app/api/time/start/route.ts":
    { kind: "capability", capability: "time:*", sales: "deny", backing: "vault" },
  "app/api/time/stop/route.ts":
    { kind: "capability", capability: "time:*", sales: "deny", backing: "vault" },
  "app/api/time/summary/route.ts":
    { kind: "capability", capability: "time:*", sales: "deny", backing: "vault" },
};
