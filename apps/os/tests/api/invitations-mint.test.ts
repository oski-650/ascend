// Layer B — POST /api/invitations, THE AUTHORIZED HALF (2G.3, STAGE2G §28.4).
//
// ─── WHAT THIS SUITE OWNS, AND WHAT IT LEAVES TO THE DATABASE ──────────────────────────────────
//
// Here: the ROUTE. Who reaches it, what each refusal answers, and that the token appears exactly
// once. The stub below is a transport fixture — it records SQL and answers it, so this suite can
// prove things about status codes and response bodies without a Postgres.
//
// NOT here: that the boundary HOLDS. A stub says yes to whatever it is written to say yes to, so
// proving least privilege against one would be proving something about the stub. The security
// properties — a non-member refused, a re-mint leaving the earlier invitation live — are proven in
// `tests/db/invitations.test.ts` against real policies, real grants and real RLS.
//
// That split is the same one 2G.2 drew, and it is the reason the `current_user` grant defect was
// caught by a real database after eighteen green local tests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { clearAuthorityResolver } from "@/core/auth/authority";
import type { SqlClient } from "@/core/db";
import {
  TEST_ORG_A, TEST_OWNER_ID, TEST_SALES_ID, TEST_SECRET,
  requestAs, resetMemberships, setMembership, tokenFor,
} from "@/tests/support/operator-session";
import { POST } from "@/app/api/invitations/route";

const PARTNER_ID = "0198f3a1-2b4c-7d8e-9f01-00000000cccc";
const OUTSIDER_ID = "0198f3a1-2b4c-7d8e-9f01-00000000dddd";

/** Every statement the route caused, so a test can assert what the DATABASE was asked. */
let statements: string[] = [];
/** Who the stub will admit is a member of the caller's organization. */
let members = new Set<string>();

/**
 * A transport stub.
 *
 * It answers the three shapes this route produces: membership resolution for the principal, the
 * membership CHECK inside the mint, and the INSERT. Everything else returns empty, which is the
 * fail-closed direction — an unrecognised query yields no rows rather than a plausible row.
 */
function stubClient(): SqlClient {
  const client: SqlClient = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      statements.push(sql.replace(/\s+/g, " ").trim());

      // Principal resolution (lib/route-guard → resolvePrincipal). Matched FIRST and on its JOIN,
      // because its SQL also contains the word `memberships` — an ordering bug here made every
      // request answer 401 for a reason that had nothing to do with authorization.
      if (/LEFT JOIN memberships/i.test(sql)) {
        const id = String(params?.[0]);
        const role = id === TEST_SALES_ID ? "sales" : "owner";
        return { rows: [{ organization_id: TEST_ORG_A, role, disabled_at: null }] as unknown as T[], affected: 1 };
      }
      // The mint. Since §28.13 Path B the membership predicate is PART OF THIS STATEMENT — an
      // `INSERT … SELECT … WHERE EXISTS` — so the stub models it the way the database does: a
      // non-member yields ZERO ROWS from the insert itself, never a separate refusal.
      if (/INSERT INTO invitations/i.test(sql)) {
        const ok = members.has(String(params?.[1]));   // $2 is the target user
        return {
          rows: (ok
            ? [{ id: "11111111-2222-4333-8444-555555555555", expires_at: new Date("2030-01-01") }]
            : []) as unknown as T[],
          affected: ok ? 1 : 0,
        };
      }
      return { rows: [] as T[], affected: 0 };
    },
    async exec() {},
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(client); },
  };
  return client;
}

let savedSecret: string | undefined;
let ownerToken = "";
let salesToken = "";

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
  resetMemberships();
  setMembership(PARTNER_ID, [{ organization_id: TEST_ORG_A, role: "sales", disabled_at: null }]);
  ownerToken = await tokenFor(TEST_OWNER_ID);
  salesToken = await tokenFor(TEST_SALES_ID);
});

beforeEach(() => {
  statements = [];
  members = new Set([PARTNER_ID, TEST_OWNER_ID, TEST_SALES_ID]);
  registerAppDb((fn) => fn(stubClient()));
  bindAuthorityResolver();
});

