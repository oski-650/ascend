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
import type { DbPrincipal, SqlClient } from "@/core/db";

export type ProspectSource = "vault" | "postgres";

export class ProspectSourceUnavailable extends Error {}

export function resolveProspectSource(): ProspectSource {
  const raw = process.env.ASCEND_PROSPECT_SOURCE?.trim();
  if (!raw) return "vault";
  if (raw === "vault" || raw === "postgres") return raw;
  throw new ProspectSourceUnavailable(
    `ASCEND_PROSPECT_SOURCE must be "vault" or "postgres" (got "${raw}"). A typo may not select a store.`
  );
}

/**
 * The database binding, registered once at startup.
 *
 * Module-level because the canonical readers take no arguments — nine consumers call
 * `listProspects()` with no context, and changing that signature would be a change to every one of
 * them rather than to the source of truth. Registration is a startup concern, not a per-request one;
 * per-request PRINCIPAL binding happens inside `asPrincipal`, which uses `SET LOCAL` so a pooled
 * connection cannot leak identity between requests.
 *
 * ⚠️ THAT POOLED BEHAVIOUR IS UNPROVEN. PGlite is single-connection and cannot demonstrate it. It
 * must be verified against a real pool before any deployment — it is a security property, not a
 * performance one.
 */
let binding: { client: SqlClient; principal: DbPrincipal } | null = null;

export function registerProspectDb(client: SqlClient, principal: DbPrincipal): void {
  binding = { client, principal };
}

/** Test/teardown helper. Never called in production. */
export function clearProspectDb(): void {
  binding = null;
}

export function requireProspectDb(): { client: SqlClient; principal: DbPrincipal } {
  if (!binding) {
    throw new ProspectSourceUnavailable(
      "ASCEND_PROSPECT_SOURCE=postgres but no database connection is registered. " +
        "Refusing to fall back to the vault: a silent second source of truth is the failure this " +
        "guard exists to prevent."
    );
  }
  return binding;
}

export type { OrganizationId, UserId };
