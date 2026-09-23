// Slice 2A.1b — SALES ACTIONS: contacts, stage history, follow-ups, assignment, receipts, and the
// revoked-grant boundary (docs/SLICE-2A1B-CONTRACT.md §7–§14).
//
// Sequential behaviour on PGlite 001–010. The races are proven on a real PostgreSQL 17.6 server in
// `sales-actions-concurrency.test.ts`; PGlite has one backend and cannot race.
//
// Every command runs exactly as a route will run it: the principal is RESOLVED from `memberships`
// (never declared), bound with `asPrincipal`, and the command runs through `runSalesCommand`, which
// is where a mid-command refusal rolls the whole transaction back.

import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { asPrincipal, loadMigrations, markProspectPromoted, resolveProspectForMutation, lockProspect, type SqlClient } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import {
  executeAssignment, executeFollowUpEdit, executeSave, runSalesCommand, type AssignmentCommand, type FollowUpEditCommand,
  type SaveCommand, type SalesResult,
} from "@/core/db/sales-actions";
import { resolveDue } from "@/domain";
import { adapt, SCHEMA, seedOperationalWorld, type World } from "@/tests/support/provisioned-partner";
import { uuidv7 } from "@/domain";

let pg: PGlite;
let db: SqlClient;
let world: World;
let secondSalesId: string;
const P: Record<"owner" | "sales" | "sales2", ResolvedPrincipal> = {} as never;

const one = async <T,>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params as never[])).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);

