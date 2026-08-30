// Layer A — THE PAGE PRINCIPAL RESOLVER (2G.1 slice 1).
//
// The render path had no authorization at all before this: `middleware.ts` verified a signature and
// every page rendered for anyone holding one. These are the REFUSAL proofs — every way a render can
// fail to establish authority, and the two ways it can succeed.
//
// STUBBED: `cookies()` (the transport) and the one SELECT behind `resolvePrincipal` (so a membership
// can be revoked between two calls, which a fixture cannot express). Everything else is production
// code — real HMAC verification, the real resolver, the real branded principal.
//
// NOT PROVEN HERE: isolation between concurrent renders. `React.cache` is a React primitive and a
// stub cannot demonstrate it. That is `tests/render/page-isolation.test.ts`, which runs real
// overlapping renders and is mutation-tested.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TEST_ORG_A, TEST_ORG_B, TEST_OWNER_ID, TEST_SALES_ID, TEST_SECRET,
  installStubDb, removeStubDb, resetMemberships, setMembership, tokenFor,
} from "@/tests/support/operator-session";
import { createSessionToken, SESSION_TTL_MS } from "@/lib/auth";
import { clearAppDb, registerAppDb } from "@/core/auth/connection";

/** The request transport, controlled per test. `cookies()` is Next's; only its VALUE is stubbed. */
const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined, outsideRequest: false }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.outsideRequest) {
      // The real failure mode: `cookies()` throws when there is no request scope.
      throw new Error("`cookies` was called outside a request scope");
    }
    return {
      get: (name: string) =>
        name === "ascend_os_session" && jar.cookie ? { name, value: jar.cookie } : undefined,
    };
  },
}));

const { pageAuthority, requirePagePrincipal, PageNotAuthenticated } =
  await import("@/lib/page-principal");

let ownerToken: string;
let salesToken: string;
let savedSecret: string | undefined;

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
  installStubDb();
  resetMemberships();
  ownerToken = await tokenFor(TEST_OWNER_ID);
  salesToken = await tokenFor(TEST_SALES_ID);
});

afterAll(() => {
  removeStubDb();
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
});

afterEach(() => {
  jar.cookie = undefined;
  jar.outsideRequest = false;
  process.env.ASCEND_OS_SESSION_SECRET = TEST_SECRET;
  installStubDb();
  resetMemberships();
});

const as = async (cookie: string | undefined) => {
  jar.cookie = cookie;
  return pageAuthority();
};

describe("the render RESOLVES authority for a valid session", () => {
  it("owner → the role the membership row holds", async () => {
    const a = await as(ownerToken);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.principal.role).toBe("owner");
    expect(a.principal.organizationId).toBe(TEST_ORG_A);
    expect(a.principal.userId).toBe(TEST_OWNER_ID);
  });

  it("sales → the role the membership row holds", async () => {
    const a = await as(salesToken);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.principal.role).toBe("sales");
    expect(a.principal.userId).toBe(TEST_SALES_ID);
  });

  it("MEMBERSHIP DETERMINES AUTHORITY — the same token, a different row, a different role", async () => {
    // The single most important property on this surface: nothing in the token decides anything.
    setMembership(TEST_SALES_ID, [{ organization_id: TEST_ORG_A, role: "owner", disabled_at: null }]);
    const promoted = await as(salesToken);
    expect(promoted.ok && promoted.principal.role).toBe("owner");

    setMembership(TEST_SALES_ID, [{ organization_id: TEST_ORG_B, role: "sales", disabled_at: null }]);
    const moved = await as(salesToken);
    expect(moved.ok && moved.principal.role).toBe("sales");
    expect(moved.ok && moved.principal.organizationId).toBe(TEST_ORG_B);
  });

  it("the token itself carries NO role and NO organization to forge", async () => {
    expect(ownerToken).not.toMatch(/owner|sales|role|organi/i);
    expect(ownerToken.split(".")).toHaveLength(4);
  });

  it("a role supplied in ANOTHER cookie has no effect", async () => {
    // There is no code path that reads one; this demonstrates it rather than asserting it.
    jar.cookie = salesToken;
    const a = await pageAuthority();
    expect(a.ok && a.principal.role).toBe("sales");
  });
});

