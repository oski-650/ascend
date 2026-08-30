// Layer A — THE SOURCE-OF-TRUTH FLIP, verified against production.
//
// After this, `ASCEND_PROSPECT_SOURCE=postgres` is the deployed setting and Postgres is where
// prospects come from. The vault remains on disk, untouched, as rollback material — but it stops
// being authoritative, and the thing that must be proven is that NOTHING still quietly reads it.
//
// ─── THE FAILURE THIS EXISTS TO EXCLUDE ────────────────────────────────────────────────────────
//
// A consumer that reaches past the canonical reader keeps working after the flip. It returns the
// vault's answer, which today is identical, so every test passes — and it silently diverges the
// first time somebody edits a prospect in Postgres. That is a split brain that reports green.
//
// Stage 2C found exactly one such consumer (`core/knowledge` read `hitListDir()` directly). The
// checks below are what make its absence observable rather than assumed: they DIVERGE the two
// stores on purpose and require every consumer to follow Postgres.
//
// ─── AND THE OPPOSITE FAILURE ──────────────────────────────────────────────────────────────────
//
// A reader that falls back to the vault when Postgres is unreachable would restore the second
// source of truth at exactly the moment nobody is watching. `resolveProspectSource` throws instead,
// and that is asserted here against the real configuration rather than a fixture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor } from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { ProspectSourceUnavailable } from "@/core/crm/source";
import { runInRequestContext, type RequestContext } from "@/core/auth/context";
import type { OrganizationId, UserId } from "@/domain";

const APP = process.env.ASCEND_DATABASE_URL;
const ADMIN = process.env.ASCEND_DATABASE_URL_DIRECT;
const VAULT = process.env.ASCEND_VAULT_PATH;
const describeIfDb = APP && ADMIN && VAULT ? describe : describe.skip;

