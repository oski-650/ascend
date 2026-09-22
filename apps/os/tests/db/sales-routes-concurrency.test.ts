// Slice 2A.1c — the sales ROUTES under real concurrency on PostgreSQL 17.6, and the /sales queue at
// production scale. Same harness as D1b: a disposable 17.6 cluster, Unix socket only, one pooled
// connection per request (so concurrent requests are concurrent backends), real session tokens and
// the real authority resolver. Set ASCEND_PG17_BIN; there is no PGlite fallback.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { adaptPoolClient, asPrincipal, type SqlClient } from "@/core/db";
import { resolvePrincipal } from "@/core/auth/principal";
import { listSalesQueue } from "@/core/db/sales-reads";
import { startCluster, type R1cCluster } from "@/tests/support/r1c-cluster";
import { ephemeralSocketConfig } from "@/core/recovery/restore";
import { SCHEMA, SESSION_SECRET, provisionPartner, tokenFor, type World } from "@/tests/support/provisioned-partner";
import { requestAs, seedVault } from "@/tests/support/route-surface";

function resolveBin(): string {
  const direct = process.env.ASCEND_PG17_BIN?.trim();
  if (direct) return direct;
  throw new Error("2A.1c route concurrency needs a REAL PostgreSQL server: set ASCEND_PG17_BIN. No PGlite fallback.");
}

let cluster: R1cCluster;
let pool: pg.Pool;
let root: string;
let vault: string;
let world: World;
let salesToken: string;
let sales2Token: string;
const saved: Record<string, string | undefined> = {};

async function lease<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(adaptPoolClient(client)); } finally { client.release(); }
}
const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params as never[])).rows as T[];
const n = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);

