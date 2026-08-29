// core/auth/principal — WHO THE CALLER IS, decided by the database and by nothing else.
//
// ─── THE DEFECT THIS REMOVES ───────────────────────────────────────────────────────────────────
//
// `asPrincipal` used to accept a role from its caller. Nothing verified it. `memberships.role`
// existed, `membershipFor()` was exported — and was called only in tests. A caller asserting
// `role: "owner"` for any `user_id` received owner privileges, and the database had no opinion.
//
// So the membership table recorded intent that nothing consulted. This module makes it authority.
//
// ─── THE ROLE IS NOT A PARAMETER ANY MORE ──────────────────────────────────────────────────────
//
// `ResolvedPrincipal` is BRANDED with a symbol this module does not export. It cannot be written as
// an object literal anywhere else in the codebase — `{ role: "owner", ... }` no longer type-checks
// as a principal. The only way to obtain one is `resolvePrincipal()`, which reads `memberships`.
//
// That is deliberately stronger than a runtime check. A runtime check can be forgotten at a new
// call site; a type that cannot be constructed cannot be forgotten. The compiler enforces the trust
// chain:
//
//   credential → authenticated user_id → membership lookup → role → DB principal → RLS
//
// ─── WHY IT NEEDS ITS OWN DATABASE ROLE ────────────────────────────────────────────────────────
//
// Resolution is a chicken-and-egg problem. To learn a user's organization, something must read
// `memberships` — but every application role's policy keys on `current_org()`, which is precisely
// the value being resolved. `ascend_owner` cannot answer "which organization am I?" because the
// question is the answer's precondition.
//
// `ascend_auth` (migration 005) exists for this one job: SELECT on `users` and `memberships`, no
// grant on anything else, no write anywhere.

import "server-only";
import type { SqlClient } from "@/core/db";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";

declare const __resolved: unique symbol;

/**
 * A principal the DATABASE vouched for.
 *
 * The brand is not exported, so this type is unforgeable outside this module. That is the whole
 * mechanism: a forged role claim cannot reach `asPrincipal` because it cannot be expressed.
 */
export type ResolvedPrincipal = {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly role: MembershipRole;
  readonly [__resolved]: true;
};

/** Why resolution failed. Never surfaced to the client — an attacker learns nothing from a 401. */
export type ResolutionFailure =
  | "no-such-user"
  | "no-membership"
  | "ambiguous-membership"
  | "disabled";

export type Resolution =
  | { ok: true; principal: ResolvedPrincipal }
  | { ok: false; reason: ResolutionFailure };

/** Bind a unit of work to `ascend_auth`. Transaction-scoped, like every other principal binding. */
async function asAuthRole<T>(client: SqlClient, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  return client.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE ascend_auth");
    return fn(tx);
  });
}

/**
 * Resolve the authenticated `user_id` to an organization and a role.
 *
 * RUNS PER REQUEST, and that is a feature rather than a cost. Because the session never carries the
 * role, revoking a membership or disabling a user takes effect on the very next request — no
 * session invalidation, no token blacklist, no waiting for a 12-hour expiry.
 *
 * FAILS CLOSED IN EVERY DIRECTION, including the one that looks helpful: a user belonging to more
 * than one organization resolves to NOTHING rather than to the first row. Multi-organization
 * membership is out of scope for 2F, and picking one silently is how a system starts serving the
 * wrong tenant's data to someone who legitimately has two.
 */
export async function resolvePrincipal(client: SqlClient, userId: string): Promise<Resolution> {
  const { rows } = await asAuthRole(client, (tx) =>
    tx.query<{ organization_id: OrganizationId; role: MembershipRole; disabled_at: string | null }>(
      `SELECT m.organization_id, m.role, u.disabled_at
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    )
  );

  if (rows.length === 0) return { ok: false, reason: "no-such-user" };
  if (rows[0].disabled_at !== null) return { ok: false, reason: "disabled" };
  if (rows.length > 1) return { ok: false, reason: "ambiguous-membership" };
  if (rows[0].organization_id === null) return { ok: false, reason: "no-membership" };

  return {
    ok: true,
    principal: {
      userId: userId as UserId,
      organizationId: rows[0].organization_id,
      role: rows[0].role,
    } as ResolvedPrincipal,
  };
}

export type Credential = {
  userId: UserId;
  passwordHash: string;
  passwordAlgo: string;
  disabled: boolean;
};

/**
 * Fetch a user's stored credential by email, for login only.
 *
 * Returns the row even when the user is disabled, so the caller can perform the KDF comparison
 * regardless and fail identically afterwards. Short-circuiting here would make a disabled account
 * respond faster than an active one with a wrong password — a timing oracle for account existence.
 */
export async function credentialFor(client: SqlClient, email: string): Promise<Credential | null> {
  const { rows } = await asAuthRole(client, (tx) =>
    tx.query<{ id: UserId; password_hash: string | null; password_algo: string | null; disabled_at: string | null }>(
      `SELECT id, password_hash, password_algo, disabled_at FROM users WHERE lower(email) = lower($1)`,
      [email]
    )
  );
  if (rows.length !== 1) return null;
  const r = rows[0];
  if (!r.password_hash || !r.password_algo) return null;
  return {
    userId: r.id,
    passwordHash: r.password_hash,
    passwordAlgo: r.password_algo,
    disabled: r.disabled_at !== null,
  };
}

/**
 * TEST-ONLY principal construction.
 *
 * Named to be impossible to use by accident and trivial to grep for. F50 forbids it everywhere
 * except `tests/`, so production code cannot mint a principal the database did not vouch for —
 * which is the entire point of the brand.
 */
export function __unsafePrincipalForTests(
  role: MembershipRole,
  organizationId: OrganizationId,
  userId: UserId
): ResolvedPrincipal {
  return { role, organizationId, userId } as ResolvedPrincipal;
}
