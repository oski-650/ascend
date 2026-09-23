// Slice 2A.1c — the SALES ROUTES through the real admission chain: a real session token, the real
// authority resolver, `authorize` + `requireCapability`, `withProspectDb`, the domain command, and the
// guarded database functions of 010 — on PGlite 001–010. The HTTP contract is `lib/sales-http.ts`.
//
// Concurrency at the route level (lost-response retries racing each other) is proven on PostgreSQL
// 17.6 in `sales-routes-concurrency.test.ts`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import { asPrincipal, type SqlClient } from "@/core/db";
import { resolvePrincipal } from "@/core/auth/principal";
import { getProspectActionSummary, getProspectTimeline, listSalesQueue } from "@/core/db/sales-reads";
import { SESSION_SECRET, bootDatabase, provisionPartner, tokenFor, type World } from "@/tests/support/provisioned-partner";
import { requestAs, seedVault } from "@/tests/support/route-surface";

let pg: PGlite;
let db: SqlClient;
let vault: string;
let world: World;
let ownerToken: string;
let salesToken: string;
let sales2Token: string;
let sales2: string;
const saved: Record<string, string | undefined> = {};

type Body = { ok: boolean; status?: string; error?: string; commandId?: string; outcome?: Record<string, never>; detail?: Record<string, unknown>; fallback?: Record<string, unknown> };
async function call(route: "actions" | "claim" | "assignment", ref: string, token: string | null, payload: unknown) {
  const mod = await import(`@/app/api/prospects/[slug]/${route}/route`);
  const url = `https://os.test/api/prospects/${ref}/${route}`;
  const init = { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) };
  const req = token ? requestAs(token, url, init) : new Request(url, { ...init, headers: { "content-type": "application/json" } });
  const res: Response = await mod.POST(req, { params: Promise.resolve({ slug: ref }) });
  return { status: res.status, body: (await res.json()) as Body };
}
async function edit(ref: string, followupId: string, token: string, payload: unknown) {
  const mod = await import("@/app/api/prospects/[slug]/followups/[followupId]/route");
  const res: Response = await mod.PATCH(requestAs(token, `https://os.test/api/prospects/${ref}/followups/${followupId}`,
    { method: "PATCH", body: JSON.stringify(payload) }), { params: Promise.resolve({ slug: ref, followupId }) });
  return { status: res.status, body: (await res.json()) as Body };
}

