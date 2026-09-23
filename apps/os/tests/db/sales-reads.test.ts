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
import { asPrincipal, findProspectByRef, listProspects, type SqlClient } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { executeSave, runSalesCommand } from "@/core/db/sales-actions";
import {
  QUEUE_PAGE_MAX, SECTION_DEFAULTS, getProspectActionSummary, getProspectTimeline, listMemberNames, listSalesQueue,
  listSalesSection, type SalesSection,
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

    const timeline = (await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id, anchor }, { limit: 50 }))).entries;
    expect(timeline.map((e) => e.kind)).toEqual(["note", "followup", "stage", "contact", "event"]);
    const contact = timeline.find((e) => e.kind === "contact")!;
    expect(contact).toMatchObject({ outcome: "spoke", channel: "call", note: "said call back", actorName: "Partner" });
    expect(timeline.find((e) => e.kind === "event")).toMatchObject({ type: "prospect.created", actorName: null });
    // The events a table already represents are NOT repeated: one fact, one entry.
    expect(timeline.filter((e) => e.kind === "event")).toHaveLength(1);
    expect(JSON.stringify(timeline).match(/said call back/g)).toHaveLength(1);
    expect(timeline.find((e) => e.kind === "note")).toMatchObject({ body: "a standalone note", actorName: "Owner" });
  }, 60_000);

  it("pages newest-first with an opaque cursor, and is bounded", async () => {
    const p = await seedProspect();
    for (let i = 0; i < 4; i++) await save("owner", { prospect: p.id, contact: { outcome: "no_answer", channel: "call", happenedAt: new Date(Date.now() - i * 86_400_000).toISOString() } });
    const first = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 2 }));
    expect(first.entries).toHaveLength(2);
    expect(first.next).toMatch(/^[A-Za-z0-9_-]+$/);
    const next = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 10, cursor: first.next }));
    expect(next.entries.map((e) => e.id)).toHaveLength(2);
    expect(next.next).toBeNull();
    expect(next.entries.map((e) => e.id)).not.toContain(first.entries[0].id);
    const capped = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 9_999 }));
    expect(capped.entries.length).toBeLessThanOrEqual(QUEUE_PAGE_MAX);
    // A cursor this module did not write is not a cursor: the read starts at the top.
    for (const bad of ["garbage", Buffer.from('{"a":"x","r":9,"i":"y"}').toString("base64url"), "a".repeat(500)]) {
      const r = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 2, cursor: bad }));
      expect(r.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    }
  }, 60_000);

  it("PAGE BOUNDARY — entries sharing one timestamp are neither skipped nor repeated, at every page size", async () => {
    // One real command writes contact + stage + follow-up in ONE transaction, so all three share an
    // instant T. Three notes are placed at exactly T as well, 46 newer entries above them and 10 older
    // below: 62 entries, six of them tied. A timestamp-only cursor loses whatever tied entries fall
    // after the boundary; every page size from 44 to 56 slides the boundary through all six.
    const p = await seedProspect({ status: "lead", assignedTo: world.partnerId });
    await save("sales", { prospect: p.id, expectedStage: "lead", contact: { outcome: "spoke", channel: "call" },
      stage: { to: "contacted" }, followUp: { schedule: { action: "call", dueOn: await followUpDay(2) } } });
    const T = (await pg.query<{ t: string }>("SELECT recorded_at::text AS t FROM prospect_stage_transitions WHERE prospect = $1", [p.id])).rows[0].t;
    const tied = (await pg.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM prospect_contacts WHERE prospect = $1 AND happened_at = $2::timestamptz)
            + (SELECT count(*) FROM prospect_followups WHERE prospect = $1 AND created_at = $2::timestamptz) AS n`, [p.id, T])).rows[0].n;
    expect(Number(tied), "the command's contact and follow-up share the stage row's instant").toBe(2);
    const note = (at: string) => pg.query(
      `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'n', ${at})`, [world.organizationId, p.id, world.ownerId]);
    for (let i = 1; i <= 46; i++) await note(`'${T}'::timestamptz + interval '${i} seconds'`);
    for (let i = 0; i < 3; i++) await note(`'${T}'::timestamptz`);
    for (let i = 1; i <= 10; i++) await note(`'${T}'::timestamptz - interval '${i} minutes'`);

    const all = (await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 200 }))).entries;
    expect(all).toHaveLength(62);
    const key = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`;
    expect(new Set(all.map(key)).size).toBe(62);
    // Within the tie: notes, then follow-up → stage → contact (newest-first reverses the write order).
    const tiedKinds = all.slice(46, 52).map((e) => e.kind);
    expect(tiedKinds).toEqual(["note", "note", "note", "followup", "stage", "contact"]);

    for (let size = 44; size <= 56; size++) {
      const walked: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Awaited<ReturnType<typeof getProspectTimeline>> =
          await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: size, cursor }));
        walked.push(...page.entries.map(key));
        cursor = page.next;
        pages++;
      } while (cursor && pages < 10);
      expect(walked, `page size ${size}`).toEqual(all.map(key));
    }

    // An entry written AFTER page 1 was read does not disturb page 2 — it is newer than the cursor.
    const p1 = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 50 }));
    await note("now() + interval '1 hour'");
    const p2 = await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }, { limit: 50, cursor: p1.next }));
    expect([...p1.entries, ...p2.entries].map(key)).toEqual(all.map(key));
    expect(p2.next).toBeNull();
  }, 120_000);

  it("a sales principal sees the same rows as the owner — RLS scopes by organization, not by assignee", async () => {
    const p = await seedProspect({ assignedTo: sales2 });
    await save("owner", { prospect: p.id, contact: { outcome: "spoke", channel: "call" } });
    const asOwner = (await as("owner", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }))).entries;
    const asSales = (await as("sales", (tx) => getProspectTimeline(tx, { prospectRowId: p.id }))).entries;
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

