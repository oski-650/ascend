// Layer A — 2G.4.2 · THE ROUTE MATRIX UNDER RESOLVED AUTHORITY
// (STAGE2G §29.6, discharging §8 row 1 and row 6 ROUTE-SIDE).
//
// ─── WHAT THIS PROVES THAT `tests/api/route-matrix.test.ts` CANNOT ─────────────────────────────
//
// `tests/api/route-matrix.test.ts` proves the same 29 handlers answer the verdict `ROUTE_AUTHORIZATION`
// documents — through the real cookie → `sessionTokenFrom` → `verifySessionToken` → `requireAppDb` →
// `resolvePrincipal` → `can()` → handler chain — but with a REGEX-INTERCEPTING in-memory client
// standing in for `resolvePrincipal`'s one SELECT. This suite runs the identical requests against a
// REAL Postgres (PGlite, full migration set), with both principals obtained the way `tests/support/
// provisioned-partner.ts` obtains one: an operational INSERT, a real `createInvitation` /
// `acceptInvitation` transaction, a real `POST /api/auth/login`, and `resolvePrincipal` reading the
// row that chain wrote. No test declared a role; the database did.
//
// ─── THE TWO SLOTS, BOTH REGISTERED, FOR TWO DIFFERENT REASONS ─────────────────────────────────
//
//   registerAppDb          (core/auth/connection)  → ADMISSION. `lib/route-guard.ts` reads the
//                                                     cookie itself and calls `withRequestContext`,
//                                                     which calls `requireAppDb()`. It never asks the
//                                                     authority resolver anything.
//   bindAuthorityResolver  (lib/authority)          → what a `requireCapability()` call made INSIDE
//                                                     an admitted handler gets asked. `lib/authority`'s
//                                                     resolver, not `bindPartnerAuthority`: the latter
//                                                     pins ONE identity process-wide, so in a two-role
//                                                     matrix every OWNER request's internal checks
//                                                     would answer `sales`.
//
// Both are globalThis-keyed and leak across files in a worker, so both are registered in `beforeEach`
// and cleared in `afterEach` — the same discipline `tests/db/provisioned-partner.test.ts:60-68` uses.
//
// ─── WHY A 403 NEEDS NO VAULT-PRESENCE GUARD HERE ──────────────────────────────────────────────
//
// `forbidden()` (`lib/route-guard.ts`) is returned only from inside the `withRequestContext`
// callback, which runs only after `resolvePrincipal` succeeded against the real database. Every
// resolution failure exits earlier as 401. A 403 below is therefore a WITNESS that a real,
// DB-resolved principal existed — not a side effect of missing data, which is what F49 (proven
// against the stub suite) already forecloses for the vault-backed routes specifically.
//
// ─── WHY EVERY "NOT DENIED" CHECK ALSO DEMANDS `status < 500` ──────────────────────────────────
//
// `bindAuthorityResolver`'s fallback, `pageAuthority()`, reads `cookies()` and throws outside a
// request context — a 500. `not 401 && not 403` is silently SATISFIED by a 500, so every assertion
// below that means "this caller may proceed" checks all three.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { readAuthConfig, verifySessionToken } from "@/lib/auth";
import { registerAppDb, clearAppDb, requireAppDb } from "@/core/auth/connection";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { resolvePrincipal } from "@/core/auth/principal";
import { bindAuthorityResolver } from "@/lib/authority";
import { ROUTE_AUTHORIZATION } from "@/core/auth/routes";
import type { SqlClient } from "@/core/db";
import {
  SESSION_SECRET, bootDatabase, provisionPartner, tokenFor as tokenForUser, type World,
} from "@/tests/support/provisioned-partner";
import {
  ROUTE_IMPORTERS, capabilityRoutes, publicRoutes, invoke, methodsOf, requestAs, seedVault,
  urlFor, SHARED_TERM, type Method,
} from "@/tests/support/route-surface";

const PASSWORD = "a-sufficiently-long-matrix-partner-password";

let pg: PGlite;
let db: SqlClient;
let savedSecret: string | undefined;
let savedVault: string | undefined;
let vaultDir: string;
let ownerToken: string;
let salesToken: string;
let matrixWorld: World;

