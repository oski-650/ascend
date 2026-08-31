// tests/db/savepoint-client — run a function that opens its OWN transaction inside one you control.
//
// ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
//
// `acceptInvitation` opens a transaction, as it must: the credential write and the token burn share
// one success/failure boundary. To exercise it against PRODUCTION without changing production, the
// whole thing has to sit inside an outer transaction that is rolled back — and a nested `BEGIN` is
// not a transaction, it is a warning and a no-op.
//
// So the test supplies a client whose `transaction()` is a SAVEPOINT. The production code is
// UNMODIFIED: adding an "already inside a transaction" mode to `acceptInvitation` would be weakening
// the implementation to accommodate a caller, which is the thing this project keeps refusing.
//
// ─── WHAT A SAVEPOINT DOES AND DOES NOT GIVE ───────────────────────────────────────────────────
//
// Same atomicity for the enclosed work: on failure everything since the savepoint is discarded and
// the outer transaction survives. What it does NOT give is a commit — which is the point here, and
// also the stated limitation of any proof built on it: it shows the acceptance transaction EXECUTES
// CORRECTLY, never that a committed acceptance survives the transaction boundary.
//
// One caveat worth knowing rather than discovering: `SET LOCAL` is TRANSACTION-scoped, not
// savepoint-scoped. A role assumed inside a released savepoint persists into the outer transaction,
// so callers that switch roles should reset explicitly between phases.

import type { SqlClient, SqlValue } from "@/core/db";

/**
 * Wrap `base` so that `transaction(fn)` runs `fn` inside a SAVEPOINT rather than a BEGIN/COMMIT.
 *
 * The caller is responsible for opening and finally rolling back the outer transaction — this
 * deliberately cannot do it, so nothing here can accidentally commit.
 */
export function savepointClient(base: SqlClient): SqlClient {
  let depth = 0;
  const client: SqlClient = {
    query: <T>(sql: string, params?: readonly SqlValue[]) => base.query<T>(sql, params),
    exec: (sql: string) => base.exec(sql),
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      // Named and depth-counted so nesting works — `asPrincipal` opens one, and the code it wraps
      // may open another.
      const name = `sp_${++depth}`;
      await base.query(`SAVEPOINT ${name}`);
      try {
        const out = await fn(client);
        await base.query(`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (e) {
        await base.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await base.query(`RELEASE SAVEPOINT ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return client;
}
