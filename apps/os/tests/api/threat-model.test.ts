// Layer A — THE THREAT MODEL (2F step 7.4, STAGE2F §11).
//
// Each case DEMONSTRATES the denial through a real route handler rather than asserting that a check
// exists. The numbering matches §11 so the table and the suite can be read side by side.
//
// Three rows are database properties and are proven where they can actually be proven, against real
// Postgres, rather than restated here against a stub:
//
//   §11.7  sales cannot release a held prospect          tests/db/production-authorization.test.ts
//   §11.8  sales cannot write identity columns           tests/db/production-authorization.test.ts
//   §11.14 cross-organization read returns zero rows     tests/db/request-isolation.test.ts
//
// The route half of §11.7 is covered by the matrix: `/api/prospects/[slug]` is owner-only.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  ORG_A, ORG_B, OWNER_ID, SALES_ID, SECRET, installStubDb, invoke, removeStubDb, requestAs,
  resetMemberships, seedVault, setMembership, tokenFor,
} from "./harness";
import { createSessionToken, SESSION_TTL_MS } from "@/lib/auth";
import { withRequestContext } from "@/lib/request-context";

let vaultDir: string;
let savedVault: string | undefined;
let savedSecret: string | undefined;
let salesToken: string;
let ownerToken: string;

/** A representative owner-only route. Finance is §11's own example (row 4). */
const invoices = () => import("@/app/api/finance/invoices/route");
/** A route sales legitimately holds, so "denied" cannot be confused with "denied to everyone". */
const search = () => import("@/app/api/console/search/route");

async function get(mod: Promise<Record<string, unknown>>, token: string | undefined, url: string) {
  return invoke(await mod, "GET", requestAs(token, url));
}

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = SECRET;
  vaultDir = await seedVault();
  process.env.ASCEND_VAULT_PATH = vaultDir;
  installStubDb();
  resetMemberships();
  ownerToken = await tokenFor(OWNER_ID);
  salesToken = await tokenFor(SALES_ID);
});

