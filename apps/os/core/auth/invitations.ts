// core/auth/invitations — THE INVITATION LIFECYCLE (Stage 2G.2, STAGE2G §27).
//
//   > Invitation acceptance is an explicit unauthenticated capability, not a disguised
//   > authenticated request.
//
// ─── WHAT AN INVITATION IS, AND IS NOT ─────────────────────────────────────────────────────────
//
// It lets a user who ALREADY EXISTS — provisioned by the owner, with a membership the owner wrote —
// set their own password once. It creates no user, no membership and no authority. Membership
// remains the only source of authority in this system, and `ascend_invite` is a database capability
// rather than a principal: it has no `ResolvedPrincipal`, cannot be resolved into one, and no
// `requireCapability` call may ever be satisfied by it.
//
// Not to be confused with `lib/portal`'s CLIENT invites, which are vault-backed tokens letting a
// client see their own portal. Two unrelated things share the word; neither may reach the other.

import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SqlClient } from "@/core/db";
import { hashPassword } from "./credentials";

/** Bytes of CSPRNG output behind each token. Resistance here is entropy, not KDF cost. */
const TOKEN_BYTES = 32;

/**
 * ONE refusal, for every reason.
 *
 * Unknown, expired, consumed and malformed all raise this, with no field distinguishing them. The
 * database makes that structural — 006's SELECT policy hides dead invitations from `ascend_invite`
 * entirely, so there is no branch here that COULD tell them apart even if someone tried.
 */
export class InvitationRefused extends Error {
  constructor() {
    super("invitation refused");
  }
}

/** The digest stored at rest. SHA-256, not scrypt — see 006's header for the threat-model reason. */
export function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new token and the digest to store. The token is returned ONCE and never persisted. */
export function mintInvitationToken(): { token: string; digest: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, digest: digestOf(token) };
}

/**
 * The target is not a member of the organization the issuer is acting in (2G.3 §28.13, Path B).
 *
 * Distinct from `InvitationRefused`, which belongs to ACCEPTANCE and is deliberately uniform. This
 * one is raised for an authenticated owner acting inside their own tenant, where there is no
 * enumeration oracle to protect and the caller can already list their own members.
 */
export class InvitationTargetRefused extends Error {
  constructor(readonly userId: string) {
    super("the invitation target is not a member of the issuing organization");
  }
}

/**
 * Issue an invitation. Runs as the OWNER — issuing is an authorized act, unlike accepting.
 *
 * Returns the token exactly once. It is never written anywhere in plaintext: the caller hands it to
 * the person and forgets it, which is why there is no "resend" that could read one back.
 *
 * ─── THE MEMBERSHIP PREDICATE LIVES INSIDE THE WRITE (2G.3 §28.13, PATH B) ─────────────────────
 *
 * MEASURED during 2G.3 and recorded in full at §28.13: `006` does not tie `invitations.user_id` to a
 * membership in `organization_id`, and `invite_sets_credential` never mentions organizations. So an
 * invitation naming a user from ANOTHER organization is accepted by RLS — the row's own organization
 * column matches `current_org()` — and accepting it sets that user's credential.
 *
 * `INSERT … SELECT … WHERE EXISTS` rather than a SELECT followed by an INSERT, and the difference is
 * the whole point: the predicate is evaluated BY THE DATABASE as part of the write, under RLS,
 * in one statement. There is no window in which the membership could be true for a check and false
 * for the write that followed it.
 *
 * ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * It is not a database INVARIANT. It binds THIS statement, not every future writer — raw SQL as
 * `ascend_owner` can still write the row, which `tests/db/invitations.test.ts` proves deliberately
 * and permanently. An acknowledged architectural limitation, not a claimed schema guarantee. The
 * durable fix needs the schema to express the relationship, and that is a later, separately
 * authorized stage.
 */
export async function createInvitation(
  client: SqlClient,
  input: { organizationId: string; userId: string; createdBy: string; ttlMs: number }
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const { token, digest } = mintInvitationToken();
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const { rows } = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
     SELECT $1::uuid, $2::uuid, $3::text, $4::uuid, $5::timestamptz
      WHERE EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.user_id = $2::uuid AND m.organization_id = current_org()
      )
     RETURNING id, expires_at`,
    [input.organizationId, input.userId, digest, input.createdBy, expiresAt.toISOString()]
  );
  // ZERO ROWS IS THE REFUSAL, and it must be read as one. `rows[0].id` on an empty result yields a
  // TypeError at best and `undefined` threaded onward at worst — a mint that returns a token for an
  // invitation that was never written is the failure this check exists to make impossible.
  if (rows.length !== 1) throw new InvitationTargetRefused(input.userId);
  return { token, id: rows[0].id, expiresAt: rows[0].expires_at };
}

/**
 * Accept an invitation: set the password and burn the token, in ONE transaction.
 *
 * ─── THE PASSWORD IS HASHED BEFORE THE LOOKUP, DELIBERATELY ────────────────────────────────────
 *
 * scrypt dominates the cost of this call. Hashing only after a successful lookup would make a valid
 * token slow and every invalid one fast — a timing oracle that would undo the uniform refusal the
 * database works to guarantee. So the work happens unconditionally, and a refusal pays for it too.
 *
 * ─── ORDER IS ENFORCED BY THE DATABASE, NOT BY THIS FUNCTION ───────────────────────────────────
 *
 * The credential write comes first because 006's `invite_sets_credential` policy permits it only
 * WHILE a live invitation exists for that user. Burning the token removes the row that policy
 * depends on, so an implementation that consumed first would find the credential write REFUSED
 * rather than silently half-accepting. The ordering is a property of the schema.
 *
 * ─── ONE TRANSACTION, BOTH DIRECTIONS ──────────────────────────────────────────────────────────
 *
 * A token burned without a credential locks the person out permanently; a credential set without
 * burning the token leaves a live reusable secret. Neither may happen, so both writes share one
 * success/failure boundary and each asserts `affected === 1`.
 */
export async function acceptInvitation(
  client: SqlClient,
  token: string,
  password: string
): Promise<{ userId: string }> {
  // Unconditional, before anything can branch on whether the token exists.
  const { hash, algo } = await hashPassword(password);

  return client.transaction(async (tx) => {
    // The acceptance capability, and nothing more. `SET LOCAL` dies with the transaction.
    await tx.query("SET LOCAL ROLE ascend_invite");

    // ONE PREDICATE, THREE FAILURES. Unknown, expired and consumed all return zero rows here, so
    // no branch exists that could tell them apart and become an enumeration oracle.
    //
    // Liveness lives in this WHERE clause rather than in a row-visibility policy because Postgres
    // checks the SELECT policy against the NEW row of an UPDATE — a policy hiding consumed rows made
    // consuming them impossible (measured; see 006's header).
    const found = await tx.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM invitations
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [digestOf(token)]
    );
    if (found.rows.length !== 1) throw new InvitationRefused();
    const { id, user_id } = found.rows[0];

    const credential = await tx.query(
      `UPDATE users SET password_hash = $2, password_algo = $3, password_set_at = now()
        WHERE id = $1`,
      [user_id, hash, algo]
    );
    if (credential.affected !== 1) throw new InvitationRefused();

    const burned = await tx.query(
      `UPDATE invitations SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [id]
    );
    // The concurrent loser lands here: the row was visible at SELECT and burned by the winner
    // before this UPDATE. Same refusal as every other failure.
    if (burned.affected !== 1) throw new InvitationRefused();

    return { userId: user_id };
  });
}

/** Constant-time digest comparison, for callers that must compare two digests directly. */
export function digestsMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
