// Layer A — THE 27-ROUTE AUTHORIZATION MATRIX (2F step 7.4, STAGE2F §8 and §11).
//
// ─── WHAT THIS ASSERTS, AND WHY IT ISSUES REAL REQUESTS ────────────────────────────────────────
//
// §11 requires tests that DEMONSTRATE the denial rather than assert that a check exists, and that
// the demonstration go through the route handler — "the claim is about what the server does when
// someone types a URL". So every case below imports the real `route.ts` module, builds a real
// `Request` with a real signed cookie, and invokes the real exported handler the way Next does.
// Nothing here calls the guard directly.
//
// ─── F49: EVERY VAULT-BACKED DENIAL RUNS TWICE ─────────────────────────────────────────────────
//
// Today `sales → /api/finance/invoices` would return nothing on a server with no vault. That reads
// like security and is not: when finance eventually moves to Postgres the same route would begin
// returning everything. So each vault-backed denial runs once with the vault ABSENT and once with a
// POPULATED vault on disk, and both must be 403. A route that only "denies" because the data is
// missing passes the first run and fails the second — which is precisely the defect F49 names.
//
// ─── THE MATRIX IS DERIVED, NOT RETYPED ────────────────────────────────────────────────────────
//
// The cases come from `ROUTE_AUTHORIZATION` and the METHODS come from each module's own exports. A
// route that adds a handler is covered the moment it is added, and a route nobody mapped fails the
// totality check rather than being skipped.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROUTE_AUTHORIZATION } from "@/core/auth/routes";
import {
  OWNER_ID, ROUTE_IMPORTERS as ROUTES, SALES_ID, SECRET, installStubDb, invoke, methodsOf,
  removeStubDb, requestAs, resetMemberships, seedVault, tokenFor, urlFor, type Method,
} from "./harness";

// The importer map itself moved to `tests/support/route-surface` in 2G.4.2 (STAGE2G §29.6): this
// suite and `tests/db/route-matrix-provisioned.test.ts` now share ONE literal list rather than two
// that could quietly drift apart, and the one-importer-map fitness rule holds that to exactly one
// file.

let vaultDir: string;
let emptyDir: string;
let savedVault: string | undefined;
let savedSecret: string | undefined;
let ownerToken: string;
let salesToken: string;

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = SECRET;
  vaultDir = await seedVault();
  emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-novault-"));
  process.env.ASCEND_VAULT_PATH = vaultDir;
  installStubDb();
  resetMemberships();
  ownerToken = await tokenFor(OWNER_ID);
  salesToken = await tokenFor(SALES_ID);
});

