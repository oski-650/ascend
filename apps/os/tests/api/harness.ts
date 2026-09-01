// tests/api/harness — the fixtures the 2F security suite shares.
//
// ─── WHAT IS REAL HERE, AND WHAT IS NOT ────────────────────────────────────────────────────────
//
// REAL: the route handlers (imported and invoked as Next invokes them), the guard, the trust
// boundary, session signing and verification, the capability table, the knowledge index, and the
// vault on disk.
//
// STUBBED: the database behind `resolvePrincipal` — one SELECT against `users`/`memberships`. It is
// stubbed so a membership can be REVOKED between two requests and a user DISABLED mid-session,
// which is what threat-model items 9–11 require and what a fixed fixture cannot express. The
// database's own half of the boundary — RLS, column grants, cross-organization isolation — is
// proven against real Postgres in tests/db/production-authorization.test.ts and
// tests/db/request-isolation.test.ts. Neither suite stands in for the other.

export {
  installStubDb, removeStubDb, requestAs, resetMemberships, setMembership, tokenFor,
  TEST_ORG_A as ORG_A, TEST_ORG_B as ORG_B, TEST_OWNER_ID as OWNER_ID,
  TEST_SALES_ID as SALES_ID, TEST_SECRET as SECRET,
} from "@/tests/support/operator-session";

// Re-homed to `tests/support/route-surface` in 2G.4.2 (STAGE2G §29.6), so
// `tests/db/route-matrix-provisioned.test.ts` can share the SAME importer map and request fixtures
// without pulling in this file's stubbed-authority exports above. Every name below is re-exported
// unchanged, so nothing that already imports it from here needs to change.
export {
  CLIENT_NAME, METHODS, PROSPECT_NAME, ROUTE_IMPORTERS, ROUTE_MATRIX, SHARED_TERM, SOP_TERM,
  capabilityRoutes, invoke, methodsOf, publicRoutes, seedVault, urlFor,
} from "@/tests/support/route-surface";
export type { Method, RouteModule, RouteMatrixEntry } from "@/tests/support/route-surface";