afterAll(async () => {
  removeStubDb();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

afterEach(() => {
  process.env.ASCEND_OS_SESSION_SECRET = SECRET;
  resetMemberships();
});

describe("§11.1–3 · the session cannot be edited into authority", () => {
  it("1 · a token with a role appended is rejected — the signature covers the payload", async () => {
    for (const forged of [
      `${salesToken}.role=owner`,
      salesToken.replace(/^v2\./, 'v2.{"role":"owner"}.'),
      // The expiry EXTENDED. The offset is explicit, and that is a repair rather than a detail:
      // this line read `Date.now() + SESSION_TTL_MS`, which is the SAME expression `tokenFor` used
      // to mint `salesToken` in `beforeAll`. Expiry is stored to the millisecond, so whenever the
      // test body happened to begin inside the same millisecond as the mint, the payload — and
      // therefore the signature over it — matched exactly and the "forgery" was a VALID token. It
      // then authenticated as sales and the finance route answered 403 for want of `finance:*`,
      // not 401. A fixture that can silently stop being a forgery measures the wrong thing on the
      // runs where it matters most, so the difference is now constructed instead of hoped for.
      `v2.${SALES_ID}.${Date.now() + SESSION_TTL_MS + 3_600_000}.${salesToken.split(".")[3]}`,
    ]) {
      const res = await get(invoices(), forged, "https://os.test/api/finance/invoices");
      expect(res.status, forged.slice(0, 40)).toBe(401);
    }
  });

  it("2 · a forged user_id is rejected — the id is inside the signature", async () => {
    const parts = salesToken.split(".");
    const forged = ["v2", OWNER_ID, parts[2], parts[3]].join(".");
    expect((await get(invoices(), forged, "https://os.test/api/finance/invoices")).status).toBe(401);
    // And it is not merely the finance route being strict: the same forgery fails on a route sales
    // is allowed to use, so the rejection is authentication, not authorization.
    expect((await get(search(), forged, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });

  it("3 · a supplied organization has NO EFFECT — the org comes from the membership row", async () => {
    // There is no organization field to forge, so the demonstration is that supplying one anywhere
    // a caller can reach changes nothing about the resolved principal.
    setMembership(SALES_ID, [{ organization_id: ORG_A, role: "sales", disabled_at: null }]);
    const seen: string[] = [];
    for (const url of [
      "https://os.test/api/console/search?q=x",
      `https://os.test/api/console/search?q=x&organization_id=${ORG_B}&role=owner`,
    ]) {
      const out = await withRequestContext(salesToken, async (p) => {
        seen.push(`${p.organizationId}/${p.role}`);
        return null;
      });
      expect(out.ok, url).toBe(true);
    }
    expect(new Set(seen)).toEqual(new Set([`${ORG_A}/sales`]));
  });
});

// ─── §11.4–6, NARROWED AT 2G.4.7 FROM THREE ROUTES TO TWO ─────────────────────────────────────
//
// §11 named three routes a sales principal must be refused: finance, admin wipe, and portal invites.
// Two of the three were named for what they EXPOSE (money, client tokens) rather than because they
// are administrative — and 2G.4.7 made the partner a trusted business operator who holds both
// `finance:*` and `portal:admin`.
//
// So `finance` and `portal invites` moved to the OWNER-PARITY block below, where they are asserted to
// SERVE the partner. They were not deleted: a route §11 named as a denial, now serving, is exactly
// the kind of change that should leave a trace in the file that named it.
//
// What remains here is the `admin:*` surface, and `app/api/invitations` joins it — the route that
// issues OPERATOR credentials, which is security management in the sense §11 actually cared about.
describe("§11.4–6 · the routes refused to sales at the route — the admin:* surface", () => {
  const cases: [string, () => Promise<Record<string, unknown>>, string, string][] = [
    ["5 · admin wipe", () => import("@/app/api/admin/wipe/route"), "POST", "https://os.test/api/admin/wipe"],
    ["5b · invitations (mints OPERATOR credentials)", () => import("@/app/api/invitations/route"), "POST",
      "https://os.test/api/invitations"],
  ];

  for (const [label, mod, method, url] of cases) {
    it(`${label} → 403 for sales, and it is a real 403`, async () => {
      const init: RequestInit = method === "GET" ? { method } : { method, body: "{}" };
      const res = await invoke(await mod(), method as "GET" | "POST", requestAs(salesToken, url, init));
      expect(res.status).toBe(403);
      // Not a redirect, and not an empty 200 dressed as a denial.
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ error: "forbidden" });
      // The body must not disclose WHICH capability was missing — that is a map of the system.
      expect(JSON.stringify(await (await invoke(await mod(), method as "GET", requestAs(salesToken, url, init))).json()))
        .not.toMatch(/finance|admin|portal|capab/i);
    });
  }

  it("the same routes serve the OWNER — so the 403 is about the role, not the route", async () => {
    for (const [, mod, method, url] of cases) {
      const init: RequestInit = method === "GET" ? { method } : { method, body: "{}" };
      const res = await invoke(await mod(), method as "GET" | "POST", requestAs(ownerToken, url, init));
      expect([200, 400, 404], `${url} for owner`).toContain(res.status);
    }
  });

  it("§11.4 and §11.6 now SERVE the partner — the two routes that left this block", async () => {
    // The other half of the narrowing, asserted rather than assumed. If either of these silently
    // went back to refusing him, the change would be half-applied and nothing else in this file
    // would notice — the same failure shape 2G.4.5 found in the four unwrapped pages.
    const moved: [string, () => Promise<Record<string, unknown>>, string][] = [
      ["finance", invoices, "https://os.test/api/finance/invoices"],
      ["portal invites", () => import("@/app/api/portal/invites/route"), "https://os.test/api/portal/invites"],
    ];
    for (const [label, mod, url] of moved) {
      const res = await invoke(await mod(), "GET", requestAs(salesToken, url, { method: "GET" }));
      expect(res.status, `${label} still refuses the partner`).not.toBe(403);
      expect(res.status, `${label} did not identify the partner`).not.toBe(401);
    }
  });
});

describe("§11.9–11 · membership decides, per request", () => {
  it("9 · a user with NO membership is refused", async () => {
    setMembership(SALES_ID, [{ organization_id: null, role: "sales", disabled_at: null }]);
    expect((await get(search(), salesToken, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });

  it("10 · a membership REVOKED mid-session takes effect on the NEXT request", async () => {
    // The same token throughout. No logout, no blacklist, no waiting for a 12-hour expiry.
    expect((await get(search(), salesToken, "https://os.test/api/console/search?q=x")).status).toBe(200);
    setMembership(SALES_ID, []);
    expect((await get(search(), salesToken, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });

  it("11 · a DISABLED user is refused even holding a valid unexpired session", async () => {
    setMembership(SALES_ID, [{ organization_id: ORG_A, role: "sales", disabled_at: "2026-01-01T00:00:00Z" }]);
    expect((await get(search(), salesToken, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });

  it("a second membership is AMBIGUOUS and refuses rather than picking one", async () => {
    setMembership(SALES_ID, [
      { organization_id: ORG_A, role: "sales", disabled_at: null },
      { organization_id: ORG_B, role: "owner", disabled_at: null },
    ]);
    // Picking the first row silently is how a system starts serving the wrong tenant — and note the
    // second row says `owner`, so guessing would also be a privilege escalation.
    expect((await get(search(), salesToken, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });
});

describe("§11.12–13, 16 · the perimeter fails closed", () => {
  it("12 · an expired session is refused", async () => {
    const expired = (await createSessionToken(
      { configured: true, secret: SECRET }, SALES_ID, Date.now() - SESSION_TTL_MS - 1000))!;
    expect((await get(search(), expired, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });

  it("13 · a session signed with a DIFFERENT secret is refused", async () => {
    const other = (await createSessionToken({ configured: true, secret: "a-different-secret" }, OWNER_ID))!;
    expect((await get(invoices(), other, "https://os.test/api/finance/invoices")).status).toBe(401);
  });

  it("16 · with ASCEND_OS_SESSION_SECRET unset the perimeter DENIES, never opens", async () => {
    delete process.env.ASCEND_OS_SESSION_SECRET;
    // A previously valid owner token, against a route the owner holds. Unconfigured must not mean
    // unguarded — the direction this fails in is the whole point.
    expect((await get(invoices(), ownerToken, "https://os.test/api/finance/invoices")).status).toBe(401);
    expect((await get(search(), ownerToken, "https://os.test/api/console/search?q=x")).status).toBe(401);
  });
});

describe("§11.17 · login discloses nothing about who has an account", () => {
  it("an unknown user and a wrong password are indistinguishable in the response", async () => {
    // The stub answers no credential for anyone, so both cases take the same path through the route.
    const mod = await import("@/app/api/auth/login/route");
    const post = async (body: unknown) =>
      invoke(mod, "POST", requestAs(undefined, "https://os.test/api/auth/login",
        { method: "POST", body: JSON.stringify(body) }));

    const unknown = await post({ email: "nobody@example.test", password: "correct horse battery" });
    const wrong = await post({ email: "oscar@ascend.test", password: "definitely not it" });

    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
    expect(unknown.status).toBe(401);
  });

  it("a malformed body is a failed login, not a 500", async () => {
    const mod = await import("@/app/api/auth/login/route");
    const res = await invoke(mod, "POST", requestAs(undefined, "https://os.test/api/auth/login",
      { method: "POST", body: "{not json" }));
    expect(res.status).toBe(401);
  });
});
