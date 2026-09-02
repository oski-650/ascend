// Layer A — 2G.4.3 · THE PAGE MATRIX UNDER RESOLVED AUTHORITY
// (STAGE2G §29.6/§29.7, discharging §8 row 2, row 6 page-side, and row 7.)
//
// ─── WHAT THIS PROVES THAT `tests/architecture/f51-page-demand.test.ts` AND
//     `tests/auth/page-denial.test.ts` CANNOT ──────────────────────────────────────────────────
//
// Both existing page suites stub the authority resolver directly (`bindTestAuthority`,
// `tests/support/operator-session.ts`), which DECLARES a role by fiat. This suite renders the same
// 29 pages against a REAL Postgres (PGlite, full migration set), with both principals obtained the
// way `tests/support/provisioned-partner.ts` obtains one: an operational INSERT, a real
// `createInvitation` / `acceptInvitation` transaction, a real `POST /api/auth/login`, and
// `pageAuthority()` reading the row that chain wrote. No test declared a role; the database did.
//
// ─── 2G.4.3 MEASURED. 2G.4.4 FIXED. FACT A IS WHERE THE TWO MEET. ──────────────────────────────
//
// At `87bf7b7` Fact A recorded, as measured fact, that `admin`, `admin/import` and `admin/wipe`
// rendered for a `sales` principal BYTE-IDENTICALLY to the owner — the defect measured before it was
// fixed (§23.1's method). 2G.4.4 then made all three demand `admin:*` through `core/admin/tools`,
// and Fact A's assertions were INVERTED rather than deleted: the same derivation, the same five
// disclosure strings, the opposite expected answer.
//
// That inversion is the evidence the fix worked, and it is worth more than an assertion written
// afterwards would be, because the instrument predates the change it now measures. Deleting Fact A
// instead would have left the fix proven only by tests authored to agree with it.
//
// ─── WHAT THIS SUITE DOES NOT ESTABLISH ────────────────────────────────────────────────────────
//
//   1. `React.cache` memoization is NOT exercised. Outside a React render, `cache()` calls straight
//      through (`lib/page-principal.ts`'s own header) — row 10 (concurrent-render isolation) is
//      untouched by this file and remains proven only by `page-isolation.test.ts`.
//   2. The App Router is NOT exercised. No layout, no `middleware.ts`, no streaming, no Suspense, no
//      RSC serialization — a page's own default export is called directly. Client components render
//      against a STUB `AppRouterContext`, not a mounted router.
//   3. The perimeter is NOT exercised. `middleware.ts` never runs in this suite.
//   4. The OWNER's credential path is not exercised — `tokenFor` mints the owner's session directly
//      (§29.6a, inherited from 2G.4.2); only the owner's AUTHORITY is database-resolved.
//   5. Concurrency is NOT exercised. Every render below runs sequentially, each in its own request
//      scope entered and exited before the next begins.
//   6. SOME OWNER ROWS ARE FIXTURE-BOUNDED. `portal/[token]`, `portal/[token]/approve/[reqId]` and
//      `sales/[prospect]` reach `notFound()` for the owner because the fixture below names no such
//      token or prospect. `clients/[slug]`'s own client ("acme-co") IS seeded to its FOUND state —
//      see the positive control — which means every OTHER `clients/[slug]/*` sibling route
//      (`portal`, `project`) and `documents/[id]`/`production/[client]` (whose ids match the
//      fixture too) genuinely RENDER for the owner rather than reaching `notFound()`; this was
//      MEASURED, not assumed, after an earlier draft of this fixture named none of those ids and
//      wrongly predicted `notFound()` for all of them. For the rows that DO reach `notFound()` the
//      owner assertion proves NOT DENIED, never RENDERS DATA. Each is named individually at its own
//      assertion site so a green row cannot be misread as the stronger claim.
//   7. Exactly ONE row is a positive control with a body assertion. Every other row asserts the
//      VERDICT KIND only.
//
// ─── WHY `ASCEND_PROSPECT_SOURCE=postgres` ─────────────────────────────────────────────────────
//
// Unset means `vault`, and the vault reader needs no capability — under that configuration `sales`,
// `sales/[prospect]`, `partner` and `console` would all measure as demanding NOTHING, which is not
// the contract `PAGE_AUTHORIZATION` records (2E made `postgres` the deployed source of truth; see
// that file's own header). `core/crm/source.ts`'s `withProspectDb` still calls `requireCapability`
// first and then leases a connection through the SAME `requireAppDb()` slot this suite registers —
// so the read runs against this suite's own PGlite and returns an empty prospect list, which every
// consumer here tolerates.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
// `page-surface` MUST be the first import in this file (BINDING, measured — not stylistic).
// `next/dist/server/app-render/async-local-storage.js` caches `globalThis.AsyncLocalStorage` (or
// its own throwing fallback) into a MODULE-LEVEL CONSTANT the first time it is evaluated, and that
// caching is permanent for the life of the process. `@/lib/page-principal` imports `next/headers`,
// whose `cookies()` transitively reaches the SAME Next module — so importing it (or anything that
// imports it) BEFORE `page-surface.ts`'s own `vi.hoisted()` has run bakes in the throwing fallback
// forever, and every later `withPageRequest` call fails with "AsyncLocalStorage accessed in runtime
// where it is not available", regardless of what this file's own module-evaluation order looks like
// from `page-surface.ts` outward. Measured: moving this import below `@/lib/page-principal`
// reproduces the failure.
import { PAGE_KEYS, renderPage, withPageRequest, type PageVerdict } from "@/tests/support/page-surface";
import type { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readAuthConfig, verifySessionToken } from "@/lib/auth";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { pageAuthority } from "@/lib/page-principal";
import type { SqlClient } from "@/core/db";
import {
  SESSION_SECRET, bootDatabase, provisionPartner, tokenFor as tokenForUser, type World,
} from "@/tests/support/provisioned-partner";
import { PAGE_AUTHORIZATION } from "@/tests/architecture/page-authorization";

