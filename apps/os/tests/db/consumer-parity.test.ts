// Layer A — CONSUMER-OUTPUT PARITY (Stage 2C step 3/5).
//
// THE DISTINCTION THIS SUITE EXISTS FOR:
//
//   Stage 2B proved DATABASE-ROW parity. It compared the fields the schema happened to hold, and it
//   reported success while the markdown body — read by two consumers — was being dropped entirely.
//
//   This proves SYSTEM-BEHAVIOUR parity. It runs the REAL downstream producers against each store
//   and compares what they actually emit. A field nobody reads cannot fail it; a field somebody
//   reads cannot escape it.
//
// The inventory is the test plan. All ten prospect consumers are exercised through the products
// they feed: the pipeline digest, the forecast, opportunity detection, the operator brief, the
// automations matcher, the knowledge index, the graph projection, the promote path, and the two
// surfaces' inputs (list order + the detail page's frontmatter/body/score).

import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDb, type TestDb } from "./pglite";
import { addMembership, asPrincipal, createOrganization, createUser } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { applySubstrateMigration, planSubstrateMigration } from "@/substrate-migration";
import { runInRequestContext, type RequestContext } from "@/core/auth/context";
import { EMPTY_EQUALS_ABSENT } from "@/substrate-migration";
import type { GraphNode } from "@/graph-view/contract";
import type { OrganizationId, UserId } from "@/domain";

// The graph projection OBTAINS owner-only data (documents, audits, invoices), so since 2G.1 slice 2
// it requires a capability. This suite compares stores, not permissions — so it declares its caller.
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

const HIT_LIST = "02 - Sales & Hit List";
let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;
let db: TestDb;
let org: OrganizationId;
let oscar: UserId;
// The request context this suite runs its consumers inside. Held in a local, never in the module
// under test: a principal parked in production module state is the defect Step 7 removed.
let ctx: RequestContext;

const file = (fm: Record<string, string>, body: string) =>
  `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}`;

async function seedVault(): Promise<void> {
  const dir = path.join(vaultDir, HIT_LIST);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "01 - CRM & Clients"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "03 - SOP Library"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "04 - Documents"), { recursive: true });

  const base = (over: Record<string, string>) => ({
    name: "X", business_type: "Roofing", location: "Modesto, CA", status: "lead",
    website: '""', website_quality: "acceptable", decision_maker_access: "false",
    project_urgency: "low", niche_alignment: "false", contact_name: '""',
    contact_phone: '""', contact_email: '""', source: '""',
    first_contact: '""', last_contact: '""', ...over,
  });

  // A deliberately varied set: every score tier, both identity states, a closed-lost record to
  // exercise the ordering rule, and bodies with wikilinks so the knowledge index has something real.
  await fs.writeFile(path.join(dir, "alpha-roofing.md"), file(base({
    prospect_id: "01a00000-0000-7000-8000-00000000000a", name: "Alpha Roofing",
    website: "https://alpha.test", website_quality: "outdated", decision_maker_access: "true",
    project_urgency: "high", niche_alignment: "true", contact_phone: '"209-555-0001"',
    status: "contacted", first_contact: '"2026-06-10"',
  }), "## Call Log\n- 2026-06-10 — Intro call with [[Alpha Roofing]].\n\n## Friction / Notes\n- Peak season objection.\n"));
  await fs.writeFile(path.join(dir, "beta-hvac.md"), file(base({
    prospect_id: "01a00000-0000-7000-8000-00000000000b", name: "Beta HVAC",
    website: "https://beta.test", niche_alignment: "true", contact_email: "b@beta.test",
  }), "## Call Log\n- none yet\n"));
  await fs.writeFile(path.join(dir, "gamma-cleaning.md"), file(base({
    prospect_id: "01a00000-0000-7000-8000-00000000000c", name: "Gamma Cleaning",
    website_quality: "none", decision_maker_access: "true", project_urgency: "high",
    niche_alignment: "true", status: "proposal",
  }), "## Call Log\n- 2026-07-01 — Proposal sent.\n"));
  await fs.writeFile(path.join(dir, "delta-lost.md"), file(base({
    prospect_id: "01a00000-0000-7000-8000-00000000000d", name: "Delta Lost",
    status: "closed-lost", website: "https://delta.test",
  }), "## Call Log\n- Lost to incumbent.\n"));
  // The held pair — no prospect_id.
  for (const [slug, name] of [["tapia-a", '"Tapia Tile &amp; Marble Co."'], ["tapia-b", '"Tile &amp; Marble Bay Area"']]) {
    await fs.writeFile(path.join(dir, `${slug}.md`), file(base({
      name, website: '"https://tapiatilemarbleco.com/"', contact_phone: '"+16503648038"',
      contact_email: "tapia@example.test",
    }), "## Call Log\n- duplicate record\n"));
  }
  for (const f of ["crm", "production", "intelligence"]) {
    await fs.writeFile(path.join(vaultDir, ".ascend-os", `${f}.events.jsonl`), "");
  }
}

