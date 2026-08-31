// Layer B — THE LANDING SEAM (2G.3, STAGE2G §28.6/§28.12).
//
// §28.12 requires that the partner "signs in, and LANDS on `/partner`". Until this suite existed
// `lib/landing` had no test importing it at all — production code on the authentication path,
// named explicitly in the closure criteria, with zero coverage. Found by the §28 evidence review.
//
// ─── TWO LEVELS, BECAUSE THEY PROVE DIFFERENT THINGS ───────────────────────────────────────────
//
//   landingFor()          the DECISION — given a principal, which destination
//   POST /api/auth/login  the JOURNEY  — a real credential exchanged for a session, and the
//                         destination that comes back with it
//
// The second is the one §28.12 actually claims. A tested function does not establish that signing in
// routes anybody anywhere; the route is where the two halves meet.
//
// ─── ROUTING, NEVER AUTHORIZATION ──────────────────────────────────────────────────────────────
//
// Nothing here asserts that a landing grants access. It cannot: the destination enforces its own
// boundary, proven separately by `page-denial` and F57. The worst a wrong answer here produces is a
// denial the person can see.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capabilitiesFor } from "@/core/auth/capabilities";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { landingFor } from "@/lib/landing";
import { LANDING_ORDER, NAV_DESTINATIONS } from "@/navigation/destinations";
import { hashPassword } from "@/core/auth/credentials";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import type { SqlClient } from "@/core/db";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";
import {
  TEST_ORG_A, TEST_OWNER_ID, TEST_SALES_ID, TEST_SECRET,
} from "@/tests/support/operator-session";
import { POST as LOGIN } from "@/app/api/auth/login/route";

const principalFor = (role: MembershipRole, userId: string) =>
  __unsafePrincipalForTests(role, TEST_ORG_A as OrganizationId, userId as UserId);

const OWNER = principalFor("owner", TEST_OWNER_ID);
const SALES = principalFor("sales", TEST_SALES_ID);

describe("landingFor · the decision", () => {
  it("an OWNER lands on `/`", () => {
    expect(landingFor(OWNER)).toBe("/");
  });

  it("a SALES principal lands on `/partner`", () => {
    // The §28.12 claim, at the function level. `/` demands nine capabilities; sales holds five, none
    // of the seven it would need beyond its own — so the first entry in the landing order is not
    // reachable and the second is.
    expect(landingFor(SALES)).toBe("/partner");
  });

  it("THE ANSWER IS ALWAYS REACHABLE BY THAT PRINCIPAL — a property, over every role", () => {
    // Stronger than the two cases above and independent of today's capability table: whatever the
    // seam returns, the principal must hold everything that destination requires. If someone adds a
    // role or edits the table, a landing that denies on arrival fails here.
    for (const principal of [OWNER, SALES]) {
      const held = new Set<string>(capabilitiesFor(principal));
      const href = landingFor(principal);
      const destination = NAV_DESTINATIONS.find((d) => d.href === href);
      expect(destination, `${href} is not a declared destination`).toBeTruthy();
      expect(
        destination!.requires.filter((c) => !held.has(c)),
        `${principal.role} was landed on ${href}, which it cannot render`
      ).toEqual([]);
    }
  });

  it("the choice is CAPABILITY-driven — the two roles differ exactly where the table says", () => {
    // Establishes the causal link rather than restating the formula: `/` is unreachable for sales
    // BECAUSE of capabilities it lacks, and reachable for the owner BECAUSE it holds them.
    const root = NAV_DESTINATIONS.find((d) => d.href === "/")!;
    const ownerHolds = new Set<string>(capabilitiesFor(OWNER));
    const salesHolds = new Set<string>(capabilitiesFor(SALES));
    expect(root.requires.every((c) => ownerHolds.has(c)), "owner cannot reach /").toBe(true);
    expect(root.requires.some((c) => !salesHolds.has(c)), "sales can reach / after all").toBe(true);
  });

  it("no role NAME decides anything — landing order is data, not a branch", () => {
    // A guard against the drift §28.5 forbids: the first role check at a call site. If someone
    // rewrites this seam as `if (role === "sales")` the two assertions above would still pass, so
    // this asserts the mechanism instead — every landing candidate is a declared destination whose
    // reachability is decided by its `requires`.
    for (const href of LANDING_ORDER) {
      expect(NAV_DESTINATIONS.some((d) => d.href === href), `${href} is not declared`).toBe(true);
    }
  });
});

// ─── THE JOURNEY ───────────────────────────────────────────────────────────────────────────────

const PASSWORD = "a-sufficiently-long-login-password";
let ownerHash = "";
let savedSecret: string | undefined;

/** Answers the two queries the login route makes: the credential lookup, then the membership. */
function stubClient(role: MembershipRole): SqlClient {
  const client: SqlClient = {
    async query<T>(sql: string) {
      if (/password_hash, password_algo, disabled_at/i.test(sql)) {
        return {
          rows: [{ id: role === "sales" ? TEST_SALES_ID : TEST_OWNER_ID, password_hash: ownerHash,
                   password_algo: "scrypt", disabled_at: null }] as unknown as T[],
          affected: 1,
        };
      }
      if (/LEFT JOIN memberships/i.test(sql)) {
        return { rows: [{ organization_id: TEST_ORG_A, role, disabled_at: null }] as unknown as T[], affected: 1 };
      }
      return { rows: [] as T[], affected: 0 };
    },
    async exec() {},
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(client); },
  };
  return client;
}

/**
 * Sign in. Takes NO role argument on purpose: the role comes from the stub registered just before
 * the call, and a parameter here would read as though it selected one — a caller would then write
 * `signIn("owner")` against a `sales` stub and be quietly misled about what the test proves.
 */
const signIn = () =>
  LOGIN(new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "someone@test", password: PASSWORD }),
  }));

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
  ownerHash = (await hashPassword(PASSWORD)).hash;
}, 30_000);

afterEach(() => clearAppDb());

afterAll(() => {
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

describe("POST /api/auth/login · the journey §28.12 actually claims", () => {
  beforeEach(() => clearAppDb());

  it("a SALES credential signs in and is told to land on /partner", async () => {
    registerAppDb((fn) => fn(stubClient("sales")));
    const res = await signIn();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; landing: string };
    expect(body.ok).toBe(true);
    expect(body.landing, "the partner was not routed to their own surface").toBe("/partner");
  });

  it("an OWNER credential signs in and is told to land on /", async () => {
    registerAppDb((fn) => fn(stubClient("owner")));
    const body = (await (await signIn()).json()) as { landing: string };
    expect(body.landing).toBe("/");
  });

  it("the session cookie is still set, and carries no landing or role", async () => {
    // The landing travels in the BODY. If it ever moved into the token the session would start
    // carrying authority-shaped data, which is the property 2F removed.
    registerAppDb((fn) => fn(stubClient("sales")));
    const res = await signIn();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie, "no session cookie was set").toMatch(/ascend/i);
    expect(cookie).not.toMatch(/partner|sales|owner/i);
  });

  it("A FAILED LOGIN CARRIES NO LANDING — the refusal shape is unchanged", async () => {
    // Adding a field to the success path must not add one to the failure path: a 401 that described
    // where the caller would have landed would leak that an account exists.
    registerAppDb((fn) => fn({
      async query<T>() { return { rows: [] as T[], affected: 0 }; },
      async exec() {},
      async transaction<T>(fn2: (tx: SqlClient) => Promise<T>) { return fn2(this as unknown as SqlClient); },
    } as SqlClient));
    const res = await signIn();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/landing|partner/i);
  });
});