const PASSWORD = "a-sufficiently-long-page-matrix-partner-password";

/**
 * Held apart from `page-denial.test.ts`'s own copy on purpose — that suite's whole point is
 * measuring against a DECLARED contract without touching a database, and importing anything from a
 * suite in the provisioned evidence path would put a stub-authority file in this one's module graph
 * (the same reasoning `tests/support/route-surface.ts`'s header gives for re-declaring `requestAs`
 * rather than importing `tests/support/operator-session`).
 */
const SALES_HOLDS = new Set(["prospects:read", "prospects:write", "pipeline:read", "pipeline:write", "search"]);

/** Derived from `PAGE_AUTHORIZATION`, never a hand-written list — the same derivation `page-denial.test.ts` uses. */
const DENIES_SALES = Object.entries(PAGE_AUTHORIZATION)
  .filter(([, caps]) => caps.length > 0 && caps.some((c) => !SALES_HOLDS.has(c)))
  .map(([page]) => page)
  .sort();

/** Anything shaped like a capability. Reused verbatim from `page-denial.test.ts`'s own proven regex. */
const CAPABILITY_TOKEN = /\b\w+:(\*|read|write|toggle|admin|run|identity)\b/;
/** Fixture data that must never reach a denial. Reused verbatim from `page-denial.test.ts`'s own control. */
const FIXTURE_LEAK = /acme|invoice|\$[\d,]+/i;

/** §29.2(c), corrected 2026-09-01 to name all FIVE strings. */
const WIPE_DISCLOSURE_STRINGS = [
  "Wipes the seeded $4,541 revenue + care plans + overdue",
  "Wipes Pilar's 2 seeded signed approvals + any test ones",
  "Delete seeded Pilar + Tapia document trees",
  "Delete decoraciones-pilar CRM folder",
  "Delete tapia-tile-marble CRM folder",
];

let pg: PGlite;
let db: SqlClient;
let vaultDir: string;
let savedSecret: string | undefined;
let savedVault: string | undefined;
let savedSource: string | undefined;
let ownerToken: string;
let salesToken: string;
let matrixWorld: World;
type Verdicts = { owner: PageVerdict; sales: PageVerdict };
let matrix: Record<string, Verdicts>;

/**
 * A vault that puts `clients/[slug]` (slug `acme-co`) into its FOUND state, with a real document
 * and a real invoice, so the ONE positive control below has fixture data to find. Every OTHER
 * dynamic segment (`documents/[id]`, `production/[client]`, `portal/[token]*`, `sales/[prospect]`)
 * is left pointing at an id the fixture does not name, so those owner rows reach `notFound()` —
 * see header item 6.
 */
async function seedVault(dir: string): Promise<void> {
  const mk = (p: string) => fs.mkdir(path.join(dir, p), { recursive: true });
  await Promise.all([
    mk(".ascend-os"), mk("01 - CRM & Clients/acme-co"), mk("02 - Sales & Hit List"),
    mk("03 - SOP Library"), mk("04 - Documents/acme-co/proposal"), mk("05 - Client Uploads"),
  ]);
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/business_context.md"),
    "---\nname: Acme Co\nstatus: active\n---\n\nContext.\n");
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/production_state.md"),
    // QUOTED (measured): an unquoted YAML date is parsed as a JS `Date`, not a string, and
    // `lib/opportunities.ts:254`'s `s.launchTarget.trim()` throws on anything that isn't one.
    "---\nlaunch_target: \"2026-06-01\"\nphases:\n  discovery:\n    status: complete\n" +
    "  build:\n    status: in_progress\n---\n\n## Build\n- [ ] Wire the homepage\n- [x] Kickoff\n");
  await fs.writeFile(path.join(dir, "02 - Sales & Hit List/lead-one.md"),
    "---\nname: Lead One\nstatus: lead\n---\n\nNotes.\n");
  // THREE LEVELS DEEP (documents/<client>/<type>/<file>.md) — `walkDocs()` only yields at that
  // depth (measured by `f51-page-demand.test.ts`'s own fixture header).
  await fs.writeFile(path.join(dir, "04 - Documents/acme-co/proposal/proposal-v1.md"),
    "---\ndoc_id: doc-fixture-1\ntype: proposal\nclient: acme-co\ntitle: Acme Proposal\n" +
    "version: 1\nstatus: draft\ncreated_at: 2026-01-01T00:00:00.000Z\namount_usd: 1000\n---\n\nScope.\n");
  const issuedAt = new Date().toISOString();
  const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await fs.writeFile(path.join(dir, ".ascend-os/invoices.jsonl"),
    JSON.stringify({
      id: "inv-acme-1", client: "acme-co", amount_usd: 1000, label: "Acme retainer",
      issued_at: issuedAt, due_at: dueAt, paid_at: null, note: "",
    }) + "\n");
}

