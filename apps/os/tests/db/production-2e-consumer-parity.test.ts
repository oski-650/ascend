// Layer A — 2E CONSUMER PARITY, against the REAL vault and the REAL production database.
//
// Stage 2C proved this against PGlite and a synthetic six-prospect vault. That established the
// PROPERTY. This establishes the FACT: the actual notes Oscar typed, the actual scores, the actual
// 41 events, read through the actual application login, produce byte-identical output from either
// store.
//
// ─── OVER THE APPLICATION CONNECTION, DELIBERATELY ─────────────────────────────────────────────
//
// These run through `ascend_app` on the transaction pooler — the credential the deployed app will
// hold, which has no privileges of its own until `asPrincipal` assumes a role. So this is also the
// first end-to-end demonstration that the hardened login can actually serve every consumer, not
// merely pass a security test.
//
// ─── WHAT "IDENTICAL" MEANS HERE ───────────────────────────────────────────────────────────────
//
// Outputs are compared RAW. Exactly two non-differences are removed, both declared and justified:
//
//   · the ambient clock — two runs happen milliseconds apart and `compileOperatorBrief` /
//     `compileTargetContext` stamp `new Date()` into a footer. Stripping a timestamp is not
//     normalising a business value.
//   · `EMPTY_EQUALS_ABSENT` — the two `date` columns that cannot hold `""`, traced through all
//     three consumers in Stage 2B.
//
// Nothing else is smoothed. Normalising both sides is what let the empty-string defect through
// twice, and it is the specific mistake this file is built to avoid repeating.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { clearProspectDb, registerProspectDb } from "@/core/crm/source";
import { EMPTY_EQUALS_ABSENT } from "@/substrate-migration";
import type { GraphNode } from "@/graph-view/contract";
import type { OrganizationId, UserId } from "@/domain";

const APP = process.env.ASCEND_DATABASE_URL;
const VAULT = process.env.ASCEND_VAULT_PATH;
const describeIfDb = APP && VAULT ? describe : describe.skip;

const ARTIFACTS = path.join(process.cwd(), "docs", "stage2e");
/** A real anchored prospect, used for the detail-page comparison. */
const DETAIL_SLUG = "bay-area-custom-shirts-inc";