describeIfDb("2E SOURCE-OF-TRUTH FLIP — production", () => {
  let pool: Pool;
  let raw: PoolClient;
  let org: OrganizationId;
  let usr: UserId;
  let savedSource: string | undefined;
  // Supplied per unit of work, exactly as a request supplies it. Step 7 removed the startup binding.
  let ctx: RequestContext;

  beforeAll(async () => {
    savedSource = process.env.ASCEND_PROSPECT_SOURCE;
    const admin = new Pool({ ...connectionConfigFor(ADMIN!, "migration"), max: 1 });
    const ac = await admin.connect();
    try {
      const a = adaptPoolClient(ac);
      org = (await a.query<{ o: OrganizationId }>(`SELECT id o FROM organizations WHERE slug='ascend'`)).rows[0].o;
      usr = (await a.query<{ u: UserId }>(`SELECT id u FROM users WHERE email='oscar@ascend.test'`)).rows[0].u;
    } finally { ac.release(); await admin.end(); }

    pool = new Pool({ ...connectionConfigFor(APP!), max: 2 });
    raw = await pool.connect();
    ctx = { db: adaptPoolClient(raw), principal: __unsafePrincipalForTests("owner", org, usr) };
  }, 120_000);

  afterAll(async () => {
    if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
    else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
    raw?.release();
    await pool?.end();
  });

  it("FLIPPED: every prospect resolves through Postgres", async () => {
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const { listProspects } = await import("@/core/crm");
    const rows = await runInRequestContext(ctx, listProspects);
    expect(rows).toHaveLength(6);
    expect(rows.filter((p) => p.frontmatter.prospect_id).length).toBe(4);
    // The held pair survives the flip as held.
    expect(rows.filter((p) => !p.frontmatter.prospect_id).map((p) => p.slug).sort())
      .toEqual(["tapia-tile-amp-marble-co", "tile-amp-marble-installation-in-bay-area"]);
  }, 120_000);

  // ─── The decisive test: make the stores DISAGREE ─────────────────────────────────────────────

  it("NO CONSUMER SILENTLY READS THE VAULT — proven by taking the vault away", async () => {
    // A consumer bypassing the canonical reader is invisible while both stores agree, so the two
    // must be made to disagree. The obvious way — edit a name in Postgres and look for it — was
    // tried and REJECTED: `listProspects` opens its own transaction through `asPrincipal`, so
    // driving it from inside a hand-rolled transaction nests them, and the inner COMMIT would have
    // committed the probe TO PRODUCTION. A test that can corrupt the thing it is checking is not a
    // test worth having.
    //
    // This does the opposite and is strictly safer: production is not touched at all, and the VAULT
    // is pointed at an empty directory for the duration. Under `ASCEND_PROSPECT_SOURCE=postgres`
    // every prospect must still be there, complete. Anything still reading the vault for prospects
    // now returns nothing, and says so loudly.
    //
    // The vault files themselves are never modified — only the environment variable pointing at
    // them — so they remain byte-identical and valid as rollback material.
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-novault-"));
    const realVault = process.env.ASCEND_VAULT_PATH!;
    process.env.ASCEND_VAULT_PATH = empty;

    try {
      const { listProspects, getProspect } = await import("@/core/crm");
      const { buildKnowledgeIndex, UNSCOPED_INTERNAL_INDEX } = await import("@/core/knowledge");
      const { projectGraph } = await import("@/graph-view/projection");

      // 1 — the canonical reader
      const listed = await runInRequestContext(ctx, listProspects);
      expect(listed, "the canonical reader lost the prospects without the vault").toHaveLength(6);
      expect(listed.find((p) => p.slug === "bay-area-custom-shirts-inc")!.frontmatter.name)
        .toBe("Bay Area Custom Shirts Inc.");

      // 2 — the detail page, including the body, which lives only in `notes` now
      const detail = await runInRequestContext(ctx, () => getProspect("bay-area-custom-shirts-inc"));
      expect(detail, "the detail page reads the vault").toBeTruthy();
      expect(detail!.body).toContain("## Call Log");

      // 3 — the knowledge index. THE consumer that used to read `hitListDir()` directly. If it
      //     still did, it would find an empty directory and return no prospects at all.
      const idx = await runInRequestContext(ctx, () => buildKnowledgeIndex(UNSCOPED_INTERNAL_INDEX));
      const indexed = idx.registry.filter((r) => r.entity === "prospect");
      expect(indexed, "the knowledge index is still reading the vault").toHaveLength(6);

      // 4 — the graph projection
      const g = await runInRequestContext(ctx, projectGraph);
      const nodes = g.nodes.filter((n) => n.type === "prospect");
      expect(nodes, "the graph projection is still reading the vault").toHaveLength(6);
    } finally {
      process.env.ASCEND_VAULT_PATH = realVault;
      await fs.rm(empty, { recursive: true, force: true });
    }
  }, 180_000);

  it("the control: with the vault gone AND the vault selected, prospects DISAPPEAR", async () => {
    // Without this, the test above could pass because something caches. Selecting the vault while
    // it is empty must yield nothing — which is what makes the postgres-sourced result meaningful.
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-novault-ctl-"));
    const realVault = process.env.ASCEND_VAULT_PATH!;
    process.env.ASCEND_PROSPECT_SOURCE = "vault";
    process.env.ASCEND_VAULT_PATH = empty;
    try {
      const { listProspects } = await import("@/core/crm");
      expect(await listProspects(), "an empty vault still returned prospects — something caches").toHaveLength(0);
    } finally {
      process.env.ASCEND_VAULT_PATH = realVault;
      process.env.ASCEND_PROSPECT_SOURCE = "postgres";
      await fs.rm(empty, { recursive: true, force: true });
    }
  }, 120_000);

  // ─── Fail closed ─────────────────────────────────────────────────────────────────────────────

  it("FAIL-CLOSED: postgres selected OUTSIDE a request context THROWS — never falls back to the vault", async () => {
    // Step 7 changed the shape of this failure and made it stricter. There is no binding to clear:
    // a reader running outside a request has no principal at all, and the two things it must not do
    // are invent one and read the vault instead. It does neither.
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const { listProspects } = await import("@/core/crm");
    await expect(listProspects()).rejects.toThrow(ProspectSourceUnavailable);
    // The wording matters: it must refuse, not degrade.
    await expect(listProspects()).rejects.toThrow(/Refusing to fall back to the vault/);
  }, 120_000);

  it("FAIL-CLOSED: a typo does not silently select a store", async () => {
    process.env.ASCEND_PROSPECT_SOURCE = "postgres ";
    const { resolveProspectSource } = await import("@/core/crm/source");
    expect(resolveProspectSource()).toBe("postgres"); // trimmed, still explicit
    process.env.ASCEND_PROSPECT_SOURCE = "postgress";
    expect(() => resolveProspectSource()).toThrow(ProspectSourceUnavailable);
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  });

  it("FAIL-CLOSED: an unreachable database surfaces as an error, not as vault data", async () => {
    // The dangerous shape: Postgres is selected and configured, but the server is gone. A reader
    // that answered from the vault here would be reporting stale data as current, silently.
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
    const dead = new Pool({
      ...connectionConfigFor(APP!), max: 1,
      host: "127.0.0.1", port: 1, ssl: false, connectionTimeoutMillis: 2000,
    });
    const failing = {
      query: async () => { throw new Error("connection refused"); },
      exec: async () => { throw new Error("connection refused"); },
      transaction: async () => { throw new Error("connection refused"); },
    };
    const broken: RequestContext = {
      db: failing as never,
      principal: __unsafePrincipalForTests("owner", org, usr),
    };
    const { listProspects } = await import("@/core/crm");
    await expect(
      runInRequestContext(broken, listProspects),
      "an unreachable database returned vault data"
    ).rejects.toThrow();
    await dead.end().catch(() => {});
  }, 120_000);

  it("THE VAULT IS STILL THERE, unmodified, as rollback material", async () => {
    // Flipping the reader must not have touched the files. They are the way back.
    process.env.ASCEND_PROSPECT_SOURCE = "vault";
    // Deliberately NOT inside a request context: the vault branch needs no principal, and proving
    // that is proving the context is not a hidden precondition for reading files.
    const { listProspects } = await import("@/core/crm");
    const fromVault = await listProspects();
    expect(fromVault).toHaveLength(6);
    expect(fromVault.find((p) => p.slug === "bay-area-custom-shirts-inc")!.frontmatter.name)
      .toBe("Bay Area Custom Shirts Inc.");
    process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  }, 120_000);
});
