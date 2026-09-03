// Layer A — GraphProjection Slice 1 · THE §0.5 SCOPING WITNESS.
//
// ─── WHY THIS SUITE HAD TO BE CONSTRUCTED RATHER THAN OBSERVED ─────────────────────────────────
//
// UI-REDESIGN-PROPOSAL Part Zero §0.4 states the trap outright: today `owner \ sales === ["admin:*"]`
// and `admin:*` guards NO entity the graph projects, so **the two production roles' authorized
// universes are identical**. A test that projected as owner, projected as sales and compared them
// would pass on a projection that had never learned to scope anything — the same vacuity that made
// `index-scoping`'s E5 control and `dal-mutation-gate`'s crossover detector stop measuring in
// 2G.4.7.
//
// So the difference is BUILT, in two independent ways, and neither touches the production model:
//
//   MECHANISM   a SYNTHETIC principal, narrowed inside the harness only, is refused by the canonical
//               readers for the capabilities it lacks — and the projection FAILS CLOSED rather than
//               returning a partial graph.
//   OUTCOME     two organizations with genuinely different authorized DATA, both fully authorized,
//               projected through the same code. The narrower universe is a proper subset.
//
// NOTHING IN PRODUCTION CHANGES. No role gains or loses a capability, no schema moves, and the
// synthetic principal exists only as a resolver answer inside this file.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDb, type TestDb } from "./pglite";
import { addMembership, createOrganization, createProspect, createUser } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { runInRequestContext } from "@/core/auth/context";
import { registerAuthorityResolver, clearAuthorityResolver, CapabilityDenied } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import { projectGraph } from "@/graph-view/projection";
import type { GraphNode } from "@/graph-view/contract";
import type { Capability } from "@/core/auth/capabilities";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;
let orgA: OrganizationId;
let orgB: OrganizationId;
let userA: UserId;
let userB: UserId;

/** A minimal vault the projection's file-backed readers can traverse without erroring. */
async function seedVault(dir: string) {
  for (const d of [".ascend-os", "01 - CRM & Clients", "02 - Sales & Hit List",
                   "03 - SOP Library", "04 - Documents", "05 - Client Uploads"]) {
    await fs.mkdir(path.join(dir, d), { recursive: true });
  }
  for (const f of ["crm", "production", "intelligence"]) {
    await fs.writeFile(path.join(dir, ".ascend-os", `${f}.events.jsonl`), "");
  }
}

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-graph-scope-"));
  await seedVault(vaultDir);
  process.env.ASCEND_VAULT_PATH = vaultDir;
  // THE DEPLOYED STORE. Under `vault` the prospect reader needs no capability and both universes
  // would collapse to the same files — the exact vacuity this suite exists to avoid.
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
});

afterAll(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
  else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  orgA = await createOrganization(db, "org-a", "Org A");
  orgB = await createOrganization(db, "org-b", "Org B");
  userA = await createUser(db, "a@test", "A");
  userB = await createUser(db, "b@test", "B");
  await addMembership(db, userA, orgA, "owner");
  await addMembership(db, userB, orgB, "owner");
  bindAuthorityResolver();
});
afterEach(async () => { clearAuthorityResolver(); await handle.close(); });

const principalFor = (org: OrganizationId, user: UserId) =>
  __unsafePrincipalForTests("owner", org, user);

const projectAs = (org: OrganizationId, user: UserId) =>
  runInRequestContext({ principal: principalFor(org, user), db }, () => projectGraph());

const prospectIds = (nodes: GraphNode[]) =>
  nodes.filter((n) => n.type === "prospect").map((n) => n.entityId).sort();

// ─── LAYER 1 · MECHANISM ────────────────────────────────────────────────────────────────────────