/**
 * One call, one status. Deliberately NOT parameterizable beyond `route`/`method`/`token`: a body is
 * always `"{}"` for a non-GET method and there is no argument through which a test could construct a
 * non-empty one.
 *
 * NOT "every handler validates its input before acting, so an authorized `"{}"` POST is always a
 * 400" — measured false (adversarial pass): `POST /api/time/stop` needs no input and returns 200,
 * performing a real read-modify-write over `time_log.jsonl` when an open time entry exists. It is a
 * no-op here only because `seedVault`'s fixture writes `ended_at`/`minutes`, while
 * `core/production/time.ts:40`'s `getActiveEntry` reads `ended` — so the fixture's entry never
 * matches `e.ended === null` and there is nothing for `stopActive` to close. The safety this suite's
 * owner calls rely on is FIXTURE-COUPLED, not structural, and would not hold against a differently-
 * shaped seed. See `app/api/admin/wipe/route.ts`'s own `assertDestructivePathAllowed` for the one
 * route where the safety IS structural, independent of any handler's input validation.
 */
async function call(route: string, method: Method, token: string | undefined): Promise<number> {
  const mod = await ROUTE_IMPORTERS[route]();
  const init: RequestInit = method === "GET" ? { method } : { method, body: "{}" };
  const res = await invoke(mod, method, requestAs(token, urlFor(route), init));
  return res.status;
}

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  savedVault = process.env.ASCEND_VAULT_PATH;
  vaultDir = await seedVault();
  process.env.ASCEND_VAULT_PATH = vaultDir;

  ({ pg, db } = await bootDatabase());
  // The login route inside `provisionPartner` reaches `requireAppDb()` on its own — registered here,
  // ahead of the per-test `beforeEach` below, so provisioning itself is admitted.
  registerAppDb((fn) => fn(db));

  const partner = await provisionPartner(db, {
    orgSlug: "route-matrix-org", ownerEmail: "route-matrix-owner@test",
    partnerEmail: "route-matrix-sales@test", password: PASSWORD,
  });
  if (!partner.login.sessionToken) {
    throw new Error("provisionPartner minted no session token — the chain broke before this suite began");
  }
  salesToken = partner.login.sessionToken;
  ownerToken = await tokenForUser(partner.world.ownerId);
  matrixWorld = partner.world;

  // F1 (adversarial pass): every test below reads a status code, never the userId behind it, so a
  // token minted for the wrong row would drift the whole matrix off the database silently. Verified
  // here, once, against the SAME rows `matrixWorld` names — before either token is treated as
  // authority anywhere below.
  const ownerIdentity = await verifySessionToken(ownerToken, readAuthConfig());
  expect(ownerIdentity?.userId, "the owner token does not verify to the provisioned owner row")
    .toBe(matrixWorld.ownerId);
  const salesIdentity = await verifySessionToken(salesToken, readAuthConfig());
  expect(salesIdentity?.userId, "the sales token does not verify to the provisioned partner row")
    .toBe(matrixWorld.partnerId);
}, 60_000);

afterAll(async () => {
  await pg.close();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
});

beforeEach(() => {
  // NO TRUNCATION here (BINDING) — the matrix partner provisioned once in `beforeAll` must still be
  // readable by every `it` below, and the row-6 tests provision their OWN, separately-named
  // partners rather than sharing or resetting this one.
  registerAppDb((fn) => fn(db));
  bindAuthorityResolver();
});

afterEach(() => {
  clearAppDb();
  clearAuthorityResolver();
});

