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
// SESSION FORMAT: `v1.<expiryEpochMs>.<base64url(HMAC-SHA256(secret, "v1.<expiryEpochMs>"))>`
// Stateless and self-verifying: no session store, no database, no vault write. Rotating
// ASCEND_OS_SESSION_SECRET invalidates every outstanding session.

/** Cookie name carrying the signed operator session. */
export const SESSION_COOKIE = "ascend_os_session";

/** Session lifetime: 12 hours — one working day, re-auth required the next. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const TOKEN_VERSION = "v1";

/**
 * Configuration state. `configured: false` means the perimeter cannot verify anyone, which the
 * middleware treats as DENY (fail closed) rather than allow.
 */
export type AuthConfig =
  | { configured: true; password: string; secret: string }
  | { configured: false; missing: string[] };

export function readAuthConfig(): AuthConfig {
  const password = process.env.ASCEND_OS_PASSWORD;
  const secret = process.env.ASCEND_OS_SESSION_SECRET;
  const missing: string[] = [];
  if (!password) missing.push("ASCEND_OS_PASSWORD");
  if (!secret) missing.push("ASCEND_OS_SESSION_SECRET");
  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, password: password as string, secret: secret as string };
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

/** Verify a submitted password against the configured one, in constant time. */
export function verifyPassword(submitted: string, config: AuthConfig): boolean {
  if (!config.configured) return false;
  return timingSafeEqual(submitted, config.password);
}

/** Mint a signed session token valid for SESSION_TTL_MS from `now`. */
export async function createSessionToken(config: AuthConfig, now: number = Date.now()): Promise<string | null> {
  if (!config.configured) return null;
  const payload = `${TOKEN_VERSION}.${now + SESSION_TTL_MS}`;
  return `${payload}.${await sign(payload, config.secret)}`;
}

/**
 * Verify a session token: correct shape, unexpired, and a signature this secret produced.
 * Returns false for every failure mode — malformed, expired, forged, or unconfigured — and never
 * throws, so a hostile cookie value cannot crash the middleware.
 */
export async function verifySessionToken(
  token: string | undefined,
  config: AuthConfig,
  now: number = Date.now()
): Promise<boolean> {
  if (!token || !config.configured) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expRaw, signature] = parts;
  if (version !== TOKEN_VERSION) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return false;

  try {
    const expected = await sign(`${version}.${expRaw}`, config.secret);
    return timingSafeEqual(signature, expected);
  } catch {
    return false; // never let a crypto failure surface as a 500 from the perimeter
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