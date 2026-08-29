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
import { peekRequestContext } from "@/core/auth/context";

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
 * The database and the principal for THIS REQUEST — read from the request context, never stored.
 *
 * ─── WHAT THIS REPLACED, AND WHY IT HAD TO GO ────────────────────────────────────────────────
 *
 * Until Step 7 this module held
 *
 *     let binding: { client: SqlClient; principal: DbPrincipal } | null = null;
 *     export function registerProspectDb(client, principal) { binding = { client, principal }; }
 *
 * — one slot, shared by every request, holding an identity. It was registered at startup, which
 * made whoever the server was started as the identity every request inherited. With one operator
 * that is invisible. With an owner and a partner it is the entire security boundary, decided by
 * whichever request wrote the slot last.
 *
 * The canonical readers still take NO arguments, so the nine consumers that call `listProspects()`
 * are unchanged and the derivation modules stay auth-unaware (F2). What changed is where the answer
 * comes from: an `AsyncLocalStorage` context established at the trust boundary, which is per
 * request by construction rather than by discipline.
 *
 * FAIL CLOSED, IN THE DANGEROUS DIRECTION. Outside a request there is no principal, and the honest
 * response is to refuse — not to invent one, and above all not to degrade to the vault, which would
 * silently restore the second source of truth this stage exists to remove.
 */
export function requireProspectDb(): { client: SqlClient; principal: DbPrincipal } {
  const ctx = peekRequestContext();
  if (!ctx) {
    throw new ProspectSourceUnavailable(
      "ASCEND_PROSPECT_SOURCE=postgres but this code is running outside a request context, so " +
        "there is no principal to read prospects as. Refusing to fall back to the vault: a silent " +
        "second source of truth is the failure this guard exists to prevent, and refusing to " +
        "invent a principal is the failure the request context exists to prevent."
    );
  }
  return { client: ctx.db, principal: ctx.principal };
}

export type { OrganizationId, UserId };
