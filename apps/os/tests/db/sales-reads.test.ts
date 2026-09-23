// Slice 2A.2a — the SALES READS: bounded queue sections, filters, keyset pages, and the merged
// timeline. On PGlite 001–010, through the real commands where history is needed.
//
// Two things these tests exist to stop:
//   · a list page that mounts the whole hit list (every section is BOUNDED and says its total);
//   · a read that quietly starts returning more of the row than the screen needs (the key sets of
//     every summary shape are asserted, so widening one is a decision, not a diff nobody saw).
//
// Due state is the database's answer, computed in America/Los_Angeles from the database clock —
// never the test's clock, and never the browser's.

import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { asPrincipal, type SqlClient } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { executeSave, runSalesCommand } from "@/core/db/sales-actions";
import {
  QUEUE_PAGE_MAX, SECTION_DEFAULTS, getProspectActionSummary, getProspectTimeline, listSalesQueue, listSalesSection,
  type SalesSection,
} from "@/core/db/sales-reads";
import { adapt, SCHEMA, seedOperationalWorld, type World } from "@/tests/support/provisioned-partner";
import { laOffsetAt, losAngelesWallClock, uuidv7 } from "@/domain";

let pg: PGlite;
let db: SqlClient;
let world: World;
let sales2: string;
const P: Record<"owner" | "sales", ResolvedPrincipal> = {} as never;

const as = <T,>(who: "owner" | "sales", fn: (tx: SqlClient) => Promise<T>) => asPrincipal(db, P[who], fn);
const save = (who: "owner" | "sales", cmd: Record<string, unknown>) => {
  const full = { commandId: uuidv7(), ...cmd } as never;
  return runSalesCommand((fn) => asPrincipal(db, P[who], fn), (tx) => executeSave(tx, P[who], full), (full as { commandId: string }).commandId);
};