// ─── F1 (ADVERSARIAL PASS) · THE REGISTERED LEASE IS THE PROVISIONED POSTGRES ──────────────────
//
// Nothing above this line forces `requireAppDb()` — the path every block below reads authority
// through — to terminate at the SAME Postgres this suite booted. Measured: replacing the registered
// lease with an inline in-memory client, and minting both tokens for fake user ids, left 78 of 80
// tests below passing anyway. Only the two ROW 6 arms noticed, and only incidentally, because they
// alone write to `pg` directly. This test closes that gap by reading role through the exact chain a
// real `requireCapability()` call uses (`requireAppDb()` → `resolvePrincipal`), mutating the row
// through the raw PGlite HANDLE this suite booted, and requiring the read to observe the mutation.
//
// THIS IS NOT F59. F59 (`tests/architecture/fitness.test.ts`) scans this file's own source text for
// the test-only principal constructor and the stub-world helpers — it catches a FORGED principal,
// not a SUBSTITUTED connection. Swapping the lease never touches either name F59 looks for.
describe("F1 · the registered lease IS the provisioned Postgres", () => {
  it("a role mutated directly on the provisioned instance is visible through requireAppDb → " +
     "resolvePrincipal", async () => {
    const read = async (): Promise<string> => {
      const result = await requireAppDb()((c) => resolvePrincipal(c, matrixWorld.partnerId));
      if (!result.ok) throw new Error(`resolvePrincipal refused a row this suite itself wrote: ${result.reason}`);
      return result.principal.role;
    };
    expect(await read()).toBe("sales");
    try {
      await pg.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [matrixWorld.partnerId]);
      expect(await read(), "the lease is not reading the provisioned database").toBe("owner");
    } finally {
      // Restored unconditionally — a mid-test failure here must not poison every later test that
      // depends on the shared matrix partner still holding `sales`.
      await pg.query("UPDATE memberships SET role='sales' WHERE user_id=$1", [matrixWorld.partnerId]);
    }
  });
});

// ─── TOTALITY, ASSERTED AGAIN HERE ─────────────────────────────────────────────────────────────
//
// `gate:static` DOES cover a totality check for this same map — F49 (`tests/architecture/
// fitness.test.ts`) compares `ROUTE_AUTHORIZATION` against the real filesystem under `app/api`,
// which is strictly stronger than anything a fixture-vs-fixture comparison here could be. What F49
// cannot see is agreement WITHIN this db phase's own two objects: `ROUTE_IMPORTERS` (what this suite
// can invoke) and `ROUTE_AUTHORIZATION` (what it asserts against) drifting from each other while both
// still agree with the filesystem. This repeats the set-equality check against the SAME shared
// `ROUTE_IMPORTERS` for that reason, and carries over the stub suite's companion assertion (F6,
// adversarial pass): without it, a route module that exported nothing would make `methodsOf` return
// `[]`, every per-route `it` below would loop zero times, and pass with zero assertions.
describe("the matrix is total — asserted again in the db phase", () => {
  it("every ROUTE_IMPORTERS key has a ROUTE_AUTHORIZATION entry, and vice versa", () => {
    expect(Object.keys(ROUTE_IMPORTERS).sort()).toEqual(Object.keys(ROUTE_AUTHORIZATION).sort());
    expect(Object.keys(ROUTE_IMPORTERS)).toHaveLength(29); // +1: the 2G.3 minting endpoint (§28.4)
  });

  it("every route module exports at least one HTTP method", async () => {
    // A route file that exports nothing would silently pass every denial test below.
    const empty: string[] = [];
    for (const route of Object.keys(ROUTE_IMPORTERS)) {
      const mod = await ROUTE_IMPORTERS[route]();
      if (methodsOf(mod).length === 0) empty.push(route);
    }
    expect(empty).toEqual([]);
  });
});

// ─── BASELINE · NO COOKIE ───────────────────────────────────────────────────────────────────────

describe("BASELINE · every capability route refuses a caller with no session", () => {
  for (const [route, entry] of capabilityRoutes) {
    it(`${route} → 401 with no session`, async () => {
      for (const method of methodsOf(await entry.importer())) {
        expect(await call(route, method, undefined), `${route} ${method}`).toBe(401);
      }
    });
  }
});

// ─── DENIAL · A REAL, DB-RESOLVED SALES PRINCIPAL ──────────────────────────────────────────────

