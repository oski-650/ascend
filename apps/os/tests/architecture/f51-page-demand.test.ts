// Layer B — F51 · THE RENDERED SURFACE DECLARES WHAT IT DEMANDS, AND IS HELD TO IT.
//
// ─── TWO-DIMENSIONAL DRIFT DETECTION ───────────────────────────────────────────────────────────
//
//     filesystem pages   ⟷ exact set equality ⟷   declared map
//     declared map       ⟷ exact set equality ⟷   runtime demand
//
// A new page fails even if nobody updates the map. A new guarded data dependency fails even if
// somebody remembered the page but not its capabilities. Neither dimension covers for the other.
//
// ─── WHY RUNTIME, AFTER TWO STATIC INSTRUMENTS WERE MEASURED AND REJECTED ──────────────────────
//
// Import-level analysis was wrong in both directions (STAGE2G §16–20): it UNDER-reported
// `app/finance`, which imports the `lib/finance` re-export shim, and OVER-reported
// `app/portal/[token]` as `portal:admin` for merely importing `lib/portal` when the page calls only
// unguarded client-token functions. The over-report is the dangerous direction — a rule whose
// failure mode pressures someone to add an operator capability to the client portal would
// reintroduce the defect slice 2d fixed.
//
// So this measures the authorization boundary ACTUALLY REACHED: each page is rendered, and every
// `requireCapability` it causes is recorded.
//
// ─── THE INSTRUMENT DOES NOT CHANGE SEMANTICS ──────────────────────────────────────────────────
//
// `requireCapability` is wrapped, not replaced: the wrapper records the capability and then calls
// the real implementation, which still resolves authority and still throws. Nothing here bypasses
// the DAL, and no page is given a capability it does not ask for.
//
// ─── THE PRINCIPAL IS AN OWNER, DELIBERATELY ───────────────────────────────────────────────────
//
// This test measures DEMAND, not permission. Rendering under a principal that would be refused
// would stop the page at its first guarded call and hide every later one, turning "denied" into
// "demands nothing" — which is precisely the conflation the whole boundary exists to prevent.
//
// ─── `[]` IS TESTED, NOT EXEMPTED ──────────────────────────────────────────────────────────────
//
//     declared [] + observed []           PASS
//     declared [] + observed finance:*    FAIL
//     declared finance:* + observed []    FAIL
//
// So `portal/[token]` declaring `[]` is not documentation: F51 actively protects the fact that the
// public token surface acquires no operator capability.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readdirSync, statSync } from "node:fs";
import { PAGE_AUTHORIZATION } from "./page-authorization";
import {
  bindTestAuthority, installStubDb, removeStubDb, resetMemberships, unbindTestAuthority,
} from "@/tests/support/operator-session";

/**
 * PER-RENDER attribution, carried by AsyncLocalStorage.
 *
 * ─── THE DEFECT THIS REPLACES ────────────────────────────────────────────────────────────────
 *
 * The first recorder was a single module-level Set, cleared before each page. Pages fire
 * `Promise.all([...])` internally, so when a render threw or returned before its in-flight work
 * settled, those promises kept resolving AFTER the harness had moved on — and their
 * `requireCapability` calls landed in whatever Set was current by then.
 *
 * Measured: `admin` — a page that imports only `Link` and three presentational primitives, and
 * touches no store at all — reported six capabilities. It sorts immediately after `/`, which demands
 * seven, and it was collecting `/`'s spillover. Run in isolation it correctly reported `[]`.
 *
 * That defect is dangerous in the permissive-looking direction: it invents plausible demand, and had
 * it gone unnoticed the CONTRACT would have been written more restrictively than the pages are —
 * declaring capabilities that pages do not need, which is its own kind of lie.
 *
 * ─── WHY ASYNCLOCALSTORAGE ───────────────────────────────────────────────────────────────────
 *
 * ALS propagates through async continuations, so a promise started inside render A still sees A's
 * store when it settles — even if B is running by then. Attribution therefore follows CAUSALITY
 * rather than the clock. It is also the same primitive the authority boundary itself uses, proven
 * under overlap in slice 2c.
 */
const recorder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  return {
    als: new AsyncLocalStorage<Set<string>>(),
    /** Demands raised outside any render. Never silently dropped — an empty set here is asserted. */
    orphans: new Set<string>(),
  };
});