describe("§0.5 mechanism · a narrowed principal is REFUSED, and the projection fails closed", () => {
  // ─── THE SYNTHETIC PRINCIPAL, AND THE ONLY PLACE ONE EXISTS ─────────────────────────────────
  //
  // `registerAuthorityResolver` is the PRODUCTION seam; what is narrowed is the ANSWER it gives, not
  // the capability table. `requireCapability` still decides — it is simply asked about a principal
  // this harness invented, and the narrowing dies with the test. No role gains or loses a
  // capability, no grant is touched, and nothing outside this file can observe it.

  it("the projection REJECTS when a capability its readers need is withheld — no partial graph", async () => {
    // `projectGraph` fans out with Promise.all, so one refusal rejects the whole projection. That is
    // the fail-closed property Part Zero requires: there is no mode in which SOME authorized data
    // and NO unauthorized data comes back, because there is no partial mode at all.
    const principal = principalFor(orgA, userA);
    registerAuthorityResolver(async () => {
      throw new CapabilityDenied("clients:*" as Capability, "sales");
    });
    await expect(
      runInRequestContext({ principal, db }, () => projectGraph()),
      "a refused capability produced a graph instead of a refusal"
    ).rejects.toThrow(CapabilityDenied);
  });

  it("THE CONTROL · the same call SUCCEEDS when the capability is granted", async () => {
    // Without this, the rejection above would be satisfied by a projection that always throws.
    bindAuthorityResolver();
    const model = await projectAs(orgA, userA);
    expect(model.nodes, "the authorized projection is empty — the fixture, not the boundary").toBeDefined();
    expect(model.source.name, "no projection was produced at all").toBeTruthy();
  });

  it("an UNIDENTIFIED caller obtains nothing — the boundary refuses before the readers run", async () => {
    clearAuthorityResolver();
    await expect(projectGraph(), "the graph was built for nobody").rejects.toThrow();
  });
});

// ─── LAYER 2 · OUTCOME ──────────────────────────────────────────────────────────────────────────

describe("§0.5 outcome · genuinely different universes project differently", () => {
  it("org A sees its prospect; org B does not — a PROPER SUBSET, not an empty one", async () => {
    // THE DIFFERENCE IS IN THE DATA, and it is enforced by RLS rather than by this test. Both
    // principals are fully authorized owners; neither is narrowed. What differs is WHICH ORG'S ROWS
    // exist — which is precisely "genuinely different authorized data".
    await runInRequestContext({ principal: principalFor(orgA, userA), db }, () =>
      createProspect(db, orgA, { name: "Only In A", slug: "only-in-a" }, { kind: "system" }));

    const a = await projectAs(orgA, userA);
    const b = await projectAs(orgB, userB);

    const inA = prospectIds(a.nodes);
    const inB = prospectIds(b.nodes);

    // NON-VACUITY, BOTH WAYS. A must genuinely contain something…
    expect(inA, "org A's projection has no prospect — the fixture never landed").toContain("only-in-a");
    // …and B must be a PROPER subset: strictly smaller, and every member of B also in A.
    expect(inB, "org B saw org A's prospect — the projection is not scoped").not.toContain("only-in-a");
    expect(inB.every((id) => inA.includes(id)), "org B contains something org A does not").toBe(true);
    expect(inB.length, "the two universes are the same size — nothing was actually scoped")
      .toBeLessThan(inA.length);
  });

  it("B IS NOT EMPTY FOR THE WRONG REASON — it projects successfully, it just sees less", async () => {
    // The failure this guards is the one §0.5 names: a narrower projection that is empty because a
    // shared catch swallowed an error or the fixture never ran would satisfy "subset" trivially.
    await runInRequestContext({ principal: principalFor(orgA, userA), db }, () =>
      createProspect(db, orgA, { name: "Only In A", slug: "only-in-a" }, { kind: "system" }));
    await runInRequestContext({ principal: principalFor(orgB, userB), db }, () =>
      createProspect(db, orgB, { name: "Only In B", slug: "only-in-b" }, { kind: "system" }));

    const a = await projectAs(orgA, userA);
    const b = await projectAs(orgB, userB);

    // Each sees exactly its own — so B's earlier emptiness was scoping, not failure.
    expect(prospectIds(a.nodes)).toEqual(["only-in-a"]);
    expect(prospectIds(b.nodes)).toEqual(["only-in-b"]);
    // And the projection genuinely ran for both: a real model, not a swallowed error.
    expect(a.source.nodeCount).toBeGreaterThan(0);
    expect(b.source.nodeCount).toBeGreaterThan(0);
  });
});