async function seedProspect(fields: { status?: string | null; held?: boolean; archived?: boolean; assignedTo?: string | null; org?: string } = {}) {
  const anchor = fields.held ? null : uuidv7();
  const row = await one<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, name, status, assigned_to)
     VALUES ($1, $2, $3, $4, $7, $5, $6) RETURNING id`,
    [fields.org ?? world.organizationId, anchor, fields.held ? "held" : "anchored", fields.held ? "two listings" : null,
     fields.status === undefined ? "lead" : fields.status, fields.assignedTo ?? null, `Biz ${uuidv7()}`]);
  if (fields.archived) await pg.query("UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1", [row.id, world.ownerId]);
  return { id: row.id, anchor: anchor ?? "" };
}

const save = (who: keyof typeof P, cmd: Omit<SaveCommand, "commandId"> & { commandId?: string }): Promise<SalesResult> => {
  const full = { commandId: cmd.commandId ?? uuidv7(), ...cmd } as SaveCommand;
  return runSalesCommand((fn) => asPrincipal(db, P[who], fn), (tx) => executeSave(tx, P[who], full), full.commandId);
};
const assign = (who: keyof typeof P, cmd: Omit<AssignmentCommand, "commandId"> & { commandId?: string }): Promise<SalesResult> => {
  const full = { commandId: cmd.commandId ?? uuidv7(), ...cmd } as AssignmentCommand;
  return runSalesCommand((fn) => asPrincipal(db, P[who], fn), (tx) => executeAssignment(tx, P[who], full), full.commandId);
};
/** Raw SQL as an application role, bound like `asPrincipal` — the bypass attempts. */
const raw = (who: keyof typeof P, sql: string, params: unknown[] = []) =>
  asPrincipal(db, P[who], (tx) => tx.query(sql, params as never));
const applied = (r: SalesResult) => { if (r.status !== "applied") throw new Error(`expected applied, got ${JSON.stringify(r)}`); return r.outcome; };
const code = (r: SalesResult) => (r.status === "refused" ? r.code : r.status);
const eventsOf = (commandId: string) => pg.query<{ type: string; data: Record<string, unknown>; actor_user_id: string }>(
  "SELECT type, data, actor_user_id FROM events WHERE correlation_id = $1 ORDER BY seq", [commandId]).then((r) => r.rows);
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeAll(async () => {
  pg = new PGlite();
  db = adapt(pg);
  await pg.exec(SCHEMA);
  world = await seedOperationalWorld(db, { orgSlug: "sales-2a1b", ownerEmail: "o@2a1b.test", partnerEmail: "s@2a1b.test" });
  secondSalesId = (await one<{ id: string }>("INSERT INTO users (email, display_name) VALUES ('s2@2a1b.test', 'S2') RETURNING id")).id;
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')", [secondSalesId, world.organizationId]);
  for (const [k, id] of [["owner", world.ownerId], ["sales", world.partnerId], ["sales2", secondSalesId]] as const) {
    const r = await resolvePrincipal(db, id);
    if (!r.ok) throw new Error(`principal ${k} did not resolve`);
    P[k] = r.principal;
  }
}, 60_000);

describe("2A.1b · migration 010 is part of the ledger", () => {
  it("010 is the tenth migration", () => {
    expect(loadMigrations().map((m) => m.name).slice(-1)).toEqual(["010_sales_actions.sql"]);
  });
});

describe("contacts — immutable, projected, authored by the resolved principal", () => {
  it("records a contact: one row, LA-dated projections, one prospect.contacted with ids only, one receipt", async () => {
    const p = await seedProspect();
    const at = "2026-09-20T06:30:00Z"; // 23:30 on the 19th in Los Angeles
    const r = applied(await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call", note: "Wants a quote", happenedAt: at } }));
    const row = await one<{ author_user_id: string; outcome: string; note: string; happened_at: Date }>(
      "SELECT author_user_id, outcome, note, happened_at FROM prospect_contacts WHERE contact_id = $1", [r.contact!.contactId]);
    expect(row).toMatchObject({ author_user_id: world.partnerId, outcome: "spoke", note: "Wants a quote" });
    const proj = await one<{ f: string; l: string }>("SELECT first_contact::text AS f, last_contact::text AS l FROM prospects WHERE id = $1", [p.id]);
    expect(proj).toEqual({ f: "2026-09-19", l: "2026-09-19" });
    const cmdId = (await one<{ command_id: string }>("SELECT command_id FROM prospect_contacts WHERE contact_id = $1", [r.contact!.contactId])).command_id;
    const ev = await eventsOf(cmdId);
    expect(ev.map((e) => e.type)).toEqual(["prospect.contacted"]);
    expect(ev[0].actor_user_id).toBe(world.partnerId);
    expect(Object.keys(ev[0].data).sort()).toEqual(["channel", "contact_id", "happened_at", "outcome"]);
    expect(JSON.stringify(ev[0].data)).not.toContain("quote");
    const receipt = await one<{ kind: string; outcome: unknown }>("SELECT kind, outcome FROM prospect_command_receipts WHERE command_id = $1", [cmdId]);
    expect(receipt.kind).toBe("save");
    expect(JSON.stringify(receipt.outcome)).not.toContain("quote");
  });

  it("D-3 · a backdated contact moves first_contact EARLIER and leaves last_contact; a newer one moves only last_contact", async () => {
    const p = await seedProspect();
    applied(await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: days(10) } }));
    const mid = await one<{ f: string; l: string }>("SELECT first_contact::text AS f, last_contact::text AS l FROM prospects WHERE id = $1", [p.id]);
    applied(await save("owner", { prospect: p.id, contact: { outcome: "voicemail", channel: "call", happenedAt: days(400) } }));
    const older = await one<{ f: string; l: string }>("SELECT first_contact::text AS f, last_contact::text AS l FROM prospects WHERE id = $1", [p.id]);
    expect(older.l).toBe(mid.l);
    expect(older.f < mid.f).toBe(true);
    applied(await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: days(0) } }));
    const newer = await one<{ f: string; l: string }>("SELECT first_contact::text AS f, last_contact::text AS l FROM prospects WHERE id = $1", [p.id]);
    expect(newer.f).toBe(older.f);
    expect(newer.l >= older.l).toBe(true);
  });

  it("A6 · sales may backdate at most 90 days; the owner may record older history; nobody may record the future", async () => {
    const p = await seedProspect();
    expect(code(await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: days(91) } }))).toBe("backdate_not_permitted");
    applied(await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: days(89) } }));
    applied(await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: days(900) } }));
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(code(await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call", happenedAt: future } }))).toBe("contact_in_future");
    // The database refuses the future on its own, whoever asks.
    await expect(asPrincipal(db, P.owner, (tx) => tx.query(
      "SELECT public.ascend_record_contact($1, $2, $3, $4, 'spoke', 'call', NULL, $5)",
      [p.id, world.ownerId, uuidv7(), uuidv7(), future] as never))).rejects.toThrow(/contact_not_in_future/);
  });

  it("refuses contradictions, empty commands, and bad ids before anything is read", async () => {
    const p = await seedProspect();
    expect(code(await save("sales", { prospect: p.id, contact: { outcome: "email_sent", channel: "call" } }))).toBe("invalid_command");
    expect(code(await save("sales", { prospect: p.id, contact: { outcome: "voicemail", channel: "text" } }))).toBe("invalid_command");
    expect(code(await save("sales", { prospect: p.id }))).toBe("nothing_to_do");
    expect(code(await save("sales", { commandId: "not-a-uuid", prospect: p.id, claim: true }))).toBe("invalid_command");
  });

  it("held and archived prospects are refused, and nothing is written", async () => {
    const held = await seedProspect({ held: true });
    const archived = await seedProspect({ archived: true });
    expect(code(await save("owner", { prospect: held.id, contact: { outcome: "spoke", channel: "call" } }))).toBe("held_prospect");
    expect(code(await save("owner", { prospect: archived.id, contact: { outcome: "spoke", channel: "call" } }))).toBe("archived_prospect");
    expect(await count("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect IN ($1, $2)", [held.id, archived.id])).toBe(0);
    // …and the guarded function refuses them itself, called directly.
    await expect(asPrincipal(db, P.owner, (tx) => tx.query("SELECT public.ascend_record_contact($1, $2, $3, $4, 'spoke', 'call', NULL, NULL)",
      [archived.id, world.ownerId, uuidv7(), uuidv7()] as never))).rejects.toThrow(/archived_prospect/);
  });

  it("contacts are immutable: no application role can UPDATE or DELETE one", async () => {
    await expect(raw("owner", "UPDATE prospect_contacts SET outcome = 'other'")).rejects.toThrow(/permission denied/);
    await expect(raw("owner", "DELETE FROM prospect_contacts")).rejects.toThrow(/permission denied/);
    await expect(raw("sales", "UPDATE prospect_contacts SET happened_at = now()")).rejects.toThrow(/permission denied/);
  });
});

describe("stage transitions — exactly one row per change, cause derived and enforced", () => {
  it("a manual change writes one transition (cause manual) and one prospect.status_changed", async () => {
    const p = await seedProspect();
    const r = applied(await save("sales", { prospect: p.id, expectedStage: "lead", stage: { to: "contacted" } }));
    const t = await pg.query<{ from_status: string; to_status: string; cause: string; correlation_id: string }>(
      "SELECT from_status, to_status, cause, correlation_id FROM prospect_stage_transitions WHERE prospect = $1", [p.id]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ from_status: "lead", to_status: "contacted", cause: "manual" });
    expect(r.stage!.transitionId).toBeTruthy();
    expect((await eventsOf(t.rows[0].correlation_id)).map((e) => e.type)).toEqual(["prospect.status_changed"]);
  });

  it("with a contact in the same Save, the cause is contact and the transition names it", async () => {
    const p = await seedProspect({ status: "contacted" });
    const r = applied(await save("sales", { prospect: p.id, expectedStage: "contacted", contact: { outcome: "meeting_set", channel: "call" }, stage: { to: "proposal" } }));
    const t = await one<{ cause: string; contact_id: string }>("SELECT cause, contact_id FROM prospect_stage_transitions WHERE prospect = $1", [p.id]);
    expect(t).toEqual({ cause: "contact", contact_id: r.contact!.contactId });
  });

  it("closed-lost requires a structured reason, stores it, and cancels the open follow-up", async () => {
    const p = await seedProspect({ status: "proposal" });
    applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }));
    expect(code(await save("sales", { prospect: p.id, expectedStage: "proposal", stage: { to: "closed-lost" } }))).toBe("lost_reason_required");
    const r = applied(await save("sales", { prospect: p.id, expectedStage: "proposal", stage: { to: "closed-lost", lostReason: "no_budget" } }));
    expect(await one("SELECT cause, lost_reason FROM prospect_stage_transitions WHERE prospect = $1", [p.id])).toEqual({ cause: "closed_lost", lost_reason: "no_budget" });
    expect(r.followUp!.cancelled).toBeTruthy();
    expect(await count("SELECT count(*)::int AS n FROM prospect_followups WHERE prospect = $1 AND state = 'open'", [p.id])).toBe(0);
    expect(code(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }))).toBe("followup_on_closed_prospect");
  });

  it("reopening closed-lost is owner-only (cause reopen); nobody leaves closed-won; closed-won is never a stage target", async () => {
    const p = await seedProspect({ status: "closed-lost" });
    expect(code(await save("sales", { prospect: p.id, expectedStage: "closed-lost", stage: { to: "lead" } }))).toBe("reopen_not_permitted");
    applied(await save("owner", { prospect: p.id, expectedStage: "closed-lost", stage: { to: "lead" } }));
    expect((await one<{ cause: string }>("SELECT cause FROM prospect_stage_transitions WHERE prospect = $1", [p.id])).cause).toBe("reopen");
    const won = await seedProspect({ status: "closed-won" });
    expect(code(await save("owner", { prospect: won.id, expectedStage: "closed-won", stage: { to: "lead" } }))).toBe("closed_won_is_final");
    expect(code(await save("owner", { prospect: won.id, expectedStage: "lead", stage: { to: "closed-won" as never } }))).toBe("closed_won_not_permitted");
  });

  it("a stale expected stage is stage_conflict, and the WHOLE Save is refused — its contact is not written", async () => {
    const p = await seedProspect({ status: "contacted" });
    const r = await save("sales", { prospect: p.id, expectedStage: "lead", contact: { outcome: "spoke", channel: "call" }, stage: { to: "proposal" } });
    expect(r).toMatchObject({ status: "refused", code: "stage_conflict", detail: { current: "contacted" } });
    expect(await count("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(0);
  });
});

describe("Promote (post-010) — the only path to closed-won, with exactly one transition", () => {
  async function mark(p: { id: string; anchor: string }, correlationId = uuidv7()) {
    return asPrincipal(db, P.sales, async (tx) => {
      const r = await resolveProspectForMutation(tx, p.id);
      if (!r.ok) throw new Error("did not resolve");
      await lockProspect(tx, r.target.prospectId);
      return markProspectPromoted(tx, world.organizationId as never, {
        target: r.target, clientSlug: "c", clientId: "client-1", correlationId, actorUserId: world.partnerId as never });
    });
  }

  it("writes one promotion transition, and status_changed + promoted share the correlation id; a replay writes nothing", async () => {
    const p = await seedProspect({ status: "proposal" });
    const correlation = uuidv7();
    expect((await mark(p, correlation)).state).toBe("marked");
    expect((await mark(p)).state).toBe("already_marked");
    const t = await pg.query("SELECT from_status, to_status, cause, correlation_id FROM prospect_stage_transitions WHERE prospect = $1", [p.id]);
    expect(t.rows).toEqual([{ from_status: "proposal", to_status: "closed-won", cause: "promotion", correlation_id: correlation }]);
    expect((await eventsOf(correlation)).map((e) => e.type)).toEqual(["prospect.status_changed", "prospect.promoted"]);
  });

  it("D-2 · a closed-lost prospect can be promoted (closed-lost → closed-won, cause promotion) — by sales", async () => {
    const p = await seedProspect({ status: "closed-lost" });
    expect((await mark(p)).state).toBe("marked");
    expect(await one("SELECT from_status, to_status, cause FROM prospect_stage_transitions WHERE prospect = $1", [p.id]))
      .toEqual({ from_status: "closed-lost", to_status: "closed-won", cause: "promotion" });
  });

  it("keeps D1's last_contact touch, but only forward", async () => {
    const p = await seedProspect({ status: "lead" });
    await pg.query("UPDATE prospects SET last_contact = current_date + 3 WHERE id = $1", [p.id]); // superuser seed; not a status change
    const before = (await one<{ l: string }>("SELECT last_contact::text AS l FROM prospects WHERE id = $1", [p.id])).l;
    await mark(p);
    expect((await one<{ l: string }>("SELECT last_contact::text AS l FROM prospects WHERE id = $1", [p.id])).l).toBe(before);
  });
});

describe("follow-ups — one open, explicit changes only, history kept", () => {
  it("scheduling over an open follow-up SUPERSEDES it (named successor); with a contact it COMPLETES it", async () => {
    const p = await seedProspect();
    const a = applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }));
    const b = applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "email", dueOn: "2026-10-02" } } }));
    expect(await one("SELECT state, superseded_by FROM prospect_followups WHERE followup_id = $1", [a.followUp!.created]))
      .toEqual({ state: "superseded", superseded_by: b.followUp!.created });
    const c = applied(await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call" }, followUp: { schedule: { action: "meeting", dueOn: "2026-10-03" } } }));
    expect(await one("SELECT state, resolved_by_contact FROM prospect_followups WHERE followup_id = $1", [b.followUp!.created]))
      .toEqual({ state: "completed", resolved_by_contact: c.contact!.contactId });
    expect(await count("SELECT count(*)::int AS n FROM prospect_followups WHERE prospect = $1 AND state = 'open'", [p.id])).toBe(1);
    const scheduled = (await eventsOf((await one<{ c: string }>("SELECT created_by_command AS c FROM prospect_followups WHERE followup_id = $1", [b.followUp!.created])).c));
    expect(scheduled.find((e) => e.type === "prospect.followup_scheduled")!.data).toMatchObject({ supersedes: a.followUp!.created });
  });

  it("resolve: completed or cancelled; nothing to resolve is refused; a resolved row never changes again", async () => {
    const p = await seedProspect();
    expect(code(await save("sales", { prospect: p.id, followUp: { resolve: "completed" } }))).toBe("no_open_followup");
    const a = applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }));
    applied(await save("sales", { prospect: p.id, followUp: { resolve: "cancelled" } }));
    const upd = await raw("owner", "UPDATE prospect_followups SET state = 'open' WHERE followup_id = $1", [a.followUp!.created]);
    expect(upd.affected).toBe(0);
  });

  it("sales schedules only for itself; the owner for any enabled member, never a stranger", async () => {
    const p = await seedProspect();
    expect(code(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01", assignee: secondSalesId } } }))).toBe("followup_assignee_not_permitted");
    applied(await save("owner", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01", assignee: secondSalesId } } }));
    const p2 = await seedProspect();
    expect(code(await save("owner", { prospect: p2.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01", assignee: uuidv7() } } }))).toBe("assignee_not_member");
  });

  it("A4 · a sales Save touching ANOTHER salesperson's follow-up is refused atomically — then a NEW contact-only command succeeds", async () => {
    const p = await seedProspect({ status: "contacted" });
    applied(await save("owner", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01", assignee: secondSalesId } } }));
    const combined = await save("sales", { prospect: p.id, expectedStage: "contacted", claim: true,
      contact: { outcome: "spoke", channel: "call", note: "keep this" }, stage: { to: "proposal" },
      followUp: { schedule: { action: "email", dueOn: "2026-10-05" } } });
    expect(code(combined)).toBe("followup_owned_by_other");
    expect(await one("SELECT status, assigned_to FROM prospects WHERE id = $1", [p.id])).toEqual({ status: "contacted", assigned_to: null });
    expect(await count("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM prospect_command_receipts WHERE prospect = $1 AND actor_user_id = $2", [p.id, world.partnerId])).toBe(0);
    applied(await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call", note: "keep this" } }));
    expect(await count("SELECT count(*)::int AS n FROM prospect_followups WHERE prospect = $1 AND state = 'open' AND assignee_user_id = $2", [p.id, secondSalesId])).toBe(1);
  });

  it("the database refuses a second open follow-up outright (partial unique index)", async () => {
    const p = await seedProspect();
    applied(await save("owner", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } }));
    await expect(pg.query(`INSERT INTO prospect_followups (followup_id, organization_id, prospect, action, assignee_user_id, due_on, created_by, created_by_command)
      SELECT gen_random_uuid(), organization_id, prospect, 'call', assignee_user_id, due_on, created_by, created_by_command FROM prospect_followups WHERE prospect = $1`, [p.id]))
      .rejects.toThrow(/prospect_followups_one_open/);
  });
});

const edit = (who: keyof typeof P, cmd: Omit<FollowUpEditCommand, "commandId"> & { commandId?: string }): Promise<SalesResult> => {
  const full = { commandId: cmd.commandId ?? uuidv7(), ...cmd } as FollowUpEditCommand;
  return runSalesCommand((fn) => asPrincipal(db, P[who], fn), (tx) => executeFollowUpEdit(tx, P[who], full), full.commandId);
};

describe("owner follow-up edit (decision 1) — owner only, open only, compare-and-set, explicit assignee", () => {
  async function scheduled(dueAt: { local: string; offset: string } | null = null) {
    const p = await seedProspect();
    const f = applied(await save("owner", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-11-01", ...(dueAt ? { dueAt } : {}) } } })).followUp!.created!;
    const row = await one<{ due_at: Date | null }>("SELECT due_at FROM prospect_followups WHERE followup_id = $1", [f]);
    return { p, f, expected: { action: "call" as const, assignee: world.ownerId, dueOn: "2026-11-01", dueAt: row.due_at ? new Date(row.due_at).toISOString() : null } };
  }

  it("the owner reschedules and reassigns in one command: one receipt, one prospect.followup_updated with the changed fields only", async () => {
    const { p, f, expected } = await scheduled();
    const cmdId = uuidv7();
    const r = applied(await edit("owner", { commandId: cmdId, prospect: p.id, followupId: f, expected,
      changes: { dueOn: "2026-11-01", dueAt: { local: "2026-11-01T01:30", offset: "-08:00" }, assignee: world.partnerId, note: "private context" } }));
    expect(r.followUp).toMatchObject({ updated: f, changed: ["due_at", "assignee", "note"] });
    expect(await one("SELECT assignee_user_id, due_at = '2026-11-01T09:30:00Z'::timestamptz AS exact, note FROM prospect_followups WHERE followup_id = $1", [f]))
      .toEqual({ assignee_user_id: world.partnerId, exact: true, note: "private context" });
    const ev = await eventsOf(cmdId);
    expect(ev.map((e) => e.type)).toEqual(["prospect.followup_updated"]);
    expect(ev[0].data).toMatchObject({ changed: ["due_at", "assignee"], assignee: { from: world.ownerId, to: world.partnerId } });
    expect(JSON.stringify(ev[0].data)).not.toContain("private");
    expect((await edit("owner", { commandId: cmdId, prospect: p.id, followupId: f, expected,
      changes: { dueOn: "2026-11-01", dueAt: { local: "2026-11-01T01:30", offset: "-08:00" }, assignee: world.partnerId, note: "private context" } })).status).toBe("replayed");
  });

  it("sales may not edit; a stale expectation is followup_conflict; a resolved follow-up is immutable; strangers cannot be assigned", async () => {
    const { p, f, expected } = await scheduled();
    expect(code(await edit("sales", { prospect: p.id, followupId: f, expected, changes: { action: "email" } }))).toBe("followup_edit_not_permitted");
    expect(code(await edit("owner", { prospect: p.id, followupId: f, expected: { ...expected, action: "email" }, changes: { action: "text" } }))).toBe("followup_conflict");
    expect(code(await edit("owner", { prospect: p.id, followupId: f, expected, changes: { assignee: uuidv7() } }))).toBe("assignee_not_member");
    applied(await save("owner", { prospect: p.id, followUp: { resolve: "cancelled" } }));
    expect(code(await edit("owner", { prospect: p.id, followupId: f, expected, changes: { action: "email" } }))).toBe("followup_not_open");
    // …and the database agrees: sales holds no UPDATE on these columns at all.
    await expect(raw("sales", "UPDATE prospect_followups SET due_on = '2027-01-01'")).rejects.toThrow(/permission denied/);
  });

  it("scheduling is validated with the canonical resolver: a new day for a timed follow-up must restate its time; DST gaps refused", async () => {
    const { p, f, expected } = await scheduled({ local: "2026-11-01T09:00", offset: "-08:00" });
    expect(code(await edit("owner", { prospect: p.id, followupId: f, expected, changes: { dueOn: "2026-11-02" } }))).toBe("invalid_command");
    expect(code(await edit("owner", { prospect: p.id, followupId: f, expected, changes: { dueOn: "2027-03-14", dueAt: { local: "2027-03-14T02:30", offset: "-08:00" } } }))).toBe("nonexistent_local_time");
    applied(await edit("owner", { prospect: p.id, followupId: f, expected, changes: { dueOn: "2026-11-02", dueAt: null } }));
    expect(await one("SELECT due_on::text AS d, due_at FROM prospect_followups WHERE followup_id = $1", [f])).toEqual({ d: "2026-11-02", due_at: null });
  });

  it("a note-only edit is recorded (receipt) but is not a business event", async () => {
    const { p, f, expected } = await scheduled();
    const cmdId = uuidv7();
    applied(await edit("owner", { commandId: cmdId, prospect: p.id, followupId: f, expected, changes: { note: "just context" } }));
    expect(await eventsOf(cmdId)).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM prospect_command_receipts WHERE command_id = $1 AND kind = 'followup_edit'", [cmdId])).toBe(1);
  });
});

describe("assignment — claim for self only; reassign/unassign owner-only; follow-ups never move silently", () => {
  it("sales claims an unassigned prospect; a second claim by the winner is already_yours; another salesperson gets already_assigned", async () => {
    const p = await seedProspect();
    const r = applied(await assign("sales", { prospect: p.id, mode: "claim" }));
    expect(r.assignment).toMatchObject({ result: "applied", to: world.partnerId });
    expect((await assign("sales", { prospect: p.id, mode: "claim" }))).toMatchObject({ status: "applied", outcome: { assignment: { result: "already_yours" } } });
    expect(code(await assign("sales2", { prospect: p.id, mode: "claim" }))).toBe("already_assigned");
  });

  it("sales cannot reassign or unassign; the owner can, with compare-and-set on what they saw", async () => {
    const p = await seedProspect({ assignedTo: world.partnerId });
    expect(code(await assign("sales", { prospect: p.id, mode: "reassign", expectedAssignee: world.partnerId, to: secondSalesId }))).toBe("assignment_not_permitted");
    expect(code(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: null, to: secondSalesId }))).toBe("assignment_conflict");
    applied(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: world.partnerId, to: secondSalesId }));
    applied(await assign("owner", { prospect: p.id, mode: "unassign", expectedAssignee: secondSalesId }));
    expect((await one<{ a: string | null }>("SELECT assigned_to AS a FROM prospects WHERE id = $1", [p.id])).a).toBeNull();
  });

  it("A5 · with an open follow-up the owner must choose: leave, transfer or cancel — never inferred", async () => {
    const p = await seedProspect({ assignedTo: world.partnerId });
    const f = applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-10-01" } } })).followUp!.created!;
    expect(code(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: world.partnerId, to: secondSalesId }))).toBe("followup_choice_required");
    applied(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: world.partnerId, to: secondSalesId, openFollowUp: "leave" }));
    expect((await one<{ a: string }>("SELECT assignee_user_id AS a FROM prospect_followups WHERE followup_id = $1", [f])).a).toBe(world.partnerId);
    applied(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: secondSalesId, to: world.ownerId, openFollowUp: "transfer" }));
    expect((await one<{ a: string }>("SELECT assignee_user_id AS a FROM prospect_followups WHERE followup_id = $1", [f])).a).toBe(world.ownerId);
  });
});

describe("command receipts — replay converges, a changed payload conflicts", () => {
  it("the same command id and payload replays the stored result, writing no rows and no events", async () => {
    const p = await seedProspect();
    const cmd = { commandId: uuidv7(), prospect: p.id, contact: { outcome: "spoke" as const, channel: "call" as const, note: "n" }, followUp: { schedule: { action: "call" as const, dueOn: "2026-10-01" } } };
    const first = await save("sales", cmd);
    const again = await save("sales", cmd);
    expect(again).toEqual({ ...first, status: "replayed" });
    expect(await count("SELECT count(*)::int AS n FROM prospect_contacts WHERE prospect = $1", [p.id])).toBe(1);
    expect((await eventsOf(cmd.commandId)).length).toBe(2);
  });

  it("the same command id with a different payload — or on another prospect — is command_id_conflict", async () => {
    const p = await seedProspect();
    const q = await seedProspect();
    const id = uuidv7();
    applied(await save("sales", { commandId: id, prospect: p.id, contact: { outcome: "spoke", channel: "call" } }));
    expect(code(await save("sales", { commandId: id, prospect: p.id, contact: { outcome: "no_answer", channel: "call" } }))).toBe("command_id_conflict");
    expect(code(await save("sales", { commandId: id, prospect: q.id, contact: { outcome: "spoke", channel: "call" } }))).toBe("command_id_conflict");
    expect(code(await save("owner", { commandId: id, prospect: p.id, contact: { outcome: "spoke", channel: "call" } }))).toBe("command_id_conflict");
  });

  it("receipts are immutable", async () => {
    await expect(raw("owner", "UPDATE prospect_command_receipts SET kind = 'save'")).rejects.toThrow(/permission denied/);
    await expect(raw("sales", "DELETE FROM prospect_command_receipts")).rejects.toThrow(/permission denied/);
  });
});

describe("MANDATORY BYPASS PROOF (PGlite; repeated on PostgreSQL 17.6) — raw SQL cannot go around the commands", () => {
  it("raw SQL as sales OR owner cannot write stage, assignment or contact dates", async () => {
    const p = await seedProspect();
    for (const who of ["sales", "owner"] as const) {
      for (const set of ["status = 'closed-won'", "status = 'proposal'", "assigned_to = current_user_id()", "first_contact = '2000-01-01'", "last_contact = '2099-01-01'"]) {
        await expect(raw(who, `UPDATE prospects SET ${set} WHERE id = $1`, [p.id]), `${who}: ${set}`).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("raw SQL cannot forge history: no INSERT into contacts or transitions for any application role", async () => {
    const p = await seedProspect();
    for (const who of ["sales", "owner"] as const) {
      await expect(raw(who, `INSERT INTO prospect_stage_transitions (transition_id, organization_id, prospect, actor_user_id, correlation_id, from_status, to_status, cause)
        VALUES (gen_random_uuid(), current_org(), $1, current_user_id(), gen_random_uuid(), 'lead', 'closed-won', 'promotion')`, [p.id])).rejects.toThrow(/permission denied/);
      await expect(raw(who, `INSERT INTO prospect_contacts (contact_id, organization_id, prospect, command_id, author_user_id, outcome, channel, happened_at)
        VALUES (gen_random_uuid(), current_org(), $1, gen_random_uuid(), current_user_id(), 'spoke', 'call', now())`, [p.id])).rejects.toThrow(/permission denied/);
    }
  });

  it("the guarded functions, called directly as sales, still refuse what sales may not do", async () => {
    const p = await seedProspect({ status: "closed-lost", assignedTo: secondSalesId });
    const fn = (sql: string, params: unknown[]) => raw("sales", sql, params);
    // reopen closed-lost
    await expect(fn("SELECT public.ascend_transition_stage($1, $2, gen_random_uuid(), gen_random_uuid(), 'closed-lost', 'lead', 'reopen', NULL, NULL, false)", [p.id, world.partnerId])).rejects.toThrow(/reopen_not_permitted/);
    // "manual" closed-won is refused by the table's own cause CHECK
    const q = await seedProspect({ status: "lead" });
    await expect(fn("SELECT public.ascend_transition_stage($1, $2, gen_random_uuid(), gen_random_uuid(), 'lead', 'closed-won', 'manual', NULL, NULL, false)", [q.id, world.partnerId])).rejects.toThrow(/transition_promotion_iff_closed_won/);
    // act as someone else
    await expect(fn("SELECT public.ascend_transition_stage($1, $2, gen_random_uuid(), gen_random_uuid(), 'lead', 'contacted', 'manual', NULL, NULL, false)", [q.id, secondSalesId])).rejects.toThrow(/actor is not the user bound/);
    // a stale expected stage, called directly: the function's own compare-and-set answers, and writes nothing
    const stale = await seedProspect({ status: "contacted" });
    expect((await fn("SELECT public.ascend_transition_stage($1, $2, gen_random_uuid(), gen_random_uuid(), 'lead', 'proposal', 'manual', NULL, NULL, false) AS r", [stale.id, world.partnerId])).rows[0]).toEqual({ r: "stage_conflict" });
    expect(await count("SELECT count(*)::int AS n FROM prospect_stage_transitions WHERE prospect = $1", [stale.id])).toBe(0);
    // steal, claim for another, reassign
    expect((await fn("SELECT public.ascend_assign_prospect($1, $2, 'claim', NULL, $2) AS r", [p.id, world.partnerId])).rows[0]).toEqual({ r: "already_assigned" });
    await expect(fn("SELECT public.ascend_assign_prospect($1, $2, 'claim', NULL, $3)", [q.id, world.partnerId, secondSalesId])).rejects.toThrow(/claim assigns the claimant/);
    await expect(fn("SELECT public.ascend_assign_prospect($1, $2, 'reassign', $3, $2)", [p.id, world.partnerId, secondSalesId])).rejects.toThrow(/assignment_not_permitted/);
  });

  it("raw follow-up inserts are held to the policy: sales only for itself, only on an open prospect", async () => {
    const p = await seedProspect();
    const ins = (who: keyof typeof P, assignee: string, prospect = p.id) => raw(who, `INSERT INTO prospect_followups
      (followup_id, organization_id, prospect, action, assignee_user_id, due_on, created_by, created_by_command)
      VALUES (gen_random_uuid(), current_org(), $1, 'call', $2, '2026-10-01', current_user_id(), gen_random_uuid())`, [prospect, assignee]);
    await expect(ins("sales", secondSalesId)).rejects.toThrow(/row-level security/);
    const closed = await seedProspect({ status: "closed-lost" });
    await expect(ins("owner", secondSalesId, closed.id)).rejects.toThrow(/row-level security/);
  });

  it("a guarded function bound to one organization cannot touch another organization's prospect", async () => {
    const other = await one<{ id: string }>("INSERT INTO organizations (slug, name) VALUES ('other-2a1b', 'Other') RETURNING id");
    const foreign = await seedProspect({ org: other.id });
    await expect(raw("owner", "SELECT public.ascend_record_contact($1, $2, gen_random_uuid(), gen_random_uuid(), 'spoke', 'call', NULL, NULL)", [foreign.id, world.ownerId]))
      .rejects.toThrow(/no such prospect in this organization/);
  });

  it("even the table owner cannot change a stage without naming its transition (the trigger)", async () => {
    const p = await seedProspect();
    await expect(pg.query("UPDATE prospects SET status = 'contacted' WHERE id = $1", [p.id])).rejects.toThrow(/needs its transition record/);
    await pg.query("UPDATE prospects SET notes = 'maintenance is still possible' WHERE id = $1", [p.id]);
  });

  it("guarded commands CAN do what the roles are allowed: self-claim, permitted stages, promotion, owner reassign, projections", async () => {
    // Covered above end to end; restated as a single positive path so the bypass proof has both halves.
    const p = await seedProspect();
    applied(await save("sales", { prospect: p.id, claim: true, expectedStage: "lead", contact: { outcome: "spoke", channel: "call" }, stage: { to: "contacted" } }));
    applied(await assign("owner", { prospect: p.id, mode: "reassign", expectedAssignee: world.partnerId, to: secondSalesId }));
    expect(await one("SELECT status, assigned_to, last_contact IS NOT NULL AS dated FROM prospects WHERE id = $1", [p.id]))
      .toEqual({ status: "contacted", assigned_to: secondSalesId, dated: true });
  });
});

describe("Supabase default privileges — the API roles get nothing from 010", () => {
  it("with production's default grants in place, anon/authenticated/service_role hold no privilege on any 010 object", async () => {
    const fresh = new PGlite();
    const migrations = loadMigrations();
    for (const m of migrations.slice(0, 9)) await fresh.exec(m.sql);
    // Production's shape (measured from the post-009 artifact): the migrating role's default privileges.
    await fresh.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
    await fresh.exec(migrations[9].sql);
    const leaks = (await fresh.query<{ what: string }>(`
      SELECT r || ' ' || f AS what FROM unnest(ARRAY['anon','authenticated','service_role']) r,
        unnest(ARRAY['ascend_record_contact(uuid,uuid,uuid,uuid,text,text,text,timestamptz)',
                     'ascend_transition_stage(uuid,uuid,uuid,uuid,text,text,text,text,uuid,boolean)',
                     'ascend_assign_prospect(uuid,uuid,text,uuid,uuid)', 'ascend_guard_actor(uuid)', 'ascend_guard_prospect(uuid)']) f
       WHERE has_function_privilege(r, 'public.' || f, 'EXECUTE')
      UNION ALL
      SELECT r || ' ' || t FROM unnest(ARRAY['anon','authenticated','service_role']) r,
        unnest(ARRAY['prospect_command_receipts','prospect_contacts','prospect_followups','prospect_stage_transitions']) t
       WHERE has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`)).rows.map((r) => r.what);
    expect(leaks).toEqual([]);
    // Positive control: without 010's revokes the default grant WOULD have applied.
    await fresh.exec("CREATE FUNCTION public.rt_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    expect((await fresh.query<{ v: boolean }>("SELECT has_function_privilege('anon', 'public.rt_probe()', 'EXECUTE') AS v")).rows[0].v).toBe(true);
    expect((await fresh.query<{ v: boolean }>("SELECT has_function_privilege('ascend_automation', 'public.ascend_transition_stage(uuid,uuid,uuid,uuid,text,text,text,text,uuid,boolean)', 'EXECUTE') AS v")).rows[0].v).toBe(false);
    await fresh.close();
  }, 60_000);
});

describe("D-6 · due time — explicit offset, validated against Los Angeles at both DST boundaries", () => {
  it.each([
    ["an ordinary time", "2026-07-01", { local: "2026-07-01T09:00", offset: "-07:00" }, "2026-07-01T16:00:00.000Z"],
    ["the FIRST 01:30 of fall-back (PDT)", "2026-11-01", { local: "2026-11-01T01:30", offset: "-07:00" }, "2026-11-01T08:30:00.000Z"],
    ["the SECOND 01:30 of fall-back (PST) — a different instant", "2026-11-01", { local: "2026-11-01T01:30", offset: "-08:00" }, "2026-11-01T09:30:00.000Z"],
    ["the minute before spring-forward", "2026-03-08", { local: "2026-03-08T01:59", offset: "-08:00" }, "2026-03-08T09:59:00.000Z"],
    ["the first minute after spring-forward", "2026-03-08", { local: "2026-03-08T03:00", offset: "-07:00" }, "2026-03-08T10:00:00.000Z"],
    ["an ISO timestamp with its offset", "2026-11-01", "2026-11-01T01:30:00-08:00", "2026-11-01T09:30:00.000Z"],
    ["23:30 local, which is the NEXT day in UTC", "2026-09-19", { local: "2026-09-19T23:30", offset: "-07:00" }, "2026-09-20T06:30:00.000Z"],
  ] as const)("accepts %s", (_l, dueOn, dueAt, instant) => {
    expect(resolveDue(dueOn, dueAt)).toEqual({ ok: true, dueOn, dueAt: instant });
  });

  it.each([
    ["spring-forward 02:30 at -08:00", "2026-03-08", { local: "2026-03-08T02:30", offset: "-08:00" }, "nonexistent_local_time"],
    ["spring-forward 02:30 at -07:00", "2026-03-08", { local: "2026-03-08T02:30", offset: "-07:00" }, "nonexistent_local_time"],
    ["a fall-back time with no offset", "2026-11-01", "2026-11-01T01:30", "offset_required"],
    ["an offset without its value", "2026-11-01", { local: "2026-11-01T01:30", offset: "" }, "offset_required"],
    ["July at the winter offset", "2026-07-01", { local: "2026-07-01T09:00", offset: "-08:00" }, "offset_not_los_angeles"],
    ["a UTC (Z) timestamp", "2026-07-01", "2026-07-01T16:00:00Z", "offset_not_los_angeles"],
    ["a time on a different day from due_on", "2026-07-02", { local: "2026-07-01T09:00", offset: "-07:00" }, "due_at_not_on_due_on"],
    ["a date that does not exist", "2026-02-30", null, "invalid_due_on"],
  ] as const)("refuses %s", (_l, dueOn, dueAt, why) => {
    expect(resolveDue(dueOn, dueAt as never)).toMatchObject({ ok: false, code: why });
  });

  it("the database stores the instant and holds it to due_on in Los Angeles — it resolves nothing itself", async () => {
    const p = await seedProspect();
    const r = applied(await save("sales", { prospect: p.id, followUp: { schedule: { action: "call", dueOn: "2026-11-01", dueAt: { local: "2026-11-01T01:30", offset: "-08:00" } } } }));
    expect(await one("SELECT due_on::text AS d, due_at = '2026-11-01T09:30:00Z'::timestamptz AS exact FROM prospect_followups WHERE followup_id = $1", [r.followUp!.created]))
      .toEqual({ d: "2026-11-01", exact: true });
    await expect(pg.query("UPDATE prospect_followups SET due_on = '2026-11-02' WHERE followup_id = $1", [r.followUp!.created])).rejects.toThrow(/followup_due_at_is_on_due_on/);
  });
});
