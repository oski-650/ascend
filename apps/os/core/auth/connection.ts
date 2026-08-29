// core/auth/connection — HOW THE APPLICATION GETS A DATABASE CONNECTION, and nothing else.
//
// Separate from `core/crm/source`'s store selection on purpose. That one answers "where do
// prospects come from?" and may legitimately be the vault. This one answers "how does a server-side
// request reach Postgres?", and the answer is always the pooled application login.
//
// ─── IT REGISTERS A LEASE, NOT A CONNECTION ────────────────────────────────────────────────────
//
// The earlier version held ONE checked-out client for the process lifetime. That was adequate while
// the only caller was login — one query, no identity — and it stops being adequate the moment a
// request needs a connection of its own. `asPrincipal` binds identity with `SET LOCAL`, which is
// scoped to a transaction on a specific connection; two concurrent requests sharing one client
// would serialise behind each other's transactions and, worse, would make the isolation argument
// rest on timing rather than on structure.
//
// So what is registered is a LEASE: a function that checks a connection out, runs the caller's work,
// and returns it to the pool. One lease per request, released when the request ends.
//
// ─── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────────
//
// NO PRINCIPAL. This module registers connectivity, which is a startup fact, and carries no
// identity, which is a per-request fact. The two were entangled once (`registerProspectDb(client,
// principal)`), and that entanglement is exactly what Step 7 removes: a principal registered at
// startup is one ambient identity every request inherits.
//
// FAIL CLOSED, like every other seam in this system: an unregistered lease throws. There is no
// fallback, because the only conceivable fallback for "cannot check who you are" is "let you in".

import "server-only";
import type { SqlClient } from "@/core/db";

/** Check a connection out, run `fn`, release it. The pool decides where it comes from. */
export type ConnectionLease = <T>(fn: (client: SqlClient) => Promise<T>) => Promise<T>;

export class AppDbUnavailable extends Error {}

let lease: ConnectionLease | null = null;

/** Registered once at startup (instrumentation.ts). Carries connectivity, never identity. */
export function registerAppDb(next: ConnectionLease): void {
  lease = next;
}

/** Test/teardown helper. Never called in production. */
export function clearAppDb(): void {
  lease = null;
}

export function requireAppDb(): ConnectionLease {
  if (!lease) {
    throw new AppDbUnavailable(
      "No application database connection is registered. Authentication and principal resolution " +
        "cannot proceed, and there is no fallback: the only fallback for 'cannot verify who you " +
        "are' would be to let the caller in."
    );
  }
  return lease;
}
