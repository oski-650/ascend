// Slice 2A.1b — SALES ACTIONS under real concurrency, and the bypass proof, on PostgreSQL 17.6.
//
// PGlite has one backend: it cannot race and it cannot run two transactions at once. Everything here
// runs against a disposable PostgreSQL 17.6 cluster (production's version; Unix socket only, private
// root, destroyed after), with one pooled connection per unit of work — so concurrent commands are
// concurrent backends. The harness proves that about itself first.
//
// Point ASCEND_PG17_BIN at a PostgreSQL >= 17 bin directory. There is no PGlite fallback: a race that
// cannot happen proves nothing.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";
import { adaptPoolClient, asPrincipal, archiveProspect, lockProspect, markProspectPromoted, resolveProspectForMutation, type SqlClient } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { executeAssignment, executeSave, runSalesCommand, type AssignmentCommand, type SaveCommand, type SalesResult } from "@/core/db/sales-actions";
import { startCluster, type R1cCluster } from "@/tests/support/r1c-cluster";
import { ephemeralSocketConfig } from "@/core/recovery/restore";
import { SCHEMA, seedOperationalWorld, type World } from "@/tests/support/provisioned-partner";
import { uuidv7 } from "@/domain";

function resolveBin(): string {
  const direct = process.env.ASCEND_PG17_BIN?.trim();
  if (direct) return direct;
  throw new Error("2A.1b concurrency needs a REAL PostgreSQL server: set ASCEND_PG17_BIN to a PostgreSQL >= 17 bin " +
    "directory. There is no PGlite fallback — PGlite has one backend, so it would prove nothing about a race.");
}

let cluster: R1cCluster;
let pool: pg.Pool;
let root: string;
let world: World;
let sales2: string;
const P: Record<"owner" | "sales" | "sales2", ResolvedPrincipal> = {} as never;

/** One connection per unit of work — which is what makes two commands two backends. */
async function lease<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(adaptPoolClient(client)); } finally { client.release(); }
}
const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params as never[])).rows as T[];
const n = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);

const save = (who: keyof typeof P, cmd: SaveCommand): Promise<SalesResult> =>
  lease((c) => runSalesCommand((fn) => asPrincipal(c, P[who], fn), (tx) => executeSave(tx, P[who], cmd), cmd.commandId));
const assign = (who: keyof typeof P, cmd: AssignmentCommand): Promise<SalesResult> =>
  lease((c) => runSalesCommand((fn) => asPrincipal(c, P[who], fn), (tx) => executeAssignment(tx, P[who], cmd), cmd.commandId));
/** Promote's database portion exactly as `promoteInPostgres` runs it: resolve, lock, mark — one transaction. */
const promote = (who: keyof typeof P, rowId: string, correlationId = uuidv7()) =>
  lease((c) => asPrincipal(c, P[who], async (tx) => {
    const r = await resolveProspectForMutation(tx, rowId);
    if (!r.ok) return { state: "refused" as const, reason: r.reason };
    await lockProspect(tx, r.target.prospectId);
    return markProspectPromoted(tx, world.organizationId as never, {
      target: r.target, clientSlug: "race-client", clientId: "client-race", correlationId, actorUserId: P[who].userId });
  }));
/** Archival exactly as D1b runs it: resolve, lock, compare-and-set — one transaction. */
const archive = (rowId: string) =>
  lease((c) => asPrincipal(c, P.owner, async (tx) => {
    const r = await resolveProspectForMutation(tx, rowId);
    if (!r.ok) return { state: "refused" as const };
    await lockProspect(tx, r.target.prospectId);
    return archiveProspect(tx, world.organizationId as never, { target: r.target, actorUserId: P.owner.userId, correlationId: uuidv7() });
  }));
const raw = (who: keyof typeof P, sql: string, params: unknown[] = []) => lease((c) => asPrincipal(c, P[who], (tx) => tx.query(sql, params as never)));

