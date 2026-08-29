// core/db/pool — the ONLY way this system opens a database connection.
//
// `client.ts` defines the contract; this file is the one implementation of it that talks to a real
// server, and it exists so that "every application connection is TLS-verified" is a property of the
// construction path rather than a rule each caller is trusted to remember.
//
// ─── WHY THIS FILE REFUSES `connectionString` ──────────────────────────────────────────────────
//
// The obvious implementation is `new Pool({ connectionString, ssl: verifiedTlsOptions() })`. It is
// wrong, and it fails OPEN. In `pg/lib/connection-parameters.js`:
//
//     config = Object.assign({}, config, parse(config.connectionString))
//
// The parsed URL is assigned OVER the explicit config, so anything the URL says about SSL wins. And
// `pg-connection-string` turns `sslmode` into exactly the settings this module exists to prevent:
// `sslmode=require` sets `rejectUnauthorized = false`, and `verify-ca` installs
// `checkServerIdentity = function () {}`, which disables hostname checking outright.
//
// So a URL ending `?sslmode=require` — the string half the internet recommends, and the one a
// hosting dashboard is most likely to hand you — would SILENTLY discard the pinned CA. The code
// would read as though it verified certificates, the connection would still succeed, and nothing
// would ever report the difference.
//
// The fix is structural: never hand `pg` a connection string. This module parses the URL itself,
// passes discrete fields, and supplies `ssl` as the only source of TLS truth. A URL that tries to
// speak about SSL is rejected rather than obeyed, because there is no reading of such a URL that is
// safe to honour — it can only ever weaken what is configured here.
//
// ─── TWO ENDPOINTS, DIFFERENT JOBS ─────────────────────────────────────────────────────────────
//
//   app        the transaction pooler (port 6543) — short-lived statements, many connections
//   migration  the direct connection (port 5432)  — DDL, and anything needing session state
//
// The pooler multiplexes transactions across backends, so session-scoped state does not survive it;
// that is precisely why `asPrincipal` uses `SET LOCAL` and why the isolation gate runs against the
// POOLER rather than the direct endpoint. Migrations take the direct endpoint because DDL under a
// transaction pooler is not reliably session-consistent.

import "server-only";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { TLSSocket } from "node:tls";
import type { SqlClient, SqlValue } from "./client";
import { assertNodeTlsNotDisabled, TlsConfigurationError, verifiedTlsOptions } from "./tls";

/** `app` → transaction pooler. `migration` → direct connection. */
export type DbEndpoint = "app" | "migration";

const ENV_FOR: Record<DbEndpoint, string> = {
  app: "ASCEND_DATABASE_URL",
  migration: "ASCEND_DATABASE_URL_DIRECT",
};

export class DatabaseUrlError extends Error {}

/** Every SSL-related libpq parameter. Presence of ANY of them is a rejection, never a negotiation. */
const SSL_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslnegotiation"];

/**
 * Turn a connection URL into a `pg` config whose TLS posture cannot be overridden.
 *
 * Exported for the gate: the assertion that a URL carrying `sslmode=require` is REFUSED is the test
 * that this module's central claim is true, and it must be checkable without opening a socket.
 */
export function connectionConfigFor(url: string, endpoint: DbEndpoint = "app"): PoolConfig {
  assertNodeTlsNotDisabled();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseUrlError(`${ENV_FOR[endpoint]} is not a valid URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DatabaseUrlError(
      `${ENV_FOR[endpoint]} must be a postgres:// URL (got "${parsed.protocol}//…").`
    );
  }

  const offending = SSL_PARAMS.filter((p) => parsed.searchParams.has(p));
  if (offending.length > 0) {
    throw new DatabaseUrlError(
      `${ENV_FOR[endpoint]} carries SSL parameter(s) [${offending.join(", ")}]. They are refused ` +
        "rather than merged: pg assigns parsed connection-string values OVER the explicit ssl " +
        "config, so these would silently replace the pinned CA and, for sslmode=require, disable " +
        "certificate verification entirely. Remove them — TLS is configured in core/db/tls.ts."
    );
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname) throw new DatabaseUrlError(`${ENV_FOR[endpoint]} has no host.`);
  if (!parsed.username) throw new DatabaseUrlError(`${ENV_FOR[endpoint]} has no username.`);
  if (!database) throw new DatabaseUrlError(`${ENV_FOR[endpoint]} names no database.`);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    // Credentials arrive percent-encoded in a URL; `pg` receives them decoded.
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    ssl: verifiedTlsOptions(),
  };
}

/** Read the URL for an endpoint, failing loudly rather than defaulting to the other one. */
export function databaseUrlFor(endpoint: DbEndpoint): string {
  const name = ENV_FOR[endpoint];
  const value = process.env[name]?.trim();
  if (!value) {
    throw new DatabaseUrlError(
      `${name} is not set. The ${endpoint === "app" ? "transaction pooler" : "direct"} connection ` +
        "has no default: guessing the other endpoint would run DDL through a transaction pooler, " +
        "or run the application without pooling."
    );
  }
  return value;
}