describe("member names (2A.2b) — read once, server-side, scoped to the organization", () => {
  it("returns the viewer and an id → name map of THIS organization only, including disabled members", async () => {
    const other = await seedOperationalWorld(db, { orgSlug: "other-org", ownerEmail: "o@other.test", partnerEmail: "s@other.test" });
    await pg.query("UPDATE users SET disabled_at = now() WHERE id = $1", [sales2]);
    try {
      const dir = await as("sales", (tx) => listMemberNames(tx));
      expect(dir.viewer).toBe(world.partnerId);
      expect(Object.keys(dir.names).sort()).toEqual([world.ownerId, world.partnerId, sales2].sort());
      // A disabled member still authored history, so still has a name.
      expect(dir.names[sales2]).toBe("Sales Two");
      // Another organization's people are not in the map (the read is scoped to `current_org()`).
      expect(dir.names).not.toHaveProperty(other.ownerId);
      // Only a display string travels: never an email address.
      for (const name of Object.values(dir.names)) expect(name).not.toMatch(/@/);
      const ownerView = await as("owner", (tx) => listMemberNames(tx));
      expect(ownerView.viewer).toBe(world.ownerId);
    } finally {
      await pg.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [sales2]);
    }
  }, 60_000);
});

describe("the detail page's single-prospect lookup (2A.2b) — the list scan's answer, one row read", () => {
  it("returns exactly what `listProspects(includeArchived).find(slug ?? id)` returned, for every kind of reference", async () => {
    const active = await seedProspect({ name: "Lookup Active" });
    const archived = await seedProspect({ name: "Lookup Archived", archived: true });
    const held = await seedProspect({ name: "Lookup Held", held: true });
    await pg.query("UPDATE prospects SET slug = 'lookup-active' WHERE id = $1", [active.id]);
    await pg.query("UPDATE prospects SET slug = 'lookup-archived' WHERE id = $1", [archived.id]);
    // No unique constraint on slug: two rows can share one. The rule is the list's order, first wins.
    // Three duplicates whose ids are chosen so the NAME order picks the MIDDLE id: neither an
    // id-ascending nor an id-descending read can agree with it by accident.
    const MID = "80000000-0000-4000-8000-000000000001", LOW = "00000000-0000-4000-8000-000000000001", HIGH = "ffffffff-0000-4000-8000-000000000001";
    // Written in REVERSE name order, so heap order (what an unordered read returns) disagrees too.
    for (const [name, id] of [["Lookup Dup C", HIGH], ["Lookup Dup B", LOW], ["Lookup Dup A", MID]]) {
      const d = await seedProspect({ name });
      await pg.query("UPDATE prospects SET id = $2, slug = 'lookup-dup' WHERE id = $1", [d.id, id]);
    }
    const scan = async (ref: string) => as("owner", async (tx) =>
      (await listProspects(tx, { includeArchived: true })).find((r) => (r.slug ?? r.id) === ref) ?? null);
    const one = (ref: string) => as("owner", (tx) => findProspectByRef(tx, ref));
    for (const ref of ["lookup-active", "lookup-archived", held.id, "lookup-dup", "no-such-prospect", active.id]) {
      expect(await one(ref), ref).toEqual(await scan(ref));
    }
    expect((await one("lookup-archived"))!.archivedAt).not.toBeNull();       // archived stays distinguishable
    expect((await one(held.id))!.identityState).toBe("held");                // addressed by id: it has no slug
    expect((await one("lookup-dup"))!.id).toBe(MID);                         // "Lookup Dup A" sorts first
    expect(await one(active.id)).toBeNull();                                 // a row WITH a slug has no id address
  }, 60_000);
});
