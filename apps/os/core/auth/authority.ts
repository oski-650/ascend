// core/auth/authority — THE DATA-ACCESS BOUNDARY. Where authority decides whether data may exist
// for the caller.
//
// ─── THE RULE THAT DECIDES WHAT BELONGS HERE ───────────────────────────────────────────────────
//
//   > Never add authorization merely because a module is sensitive. Add it where authority controls
//   > whether protected data may be OBTAINED.
//   >
//   > Sensitivity describes the data. Authority governs access to the data.
//
// `lib/forecast` handles the most sensitive numbers in this system and must never call anything in
// this file: it obtains nothing, it derives. F2 exists to keep it that way. Conflating "sensitive"
// with "authorized" is how a codebase ends up with checks everywhere and a boundary nowhere.
//
// ─── WHY A REGISTERED RESOLVER, RATHER THAN READING THE SESSION HERE ───────────────────────────
//
// `core/` imports neither `next/*` nor `@/lib/*` — measured, and worth keeping. Reading a cookie
// means `next/headers`; verifying a session means `lib/auth`. Doing either here would put the
// framework inside the domain kernel on a security path, which is the coupling Stage 2 spent its
// whole length avoiding (F41 for the vendor, this for the framework).
//
// So the surrounding runtime REGISTERS how to answer "who is asking?", and this module only decides
// what that answer permits. Same shape as `core/auth/connection`, which registers a connection
// lease: the slot holds a FUNCTION, never an identity. That distinction is the whole of F50 — a
// module-level principal is one shared slot every request inherits; a module-level resolver is a
// question that gets asked afresh each time.
//
// ─── ONE BOUNDARY, TWO CARRIERS ────────────────────────────────────────────────────────────────
//
// Route handlers carry authority in an `AsyncLocalStorage` context (7.2); Server Components carry it
// in a `React.cache` memo (2G.1 slice 1), because ALS provably cannot cross a component boundary.
// The registered resolver picks whichever is active, so a data function behaves identically however
// it was reached — including from a consumer nobody has written yet.
//
// ─── FAIL CLOSED ───────────────────────────────────────────────────────────────────────────────
//
// No resolver registered, no authority, or the wrong capability: every one throws. There is no
// default principal and no owner fallback, so a caller that has not established authority cannot
// obtain protected data by asking nicely.

import "server-only";
import { can, type Capability } from "./capabilities";
import type { ResolvedPrincipal } from "./principal";

/** What the runtime answers. The reason is for the log; the caller only learns that it failed. */
export type AuthorityAnswer =
  | { ok: true; principal: ResolvedPrincipal }
  | { ok: false; reason: string };

export type AuthorityResolver = () => Promise<AuthorityAnswer>;

/** Thrown when nobody could be identified — unauthenticated, revoked, or outside a request. */
export class NoAuthority extends Error {
  constructor(readonly reason: string) {
    super(`no authority for this call: ${reason}`);
  }
}

/** Thrown when the caller IS identified and the answer is still no. */
export class CapabilityDenied extends Error {
  constructor(readonly capability: Capability, readonly role: string) {
    super(`role ${role} does not hold ${capability}`);
  }
}

/**
 * A FUNCTION, not an identity. Registered once by the runtime; asked afresh on every call.
 *
 * If this held a principal it would be the defect F50 forbids: one slot shared by every request,
 * where a leak is a race. It holds the QUESTION, and the answer is computed per call from whichever
 * request-scoped carrier is active.
 */
// Keyed on `globalThis` for the reason given at length in `core/auth/connection`: this module is
// emitted into several server chunks, so a bare `let` is one slot PER COPY. `bindAuthorityResolver`
// runs in the instrumentation copy; a data function reached through a route handler or a Server
// Component reads another. The resolver would look bound at startup and be null at every call site
// that matters, failing closed as `no-resolver` on every protected read.
//
// What is stored is still a FUNCTION, never a principal — the property F50 depends on is unchanged.
const SLOT = Symbol.for("ascend.os.auth.authorityResolver");

type ResolverSlot = { resolver: AuthorityResolver | null };

const slot: ResolverSlot = ((globalThis as Record<symbol, unknown>)[SLOT] ??= { resolver: null }) as ResolverSlot;

export function registerAuthorityResolver(next: AuthorityResolver): void {
  slot.resolver = next;
}

/** Test/teardown helper. Never called in production. */
export function clearAuthorityResolver(): void {
  slot.resolver = null;
}

/**
 * THE DATA-ACCESS CHECK. Returns the principal, or throws.
 *
 * Returning the principal rather than a boolean is deliberate: a data function that needs to scope
 * a query by organization gets the value it needs from the same call that authorized it, so there
 * is no second lookup to forget or to disagree with the first.
 */
export async function requireCapability(capability: Capability): Promise<ResolvedPrincipal> {
  if (!slot.resolver) {
    // Unregistered is not "allow". A data function reached before the runtime bound its resolver —
    // a build-time render, a background job, a test that forgot — obtains nothing.
    throw new NoAuthority("no-resolver");
  }
  const answer = await slot.resolver();
  if (!answer.ok) throw new NoAuthority(answer.reason);
  if (!can(answer.principal, capability)) {
    throw new CapabilityDenied(capability, answer.principal.role);
  }
  return answer.principal;
}