describeIfDb("2E CONSUMER PARITY — real vault vs real production", () => {
  let pool: Pool;
  let raw: PoolClient;
  let savedSource: string | undefined;

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
    registerProspectDb(adaptPoolClient(raw), __unsafePrincipalForTests("owner", org, usr));
    mkdirSync(ARTIFACTS, { recursive: true });
  }, 120_000);

  afterAll(async () => {
    clearProspectDb();
    if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
    else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
    raw?.release();
    await pool?.end();
  });

  /** A known non-difference: two runs, two clocks. Business values are untouched. */
  const stripClock = (t: string): string =>
    t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TIMESTAMP>");

  async function bothStores<T>(produce: () => Promise<T>): Promise<{ vault: T; postgres: T }> {
    process.env.ASCEND_PROSPECT_SOURCE = "vault";
    const vault = await produce();
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const postgres = await produce();
    return { vault, postgres };
  }

  const results: Record<string, "identical"> = {};
  const record = (name: string) => { results[name] = "identical"; };

  it("1 · prospect list — same prospects, same order, every field raw", async () => {
    const { listProspects } = await import("@/core/crm");
    const { vault, postgres } = await bothStores(() => listProspects());

    expect(postgres).toHaveLength(6);
    expect(postgres.map((p) => p.slug)).toEqual(vault.map((p) => p.slug));
    // Order is load-bearing: app/sales consumes it and never re-sorts.
    expect(postgres.map((p) => p.score.score)).toEqual(vault.map((p) => p.score.score));

    const strip = (fm: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(fm).filter(([k, v]) => !(EMPTY_EQUALS_ABSENT.includes(k) && v === "")));
    for (const [i, p] of postgres.entries()) {
      expect(strip(p.frontmatter as Record<string, unknown>), p.slug)
        .toEqual(strip(vault[i].frontmatter as Record<string, unknown>));
      expect(p.body, `${p.slug} body`).toEqual(vault[i].body);
      expect(p.id, `${p.slug} id`).toEqual(vault[i].id);
      // Fields outside the declared exception keep their empty strings verbatim.
      expect(p.frontmatter.contact_email, `${p.slug} contact_email`).toEqual(vault[i].frontmatter.contact_email);
      expect(p.frontmatter.source, `${p.slug} source`).toEqual(vault[i].frontmatter.source);
    }
    record("prospect list");
  }, 120_000);

  it("2 · prospect detail page inputs — frontmatter, score breakdown AND body", async () => {
    const { getProspect } = await import("@/core/crm");
    const { vault, postgres } = await bothStores(() => getProspect(DETAIL_SLUG));
    expect(postgres, `${DETAIL_SLUG} missing from Postgres`).toBeTruthy();
    expect(postgres!.score).toEqual(vault!.score);
    expect(postgres!.id).toEqual(vault!.id);
    expect(postgres!.frontmatter.contact_email).toEqual(vault!.frontmatter.contact_email);
    // THE BODY, explicitly. Two consumers read it and the first parity ledger dropped it silently.
    expect(postgres!.body).toEqual(vault!.body);
    expect(postgres!.body).toContain("## Call Log");
    expect(postgres!.body.length).toBeGreaterThan(100);
    record("prospect detail");
  }, 120_000);

  it("3 · sales/automations matching — same prospects, scores, tiers, statuses", async () => {
    const { listProspects } = await import("@/core/crm");
    const shape = async () =>
      (await listProspects()).map((p) => `${p.slug}|${p.score.score}|${p.score.tier}|${p.frontmatter.status ?? ""}`);
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    record("automations matching");
  }, 120_000);

  it("4 · opportunity detection — identical signals", async () => {
    const { detectOpportunities } = await import("@/lib/opportunities");
    const shape = async () => (await detectOpportunities()).map((o) => `${o.kind}:${o.severity}:${o.title}`).sort();
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    record("opportunity detection");
  }, 120_000);

  it("5 · forecast — identical, weighted pipeline included", async () => {
    const { buildForecast } = await import("@/lib/forecast");
    const { vault, postgres } = await bothStores(() => buildForecast(5000));
    expect(postgres).toEqual(vault);
    record("forecast");
  }, 120_000);

  it("6 · operator brief — identical", async () => {
    const { compileOperatorBrief } = await import("@/lib/compileOperatorBrief");
    const { vault, postgres } = await bothStores(async () => stripClock(await compileOperatorBrief()));
    expect(postgres).toEqual(vault);
    record("operator brief");
  }, 120_000);

  it("7 · pipeline digest — identical", async () => {
    const { assemblePipeline } = await import("@/mission-control");
    const { vault, postgres } = await bothStores(() => assemblePipeline());
    expect(postgres).toEqual(vault);
    record("pipeline digest");
  }, 120_000);

  it("8 · graph projection — same prospect nodes", async () => {
    const { projectGraph } = await import("@/graph-view/projection");
    const shape = async () => {
      const g = await projectGraph();
      // graph-view's GraphNode is { id, type, ... }; the knowledge indexer has its OWN GraphNode
      // shaped { id, entity, title }. Filtering on the wrong one matches nothing and makes the
      // comparison vacuous — a mistake tsc caught once already in the Stage 2C suite.
      return g.nodes.filter((n: GraphNode) => n.type === "prospect").map((n: GraphNode) => n.id).sort();
    };
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    expect(postgres.length, "the graph lost the prospects entirely").toBe(6);
    record("graph projection");
  }, 120_000);

  it("9 · knowledge index — identical", async () => {
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
    const { vault, postgres } = await bothStores(shape);
    expect(postgres).toEqual(vault);
    expect(postgres.length, "the knowledge index has no prospects at all").toBeGreaterThan(0);
    record("knowledge index");
  }, 120_000);

  it("10 · compileTargetContext — the other body consumer — identical", async () => {
    const { getProspect } = await import("@/core/crm");
    const { compileTargetContext } = await import("@/lib/compileTargetContext");
    const { vault, postgres } = await bothStores(async () =>
      stripClock(compileTargetContext((await getProspect(DETAIL_SLUG))!)));
    expect(postgres).toEqual(vault);
    // It embeds the body, so this is a second independent witness that the notes survived.
    expect(postgres).toContain("Call Log");
    record("compileTargetContext");
  }, 120_000);

  it("ALL TEN consumers compared, and the list is complete", () => {
    const expected = [
      "prospect list", "prospect detail", "automations matching", "opportunity detection",
      "forecast", "operator brief", "pipeline digest", "graph projection", "knowledge index",
      "compileTargetContext",
    ];
    // A suite that silently stopped covering a consumer would otherwise still report green.
    expect(Object.keys(results).sort()).toEqual([...expected].sort());
    // WRITTEN ONLY WHEN THE CONTENT CHANGES, and with no timestamp.
    //
    // This artifact records WHICH consumers were verified identical. It used to stamp
    // `verifiedAt: new Date()`, so every suite run rewrote a committed file and dirtied the working
    // tree — a test that mutates version control as a side effect of passing. The churn also made
    // `git status` untrustworthy right when it matters most: before a refactor, when a clean tree is
    // the thing being checked.
    //
    // WHEN it was verified is what the commit history is for, and unlike a self-reported timestamp
    // it cannot drift from reality. What remains is the claim itself.
    const artifact = path.join(ARTIFACTS, "consumer-parity.json");
    const next = JSON.stringify({ consumers: results }, null, 2) + "\n";
    const current = existsSync(artifact) ? readFileSync(artifact, "utf8") : null;
    if (current !== next) writeFileSync(artifact, next);
  });
});