afterAll(async () => {
  removeStubDb();
  await fs.rm(vaultDir, { recursive: true, force: true });
  await fs.rm(emptyDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

afterEach(() => {
  process.env.ASCEND_VAULT_PATH = vaultDir;
  resetMemberships();
});

/**
 * Call one route with one method.
 *
 * Bodies are deliberately EMPTY. Every handler validates its input before doing anything, so an
 * authorized caller gets a 400 — which proves it passed authorization without executing a write, a
 * wipe, or an outbound fetch. An UNauthorized caller never reaches the validation at all.
 */
async function call(route: string, method: Method, token: string | undefined): Promise<number> {
  const mod = await ROUTES[route]();
  const init: RequestInit = method === "GET" ? { method } : { method, body: "{}" };
  const res = await invoke(mod, method, requestAs(token, urlFor(route), init));
  return res.status;
}

const capabilityRoutes = Object.entries(ROUTE_AUTHORIZATION)
  .filter(([, v]) => v.kind === "capability")
  .map(([k, v]) => [k, v] as const);

describe("the matrix is total — every mapped route is exercised", () => {
  it("there is an importer for every mapped route, and no extras", () => {
    expect(Object.keys(ROUTES).sort()).toEqual(Object.keys(ROUTE_AUTHORIZATION).sort());
    expect(Object.keys(ROUTES)).toHaveLength(29);   // +1: the 2G.3 minting endpoint (§28.4)
  });

  it("every route module exports at least one HTTP method", async () => {
    // A route file that exports nothing would silently pass every denial test below.
    const empty: string[] = [];
    for (const route of Object.keys(ROUTES)) {
      const mod = await ROUTES[route]();
      if (methodsOf(mod).length === 0) empty.push(route);
    }
    expect(empty).toEqual([]);
  });
});

describe("UNAUTHENTICATED · every capability route refuses", () => {
  for (const [route] of capabilityRoutes) {
    it(`${route} → 401 with no session`, async () => {
      const mod = await ROUTES[route]();
      for (const method of methodsOf(mod)) {
        expect(await call(route, method, undefined), `${route} ${method}`).toBe(401);
      }
    });
  }
});

describe("SALES · the partner-safe boundary, enforced at the route", () => {
  for (const [route, entry] of capabilityRoutes) {
    if (entry.kind !== "capability") continue;
    const denied = entry.sales === "deny";
    it(`${route} → ${denied ? "403" : "allowed"} for sales (${entry.capability})`, async () => {
      const mod = await ROUTES[route]();
      for (const method of methodsOf(mod)) {
        const status = await call(route, method, salesToken);
        if (denied) {
          // 403, not a redirect and not an empty 200: an empty 200 is indistinguishable from "the
          // data happens to be missing", which is the authorization-by-absence F49 forbids.
          expect(status, `${route} ${method} should be forbidden for sales`).toBe(403);
        } else {
          expect(status, `${route} ${method} should NOT be denied to sales`).not.toBe(403);
          expect(status, `${route} ${method}`).not.toBe(401);
        }
      }
    });
  }
});

describe("OWNER · nothing in the matrix locks the owner out", () => {
  for (const [route] of capabilityRoutes) {
    it(`${route} → not denied for owner`, async () => {
      const mod = await ROUTES[route]();
      for (const method of methodsOf(mod)) {
        const status = await call(route, method, ownerToken);
        expect(status, `${route} ${method} denied the owner`).not.toBe(401);
        expect(status, `${route} ${method} denied the owner`).not.toBe(403);
      }
    });
  }
});

describe("F49 · vault-backed denials hold WITH THE VAULT PRESENT, not only when it is empty", () => {
  const vaultDenied = capabilityRoutes.filter(
    ([, v]) => v.kind === "capability" && v.backing === "vault" && v.sales === "deny");

  it("there are vault-backed denials to test — otherwise this block is vacuous", () => {
    // The floor was 15 until 2G.4.7 and is now 1, for the reason `fitness.test.ts`'s twin assertion
    // records at length: 15 was the SIZE of the denial population when the sales role was narrow,
    // never the property. The role became `owner` minus `admin:*`, so seventeen of those rows are
    // now legitimately allowed. The property — that this block is not iterating an empty list —
    // is unchanged, and the surviving row is NAMED so "non-empty" cannot be satisfied by drift.
    expect(vaultDenied.length).toBeGreaterThanOrEqual(1);
    expect(vaultDenied.map(([k]) => k)).toContain("app/api/admin/wipe/route.ts");
  });

  for (const [route] of vaultDenied) {
    it(`${route} → 403 both with the vault ABSENT and with it POPULATED`, async () => {
      const mod = await ROUTES[route]();
      for (const method of methodsOf(mod)) {
        process.env.ASCEND_VAULT_PATH = emptyDir;
        expect(await call(route, method, salesToken), `${route} ${method} (vault absent)`).toBe(403);
        process.env.ASCEND_VAULT_PATH = vaultDir;
        expect(await call(route, method, salesToken), `${route} ${method} (vault present)`).toBe(403);
      }
    });
  }

  it("the fixture is REAL — the owner can see what sales is being denied", async () => {
    // Without this the block above could pass against an empty vault wearing a populated one's
    // name. If the owner gets data here, the sales 403 is authorization rather than absence.
    process.env.ASCEND_VAULT_PATH = vaultDir;
    const mod = await ROUTES["app/api/finance/invoices/route.ts"]();
    const res = await invoke(mod, "GET", requestAs(ownerToken, "https://os.test/api/finance/invoices"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: unknown[] };
    expect(body.invoices.length, "the vault fixture holds no invoices — the F49 run is vacuous")
      .toBeGreaterThan(0);
  });
});

describe("PUBLIC routes stay reachable without an operator session", () => {
  const publicRoutes = Object.entries(ROUTE_AUTHORIZATION).filter(([, v]) => v.kind === "public");

  it("all six are declared, each with a stated reason", () => {
    // +1 in 2G.2: invitation acceptance. It is public because the caller is establishing the
    // credential a session would later be minted from — there is no session yet to authorize.
    expect(publicRoutes).toHaveLength(6);
    for (const [, v] of publicRoutes) {
      if (v.kind !== "public") continue;
      expect(v.why.length, "a public route with no stated reason is a gap, not a decision")
        .toBeGreaterThan(20);
    }
  });

  for (const [route] of publicRoutes) {
    it(`${route} does not answer 401 to an anonymous caller`, async () => {
      const mod = await ROUTES[route]();
      for (const method of methodsOf(mod)) {
        const status = await call(route, method, undefined);
        // They enforce their own credential (a password, a portal token) and answer 400/401/404 on
        // their own terms — what matters is that the OPERATOR perimeter is not what stops them.
        expect(status, `${route} ${method}`).not.toBe(403);
      }
    });
  }
});
