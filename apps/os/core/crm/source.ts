// core/crm/source — WHICH STORE OWNS PROSPECTS, decided in exactly one place.
//
// Stage 2C's finding was that ten consumers reach prospect data and one of them
// (`core/knowledge`) reached past the canonical reader into the vault directly. That is not a
// migration in progress; it is a split brain. This module exists so the question "where do
// prospects come from?" has one answer that every consumer inherits.
//
// FAIL CLOSED IN THE DANGEROUS DIRECTION, and the asymmetry is deliberate rather than sloppy:
//
//   unset                      → vault      the vault IS authoritative today; this is a statement
//                                           of the current fact, not a fallback
//   ASCEND_PROSPECT_SOURCE=vault    → vault
//   ASCEND_PROSPECT_SOURCE=postgres → Postgres
//   postgres selected, no connection registered → THROW
//
// The last line is the one that matters. Degrading to the vault when Postgres is unreachable would
// silently restore the second source of truth this whole stage exists to remove — and it would do
// so at exactly the moment nobody is watching, which is how a split brain survives a review.
//
// A value that is neither `vault` nor `postgres` is also a throw. A typo must not select a store.

import "server-only";
import type { OrganizationId, UserId } from "@/domain";
import type { SqlClient } from "@/core/db";
import { peekRequestContext } from "@/core/auth/context";
import { requireCapability } from "@/core/auth/authority";
import type { Capability } from "@/core/auth/capabilities";
import type { ResolvedPrincipal } from "@/core/auth/principal";
import { requireAppDb } from "@/core/auth/connection";
import { asPrincipal } from "@/core/db";

export type ProspectSource = "vault" | "postgres";

export class ProspectSourceUnavailable extends Error {}

/**
 * A vault prospect write was attempted while Postgres owns prospects (D1a).
 *
 * Typed rather than generic, because the callers answer it differently: a route turns it into a
 * truthful refusal the operator can read, and a test asserts the refusal happened at all.
 */
export class VaultProspectWriteRefused extends Error {}

export function resolveProspectSource(): ProspectSource {
  const raw = process.env.ASCEND_PROSPECT_SOURCE?.trim();
  if (!raw) return "vault";
  if (raw === "vault" || raw === "postgres") return raw;
  throw new ProspectSourceUnavailable(
    `ASCEND_PROSPECT_SOURCE must be "vault" or "postgres" (got "${raw}"). A typo may not select a store.`
  );
}

/**
 * THE WRITER-SIDE HALF OF F43 (D1a).
 *
 * F43 made "the store is chosen in exactly one place" true for READS. It was never true for writes:
 * promotion marked a hit-list file, deletion unlinked one, and URL intake created one, no matter
 * which store the deployed configuration had selected. Measured against production's shape, that is
 * not a near-miss — 3,102 of 3,108 prospects have no vault file at all, so the vault write either
 * hit nothing or CREATED a file nobody reads, while the authoritative row went untouched.
 *
 * So every vault hit-list WRITER calls this first, and in Postgres mode there is no way through. It
 * is deliberately not a silent no-op: a refusal the operator can see is the whole point, and a
 * no-op would leave the same "it said it worked" defect with a quieter shape.
 */
export function assertVaultProspectWritable(): void {
  if (resolveProspectSource() === "postgres") {
    throw new VaultProspectWriteRefused(
      "Postgres owns prospects (ASCEND_PROSPECT_SOURCE=postgres), so the vault hit list is not " +
        "writable: it is the 2E rollback mirror, and nothing reads it. This write was refused " +
        "rather than performed against the wrong store."
    );
  }
}

/**
 * Run `fn` against the prospect store, as whoever is asking — THE SEAM, and the only way in.
 *
 * ─── WHY THIS REPLACED A SYNCHRONOUS `requireProspectDb()` ───────────────────────────────────
 *
 * The old seam read `peekRequestContext()` and nothing else. That works for a route handler, which
 * carries its principal in an `AsyncLocalStorage` context — and it CANNOT work for a Server
 * Component, because ALS provably does not cross a component boundary (STAGE2G §9, spike 1: a
 * layout's store reads `null` in the child page). So every rendered prospect read threw, and the
 * deployed UI could not show a prospect at all.
 *
 * The fix is not to let the seam invent a principal when it cannot find one. It is to give the
 * Server Component a legitimate identity at the boundary, which is what `requireCapability` already
 * does: it asks the registered resolver, which tries the request context first and falls back to
 * the `React.cache`-memoized page principal (2G.1 slice 1, proven isolated under overlap).
 *
 *   > Give the Server Component a legitimate identity at the boundary; never weaken the DAL to
 *   > accommodate the caller.
 *
 * ─── ONE AUTHORIZATION, TWO CONNECTION SOURCES ───────────────────────────────────────────────
 *
 * Authority is resolved identically for both surfaces — a route handler is not privileged over a
 * render, and neither can skip the check. What differs is only where the CONNECTION comes from: a
 * route handler already holds one leased for its request; a render leases one for the duration of
 * the read.
 *
 * ─── STILL FAILS CLOSED, IN BOTH DIRECTIONS ──────────────────────────────────────────────────
 *
 * No authority — no context, no page session, no registered resolver — throws. No degrading to the
 * vault, because a silent second source of truth is the failure this guard exists to prevent; and
 * no inventing a principal, because that is the failure the request context exists to prevent.
 */
export async function withProspectDb<T>(
  fn: (tx: SqlClient, principal: ResolvedPrincipal) => Promise<T>,
  /**
   * The capability the CALLER must hold. Defaults to the read capability every consumer inherits;
   * a mutation passes its own (D1a: `promote`), so the stronger check happens where the connection
   * is established rather than only at the route.
   */
  capability: Capability = "prospects:read"
): Promise<T> {
  // The SAME check a page or route would face for any other protected read. `prospects:read` is
  // held by both roles — this authorizes the caller, it does not narrow who may sell.
  //
  // Written as `const` + `.catch`, not `let` + try/catch, and that is not a style preference: F50
  // bans a mutable binding named for a principal anywhere in this file, because such a binding is
  // the SHAPE of the defect Step 7 removed — a slot that could be written once and read by every
  // later caller. The rule cannot tell a function-local `let` from a module-level one by reading
  // text, so the seam simply does not have one. There is nothing here to write twice.
  const principal: ResolvedPrincipal = await requireCapability(capability).catch((cause: unknown) => {
    throw new ProspectSourceUnavailable(
      "ASCEND_PROSPECT_SOURCE=postgres but the caller established no authority, so there is no " +
        "principal to read prospects as. Refusing to fall back to the vault: a silent second " +
        "source of truth is the failure this guard exists to prevent, and refusing to invent a " +
        `principal is the failure the request context exists to prevent. (${(cause as Error).message})`
    );
  });

  // A route handler already holds a connection leased for its request; reuse it rather than taking
  // a second one, which would put two connections in flight for one unit of work.
  const ctx = peekRequestContext();
  if (ctx) return asPrincipal(ctx.db, principal, (tx) => fn(tx, principal));

  // A render has authority but no connection of its own. Lease one for the read and release it.
  return requireAppDb()((client) => asPrincipal(client, principal, (tx) => fn(tx, principal)));
}

export type { OrganizationId, UserId };
