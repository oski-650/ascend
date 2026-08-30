// The probe surfaces the render-isolation proof writes into `app/` for the duration of the test.
//
// They live here as STRINGS, not as committed pages, because a page under `app/` is a production
// surface — routable, buildable, and one forgotten deletion away from shipping. The suite writes
// them, measures, and removes them, and asserts the removal.
//
// `.gitignore` carries `app/2g-probe/` as a second line of defence: even a crashed run cannot leave
// something committable behind.

export const PROBE_DIR = "app/2g-probe";

/** A two-party barrier, so both renders are provably in flight before either observes anything. */
export const BARRIER_TS = `
class Barrier {
  private arrived = 0;
  private waiters: (() => void)[] = [];
  constructor(private parties: number, private timeoutMs = 15000) {}
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
export const realBarrier = new Barrier(2);
export const mutantBarrier = new Barrier(2);
`;

/**
 * A stubbed membership lookup registered inside the dev server.
 *
 * PRODUCTION IS NEVER TOUCHED: the probe needs two users with different roles, and production holds
 * one. Creating a second is provisioning — 2G.2's act, gated on this very proof. So the probe
 * supplies its own two, and the dev server runs without the production database environment.
 */
export const STUB_TS = `
import { registerAppDb } from "@/core/auth/connection";
import type { SqlClient } from "@/core/db";

export const OWNER = "0198f3a1-2b4c-7d8e-9f01-00000000aaaa";
export const SALES = "0198f3a1-2b4c-7d8e-9f01-00000000bbbb";
export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

const rows: Record<string, unknown[]> = {
  [OWNER]: [{ organization_id: ORG_A, role: "owner", disabled_at: null }],
  [SALES]: [{ organization_id: ORG_B, role: "sales", disabled_at: null }],
};

const client: SqlClient = {
  async query<T>(sql: string, params?: readonly unknown[]) {
    if (/FROM users/i.test(sql)) {
      // A deliberate delay INSIDE resolution widens the window in which a shared slot would be
      // overwritten. It makes the mutant's defect reproducible rather than a matter of luck.
      await new Promise((r) => setTimeout(r, 25));
      const r = (rows[String(params?.[0])] ?? []) as unknown as T[];
      return { rows: r, affected: r.length };
    }
    return { rows: [] as T[], affected: 0 };
  },
  async exec() {},
  async transaction<T>(fn: (tx: SqlClient) => Promise<T>) { return fn(client); },
};

let installed = false;
export function ensureStubDb(): void {
  if (installed) return;
  registerAppDb((fn) => fn(client));
  installed = true;
}
`;

/** The REAL implementation: React.cache-memoized resolution, observed after the barrier. */
export const REAL_PAGE_TSX = `
import { pageAuthority } from "@/lib/page-principal";
import { ensureStubDb } from "../stub";
import { realBarrier } from "../barrier";

export const dynamic = "force-dynamic";

export default async function RealProbe() {
  ensureStubDb();
  const before = await pageAuthority();
  const overlapped = await realBarrier.arriveAndWait();
  // Both renders are now inside their own pass. A shared memo would surface here.
  const after = await pageAuthority();
  const shape = (a: typeof after) =>
    a.ok ? { role: a.principal.role, org: String(a.principal.organizationId), user: String(a.principal.userId) }
         : { role: null, org: null, user: null, reason: a.reason };
  return <pre id="result">{JSON.stringify({ overlapped, before: shape(before), after: shape(after) })}</pre>;
}
`;

/**
 * The MUTANT: the same request path with the memoized resolver replaced by ONE MODULE-LEVEL SLOT.
 *
 * Sequentially correct — which is exactly how this class of defect survives review. It leaks only
 * when two renders overlap, which is why the barrier is a precondition rather than an assertion.
 */
export const MUTANT_PAGE_TSX = `
import { cookies } from "next/headers";
import { SESSION_COOKIE, readAuthConfig, verifySessionToken } from "@/lib/auth";
import { requireAppDb } from "@/core/auth/connection";
import { resolvePrincipal } from "@/core/auth/principal";
import { ensureStubDb } from "../stub";
import { mutantBarrier } from "../barrier";

export const dynamic = "force-dynamic";

type Seen = { role: string | null; org: string | null; user: string | null; reason?: string };
let slot: Seen | null = null;

async function resolveIntoSlot(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const identity = await verifySessionToken(token, readAuthConfig());
  if (!identity) { slot = { role: null, org: null, user: null, reason: "unauthenticated" }; return; }
  await requireAppDb()(async (client) => {
    const r = await resolvePrincipal(client, identity.userId);
    slot = r.ok
      ? { role: r.principal.role, org: String(r.principal.organizationId), user: String(r.principal.userId) }
      : { role: null, org: null, user: null, reason: r.reason };
  });
}

export default async function MutantProbe() {
  ensureStubDb();
  await resolveIntoSlot();
  const overlapped = await mutantBarrier.arriveAndWait();
  const after = slot!;                    // whoever wrote last
  return <pre id="result">{JSON.stringify({ overlapped, before: after, after })}</pre>;
}
`;