describe("DENIAL · sales is refused exactly where ROUTE_AUTHORIZATION says deny", () => {
  for (const [route, entry] of capabilityRoutes) {
    if (entry.auth.sales !== "deny") continue;
    it(`${route} → 403 for a real sales session (self-witnessing: only a resolved principal can ` +
       "reach the forbidden() branch)", async () => {
      for (const method of methodsOf(await entry.importer())) {
        expect(await call(route, method, salesToken), `${route} ${method}`).toBe(403);
      }
    });
  }
});

// ─── PERMISSION · NEITHER ROLE IS ACCIDENTALLY LOCKED OUT OR WAVED THROUGH TO A 500 ────────────

describe("PERMISSION · sales is not denied where ROUTE_AUTHORIZATION says otherwise", () => {
  for (const [route, entry] of capabilityRoutes) {
    if (entry.auth.sales === "deny") continue;
    it(`${route} → not 401, not 403, and not a 500 for a real sales session`, async () => {
      for (const method of methodsOf(await entry.importer())) {
        const status = await call(route, method, salesToken);
        expect(status, `${route} ${method}`).not.toBe(401);
        expect(status, `${route} ${method}`).not.toBe(403);
        expect(status, `${route} ${method} answered 500 — see the file header on why this counts ` +
          "as a denial-shaped failure").toBeLessThan(500);
      }
    });
  }
});

describe("OWNER · nothing in the matrix locks out a real, DB-resolved owner", () => {
  for (const [route, entry] of capabilityRoutes) {
    it(`${route} → not 401, not 403, and not a 500 for a real owner session`, async () => {
      for (const method of methodsOf(await entry.importer())) {
        const status = await call(route, method, ownerToken);
        expect(status, `${route} ${method}`).not.toBe(401);
        expect(status, `${route} ${method}`).not.toBe(403);
        expect(status, `${route} ${method} answered 500`).toBeLessThan(500);
      }
    });
  }
});

// ─── POSITIVE CONTROL (I3) · A 403 ABOVE IS AUTHORIZATION, NOT DATA ABSENCE ────────────────────

describe("I3 · non-vacuity — the owner can see what sales is being denied", () => {
  it("GET /api/finance/invoices → 200 with a NON-EMPTY invoices array, in a vault this test seeds " +
     "for itself", async () => {
    // A FRESH vault dir, seeded and torn down entirely inside this test — order-independent by
    // construction, so this control cannot pass because an earlier test happened to leave data
    // behind, and cannot fail because a later test happened to remove it.
    const own = await seedVault();
    const previous = process.env.ASCEND_VAULT_PATH;
    process.env.ASCEND_VAULT_PATH = own;
    try {
      const mod = await ROUTE_IMPORTERS["app/api/finance/invoices/route.ts"]();
      const res = await invoke(mod, "GET", requestAs(ownerToken, urlFor("app/api/finance/invoices/route.ts")));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { invoices: unknown[] };
      expect(body.invoices.length, "the vault fixture holds no invoices — this control is vacuous")
        .toBeGreaterThan(0);
    } finally {
      process.env.ASCEND_VAULT_PATH = previous;
      await fs.rm(own, { recursive: true, force: true });
    }
  });
});