let seq = 0;
async function seed(status: string | null = "lead", extra: { held?: boolean; archived?: boolean; assignedTo?: string } = {}) {
  seq++;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name, status, assigned_to)
     VALUES ($1, CASE WHEN $2 THEN NULL ELSE gen_random_uuid() END, CASE WHEN $2 THEN 'held' ELSE 'anchored' END,
             CASE WHEN $2 THEN 'two listings' END, $3, $4, $5, $6) RETURNING id`,
    [world.organizationId, extra.held === true, `sales-route-${seq}`, `Route Biz ${seq}`, status, extra.assignedTo ?? null]);
  if (extra.archived) await pg.query("UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1", [r.rows[0].id, world.ownerId]);
  return { id: r.rows[0].id, ref: `sales-route-${seq}` };
}
const one = async <T,>(sql: string, p: unknown[] = []) => (await pg.query<T>(sql, p as never[])).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await one<{ n: number }>(sql, p)).n);

beforeAll(async () => {
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  ({ pg, db } = await bootDatabase());
  registerAppDb((fn) => fn(db));
  const partner = await provisionPartner(db, { orgSlug: "sales-routes", ownerEmail: "route-owner@test", partnerEmail: "route-sales@test",
    password: "a-sufficiently-long-sales-routes-password" });
  world = partner.world;
  salesToken = partner.login.sessionToken!;
  ownerToken = await tokenFor(world.ownerId);
  sales2 = (await one<{ id: string }>("INSERT INTO users (email, display_name) VALUES ('route-s2@test', 'S2') RETURNING id")).id;
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')", [sales2, world.organizationId]);
  sales2Token = await tokenFor(sales2);
}, 60_000);

afterAll(async () => {
  await pg.close();
  const { rm } = await import("node:fs/promises");
  await rm(vault, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(() => { process.env.ASCEND_PROSPECT_SOURCE = "postgres"; registerAppDb((fn) => fn(db)); bindAuthorityResolver(); });
afterEach(() => { clearAppDb(); clearAuthorityResolver(); });

describe("the Save route — one atomic command, strict body, resolved actor", () => {
  it("sales Save: 201 with ids; contact, claim, stage and follow-up all attributed to the RESOLVED principal", async () => {
    const p = await seed("lead");
    const r = await call("actions", p.ref, salesToken, { commandId: randomUUID(), expectedStage: "lead", claim: true,
      contact: { outcome: "spoke", channel: "call", note: "wants a quote" }, stage: { to: "contacted" },
      followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, status: "applied" });
    expect(await one("SELECT status, assigned_to FROM prospects WHERE id = $1", [p.id])).toEqual({ status: "contacted", assigned_to: world.partnerId });
    expect(await one("SELECT author_user_id FROM prospect_contacts WHERE prospect = $1", [p.id])).toEqual({ author_user_id: world.partnerId });
    expect(JSON.stringify(r.body)).not.toContain("wants a quote");
  });

  it("LOST-RESPONSE RETRY: the same id and body → 201, then 200 replayed with the SAME outcome; nothing written twice", async () => {
    const p = await seed("lead");
    const body = { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" }, followUp: { schedule: { action: "email", dueOn: "2026-10-02" } } };
    const first = await call("actions", p.ref, salesToken, body);
    const retry = await call("actions", p.ref, salesToken, body);
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body).toEqual({ ...first.body, status: "replayed" });
    expect(await n("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(1);
    expect(await n("SELECT count(*)::int AS n FROM events WHERE correlation_id = $1", [body.commandId])).toBe(2);
  });

  it("COMMAND-ID MISMATCH: a reused id with a different body → 409 carrying ONLY { ok, error } — no outcome, payload, actor or prospect", async () => {
    const p = await seed("lead");
    const id = randomUUID();
    await call("actions", p.ref, salesToken, { commandId: id, contact: { outcome: "spoke", channel: "call", note: "secret context" } });
    const other = await seed("lead");
    for (const r of [
      await call("actions", p.ref, salesToken, { commandId: id, contact: { outcome: "no_answer", channel: "call" } }),
      await call("actions", other.ref, salesToken, { commandId: id, contact: { outcome: "spoke", channel: "call", note: "secret context" } }),
      await call("actions", p.ref, ownerToken, { commandId: id, contact: { outcome: "spoke", channel: "call", note: "secret context" } }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ ok: false, error: "command_id_conflict" });
    }
  });

  it("SPOOFING: a body naming an actor, author, role, organization or prospect is refused 400 — and nothing is written", async () => {
    const p = await seed("lead");
    for (const [key, extra] of [
      ["actor", { actor: world.ownerId }], ["role", { role: "owner" }], ["authorUserId", { authorUserId: world.ownerId }],
      ["organizationId", { organizationId: randomUUID() }], ["prospect", { prospect: "other" }],
    ] as const) {
      const r = await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" }, ...extra });
      expect(r.status, key).toBe(400);
      expect(r.body.detail, key).toMatchObject({ field: `body.${key}` });
    }
    const nested = await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call", author_user_id: world.ownerId } });
    expect(nested.status).toBe(400);
    const claimSpoof = await call("claim", p.ref, salesToken, { commandId: randomUUID(), to: sales2 });
    expect(claimSpoof.status).toBe(400);
    expect(await n("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(0);
    expect((await one<{ a: string | null }>("SELECT assigned_to AS a FROM prospects WHERE id = $1", [p.id])).a).toBeNull();
  });

  it("stage rules at the route: closed-won is 403 outside Promote; closed-lost without a reason is 422; reopening is owner-only", async () => {
    const p = await seed("proposal");
    expect((await call("actions", p.ref, ownerToken, { commandId: randomUUID(), expectedStage: "proposal", stage: { to: "closed-won" } })).status).toBe(403);
    const noReason = await call("actions", p.ref, salesToken, { commandId: randomUUID(), expectedStage: "proposal", stage: { to: "closed-lost" } });
    expect([noReason.status, noReason.body.error]).toEqual([422, "lost_reason_required"]);
    expect((await call("actions", p.ref, salesToken, { commandId: randomUUID(), expectedStage: "proposal", stage: { to: "closed-lost", lostReason: "timing" } })).status).toBe(201);
    const salesReopen = await call("actions", p.ref, salesToken, { commandId: randomUUID(), expectedStage: "closed-lost", stage: { to: "lead" } });
    expect([salesReopen.status, salesReopen.body.error]).toEqual([403, "reopen_not_permitted"]);
    expect((await call("actions", p.ref, ownerToken, { commandId: randomUUID(), expectedStage: "closed-lost", stage: { to: "lead" } })).status).toBe(201);
  });

  it("a stale stage is 409 stage_conflict with the current stage only", async () => {
    const p = await seed("contacted");
    const r = await call("actions", p.ref, salesToken, { commandId: randomUUID(), expectedStage: "lead", stage: { to: "proposal" } });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ ok: false, error: "stage_conflict", detail: { current: "contacted" } });
  });

  it("held and archived prospects are 409; an unknown one is 404", async () => {
    const held = await seed(null, { held: true });
    const archived = await seed("lead", { archived: true });
    expect((await call("actions", held.ref, ownerToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" } })).body.error).toBe("held_prospect");
    const a = await call("actions", archived.ref, ownerToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" } });
    expect([a.status, a.body.error]).toEqual([409, "archived_prospect"]);
    expect((await call("actions", "no-such-prospect", ownerToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" } })).status).toBe(404);
  });

  it("invalid outcome/channel pairs and bad due times are refused before anything is written", async () => {
    const p = await seed("lead");
    const pair = await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "voicemail", channel: "email" } });
    expect([pair.status, pair.body.error]).toEqual([400, "invalid_command"]);
    const gap = await call("actions", p.ref, salesToken, { commandId: randomUUID(), followUp: { schedule: { action: "call", dueOn: "2027-03-14", dueAt: { local: "2027-03-14T02:30", offset: "-08:00" } } } });
    expect([gap.status, gap.body.error]).toEqual([422, "nonexistent_local_time"]);
    const noOffset = await call("actions", p.ref, salesToken, { commandId: randomUUID(), followUp: { schedule: { action: "call", dueOn: "2026-11-01", dueAt: "2026-11-01T01:30" } } });
    expect([noOffset.status, noOffset.body.error]).toEqual([422, "offset_required"]);
    // Fall-back is fine WITH its disambiguating offset.
    expect((await call("actions", p.ref, salesToken, { commandId: randomUUID(), followUp: { schedule: { action: "call", dueOn: "2026-11-01", dueAt: { local: "2026-11-01T01:30", offset: "-07:00" } } } })).status).toBe(201);
    expect(await n("SELECT count(*)::int AS n FROM prospect_followups WHERE prospect = $1", [p.id])).toBe(1);
  });

  it("sales backdating past 90 days is 403; unauthenticated is 401", async () => {
    const p = await seed("lead");
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    expect((await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call", happenedAt: old } })).status).toBe(403);
    expect((await call("actions", p.ref, ownerToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call", happenedAt: old } })).status).toBe(201);
    expect((await call("actions", p.ref, null, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call" } })).status).toBe(401);
  });
});

describe("prospects:manage — owner-level CRM management, not administration", () => {
  it("owner holds prospects:manage, sales does not, sales keeps prospects:write; no sales-management route depends on admin:*", async () => {
    const { capabilitiesForRole } = await import("@/core/auth/capabilities");
    const { ROUTE_AUTHORIZATION } = await import("@/core/auth/routes");
    expect(capabilitiesForRole("owner")).toContain("prospects:manage");
    expect(capabilitiesForRole("sales")).not.toContain("prospects:manage");
    expect(capabilitiesForRole("sales")).toContain("prospects:write");
    const salesRoutes = Object.entries(ROUTE_AUTHORIZATION).filter(([f]) => /app\/api\/prospects\/\[slug\]\/(actions|claim|assignment|followups)/.test(f));
    expect(salesRoutes.map(([f, r]) => [f.replace("app/api/prospects/[slug]/", ""), (r as { capability?: string }).capability]).sort()).toEqual([
      ["actions/route.ts", "prospects:write"], ["assignment/route.ts", "prospects:manage"],
      ["claim/route.ts", "prospects:write"], ["followups/[followupId]/route.ts", "prospects:manage"],
    ]);
  });
});

describe("the follow-up ownership conflict and the contact-only fallback", () => {
  it("409 followup_owned_by_other with a NEW-id fallback; the same id cannot be reused for the contact-only retry; a new id succeeds", async () => {
    const p = await seed("contacted");
    await call("actions", p.ref, sales2Token, { commandId: randomUUID(), followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } });
    const id = randomUUID();
    const combined = await call("actions", p.ref, salesToken, { commandId: id, contact: { outcome: "spoke", channel: "call", note: "kept by the UI" },
      followUp: { schedule: { action: "email", dueOn: "2026-10-04" } } });
    expect(combined.status).toBe(409);
    expect(combined.body).toEqual({ ok: false, error: "followup_owned_by_other", fallback: { contactOnly: true, newCommandIdRequired: true } });
    expect(await n("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(0);
    // The refused command wrote no receipt, so its id is still unused — the contract nonetheless says NEW.
    const fallback = await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "call", note: "kept by the UI" } });
    expect(fallback.status).toBe(201);
    expect(await n("SELECT count(*)::int AS n FROM prospect_followups WHERE prospect = $1 AND state = 'open' AND assignee_user_id = $2", [p.id, sales2])).toBe(1);
  });
});

describe("assignment routes", () => {
  it("claim: sales 201, holder again 200 already_yours, another salesperson 409 already_assigned", async () => {
    const p = await seed("lead");
    expect((await call("claim", p.ref, salesToken, { commandId: randomUUID() })).status).toBe(201);
    const again = await call("claim", p.ref, salesToken, { commandId: randomUUID() });
    expect([again.status, again.body.status]).toEqual([200, "already_yours"]);
    const other = await call("claim", p.ref, sales2Token, { commandId: randomUUID() });
    expect([other.status, other.body.error]).toEqual([409, "already_assigned"]);
  });

  it("reassign/unassign: sales 403 at the route; owner 201 with compare-and-set; a stale expectation is 409 with the current assignee", async () => {
    const p = await seed("lead", { assignedTo: world.partnerId });
    expect((await call("assignment", p.ref, salesToken, { commandId: randomUUID(), mode: "reassign", expectedAssignee: world.partnerId, to: sales2 })).status).toBe(403);
    const stale = await call("assignment", p.ref, ownerToken, { commandId: randomUUID(), mode: "reassign", expectedAssignee: null, to: sales2 });
    expect(stale.body).toEqual({ ok: false, error: "assignment_conflict", detail: { current: world.partnerId } });
    expect((await call("assignment", p.ref, ownerToken, { commandId: randomUUID(), mode: "reassign", expectedAssignee: world.partnerId, to: sales2 })).status).toBe(201);
    expect((await call("assignment", p.ref, ownerToken, { commandId: randomUUID(), mode: "unassign", expectedAssignee: sales2 })).status).toBe(201);
    expect((await call("assignment", p.ref, ownerToken, { commandId: randomUUID(), mode: "claim" })).status).toBe(400);
  });
});

describe("owner follow-up edit route", () => {
  it("owner 201; sales 403 at the route; stale expectation 409; changes limited to the five fields", async () => {
    const p = await seed("lead");
    const made = await call("actions", p.ref, ownerToken, { commandId: randomUUID(), followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } });
    const f = (made.body.outcome as unknown as { followUp: { created: string } }).followUp.created;
    const expected = { action: "call", assignee: world.ownerId, dueOn: "2026-10-01", dueAt: null };
    expect((await edit(p.ref, f, salesToken, { commandId: randomUUID(), expected, changes: { action: "email" } })).status).toBe(403);
    expect((await edit(p.ref, f, ownerToken, { commandId: randomUUID(), expected: { ...expected, action: "text" }, changes: { action: "email" } })).body.error).toBe("followup_conflict");
    expect((await edit(p.ref, f, ownerToken, { commandId: randomUUID(), expected, changes: { state: "completed" } })).status).toBe(400);
    const ok = await edit(p.ref, f, ownerToken, { commandId: randomUUID(), expected, changes: { assignee: sales2, dueOn: "2026-10-03" } });
    expect(ok.status).toBe(201);
    expect(await one("SELECT assignee_user_id, due_on::text AS d FROM prospect_followups WHERE followup_id = $1", [f])).toEqual({ assignee_user_id: sales2, d: "2026-10-03" });
  });
});

describe("reads for 2A.2 — summary rows, no history on the list", () => {
  it("the queue returns one row per active prospect with its latest contact and open follow-up; filters and keyset pages work", async () => {
    const owner = await resolvePrincipal(db, world.ownerId);
    if (!owner.ok) throw new Error("owner");
    const p = await seed("lead");
    await call("actions", p.ref, salesToken, { commandId: randomUUID(), claim: true, contact: { outcome: "no_answer", channel: "call", happenedAt: new Date(Date.now() - 86_400_000).toISOString() } });
    await call("actions", p.ref, salesToken, { commandId: randomUUID(), contact: { outcome: "spoke", channel: "text" }, followUp: { schedule: { action: "meeting", dueOn: "2026-10-09" } } });
    const mine = await asPrincipal(db, owner.principal, (tx) => listSalesQueue(tx, { assignee: world.partnerId, limit: 200 }));
    const row = mine.rows.find((r) => r.id === p.id)!;
    expect(row.latestContact).toMatchObject({ outcome: "spoke", channel: "text" });
    expect(row.openFollowUp).toMatchObject({ action: "meeting", dueOn: "2026-10-09" });
    expect(Object.keys(row).sort()).toEqual(["anchor", "assignedTo", "dueState", "firstContact", "id", "lastContact", "latestContact", "name", "openFollowUp", "slug", "status"]);
    const page1 = await asPrincipal(db, owner.principal, (tx) => listSalesQueue(tx, { limit: 3 }));
    const page2 = await asPrincipal(db, owner.principal, (tx) => listSalesQueue(tx, { limit: 3, after: page1.next! }));
    expect(page1.rows).toHaveLength(3);
    expect(page2.rows.map((r) => r.id)).not.toContain(page1.rows[2].id);
    const gone = await seed("lead", { archived: true });
    const held = await seed(null, { held: true });
    const all: string[] = [];
    let cursor: { key: string; id: string } | undefined;
    do {
      const page = await asPrincipal(db, owner.principal, (tx) => listSalesQueue(tx, { limit: 200, after: cursor }));
      all.push(...page.rows.map((r) => r.id));
      cursor = page.next ?? undefined;
    } while (cursor);
    expect(all).toContain(p.id);
    expect(all).not.toContain(gone.id);
    expect(all).not.toContain(held.id);
    const summary = await asPrincipal(db, owner.principal, (tx) => getProspectActionSummary(tx, p.id));
    expect(summary).toMatchObject({ contacts: 2, transitions: 0, assignedTo: world.partnerId });
    const timeline = await asPrincipal(db, owner.principal, (tx) => getProspectTimeline(tx, { prospectRowId: p.id }));
    expect(timeline.map((e) => e.kind)).toEqual(["followup", "contact", "contact"]);
  });
});
