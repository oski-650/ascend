// Layer A — THE REQUEST CONTEXT BOUNDARY (2F step 7.2).
//
// What this file proves is the SHAPE of the boundary: that authority can only enter through
// `withRequestContext`, that it propagates to code which knows nothing about it, and that every
// failure direction refuses rather than defaults.
//
// What it deliberately does NOT prove is isolation under concurrency against a real pool. That is a
// database property, PGlite and stubs cannot demonstrate it, and asserting it here would be exactly
// the vacuity this stage keeps catching. It is proven in `tests/db/request-isolation.test.ts`,
// which runs against real Postgres with real overlap and is mutation-tested.

import { afterEach, describe, expect, it } from "vitest";
import {
  OutsideRequestContext, inRequestContext, peekRequestContext, requirePrincipal, requireRequestDb,
  runInRequestContext, type RequestContext,
} from "@/core/auth/context";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { withRequestContext } from "@/lib/request-context";
import { registerAppDb, clearAppDb, AppDbUnavailable } from "@/core/auth/connection";
import { createSessionToken } from "@/lib/auth";
import type { SqlClient } from "@/core/db";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";

const ORG = "11111111-1111-4111-8111-111111111111" as OrganizationId;
const OTHER_ORG = "22222222-2222-4222-8222-222222222222" as OrganizationId;
const OSCAR = "0198f3a1-2b4c-7d8e-9f01-000000000001" as UserId;
const PARTNER = "0198f3a1-2b4c-7d8e-9f01-000000000002" as UserId;

const ctxFor = (role: MembershipRole, org: OrganizationId, user: UserId, db: SqlClient = stubDb([])): RequestContext => ({
  principal: __unsafePrincipalForTests(role, org, user),
  db,
});

/** A minimal SqlClient that answers `resolvePrincipal`'s single SELECT with `rows`. */
function stubDb(rows: unknown[], onQuery?: (sql: string) => void): SqlClient {
  const client: SqlClient = {
    async query<T>(sql: string) {
      onQuery?.(sql);
      if (/FROM users/i.test(sql)) return { rows: rows as T[], affected: rows.length };
      return { rows: [] as T[], affected: 0 };
    },
    async exec() {},
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(client); },
  };
  return client;
}

afterEach(() => clearAppDb());