beforeAll(async () => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-page-matrix-"));
  await seedVault(vaultDir);
  process.env.ASCEND_VAULT_PATH = vaultDir;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";

  const booted = await bootDatabase();
  pg = booted.pg;
  db = booted.db;
  registerAppDb((fn) => fn(db));
  bindAuthorityResolver();

  const partner = await provisionPartner(db, {
    orgSlug: "page-matrix-org", ownerEmail: "page-matrix-owner@test",
    partnerEmail: "page-matrix-sales@test", password: PASSWORD,
  });
  if (!partner.login.sessionToken) {
    throw new Error("provisionPartner minted no session token — the chain broke before this suite began");
  }
  salesToken = partner.login.sessionToken;
  ownerToken = await tokenForUser(partner.world.ownerId);
  matrixWorld = partner.world;

  // F1 (adversarial pass, mirroring 2G.4.2's own): every assertion below reads a VERDICT KIND, never
  // the userId behind it, so a token minted for the wrong row would drift the whole matrix off the
  // database silently. Verified once, against the rows `matrixWorld` names, before either token is
  // treated as authority anywhere below.
  const ownerIdentity = await verifySessionToken(ownerToken, readAuthConfig());
  expect(ownerIdentity?.userId, "the owner token does not verify to the provisioned owner row")
    .toBe(matrixWorld.ownerId);
  const salesIdentity = await verifySessionToken(salesToken, readAuthConfig());
  expect(salesIdentity?.userId, "the sales token does not verify to the provisioned partner row")
    .toBe(matrixWorld.partnerId);

  // ─── I10 · THE GATE THAT RUNS BEFORE THE MATRIX ────────────────────────────────────────────
  //
  // Without this, a Next upgrade that reshapes the work-unit store makes `cookies()` throw, every
  // guarded page becomes `unauthorized`, and the matrix still reads as "nobody got in" rather than
  // failing loudly at its own precondition.
  const gate = await withPageRequest(salesToken, "i10-gate", () => pageAuthority());
  expect(gate.ok, "pageAuthority() did not resolve inside withPageRequest's own scope").toBe(true);
  if (gate.ok) {
    expect(gate.principal.userId, "the gate resolved the wrong user").toBe(matrixWorld.partnerId);
    expect(gate.principal.role, "the gate did not resolve to the provisioned partner's role").toBe("sales");
  }

  // The check above is necessary but not sufficient: a fabricated or substituted app-db lease that
  // simply echoes back the right userId/role would satisfy every line of it without the resolution
  // path ever terminating at the Postgres this suite booted — measured (adversarial pass): a static
  // in-memory client seeded once from these same ids left the gate above green. This closes that gap
  // the way route-matrix-provisioned's own F1 ("the registered lease IS the provisioned Postgres")
  // does: mutate the row on the RAW `pg` handle and require the resolution path to observe a change
  // no fabricated source ever saw. Restored in a `finally` (BINDING) — a mid-gate failure must not
  // leave `owner` on this row for the matrix build below to run against.
  try {
    await pg.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [matrixWorld.partnerId]);
    const mutated = await withPageRequest(salesToken, "i10-gate-mutated", () => pageAuthority());
    expect(mutated.ok, "pageAuthority() did not resolve after the row was mutated on the raw handle").toBe(true);
    if (mutated.ok) {
      expect(mutated.principal.role, "the resolution path is not reading the provisioned database — " +
        "it still answered the pre-mutation role after the raw handle was updated to 'owner'")
        .toBe("owner");
    }
  } finally {
    await pg.query("UPDATE memberships SET role='sales' WHERE user_id=$1", [matrixWorld.partnerId]);
  }

  // ─── I10's OWNER MIRROR · THE SAME GATE, FOR THE OTHER PRINCIPAL ───────────────────────────────
  //
  // The block above binds the resolution path only for the SALES token — I10, I3, ARM A and ARM B
  // are all sales-side bindings, so nothing above this line exercises the OWNER token against a
  // database write. Without this, every owner verdict the matrix below produces (all complement
  // rows and the positive control's body assertion) would be resolved against a source the database
  // never vouched for. Restored in a `finally` (BINDING), same discipline as the sales mirror above
  // — a mid-gate failure must not leave 'sales' on the owner's row for the matrix build to run
  // against. This is a PRECONDITION on the resolution path at the moment it runs, for the principal
  // it runs as — not a per-row guarantee about every owner row rendered below.
  try {
    await pg.query("UPDATE memberships SET role='sales' WHERE user_id=$1", [matrixWorld.ownerId]);
    const ownerMutated = await withPageRequest(ownerToken, "i10-gate-owner-mutated", () => pageAuthority());
    expect(ownerMutated.ok, "pageAuthority() did not resolve after the owner row was mutated on the raw handle")
      .toBe(true);
    if (ownerMutated.ok) {
      expect(ownerMutated.principal.role, "the owner-side resolution path is not reading the " +
        "provisioned database — it still answered the pre-mutation role after the raw handle was " +
        "updated to 'sales'").toBe("sales");
    }
  } finally {
    await pg.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [matrixWorld.ownerId]);
  }

  // ─── THE MATRIX ITSELF, BUILT ONCE ──────────────────────────────────────────────────────────
  matrix = {};
  for (const key of Object.keys(PAGE_KEYS)) {
    matrix[key] = {
      owner: await renderPage(key, ownerToken),
      sales: await renderPage(key, salesToken),
    };
  }
}, 60_000);