/**
 * Build a pool. TLS-verified by construction — there is no option to weaken it.
 *
 * `max` is exposed because the isolation gate needs `max: 1` to force every request onto one
 * physical connection; a larger pool can hide an identity leak behind luck.
 */
export function createPool(endpoint: DbEndpoint, options: { max?: number } = {}): Pool {
  const config = connectionConfigFor(databaseUrlFor(endpoint), endpoint);
  return new Pool({ ...config, ...(options.max === undefined ? {} : { max: options.max }) });
}

/**
 * The live TLS socket behind a checked-out client, or `null` if the session is not encrypted.
 *
 * THIS IS THE ONLY HONEST MEASUREMENT OF TLS THROUGH A POOLER, and the reason it exists is a defect
 * this gate previously had: it asserted `pg_stat_ssl.ssl = true`. Against Supavisor that reads
 * FALSE even on a fully encrypted session, because `pg_stat_ssl` describes the POOLER→POSTGRES hop,
 * which is internal to the provider. The hop that carries our credentials over the public internet
 * is CLIENT→POOLER, and no SQL query can see it — only the socket can.
 *
 * `pg` replaces `connection.stream` with the `TLSSocket` in `upgradeToSSL`, so an encrypted session
 * is exactly one whose stream is a TLSSocket that reports `encrypted`.
 */
export function tlsSocketOf(client: PoolClient): TLSSocket | null {
  const stream = (client as unknown as { connection?: { stream?: unknown } }).connection?.stream;
  const s = stream as TLSSocket | undefined;
  return s && s.encrypted === true ? s : null;
}

/**
 * Assert a checked-out connection is encrypted AND authenticated.
 *
 * `authorized` is the half that matters. `encrypted` alone is satisfied by a session negotiated
 * with any certificate at all, including an attacker's; `authorized` says the chain validated
 * against the pinned root and the hostname matched.
 */
export function assertVerifiedTls(client: PoolClient): TLSSocket {
  const socket = tlsSocketOf(client);
  if (!socket) {
    throw new TlsConfigurationError(
      "The database connection is NOT encrypted. Supabase accepts plaintext sessions, so this " +
        "fails silently unless it is checked."
    );
  }
  if (socket.authorized !== true) {
    throw new TlsConfigurationError(
      "The database connection is encrypted but NOT authenticated: " +
        `${socket.authorizationError ?? "unknown verification failure"}. The session is confidential ` +
        "to whoever answered, which on a hostile network is the attacker."
    );
  }
  return socket;
}

/**
 * Walk a verified session's chain to its root — the self-signed certificate at the top.
 *
 * `getPeerX509Certificate()` returns the LEAF, and `.issuerCertificate` steps one link toward the
 * root, not all the way to it: for these endpoints the leaf's issuer is `Supabase Intermediate 2021
 * CA`, so a single step lands on the intermediate. Walking until a certificate is its own issuer is
 * what actually reaches the anchor.
 *
 * This is defence in depth rather than the primary control. `authorized === true` already implies
 * the chain terminated at the pinned root, because that root is the ONLY CA supplied. Checking the
 * fingerprint too means a future change that widens the trust set — adding a second CA, or falling
 * back to the system store — is caught by a test that names the anchor explicitly.
 */
export function chainRootOf(socket: TLSSocket): { subject: string; fingerprint256: string } | null {
  let cert = socket.getPeerX509Certificate();
  const seen = new Set<string>();
  while (cert && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    const issuer = cert.issuerCertificate;
    // A root is its own issuer; `issuerCertificate` may also be undefined at the top of the chain.
    if (!issuer || issuer.fingerprint256 === cert.fingerprint256) {
      return { subject: cert.subject, fingerprint256: cert.fingerprint256 };
    }
    cert = issuer;
  }
  return null;
}

/**
 * Adapt one POOLED connection to `SqlClient`.
 *
 * Deliberately takes a checked-out client rather than the pool: a transaction must run on ONE
 * connection, and a `SqlClient` backed by `pool.query` would scatter `BEGIN`, the statements, and
 * `COMMIT` across arbitrary connections — which for `asPrincipal` means the `SET LOCAL` binding the
 * identity could land on a different connection from the query it is supposed to govern.
 */
export function adaptPoolClient(client: PoolClient): SqlClient {
  const c: SqlClient = {
    async query(sql, params) {
      const res = await client.query(sql, params ? [...(params as SqlValue[])] : undefined);
      return { rows: (res.rows ?? []) as never[], affected: res.rowCount ?? 0 };
    },
    async exec(sql) {
      await client.query(sql);
    },
    async transaction(fn) {
      await client.query("BEGIN");
      try {
        const out = await fn(c);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    },
  };
  return c;
}

/**
 * Check out a connection, verify its TLS posture, run `fn`, and release it.
 *
 * Verification happens on EVERY checkout rather than once at startup. A pool replaces dead
 * connections silently, so a one-time check at boot proves nothing about the connection serving any
 * particular request.
 */
export async function withConnection<T>(pool: Pool, fn: (c: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    assertVerifiedTls(client);
    return await fn(adaptPoolClient(client));
  } finally {
    client.release();
  }
}
