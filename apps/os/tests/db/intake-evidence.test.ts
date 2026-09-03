// Layer A — 2B · THE SHEET SAID, APPENDED AND NEVER REWRITTEN (§1.2, §1.3, §7.3(c)/(d)).
//
// Against a REAL Postgres (PGlite, full migration set), not a stub: the properties under test are
// the SCHEMA's — append-only by grant, ordered by `seq` and not by `event_id`, correlated by
// `correlation_id` — and a stub would be measuring this file's own arithmetic instead.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import { freshDb, type TestDb } from "./pglite";
import { asPrincipal, createOrganization, createUser, addMembership } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { mintBatch, sourceRow, type ImportBatch } from "@/core/intake/batch";
import { recordBatch, recordSourceRow } from "@/core/intake/evidence";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;

const CSV = 'name,website\n  Acme  ,\n';

function batchFor(label: string, csv = CSV): ImportBatch {
  return mintBatch({
    csv, label, sourceKind: "csv_paste", sourceName: "paste",
    columnMap: { name: "name" }, rowCount: 1,
  });
}

/** Every intake event for this org, oldest first — the reader's own order, never re-sorted here. */
async function intakeEvents(tx: Parameters<typeof readEvents>[0]) {
  return readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] });
}

/**
 * The intake suites read the EVENT SPINE to verify their own evidence, and the spine now resolves
 * its caller and fails closed. Declaring one is the boundary working — a test is a caller like any
 * other. `owner` so the suite sees the whole corpus it wrote; a narrower principal would filter out
 * its own fixtures and go red for a reason unrelated to what it measures.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
});

afterEach(async () => { await handle.close(); });

describe("§1.2/§1.3 · one import produces evidence", () => {
  it("records the batch and every row, verbatim", async () => {
    const batch = batchFor("Batch One");
    const principal = __unsafePrincipalForTests("owner", org, owner);
    await asPrincipal(db, principal, async (tx) => {
      await recordBatch(tx, org, batch);
      await recordSourceRow(tx, org, sourceRow(batch, 0, { name: "  Acme  ", website: "" }));
    });

    const events = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["prospect.batch_imported", "prospect.row_received"]);

    const row = events[1].data as { cells: Record<string, string>; prospect_id: string | null };
    // THE VERBATIM PROPERTY, surviving a round trip through jsonb.
    expect(row.cells.name, "the whitespace the sheet had was lost in storage").toBe("  Acme  ");
    expect(row.cells.website, "an empty cell was dropped rather than stored").toBe("");
    expect(row.prospect_id, "a row claimed a prospect nothing created").toBeNull();
  });

  it("actor is `system`, and the schema forbids it naming a human (D-3)", async () => {
    const batch = batchFor("Batch One");
    const principal = __unsafePrincipalForTests("owner", org, owner);
    await asPrincipal(db, principal, (tx) => recordBatch(tx, org, batch));
    const [e] = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    expect(e.actor, "an import manufactured an operator-caused event").toBe("system");
    expect("actor_user_id" in e, "a system event named a human").toBe(false);
  });
});

describe("§7.3(d) · a SECOND import adds evidence and changes none of the first", () => {
  it("prior evidence is byte-identical after the second import", async () => {
    const principal = __unsafePrincipalForTests("owner", org, owner);
    const one = batchFor("Batch One");
    await asPrincipal(db, principal, async (tx) => {
      await recordBatch(tx, org, one);
      await recordSourceRow(tx, org, sourceRow(one, 0, { name: "  Acme  ", website: "" }));
    });
    const before = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    const snapshot = JSON.stringify(before);

    // Second import — SAME bytes, changed cell, to exercise both at once.
    const two = batchFor("Batch Two");
    await asPrincipal(db, principal, async (tx) => {
      await recordBatch(tx, org, two);
      await recordSourceRow(tx, org, sourceRow(two, 0, { name: "  Acme  ", website: "https://acme.example" }));
    });

    const after = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    expect(after.length, "the second import did not add evidence").toBe(4);
    // THE ANTI-OVERWRITE WITNESS: the first two events, compared whole, are unchanged.
    expect(JSON.stringify(after.slice(0, 2)), "the first import's evidence was modified")
      .toBe(snapshot);
    // And the second import genuinely said something different.
    const secondRow = after[3].data as { cells: Record<string, string> };
    expect(secondRow.cells.website).toBe("https://acme.example");
  });

  it("correlation_id distinguishes the batches, and each row belongs to exactly one", async () => {
    const principal = __unsafePrincipalForTests("owner", org, owner);
    const one = batchFor("Batch One");
    const two = batchFor("Batch Two");
    await asPrincipal(db, principal, async (tx) => {
      await recordBatch(tx, org, one);
      await recordSourceRow(tx, org, sourceRow(one, 0, { name: "A" }));
      await recordBatch(tx, org, two);
      await recordSourceRow(tx, org, sourceRow(two, 0, { name: "A" }));
    });

    const events = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    const byBatch = new Map<string, number>();
    for (const e of events) byBatch.set(e.correlation_id!, (byBatch.get(e.correlation_id!) ?? 0) + 1);

    expect(one.batch_id).not.toBe(two.batch_id);
    expect(byBatch.get(one.batch_id), "batch one lost an event").toBe(2);
    expect(byBatch.get(two.batch_id), "batch two lost an event").toBe(2);
    // Same bytes, same hash — §1.2's "a fact worth recording, not a duplicate to suppress".
    expect(one.file_sha256).toBe(two.file_sha256);
  });
});

describe("§7.3(c) · the guarantees are the SCHEMA's, not this module's", () => {
  it("no application role can UPDATE or DELETE an event — append-only is a GRANT", async () => {
    // The property §7.3(c) chose the event spine FOR. Asserted at the catalog rather than by the
    // absence of an update function in the source, which would prove only that nobody wrote one.
    const { rows } = await db.query<{ privilege_type: string; grantee: string }>(
      `SELECT grantee, privilege_type FROM information_schema.table_privileges
        WHERE table_name = 'events' AND grantee LIKE 'ascend_%'`);
    const bad = rows.filter((r) => r.privilege_type === "UPDATE" || r.privilege_type === "DELETE");
    expect(bad, "an application role can rewrite history").toEqual([]);
    expect(rows.some((r) => r.privilege_type === "INSERT"), "nothing can append at all").toBe(true);
  });

  it("ORDER COMES FROM seq, NOT FROM event_id — proven with ids that contradict it", async () => {
    // The lesson event-emission.test.ts cost a session to learn, applied here rather than repeated:
    // an assertion that the ids "happen to be unsorted" measures clock speed. This CONSTRUCTS the
    // contradiction — three events whose event_ids DESCEND — so if the reader ever ordered by id,
    // the sequence comes back reversed, on every run and every machine.
    const principal = __unsafePrincipalForTests("owner", org, owner);
    const batch = batchFor("Ordering");
    const ids = ["eeee", "cccc", "aaaa"].map((p) => `${p}eeee-1111-7111-8111-111111111111`);
    await asPrincipal(db, principal, async (tx) => {
      for (const [i, event_id] of ids.entries()) {
        await tx.query(
          `INSERT INTO events (event_id, organization_id, type, occurred_at, actor,
                               subject_entity, subject_entity_id, data, correlation_id)
           VALUES ($1::uuid, $2::uuid, 'prospect.row_received', '2026-08-15T12:00:00Z', 'system',
                   'organization', $2::text, $3::jsonb, $4)`,
          [event_id, org, JSON.stringify({ row_index: i }), batch.batch_id]);
      }
    });

    const events = await asPrincipal(db, principal, (tx) => intakeEvents(tx));
    const order = events.map((e) => (e.data as { row_index: number }).row_index);
    const byId = [...events].sort((a, b) => a.event_id.localeCompare(b.event_id))
      .map((e) => (e.data as { row_index: number }).row_index);

    expect(byId, "the ids do not contradict append order — this witness is not discriminating")
      .toEqual([2, 1, 0]);
    expect(order, "readEvents ordered by event_id instead of seq").toEqual([0, 1, 2]);
  });
});
