// Layer A — THE STARTUP-BINDING PROOF (2G.1 slice 5, STAGE2G §24). BOUNDED EVIDENCE.
//
// ─── WHAT WAS OPEN, AND WHY THE OBVIOUS TEST COULD NOT CLOSE IT ────────────────────────────────
//
// `07c9333` moved the authority-resolver slot to `globalThis[Symbol.for(...)]` because this module
// is emitted into 20–35 server chunks and a bare `let` is one slot PER COPY. That fixed the
// IMPLEMENTATION and proved nothing about startup: every existing suite registers its own resolver,
// and a self-registering probe can only demonstrate that it can register itself.
//
// Within one realm the registry is shared BY CONSTRUCTION — `Symbol.for` is process-wide and
// `globalThis` is per-realm. So module duplication is no longer the risk. RUNTIME TOPOLOGY is: if
// Next served requests from a worker thread or a second process, `globalThis` would differ and
// startup binding would not reach the consumer. Reasoning cannot settle that. Only running the real
// server can, which is what this file does.
//
// ─── NOTHING HERE REGISTERS A RESOLVER ─────────────────────────────────────────────────────────
//
// No probe route, no probe page, no stub inside the server. The application boots from its own tree
// with its own `instrumentation.ts`, and the only thing this file supplies is a valid session
// cookie. A resolver that answers can therefore only have come from `register()`.
//
// ─── TWO ENTRY POINTS, BECAUSE THEY ARE SEPARATE CHUNK GRAPHS ──────────────────────────────────
//
// A route handler and a Server Component render are compiled into different graphs. Observing ONE
// startup registration from BOTH is the evidence that the registry is shared across duplicated
// entry points — the property `07c9333` asserted and could not demonstrate.
//
// ─── THE OBSERVABLE IS THE BODY, NEVER THE STATUS ──────────────────────────────────────────────
//
// MEASURED: `app/api/console/search/route.ts` catches everything and returns
// `200 {objects: [], commands: [], error: "Search unavailable"}`. A production server whose resolver
// was never bound would answer search with SUCCESS AND ZERO RESULTS — no 500, no alarm. `commands`
// is the sharpest discriminator because in the success path it comes from the STATIC command
// catalog and depends on no vault content at all, while the catch empties it regardless.
//
// ─── THE BOUND — recorded as a fact, not a footnote (§24.4) ────────────────────────────────────
//
//   Real Next startup binding is proven IN THE TESTED SERVER PROCESS: instrumentation registration
//   reaches the resolver consumed by independent route and render entry points. CROSS-PROCESS /
//   WORKER-REALM TOPOLOGY IS NOT EXERCISED.
//
// A true out-of-process negative control was designed and REFUSED, not missed. A symlinked mirror
// minus `instrumentation.ts` is rejected by Turbopack ("Symlink [project]/package.json is invalid,
// it points out of the filesystem root") and `next dev` takes no `--config` override; displacing
// `instrumentation.ts` in the real tree was refused because two peer sessions were active on it.
// The negative control below is therefore IN-PROCESS: the same handler and the same observable,
// with no resolver bound, must produce the known failure shape.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { connectionConfigFor } from "@/core/db";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";

const ENABLED = process.env.ASCEND_STARTUP_TEST === "1";
const APP = process.env.ASCEND_DATABASE_URL;
const ADMIN = process.env.ASCEND_TEST_DATABASE_URL;
const SECRET = process.env.ASCEND_OS_SESSION_SECRET;
const READY = ENABLED && APP && ADMIN && SECRET;
const describeIfStartup = READY ? describe : describe.skip;

const PORT = 3213;
const BASE = `http://127.0.0.1:${PORT}`;
/** Matches "Open prospect" in the STATIC command catalog — no vault content involved. */
const TERM = "prospect";

