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

// ─── THE SLOT MUST OUTLIVE THE MODULE COPY ─────────────────────────────────────────────────────
//
// A bare `let` here is NOT one slot per process. The bundler emits this module into several server
// chunks — instrumentation gets one copy, route handlers another — so each copy carries its own
// `lease`, initialised to null. `instrumentation.ts` registered into ITS copy and the login route
// read a different, still-empty one: startup logged "application database bound" while every login
// failed with "no connection registered". The log said yes and the request said no because they
// were reading different variables.
//
// The slot is therefore keyed on `globalThis`, which is per-process rather than per-copy, so every
// copy of this module reads and writes the same holder. `Symbol.for` because a string key on the
// global object is a name collision waiting to happen.
//
// This weakens nothing below. An unregistered lease still throws, and what is stored is still only
// connectivity — never a principal, never an identity.
const SLOT = Symbol.for("ascend.os.auth.appDbLease");

type LeaseSlot = { lease: ConnectionLease | null };

const slot: LeaseSlot = ((globalThis as Record<symbol, unknown>)[SLOT] ??= { lease: null }) as LeaseSlot;

/** Registered once at startup (instrumentation.ts). Carries connectivity, never identity. */
export function registerAppDb(next: ConnectionLease): void {
  slot.lease = next;
}

/** Test/teardown helper. Never called in production. */
export function clearAppDb(): void {
  slot.lease = null;
}

export function requireAppDb(): ConnectionLease {
  if (!slot.lease) {
    throw new AppDbUnavailable(
      "No application database connection is registered. Authentication and principal resolution " +
        "cannot proceed, and there is no fallback: the only fallback for 'cannot verify who you " +
        "are' would be to let the caller in."
    );
  }
  return slot.lease;
}