// ─── F2 (ADVERSARIAL PASS) · console/search'S SCOPED ROW MUST NOT READ A SWALLOWED NoAuthority AS
//     SUCCESS ─────────────────────────────────────────────────────────────────────────────────
//
// `console/search` is the ONE `scoped` row in the matrix (`ROUTE_AUTHORIZATION`): both roles get
// 200, and the difference is meant to live in the BODY, assembled from a principal `lib/authority`
// resolves for itself. `app/api/console/search/route.ts` catches `NoAuthority` and returns 200 with
// `{objects:[],commands:[],error:"Search unavailable"}` — measured: with `bindAuthorityResolver()`
// removed, that route's PERMISSION/OWNER/ROW-6-ARM-A checks above (status-only, `?q=x`) do not
// notice, because an unbound resolver and a genuinely empty result set are both a 200 with an empty
// `objects` array. `urlFor`'s fixed `?q=x` term makes this worse in both directions: nothing in the
// vault contains "x" as a search hit, so BOTH roles would see an empty array even when everything
// works. This block bypasses `urlFor`/`call` to search for `SHARED_TERM`, a term `seedVault` places
// in real fixture content, and asserts the BODY rather than only the status.
describe("F2 · console/search's scoped row — a swallowed NoAuthority must not read as success", () => {
  it(`GET /api/console/search?q=${SHARED_TERM} → owner sees a NON-EMPTY objects array, and neither ` +
     "role's body carries an error key", async () => {
    const route = "app/api/console/search/route.ts";
    const mod = await ROUTE_IMPORTERS[route]();
    const url = urlFor(route).replace(/\?q=x$/, `?q=${encodeURIComponent(SHARED_TERM)}`);

    const ownerRes = await invoke(mod, "GET", requestAs(ownerToken, url));
    expect(ownerRes.status).toBe(200);
    const ownerBody = (await ownerRes.json()) as { objects: unknown[]; error?: string };
    expect(ownerBody.error, "the owner's search swallowed a NoAuthority as a 200").toBeUndefined();
    expect(ownerBody.objects.length,
      "the vault fixture holds nothing matching the shared term — this control is vacuous")
      .toBeGreaterThan(0);

    const salesRes = await invoke(mod, "GET", requestAs(salesToken, url));
    expect(salesRes.status).toBe(200);
    const salesBody = (await salesRes.json()) as { objects: unknown[]; error?: string };
    expect(salesBody.error, "sales's search swallowed a NoAuthority as a 200").toBeUndefined();
  });
});

// ─── PUBLIC · A REAL SALES SESSION IS NOT THE OPERATOR PERIMETER'S CONCERN ─────────────────────
//
// Genuinely new relative to the stub suite: that suite has no real principal to send, so it can only
// prove "an anonymous caller is not 403'd". This proves the stronger, previously-untested claim: a
// real, DB-resolved sales session is not turned away by the OPERATOR perimeter either — whatever a
// public route's OWN credential (a portal token, a password) decides is its business, not this one's.

describe("PUBLIC · a real sales session is not turned away by the operator perimeter", () => {
  it("all six are declared — an empty set would make this block vacuous", () => {
    expect(publicRoutes).toHaveLength(6);
  });

  // F5 (adversarial pass): "not 403" alone is silently satisfied by a route that crashed before it
  // ever read a token — a 500 counts as a denial-shaped failure everywhere else in this file (see
  // the header) and belongs here too. MEASURED, not assumed: `app/api/portal/submissions/route.ts`
  // calls `req.formData()` unconditionally; `call()` can only construct a JSON body
  // (`requestAs`/`invoke` in `tests/support/route-surface.ts` set `content-type: application/json`
  // for every caller, with no argument through which any test in either route-matrix suite could
  // send multipart), so this route answers exactly 500 to every caller `call()` can construct —
  // anon, sales and owner alike — before the handler reads a token at all. That is a real,
  // fixture-independent gap in this route, not something this assertion should paper over by
  // omission — narrowed for this one named route, with the measured status recorded, rather than
  // weakened for the block.
  const SUBMISSIONS_ROUTE = "app/api/portal/submissions/route.ts";
  for (const [route, entry] of publicRoutes) {
    it(`${route} does not answer 403 to a real, authenticated sales session`, async () => {
      for (const method of methodsOf(await entry.importer())) {
        const status = await call(route, method, salesToken);
        expect(status, `${route} ${method}`).not.toBe(403);
        if (route === SUBMISSIONS_ROUTE) {
          expect(status, `${route} ${method} — expected the measured 500 (req.formData() on a JSON ` +
            "body), not some other failure").toBe(500);
        } else {
          expect(status, `${route} ${method} answered 500`).toBeLessThan(500);
        }
      }
    });
  }
});

// ─── ROW 6 ROUTE-SIDE · A REVOKED MEMBERSHIP IS DENIED ON THE VERY NEXT REQUEST ────────────────
//
// Two arms, each provisioning its OWN partner (distinct org slug and emails) so neither writes to,
// nor depends on the ordering of, the shared matrix partner above. `disabled_at` is set with a plain
// write against the raw PGlite instance — directly, rather than through any application role, the
// same discipline `tests/db/provisioned-partner.test.ts`'s ROW 7 test uses, and for the same reason:
// no application role holds UPDATE on this column, so production's own supported revocation path is
// administrative, not a request the matrix itself could make.
//
// Routes are DERIVED from `capabilityRoutes`, never hardcoded, restricted to a GET-only handler so
// the call has no body, makes no outbound request, and performs no write of its own.