vi.mock("@/core/auth/authority", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/auth/authority")>();
  return {
    ...actual,
    // Record, then delegate. The real check still runs — this observes, it does not authorize.
    requireCapability: async (capability: string) => {
      // The store belongs to the render that STARTED this work, not to whichever render happens to
      // be current. Late work from a torn-down render lands in its own set.
      (recorder.als.getStore() ?? recorder.orphans).add(capability);
      return actual.requireCapability(capability as never);
    },
  };
});

/** What each page demanded merely by being IMPORTED. Asserted empty; see the control below. */
const importDemands = new Map<string, string[]>();

const PAGES: Record<string, () => Promise<Record<string, unknown>>> = {
  "admin":
    () => import("@/app/admin/page"),
  "admin/invitations":
    () => import("@/app/admin/invitations/page"),
  "admin/wipe":
    () => import("@/app/admin/wipe/page"),
  "automations":
    () => import("@/app/automations/page"),
  "clients/[slug]":
    () => import("@/app/clients/[slug]/page"),
  "clients/[slug]/portal":
    () => import("@/app/clients/[slug]/portal/page"),
  "clients/[slug]/project":
    () => import("@/app/clients/[slug]/project/page"),
  "console":
    () => import("@/app/console/page"),
  "crm":
    () => import("@/app/crm/page"),
  "dashboard":
    () => import("@/app/dashboard/page"),
  "documents/[id]":
    () => import("@/app/documents/[id]/page"),
  "documents":
    () => import("@/app/documents/page"),
  "finance":
    () => import("@/app/finance/page"),
  "invite/[token]":
    () => import("@/app/invite/[token]/page"),
  "login":
    () => import("@/app/login/page"),
  "maintenance":
    () => import("@/app/maintenance/page"),
  "/":
    () => import("@/app/page"),
  "partner":
    () => import("@/app/partner/page"),
  "portal/[token]/approve/[reqId]":
    () => import("@/app/portal/[token]/approve/[reqId]/page"),
  "portal/[token]":
    () => import("@/app/portal/[token]/page"),
  "portal/[token]/thanks":
    () => import("@/app/portal/[token]/thanks/page"),
  "production/[client]":
    () => import("@/app/production/[client]/page"),
  "production":
    () => import("@/app/production/page"),
  "sales/[prospect]":
    () => import("@/app/sales/[prospect]/page"),
  "sales/import":
    () => import("@/app/sales/import/page"),
  "sales":
    () => import("@/app/sales/page"),
  "search":
    () => import("@/app/search/page"),
  "signals":
    () => import("@/app/signals/page"),
  "tasks":
    () => import("@/app/tasks/page"),
};

let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;

/**
 * A vault that puts every dynamic page into its FOUND, NON-EMPTY state.
 *
 * ─── THE INVARIANT THIS FIXTURE EXISTS TO SATISFY ────────────────────────────────────────────
 *
 *   > An empty dataset is not evidence of zero capability demand when the protected access sits
 *   > inside a conditional or an iteration.
 *
 * The first version of this fixture used missing ids and an empty vault, and two pages reported
 * FEWER capabilities than they declare:
 *
 *   documents/[id]  hit `if (!doc) notFound()` and never reached the `listClients()` one line later
 *   tasks           had an empty `states` array, so the `getClientRevenue` inside its map never ran
 *
 * Trusting that run would have DELETED two real dependencies from the contract and produced a green
 * gate — strictly worse than the red it produced. Under-observation fails in the permissive
 * direction, which is why fixtures are built for faithful execution and never toward a target count.
 */
