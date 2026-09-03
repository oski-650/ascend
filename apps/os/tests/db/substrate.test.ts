// Layer A — STAGE 2A ACCEPTANCE GATES, against real Postgres.
//
// The Stage 2A claim is narrow and testable: rules that Stages 0.5 and 1 enforced with application
// code and source-text rules are now enforced by the DATABASE, and therefore hold against a caller
// that never read this repository. These gates try to violate each one directly.
//
// THE TWO THAT MATTER MOST, both mutation-tested in ./mutation.test.ts:
//   held prospect + corroborating signals → BLOCKED, never a miss
//   absence → unknown, never a value

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import { freshDb, type TestDb } from "./pglite";
import {
  addMembership, appendEvent, asPrincipal, assessWebsiteOpportunity, countOperatorBusinessEvents,
  createOrganization, createProspect, createUser, findCorroborating, listHeldProspects,
  listProspects, membershipFor, readEvents,
} from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";
import { newProspectId } from "@/domain";

let db: TestDb;
let org: OrganizationId;
let owner: UserId;
let partner: UserId;

/**
 * `planSubstrateMigration` reads the EVENT SPINE, which since the per-domain visibility model
 * resolves its caller and fails closed. This suite therefore declares one — the boundary working,
 * not an obstacle: administrative tooling runs under an operator in production too.
 *
 * Bound at file scope rather than inside the plan call, because the migration reads the spine from
 * several entry points and a per-call wrapper would be four places to forget.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  db = await freshDb();
  org = await createOrganization(db.client, "ascend", "Ascend Web Solutions");
  owner = await createUser(db.client, "oscar@ascend.test", "Oscar");
  partner = await createUser(db.client, "partner@ascend.test", "Partner");
  await addMembership(db.client, owner, org, "owner");
  await addMembership(db.client, partner, org, "sales");
});
afterEach(async () => db.close());

const asOwner = <T>(fn: Parameters<typeof asPrincipal<T>>[2]) =>
  asPrincipal(db.client, __unsafePrincipalForTests("owner", org, owner), fn);
const asSales = <T>(fn: Parameters<typeof asPrincipal<T>>[2]) =>
  asPrincipal(db.client, __unsafePrincipalForTests("sales", org, partner), fn);
const asAutomation = <T>(fn: Parameters<typeof asPrincipal<T>>[2]) =>
  asPrincipal(db.client, { role: "automation", organizationId: org, userId: null }, fn);

// ═══ Identity ══════════════════════════════════════════════════════════════════════════════════

describe("identity — Stage 1's semantics are now constraints", () => {
  it("an anchored prospect has an identity; a held one has none and states why", async () => {
    const [anchored, held] = await asOwner(async (tx) => [
      await createProspect(tx, org, { name: "Alpha" }, { kind: "system" }),
      await createProspect(tx, org, { name: "Tapia A", hold: { reason: "duplicate of Tapia B" } }, { kind: "system" }),
    ]);
    expect(anchored.identityState).toBe("anchored");
    expect(anchored.prospectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(held.identityState).toBe("held");
    expect(held.prospectId).toBeNull();
    expect(held.holdReason).toContain("duplicate");
  });

  it("the database REFUSES an anchored row with no identity", async () => {
    await expect(
      db.client.query(
        `INSERT INTO prospects (organization_id, identity_state) VALUES ($1,'anchored')`, [org]
      )
    ).rejects.toThrow(/anchored_iff_identified/);
  });

  it("the database REFUSES a held row with no stated reason", async () => {
    await expect(
      db.client.query(
        `INSERT INTO prospects (organization_id, identity_state, prospect_id)
         VALUES ($1,'held',NULL)`, [org]
      )
    ).rejects.toThrow(/held_states_its_reason/);
  });

  it("two prospects cannot claim one identity — and it is an INDEX, not a scan", async () => {
    const id = newProspectId();
    await asOwner((tx) => createProspect(tx, org, { name: "First", prospectId: id }, { kind: "system" }));
    await expect(
      asOwner((tx) => createProspect(tx, org, { name: "Second", prospectId: id }, { kind: "system" }))
    ).rejects.toThrow(/unique|duplicate key/i);
  });

  it("MANY prospects may share the absence of an identity", async () => {
    await asOwner(async (tx) => {
      for (const n of ["A", "B", "C"]) {
        await createProspect(tx, org, { name: n, hold: { reason: "unresolved duplicate" } }, { kind: "system" });
      }
    });
    const held = await asOwner((tx) => listHeldProspects(tx));
    expect(held).toHaveLength(3);
    expect(held.every((h) => h.prospectId === null)).toBe(true);
  });

  it("the surrogate key is NOT the identity — they are different values", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    expect(p.id).not.toBe(p.prospectId);
  });
});

// ═══ The hold as a write barrier ═══════════════════════════════════════════════════════════════

describe("a hold is a WRITE barrier, not an information barrier", () => {
  async function seedHeldPair() {
    return asOwner(async (tx) => {
      for (const name of ["Tapia Tile & Marble Co.", "Tile & Marble Installation in Bay Area"]) {
        await createProspect(tx, org, {
          name, website: "https://tapiatilemarbleco.com/", contactPhone: "+16503648038",
          contactEmail: "tapiatileandmarble@gmail.com",
          hold: { reason: "same business, recorded twice; human decision required" },
        }, { kind: "system" });
      }
    });
  }

  it("THE P4 GATE: held prospects are VISIBLE to corroboration", async () => {
    await seedHeldPair();
    const hits = await asAutomation((tx) =>
      findCorroborating(tx, { website: "https://tapiatilemarbleco.com/", phone: "+16503648038" })
    );
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.identityState === "held")).toBe(true);
  });

  it("sales can read held prospects too — a blocker nobody can see blocks nothing", async () => {
    await seedHeldPair();
    expect(await asSales((tx) => listHeldProspects(tx))).toHaveLength(2);
  });

  it("THE P3 GATE: automation cannot UPDATE a held prospect", async () => {
    await seedHeldPair();
    const affected = await asAutomation(async (tx) => {
      const r = await tx.query(`UPDATE prospects SET website = 'https://hijacked.test' WHERE identity_state = 'held'`);
      return r.affected;
    });
    expect(affected).toBe(0);
    const after = await asOwner((tx) => listHeldProspects(tx));
    expect(after.every((p) => p.website === "https://tapiatilemarbleco.com/")).toBe(true);
  });

  it("sales cannot UPDATE a held prospect either", async () => {
    await seedHeldPair();
    const affected = await asSales(async (tx) => {
      const r = await tx.query(`UPDATE prospects SET status = 'contacted' WHERE identity_state = 'held'`);
      return r.affected;
    });
    expect(affected).toBe(0);
  });

  it("automation cannot move a row INTO held to escape the barrier, nor out of it", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await expect(
      asAutomation((tx) =>
        tx.query(`UPDATE prospects SET identity_state='held', hold_reason='x', prospect_id=NULL WHERE id=$1`, [p.id])
      )
    // TWO independent mechanisms refuse this, and the column grant fires FIRST: `identity_state`,
    // `hold_reason` and `prospect_id` are absent from automation's UPDATE grant, so the statement is
    // rejected before row-level security is even evaluated. Defence in depth, discovered by the test
    // rather than assumed by it — the original assertion expected only the RLS message.
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("only the owner may release a hold", async () => {
    await seedHeldPair();
    const released = await asOwner(async (tx) => {
      const r = await tx.query(
        `UPDATE prospects SET identity_state='anchored', hold_reason=NULL, prospect_id=$1
          WHERE identity_state='held' AND name LIKE 'Tapia%'`, [newProspectId()]
      );
      return r.affected;
    });
    expect(released).toBe(1);
  });
});

// ═══ Human judgment ════════════════════════════════════════════════════════════════════════════

describe("human judgment has no automated writer", () => {
  it("automation holds NO grant on website_opportunity", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await expect(
      asAutomation((tx) => tx.query(`UPDATE prospects SET website_opportunity='green' WHERE id=$1`, [p.id]))
    ).rejects.toThrow(/permission denied|column/i);
  });

  it("automation CAN write research-owned columns — the rule is targeted, not blanket", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    const affected = await asAutomation(async (tx) =>
      (await tx.query(`UPDATE prospects SET website='https://found.test' WHERE id=$1`, [p.id])).affected
    );
    expect(affected).toBe(1);
  });

  it("a human assessment records its author and time, and emits an operator event", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await asSales((tx) => assessWebsiteOpportunity(tx, org, p.id, "green", partner));

    const [row] = await asOwner((tx) => listProspects(tx));
    expect(row.websiteOpportunity).toBe("green");
    const events = await asOwner((tx) => readEvents(tx, { types: ["prospect.assessed"] }));
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("operator");
    expect(events[0].actor_user_id).toBe(partner);
  });

  it("an assessment with no author is impossible", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await expect(
      db.client.query(`UPDATE prospects SET website_opportunity='red' WHERE id=$1`, [p.id])
    ).rejects.toThrow(/assessment_has_provenance/);
  });
});

// ═══ Events and §19 ════════════════════════════════════════════════════════════════════════════

describe("event spine — provenance and the §19 boundary", () => {
  it("an operator event MUST name its human", async () => {
    await expect(
      db.client.query(
        `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, subject_entity, subject_entity_id)
         VALUES (gen_random_uuid(), $1, 'prospect.created', now(), 'operator', 'prospect', 'x')`, [org]
      )
    ).rejects.toThrow(/operator_events_name_their_human/);
  });

  it("a system event may NOT claim a human caused it", async () => {
    await expect(
      db.client.query(
        `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                             subject_entity, subject_entity_id)
         VALUES (gen_random_uuid(), $1, 'prospect.created', now(), 'system', $2, 'prospect', 'x')`,
        [org, owner]
      )
    ).rejects.toThrow(/system_events_name_no_human/);
  });

  it("THE §19 GATE: a bulk system import adds ZERO operator events for either human", async () => {
    await asAutomation(async (tx) => {
      for (let i = 0; i < 50; i++) await createProspect(tx, org, { name: `Bulk ${i}` }, { kind: "system" });
    });
    const all = await asOwner((tx) => readEvents(tx));
    expect(all).toHaveLength(50);
    expect(all.every((e) => e.actor === "system")).toBe(true);
    expect(await asOwner((tx) => countOperatorBusinessEvents(tx, owner))).toBe(0);
    expect(await asOwner((tx) => countOperatorBusinessEvents(tx, partner))).toBe(0);
  });

  it("the partner's activity does not count toward the OWNER's §19 measurement", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await asSales((tx) => assessWebsiteOpportunity(tx, org, p.id, "yellow", partner));

    expect(await asOwner((tx) => countOperatorBusinessEvents(tx, owner))).toBe(0);
    expect(await asOwner((tx) => countOperatorBusinessEvents(tx, partner))).toBe(1);
  });

  it("events are append-only — UPDATE and DELETE both raise", async () => {
    await asOwner((tx) => createProspect(tx, org, { name: "Alpha" }, { kind: "system" }));
    await expect(db.client.query(`UPDATE events SET type='tampered'`)).rejects.toThrow(/append-only/);
    await expect(db.client.query(`DELETE FROM events`)).rejects.toThrow(/append-only/);
  });

  it("ordering comes from seq, and event_id orders nothing", async () => {
    const when = "2026-08-27T12:00:00.000Z";
    await asOwner(async (tx) => {
      for (let i = 0; i < 10; i++) {
        await appendEvent(tx, org, {
          type: "document.status_changed", occurred_at: when, actor: "system",
          subject: { entity: "document", entity_id: "collision" }, data: { i },
        });
      }
    });
    const events = await asOwner((tx) => readEvents(tx, { entity_id: "collision" }));
    expect(events.map((e) => (e.data as { i: number }).i)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(events.every((e) => e.occurred_at === when)).toBe(true);
  });

  it("a prospect and its birth event commit together, or neither does", async () => {
    await expect(
      asOwner(async (tx) => {
        await createProspect(tx, org, { name: "Doomed" }, { kind: "system" });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await asOwner((tx) => listProspects(tx))).toHaveLength(0);
    expect(await asOwner((tx) => readEvents(tx))).toHaveLength(0);
  });
});

// ═══ Isolation ═════════════════════════════════════════════════════════════════════════════════

describe("organization isolation is enforced below the application", () => {
  it("a second organization's prospects are invisible", async () => {
    const other = await createOrganization(db.client, "other", "Other Co");
    const stranger = await createUser(db.client, "x@other.test", "Stranger");
    await addMembership(db.client, stranger, other, "owner");

    await asOwner((tx) => createProspect(tx, org, { name: "Ours" }, { kind: "system" }));
    await asPrincipal(db.client, __unsafePrincipalForTests("owner", other, stranger),
      (tx) => createProspect(tx, other, { name: "Theirs" }, { kind: "system" }));

    expect((await asOwner((tx) => listProspects(tx))).map((p) => p.name)).toEqual(["Ours"]);
    const theirs = await asPrincipal(db.client, __unsafePrincipalForTests("owner", other, stranger),
      (tx) => listProspects(tx));
    expect(theirs.map((p) => p.name)).toEqual(["Theirs"]);
  });

  it("a caller with no org binding sees nothing — default deny", async () => {
    await asOwner((tx) => createProspect(tx, org, { name: "Ours" }, { kind: "system" }));
    const leaked = await db.client.transaction(async (tx) => {
      await tx.query("SELECT set_config('ascend.org_id','',true)");
      await tx.query("SET LOCAL ROLE ascend_owner");
      return listProspects(tx);
    });
    expect(leaked).toEqual([]);
  });

  it("membership is the authorization edge", async () => {
    expect(await membershipFor(db.client, owner, org)).toBe("owner");
    expect(await membershipFor(db.client, partner, org)).toBe("sales");
    const outsider = await createUser(db.client, "nobody@test", "Nobody");
    expect(await membershipFor(db.client, outsider, org)).toBeNull();
  });
});

// ═══ Absence ═══════════════════════════════════════════════════════════════════════════════════

describe("absence survives the move to SQL", () => {
  it("no column defaults to a claim", async () => {
    const p = await asOwner((tx) => createProspect(tx, org, { name: "Sparse" }, { kind: "system" }));
    expect(p.status).toBeNull();
    expect(p.websiteQuality).toBeNull();
    expect(p.website).toBeNull();
    expect(p.websiteOpportunity).toBeNull();
  });

  it("an empty website is not a website — and not a claim about one", async () => {
    await asOwner((tx) => createProspect(tx, org, { name: "Blank", website: null }, { kind: "system" }));
    const [row] = await asOwner((tx) => listProspects(tx));
    expect(row.website).toBeNull();
    expect(row.websiteQuality).toBeNull();
  });

  it("corroboration on nothing matches nothing", async () => {
    await asOwner((tx) => createProspect(tx, org, { name: "A", website: null, contactPhone: null }, { kind: "system" }));
    await asOwner((tx) => createProspect(tx, org, { name: "B", website: null, contactPhone: null }, { kind: "system" }));
    expect(await asOwner((tx) => findCorroborating(tx, { website: null, phone: null, email: null }))).toEqual([]);
  });
});