async function getOnlyRoutes(wantDenied: boolean): Promise<string[]> {
  const candidates: string[] = [];
  for (const [route, entry] of capabilityRoutes) {
    if ((entry.auth.sales === "deny") !== wantDenied) continue;
    const methods = methodsOf(await entry.importer());
    if (methods.length === 1 && methods[0] === "GET") candidates.push(route);
  }
  return candidates.sort();
}

describe("ROW 6 route-side · disabled_at denies a still-valid, unexpired session at the route", () => {
  it("ARM A — a NOT-DENIED route: allowed → disabled_at set → 401 (identity lost, not capability)",
    async () => {
      const notDenied = await getOnlyRoutes(false);
      expect(notDenied.length, "no GET-only not-denied route exists to derive arm A's target from")
        .toBeGreaterThan(0);
      const route = notDenied[0];
      const revoked = await provisionPartner(db, {
        orgSlug: "row6-arm-a-org", ownerEmail: "row6-arm-a-owner@test",
        partnerEmail: "row6-arm-a-partner@test", password: PASSWORD,
      });
      const token = revoked.login.sessionToken;
      if (!token) throw new Error("arm A provisioning minted no session token");

      const before = await call(route, "GET", token);
      expect(before, `${route} should not be denied before revocation`).not.toBe(401);
      expect(before, `${route} should not be denied before revocation`).not.toBe(403);
      // BINDING clause 3: every "allowed" row asserts `status < 500`, not just "not 401/403" — a
      // 500 would satisfy both of the checks above while this arm's derived target, console/search,
      // is exactly the route F2 shows a swallowed `NoAuthority` can silently masquerade behind.
      expect(before, `${route} answered 500 before revocation`).toBeLessThan(500);

      await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [revoked.world.partnerId]);

      // The SIGNED SESSION ITSELF is untouched — this is a revocation, not an expiry or a forgery.
      const stillSigned = await verifySessionToken(token, readAuthConfig());
      expect(stillSigned?.userId, "the token stopped verifying — this must be a disabled-user " +
        "refusal, not an expired or forged one").toBe(revoked.world.partnerId);

      const after = await call(route, "GET", token);
      expect(after, `${route} should be 401, not 403 — the session resolves to nobody now`).toBe(401);
    });

  it("ARM B — a DENIED route: 403 → disabled_at set → 401 (discriminates identity loss from " +
    "capability loss)", async () => {
      const denied = await getOnlyRoutes(true);
      expect(denied.length, "no GET-only denied route exists to derive arm B's target from")
        .toBeGreaterThan(0);
      const route = denied[0];
      const revoked = await provisionPartner(db, {
        orgSlug: "row6-arm-b-org", ownerEmail: "row6-arm-b-owner@test",
        partnerEmail: "row6-arm-b-partner@test", password: PASSWORD,
      });
      const token = revoked.login.sessionToken;
      if (!token) throw new Error("arm B provisioning minted no session token");

      const before = await call(route, "GET", token);
      expect(before, `${route} should be 403 before revocation — a live principal denied a ` +
        "capability").toBe(403);

      await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [revoked.world.partnerId]);

      const stillSigned = await verifySessionToken(token, readAuthConfig());
      expect(stillSigned?.userId, "the token stopped verifying — this must be a disabled-user " +
        "refusal, not an expired or forged one").toBe(revoked.world.partnerId);

      const after = await call(route, "GET", token);
      // BINDING: 401, NOT 403. A 403 here would mean the principal still resolved and only the
      // capability check failed — which is exactly the identity-loss/capability-loss confusion this
      // arm exists to rule out.
      expect(after, `${route} should be 401 after disabling — a 403 would mean the principal still ` +
        "resolved, which disabled_at must prevent").toBe(401);
    });
});