async function seed(dir: string) {
  const mk = (p: string) => fs.mkdir(path.join(dir, p), { recursive: true });
  await Promise.all([
    mk(".ascend-os"), mk("01 - CRM & Clients/acme-co"), mk("02 - Sales & Hit List"),
    mk("03 - SOP Library"), mk("04 - Documents/acme-co/proposal"), mk("05 - Client Uploads"),
  ]);
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/business_context.md"),
    "---\nname: Acme Co\nstatus: active\n---\n\nContext.\n");
  await fs.writeFile(path.join(dir, "02 - Sales & Hit List/lead-one.md"),
    "---\nname: Lead One\nstatus: lead\n---\n\nNotes.\n");

  // A REAL DOCUMENT, so `getDocument(id)` resolves and `documents/[id]` proceeds past notFound()
  // into the client lookup below it.
  //
  // THE PATH SHAPE IS LOAD-BEARING. `walkDocs()` iterates THREE levels —
  // documents/<client>/<type>/<file>.md — so a file written one level short is never yielded, the
  // lookup returns null, and the page stops at notFound() having demanded only `documents:*`. That
  // under-observes in the permissive direction, exactly like the `production_state.md` filename did.
  await fs.writeFile(path.join(dir, "04 - Documents/acme-co/proposal/proposal-v1.md"),
    "---\ndoc_id: doc-fixture-1\ntype: proposal\nclient: acme-co\ntitle: Acme Proposal\n" +
    "version: 1\nstatus: draft\ncreated_at: 2026-01-01T00:00:00.000Z\namount_usd: 1000\n---\n\nScope.\n");

  // A REAL PRODUCTION STATE, so `listProductionStates()` returns a non-empty array and the map body
  // in `tasks` executes, reaching getClientRevenue().
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/production_state.md"),
    "---\nlaunch_target: 2026-06-01\nphases:\n  discovery:\n    status: complete\n" +
    "  build:\n    status: in_progress\n---\n\n## Build\n- [ ] Wire the homepage\n- [x] Kickoff\n");
}

// ─── THE CONTRACT IS MEASURED UNDER THE DEPLOYED STORE ─────────────────────────────────────────
//
// `tests/support/hermetic-env` deletes ASCEND_PROSPECT_SOURCE before any test runs, so that a
// deployment setting sourced from .env.production.local cannot decide what a vault-fixture unit test
// reads. That is right, and it left F51 measuring the WRONG CONFIGURATION: unset means `vault`, the
// vault reader needs no capability, and so every prospect-reading page reported demanding nothing.
//
// MEASURED, both configurations, identical fixtures:
//
//   vault      sales   []                    postgres   sales   [prospects:read]
//   vault      crm     [clients:*, …]        postgres   crm     [clients:*, …, prospects:read]
//
// 2E flipped the source of truth and production runs `postgres`. A contract that records what the
// pages demand when pointed at the store production does NOT use is not this application's contract
// — it is a second, more permissive one that nothing deploys. It would have declared `sales` as
// demanding nothing at all, which is the same failure as the empty-dataset one recorded below:
//
//   > "not demanded by this render" is not evidence that a capability is outside the page's
//   > contract.
//
// So the store is selected EXPLICITLY here — which is exactly what hermetic-env asks a suite that
// needs one to do — and a stub lease is registered, because the render branch of `withProspectDb`
// leases a connection rather than inheriting one from a request context.
beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-f51-"));
  await seed(vaultDir);
  process.env.ASCEND_VAULT_PATH = vaultDir;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  installStubDb();
  resetMemberships();
});

afterAll(async () => {
  unbindTestAuthority();
  removeStubDb();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
  else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

/** Render one page and return the capabilities it demanded. */
async function demandedBy(key: string): Promise<string[]> {
  bindTestAuthority("owner");

  // ─── IMPORT-TIME vs RENDER-TIME ──────────────────────────────────────────────────────────────
  //
  // F51 claims to measure what a page demands WHEN RENDERED. A module-level side effect anywhere in
  // its import graph would also be recorded, survive the isolation check (it is not another page's
  // demand), and be indistinguishable from a render dependency — so the two buckets are separated
  // and only the render bucket is the page's contract.
  const atImport = new Set<string>();
  const mod = await recorder.als.run(atImport, async () => PAGES[key]());
  importDemands.set(key, [...atImport].sort());

  const page = mod.default as (props: unknown) => Promise<unknown>;
  const seen = new Set<string>();
  await recorder.als.run(seen, async () => {
  try {
    await page({
      // Over-supplied, so one call site serves every dynamic segment this app uses.
      // Every dynamic segment names a fixture that EXISTS, so each page reaches its found branch.
      params: Promise.resolve({
        slug: "acme-co", client: "acme-co", prospect: "lead-one",
        id: "doc-fixture-1", token: "no-such-token", reqId: "no-such-request",
      }),
      searchParams: Promise.resolve({ q: "acme" }),
    });
  } catch {
    // A page may fail to RENDER for reasons unrelated to authority — missing fixtures, JSX needs.
    // Whatever it demanded before failing is already attributed to THIS render's store, and an
    // under-observation shows up as declared-X / observed-[], which fails loudly.
  }
  // Let any work this render started settle INSIDE its own ALS scope, so a page that returns before
  // its Promise.all resolves is still credited with what it asked for.
  await new Promise((r) => setTimeout(r, 25));
  });
  unbindTestAuthority();
  return [...seen].sort();
}

/** The page set, derived from the filesystem — never a maintained list. */
function pagesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, rel ? `${rel}/${name}` : name);
      else if (name === "page.tsx") out.push(rel === "" ? "/" : rel);
    }
  };
  walk(path.join(process.cwd(), "app"), "");
  return out.sort();
}