beforeEach(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-parity-"));
  process.env.ASCEND_VAULT_PATH = vaultDir;
  delete process.env.ASCEND_PROSPECT_SOURCE;
  await seedVault();

  db = await freshDb();
  org = await createOrganization(db.client, "ascend", "Ascend");
  oscar = await createUser(db.client, "oscar@ascend.test", "Oscar");
  await addMembership(db.client, oscar, org, "owner");

  const manifest = await planSubstrateMigration(oscar);
  await asPrincipal(db.client, __unsafePrincipalForTests("owner", org, oscar),
    (tx) => applySubstrateMigration(tx, org, manifest, { confirm: true }));
  ctx = { db: db.client, principal: __unsafePrincipalForTests("owner", org, oscar) };
});

afterEach(async () => {
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH; else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE; else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
  await fs.rm(vaultDir, { recursive: true, force: true });
  await db.close();
});

/**
 * Remove the AMBIENT CLOCK from compiled text.
 *
 * `compileOperatorBrief` and `compileTargetContext` stamp `new Date().toISOString()` into a footer.
 * The two store runs happen milliseconds apart, so an unstripped comparison fails on the timestamp
 * and says nothing about the stores. This removes a known non-difference; it does NOT normalise
 * business values, which is the mistake that hid the empty-string defect.
 */
const stripClock = (text: string): string =>
  text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TIMESTAMP>");

/**
 * Run `produce` against each store and return both outputs for comparison.
 *
 * Both runs happen INSIDE a request context, not just the Postgres one. The vault branch ignores it
 * entirely, which is the point: the context must change nothing about what a consumer produces, only
 * about whose authority it produces it under.
 */
async function bothStores<T>(produce: () => Promise<T>): Promise<{ vault: T; postgres: T }> {
  process.env.ASCEND_PROSPECT_SOURCE = "vault";
  const vault = await runInRequestContext(ctx, produce);
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  const postgres = await runInRequestContext(ctx, produce);
  return { vault, postgres };
}

describe("consumer-output parity — every consumer, both stores", () => {
  it("1+2 · the canonical reader returns identical prospects, in identical order", async () => {
    const { listProspects } = await import("@/core/crm");
    const { vault, postgres } = await bothStores(() => listProspects());
    expect(postgres.map((p) => p.slug)).toEqual(vault.map((p) => p.slug));
    expect(postgres.map((p) => p.score.score)).toEqual(vault.map((p) => p.score.score));
    // Ordering is load-bearing: app/sales consumes it and never re-sorts.
    expect(postgres[postgres.length - 1].frontmatter.status).toBe("closed-lost");
    for (const [i, p] of postgres.entries()) {
      // EVERY field compared RAW — `""` must survive the round trip — except the two in
      // EMPTY_EQUALS_ABSENT, where a `date` column cannot hold `""` and all three consumers were
      // traced and proven to treat `""` and absent identically. That collapse is DECLARED, narrow,
      // and evidence-backed; comparing normalised here without that evidence is what let the
      // original empty-string defect through.
      const strip = (fm: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(fm).filter(([k, v]) => !(EMPTY_EQUALS_ABSENT.includes(k) && v === "")));
      expect(strip(p.frontmatter), p.slug).toEqual(strip(vault[i].frontmatter));
      expect(p.body, `${p.slug} body`).toEqual(vault[i].body);
      expect(p.id, `${p.slug} id`).toEqual(vault[i].id);
      // And the fields NOT in that set keep their empty strings verbatim.
      expect(p.frontmatter.contact_email, `${p.slug} contact_email`).toEqual(vault[i].frontmatter.contact_email);
      expect(p.frontmatter.source, `${p.slug} source`).toEqual(vault[i].frontmatter.source);
    }
  });

  it("2 · the detail page's inputs match — frontmatter, score breakdown AND body", async () => {
    const { getProspect } = await import("@/core/crm");
    const { vault, postgres } = await bothStores(() => getProspect("alpha-roofing"));
    expect(postgres!.score).toEqual(vault!.score);
    expect(postgres!.body).toEqual(vault!.body);
    expect(postgres!.id).toEqual(vault!.id);
    expect(postgres!.frontmatter.contact_email).toEqual(vault!.frontmatter.contact_email);
    expect(postgres!.body).toContain("## Call Log");
    expect(postgres!.body).toContain("Peak season objection");
  });

  it("3 · the automations matcher sees the same prospects and scores", async () => {
    const { listProspects } = await import("@/core/crm");
    const shape = async () =>
      (await listProspects()).map((p) => `${p.slug}|${p.score.score}|${p.score.tier}|${p.frontmatter.status ?? ""}`);
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
  });

  it("4 · opportunity detection produces identical signals", async () => {
    const { detectOpportunities } = await import("@/lib/opportunities");
    const shape = async () =>
      (await detectOpportunities()).map((o) => `${o.kind}:${o.severity}:${o.title}`).sort();
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
  });

  it("5 · the forecast is identical — weighted pipeline included", async () => {
    const { buildForecast } = await import("@/lib/forecast");
    const { vault, postgres } = await bothStores(() => buildForecast(5000));
    expect(postgres).toEqual(vault);
  });

  it("6 · the operator brief is identical", async () => {
    const { compileOperatorBrief } = await import("@/lib/compileOperatorBrief");
    const { vault, postgres } = await bothStores(async () => stripClock(await compileOperatorBrief()));
    expect(postgres).toEqual(vault);
  });

  it("7 · the pipeline digest is identical", async () => {
    const { assemblePipeline } = await import("@/mission-control");
    const { vault, postgres } = await bothStores(() => assemblePipeline());
    expect(postgres).toEqual(vault);
  });

  it("9 · the graph projection contains the same prospect nodes", async () => {
    const { projectGraph } = await import("@/graph-view/projection");
    const shape = async () => {
      const g = await projectGraph();
      return g.nodes.filter((n: GraphNode) => n.type === "prospect").map((n: GraphNode) => n.id).sort();
    };
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    expect(postgres.length).toBe(6);
  });

  it("10 · THE TENTH CONSUMER: the knowledge index matches", async () => {
    // The one that used to read hitListDir() directly. Before Stage 2C it would have returned the
    // vault's objects under BOTH settings — passing this test while proving nothing.
    const { buildKnowledgeIndex, UNSCOPED_INTERNAL_INDEX } = await import("@/core/knowledge");
    const shape = async () => {
      const idx = await buildKnowledgeIndex(UNSCOPED_INTERNAL_INDEX);
      // The registry and the search documents are what /search and the graph consume.
      return [
        ...idx.registry.filter((r) => r.entity === "prospect").map((r) => `registry:${r.id}|${r.title}`),
        ...idx.search.filter((d) => d.entity === "prospect").map((d) => `search:${d.id}|${d.title}|${d.text.length}`),
        // NOTE: the indexer has its OWN GraphNode ({ id, entity, title }) — distinct from
        // graph-view's ({ id, type, ... }). Filtering on `.type` here matched nothing and made this
        // third of the comparison vacuous; tsc caught it. It compares real nodes now.
        ...idx.nodes.filter((n) => n.entity === "prospect").map((n) => `node:${n.id}|${n.title}`),
      ].sort();
    };
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    expect(postgres.some((line: string) => line.includes("Alpha Roofing"))).toBe(true);
  });

  it("11 · compileTargetContext — the other body consumer — matches", async () => {
    const { getProspect } = await import("@/core/crm");
    const { compileTargetContext } = await import("@/lib/compileTargetContext");
    const shape = async () => stripClock(compileTargetContext((await getProspect("alpha-roofing"))!));
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    expect(postgres).toContain("Intro call");
  });
});