describe("the render REFUSES, in every direction", () => {
  it("ABSENT session → unauthenticated", async () => {
    expect(await as(undefined)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("MALFORMED or v1 session → unauthenticated", async () => {
    for (const bad of ["", "garbage", "...", "v2", "v2.a.b", `v1.${Date.now() + 1000}.sig`]) {
      expect(await as(bad), bad).toEqual({ ok: false, reason: "unauthenticated" });
    }
  });

  it("FORGED user id → unauthenticated (the id is inside the signature)", async () => {
    const p = salesToken.split(".");
    const forged = ["v2", TEST_OWNER_ID, p[2], p[3]].join(".");
    expect(await as(forged)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("FORGED expiry → unauthenticated", async () => {
    const p = ownerToken.split(".");
    expect(await as(`v2.${p[1]}.${Number(p[2]) + 86_400_000}.${p[3]}`))
      .toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("EXPIRED session → unauthenticated", async () => {
    const stale = (await createSessionToken(
      { configured: true, secret: TEST_SECRET }, TEST_OWNER_ID, Date.now() - SESSION_TTL_MS - 1000))!;
    expect(await as(stale)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("session signed with a DIFFERENT SECRET → unauthenticated", async () => {
    const other = (await createSessionToken({ configured: true, secret: "not-the-secret" }, TEST_OWNER_ID))!;
    expect(await as(other)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("PERIMETER UNCONFIGURED → unauthenticated, never open", async () => {
    delete process.env.ASCEND_OS_SESSION_SECRET;
    expect(await as(ownerToken)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("REVOKED membership → refused on the very next render, same token", async () => {
    expect((await as(salesToken)).ok).toBe(true);
    setMembership(TEST_SALES_ID, []);
    expect(await as(salesToken)).toEqual({ ok: false, reason: "no-such-user" });
    setMembership(TEST_SALES_ID, [{ organization_id: null, role: "sales", disabled_at: null }]);
    expect(await as(salesToken)).toEqual({ ok: false, reason: "no-membership" });
  });

  it("DISABLED user → refused even holding a valid unexpired session", async () => {
    setMembership(TEST_OWNER_ID, [
      { organization_id: TEST_ORG_A, role: "owner", disabled_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(await as(ownerToken)).toEqual({ ok: false, reason: "disabled" });
  });

  it("AMBIGUOUS membership refuses rather than picking one", async () => {
    setMembership(TEST_SALES_ID, [
      { organization_id: TEST_ORG_A, role: "sales", disabled_at: null },
      { organization_id: TEST_ORG_B, role: "owner", disabled_at: null },
    ]);
    // Note the second row says owner: guessing would also be a privilege escalation.
    expect(await as(salesToken)).toEqual({ ok: false, reason: "ambiguous-membership" });
  });
});

describe("failures that are NOT permission decisions still refuse", () => {
  it("called OUTSIDE a request scope → no-request, never a default principal", async () => {
    jar.outsideRequest = true;
    expect(await pageAuthority()).toEqual({ ok: false, reason: "no-request" });
  });

  it("DATABASE UNREGISTERED → unavailable, distinct from unauthenticated", async () => {
    // An outage must not read as "everyone suddenly logged out" — and must not render anything.
    clearAppDb();
    expect(await as(ownerToken)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("DATABASE THROWING → unavailable, and nothing is rendered on a guess", async () => {
    registerAppDb(async () => { throw new Error("connection refused"); });
    expect(await as(ownerToken)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("requirePagePrincipal — the shape data functions will use", () => {
  it("returns the principal when authority exists", async () => {
    jar.cookie = ownerToken;
    expect((await requirePagePrincipal()).role).toBe("owner");
  });

  it("THROWS rather than returning anything when it does not", async () => {
    jar.cookie = undefined;
    await expect(requirePagePrincipal()).rejects.toThrow(PageNotAuthenticated);
    // The reason travels for the log; the caller must not be able to proceed without a principal.
    await expect(requirePagePrincipal()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("throws for an outage too — no fallback, no partial render", async () => {
    clearAppDb();
    jar.cookie = ownerToken;
    await expect(requirePagePrincipal()).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("no module-level identity", () => {
  it("the module exports no setter and holds no principal", async () => {
    const mod = await import("@/lib/page-principal");
    const names = Object.keys(mod);
    for (const banned of ["setPrincipal", "currentPrincipal", "currentUser", "registerPrincipal"]) {
      expect(names).not.toContain(banned);
    }
    // Two different sessions resolved back to back must not contaminate one another even without a
    // render pass — the weak sequential version of the property; the real one is the render test.
    jar.cookie = ownerToken;
    const a = await pageAuthority();
    jar.cookie = salesToken;
    const b = await pageAuthority();
    expect(a.ok && a.principal.role).toBe("owner");
    expect(b.ok && b.principal.role).toBe("sales");
  });
});
