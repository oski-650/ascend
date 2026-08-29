// core/db/client — THE VENDOR SEAM.
//
// Decision 1 says Supabase is INFRASTRUCTURE, not the domain abstraction. This file is what makes
// that true rather than aspirational: it is the only place that knows a database exists, and it
// knows nothing about which one. No Supabase client, no `auth.uid()`, no PostgREST, no vendor
// types — a `pg.Pool`, a Supabase connection and the PGlite instance the tests run on all satisfy
// the same three methods.
//
// If Supabase is ever replaced, this file changes and nothing above it does.
//
// IDENTITY IS BOUND PER SESSION, NOT PER QUERY. Row-level security reads two GUCs
// (`ascend.org_id`, `ascend.user_id`) and a role. Any host can set them: Supabase maps its JWT
// claims onto them, a plain deployment sets them directly. Because the policies key on settings
// rather than on a vendor function, the schema is portable and the tests exercise the REAL
// policies rather than a stand-in.

import "server-only";
import type { OrganizationId } from "@/domain";
import type { ResolvedPrincipal } from "@/core/auth/principal";

export type SqlValue = string | number | boolean | null | Date | Record<string, unknown> | unknown[];

export type QueryResult<T> = { rows: T[]; affected: number };

/** The whole database contract. Deliberately three methods — anything larger leaks a vendor. */
export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<QueryResult<T>>;
  /** Multi-statement DDL/script execution. Used by migrations and test setup only. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a transaction, rolling back on throw. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

/**
 * Who a unit of work acts as.
 *
 * `role` is a DATABASE role, not a UI concept: it decides which grants and which RLS policies
 * apply. `automation` exists so that import and research run under a principal that is
 * structurally incapable of writing a human judgment — the grant on `website_opportunity` is
 * withheld from it in the schema.
 */
export type DbPrincipal =
  /**
   * A human principal the DATABASE vouched for. Branded in core/auth/principal, so it CANNOT be
   * written as an object literal — `{ role: "owner", ... }` no longer type-checks here. The only
   * source is `resolvePrincipal()`, which reads `memberships`. A forged role claim is not rejected
   * at runtime; it is inexpressible.
   */
  | ResolvedPrincipal
  /** Not a human. No session, no membership; invoked only by server-side jobs. */
  | { role: "automation"; organizationId: OrganizationId; userId: null };

const DB_ROLE: Record<string, string> = {
  owner: "ascend_owner",
  sales: "ascend_sales",
  automation: "ascend_automation",
};

/**
 * Bind a connection to a principal for the duration of `fn`.
 *
 * `LOCAL` is load-bearing: both the role and the GUCs are scoped to the surrounding transaction, so
 * a pooled connection cannot leak one request's identity into the next. A connection pool with
 * session-scoped `SET` is the classic way an isolation boundary silently stops holding.
 */
export async function asPrincipal<T>(
  client: SqlClient,
  principal: DbPrincipal,
  fn: (tx: SqlClient) => Promise<T>
): Promise<T> {
  const dbRole = DB_ROLE[principal.role];
  if (!dbRole) throw new Error(`unknown principal role: ${principal.role}`);
  return client.transaction(async (tx) => {
    await tx.query("SELECT set_config('ascend.org_id', $1, true)", [principal.organizationId]);
    await tx.query("SELECT set_config('ascend.user_id', $1, true)", [principal.userId ?? ""]);
    await tx.query(`SET LOCAL ROLE ${dbRole}`);
    return fn(tx);
  });
}
