// Layer A — historical 2E consumer witness and live Postgres source checks.
//
// Stage 2C proved this against PGlite and a synthetic six-prospect vault. That established the
// PROPERTY. The recorded Stage 2E artifact witnesses parity at migration time. Current production
// has advanced since the source flip, so its aggregate consumer outputs need not equal the vault.
//
// ─── OVER THE APPLICATION CONNECTION, DELIBERATELY ─────────────────────────────────────────────
//
// These run through `ascend_app` on the transaction pooler — the credential the deployed app will
// hold, which has no privileges of its own until `asPrincipal` assumes a role. So this is also the
// first end-to-end demonstration that the hardened login can actually serve every consumer, not
// merely pass a security test.
//
// ─── WHAT THE CURRENT-SOURCE CHECK MEANS HERE ──────────────────────────────────────────────────
//
// Each current output is compared with a second Postgres read while only the vault's prospect
// directory is empty. Other vault inputs remain available through read-only symlinks, so a
// non-prospect consumer cannot change the output. The only presentation value stripped is:
//
//   · the ambient clock — two runs happen milliseconds apart and `compileOperatorBrief` /
//     `compileTargetContext` stamp `new Date()` into a footer. Stripping a timestamp is not
//     normalising a business value.
// Historical field mapping and the two date-column exceptions remain checked by raw parity.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindAuthorityResolver } from "@/lib/authority";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { runInRequestContext, type RequestContext } from "@/core/auth/context";
import type { GraphNode } from "@/graph-view/contract";
import type { OrganizationId, UserId } from "@/domain";

// The graph projection OBTAINS owner-only data (documents, audits, invoices), so since 2G.1 slice 2
// it requires a capability — and since the prospect bridge, so does every prospect read.
//
// ─── WHY THE PRODUCTION RESOLVER, AND NOT `bindTestAuthority` ────────────────────────────────────
//
// `bindTestAuthority` answers with a principal in a FIXED organization. That is right for an engine
// test, which has no request context at all and only needs to be somebody. It is WRONG here: this
// suite runs its consumers inside `runInRequestContext(ctx, …)`, against a database whose
// organization id is generated per test. A resolver that ignores the context would authorize as one
// organization while the context is bound to another, RLS would correctly return nothing, and the
// suite would go red for a divergence that cannot exist in production — where `lib/authority` reads
// the context first and the two are the same principal by construction.
//
// So bind the real thing. One authorization, resolved the way production resolves it. Outside a
// context these consumers obtain nothing at all, which is the boundary working rather than failing.
beforeAll(() => bindAuthorityResolver());
afterAll(() => clearAuthorityResolver());

const APP = process.env.ASCEND_DATABASE_URL;
const VAULT = process.env.ASCEND_VAULT_PATH;
const describeIfDb = APP && VAULT ? describe : describe.skip;

const ARTIFACTS = path.join(process.cwd(), "docs", "stage2e");
/** A real anchored prospect, used for the detail-page comparison. */
const DETAIL_SLUG = "bay-area-custom-shirts-inc";