let seq = 0;
async function seedProspect(fields: { name?: string; status?: string | null; assignedTo?: string | null; held?: boolean; archived?: boolean } = {}) {
  seq++;
  const name = fields.name ?? `Biz ${String(seq).padStart(3, "0")}`;
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, name, status, assigned_to)
     VALUES ($1, CASE WHEN $2 THEN NULL ELSE gen_random_uuid() END, CASE WHEN $2 THEN 'held' ELSE 'anchored' END,
             CASE WHEN $2 THEN 'two listings' END, $3, $4, $5) RETURNING id`,
    [world.organizationId, fields.held === true, name, fields.status === undefined ? "lead" : fields.status, fields.assignedTo ?? null]);
  if (fields.archived) await pg.query("UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1", [rows[0].id, world.ownerId]);
  return { id: rows[0].id, name };
}
/** A follow-up due on a day relative to Los Angeles "today", written through the command. */
async function followUp(who: "owner" | "sales", prospect: string, dayOffset: number) {
  const { rows } = await pg.query<{ d: string }>(
    "SELECT ((now() AT TIME ZONE 'America/Los_Angeles')::date + $1::int)::text AS d", [dayOffset]);
  const r = await save(who, { prospect, followUp: { schedule: { action: "call", dueOn: rows[0].d } } });
  if (r.status !== "applied") throw new Error(`follow-up seed failed: ${JSON.stringify(r)}`);
  return rows[0].d;
}

beforeAll(async () => {
  pg = new PGlite();
  db = adapt(pg);
  await pg.exec(SCHEMA);
  world = await seedOperationalWorld(db, { orgSlug: "sales-reads", ownerEmail: "o@reads.test", partnerEmail: "s@reads.test" });
  sales2 = (await pg.query<{ id: string }>("INSERT INTO users (email, display_name) VALUES ('s2@reads.test', 'Sales Two') RETURNING id")).rows[0].id;
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'sales')", [sales2, world.organizationId]);
  for (const [k, id] of [["owner", world.ownerId], ["sales", world.partnerId]] as const) {
    const r = await resolvePrincipal(db, id);
    if (!r.ok) throw new Error(`${k} did not resolve`);
    P[k] = r.principal;
  }
}, 60_000);

describe("due state is computed in Los Angeles, by the database", () => {
  it("overdue / today / upcoming / none, for timed and untimed follow-ups alike", async () => {
    const [late, today, soon, bare] = await Promise.all([seedProspect(), seedProspect(), seedProspect(), seedProspect()]);
    await followUp("sales", late.id, -2);
    await followUp("sales", today.id, 0);
    await followUp("sales", soon.id, 5);
    const rows = await as("owner", (tx) => listSalesQueue(tx, { limit: QUEUE_PAGE_MAX }));
    const state = (id: string) => rows.rows.find((r) => r.id === id)!.dueState;
    expect([state(late.id), state(today.id), state(soon.id), state(bare.id)]).toEqual(["overdue", "today", "upcoming", "none"]);
    // A TIMED follow-up earlier today is overdue even though its day is today.
    const timed = await seedProspect();
    const local = losAngelesWallClock(new Date(Date.now() - 2 * 3_600_000));
    const offset = laOffsetAt(local);
    const r = await save("sales", { prospect: timed.id, followUp: { schedule: { action: "call", dueOn: local.slice(0, 10), dueAt: { local, offset } } } });
    expect(r.status, JSON.stringify(r)).toBe("applied");
    const after = await as("owner", (tx) => listSalesQueue(tx, { limit: QUEUE_PAGE_MAX }));
    expect(after.rows.find((x) => x.id === timed.id)!.dueState).toBe("overdue");
  }, 60_000);
});

describe("sections are bounded, counted, and scoped", () => {
  it("each section returns at most its limit, states the true total, and never includes held or archived", async () => {
    const mine: string[] = [];
    for (let i = 0; i < 25; i++) {
      const p = await seedProspect({ assignedTo: world.partnerId, name: `Overdue ${String(i).padStart(2, "0")}` });
      await followUp("sales", p.id, -1);
      mine.push(p.id);
    }
    const held = await seedProspect({ held: true });
    const archived = await seedProspect({ archived: true, assignedTo: world.partnerId });
    const section = await as("sales", (tx) => listSalesSection(tx, "overdue", { assignee: world.partnerId }));
    expect(section.limit).toBe(SECTION_DEFAULTS.overdue);
    expect(section.rows).toHaveLength(SECTION_DEFAULTS.overdue);
    expect(section.total).toBeGreaterThanOrEqual(25);
    expect(section.rows.every((r) => r.dueState === "overdue")).toBe(true);
    const ids = section.rows.map((r) => r.id);
    expect(ids).not.toContain(held.id);
    expect(ids).not.toContain(archived.id);
    // Oldest first: the queue is worked from the back of the list.
    const dues = section.rows.map((r) => r.openFollowUp!.dueOn);
    expect([...dues].sort()).toEqual(dues);
    expect(mine.length).toBe(25);
  }, 120_000);

  it("the limit is clamped, and a section can be widened up to the cap", async () => {
    const wide = await as("sales", (tx) => listSalesSection(tx, "overdue", { assignee: world.partnerId, limit: 999 }));
    expect(wide.limit).toBe(50);
    expect(wide.rows.length).toBeLessThanOrEqual(50);
  });

  it("unassigned ignores the scope (it is the shared pool); the other sections respect it", async () => {
    const free = await seedProspect({ assignedTo: null, name: "Zz Unclaimed" });
    const theirs = await seedProspect({ assignedTo: sales2, name: "Zz Theirs" });
    await followUp("owner", theirs.id, -3);
    const unassigned = await as("sales", (tx) => listSalesSection(tx, "unassigned", { assignee: world.partnerId, limit: 50 }));
    expect(unassigned.rows.map((r) => r.id)).toContain(free.id);
    expect(unassigned.rows.every((r) => r.assignedTo === null)).toBe(true);
    const mineOverdue = await as("sales", (tx) => listSalesSection(tx, "overdue", { assignee: world.partnerId, limit: 50 }));
    expect(mineOverdue.rows.map((r) => r.id)).not.toContain(theirs.id);
    const teamOverdue = await as("owner", (tx) => listSalesSection(tx, "overdue", { limit: 50 }));
    expect(teamOverdue.rows.map((r) => r.id)).toContain(theirs.id);
    // The sales default scope: mine PLUS unassigned.
    const withPool = await as("sales", (tx) => listSalesSection(tx, "never_contacted", { assignee: world.partnerId, includeUnassigned: true, limit: 50 }));
    expect(withPool.rows.map((r) => r.id)).toContain(free.id);
  }, 60_000);

  it("never contacted and recently contacted are what they say", async () => {
    const fresh = await seedProspect({ assignedTo: world.partnerId, name: "Zz Fresh" });
    expect((await as("sales", (tx) => listSalesSection(tx, "never_contacted", { assignee: world.partnerId, limit: 50 }))).rows.map((r) => r.id)).toContain(fresh.id);
    await save("sales", { prospect: fresh.id, contact: { outcome: "spoke", channel: "call" } });
    const never = await as("sales", (tx) => listSalesSection(tx, "never_contacted", { assignee: world.partnerId, limit: 50 }));
    expect(never.rows.map((r) => r.id)).not.toContain(fresh.id);
    const recent = await as("sales", (tx) => listSalesSection(tx, "recently_contacted", { assignee: world.partnerId, limit: 50 }));
    expect(recent.rows.map((r) => r.id)).toContain(fresh.id);
    const old = await seedProspect({ assignedTo: world.partnerId, name: "Zz Stale" });
    await save("owner", { prospect: old.id, contact: { outcome: "spoke", channel: "call", happenedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() } });
    expect((await as("sales", (tx) => listSalesSection(tx, "recently_contacted", { assignee: world.partnerId, limit: 50 }))).rows.map((r) => r.id)).not.toContain(old.id);
  }, 60_000);
});

describe("filters, sorts and keyset pages", () => {
  it("name search is a prefix, stage filters, and pages do not repeat or skip rows", async () => {
    await seedProspect({ name: "Findable Bakery" });
    await seedProspect({ name: "Findable Tile" });
    await seedProspect({ name: "Unfindable Roofing" });
    const found = await as("owner", (tx) => listSalesQueue(tx, { search: "findable", limit: 50 }));
    expect(found.rows.map((r) => r.name).sort()).toEqual(["Findable Bakery", "Findable Tile"]);
    expect((await as("owner", (tx) => listSalesQueue(tx, { search: "find%", limit: 50 }))).rows).toHaveLength(0);

    const seen: string[] = [];
    let cursor = undefined as { key: string; id: string } | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await as("owner", (tx) => listSalesQueue(tx, { limit: 5, after: cursor }));
      seen.push(...r.rows.map((x) => x.id));
      if (!r.next) break;
      cursor = r.next;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const all = await as("owner", (tx) => listSalesQueue(tx, { limit: QUEUE_PAGE_MAX }));
    expect(new Set(seen)).toEqual(new Set(all.rows.map((r) => r.id)));
  }, 120_000);

  it("sorting by due puts the soonest first, and by last contact the freshest first", async () => {
    const byDue = await as("owner", (tx) => listSalesQueue(tx, { dueState: "overdue", sort: "due", limit: 50 }));
    const dues = byDue.rows.map((r) => r.openFollowUp!.dueOn);
    expect([...dues].sort()).toEqual(dues);
    const byContact = await as("owner", (tx) => listSalesQueue(tx, { sort: "last_contact", limit: 50 }));
    const dated = byContact.rows.filter((r) => r.lastContact).map((r) => r.lastContact!);
    expect([...dated].sort().reverse()).toEqual(dated);
  }, 60_000);
});

describe("the shapes a screen receives", () => {
  it("every summary read returns exactly its agreed fields — widening one is a decision, not a diff", async () => {
    const p = await seedProspect({ assignedTo: world.partnerId });
    await save("sales", { prospect: p.id, contact: { outcome: "spoke", channel: "call", note: "prose" }, followUp: { schedule: { action: "call", dueOn: (await followUpDay(2)) } } });
    const [row] = (await as("owner", (tx) => listSalesQueue(tx, { limit: QUEUE_PAGE_MAX }))).rows.filter((r) => r.id === p.id);
    expect(Object.keys(row).sort()).toEqual(
      ["anchor", "assignedTo", "dueState", "firstContact", "id", "lastContact", "latestContact", "name", "openFollowUp", "slug", "status"]);
    expect(Object.keys(row.latestContact!).sort()).toEqual(["channel", "happenedAt", "outcome"]);
    expect(Object.keys(row.openFollowUp!).sort()).toEqual(["action", "assignee", "dueAt", "dueOn", "followupId"]);
    // A queue row carries NO prose: notes live on the timeline.
    expect(JSON.stringify(row)).not.toContain("prose");
    const summary = await as("owner", (tx) => getProspectActionSummary(tx, p.id));
    expect(Object.keys(summary!).sort()).toEqual(
      ["anchor", "archived", "assignedTo", "contacts", "dueState", "firstContact", "held", "id", "lastContact",
       "latestContact", "name", "openFollowUp", "slug", "status", "transitions"]);
  }, 60_000);
});

async function followUpDay(offset: number): Promise<string> {
  const { rows } = await pg.query<{ d: string }>(
    "SELECT ((now() AT TIME ZONE 'America/Los_Angeles')::date + $1::int)::text AS d", [offset]);
  return rows[0].d;
}

describe("the timeline", () => {
  it("merges contacts, stage changes, follow-ups, notes and only the events with no table of their own", async () => {
    const p = await seedProspect({ status: "lead", assignedTo: world.partnerId });
    const anchor = (await pg.query<{ a: string }>("SELECT prospect_id::text AS a FROM prospects WHERE id = $1", [p.id])).rows[0].a;
    await save("sales", { prospect: p.id, expectedStage: "lead", contact: { outcome: "spoke", channel: "call", note: "said call back" },
      stage: { to: "contacted" }, followUp: { schedule: { action: "call", dueOn: await followUpDay(3) } } });
    await pg.query(
      `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body)
       VALUES (gen_random_uuid(), $1, $2, $3, 'a standalone note')`, [world.organizationId, p.id, world.ownerId]);
    await pg.query(
      `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id, subject_entity, subject_entity_id, data)
       VALUES (gen_random_uuid(), $1, 'prospect.created', now() - interval '1 day', 'system', NULL, 'prospect', $2, '{}'::jsonb)`,
      [world.organizationId, anchor]);

    const timeline = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id, anchor }, { limit: 50 }));
    expect(timeline.map((e) => e.kind)).toEqual(["note", "followup", "stage", "contact", "event"]);
    const contact = timeline.find((e) => e.kind === "contact")!;
    expect(contact).toMatchObject({ outcome: "spoke", channel: "call", note: "said call back", actorName: "Partner" });
    expect(timeline.find((e) => e.kind === "event")).toMatchObject({ type: "prospect.created", actorName: null });
    // The events a table already represents are NOT repeated: one fact, one entry.
    expect(timeline.filter((e) => e.kind === "event")).toHaveLength(1);
    expect(JSON.stringify(timeline).match(/said call back/g)).toHaveLength(1);
    expect(timeline.find((e) => e.kind === "note")).toMatchObject({ body: "a standalone note", actorName: "Owner" });
  }, 60_000);

  it("pages newest-first with `before`, and is bounded", async () => {
    const p = await seedProspect();
    for (let i = 0; i < 4; i++) await save("owner", { prospect: p.id, contact: { outcome: "no_answer", channel: "call", happenedAt: new Date(Date.now() - i * 86_400_000).toISOString() } });
    const first = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 2 }));
    expect(first).toHaveLength(2);
    const next = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 10, before: first[1].at }));
    expect(next.length).toBeGreaterThan(0);
    expect(next.map((e) => e.id)).not.toContain(first[0].id);
    expect(new Date(next[0].at).getTime()).toBeLessThan(new Date(first[1].at).getTime());
    const capped = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 9_999 }));
    expect(capped.length).toBeLessThanOrEqual(QUEUE_PAGE_MAX);
  }, 60_000);

  it("a sales principal sees the same rows as the owner — RLS scopes by organization, not by assignee", async () => {
    const p = await seedProspect({ assignedTo: sales2 });
    await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call" } });
    const asOwner = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }));
    const asSales = await as("sales", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }));
    expect(asSales.map((e) => e.id)).toEqual(asOwner.map((e) => e.id));
  }, 60_000);
});

describe("sections a screen asks for by name", () => {
  it("every section name is implemented and bounded by its default", async () => {
    for (const section of ["overdue", "due_today", "unassigned", "never_contacted", "recently_contacted"] as SalesSection[]) {
      const r = await as("owner", (tx) => listSalesSection(tx, section));
      expect(r.rows.length, section).toBeLessThanOrEqual(SECTION_DEFAULTS[section]);
      expect(r.total, section).toBeGreaterThanOrEqual(r.rows.length);
    }
  }, 60_000);
});
