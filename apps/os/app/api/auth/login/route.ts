// app/api/auth/login — exchange the operator password for a signed session cookie.
// Perimeter only: no vault access, no read-model, no event emission, no architectural role.

import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  readAuthConfig,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Uniform failure. Never distinguishes "wrong password" from "perimeter unconfigured". */
function deny() {
  return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
}

export async function POST(req: Request) {
  const config = readAuthConfig();

  // Fail closed: an unconfigured perimeter authenticates nobody. Logged server-side (no secrets)
  // so the operator can diagnose a lockout without the response disclosing configuration state.
  if (!config.configured) {
    console.error(`[auth] login refused — perimeter unconfigured; missing: ${config.missing.join(", ")}`);
    return deny();
  }

  let password = "";
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { password?: unknown };
      password = typeof body.password === "string" ? body.password : "";
    } else {
      const form = await req.formData();
      const value = form.get("password");
      password = typeof value === "string" ? value : "";
    }
  } catch {
    return deny(); // malformed body is a failed login, not a 500
  }

  if (!password || !verifyPassword(password, config)) return deny();

  const token = await createSessionToken(config);
  if (!token) return deny();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(new URL(req.url).protocol === "https:"));
  return res;
}