// core/auth/context — THE REQUEST CONTEXT. It carries authority; it never creates any.
//
// ─── THE DISTINCTION THIS FILE EXISTS TO HOLD ──────────────────────────────────────────────────
//
//   > `AsyncLocalStorage` is the request CONTEXT. `ResolvedPrincipal` is the AUTHORITY.
//   > The former may carry the latter. It may never create or modify it.
//
// Every function here is deliberately incapable of minting authority. The store's value type is
// `ResolvedPrincipal`, which is branded in `core/auth/principal` with a symbol that module does not
// export — so no code in this file, or in any caller of it, can write one as an object literal.
// `runInRequestContext` can only propagate a principal the database already vouched for.
//
// ─── WHY ASYNCLOCALSTORAGE RATHER THAN A THREADED ARGUMENT ─────────────────────────────────────
//
// Measured before deciding (STAGE2F §16): thirteen direct consumers of `listProspects()` /
// `getProspect()`, none receiving request context, each transitively imported by two to four more.
// Threading a principal explicitly would have touched ~25–30 files and pushed authentication into
// `lib/forecast`, `lib/opportunities` and `mission-control/pipeline` — pure derivation modules whose
// architectural purpose (F2) is precisely not knowing about I/O or identity.
//
// ─── WHY THIS IS NOT THE "AMBIENT STATE" THE PROJECT BANS ──────────────────────────────────────
//
// A module-level `let principal` is ONE SLOT SHARED BY EVERY REQUEST. Under concurrency a leak
// there is a race: request B reads the value request A wrote, and does so silently, under load,
// exactly when nobody is watching. An `AsyncLocalStorage` store is not one slot — it is one slot
// PER ASYNC EXECUTION TREE, unreachable from any other request by construction. The isolation is
// structural, and it is the same shape as `SET LOCAL` in Postgres, which is what ultimately enforces
// it (core/db/client.asPrincipal).
//
// Identity is therefore IMPLICIT IN PROPAGATION and EXPLICIT AT THE TRUST BOUNDARY. The boundary is
// `core/auth/request.withRequestContext`, and it is the only place that calls `runInRequestContext`
// outside tests.
//
// ─── FAIL CLOSED ───────────────────────────────────────────────────────────────────────────────
//
// Reading a principal outside a request context THROWS. There is no default principal, no ambient
// user, no inference from headers, query, body, session claims or environment. Code that runs
// outside a request has no authority, and the honest representation of "no authority" is an error —
// not "owner", and not "some org".

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SqlClient } from "@/core/db";
import type { ResolvedPrincipal } from "./principal";

/**
 * Everything one request is allowed to know about itself.
 *
 * `db` is a connection LEASED FOR THIS REQUEST and released when it ends, so the `SET LOCAL` binding
 * inside `asPrincipal` is scoped to a connection nobody else holds for the duration.
 */
export type RequestContext = {
  readonly principal: ResolvedPrincipal;
  readonly db: SqlClient;
};

/**
 * The store itself, never exported.
 *
 * Exporting it would hand every caller `.enterWith()`, which sets the store for the REST OF THE
 * CURRENT EXECUTION rather than for a scoped callback — a module-level principal wearing an ALS
 * costume. `runInRequestContext` is the only entry, and its scope ends when its callback does.
 */
const store = new AsyncLocalStorage<RequestContext>();

/** Thrown when code that needs authority runs where none was established. */
export class OutsideRequestContext extends Error {
  constructor(what: string) {
    super(
      `${what} outside a request context. No principal is available, and there is no default: ` +
        "authority comes from a resolved membership or it does not exist. Establish the context at " +
        "the trust boundary (core/auth/request.withRequestContext)."
    );
  }
}

/**
 * Run `fn` with `context` bound to this async execution tree.
 *
 * Nested async work inherits it; concurrent requests cannot see it. The context ends with the
 * callback — there is no way to leave one behind.
 */
export function runInRequestContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return store.run(context, fn);
}

/** Whether a request context is established here. For seams that translate the failure themselves. */
export function inRequestContext(): boolean {
  return store.getStore() !== undefined;
}

/**
 * The context, or `undefined`.
 *
 * Deliberately NOT named `currentPrincipal` or `currentUser`: those names describe a global, and the
 * value here is neither global nor settable. Prefer `requirePrincipal()`; this exists for the two
 * seams that raise their own error type.
 */
export function peekRequestContext(): RequestContext | undefined {
  return store.getStore();
}

/**
 * THE authority accessor. Throws outside a request.
 *
 * Returns the principal the DATABASE vouched for during this request — never a role read from a
 * cookie, header, body or environment variable, because no such value can be put here.
 */
export function requirePrincipal(): ResolvedPrincipal {
  const ctx = store.getStore();
  if (!ctx) throw new OutsideRequestContext("requirePrincipal() was called");
  return ctx.principal;
}

/** The connection leased for this request. Throws outside a request. */
export function requireRequestDb(): SqlClient {
  const ctx = store.getStore();
  if (!ctx) throw new OutsideRequestContext("a database connection was requested");
  return ctx.db;
}
