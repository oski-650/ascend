// Layer A — THE 2G.1 MUTATION GATE. The proof that the DAL boundary is request-scoped.
//
// ─── WHAT IS BEING MUTATED, AND WHY THAT ONE ───────────────────────────────────────────────────
//
// NOT `requireCapability` returning the wrong verdict — that would only prove a test notices a
// broken `if`. The valuable mutation is ARCHITECTURAL, and for this boundary it is a change in what
// the module-level slot HOLDS:
//
//     real     let resolver: () => Promise<Answer>     a QUESTION, asked afresh on every call
//     mutant   let principal: ResolvedPrincipal        an ANSWER, written once and reused
//
// That is the defect the design exists to prevent, and it is the same shape as the
// `registerProspectDb` slot removed in 7.2: one value shared by every caller, where a leak is a
// race rather than a bug anyone can see in a diff.
//
// ─── THREE PARTS, IN ORDER, AND THE MIDDLE ONE IS THE POINT ────────────────────────────────────
//
//   1  genuine overlap — a barrier makes simultaneity a PRECONDITION of the test completing
//   2  the mutant leaks — observable cross-role and cross-tenant data
//   3  the real implementation — zero crossover under the same overlap
//
// If part 1 fails, stop: nothing downstream means anything. If part 2 does not fail, the test is not
// sensitive enough — strengthen the test, never weaken the gate.
//
// ─── NOT `bindTestAuthority` ───────────────────────────────────────────────────────────────────
//
// That helper registers a resolver returning ONE fixed principal. It is right for engine tests
// declaring a caller and useless here: it cannot distinguish "answer per call" from "answer reused",
// which is the entire question. Overlap is established with two DIFFERENT principals carried in real
// `AsyncLocalStorage` request contexts, exactly as a route handler carries them.
//
// ─── NO `pg_backend_pid` ───────────────────────────────────────────────────────────────────────
//
// 7.3 proved database concurrency and could count distinct backends. This boundary is in-process:
// overlap is proven by the barrier releasing and by two distinct principals being observed inside
// the critical section at the same time.

import { afterEach, describe, expect, it, vi } from "vitest";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { clearAuthorityResolver } from "@/core/auth/authority";
import type { SqlClient } from "@/core/db";
import type { OrganizationId, UserId } from "@/domain";

const ORG_A = "11111111-1111-4111-8111-111111111111" as OrganizationId;
const ORG_B = "22222222-2222-4222-8222-222222222222" as OrganizationId;
const OWNER = "0198f3a1-2b4c-7d8e-9f01-00000000aaaa" as UserId;
const SALES = "0198f3a1-2b4c-7d8e-9f01-00000000bbbb" as UserId;

/** Two DIFFERENT principals, in different organizations, so crossover is unmistakable. */
const PRINCIPALS = {
  owner: __unsafePrincipalForTests("owner", ORG_A, OWNER),
  sales: __unsafePrincipalForTests("sales", ORG_B, SALES),
};

const noopDb: SqlClient = {
  async query() { return { rows: [], affected: 0 }; },
  async exec() {},
  async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(noopDb); },
};

/** Blocks every arriving party until `parties` have arrived. Timeout names the failure. */
class Barrier {
  private arrived = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly parties: number, private readonly timeoutMs = 5_000) {}
  async arriveAndWait(): Promise<boolean> {
    this.arrived++;
    if (this.arrived >= this.parties) {
      const w = this.waiters; this.waiters = []; this.arrived = 0;
      for (const r of w) r();
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const t = setTimeout(() => { this.arrived = 0; resolve(false); }, this.timeoutMs);
      this.waiters.push(() => { clearTimeout(t); resolve(true); });
    });
  }
}

type Observation = {
  kind: "owner" | "sales";
  overlapped: boolean;
  role: string;
  org: string;
  /** True ONLY for an authorization refusal. An I/O failure is not a denial. */
  adminDenied: boolean;
};

/**
 * One request, carried the way a route handler carries one.
 *
 * The first `requireCapability` is the call that would WRITE a module-level answer. The barrier then
 * holds until both requests are inside their contexts. Everything observed afterwards is observed
 * while the other request is also live.
 */
