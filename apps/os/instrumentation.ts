// instrumentation.ts — Next's server startup hook. Registers the database CONNECTION, once.
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
// REGISTERED: a connection LEASE — check out, run, release. Connectivity is a startup fact and
// belongs here.
//
// NOT REGISTERED: any principal. Identity is a per-request fact, and a principal registered at
// startup would be one ambient identity every request inherits — the exact defect Step 7 removes.
// This file could not construct one even if it tried: `ResolvedPrincipal` is branded in
// `core/auth/principal`, so the compiler refuses the object literal.
//
// The principal is established per request at the trust boundary (`lib/request-context`), from a
// verified session and a membership row. Nothing between here and there can supply one.

export async function register(): Promise<void> {
  // Runs in both the Node and Edge runtimes; the pool is Node-only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createPool, withConnection } = await import("@/core/db");
  const { registerAppDb } = await import("@/core/auth/connection");
  const { bindAuthorityResolver } = await import("@/lib/authority");

  // The data-access boundary asks the runtime who is calling. Bound before anything can serve a
  // request, and bound unconditionally: an unbound resolver refuses every protected read, which is
  // the correct failure but a needless one.
  bindAuthorityResolver();

  if (!process.env.ASCEND_DATABASE_URL) {
    // Fail LOUD but do not crash the process: a server that cannot authenticate should start and
    // refuse logins with a diagnosable log line, not exit and take the login page with it.
    console.error("[startup] ASCEND_DATABASE_URL is not set — authentication will refuse every login.");
    return;
  }

  try {
    const pool = createPool("app");
    // Prove the connection works NOW rather than on the first login. `withConnection` asserts
    // verified TLS on every checkout, so this also proves the certificate chain at startup.
    await withConnection(pool, (c) => c.query("SELECT 1"));
    registerAppDb((fn) => withConnection(pool, fn));
    console.info("[startup] application database bound (TLS-verified, pooled, no ambient identity).");
  } catch (e) {
    console.error(`[startup] application database unavailable: ${(e as Error).message}`);
  }
}