async function seed(status: string | null = "lead", assignedTo: string | null = null) {
  const [row] = await q<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, name, status, assigned_to)
     VALUES ($1, gen_random_uuid(), 'anchored', 'Race ' || gen_random_uuid()::text, $2, $3) RETURNING id`,
    [world.organizationId, status, assignedTo]);
  return row.id;
}
const code = (r: SalesResult) => (r.status === "refused" ? r.code : r.status);

beforeAll(async () => {
  const bin = resolveBin();
  if (!existsSync(path.join(bin, "initdb"))) throw new Error(`no initdb at ${bin}`);
  root = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "2a1b-conc-"));
  cluster = startCluster(root, "sales", bin, "17");
  pool = new pg.Pool({ ...ephemeralSocketConfig(cluster.server, cluster.admin("postgres")), max: 16 });
  await lease((c) => c.exec(SCHEMA));
  world = await lease((c) => seedOperationalWorld(c, { orgSlug: "sales-race", ownerEmail: "o@race.test", partnerEmail: "s@race.test" }));
  [{ id: sales2 }] = await q<{ id: string }>("INSERT INTO users (email, display_name) VALUES ('s2@race.test', 'S2') RETURNING id");
  await q("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')", [sales2, world.organizationId]);
  for (const [k, id] of [["owner", world.ownerId], ["sales", world.partnerId], ["sales2", sales2]] as const) {
    const r = await lease((c) => resolvePrincipal(c, id));
    if (!r.ok) throw new Error(`principal ${k} did not resolve`);
    P[k] = r.principal;
  }
}, 180_000);

afterAll(async () => {
  await pool?.end();
  cluster?.stop();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("the harness is a real, concurrent PostgreSQL 17.6", () => {
  it("is 17.6 on a Unix socket with no TCP listener, and concurrent work gets DISTINCT backends", async () => {
    const [v] = await q<{ version: string; listen: string; addr: string | null }>(
      "SELECT current_setting('server_version') AS version, current_setting('listen_addresses') AS listen, inet_server_addr()::text AS addr");
    expect(v).toEqual({ version: "17.6", listen: "", addr: null });
    const pids = await Promise.all(Array.from({ length: 8 }, () => lease(async (c) => {
      const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await c.query("SELECT pg_sleep(0.15)");
      return r.rows[0].pid;
    })));
    expect(new Set(pids).size).toBe(8);
  });
});

describe("races", () => {
  it("8 simultaneous IDENTICAL Saves → one logical result: one contact, one transition, one follow-up, one receipt, one set of events", async () => {
    const id = await seed("lead");
    const cmd: SaveCommand = { commandId: uuidv7(), prospect: id, expectedStage: "lead", contact: { outcome: "spoke", channel: "call" },
      stage: { to: "contacted" }, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } };
    const results = await Promise.all(Array.from({ length: 8 }, () => save("sales", cmd)));
    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.status === "replayed")).toHaveLength(7);
    // The SAME logical result for all eight (structural equality: a replay's outcome comes back from
    // jsonb, whose key order differs from the object the first call built).
    const first = results.find((r) => r.status === "applied")!;
    for (const r of results) expect(r.status === "refused" ? r : r.outcome).toEqual(first.status === "refused" ? first : first.outcome);
    expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE prospect = $1", [id])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM prospect_stage_transitions WHERE prospect = $1", [id])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM prospect_followups WHERE prospect = $1", [id])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM prospect_command_receipts WHERE command_id = $1", [cmd.commandId])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM events WHERE correlation_id = $1", [cmd.commandId])).toBe(3);
  });

  it("the same command id with DIFFERENT payloads, concurrently → one applies, the other is command_id_conflict", async () => {
    const id = await seed("lead");
    const commandId = uuidv7();
    const [a, b] = await Promise.all([
      save("sales", { commandId, prospect: id, contact: { outcome: "spoke", channel: "call" } }),
      save("sales", { commandId, prospect: id, contact: { outcome: "no_answer", channel: "call" } }),
    ]);
    expect([code(a), code(b)].sort()).toEqual(["applied", "command_id_conflict"]);
    expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE prospect = $1", [id])).toBe(1);
  });

  it("the same command id on two DIFFERENT prospects (different locks), concurrently → one applies, one conflicts", async () => {
    const [x, y] = [await seed("lead"), await seed("lead")];
    const commandId = uuidv7();
    const [a, b] = await Promise.all([
      save("sales", { commandId, prospect: x, contact: { outcome: "spoke", channel: "call" } }),
      save("sales", { commandId, prospect: y, contact: { outcome: "spoke", channel: "call" } }),
    ]);
    expect([code(a), code(b)].sort()).toEqual(["applied", "command_id_conflict"]);
    expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE command_id = $1", [commandId])).toBe(1);
  });

  it("two simultaneous claims by different salespeople → exactly one winner; the loser gets already_assigned; the winner's retry is already_yours", async () => {
    const id = await seed("lead");
    const [a, b] = await Promise.all([
      assign("sales", { commandId: uuidv7(), prospect: id, mode: "claim" }),
      assign("sales2", { commandId: uuidv7(), prospect: id, mode: "claim" }),
    ]);
    expect([code(a), code(b)].sort()).toEqual(["already_assigned", "applied"]);
    const winner = code(a) === "applied" ? "sales" : "sales2";
    expect(await assign(winner, { commandId: uuidv7(), prospect: id, mode: "claim" })).toMatchObject({ outcome: { assignment: { result: "already_yours" } } });
    expect(await n("SELECT count(*)::text AS n FROM events WHERE type = 'prospect.reassigned' AND subject_entity_id = (SELECT prospect_id::text FROM prospects WHERE id = $1)", [id])).toBe(1);
  });

  it("two concurrent stage changes from the same expected stage → one applies, the other is stage_conflict (stale CAS)", async () => {
    const id = await seed("lead");
    const [a, b] = await Promise.all([
      save("sales", { commandId: uuidv7(), prospect: id, expectedStage: "lead", stage: { to: "contacted" } }),
      save("owner", { commandId: uuidv7(), prospect: id, expectedStage: "lead", stage: { to: "proposal" } }),
    ]);
    expect([code(a), code(b)].sort()).toEqual(["applied", "stage_conflict"]);
    expect(await n("SELECT count(*)::text AS n FROM prospect_stage_transitions WHERE prospect = $1", [id])).toBe(1);
  });

  it("two simultaneous follow-up schedules → both serialize under the lock; exactly one open, the other superseded by it", async () => {
    const id = await seed("lead");
    const [a, b] = await Promise.all([
      save("sales", { commandId: uuidv7(), prospect: id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }),
      save("sales", { commandId: uuidv7(), prospect: id, followUp: { schedule: { action: "email", dueOn: "2026-10-02" } } }),
    ]);
    expect([code(a), code(b)]).toEqual(["applied", "applied"]);
    const rows = await q<{ state: string; superseded_by: string | null; followup_id: string }>(
      "SELECT state, superseded_by, followup_id FROM prospect_followups WHERE prospect = $1", [id]);
    expect(rows.filter((r) => r.state === "open")).toHaveLength(1);
    const old = rows.find((r) => r.state === "superseded")!;
    expect(old.superseded_by).toBe(rows.find((r) => r.state === "open")!.followup_id);
  });

  it("completion vs supersede, concurrently → the original resolves exactly once, and one follow-up stays open", async () => {
    const id = await seed("lead");
    const orig = await save("sales", { commandId: uuidv7(), prospect: id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } });
    const origId = orig.status === "applied" ? orig.outcome.followUp!.created! : "";
    const [a, b] = await Promise.all([
      save("sales", { commandId: uuidv7(), prospect: id, followUp: { resolve: "completed" } }),
      save("sales", { commandId: uuidv7(), prospect: id, followUp: { schedule: { action: "email", dueOn: "2026-10-03" } } }),
    ]);
    const states = [code(a), code(b)];
    const [o] = await q<{ state: string }>("SELECT state FROM prospect_followups WHERE followup_id = $1", [origId]);
    // Either order is correct; what is never correct is the original resolved twice or two open rows.
    expect(["completed", "superseded"]).toContain(o.state);
    expect(await n("SELECT count(*)::text AS n FROM prospect_followups WHERE prospect = $1 AND state = 'open'", [id])).toBeLessThanOrEqual(1);
    expect(await n("SELECT count(*)::text AS n FROM events WHERE type = 'prospect.followup_resolved' AND data->>'followup_id' = $1", [origId]))
      .toBe(o.state === "completed" ? 1 : 0);
    expect(states.every((s) => s === "applied" || s === "no_open_followup")).toBe(true);
  });

  it("combined Save vs Archive, concurrently → never a contact on an archived prospect written after it was archived", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await seed("lead");
      const [s, a] = await Promise.all([
        save("sales", { commandId: uuidv7(), prospect: id, contact: { outcome: "spoke", channel: "call" }, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }),
        archive(id),
      ]);
      // Timestamps cannot order these (now() is transaction START, and a blocked transaction may have
      // started first). The lock does: either the Save committed whole before the archival, or it saw
      // the archival and wrote nothing. Never half, never a receipt without its rows.
      expect(a.state).toBe("archived");
      if (code(s) === "applied") {
        expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE prospect = $1", [id])).toBe(1);
        expect(await n("SELECT count(*)::text AS n FROM prospect_followups WHERE prospect = $1", [id])).toBe(1);
      } else {
        expect(code(s)).toBe("archived_prospect");
        expect(await n("SELECT count(*)::text AS n FROM prospect_contacts WHERE prospect = $1", [id])).toBe(0);
      }
    }
  });

  it("combined Save vs Promote, concurrently → coherent: one closed-won via promotion, history in commit order, no stage after the win", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await seed("contacted");
      const [s, p] = await Promise.all([
        save("sales", { commandId: uuidv7(), prospect: id, expectedStage: "contacted", contact: { outcome: "spoke", channel: "call" }, stage: { to: "proposal" } }),
        promote("owner", id),
      ]);
      expect(p.state).toBe("marked");
      const t = await q<{ from_status: string; to_status: string; cause: string }>(
        "SELECT from_status, to_status, cause FROM prospect_stage_transitions WHERE prospect = $1", [id]);
      const won = t.filter((x) => x.to_status === "closed-won");
      expect(won).toHaveLength(1);
      expect(won[0].cause).toBe("promotion");
      // The from→to pairs form ONE chain ending in the win — whichever committed first.
      const chain = t.map((x) => `${x.from_status}>${x.to_status}`).sort();
      if (code(s) === "applied") expect(chain).toEqual(["contacted>proposal", "proposal>closed-won"]);
      else { expect(code(s)).toBe("stage_conflict"); expect(chain).toEqual(["contacted>closed-won"]); }
      expect((await q<{ status: string }>("SELECT status FROM prospects WHERE id = $1", [id]))[0].status).toBe("closed-won");
    }
  });

  it("Promote replay, even concurrent → exactly one closed-won transition and one promoted event", async () => {
    const id = await seed("proposal");
    const results = await Promise.all(Array.from({ length: 4 }, () => promote("sales", id)));
    expect(results.filter((r) => r.state === "marked")).toHaveLength(1);
    expect(results.filter((r) => r.state === "already_marked")).toHaveLength(3);
    expect(await n("SELECT count(*)::text AS n FROM prospect_stage_transitions WHERE prospect = $1 AND to_status = 'closed-won'", [id])).toBe(1);
    expect(await n("SELECT count(*)::text AS n FROM events WHERE type = 'prospect.promoted' AND subject_entity_id = (SELECT prospect_id::text FROM prospects WHERE id = $1)", [id])).toBe(1);
  });

  it("held and archived prospects are refused on 17.6 too", async () => {
    const [held] = await q<{ id: string }>(`INSERT INTO prospects (organization_id, identity_state, hold_reason, name) VALUES ($1, 'held', 'two listings', 'Held') RETURNING id`, [world.organizationId]);
    expect(code(await save("owner", { commandId: uuidv7(), prospect: held.id, contact: { outcome: "spoke", channel: "call" } }))).toBe("held_prospect");
    const id = await seed("lead");
    await archive(id);
    expect(code(await save("owner", { commandId: uuidv7(), prospect: id, contact: { outcome: "spoke", channel: "call" } }))).toBe("archived_prospect");
  });
});

describe("MANDATORY BYPASS PROOF on PostgreSQL 17.6", () => {
  it("raw sales SQL cannot set closed-won, reopen closed-lost, touch assignment or rewrite contact dates", async () => {
    const lost = await seed("closed-lost", sales2);
    for (const set of ["status = 'closed-won'", "status = 'lead'", "assigned_to = current_user_id()", "assigned_to = NULL",
      "first_contact = '2000-01-01'", "last_contact = '2099-01-01'"]) {
      await expect(raw("sales", `UPDATE prospects SET ${set} WHERE id = $1`, [lost]), set).rejects.toThrow(/permission denied/);
    }
    expect((await q("SELECT status, assigned_to FROM prospects WHERE id = $1", [lost]))[0]).toEqual({ status: "closed-lost", assigned_to: sales2 });
  });

  it("the owner has no raw status path either — and even the superuser cannot change a stage without its transition", async () => {
    const id = await seed("lead");
    await expect(raw("owner", "UPDATE prospects SET status = 'contacted' WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(q("UPDATE prospects SET status = 'contacted' WHERE id = $1", [id])).rejects.toThrow(/needs its transition record/);
    expect((await q<{ status: string }>("SELECT status FROM prospects WHERE id = $1", [id]))[0].status).toBe("lead");
  });

  it("history cannot be forged or edited through raw SQL", async () => {
    const id = await seed("lead");
    await expect(raw("sales", `INSERT INTO prospect_stage_transitions (transition_id, organization_id, prospect, actor_user_id, correlation_id, from_status, to_status, cause)
      VALUES (gen_random_uuid(), current_org(), $1, current_user_id(), gen_random_uuid(), 'lead', 'closed-won', 'promotion')`, [id])).rejects.toThrow(/permission denied/);
    await expect(raw("owner", "DELETE FROM prospect_stage_transitions")).rejects.toThrow(/permission denied/);
    await expect(raw("owner", "UPDATE prospect_contacts SET outcome = 'other'")).rejects.toThrow(/permission denied/);
  });

  it("guarded commands CAN: self-claim, permitted stages, promotion to closed-won, owner reassign, contact projections", async () => {
    const id = await seed("lead");
    expect(code(await save("sales", { commandId: uuidv7(), prospect: id, claim: true, expectedStage: "lead",
      contact: { outcome: "spoke", channel: "call", happenedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }, stage: { to: "contacted" } }))).toBe("applied");
    expect(code(await assign("owner", { commandId: uuidv7(), prospect: id, mode: "reassign", expectedAssignee: world.partnerId, to: sales2 }))).toBe("applied");
    expect((await promote("sales2", id)).state).toBe("marked");
    const [row] = await q<{ status: string; assigned_to: string; f: string; l: string }>(
      "SELECT status, assigned_to, first_contact::text AS f, last_contact::text AS l FROM prospects WHERE id = $1", [id]);
    expect(row.status).toBe("closed-won");
    expect(row.assigned_to).toBe(sales2);
    expect(row.f < row.l).toBe(true);   // first = the backdated contact; last = Promote's touch (current_date)
    expect(await n("SELECT count(*)::text AS n FROM prospect_stage_transitions WHERE prospect = $1", [id])).toBe(2);
  });
});