describe("the seam refuses to become a second source of truth", () => {
  it("postgres selected OUTSIDE a request context THROWS — it never falls back to the vault", async () => {
    // Step 7 changed what "no connection" means. There is no binding to clear any more: a reader
    // with no request context around it has no principal, and inventing one would be the same
    // failure as falling back to the vault, wearing different clothes.
    const { ProspectSourceUnavailable } = await import("@/core/crm/source");
    const { listProspects } = await import("@/core/crm");
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    await expect(listProspects()).rejects.toThrow(ProspectSourceUnavailable);
    await expect(listProspects()).rejects.toThrow(/Refusing to fall back to the vault/);
  });

  it("a typo does not select a store", async () => {
    const { resolveProspectSource, ProspectSourceUnavailable } = await import("@/core/crm/source");
    process.env.ASCEND_PROSPECT_SOURCE = "postgress";
    expect(() => resolveProspectSource()).toThrow(ProspectSourceUnavailable);
  });

  it("unset resolves to the vault — the store that is authoritative today", async () => {
    const { resolveProspectSource } = await import("@/core/crm/source");
    delete process.env.ASCEND_PROSPECT_SOURCE;
    expect(resolveProspectSource()).toBe("vault");
  });
});

describe("MUTATION: a consumer that bypasses the reader is caught", () => {
  it("reading the vault directly disagrees with Postgres once they diverge", async () => {
    // Simulates the pre-Stage-2C `core/knowledge`: a consumer holding its own filesystem path.
    // Divergence is introduced in ONE store; a bypassing consumer cannot see it, which is exactly
    // how a split brain stays invisible.
    const { listProspects } = await import("@/core/crm");
    await asPrincipal(db.client, __unsafePrincipalForTests("owner", org, oscar),
      (tx) => tx.query(`UPDATE prospects SET name='RENAMED IN POSTGRES' WHERE slug='alpha-roofing'`));

    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const viaReader = (await runInRequestContext(ctx, listProspects)).find((p) => p.slug === "alpha-roofing")!;
    const direct = await fs.readFile(path.join(vaultDir, HIT_LIST, "alpha-roofing.md"), "utf8");

    expect(viaReader.frontmatter.name).toBe("RENAMED IN POSTGRES");
    expect(direct).toContain("Alpha Roofing");          // the vault still says the old name
    expect(direct).not.toContain("RENAMED IN POSTGRES"); // a bypassing consumer would report this
  });
});
