// tests/support/operator-session — an AUTHENTICATED OPERATOR, for tests that drive route handlers.
//
// Step 7.4 wired every capability route through `authorize`, so a route handler now answers 401 to a
// caller with no session. That is the point of the change, and it means any test that reaches a
// route as a convenient entry point must arrive as somebody.
//
// This module supplies the smallest honest "somebody": a real signed session for a real user id,
// resolved through the real trust boundary against a stubbed membership lookup. The stub is one
// SELECT; everything else — signature verification, principal resolution, the request context, the
// capability check — is production code.

import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { registerAuthorityResolver, clearAuthorityResolver } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";
import { createSessionToken, readAuthConfig, SESSION_COOKIE } from "@/lib/auth";
import type { SqlClient } from "@/core/db";

export const TEST_SECRET = "operator-session-secret-do-not-use";
export const TEST_OWNER_ID = "0198f3a1-2b4c-7d8e-9f01-00000000aaaa";
export const TEST_SALES_ID = "0198f3a1-2b4c-7d8e-9f01-00000000bbbb";
export const TEST_ORG_A = "11111111-1111-4111-8111-111111111111";
export const TEST_ORG_B = "22222222-2222-4222-8222-222222222222";

export type MembershipRow = { organization_id: string | null; role: string; disabled_at: string | null };

const memberships = new Map<string, MembershipRow[]>();

export function setMembership(userId: string, rows: MembershipRow[]): void {
  memberships.set(userId, rows);
}

/** The default world: one owner and one sales partner, both in organization A. */
export function resetMemberships(): void {
  memberships.clear();
  setMembership(TEST_OWNER_ID, [{ organization_id: TEST_ORG_A, role: "owner", disabled_at: null }]);
  setMembership(TEST_SALES_ID, [{ organization_id: TEST_ORG_A, role: "sales", disabled_at: null }]);
}

function stubClient(): SqlClient {
  const client: SqlClient = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      if (/FROM users/i.test(sql)) {
        const rows = (memberships.get(String(params?.[0])) ?? []) as unknown as T[];
        return { rows, affected: rows.length };
      }
      return { rows: [] as T[], affected: 0 };
    },
    async exec() {},
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(client); },
  };
  return client;
}

export function installStubDb(): void {
  registerAppDb((fn) => fn(stubClient()));
  // The REAL binding, not a declared identity: route handlers establish an AsyncLocalStorage
  // context, and `lib/authority` reads it. Binding the production resolver here is what makes a
  // route test exercise the actual carrier rather than a stand-in for it.
  bindAuthorityResolver();
}

export function removeStubDb(): void {
  clearAppDb();
  clearAuthorityResolver();
}

/**
 * Declare WHO a test is, for the data-access boundary.
 *
 * 2G.1 slice 2 put `requireCapability` inside the functions that touch owner-only storage, so a test
 * that calls one must arrive as somebody. That is the boundary working: a caller with no authority
 * obtains nothing, and a test is a caller.
 *
 * It registers a resolver directly rather than going through `lib/authority`, because these tests
 * are not exercising HOW authority is carried — ALS for routes, React.cache for renders, each proven
 * under genuine overlap in its own gate. They are exercising what a known caller may obtain.
 */
export function bindTestAuthority(role: MembershipRole = "owner"): void {
  const principal = __unsafePrincipalForTests(
    role, TEST_ORG_A as OrganizationId, TEST_OWNER_ID as UserId);
  registerAuthorityResolver(async () => ({ ok: true, principal }));
}

/** Remove it, so a test can prove that an UNauthorized caller obtains nothing. */
export function unbindTestAuthority(): void {
  clearAuthorityResolver();
}

export async function tokenFor(userId: string): Promise<string> {
  const token = await createSessionToken(readAuthConfig(), userId);
  if (!token) throw new Error("could not mint a session token — is ASCEND_OS_SESSION_SECRET set?");
  return token;
}

/** A request carrying a session cookie, exactly as a browser sends one. */
export function requestAs(token: string | undefined, url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; other=x`);
  return new Request(url, { ...init, headers });
}

/**
 * Set up an authenticated OWNER for the duration of a suite, and tear it down.
 *
 * Returns a getter rather than the token, because the token is minted asynchronously in `beforeAll`
 * and the suite body is evaluated before that runs.
 *
 * ─── WHY THE LEASE IS REGISTERED PER TEST, AND DYNAMICALLY ───────────────────────────────────
 *
 * Some suites call `vi.resetModules()` between tests. That clears the module registry, so the route
 * handler's next import of `core/auth/connection` is a DIFFERENT module instance from the one a
 * statically-imported `registerAppDb` would have written to — and the route would fail closed with
 * "no application database connection is registered". Correct behaviour, wrong cause.
 *
 * Importing the registry inside `beforeEach` resolves it to whichever instance is current, so the
 * helper works in suites that reset modules and in suites that do not.
 */
/**
 * Re-register the stubbed lease against the CURRENT module instance.
 *
 * Call this after any in-test `vi.resetModules()`. The reset gives the route handler a fresh
 * `core/auth/connection`, and a lease registered on the previous instance is invisible to it — the
 * route then fails closed, correctly, for the wrong reason.
 */
export async function bindOperatorDb(): Promise<void> {
  const { registerAppDb } = await import("@/core/auth/connection");
  registerAppDb((fn) => fn(stubClient()));
}

/**
 * Named `with…` rather than `use…` on purpose: the `use` prefix makes React's rules-of-hooks lint
 * treat any top-level call as a misplaced hook, and silencing that rule to keep a nicer name would
 * be turning off a real check for a cosmetic reason.
 */
export function withOperatorSession(hooks: {
  beforeAll: (fn: () => Promise<void>) => void;
  beforeEach?: (fn: () => Promise<void>) => void;
  afterAll: (fn: () => Promise<void>) => void;
}): () => string {
  let token = "";
  let savedSecret: string | undefined;
  const bind = async () => { await bindOperatorDb(); bindTestAuthority("owner"); };
  hooks.beforeAll(async () => {
    savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
    process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
    resetMemberships();
    await bind();
    token = await tokenFor(TEST_OWNER_ID);
  });
  hooks.beforeEach?.(bind);
  hooks.afterAll(async () => {
    removeStubDb();
    unbindTestAuthority();
    if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
    else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
  });
  return () => token;
}
