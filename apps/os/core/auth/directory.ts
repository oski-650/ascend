// core/auth/directory — WHO IS IN THIS ORGANIZATION, for the owner's invitation surface (2G.3 §28).
//
// ─── IT READS PEOPLE, AND IT CREATES NONE ──────────────────────────────────────────────────────
//
// §28.2 ruling 1: *2G.3 may invite an already-provisioned partner; it may not create users or
// memberships.* This module is the read half of that ruling and has no write half — there is no
// INSERT here, and there could not be one, because no application role holds INSERT on `users` or
// `memberships`. 001 grants the three application roles SELECT and nothing else.
//
// So provisioning stays operational, and the UI can only ever act on somebody who already exists.
//
// ─── THE MEMBERSHIP BOUNDARY LIVES IN THE WRITE, NOT HERE (§28.13, PATH B) ─────────────────────
//
// An earlier draft of this module checked membership and then called `createInvitation`. That is
// check-then-write, and §28.13 Path B rejected it: the predicate now lives INSIDE the INSERT, in
// `core/auth/invitations`, so the database evaluates it as part of the write. This module no longer
// has a membership check of its own, because a second one would be a second place to get it wrong.
//
// The hazard it addresses, measured while implementing §28.4:
//
//   `006`'s `invite_sets_credential` policy permits `ascend_invite` to write a credential for ANY
//   user who has a live invitation. It does not mention organizations, and `invitations` has no
//   constraint tying `user_id` to a membership in `organization_id`.
//
// The RLS policy on `invitations` checks the ROW's organization (`WITH CHECK (organization_id =
// current_org())`), and the minting route supplies that from the principal — so it always matches.
// An invitation naming a user from ANOTHER organization would therefore be inserted happily, and
// accepting it would set that foreign user's password.
//
// Unreachable before 2G.3 — there was no minting route, and production holds one user in one
// organization. Introducing the route is precisely what would make it reachable, so the check
// arrives with it.
//
// ─── WHY THE DATABASE STILL DOES THE DECIDING ──────────────────────────────────────────────────
//
// The check is a SELECT against `memberships` executed as the principal, so RLS scopes what it can
// see and `current_org()` — not a value from the request — defines the organization. The
// application supplies no organization and takes no row on trust; it asks the database a question
// it can only answer about the caller's own tenant.
//
// ─── TWO STATES, AND THIS COMMENT MEANS DIFFERENT THINGS IN EACH ───────────────────────────────
//
//   IN THIS REPOSITORY   `007_invitation_membership` adds the composite foreign key from
//                        `invitations (user_id, organization_id)` to `memberships`, so the DATABASE
//                        refuses a cross-organization invitation from every ORDINARY writer — the
//                        `ascend_app` login and every role in `ASSUMABLE_ROLES`, which is the whole
//                        application surface. It does NOT bind an actor that can suppress the
//                        constraint (`SET session_replication_role`, `DISABLE TRIGGER`,
//                        `DROP CONSTRAINT`); in production that is `postgres`. See 007's
//                        "WHAT IT DOES NOT BIND" for why excluding it costs nothing. §28.15 records
//                        the boundary; `tests/db/invitations.test.ts` measures it.
//   IN PRODUCTION        `007` HAS NOT BEEN APPLIED. Until it is, the predicate inside
//                        `createInvitation`'s INSERT is the ONLY barrier there, exactly as §28.13
//                        Path B described it: an acknowledged architectural limitation, not a
//                        claimed database invariant.
//
// Both sentences are true at once, and a reader who collapses them will over-claim about the
// deployed system. When `007` reaches production this block should say so — and the day it does is
// the day the second barrier actually exists for the people using it.

import "server-only";
import { asPrincipal, type SqlClient } from "@/core/db";
import { requireCapability } from "./authority";
import { createInvitation } from "./invitations";
import type { ResolvedPrincipal } from "./principal";
import { requireAppDb } from "./connection";
import { peekRequestContext } from "@/core/auth/context";

/** One member of the caller's organization, as the owner's invitation surface needs them. */
export type OrganizationMember = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
};

// ─── A COLUMN THIS MODULE DELIBERATELY DOES NOT READ ───────────────────────────────────────────
//
// The first draft returned `hasCredential`, so the operator could see who had never set a password.
// MEASURED against `005`: the table-level grant on `users` was REVOKED and replaced with an explicit
// column list — `ascend_owner` holds `SELECT (id, email, display_name, created_at, disabled_at)` and
// nothing else. `password_hash` and `password_set_at` are granted to `ascend_auth` alone.
//
// So the query would have been refused by the database, and the useful little badge would have cost
// a GRANT. §28.3 forbids 2G.3 from adding one. The boundary decided this, not a preference — which
// is the second barrier doing exactly what `core/auth/capabilities` says it is for.

/**
 * Run `fn` as the caller, having established they hold `admin:*`.
 *
 * Same shape as `core/crm/source.withProspectDb`, and for the same two reasons: one authorization,
 * two connection sources — a route reuses the connection already leased for its request, a render
 * leases one — and `const` + `.catch` rather than a mutable principal binding, which F50 forbids.
 */
async function withDirectory<T>(
  fn: (tx: SqlClient, principal: ResolvedPrincipal) => Promise<T>
): Promise<T> {
  const principal = await requireCapability("admin:*");
  const run = (tx: SqlClient) => fn(tx, principal);
  const ctx = peekRequestContext();
  if (ctx) return asPrincipal(ctx.db, principal, run);
  return requireAppDb()((client) => asPrincipal(client, principal, run));
}

/**
 * Everyone in the caller's organization.
 *
 * No organization parameter, deliberately — `current_org()` inside the policy answers that, and a
 * parameter would be an authority the caller supplied. Same rule slice 4 applied to the knowledge
 * index: *no parameter exists through which any caller could assert an authority it does not hold.*
 */
export async function listOrganizationMembers(): Promise<OrganizationMember[]> {
  return withDirectory(async (tx) => {
    const { rows } = await tx.query<{
      id: string; email: string; display_name: string | null; role: string;
    }>(
      `SELECT u.id, u.email, u.display_name, m.role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE m.organization_id = current_org()
          AND u.disabled_at IS NULL
        ORDER BY u.email`
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name ?? r.email,
      role: r.role,
    }));
  });
}

/**
 * Issue an invitation for a member of the CALLER's organization.
 *
 * The check and the insert share one transaction and one principal binding, so there is no window
 * in which the membership could be true for the check and false for the write, and no second
 * connection whose session might see a different organization.
 *
 * The organization comes from the principal — never from an argument. There is deliberately no
 * parameter through which a caller could name a tenant it did not prove.
 */
export async function issueInvitationFor(
  userId: string,
  ttlMs: number
): Promise<{ token: string; id: string; expiresAt: Date }> {
  return withDirectory(async (tx, principal) => {
    // No pre-check. `createInvitation` refuses a non-member inside its own INSERT, which is the one
    // place the database can evaluate the predicate atomically with the write it guards.
    return createInvitation(tx, {
      organizationId: principal.organizationId,
      userId,
      createdBy: principal.userId,
      ttlMs,
    });
  });
}
