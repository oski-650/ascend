// core/auth/credentials — hashing and verifying a per-user password.
//
// ─── WHY THIS IS NOT IN lib/auth.ts ────────────────────────────────────────────────────────────
//
// `lib/auth.ts` runs in the EDGE runtime (middleware imports it), which restricts it to
// `crypto.subtle`. Edge has no memory-hard KDF: PBKDF2 is all `subtle` offers, and PBKDF2 is
// GPU-friendly in exactly the way password hashing must not be.
//
// Password verification happens only at `/api/auth/login`, a NODE route, so it is not bound by that
// restriction. Keeping the two runtimes apart is what buys a real KDF without weakening the
// perimeter: middleware still only verifies an HMAC, which Edge does fine.
//
// ─── SCRYPT, AND THE PARAMETERS RECORDED PER ROW ───────────────────────────────────────────────
//
// `users.password_algo` stores the algorithm and its cost parameters for THAT row, so raising the
// cost later does not invalidate existing credentials and does not require a flag day. A row hashed
// under older parameters still verifies under the parameters it was written with.
//
// The stored form is `scrypt$N$r$p$<salt-b64>$<hash-b64>` — self-describing, so verification never
// has to guess.

import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/** Current parameters. Raising these affects new credentials only; old rows verify as written. */
const CURRENT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, saltBytes: 16 } as const;
export const CURRENT_ALGO = `scrypt$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}`;

/** scrypt needs headroom above 128*N*r bytes or Node refuses with "memory limit exceeded". */
const maxmemFor = (N: number, r: number) => Math.max(32 * 1024 * 1024, 256 * N * r);

export class CredentialError extends Error {}

/**
 * Hash a password for storage.
 *
 * A fresh random salt per credential, so two users choosing the same password produce different
 * hashes and a precomputed table is worthless.
 */
export async function hashPassword(password: string): Promise<{ hash: string; algo: string }> {
  if (password.length < 12) {
    throw new CredentialError("password must be at least 12 characters");
  }
  const salt = randomBytes(CURRENT.saltBytes);
  const derived = await scrypt(password, salt, CURRENT.keylen, {
    N: CURRENT.N, r: CURRENT.r, p: CURRENT.p, maxmem: maxmemFor(CURRENT.N, CURRENT.r),
  });
  return {
    hash: `${CURRENT_ALGO}$${salt.toString("base64")}$${derived.toString("base64")}`,
    algo: CURRENT_ALGO,
  };
}

/**
 * Verify a submitted password against a stored hash.
 *
 * NEVER THROWS on a bad stored value. A malformed row is a failed login, not a 500 — an exception
 * here would let a corrupted credential become a denial-of-service, and would distinguish "broken
 * row" from "wrong password" in the response.
 *
 * The comparison is constant-time over the derived keys, so it does not leak how much of a guess
 * was correct.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Refuse absurd parameters from a tampered row rather than allocating gigabytes on demand.
    if (N > 2 ** 20 || r > 32 || p > 16) return false;

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
    return derived.length === expected.length && nodeTimingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * A dummy verification, for the path where no user matched.
 *
 * Returning early on "unknown email" makes a non-existent account answer measurably faster than a
 * real one with a wrong password — an oracle for who has an account. Burning a comparable amount of
 * work removes the signal.
 */
export async function burnVerification(password: string): Promise<void> {
  await verifyPassword(password, `${CURRENT_ALGO}$${randomBytes(16).toString("base64")}$${randomBytes(32).toString("base64")}`);
}

/**
 * Set a user's credential. ADMINISTRATIVE — run over the direct connection, never by the app.
 *
 * `ascend_auth` deliberately holds no UPDATE grant, so this cannot run as the application. In 2F
 * the owner and the partner are provisioned this way; the invite / password-set flow that would let
 * a person choose their own is 2G's, along with the UI it needs to live in.
 */
export async function setUserCredential(
  client: import("@/core/db").SqlClient,
  email: string,
  password: string
): Promise<void> {
  const { hash, algo } = await hashPassword(password);
  const { affected } = await client.query(
    `UPDATE users SET password_hash = $2, password_algo = $3, password_set_at = now()
     WHERE lower(email) = lower($1)`,
    [email, hash, algo]
  );
  if (affected !== 1) throw new CredentialError(`expected exactly one user for ${email}, updated ${affected}`);
}