async function post(route: "actions" | "claim", ref: string, token: string, payload: unknown) {
  const mod = await import(`@/app/api/prospects/[slug]/${route}/route`);
  const res: Response = await mod.POST(requestAs(token, `https://os.test/api/prospects/${ref}/${route}`,
    { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ slug: ref }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let seq = 0;
async function seed(status = "lead") {
  seq++;
  const [row] = await q<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, status)
     VALUES ($1, gen_random_uuid(), 'anchored', $2, $3, $4) RETURNING id`, [world.organizationId, `route-race-${seq}`, `Race ${seq}`, status]);
  return { id: row.id, ref: `route-race-${seq}` };
}

beforeAll(async () => {
  const bin = resolveBin();
  if (!existsSync(path.join(bin, "initdb"))) throw new Error(`no initdb at ${bin}`);
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  root = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "2a1c-routes-"));
  cluster = startCluster(root, "routes", bin, "17");
  pool = new pg.Pool({ ...ephemeralSocketConfig(cluster.server, cluster.admin("postgres")), max: 16 });
  await lease((c) => c.exec(SCHEMA));
  registerAppDb((fn) => lease(fn));
  bindAuthorityResolver();
  const partner = await provisionPartner(await lease(async (c) => c), {
    orgSlug: "route-race", ownerEmail: "route-race-owner@test", partnerEmail: "route-race-sales@test",
    password: "a-sufficiently-long-route-race-password" });
  world = partner.world;
  salesToken = partner.login.sessionToken!;
  const [{ id: s2 }] = await q<{ id: string }>("INSERT INTO users (email, display_name) VALUES ('route-race-s2@test', 'S2') RETURNING id");
  await q("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')", [s2, world.organizationId]);
  sales2Token = await tokenFor(s2);
}, 180_000);

afterAll(async () => {
  clearAppDb();
  await pool?.end();
  cluster?.stop();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("route-level races on PostgreSQL 17.6", () => {
  it("is 17.6, and eight concurrent requests are eight backends", async () => {
    expect((await q<{ v: string }>("SELECT current_setting('server_version') AS v"))[0].v).toBe("17.6");
    const pids = await Promise.all(Array.from({ length: 8 }, () => lease(async (c) => {
      const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await c.query("SELECT pg_sleep(0.15)");
      return r.rows[0].pid;
    })));
    expect(new Set(pids).size).toBe(8);
  });

  it("LOST-RESPONSE RETRIES RACING: 8 concurrent POSTs of one Save → one 201 and seven 200 replays, one logical result", async () => {
    const p = await seed("lead");
    const body = { commandId: randomUUID(), expectedStage: "lead", contact: { outcome: "spoke", channel: "call" }, stage: { to: "contacted" },
      followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } };
    const results = await Promise.all(Array.from({ length: 8 }, () => post("actions", p.ref, salesToken, body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    const outcome = results.find((r) => r.status === 201)!.body.outcome;
    for (const r of results) expect(r.body.outcome).toEqual(outcome);
    expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM events WHERE correlation_id = $1", [body.commandId])).toBe(3);
  });

  it("the same id with different bodies, concurrently → one 201 and one 409 that carries nothing but its classification", async () => {
    const p = await seed("lead");
    const commandId = randomUUID();
    const [a, b] = await Promise.all([
      post("actions", p.ref, salesToken, { commandId, contact: { outcome: "spoke", channel: "call", note: "one" } }),
      post("actions", p.ref, salesToken, { commandId, contact: { outcome: "no_answer", channel: "call", note: "two" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body).toEqual({ ok: false, error: "command_id_conflict" });
  });

  it("the same id on two DIFFERENT prospects at once (two locks — the receipt key decides) → one 201 and a classification-only 409, never a 500", async () => {
    for (let i = 0; i < 3; i++) {
      const [x, y] = [await seed("lead"), await seed("lead")];
      const commandId = randomUUID();
      const [a, b] = await Promise.all([
        post("actions", x.ref, salesToken, { commandId, contact: { outcome: "spoke", channel: "call", note: "private to x" } }),
        post("actions", y.ref, salesToken, { commandId, contact: { outcome: "spoke", channel: "call", note: "private to y" } }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((r) => r.status === 409)!.body).toEqual({ ok: false, error: "command_id_conflict" });
      expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE command_id = $1", [commandId])).toBe(1);
    }
  });

  it("two salespeople claiming at once through the route → one 201, one 409 already_assigned", async () => {
    const p = await seed("lead");
    const [a, b] = await Promise.all([
      post("claim", p.ref, salesToken, { commandId: randomUUID() }),
      post("claim", p.ref, sales2Token, { commandId: randomUUID() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error).toBe("already_assigned");
  });
});

describe("the /sales queue at production scale", () => {
  it("3,200 prospects with contact and follow-up history: one page reads in well under a second, and the history tables are probed by index", async () => {
    await q(`INSERT INTO prospects (organization_id, prospect_id, identity_state, name, status)
             SELECT $1, gen_random_uuid(), 'anchored', 'Scale ' || lpad(g::text, 5, '0'), 'lead' FROM generate_series(1, 3200) g`, [world.organizationId]);
    // History rows written directly by the cluster superuser (test data, not a command path):
    // ~2 contacts on half the prospects, an open follow-up on a quarter.
    await q(`INSERT INTO prospect_command_receipts (command_id, organization_id, prospect, actor_user_id, kind, payload_sha256, outcome)
             SELECT gen_random_uuid(), organization_id, id, $1, 'save', repeat('a', 64), '{}'::jsonb FROM prospects WHERE name LIKE 'Scale %'`, [world.partnerId]);
    await q(`INSERT INTO prospect_contacts (contact_id, organization_id, prospect, command_id, author_user_id, outcome, channel, happened_at)
             SELECT gen_random_uuid(), r.organization_id, r.prospect, r.command_id, $1, 'spoke', 'call', now() - (g || ' hours')::interval
               FROM prospect_command_receipts r JOIN prospects p ON p.id = r.prospect, generate_series(1, 2) g
              WHERE p.name LIKE 'Scale %' AND right(p.name, 1) IN ('0','2','4','6','8')`, [world.partnerId]);
    await q(`INSERT INTO prospect_followups (followup_id, organization_id, prospect, action, assignee_user_id, due_on, created_by, created_by_command)
             SELECT gen_random_uuid(), r.organization_id, r.prospect, 'call', $1, current_date + 3, $1, r.command_id
               FROM prospect_command_receipts r JOIN prospects p ON p.id = r.prospect
              WHERE p.name LIKE 'Scale %' AND right(p.name, 1) IN ('0','4')`, [world.partnerId]);
    await q("ANALYZE");
    const owner = await lease((c) => resolvePrincipal(c, world.ownerId));
    if (!owner.ok) throw new Error("owner");
    const t0 = performance.now();
    const page = await lease((c) => asPrincipal(c, owner.principal, (tx) => listSalesQueue(tx, { limit: 200 })));
    const ms = performance.now() - t0;
    expect(page.rows).toHaveLength(200);
    expect(page.next).not.toBeNull();
    expect(ms).toBeLessThan(1000);
    // The lateral contact lookup uses the timeline index, not a scan of the contacts table.
    const plan = (await lease((c) => asPrincipal(c, owner.principal, (tx) => tx.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT outcome FROM prospect_contacts c WHERE c.prospect = (SELECT id FROM prospects LIMIT 1) ORDER BY c.happened_at DESC LIMIT 1`)))).rows
      .map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/prospect_contacts_timeline/);
    console.info(`SALES-QUEUE page of 200 over ~3,200 prospects: ${ms.toFixed(1)} ms`);
  }, 120_000);
});
