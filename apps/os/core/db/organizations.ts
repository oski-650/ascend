// core/db/organizations — the tenancy and identity records.
//
// `organization_id` has been written into every event and every structural_meta since D9, and read
// for filtering nowhere: "field preserved everywhere, machinery deferred". This is that machinery.
// It arrives now, with one organization, specifically so that multi-tenancy later is a POLICY
// change rather than a schema migration — retrofitting a tenant key is the painful path.
//
// Authentication itself is external (Supabase Auth, or any provider). These rows are the profile
// and the authorization edge; no password or token is stored here.

import "server-only";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";
import type { SqlClient } from "./client";

export async function createOrganization(tx: SqlClient, slug: string, name: string): Promise<OrganizationId> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO organizations (slug, name) VALUES ($1,$2) RETURNING id`, [slug, name]
  );
  return rows[0].id as OrganizationId;
}

export async function createUser(tx: SqlClient, email: string, displayName?: string): Promise<UserId> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`, [email, displayName ?? null]
  );
  return rows[0].id as UserId;
}

export async function addMembership(
  tx: SqlClient, userId: UserId, organizationId: OrganizationId, role: MembershipRole
): Promise<void> {
  await tx.query(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,$3)`,
    [userId, organizationId, role]
  );
}

/** The authorization edge: which role this user holds in this organization, or null for none. */
export async function membershipFor(
  tx: SqlClient, userId: UserId, organizationId: OrganizationId
): Promise<MembershipRole | null> {
  const { rows } = await tx.query<{ role: string }>(
    `SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId]
  );
  return rows.length ? (rows[0].role as MembershipRole) : null;
}