describeIfStartup("STARTUP BINDING against the real application wiring (ASCEND_STARTUP_TEST=1)", () => {
  let server: ChildProcess;
  let cookie = "";
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  let tsconfigBefore = "";

  beforeAll(async () => {
    tsconfigBefore = readFileSync(tsconfigPath, "utf8");

    // The owner's real user id, read through the ADMIN connection. The session must belong to a user
    // that `resolvePrincipal` can actually resolve a membership for — a synthetic id would fail at
    // the trust boundary and tell us nothing about the resolver.
    const admin = new Pool({ ...connectionConfigFor(ADMIN!), max: 1 });
    const c = await admin.connect();
    let ownerId = "";
    try {
      // `disabled_at` lives on USERS, not memberships — a membership row records the role, the
      // user row records whether the account is live.
      const { rows } = await c.query(
        `SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id
          WHERE m.role = 'owner' AND u.disabled_at IS NULL LIMIT 1`);
      ownerId = rows[0]?.id ?? "";
    } finally { c.release(); await admin.end(); }
    expect(ownerId, "no owner membership exists to authenticate as").toBeTruthy();

    const token = await createSessionToken({ configured: true, secret: SECRET! }, ownerId);
    cookie = `${SESSION_COOKIE}=${encodeURIComponent(token!)}`;

    // The REAL tree, the REAL instrumentation. Env is inherited so startup binds the real pool.
    server = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], {
      cwd: process.cwd(), env: { ...process.env }, stdio: "ignore", detached: false,
    });

    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`${BASE}/login`);
        if (r.status < 500) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, 240_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    server?.kill("SIGKILL");
    // `next dev` writes route types under .next/dev and rewrites tsconfig.json. Left behind, the
    // first makes `tsc` report errors against a tree `git status` calls clean, and the second dirties
    // version control — the trap recorded in §14. Clean up in BOTH worlds, and assert it.
    rmSync(path.join(process.cwd(), ".next", "dev"), { recursive: true, force: true });
    if (readFileSync(tsconfigPath, "utf8") !== tsconfigBefore) writeFileSync(tsconfigPath, tsconfigBefore);
    expect(readFileSync(tsconfigPath, "utf8"), "tsconfig.json was left modified by next dev")
      .toBe(tsconfigBefore);
  }, 60_000);

  it("ROUTE CHUNK · a protected search resolves authority bound by startup alone", async () => {
    const res = await fetch(`${BASE}/api/console/search?q=${TERM}`, { headers: { cookie } });
    expect(res.status, "the perimeter rejected a valid owner session").toBe(200);
    const body = await res.json() as { objects: unknown[]; commands: unknown[]; error?: string };

    // THE DISCRIMINATOR. Unbound → the route's catch → `{objects: [], commands: [], error: …}`.
    expect(body.error,
      "the search route fell into its catch — with a valid session and a live database, the " +
      "remaining cause is that no authority resolver was bound at startup").toBeUndefined();
    expect(body.commands.length,
      "the STATIC command catalog came back empty, which is the unbound-resolver failure shape"
    ).toBeGreaterThan(0);
  }, 120_000);

  it("RENDER CHUNK · a Server Component page resolves the SAME startup registration", async () => {
    // A different compiled graph from the route above. One `register()` call, observed from both, is
    // the evidence that the globalThis registry is genuinely shared across entry points.
    const res = await fetch(`${BASE}/console?q=${TERM}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Unbound → buildKnowledgeIndex throws NoAuthority → app/error.tsx.
    expect(html, "the render fell to the error boundary").not.toContain("This view could not be loaded");
    expect(html, "the render was denied rather than served").not.toContain("You don&#x27;t have access");
    expect(html.length).toBeGreaterThan(500);
  }, 120_000);
});

// ─── THE NEGATIVE CONTROL — in-process, and the same observable ────────────────────────────────

describe("§24 CONTROL · the observable flips when no resolver is bound", () => {
  it("the SAME handler, with no startup registration, returns the failure shape", async () => {
    // This is what makes the two assertions above mean something. If the search route answered
    // identically with and without a resolver, the real-server result would be green for a reason
    // unrelated to startup binding.
    const { bindOperatorDb, removeStubDb, resetMemberships, tokenFor, requestAs, TEST_OWNER_ID, TEST_SECRET } =
      await import("@/tests/support/operator-session");
    const { clearAuthorityResolver } = await import("@/core/auth/authority");

    const saved = process.env.ASCEND_OS_SESSION_SECRET;
    process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
    try {
      // A connection IS supplied — the trust boundary needs one to resolve a principal at all. What
      // is deliberately NOT supplied is the resolver, so the only missing thing is what startup
      // would have bound. `installStubDb()` is avoided precisely because it binds one.
      await bindOperatorDb();
      resetMemberships();
      clearAuthorityResolver();

      const { GET } = await import("@/app/api/console/search/route");
      const token = await tokenFor(TEST_OWNER_ID);
      const res = await GET(requestAs(token, `https://os.test/api/console/search?q=${TERM}`));
      const body = await res.json() as { objects: unknown[]; commands: unknown[]; error?: string };

      expect(res.status, "the failure shape is a 200 — which is why the body is the observable").toBe(200);
      expect(body.error).toBe("Search unavailable");
      expect(body.commands).toEqual([]);
      expect(body.objects).toEqual([]);
    } finally {
      removeStubDb();
      if (saved === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
      else process.env.ASCEND_OS_SESSION_SECRET = saved;
    }
  });
});

describe("startup binding — guard", () => {
  it("announces loudly when the real-server proof has NOT run", () => {
    if (!READY) {
      console.warn(
        "\n  ⚠️  STARTUP BINDING NOT VERIFIED — needs ASCEND_STARTUP_TEST=1 plus\n" +
        "      ASCEND_DATABASE_URL, ASCEND_TEST_DATABASE_URL and ASCEND_OS_SESSION_SECRET.\n" +
        "      Nothing else in the suite proves that the APPLICATION'S OWN startup binds the\n" +
        "      resolver that protected reads consume — every other suite registers its own.\n"
      );
    }
    expect(true).toBe(true);
  });
});