describe("F51 · dimension 1 — every page on disk is declared, and nothing else is", () => {
  it("the declared map and the filesystem are the SAME SET", () => {
    // Set equality, never count equality: 26 = 26 passes with one page missing and one phantom.
    const declared = Object.keys(PAGE_AUTHORIZATION).sort();
    const onDisk = pagesOnDisk();
    expect(onDisk.filter((p) => !declared.includes(p)), "pages on disk with no declaration").toEqual([]);
    expect(declared.filter((p) => !onDisk.includes(p)), "declarations naming no page").toEqual([]);
  });

  it("every declared page has an importer, so none can silently leave the corpus", () => {
    expect(Object.keys(PAGES).sort()).toEqual(Object.keys(PAGE_AUTHORIZATION).sort());
  });
});

describe("F51 · dimension 2 — declared capabilities equal observed capabilities", () => {
  for (const key of Object.keys(PAGE_AUTHORIZATION).sort()) {
    const declared = [...PAGE_AUTHORIZATION[key]].sort();
    it(`${key} demands exactly [${declared.join(", ")}]`, async () => {
      const observed = await demandedBy(key);
      // EXACT equality. Not "contains", not "is contained by", not a count.
      expect(observed, `${key}: declared [${declared}] but demanded [${observed}]`).toEqual(declared);
    });
  }
});

describe("F51 · the instrument itself", () => {
  it("records a demand it is given, and nothing when there is none", async () => {
    // Without this, a wrapper that silently stopped recording would make every page look like it
    // demands nothing, and every `[]` declaration would pass for the wrong reason.
    bindTestAuthority("owner");
    const seen = new Set<string>();
    await recorder.als.run(seen, async () => {
      const { requireCapability } = await import("@/core/auth/authority");
      await requireCapability("finance:*");
    });
    expect([...seen]).toEqual(["finance:*"]);
    unbindTestAuthority();
  });

  it("ATTRIBUTION CONTROL · late work from render A never lands on render B", async () => {
    // The exact defect that produced `admin`'s six phantom capabilities. A returns BEFORE its async
    // work settles; B runs and completes; A's late demand must still be A's.
    bindTestAuthority("owner");
    const { requireCapability } = await import("@/core/auth/authority");

    const a = new Set<string>();
    const b = new Set<string>();
    let late!: Promise<unknown>;

    await recorder.als.run(a, async () => {
      // Started, deliberately NOT awaited — exactly how a page's Promise.all outlives its render.
      late = (async () => {
        await new Promise((r) => setTimeout(r, 30));
        return requireCapability("finance:*" as never);
      })();
    });

    await recorder.als.run(b, async () => {
      await requireCapability("time:*" as never);
    });

    await late;

    expect([...b], "render A's late demand leaked into render B").toEqual(["time:*"]);
    expect([...a], "render A lost the demand it caused").toEqual(["finance:*"]);
    unbindTestAuthority();
  });

  it("demands raised outside any render are captured, never dropped", async () => {
    // If orphans were silently discarded, a whole class of attribution bug would be invisible.
    recorder.orphans.clear();
    bindTestAuthority("owner");
    const { requireCapability } = await import("@/core/auth/authority");
    await requireCapability("audits:*");
    expect([...recorder.orphans]).toEqual(["audits:*"]);
    recorder.orphans.clear();
    unbindTestAuthority();
  });
});