type Graph = {
  authority: {
    requireCapability: (c: never) => Promise<{ role: string; organizationId: string }>;
    CapabilityDenied: new (...a: never[]) => Error;
    NoAuthority: new (...a: never[]) => Error;
  };
  guarded: { listAdminTools: () => Promise<unknown> };
  context: { runInRequestContext: <T>(ctx: unknown, fn: () => Promise<T>) => Promise<T> };
};

async function request(
  kind: "owner" | "sales",
  barrier: Barrier,
  g: Graph
): Promise<Observation> {
  const { authority: mod, guarded, context } = g;
  // The context module comes from the SAME graph as the resolver. AsyncLocalStorage identity is
  // per module instance: writing to one instance and reading from another silently produces "no
  // context", which fails closed for the wrong reason and would have made this gate meaningless.
  return context.runInRequestContext({ principal: PRINCIPALS[kind], db: noopDb }, async () => {
    // 1 — first touch. Both roles hold pipeline:read, so this succeeds for either.
    await mod.requireCapability("pipeline:read" as never);

    // 2 — both requests are now provably in flight, each inside its own context.
    const overlapped = await barrier.arriveAndWait();

    // 3 — who does the boundary think is calling, NOW?
    const seen = await mod.requireCapability("pipeline:read" as never);

    // 4 — the data-level consequence. The discriminator must be a capability the two roles do NOT
    //     share, or this check reports nothing whichever principal answered.
    //
    //     IT WAS `finance:*` UNTIL 2G.4.7, and that stopped discriminating: the partner became
    //     `owner` minus `admin:*`, so a sales request is no longer denied finance and this line
    //     fired on every honest round. Loosening it to "either role may read finance" would have
    //     deleted the data-level layer of the gate while leaving it green — so it moved to the ONE
    //     capability the two roles still differ on. `listAdminTools` demands `admin:*` and leases no
    //     connection, so the only way it can fail is authorization.
    //
    //     Denial is distinguished from failure by ERROR TYPE, not by absence of a result. Treating
    //     an I/O failure as a denial is exactly the conflation this boundary exists to prevent — the
    //     first version of this test made that mistake and reported the OWNER as crossed over.
    let adminDenied = false;
    try {
      await guarded.listAdminTools();
    } catch (e) {
      adminDenied = e instanceof g.authority.CapabilityDenied || e instanceof g.authority.NoAuthority;
    }

    return { kind, overlapped, role: seen.role, org: String(seen.organizationId), adminDenied };
  });
}

/** Every way an observation can disagree with the identity its request was made under. */
function crossoverIn(obs: Observation[]): string[] {
  const out: string[] = [];
  for (const o of obs) {
    const wantRole = o.kind;
    const wantOrg = o.kind === "owner" ? ORG_A : ORG_B;
    if (o.role !== wantRole) out.push(`${o.kind} request saw role=${o.role}`);
    if (o.org !== wantOrg) out.push(`${o.kind} request saw another tenant's organization`);
    if (o.kind === "sales" && !o.adminDenied) out.push("SALES REQUEST WAS NOT DENIED ADMIN DATA");
    if (o.kind === "owner" && o.adminDenied) out.push("owner request was denied its own admin access");
  }
  return out;
}

async function round(g: Graph): Promise<Observation[]> {
  const barrier = new Barrier(2);
  return Promise.all([request("owner", barrier, g), request("sales", barrier, g)]);
}

/**
 * Load the boundary and a guarded consumer FROM THE CURRENT MODULE GRAPH, and bind the real
 * resolver into that same instance.
 *
 * `vi.resetModules()` gives the next `import()` a fresh module, so a statically imported binder
 * would register into a stale one and every call would fail closed with `no-resolver` — correct
 * behaviour, wrong cause, and it cost a debugging round here.
 */
async function loadReal(): Promise<Graph> {
  const authority = await import("@/core/auth/authority");
  const context = await import("@/core/auth/context");
  const { bindAuthorityResolver } = await import("@/lib/authority");
  bindAuthorityResolver();
  const guarded = await import("@/core/admin/tools");
  return { authority, guarded, context } as unknown as Graph;
}

afterEach(() => { vi.doUnmock("@/core/auth/authority"); vi.resetModules(); clearAuthorityResolver(); });