describe("the store carries context and cannot create authority", () => {
  it("OUTSIDE a request there is no principal — it THROWS rather than defaulting", () => {
    expect(inRequestContext()).toBe(false);
    expect(peekRequestContext()).toBeUndefined();
    expect(() => requirePrincipal()).toThrow(OutsideRequestContext);
    expect(() => requireRequestDb()).toThrow(OutsideRequestContext);
    // The message must say what is missing. A silent "no owner" is how this fails in production.
    expect(() => requirePrincipal()).toThrow(/no default/i);
  });

  it("propagates through nested async work that knows nothing about identity", async () => {
    // The whole reason ALS was chosen over threading a parameter: `deep()` is the shape of
    // lib/forecast and mission-control/pipeline — pure callers that must stay auth-unaware.
    const deep = async () => {
      await new Promise((r) => setTimeout(r, 1));
      await Promise.resolve();
      return requirePrincipal();
    };
    const p = await runInRequestContext(ctxFor("sales", ORG, PARTNER), () =>
      Promise.all([deep(), deep()]).then(([a]) => a));
    expect(p.role).toBe("sales");
    expect(p.userId).toBe(PARTNER);
  });

  it("the context ENDS with the callback — nothing is left behind", async () => {
    await runInRequestContext(ctxFor("owner", ORG, OSCAR), async () => {
      expect(requirePrincipal().role).toBe("owner");
    });
    expect(inRequestContext(), "a principal survived the request").toBe(false);
    expect(() => requirePrincipal()).toThrow(OutsideRequestContext);
  });

  it("the context ends even when the request THROWS", async () => {
    await expect(
      runInRequestContext(ctxFor("owner", ORG, OSCAR), async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    expect(inRequestContext(), "a failed request left its principal behind").toBe(false);
  });

  it("nested contexts stack and unwind — the inner never overwrites the outer", async () => {
    await runInRequestContext(ctxFor("owner", ORG, OSCAR), async () => {
      await runInRequestContext(ctxFor("sales", OTHER_ORG, PARTNER), async () => {
        expect(requirePrincipal().role).toBe("sales");
        expect(requirePrincipal().organizationId).toBe(OTHER_ORG);
      });
      // If the store were one shared slot, this is where the leak would show.
      expect(requirePrincipal().role).toBe("owner");
      expect(requirePrincipal().organizationId).toBe(ORG);
    });
  });

  it("exports NO setter — authority cannot be changed from inside a request", async () => {
    const mod = await import("@/core/auth/context");
    const names = Object.keys(mod);
    expect(names).not.toContain("setPrincipal");
    expect(names).not.toContain("currentPrincipal");
    expect(names).not.toContain("currentUser");
    // The store itself is unexported: exporting it would hand every caller `.enterWith()`, which
    // sets the value for the rest of the execution rather than for a scoped callback.
    expect(names.some((n) => /storage|store/i.test(n))).toBe(false);
  });
});

describe("withRequestContext — the only door in", () => {
  const config = { configured: true as const, secret: "test-secret-do-not-use" };
  const membership = (role: string, disabled: string | null = null, org: string | null = ORG) =>
    [{ organization_id: org, role, disabled_at: disabled }];

  const withSecret = async <T>(fn: () => Promise<T>): Promise<T> => {
    const saved = process.env.ASCEND_OS_SESSION_SECRET;
    process.env.ASCEND_OS_SESSION_SECRET = config.secret;
    try { return await fn(); } finally {
      if (saved === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
      else process.env.ASCEND_OS_SESSION_SECRET = saved;
    }
  };

  it("a valid session for a member establishes the ROLE THE DATABASE HOLDS", async () => {
    registerAppDb((fn) => fn(stubDb(membership("sales"))));
    await withSecret(async () => {
      const token = (await createSessionToken(config, PARTNER))!;
      const out = await withRequestContext(token, async (p) => {
        // The principal is reachable both explicitly and through the store, and they agree.
        expect(requirePrincipal()).toBe(p);
        return { role: p.role, org: p.organizationId, user: p.userId };
      });
      expect(out).toEqual({ ok: true, value: { role: "sales", org: ORG, user: PARTNER } });
    });
  });

  it("the ROLE COMES FROM THE MEMBERSHIP ROW, not from anything the caller supplied", async () => {
    // Same token, same user, different row — the only thing that decides authority.
    registerAppDb((fn) => fn(stubDb(membership("owner"))));
    await withSecret(async () => {
      const token = (await createSessionToken(config, PARTNER))!;
      const out = await withRequestContext(token, async (p) => p.role);
      expect(out).toEqual({ ok: true, value: "owner" });
    });
  });

  it("resolution runs as ascend_auth — the role that can answer 'who is this?'", async () => {
    const seen: string[] = [];
    registerAppDb((fn) => fn(stubDb(membership("sales"), (sql) => seen.push(sql))));
    await withSecret(async () => {
      const token = (await createSessionToken(config, PARTNER))!;
      await withRequestContext(token, async () => null);
    });
    expect(seen.some((s) => /SET LOCAL ROLE ascend_auth/.test(s))).toBe(true);
  });

  it("EVERY denial direction refuses, and none of them enters the context", async () => {
    const cases: [string, unknown[], string][] = [
      ["no membership row", membership("owner", null, null), "no-membership"],
      ["no such user", [], "no-such-user"],
      ["disabled user", membership("owner", "2026-01-01T00:00:00Z"), "disabled"],
      ["two memberships", [...membership("owner"), ...membership("sales")], "ambiguous-membership"],
    ];
    for (const [label, rows, reason] of cases) {
      let entered = false;
      registerAppDb((fn) => fn(stubDb(rows)));
      const out = await withSecret(async () => {
        const token = (await createSessionToken(config, OSCAR))!;
        return withRequestContext(token, async () => { entered = true; return "ran"; });
      });
      expect(out, label).toEqual({ ok: false, reason });
      expect(entered, `${label} still ran the request body`).toBe(false);
      expect(inRequestContext()).toBe(false);
    }
  });

  it("an absent, malformed, expired, forged or v1 token is UNAUTHENTICATED", async () => {
    registerAppDb((fn) => fn(stubDb(membership("owner"))));
    await withSecret(async () => {
      const valid = (await createSessionToken(config, OSCAR))!;
      const parts = valid.split(".");
      const expired = (await createSessionToken(config, OSCAR, Date.now() - 13 * 3600_000))!;
      const forged = ["v2", PARTNER, parts[2], parts[3]].join(".");
      const tokens = [undefined, "", "garbage", `v1.${Date.now() + 1000}.sig`, expired, forged];
      for (const t of tokens) {
        expect(await withRequestContext(t, async () => "ran"), String(t))
          .toEqual({ ok: false, reason: "unauthenticated" });
      }
    });
  });

  it("FAILS CLOSED when the perimeter is unconfigured — a valid token is not enough", async () => {
    registerAppDb((fn) => fn(stubDb(membership("owner"))));
    const token = await withSecret(async () => (await createSessionToken(config, OSCAR))!);
    const saved = process.env.ASCEND_OS_SESSION_SECRET;
    delete process.env.ASCEND_OS_SESSION_SECRET;
    try {
      expect(await withRequestContext(token, async () => "ran"))
        .toEqual({ ok: false, reason: "unauthenticated" });
    } finally {
      if (saved !== undefined) process.env.ASCEND_OS_SESSION_SECRET = saved;
    }
  });

  it("FAILS CLOSED when no database is registered — it does not run the request anyway", async () => {
    clearAppDb();
    await withSecret(async () => {
      const token = (await createSessionToken(config, OSCAR))!;
      await expect(withRequestContext(token, async () => "ran")).rejects.toThrow(AppDbUnavailable);
    });
  });

  it("the connection is LEASED and RELEASED — one per request, never held", async () => {
    let open = 0, peak = 0;
    registerAppDb(async (fn) => {
      open++; peak = Math.max(peak, open);
      try { return await fn(stubDb(membership("owner"))); } finally { open--; }
    });
    await withSecret(async () => {
      const token = (await createSessionToken(config, OSCAR))!;
      await Promise.all([1, 2, 3].map(() => withRequestContext(token, async () => null)));
    });
    expect(open, "a connection outlived its request").toBe(0);
    expect(peak).toBeGreaterThan(0);
  });
});

describe("the prospect reader inherits the request, and refuses without one", () => {
  it("reading prospects outside a request context THROWS and does not read the vault", async () => {
    const saved = process.env.ASCEND_PROSPECT_SOURCE;
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    try {
      const { listProspects } = await import("@/core/crm");
      const { ProspectSourceUnavailable } = await import("@/core/crm/source");
      await expect(listProspects()).rejects.toThrow(ProspectSourceUnavailable);
      await expect(listProspects()).rejects.toThrow(/Refusing to fall back to the vault/);
    } finally {
      if (saved === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
      else process.env.ASCEND_PROSPECT_SOURCE = saved;
    }
  });

  /**
   * Record the identity a transaction was actually opened under.
   *
   * `asPrincipal` binds `ascend.org_id`, `ascend.user_id` and the database ROLE on the transaction,
   * and those three settings are the only thing RLS consults. So they are where "whose authority is
   * this running as?" is answerable — not the callback's closure, and not what the test hoped.
   */
  function recordingDb(bound: Array<{ org: string; user: string; role: string }>): SqlClient {
    let org = "", user = "", role = "";
    const c: SqlClient = {
      async query<T>(sql: string, params?: readonly unknown[]) {
        if (sql.includes("ascend.org_id")) org = String(params?.[0]);
        if (sql.includes("ascend.user_id")) user = String(params?.[0]);
        const m = /SET LOCAL ROLE (\w+)/.exec(sql);
        if (m) role = m[1];
        return { rows: [] as T[], affected: 0 };
      },
      async exec() {},
      async transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
        const out = await fn(c);
        bound.push({ org, user, role });
        return out;
      },
    };
    return c;
  }

  it("the seam reads the CONTEXT's principal, never a stored one", async () => {
    // The bridge made the seam async and moved the binding inside `requireCapability`, so what is
    // observable from here is WHICH principal the work runs as. Two requests in sequence, different
    // roles AND different organizations: the second must not inherit anything from the first.
    const { withProspectDb } = await import("@/core/crm/source");
    const { bindAuthorityResolver } = await import("@/lib/authority");
    const { clearAuthorityResolver } = await import("@/core/auth/authority");

    const bound: Array<{ org: string; user: string; role: string }> = [];
    bindAuthorityResolver();  // the PRODUCTION binding — context first, page memo second
    try {
      for (const [role, org, user] of [["owner", ORG, OSCAR], ["sales", OTHER_ORG, PARTNER]] as const) {
        const ran = await runInRequestContext(ctxFor(role, org, user, recordingDb(bound)), () =>
          withProspectDb(async () => "ran"));
        expect(ran).toBe("ran");
      }
    } finally {
      clearAuthorityResolver();
    }

    expect(bound).toEqual([
      { org: ORG, user: OSCAR, role: "ascend_owner" },
      { org: OTHER_ORG, user: PARTNER, role: "ascend_sales" },
    ]);
  });

  it("CONTROL · that assertion detects a seam that runs as somebody else", async () => {
    // Without this the test above proves nothing: an assertion that always passes looks identical
    // to one that passes for the right reason. So bind a resolver that ignores the context and
    // answers with a FIXED principal — the exact shape of the module-level principal F50 bans — and
    // confirm the recorded settings diverge from the context's.
    const { withProspectDb } = await import("@/core/crm/source");
    const { registerAuthorityResolver, clearAuthorityResolver } = await import("@/core/auth/authority");

    const bound: Array<{ org: string; user: string; role: string }> = [];
    registerAuthorityResolver(async () => ({
      ok: true, principal: __unsafePrincipalForTests("owner", ORG, OSCAR),
    }));
    try {
      await runInRequestContext(ctxFor("sales", OTHER_ORG, PARTNER, recordingDb(bound)), () =>
        withProspectDb(async () => "ran"));
    } finally {
      clearAuthorityResolver();
    }

    // The context said sales/OTHER_ORG; the stored principal won. That is the leak, and the
    // instrument sees it.
    expect(bound).toEqual([{ org: ORG, user: OSCAR, role: "ascend_owner" }]);
    expect(bound[0].org).not.toBe(OTHER_ORG);
  });

  // ─── THE OTHER CONNECTION SOURCE ─────────────────────────────────────────────────────────────
  //
  // ONE AUTHORIZATION, TWO CONNECTION SOURCES. Everything above exercises the first source: a route
  // handler that already holds a connection leased for its request. The tests below exercise the
  // second, which is the branch the Server Component bridge exists for and which had NO coverage at
  // all — a render has authority but no connection of its own, so the seam leases one.
  //
  // A branch with no test is not a branch that works; it is a branch nobody has looked at. And this
  // is the branch that was outright broken before the bridge: every rendered prospect read threw,
  // and the deployed UI could not show a prospect.
  //
  // SCOPE LIMIT, stated rather than implied: these prove the seam's behaviour when authority has
  // been established WITHOUT a request context. They do NOT prove that `lib/authority` falls
  // through to `pageAuthority()` under a real React render — that needs a real server, and it
  // belongs with the startup-binding property still open on `tests/render/page-isolation.test.ts`.

  it("WITHOUT a request context it LEASES a connection and runs as the resolved principal", async () => {
    const { withProspectDb } = await import("@/core/crm/source");
    const { registerAuthorityResolver, clearAuthorityResolver } = await import("@/core/auth/authority");

    const bound: Array<{ org: string; user: string; role: string }> = [];
    let leased = 0, released = 0;
    registerAppDb(async (fn) => {
      leased++;
      try { return await fn(recordingDb(bound)); } finally { released++; }
    });
    registerAuthorityResolver(async () => ({
      ok: true, principal: __unsafePrincipalForTests("sales", OTHER_ORG, PARTNER),
    }));

    try {
      expect(inRequestContext(), "this must run OUTSIDE a context — that is the branch").toBe(false);
      expect(await withProspectDb(async () => "rendered")).toBe("rendered");
    } finally {
      clearAuthorityResolver();
    }

    // The lease was taken for the read and given back — held for the work, not for the process.
    expect({ leased, released }).toEqual({ leased: 1, released: 1 });
    // And the work ran as the principal the RESOLVER produced. Same authorization as a route.
    expect(bound).toEqual([{ org: OTHER_ORG, user: PARTNER, role: "ascend_sales" }]);
  });

  it("WITHOUT a request context and WITHOUT authority it refuses — even though a connection exists", async () => {
    // The distinction this draws: the seam refuses for want of a PRINCIPAL, not for want of a
    // connection. Registering a working lease removes the other explanation, so a passing run
    // cannot be credited to the database simply being absent.
    const { withProspectDb, ProspectSourceUnavailable } = await import("@/core/crm/source");
    const { clearAuthorityResolver } = await import("@/core/auth/authority");

    let leased = 0;
    registerAppDb(async (fn) => { leased++; return fn(recordingDb([])); });
    clearAuthorityResolver();

    await expect(withProspectDb(async () => "rendered")).rejects.toThrow(ProspectSourceUnavailable);
    await expect(withProspectDb(async () => "rendered"))
      .rejects.toThrow(/established no authority[\s\S]*Refusing to fall back to the vault/);
    // It refused BEFORE touching the database. An unauthorized caller does not get a connection.
    expect(leased, "the seam took a connection for a caller with no authority").toBe(0);
  });

  it("INSIDE a request context it reuses that connection — it does not lease a second one", async () => {
    // Two connections in flight for one unit of work is the shape that exhausts a pool under load,
    // and it would also mean a request could observe itself through two sessions. The route branch
    // must therefore never reach the lease.
    const { withProspectDb } = await import("@/core/crm/source");
    const { bindAuthorityResolver } = await import("@/lib/authority");
    const { clearAuthorityResolver } = await import("@/core/auth/authority");

    const bound: Array<{ org: string; user: string; role: string }> = [];
    let leased = 0;
    registerAppDb(async (fn) => { leased++; return fn(recordingDb([])); });
    bindAuthorityResolver();
    try {
      await runInRequestContext(ctxFor("owner", ORG, OSCAR, recordingDb(bound)), () =>
        withProspectDb(async () => "handled"));
    } finally {
      clearAuthorityResolver();
    }

    expect(leased, "the request branch took a SECOND connection").toBe(0);
    // And it ran on the context's own connection, as the context's own principal.
    expect(bound).toEqual([{ org: ORG, user: OSCAR, role: "ascend_owner" }]);
  });
});