afterAll(async () => {
  await pg.close();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
  else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

beforeEach(() => {
  // Re-registered per test, mirroring 2G.4.2's own discipline: both slots are globalThis-keyed and
  // leak across files sharing a worker, so every `it` re-asserts its own registration rather than
  // trusting whatever a neighbouring file left behind. NO TRUNCATION (BINDING) — the matrix partner
  // provisioned once in `beforeAll` must still be readable by every `it` below.
  registerAppDb((fn) => fn(db));
  bindAuthorityResolver();
});

afterEach(() => {
  clearAppDb();
  clearAuthorityResolver();
});

// ─── I1/I2 · TOTALITY, BOTH DIRECTIONS ─────────────────────────────────────────────────────────

describe("I1/I2 · the corpus and the declared contract are the SAME SET", () => {
  it("every page.tsx on disk has a PAGE_AUTHORIZATION entry, and vice versa", () => {
    expect(Object.keys(PAGE_KEYS).sort()).toEqual(Object.keys(PAGE_AUTHORIZATION).sort());
  });
});

// ─── I4 · THE `error` ARM IS EMPTY ──────────────────────────────────────────────────────────────

describe("I4 · nothing in the matrix answers `error`", () => {
  it("no page, under either role, produced an unclassified failure", () => {
    const offenders: string[] = [];
    for (const key of Object.keys(matrix)) {
      for (const role of ["owner", "sales"] as const) {
        const v = matrix[key][role];
        if (v.kind === "error") {
          const e = (v as { error: unknown }).error;
          offenders.push(`${key} (${role}): ${String(e)}\n${e instanceof Error ? e.stack : ""}`);
        }
      }
    }
    expect(offenders, "an unclassified failure means the fixture or the harness is broken, not the " +
      "authorization boundary being measured").toEqual([]);
  });
});

// ─── I5 · SALES IS DENIED EXACTLY WHERE THE DECLARATION DEMANDS A CAPABILITY SALES LACKS ────────

describe("I5 · sales's denial matches DENIES_SALES exactly, in both directions", () => {
  for (const key of Object.keys(PAGE_AUTHORIZATION).sort()) {
    const shouldDeny = DENIES_SALES.includes(key);
    it(`${key} → sales verdict is ${shouldDeny ? "" : "NOT "}"denied"`, () => {
      const actual = matrix[key].sales.kind === "denied";
      expect(actual, `${key}: DENIES_SALES says ${shouldDeny}, measured ${actual}`).toBe(shouldDeny);
    });
  }
});

// ─── I6 · THE OWNER IS NEVER DENIED, REFUSED, OR UNAUTHORIZED ──────────────────────────────────

describe("I6 · a database-resolved owner is never denied, refused, or unauthorized", () => {
  for (const key of Object.keys(PAGE_AUTHORIZATION).sort()) {
    it(`${key} → owner is not denied/refused/unauthorized`, () => {
      const kind = matrix[key].owner.kind;
      expect(["denied", "refused", "unauthorized"], `${key}: owner verdict was ${kind}`)
        .not.toContain(kind);
    });
  }
});

// ─── I7 · THE Denied MARKUP CARRIES NO DATA AND NAMES NO CAPABILITY ────────────────────────────

describe("I7 · every denied sales render leaks no capability and no fixture data", () => {
  for (const key of DENIES_SALES) {
    it(`${key} · sales's Denied markup names no capability and carries no fixture data`, () => {
      const v = matrix[key].sales;
      expect(v.kind, `${key} did not actually deny sales`).toBe("denied");
      if (v.kind !== "denied") return;
      expect(v.html, `${key} named a capability on a denial`).not.toMatch(CAPABILITY_TOKEN);
      expect(v.html, `${key} leaked fixture data into a denial`).not.toMatch(FIXTURE_LEAK);
    });
  }
});

// ─── FACT A · THE ADMIN DISCLOSURE, CLOSED — THE INVERSION OF WHAT 2G.4.3 RECORDED ─────────────
//
// DERIVED, not hand-picked: every page whose key starts with "admin" is a candidate, and the filter
// is the SAME ONE 2G.4.3 used — "sales renders, byte-identical to the owner's render". At `87bf7b7`
// that filter selected exactly `["admin", "admin/import", "admin/wipe"]`. It must now select nothing.
//
// The three explicit rows below are not redundant with I5, which already derives sales's denial from
// `PAGE_AUTHORIZATION`. I5 would go green if the DECLARATION were reverted alongside the pages; these
// name the three pages the finding was about, so a future edit that quietly returns any of them to a
// presentational shell fails HERE with the finding's own name attached.

describe("Fact A · the admin disclosure is closed — sales is denied where it used to render", () => {
  const adminPrefixed = Object.keys(PAGE_KEYS).filter((k) => k === "admin" || k.startsWith("admin/")).sort();

  it("all four admin pages are in the corpus — the set is derived from disk, not maintained", () => {
    expect(adminPrefixed).toEqual(["admin", "admin/import", "admin/invitations", "admin/wipe"]);
  });

  it("the derived disclosure set is now EMPTY — a fix to two of three would fail this", () => {
    // Computed INSIDE the `it`, not at describe-collection time — `matrix` does not exist until
    // `beforeAll` has run, and describe bodies execute during collection, before any hook does.
    const discloses = adminPrefixed.filter((k) => {
      const { owner, sales } = matrix[k];
      return owner.kind === "rendered" && sales.kind === "rendered" && owner.html === sales.html;
    }).sort();
    expect(discloses, "an admin page still renders for sales exactly as it does for the owner")
      .toEqual([]);
  });

  for (const key of ["admin", "admin/import", "admin/wipe"]) {
    it(`${key} · the owner renders and sales is DENIED — the flip parked finding 1 asked for`, () => {
      const { owner, sales } = matrix[key];
      expect(owner.kind, `${key}: the owner lost a page they are entitled to`).toBe("rendered");
      expect(sales.kind, `${key}: sales still reaches this page`).toBe("denied");
    });
  }

  it("admin/wipe · all FIVE §29.2(c) strings reach the OWNER and none reaches sales", () => {
    // §29.11 Q3 was answered by MOVING the copy behind `listWipeTargets()`, not deleting it — so the
    // strings must still be there for whoever may destroy the data, and gone for whoever may not.
    // Asserting only the absence would pass if the copy had simply been deleted, which is a different
    // decision than the one taken; both halves are required for this test to mean what it says.
    expect(WIPE_DISCLOSURE_STRINGS).toHaveLength(5);

    const owner = matrix["admin/wipe"].owner;
    expect(owner.kind).toBe("rendered");
    if (owner.kind !== "rendered") return;
    // React's server renderer HTML-entity-escapes text content (measured: the source's plain `'`
    // becomes `&#x27;`) — decoded here so "verbatim" means the disclosed WORDS, not raw bytes
    // matching a JSX literal that was never going to survive HTML serialization unescaped.
    const decodedOwner = owner.html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    for (const str of WIPE_DISCLOSURE_STRINGS) {
      expect(decodedOwner, `the owner lost: ${str}`).toContain(str);
    }

    const sales = matrix["admin/wipe"].sales;
    expect(sales.kind).toBe("denied");
    if (sales.kind !== "denied") return;
    const decodedSales = sales.html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    for (const str of WIPE_DISCLOSURE_STRINGS) {
      expect(decodedSales, `still disclosed to sales: ${str}`).not.toContain(str);
    }
  });
});

// ─── FACT C · dashboard's REDIRECT TERMINATES AT A ROW THIS SAME MATRIX ALREADY CLASSIFIES ──────
//
// `search` gets the identical treatment as a CONTROL, so the chain-following mechanism is general
// rather than special-cased to dashboard's convenient answer.

describe("Fact C · a redirecting page's target is itself a row in this matrix", () => {
  for (const key of ["dashboard", "search"] as const) {
    it(`${key} redirects identically under both roles, and its target's row matches DENIES_SALES`, () => {
      const { owner, sales } = matrix[key];
      expect(owner.kind, `${key} (owner)`).toBe("redirect");
      expect(sales.kind, `${key} (sales)`).toBe("redirect");
      if (owner.kind !== "redirect" || sales.kind !== "redirect") return;
      expect(sales.digest, `${key}: digest differs by role`).toBe(owner.digest);

      // The target is PARSED from the digest via Next's own helper (`page-surface.ts`'s
      // `classifyThrown`), never compared as a hardcoded string here.
      const targetKey = owner.target === "/" ? "/" : owner.target.replace(/^\//, "").replace(/\?.*$/, "");
      expect(PAGE_KEYS[targetKey], `${key}'s target "${owner.target}" is not a page in this matrix`)
        .toBeDefined();

      const targetDenied = matrix[targetKey].sales.kind === "denied";
      expect(targetDenied, `${key} -> ${targetKey}: DENIES_SALES says ${DENIES_SALES.includes(targetKey)}`)
        .toBe(DENIES_SALES.includes(targetKey));
    });
  }

  it("dashboard's target specifically is / — named, not left to whatever the derivation found", () => {
    const { owner } = matrix.dashboard;
    if (owner.kind !== "redirect") throw new Error("dashboard did not redirect — see the test above");
    expect(owner.target).toBe("/");
    expect(owner.status).toBe(307);
    // MEASURED: Next's own digest carries a trailing separator the plan's shorthand omits —
    // `${CODE};${type};${url};${status};` (next/dist/client/components/redirect.js:38).
    expect(owner.digest).toBe("NEXT_REDIRECT;replace;/;307;");
    expect(DENIES_SALES).toContain("/");
  });
});

// ─── THE POSITIVE CONTROL (I3's non-vacuity, mirrored from route-matrix-provisioned) ────────────
//
// EXACTLY ONE: `clients/[slug]` at slug `acme-co`. The owner sees the seeded document title and the
// seeded invoice figure; sales sees a small `Denied` surface containing neither.

describe("The positive control · the owner can see what sales is denied", () => {
  it("clients/[slug] (acme-co) · owner renders the seeded document title and invoice figure", () => {
    const v = matrix["clients/[slug]"].owner;
    expect(v.kind).toBe("rendered");
    if (v.kind !== "rendered") return;
    expect(v.html, "the seeded document title is missing — this control is vacuous")
      .toContain("Acme Proposal");
    expect(v.html, "the seeded invoice figure is missing — this control is vacuous")
      .toContain("$1,000");
  });

  it("clients/[slug] (acme-co) · sales sees Denied, containing neither the title nor the figure", () => {
    const v = matrix["clients/[slug]"].sales;
    expect(v.kind).toBe("denied");
    if (v.kind !== "denied") return;
    expect(v.html).not.toContain("Acme Proposal");
    expect(v.html).not.toContain("$1,000");
  });
});

// ─── HEADER ITEM 6, NAMED PER ROW ───────────────────────────────────────────────────────────────

describe("Header item 6 · fixture-bounded owner rows prove NOT DENIED, not RENDERS DATA", () => {
  const FIXTURE_BOUNDED = [
    "portal/[token]", "portal/[token]/approve/[reqId]", "sales/[prospect]",
  ];
  for (const key of FIXTURE_BOUNDED) {
    it(`${key} · owner reaches notFound() against this fixture — NOT a claim that it renders data`, () => {
      expect(matrix[key].owner.kind, `${key}: expected notFound, this fixture names no such entity`)
        .toBe("notFound");
    });
  }

  // F2: this loop proves exactly what header item 6 claims, and no more — that the owner did NOT
  // reach `notFound()` for every OTHER row. It does NOT prove the page rendered DATA. `rendered` is
  // a weak witness here: `app/page.tsx:39-40` wraps `graphSource()` and `assemblePriorityFeed()` in
  // unfiltered `.catch()`s (no `unstable_rethrow`) over a call chain that reaches
  // `requireCapability("clients:*")`, so a denial inside that chain degrades to an EMPTY shell that
  // still reports `rendered` rather than surfacing as `denied` or `error` — measured: with `seedVault`
  // reduced to bare directories, roughly two-thirds of these rows still pass while rendering nothing.
  // Derived from `PAGE_AUTHORIZATION` rather than hand-listed, so the fixture-bounded set above cannot
  // silently grow (e.g. by deleting `production_state.md` from `seedVault`) without this failing.
  for (const key of Object.keys(PAGE_AUTHORIZATION)) {
    if (FIXTURE_BOUNDED.includes(key)) continue;
    if (key === "dashboard" || key === "search") continue; // redirects, asserted in Fact C
    it(`${key} · owner render is NOT fixture-bounded — i.e., it did not reach notFound()`, () => {
      expect(matrix[key].owner.kind, `${key}: expected rendered`).toBe("rendered");
    });
  }
});

// ─── I3 · THE CONNECTION CONTROL, THE REASON THIS SUITE EXISTS ─────────────────────────────────
//
// `finance` flipped directly on the raw PGlite handle — not through any application role, the same
// discipline route-matrix-provisioned's own F1 test and `tests/db/provisioned-partner.test.ts`'s row
// 7 test both use. Restored unconditionally so a mid-test failure cannot poison a later test that
// still expects the shared matrix partner to hold `sales`.
describe("I3 · the verdict a page reaches is a function of a row in memberships", () => {
  it("finance / sales -> denied -> UPDATE role='owner' -> rendered -> restore -> denied", async () => {
    try {
      const before = await renderPage("finance", salesToken);
      expect(before.kind, "finance should deny sales before the flip").toBe("denied");

      await pg.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [matrixWorld.partnerId]);
      const during = await renderPage("finance", salesToken);
      expect(during.kind, "the lease is not reading the provisioned database").toBe("rendered");
    } finally {
      await pg.query("UPDATE memberships SET role='sales' WHERE user_id=$1", [matrixWorld.partnerId]);
    }
    const after = await renderPage("finance", salesToken);
    expect(after.kind, "the role restore did not take effect").toBe("denied");
  });
});

// ─── I8/I9 · ROW 6/7 PAGE-SIDE · A REVOKED MEMBERSHIP IS DENIED ON THE VERY NEXT RENDER ─────────
//
// Two arms, each provisioning its OWN partner so neither writes to, nor depends on the ordering of,
// the shared matrix partner above. Derived from `PAGE_AUTHORIZATION`, never hardcoded targets.

/** Pages that demand at least one capability sales HOLDS — arm A's candidates. */
function notDeniedWithDemand(): string[] {
  return Object.entries(PAGE_AUTHORIZATION)
    .filter(([, caps]) => caps.length > 0 && caps.every((c) => SALES_HOLDS.has(c)))
    .map(([k]) => k)
    .sort();
}

// ─── WHAT 2G.4.5 CHANGED IN ALL THREE ARMS, AND WHY IT IS A STRONGER TEST ──────────────────────
//
// Every arm below used to end on `kind === "unauthorized"` plus `reason === "disabled"`, and the
// reason assertion was doing ALL the discriminating work: `lib/page-principal` reports a database
// OUTAGE with the same kind (`reason: "unavailable"`), so the kind alone said nothing (§29.6d).
//
// §29.3 Ruling 3 split the type. A revoked account now reaches `AccountInactive` — verdict
// `"inactive"` — while an outage is still RETHROWN as `NoAuthority` and lands on `"unauthorized"`.
// The two are separated by the VERDICT now, not by a free-form string, and ARM D below is the
// control that measures the other side of the split rather than asserting it.
describe("I8/I9 · disabled_at denies a valid, unexpired session on the very next render", () => {
  it("ARM A — a NOT-DENIED, capability-demanding page: rendered → disabled_at set → inactive",
    async () => {
      const candidates = notDeniedWithDemand();
      expect(candidates.length, "no not-denied, capability-demanding page exists to derive arm A from")
        .toBeGreaterThan(0);
      const key = candidates[0];
      const revoked = await provisionPartner(db, {
        orgSlug: "page-matrix-arm-a-org", ownerEmail: "page-matrix-arm-a-owner@test",
        partnerEmail: "page-matrix-arm-a-partner@test", password: PASSWORD,
      });
      const token = revoked.login.sessionToken;
      if (!token) throw new Error("arm A provisioning minted no session token");

      const before = await renderPage(key, token);
      expect(before.kind, `${key} should not be denied before revocation`).not.toBe("denied");
      expect(before.kind, `${key} should not be unauthorized before revocation`).not.toBe("unauthorized");

      await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [revoked.world.partnerId]);

      // The SIGNED SESSION ITSELF is untouched — a revocation, not an expiry or a forgery.
      const stillSigned = await verifySessionToken(token, readAuthConfig());
      expect(stillSigned?.userId, "the token stopped verifying — this must be a disabled-user " +
        "refusal, not an expired or forged one").toBe(revoked.world.partnerId);

      const after = await renderPage(key, token);
      // "inactive", not "denied" (identity was lost, not a capability) and not "unauthorized"
      // (the database ANSWERED — it was not unreachable). `automations` is one of the four pages
      // 2G.4.5 wrapped precisely so this row could be a named surface rather than an outage message.
      expect(after.kind, `${key}: a revoked principal must reach the named surface`).toBe("inactive");
    });

  // ─── ARM C · §29.6c RETIRED BY MEASUREMENT, NOT BY THE FIX BEING PLAUSIBLE ───────────────────
  //
  // §29.6c measured this table at `87bf7b7`, for a principal whose `disabled_at` was set while the
  // cookie still verified to the same user id:
  //
  //     finance      (declares finance:*)   -> NoAuthority("disabled")     refused, correctly
  //     admin        (declares [])          -> RENDERS IN FULL
  //
  // and named the mechanism: revocation is enforced where authority is REQUESTED, and a page
  // demanding nothing never requests it. Arms A and B revoke a PARTNER, so they cannot speak to
  // these three — after 2G.4.4 a partner is denied here before any revocation, and "denied then
  // unauthorized" would not be the row §29.6c wrote down. This arm revokes the OWNER, the only
  // principal who now renders them, so the inverted row is the same row:
  //
  //     admin/import/wipe (declare admin:*) -> RENDERS IN FULL -> disabled_at -> inactive
  //
  // The owner's session is MINTED (§29.6a, header item 4); their AUTHORITY is database-resolved,
  // which is the half this arm is about.
  it("ARM C — §29.6c's three pages: owner renders → disabled_at set → inactive",
    async () => {
      const revoked = await provisionPartner(db, {
        orgSlug: "page-matrix-arm-c-org", ownerEmail: "page-matrix-arm-c-owner@test",
        partnerEmail: "page-matrix-arm-c-partner@test", password: PASSWORD,
      });
      const token = await tokenForUser(revoked.world.ownerId);

      for (const key of ["admin", "admin/import", "admin/wipe"]) {
        const before = await renderPage(key, token);
        expect(before.kind, `${key}: the owner must render it before revocation, or this arm ` +
          "measures nothing").toBe("rendered");
      }

      await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [revoked.world.ownerId]);

      // The SIGNED SESSION ITSELF is untouched — a revocation, not an expiry or a forgery.
      const stillSigned = await verifySessionToken(token, readAuthConfig());
      expect(stillSigned?.userId, "the token stopped verifying — this must be a disabled-user " +
        "refusal, not an expired or forged one").toBe(revoked.world.ownerId);

      for (const key of ["admin", "admin/import", "admin/wipe"]) {
        const after = await renderPage(key, token);
        expect(after.kind, `${key} still rendered for a revoked principal — §29.6c is not retired`)
          .toBe("inactive");
      }
    });

  it("ARM B — a DENIED page: denied → disabled_at set → inactive, not denied", async () => {
    expect(DENIES_SALES.length, "no denied page exists to derive arm B from").toBeGreaterThan(0);
    const key = DENIES_SALES[0];
    const revoked = await provisionPartner(db, {
      orgSlug: "page-matrix-arm-b-org", ownerEmail: "page-matrix-arm-b-owner@test",
      partnerEmail: "page-matrix-arm-b-partner@test", password: PASSWORD,
    });
    const token = revoked.login.sessionToken;
    if (!token) throw new Error("arm B provisioning minted no session token");

    const before = await renderPage(key, token);
    expect(before.kind, `${key} should be denied before revocation — a live principal denied a ` +
      "capability").toBe("denied");

    await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [revoked.world.partnerId]);

    const stillSigned = await verifySessionToken(token, readAuthConfig());
    expect(stillSigned?.userId, "the token stopped verifying — this must be a disabled-user " +
      "refusal, not an expired or forged one").toBe(revoked.world.partnerId);

    const after = await renderPage(key, token);
    // BINDING: "inactive", NOT "denied". A "denied" verdict here would mean the principal still
    // resolved and only the capability check failed — the identity-loss/capability-loss confusion
    // this arm exists to rule out. The two surfaces are different components, compared by TYPE in
    // `page-surface.ts`, so this cannot pass on a coincidence of markup.
    expect(after.kind, `${key} should be "inactive" after disabling — "denied" would mean the ` +
      "principal still resolved, which disabled_at must prevent").toBe("inactive");
  });

  // ─── ARM D · THE OTHER SIDE OF THE SPLIT, MEASURED ──────────────────────────────────────────
  //
  // Without this, every arm above would pass on a handler that converted `NoAuthority` WHOLESALE —
  // which is exactly the change §29.3 Ruling 3 refused to make, because reporting an unreachable
  // database as "this account isn't active" is the dangerous direction.
  //
  // The outage is REAL, not simulated at the class level: `clearAppDb()` empties the connection slot,
  // so `requireAppDb()` throws inside `pageAuthority()` and the page path produces
  // `unavailable` — the same code path a genuine outage takes. Restored in a `finally`; `beforeEach`
  // would re-register it anyway, but a failure inside this test must not reach the next one first.
  it("ARM D — an OUTAGE on the SAME page is still rethrown: unauthorized(unavailable), not inactive",
    async () => {
      const key = DENIES_SALES[0];
      const revoked = await provisionPartner(db, {
        orgSlug: "page-matrix-arm-d-org", ownerEmail: "page-matrix-arm-d-owner@test",
        partnerEmail: "page-matrix-arm-d-partner@test", password: PASSWORD,
      });
      const token = revoked.login.sessionToken;
      if (!token) throw new Error("arm D provisioning minted no session token");

      try {
        clearAppDb();
        const out = await renderPage(key, token);
        expect(out.kind, `${key}: an outage reached the account surface — NoAuthority is being ` +
          "converted as a class again, which Ruling 3 forbids").toBe("unauthorized");
        if (out.kind === "unauthorized") expect(out.reason).toBe("unavailable");
      } finally {
        registerAppDb((fn) => fn(db));
      }
    });
});