describe("PART 1 · genuine overlap", () => {
  it("two requests with DIFFERENT principals are inside the boundary simultaneously", async () => {
    const obs = await round(await loadReal());

    // The barrier releasing is the proof: neither request could pass it alone.
    expect(obs.every((o) => o.overlapped), "the requests did not overlap — this file proves nothing")
      .toBe(true);
    // And they were genuinely two identities, not one run twice.
    expect(new Set(obs.map((o) => o.kind)).size).toBe(2);
  });

  it("THE CONTROL · the barrier fails loudly when only one party arrives", async () => {
    const lonely = new Barrier(2, 300);
    expect(await lonely.arriveAndWait()).toBe(false);
  });
});

describe("PART 2 · MUTATION — a module-level ANSWER instead of a module-level QUESTION", () => {
  it("leaks observably: one request's authority answers for the other", async () => {
    // The mutant differs from the real module in exactly one respect: what the slot holds.
    //
    //   real    let resolver: () => Promise<Answer>   asked afresh on every call
    //   mutant  let answer: ResolvedPrincipal         written once, reused by whoever asks next
    //
    // Everything else — the capability table, the request contexts, the guarded finance module, the
    // barrier — is unchanged, so the ONLY variable between this round and PART 3 is the mechanism.
    // (`guarded` is `core/admin/tools`, whose `admin:*` boundary is the one capability the two roles
    // still differ on — see the note in `request()` on why it stopped being `finance:*`.)
    vi.resetModules();
    vi.doMock("@/core/auth/authority", async () => {
      const { can } = await import("@/core/auth/capabilities");
      type P = { role: string; organizationId: string };
      let resolver: (() => Promise<{ ok: boolean; principal?: P; reason?: string }>) | null = null;
      let answer: P | null = null;                    // ← THE DEFECT
      class NoAuthority extends Error {}
      class CapabilityDenied extends Error {
        constructor(readonly capability: string, readonly role: string) { super("denied"); }
      }
      return {
        NoAuthority, CapabilityDenied,
        registerAuthorityResolver: (r: typeof resolver) => { resolver = r; },
        clearAuthorityResolver: () => { resolver = null; answer = null; },
        requireCapability: async (capability: string) => {
          if (!answer) {
            if (!resolver) throw new NoAuthority("no-resolver");
            const a = await resolver();
            if (!a.ok || !a.principal) throw new NoAuthority(a.reason ?? "unknown");
            answer = a.principal;
          }
          if (!can(answer as never, capability as never)) {
            throw new CapabilityDenied(capability, answer.role);
          }
          return answer;
        },
      };
    });

    const authority = await import("@/core/auth/authority");
    const context = await import("@/core/auth/context");
    const { bindAuthorityResolver } = await import("@/lib/authority");
    bindAuthorityResolver();
    const guarded = await import("@/core/admin/tools");

    const obs = await round({ authority, context, guarded } as unknown as Graph);
    expect(obs.every((o) => o.overlapped), "the mutant round did not overlap").toBe(true);

    const leaks = crossoverIn(obs);

    // THE GATE. An empty result here means the test cannot detect removal of the mechanism, and
    // PART 3 proves nothing. Strengthen the test — never weaken this assertion.
    expect(leaks.length,
      "THE MUTATION SURVIVED. A module-level ResolvedPrincipal produced no observable crossover, " +
      "so this file is not measuring request-scoped authority."
    ).toBeGreaterThan(0);

    // And it must be an AUTHORIZATION failure with data attached, not a mislabelled field.
    expect(leaks.some((l) => /NOT DENIED FINANCE DATA|another tenant/.test(l)),
      `the mutant leaked, but not as cross-role or cross-tenant access: ${leaks.join(" | ")}`).toBe(true);

    console.info(`\n      MUTATION DETECTED — ${leaks.length} crossings:\n        ${leaks.join("\n        ")}\n`);
  });
});

describe("PART 3 · the real implementation, under that same overlap", () => {
  it("produces ZERO crossover, repeatedly", async () => {
    const g = await loadReal();
    const found: string[] = [];
    for (let i = 0; i < 5; i++) {
      const obs = await round(g);
      expect(obs.every((o) => o.overlapped), `round ${i} did not overlap`).toBe(true);
      found.push(...crossoverIn(obs));
    }
    expect(found, "authority crossed between concurrent requests").toEqual([]);
  });
});
