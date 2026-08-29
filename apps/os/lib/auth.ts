// lib/auth.ts — the operator AUTHENTICATION PERIMETER (hardening pass, not an architectural layer).
//
// SCOPE: this module answers exactly one question — "is this request from the authenticated
// operator?" It is a perimeter, NOT a member of the domain → core → engines → mission-control →
// surface layering. It owns NO read-model, NO derivation, NO business fact, NO scoring, NO ranking,
// and NO persistence. It reads two environment variables and performs HMAC over a timestamp. Nothing
// here participates in any frozen contract.
//
// RUNTIME: uses Web Crypto (`crypto.subtle`) ONLY — no `node:crypto`, no `server-only` — so the same
// code runs unchanged in the Edge runtime (middleware.ts) and the Node runtime (route handlers).
//
// SESSION FORMAT (v2): `v2.<userId>.<expiryEpochMs>.<base64url(HMAC-SHA256(secret, "v2.<userId>.<expiryEpochMs>"))>`
//
// THE USER IS INSIDE THE SIGNATURE. v1 carried only an expiry, so a valid session identified nobody
// — which is how the system reached 2F with one shared password and no concept of a user. Tampering
// with `userId` now invalidates the signature.
//
// WHAT THE TOKEN DOES NOT CARRY: role, organization. Not "ignored" — ABSENT. There is no field to
// forge. Authorization resolves both from `memberships` per request (core/auth/principal), so a
// revoked membership takes effect on the next request rather than at token expiry.
//
// v1 TOKENS ARE REJECTED, not upgraded. Accepting them would leave a token type in circulation that
// names no user, which is precisely the defect being removed.
//
// Stateless and self-verifying: no session store, no database read in the perimeter. Rotating
// ASCEND_OS_SESSION_SECRET invalidates every outstanding session.

/** Cookie name carrying the signed operator session. */
export const SESSION_COOKIE = "ascend_os_session";

/** Session lifetime: 12 hours — one working day, re-auth required the next. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const TOKEN_VERSION = "v2";

/**
 * Configuration state. `configured: false` means the perimeter cannot verify anyone, which the
 * middleware treats as DENY (fail closed) rather than allow.
 */
export type AuthConfig =
  | { configured: true; secret: string }
  | { configured: false; missing: string[] };

/**
 * The perimeter needs a signing secret and NOTHING ELSE.
 *
 * `ASCEND_OS_PASSWORD` is gone. It was a single shared credential that granted every route to
 * anyone holding it, which made "give the partner access" and "give the partner finance and admin"
 * the same act. Credentials now live per user in `users.password_hash`.
 */
export function readAuthConfig(): AuthConfig {
  const secret = process.env.ASCEND_OS_SESSION_SECRET;
  if (!secret) return { configured: false, missing: ["ASCEND_OS_SESSION_SECRET"] };
  return { configured: true, secret };
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/**
 * Constant-time string comparison. Compares every character regardless of early mismatch so the
 * duration of the comparison does not leak how much of the value was correct.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Mint a signed session for a SPECIFIC user.
 *
 * `userId` is part of the signed payload. It is the only claim the session makes, and deliberately
 * so: role and organization are resolved from the database, never carried here.
 */
export async function createSessionToken(
  config: AuthConfig,
  userId: string,
  now: number = Date.now()
): Promise<string | null> {
  if (!config.configured) return null;
  // A `.` in the id would make the token ambiguous to parse. UUIDs never contain one; refusing is
  // cheaper than inventing an escaping scheme for a value that should never need it.
  if (!userId || userId.includes(".")) return null;
  const payload = `${TOKEN_VERSION}.${userId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${await sign(payload, config.secret)}`;
}

/** What a valid session establishes: WHICH user. Nothing more. */
export type SessionIdentity = { userId: string };

/**
 * Verify a session token and return WHO it identifies.
 *
 * Returns `null` for every failure — malformed, wrong version, expired, forged, unconfigured — and
 * never throws, so a hostile cookie cannot crash the middleware.
 *
 * It returns an identity rather than a boolean because a perimeter that answers "yes" without
 * saying who is exactly what let this system run for a year with no concept of a user.
 */
export async function verifySessionToken(
  token: string | undefined,
  config: AuthConfig,
  now: number = Date.now()
): Promise<SessionIdentity | null> {
  if (!token || !config.configured) return null;
  const parts = token.split(".");
  // Exactly four segments. A v1 token has three and is REJECTED here rather than upgraded.
  if (parts.length !== 4) return null;
  const [version, userId, expRaw, signature] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!userId) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return null;

  try {
    const expected = await sign(`${version}.${userId}.${expRaw}`, config.secret);
    return timingSafeEqual(signature, expected) ? { userId } : null;
  } catch {
    return null; // never let a crypto failure surface as a 500 from the perimeter
  }
}

/** Cookie attributes for the session. `secure` is omitted on http://localhost so dev works. */
export function sessionCookieOptions(isSecureRequest: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}