afterEach(() => {
  clearAppDb();
  clearAuthorityResolver();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

const mint = (token: string | undefined, body: unknown) =>
  POST(requestAs(token, "http://localhost/api/invitations", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("POST /api/invitations · who may reach it", () => {
  it("an UNAUTHENTICATED caller gets 401 and mints nothing", async () => {
    const res = await mint(undefined, { userId: PARTNER_ID });
    expect(res.status).toBe(401);
    expect(statements.some((s) => /INSERT INTO invitations/i.test(s)),
      "an unauthenticated request reached the insert").toBe(false);
  });

  it("a SALES principal gets 403 and mints nothing", async () => {
    // The partner-safe set holds no `admin:*`. Issuing an invitation is an owner act — a partner who
    // could mint one could hand somebody else a password-setting link.
    const res = await mint(salesToken, { userId: PARTNER_ID });
    expect(res.status).toBe(403);
    expect(statements.some((s) => /INSERT INTO invitations/i.test(s)),
      "a sales request reached the insert").toBe(false);
  });

  it("the OWNER mints, and the response carries the token exactly once", async () => {
    const res = await mint(ownerToken, { userId: PARTNER_ID });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token?: string; id?: string; expiresAt?: string };
    expect(typeof body.token, "no token was returned").toBe("string");
    expect(body.token!.length).toBeGreaterThan(20);
    expect(body.id).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
  });
});

describe("POST /api/invitations · the refusals are distinguishable, deliberately", () => {
  it("a NON-MEMBER is refused, and the insert never runs", async () => {
    // §28.13 Path B: the insert RUNS and writes nothing, because its own `WHERE EXISTS` predicate
    // does not match. Asserting "the insert never ran" would now be asserting the OLD design —
    // check-then-write — and would fail for the right reason if anyone restored it.
    const res = await mint(ownerToken, { userId: OUTSIDER_ID });
    expect(res.status).toBe(404);
    const insert = statements.find((s) => /INSERT INTO invitations/i.test(s));
    expect(insert, "the mint did not reach the database at all").toBeTruthy();
    expect(insert, "the membership predicate is not part of the write — Path B was undone")
      .toMatch(/WHERE EXISTS[\s\S]*memberships[\s\S]*current_org\(\)/i);
  });

  it("a malformed body is 400, not 500", async () => {
    expect((await mint(ownerToken, "{not json")).status).toBe(400);
  });

  it("a missing userId is 400", async () => {
    expect((await mint(ownerToken, {})).status).toBe(400);
    expect((await mint(ownerToken, { userId: "   " })).status).toBe(400);
  });

  it("a MALFORMED userId is 400, never 500, and never reaches the database", async () => {
    // Found in the §28 evidence review: `$2::uuid` raised `invalid input syntax for type uuid`, so
    // ordinary bad input took the outage path AND copied the caller's raw string into a log line.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await mint(ownerToken, { userId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(statements.some((s) => /INSERT INTO invitations/i.test(s)),
      "a malformed id reached the database").toBe(false);
    expect(spy.mock.calls.flat().join(" ").includes("not-a-uuid"),
      "the rejected input was written to a log line").toBe(false);
  });

  it("404 STAYS RESERVED for the indistinguishable cases", async () => {
    // The security property the 400 must not disturb: a well-formed id naming somebody in another
    // organization and a well-formed id naming nobody answer IDENTICALLY. Only syntax moved to 400.
    const elsewhere = (await mint(ownerToken, { userId: OUTSIDER_ID })).status;
    const nobody = (await mint(ownerToken, { userId: "00000000-0000-4000-8000-000000000000" })).status;
    expect(elsewhere).toBe(404);
    expect(nobody).toBe(elsewhere);
  });

  it("UNLIKE the accept route, the refusals differ — and that asymmetry is the contract", async () => {
    // Stated as a test so it cannot be "standardized" away: accept must answer identically for every
    // failure because an unauthenticated stranger could otherwise enumerate tokens. Here the caller
    // is an owner acting inside their own tenant, and a uniform answer would only hide operational
    // fact from the person who has to act on it.
    const statuses = [
      (await mint(undefined, { userId: PARTNER_ID })).status,
      (await mint(salesToken, { userId: PARTNER_ID })).status,
      (await mint(ownerToken, { userId: OUTSIDER_ID })).status,
      (await mint(ownerToken, {})).status,
    ];
    expect(new Set(statuses).size, "the mint route collapsed its failures into one answer").toBe(4);
  });
});

describe("POST /api/invitations · the organization is never taken from the request", () => {
  it("an organizationId in the body changes nothing about the insert", async () => {
    const res = await mint(ownerToken, {
      userId: PARTNER_ID,
      organizationId: "99999999-9999-4999-8999-999999999999",
    });
    expect(res.status).toBe(201);
    const insert = statements.find((s) => /INSERT INTO invitations/i.test(s));
    expect(insert, "no insert was issued").toBeTruthy();
    // The route passes the PRINCIPAL's organization positionally; the body's value never becomes a
    // parameter, so there is nothing for the database to be told.
    const setOrg = statements.find((s) => /set_config\('ascend.org_id'/.test(s));
    expect(setOrg, "the session organization was never established").toBeTruthy();
  });

  it("the token is never written to the log", async () => {
    // The one moment plaintext exists outside the operator's clipboard. A console line carrying it
    // would put a live credential-setting secret into a durable file.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await mint(ownerToken, { userId: PARTNER_ID });
    const body = (await res.json()) as { token: string };
    const logged = [...spy.mock.calls, ...warn.mock.calls].flat().join(" ");
    expect(logged.includes(body.token), "the minted token appeared in a log line").toBe(false);
  });
});
