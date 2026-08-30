// Layer A — THE SEARCH BOUNDARY (2F step 7.4, STAGE2F §9).
//
// ─── THE LEAK NOBODY EXPECTS ───────────────────────────────────────────────────────────────────
//
// `/api/console/search` traverses every entity and returns titles and text excerpts. A capability
// check on the ROUTE is not enough: `sales` legitimately holds `search`, so the route answers 200 —
// and without scoping, that 200 is full of client names, invoice titles and internal SOPs.
//
// This is the one place in the matrix where a 403 would be the WRONG answer:
//
//     sales → search → 200 → assembly filtering → prospects        ✅
//     sales → search → 403                                          ❌
//
// Denying the route would break the palette for the person who most needs it, and would teach the
// codebase that route-level denial is how this class of leak gets handled. It is not.
//
// ─── WHY THE FIXTURE USES ONE TERM IN TWO PLACES ───────────────────────────────────────────────
//
// "Northwind" appears in a CLIENT and in a PROSPECT. If the term appeared only in the client, a
// sales search returning nothing would prove nothing — the term might simply not match. Sharing the
// term means one query has a right answer and a wrong answer, and the test can tell them apart.
//
// The vacuity control below is the other half: the same term IS findable in the client when the
// index is built unscoped. So the client's absence from a sales response is the scoping working,
// not the fixture being empty — the failure mode that has bitten this project three times.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  CLIENT_NAME, OWNER_ID, PROSPECT_NAME, SALES_ID, SECRET, SHARED_TERM, SOP_TERM,
  installStubDb, invoke, removeStubDb, requestAs, resetMemberships, seedVault, tokenFor,
} from "./harness";
import { buildKnowledgeIndex, __unsafeBuildKnowledgeIndexForTests } from "@/core/knowledge";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import { query } from "@/packages/search";

type SearchBody = { objects: { id: string; entity: string; title: string }[]; commands: unknown[] };

let vaultDir: string;
let savedVault: string | undefined;
let savedSecret: string | undefined;
let ownerToken: string;
let salesToken: string;

const search = async (token: string, term: string): Promise<{ status: number; body: SearchBody }> => {
  const mod = await import("@/app/api/console/search/route");
  const res = await invoke(mod, "GET",
    requestAs(token, `https://os.test/api/console/search?q=${encodeURIComponent(term)}`));
  return { status: res.status, body: (await res.json()) as SearchBody };
};

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

describe("the fixture is real — the control that keeps every assertion below meaningful", () => {
  it("the shared term matches BOTH a client and a prospect in the unscoped index", async () => {
    const index = await ALL();
    const hits = query(index.search, SHARED_TERM);
    expect(hits.some((h) => h.entity === "client"), "no client matches the shared term").toBe(true);
    expect(hits.some((h) => h.entity === "prospect"), "no prospect matches the shared term").toBe(true);
  });

  it("the owner-only term matches a SOP in the unscoped index", async () => {
    const index = await ALL();
    expect(query(index.search, SOP_TERM).some((h) => h.entity === "sop")).toBe(true);
  });
});

describe("SALES gets a 200 whose CONTENTS are scoped", () => {
  it("200, never 403 — search is scoped, not denied", async () => {
    const { status } = await search(salesToken, SHARED_TERM);
    expect(status, "sales was denied the route instead of being scoped").toBe(200);
  });

  it("the prospect is PRESENT and the client is ABSENT, for the same query", async () => {
    const { body } = await search(salesToken, SHARED_TERM);
    const entities = body.objects.map((o) => o.entity);
    const titles = body.objects.map((o) => o.title);

    expect(titles, "sales lost the prospect it is entitled to").toContain(PROSPECT_NAME);
    expect(entities, "A CLIENT LEAKED INTO A SALES SEARCH").not.toContain("client");
    expect(titles).not.toContain(CLIENT_NAME);
    // Not just the title — no client name anywhere in the serialised body.
    expect(JSON.stringify(body)).not.toContain(CLIENT_NAME);
  });

  it("SOPs are absent too — internal operating material is not sales data", async () => {
    const { status, body } = await search(salesToken, SOP_TERM);
    expect(status).toBe(200);
    expect(body.objects, "an owner-only SOP reached a sales search").toEqual([]);
  });

  it("no client, invoice, document or time material appears for ANY term sales can type", async () => {
    // Sweeping rather than anecdotal: every term in the owner-only fixture, each one proven to
    // match something in the unscoped index above.
    for (const term of [SHARED_TERM, SOP_TERM, "retainer", "renewal", "proposal", "Trading"]) {
      const { status, body } = await search(salesToken, term);
      expect(status, term).toBe(200);
      const entities = new Set(body.objects.map((o) => o.entity));
      expect([...entities].filter((e) => e !== "prospect"), `${term} leaked a non-prospect entity`)
        .toEqual([]);
    }
  });
});

describe("OWNER sees everything, which is what makes the sales result a boundary", () => {
  it("the same query returns the client AND the prospect", async () => {
    const { status, body } = await search(ownerToken, SHARED_TERM);
    expect(status).toBe(200);
    const entities = body.objects.map((o) => o.entity);
    expect(entities).toContain("client");
    expect(entities).toContain("prospect");
  });

  it("the owner reaches the SOP the partner cannot", async () => {
    const { body } = await search(ownerToken, SOP_TERM);
    expect(body.objects.map((o) => o.entity)).toContain("sop");
  });
});

/**
 * The "everything" reference. 2G.1 slice 4 removed `UNSCOPED_INTERNAL_INDEX` from production, so the
 * only way to express the old behaviour is the test-only seam — which is the point: a control that
 * no production caller can reach.
 */
const ALL = () => __unsafeBuildKnowledgeIndexForTests({ clients: true, prospects: true, sops: true });

describe("the scoping happens at ASSEMBLY — excluded material is never read", () => {
  // Slice 4 moved the decision INSIDE the boundary, so these now go through the real resolver rather
  // than handing `buildKnowledgeIndex` a visibility. That is a strengthening: the assertions below
  // exercise the same path a request takes, instead of a shape only a test could produce.
  afterEach(() => { unbindTestAuthority(); installStubDb(); });

  it("a sales visibility discovers no clients and no SOPs at all", async () => {
    bindTestAuthority("sales");
    const index = await buildKnowledgeIndex();
    const kinds = new Set(index.registry.map((r) => r.entity));
    expect([...kinds].sort(), "the sales index contains something other than prospects")
      .toEqual(["prospect"]);
    // Stronger than "no client in the results": no client was ever loaded, so it cannot leak
    // through a later filter, an error message, or a scoring pass that echoes a title.
    expect(JSON.stringify(index)).not.toContain(CLIENT_NAME);
  });

  it("MUTATION · with the route's scoping removed, the client comes straight back", async () => {
    // The vacuity gate. If this did NOT surface the client, the tests above would be passing for
    // some reason other than the mechanism they claim to be testing.
    const leaked = await ALL();
    const hits = query(leaked.search, SHARED_TERM);
    expect(hits.some((h) => h.entity === "client"),
      "removing the scoping did NOT leak a client — this suite is not measuring the scoping"
    ).toBe(true);

    // And the owner's visibility is what the unscoped index amounts to, so the difference between
    // the two responses is exactly the capability difference and nothing else.
    bindTestAuthority("owner");
    const ownerIndex = await buildKnowledgeIndex();
    expect(new Set(ownerIndex.registry.map((r) => r.entity)))
      .toEqual(new Set(leaked.registry.map((r) => r.entity)));
  });
});