describeIfDb("2E CONSUMER PROOF — historical witness and current Postgres", () => {
  let pool: Pool;
  let raw: PoolClient;
  let savedSource: string | undefined;
  let ctx: RequestContext;

  beforeAll(async () => {
    savedSource = process.env.ASCEND_PROSPECT_SOURCE;
    // ── tenancy is looked up ADMINISTRATIVELY, and that is not a workaround ──────────────────
    //
    // `ascend_app` cannot discover its own organization. It holds no grant on `organizations`, and
    // even with one the `org_self` policy filters to `id = current_org()` — which is the value we
    // would be trying to learn. The login is structurally incapable of answering "who am I?".
    //
    // That is correct, not inconvenient: tenancy identity belongs to the SESSION layer, supplied by
    // whoever authenticated the human, and must never be self-asserted by the database client. A
    // deployment gets it from the signed session; provisioning knows it already. Here, the admin
    // connection stands in for that.
    const admin = new Pool({ ...connectionConfigFor(process.env.ASCEND_DATABASE_URL_DIRECT!, "migration"), max: 1 });
    const ac = await admin.connect();
    let org: OrganizationId, usr: UserId;
    try {
      const a = adaptPoolClient(ac);
      org = (await a.query<{ org: OrganizationId }>(`SELECT id AS org FROM organizations WHERE slug = 'ascend'`)).rows[0].org;
      usr = (await a.query<{ usr: UserId }>(`SELECT id AS usr FROM users WHERE email = 'oscar@ascend.test'`)).rows[0].usr;
    } finally { ac.release(); await admin.end(); }
    expect(org, "no ascend organization in production").toBeTruthy();

    // Consumers themselves run over the APPLICATION login, which is the point.
    pool = new Pool({ ...connectionConfigFor(APP!), max: 2 });
    raw = await pool.connect();
    // Held in a local, not in the module under test. Step 7 removed the startup binding; the
    // principal now travels with the request, so this suite supplies one the same way a request
    // does — around each unit of work rather than once for the process.
    ctx = { db: adaptPoolClient(raw), principal: __unsafePrincipalForTests("owner", org, usr) };
  }, 120_000);

  afterAll(async () => {
    if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
    else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
    raw?.release();
    await pool?.end();
  });

  /** A known non-difference: two runs, two clocks. Business values are untouched. */
  const stripClock = (t: string): string =>
    t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TIMESTAMP>");

  async function postgresWithoutVault<T>(produce: () => Promise<T>): Promise<{ current: T; withoutVault: T }> {
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const current = await runInRequestContext(ctx, produce);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-consumer-noprospects-"));
    const realVault = process.env.ASCEND_VAULT_PATH!;
    // Keep every non-prospect vault input intact. This probe changes only prospect discovery.
    for (const entry of await fs.readdir(realVault, { withFileTypes: true })) {
      const target = path.join(empty, entry.name);
      if (entry.name === "02 - Sales & Hit List") await fs.mkdir(target);
      else await fs.symlink(path.join(realVault, entry.name), target, entry.isDirectory() ? "dir" : "file");
    }
    process.env.ASCEND_VAULT_PATH = empty;
    try {
      // A same-probe negative control: the vault reader must discover no prospects here.
      // Otherwise an accidental vault read could pass the Postgres comparison vacuously.
      process.env.ASCEND_PROSPECT_SOURCE = "vault";
      const { listProspects } = await import("@/core/crm");
      expect(await runInRequestContext(ctx, listProspects), "prospect-empty vault probe was ineffective")
        .toHaveLength(0);
      process.env.ASCEND_PROSPECT_SOURCE = "postgres";
      const withoutVault = await runInRequestContext(ctx, produce);
      return { current, withoutVault };
    } finally {
      process.env.ASCEND_PROSPECT_SOURCE = "postgres";
      process.env.ASCEND_VAULT_PATH = realVault;
      await fs.rm(empty, { recursive: true, force: true });
    }
  }

  const results = new Set<string>();
  const record = (name: string) => { results.add(name); };

  it("1 · prospect list — current Postgres rows survive an empty vault", async () => {
    const { listProspects } = await import("@/core/crm");
    const { current: postgres, withoutVault } = await postgresWithoutVault(() => listProspects());
    expect(withoutVault, "prospect list changed without the vault").toEqual(postgres);
    const historical = JSON.parse(readFileSync(path.join(ARTIFACTS, "post-migration-state.json"), "utf8")) as {
      rows: { prospects: string }; prospectIdentities: { slug: string }[];
    };
    expect(historical.rows.prospects).toBe("6");
    expect(postgres.length).toBeGreaterThanOrEqual(6);
    for (const { slug } of historical.prospectIdentities) {
      expect(postgres.some((p) => p.slug === slug), `historical row ${slug} missing`).toBe(true);
    }
    record("prospect list");
  }, 120_000);

  it("2 · prospect detail page inputs — identity, score breakdown and body", async () => {
    const { getProspect } = await import("@/core/crm");
    const { current: postgres, withoutVault } = await postgresWithoutVault(() => getProspect(DETAIL_SLUG));
    expect(withoutVault, "prospect detail changed without the vault").toEqual(postgres);
    expect(postgres, `${DETAIL_SLUG} missing from Postgres`).toBeTruthy();
    expect(postgres!.id).toBeTruthy();
    expect(postgres!.score).toBeTruthy();
    // The raw-parity suite independently checks exact notes bytes for this migration row.
    expect(postgres!.body).toContain("## Call Log");
    expect(postgres!.body.length).toBeGreaterThan(100);
    record("prospect detail");
  }, 120_000);

  it("3 · sales/automations matching — current prospects, scores, tiers, statuses", async () => {
    const { listProspects } = await import("@/core/crm");
    const shape = async () =>
      (await listProspects()).map((p) => `${p.slug}|${p.score.score}|${p.score.tier}|${p.frontmatter.status ?? ""}`);
    const { current, withoutVault } = await postgresWithoutVault(shape);
    expect(withoutVault, "automations matching changed without the vault").toEqual(current);
    expect(current.length).toBeGreaterThanOrEqual(6);
    record("automations matching");
  }, 120_000);

  it("4 · opportunity detection — current-source signals", async () => {
    const { detectOpportunities } = await import("@/lib/opportunities");
    const shape = async () => (await detectOpportunities()).map((o) => `${o.kind}:${o.severity}:${o.title}`).sort();
    const { current, withoutVault } = await postgresWithoutVault(shape);
    expect(withoutVault, "opportunity detection changed without the vault").toEqual(current);
    record("opportunity detection");
  }, 120_000);

  it("5 · forecast — current-source weighted pipeline", async () => {
    const { buildForecast } = await import("@/lib/forecast");
    const { current, withoutVault } = await postgresWithoutVault(() => buildForecast(5000));
    expect(withoutVault, "forecast changed without the vault").toEqual(current);
    record("forecast");
  }, 120_000);

  it("6 · operator brief — current-source output", async () => {
    const { compileOperatorBrief } = await import("@/lib/compileOperatorBrief");
    const { current, withoutVault } = await postgresWithoutVault(async () => stripClock(await compileOperatorBrief()));
    expect(withoutVault, "operator brief changed without the vault").toEqual(current);
    record("operator brief");
  }, 120_000);

  it("7 · pipeline digest — current-source output", async () => {
    const { assemblePipeline } = await import("@/mission-control");
    const { current, withoutVault } = await postgresWithoutVault(() => assemblePipeline());
    expect(withoutVault, "pipeline digest changed without the vault").toEqual(current);
    record("pipeline digest");
  }, 120_000);

  it("8 · graph projection — current prospect nodes", async () => {
    const { projectGraph } = await import("@/graph-view/projection");
    const shape = async () => {
      const g = await projectGraph();
      // graph-view's GraphNode is { id, type, ... }; the knowledge indexer has its OWN GraphNode
      // shaped { id, entity, title }. Filtering on the wrong one matches nothing and makes the
      // comparison vacuous — a mistake tsc caught once already in the Stage 2C suite.
      return g.nodes.filter((n: GraphNode) => n.type === "prospect").map((n: GraphNode) => n.id).sort();
    };
    const { current: postgres, withoutVault } = await postgresWithoutVault(shape);
    expect(withoutVault, "graph prospect nodes changed without the vault").toEqual(postgres);
    expect(postgres.length, "the graph lost the prospects entirely").toBeGreaterThanOrEqual(6);
    record("graph projection");
  }, 120_000);

  it("9 · knowledge index — current-source output", async () => {
    // The consumer that used to read the vault directly, past the canonical reader. If it had kept
    // doing so it would look identical here while being immune to the flip — which is why F43
    // exists and why this comparison is not redundant with it.
    const { buildKnowledgeIndex } = await import("@/core/knowledge");
    const shape = async () => {
      const idx = await buildKnowledgeIndex();
      // All three products /search and the graph actually consume — not just one of them.
      return [
        ...idx.registry.filter((r) => r.entity === "prospect").map((r) => `registry:${r.id}|${r.title}`),
        ...idx.search.filter((d) => d.entity === "prospect").map((d) => `search:${d.id}|${d.title}|${d.text.length}`),
        ...idx.nodes.filter((n) => n.entity === "prospect").map((n) => `node:${n.id}|${n.title}`),
      ].sort();
    };
    const { current: postgres, withoutVault } = await postgresWithoutVault(shape);
    expect(withoutVault, "knowledge index changed without the vault").toEqual(postgres);
    expect(postgres.length, "the knowledge index has no prospects at all").toBeGreaterThan(0);
    record("knowledge index");
  }, 120_000);

  it("10 · compileTargetContext — the other body consumer — current-source output", async () => {
    const { getProspect } = await import("@/core/crm");
    const { compileTargetContext } = await import("@/lib/compileTargetContext");
    const { current: postgres, withoutVault } = await postgresWithoutVault(async () =>
      stripClock(compileTargetContext((await getProspect(DETAIL_SLUG))!)));
    expect(withoutVault, "target context changed without the vault").toEqual(postgres);
    // It embeds the body, so this is a second independent witness that the notes survived.
    expect(postgres).toContain("Call Log");
    record("compileTargetContext");
  }, 120_000);

  it("ALL TEN current-source consumers checked; historical parity artifact is read-only", () => {
    const expected = [
      "prospect list", "prospect detail", "automations matching", "opportunity detection",
      "forecast", "operator brief", "pipeline digest", "graph projection", "knowledge index",
      "compileTargetContext",
    ];
    // A suite that silently stopped covering a consumer would otherwise still report green.
    expect([...results].sort()).toEqual([...expected].sort());
    // This committed artifact records the original Stage 2E comparison. A current run may verify
    // its completeness but must never rewrite a historical claim or dirty the working tree.
    const artifact = path.join(ARTIFACTS, "consumer-parity.json");
    const historical = JSON.parse(readFileSync(artifact, "utf8")) as { consumers: Record<string, string> };
    expect(Object.keys(historical.consumers).sort()).toEqual([...expected].sort());
    expect(Object.values(historical.consumers).every((value) => value === "identical")).toBe(true);
  });
});
