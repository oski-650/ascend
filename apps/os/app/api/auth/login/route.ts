// app/api/auth/login — exchange a PER-USER credential for a signed session cookie.
//
// Perimeter only: no vault access, no read-model, no event emission, no architectural role.
//
// ─── WHAT CHANGED IN 2F ────────────────────────────────────────────────────────────────────────
//
// This route used to compare one shared `ASCEND_OS_PASSWORD` and mint a session that named nobody.
// It now identifies a user, and the session it mints carries that user's id inside the signature.
//
// It still grants no authority. The token says WHO, never WHAT — role and organization are resolved
// from `memberships` on every request that needs them.
//
// ─── EVERY FAILURE LOOKS THE SAME ──────────────────────────────────────────────────────────────
//
// Unknown email, wrong password, disabled account, unconfigured perimeter, malformed body: one
// response, one status, and comparable timing. Login is the one endpoint an unauthenticated
// stranger can always reach, so any difference between those cases becomes a way to enumerate who
// has an account here.
//
// The timing half is why `burnVerification` exists: returning early when no user matched would make
// a non-existent account answer measurably faster than a real one.

import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, readAuthConfig, sessionCookieOptions } from "@/lib/auth";
import { burnVerification, verifyPassword } from "@/core/auth/credentials";
import { credentialFor } from "@/core/auth/principal";
import { requireAuthDb } from "@/core/auth/connection";

export const dynamic = "force-dynamic";
// scrypt is memory-hard and Node-only; this route must never be pushed to the Edge runtime.
export const runtime = "nodejs";

/** Uniform failure. Never distinguishes wrong password from unknown user or unconfigured perimeter. */
function deny() {
  return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
}

export async function POST(req: Request) {
  const config = readAuthConfig();
  if (!config.configured) {
    // Logged server-side (no secrets) so a lockout is diagnosable without the response disclosing
    // configuration state to whoever is knocking.
    console.error(`[auth] login refused — perimeter unconfigured; missing: ${config.missing.join(", ")}`);
    return deny();
  }

  let email = "";
  let password = "";
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { email?: unknown; password?: unknown };
      email = typeof body.email === "string" ? body.email : "";
      password = typeof body.password === "string" ? body.password : "";
    } else {
      const form = await req.formData();
      const e = form.get("email");
      const p = form.get("password");
      email = typeof e === "string" ? e : "";
      password = typeof p === "string" ? p : "";
    }
  } catch {
    return deny(); // a malformed body is a failed login, not a 500
  }

  if (!email || !password) {
    await burnVerification(password || "x");
    return deny();
  }

  let credential = null;
  try {
    const db = requireAuthDb();
    credential = await credentialFor(db, email);
  } catch (e) {
    console.error(`[auth] login refused — auth database unavailable: ${(e as Error).message}`);
    return deny();
  }

  // No such user, or a user with no credential set. Burn comparable work so the response time does
  // not distinguish this from a wrong password.
  if (!credential) {
    await burnVerification(password);
    return deny();
  }

  const ok = await verifyPassword(password, credential.passwordHash);

  // Checked AFTER the hash comparison, deliberately: short-circuiting on `disabled` would make a
  // disabled account respond faster than an active one, which is the same oracle in a new place.
  if (!ok || credential.disabled) return deny();

  const token = await createSessionToken(config, credential.userId);
  if (!token) return deny();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new URL(req.url).protocol === "https:"));
  return res;
}
