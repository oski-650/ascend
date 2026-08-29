// instrumentation.ts — Next's server startup hook. Registers the database bindings ONCE.
//
// ─── WHY THIS DID NOT EXIST BEFORE, AND WHY THAT WAS A BUG ─────────────────────────────────────
//
// Stage 2E flipped `ASCEND_PROSPECT_SOURCE=postgres`, and every parity test passed — because each
// test registered its own connection. Nothing in the APPLICATION ever did. A deployed Ascend OS
// would have failed closed on every prospect read: correct behaviour, non-functional product. The
// gap was invisible precisely because the tests were well-behaved.
//
// ─── WHAT IS REGISTERED HERE, AND WHAT DELIBERATELY IS NOT ─────────────────────────────────────
//
// REGISTERED: the auth connection. Authentication needs a database before any user is known, and
// the binding carries no identity — `resolvePrincipal` supplies that per request.
//
// NOT REGISTERED: the prospect binding. It takes a `{ client, principal }` pair, and a principal
// registered at STARTUP would be a single ambient identity every request inherits — which is the
// exact defect 2F exists to remove. Since `ResolvedPrincipal` is branded, this file could not
// construct one even if it wanted to; the compiler enforces the argument.
//
// The prospect reader therefore becomes per-request in step 7, where the principal comes from the
// authenticated session. Until then `ASCEND_PROSPECT_SOURCE=postgres` fails closed for prospect
// reads — loudly, which is the correct state for a half-finished migration.

export async function register(): Promise<void> {
  // Runs in both the Node and Edge runtimes; the pool is Node-only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createPool, adaptPoolClient } = await import("@/core/db");
  const { registerAuthDb } = await import("@/core/auth/connection");

  if (!process.env.ASCEND_DATABASE_URL) {
    // Fail LOUD but do not crash the process: a server that cannot authenticate should start and
    // refuse logins with a diagnosable log line, not exit and take the login page with it.
    console.error("[startup] ASCEND_DATABASE_URL is not set — authentication will refuse every login.");
    return;
  }

  try {
    const pool = createPool("app");
    const client = await pool.connect();
    registerAuthDb(adaptPoolClient(client));
    console.info("[startup] auth database bound (TLS-verified, application login).");
  } catch (e) {
    console.error(`[startup] auth database unavailable: ${(e as Error).message}`);
  }
}
