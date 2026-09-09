// 008 · THE OPERATOR'S NOTE LOG, against a real Postgres.
//
// The subject is not "can a note be saved". It is the set of things 008 claims are IMPOSSIBLE, each
// asserted with a control that proves the test could have gone the other way:
//
//   automation may not write here          ← and a sales principal CAN, in the same suite
//   a note may not be edited by either app role ← and it can be deleted by an owner
//   sales may not sign a note as a colleague
//   a blank note is not a note
//   one organization cannot read another's notes
//
// Every one of those is enforced by a GRANT or a POLICY rather than by application code, so each
// test drives the real role through `asPrincipal` instead of calling a function that could be
// changed to check something else tomorrow.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import {
  addProspectNote, asPrincipal, createOrganization, createProspect, createUser, addMembership,
  deleteProspectNote, findProspectRef, listProspectNotes,
} from "@/core/db";
import { readEvents } from "@/core/db/events";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { registerAuthorityResolver, clearAuthorityResolver } from "@/core/auth/authority";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;
let partner: UserId;
let prospectRow: string;

const asOwner = () => __unsafePrincipalForTests("owner", org, owner);
const asSales = (who: UserId = partner) => __unsafePrincipalForTests("sales", org, who);
const asAutomation = () => ({ role: "automation" as const, organizationId: org, userId: null });

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  partner = await createUser(db, "partner@test", "Partner");
  await addMembership(db, owner, org, "owner");
  await addMembership(db, partner, org, "sales");
  const p = await createProspect(db, org, { name: "Valley Roofing" }, { kind: "system" });
  prospectRow = p.id;

  // `readEvents` resolves its OWN caller — the spine fails closed rather than trusting whoever
  // holds the connection. Bound to THIS suite's owner rather than the shared fixture principal, so
  // the resolved organization matches the one RLS is scoped to.
  registerAuthorityResolver(async () => ({ ok: true, principal: asOwner() }));
});
afterEach(async () => { clearAuthorityResolver(); await handle.close(); });

describe("appending and reading", () => {
  it("records the note, its author and its time", async () => {
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "Spoke to Mia — wants a quote.", authorUserId: partner })
    );
    expect(note.body).toBe("Spoke to Mia — wants a quote.");
    expect(note.authorUserId).toBe(partner);
    expect(note.createdAt).toBeTruthy();

    const log = await asPrincipal(db, asSales(), (tx) => listProspectNotes(tx, prospectRow));
    expect(log).toHaveLength(1);
    expect(log[0].authorName, "the log does not name its author").toBe("Partner");
  });

  it("returns the log newest first", async () => {
    for (const body of ["first", "second", "third"]) {
      await asPrincipal(db, asSales(), (tx) =>
        addProspectNote(tx, org, { prospect: prospectRow, body, authorUserId: partner }));
    }
    const log = await asPrincipal(db, asSales(), (tx) => listProspectNotes(tx, prospectRow));
    expect(log.map((n) => n.body)).toEqual(["third", "second", "first"]);
  });

  it("trims the body rather than storing it padded", async () => {
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "  padded  ", authorUserId: partner }));
    expect(note.body).toBe("padded");
  });

  it("emits prospect.note_added as an OPERATOR event, carrying no prose", async () => {
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "confidential detail", authorUserId: partner }));

    const events = await asPrincipal(db, asOwner(), (tx) =>
      readEvents(tx, { types: ["prospect.note_added"] }));
    expect(events).toHaveLength(1);
    // A note is a person writing prose — the one thing in this pipeline that is genuinely
    // operator-caused, unlike import and research which are `system`.
    expect(events[0].actor).toBe("operator");
    expect(events[0].actor_user_id).toBe(partner);
    expect(events[0].data).toEqual({ note_id: note.noteId });
    // The text stays OUT of the append-only spine, so deleting a note does not leave a copy behind.
    expect(JSON.stringify(events[0])).not.toContain("confidential detail");
  });
});

describe("what 008 makes impossible", () => {
  it("AUTOMATION HOLDS NO GRANT — it cannot append, and sales can, in the same suite", async () => {
    await expect(
      asPrincipal(db, asAutomation(), (tx) =>
        addProspectNote(tx, org, { prospect: prospectRow, body: "machine prose", authorUserId: partner }))
    ).rejects.toThrow();

    // THE CONTROL. Without it, a suite-wide breakage would read as this rule holding.
    await expect(
      asPrincipal(db, asSales(), (tx) =>
        addProspectNote(tx, org, { prospect: prospectRow, body: "human prose", authorUserId: partner }))
    ).resolves.toBeTruthy();
  });

  it("automation cannot even READ the operator's voice", async () => {
    await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "our read on this lead", authorUserId: partner }));
    await expect(
      asPrincipal(db, asAutomation(), (tx) => listProspectNotes(tx, prospectRow))
    ).rejects.toThrow();
  });

  it("NEITHER APPLICATION ROLE may edit a note — no UPDATE grant is issued to one", async () => {
    // Scoped to the roles the application connects as, deliberately. On the deployed Supabase
    // project `anon`/`authenticated`/`service_role` hold blanket UPDATE on every public table from
    // that project's default privileges — as they do on `prospects` and `events` — so the
    // unqualified claim would be false. See the note in core/db/prospect-notes.
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "as written", authorUserId: partner }));

    for (const principal of [asOwner(), asSales()]) {
      await expect(
        asPrincipal(db, principal, (tx) =>
          tx.query(`UPDATE prospect_notes SET body = 'rewritten' WHERE note_id = $1`, [note.noteId]))
      ).rejects.toThrow();
    }
    const log = await asPrincipal(db, asSales(), (tx) => listProspectNotes(tx, prospectRow));
    expect(log[0].body).toBe("as written");
  });

  it("the OWNER may delete a note; sales may not", async () => {
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "typo", authorUserId: partner }));

    await expect(
      asPrincipal(db, asSales(), (tx) => deleteProspectNote(tx, note.noteId))
    ).rejects.toThrow();

    await expect(
      asPrincipal(db, asOwner(), (tx) => deleteProspectNote(tx, note.noteId))
    ).resolves.toBe(true);
    expect(await asPrincipal(db, asSales(), (tx) => listProspectNotes(tx, prospectRow))).toHaveLength(0);
  });

  it("sales cannot sign a note as somebody else", async () => {
    // The policy is `author_user_id = current_user_id()`. Without it the log would attribute a
    // judgment to a person who never made it.
    await expect(
      asPrincipal(db, asSales(partner), (tx) =>
        addProspectNote(tx, org, { prospect: prospectRow, body: "not mine", authorUserId: owner }))
    ).rejects.toThrow();
  });

  it("a blank note is refused, however it is spelled", async () => {
    for (const body of ["", "   ", "\n\t "]) {
      await expect(
        asPrincipal(db, asSales(), (tx) =>
          addProspectNote(tx, org, { prospect: prospectRow, body, authorUserId: partner }))
      ).rejects.toThrow();
    }
  });

  it("one organization cannot read another's notes", async () => {
    await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "acme private", authorUserId: partner }));

    const other = await createOrganization(db, "other", "Other");
    const stranger = await createUser(db, "stranger@test", "Stranger");
    await addMembership(db, stranger, other, "owner");

    const seen = await asPrincipal(
      db,
      __unsafePrincipalForTests("owner", other, stranger),
      (tx) => listProspectNotes(tx, prospectRow)
    );
    expect(seen, "RLS let another organization read the note log").toEqual([]);
  });

  it("notes vanish with the prospect they annotate", async () => {
    const note = await asPrincipal(db, asSales(), (tx) =>
      addProspectNote(tx, org, { prospect: prospectRow, body: "attached", authorUserId: partner }));
    expect(note.noteId).toBeTruthy();

    await asPrincipal(db, asOwner(), (tx) =>
      tx.query(`DELETE FROM prospects WHERE id = $1`, [prospectRow]));

    const left = await asPrincipal(db, asOwner(), (tx) =>
      tx.query<{ n: string }>(`SELECT count(*) n FROM prospect_notes`));
    expect(Number(left.rows[0].n), "ON DELETE CASCADE did not carry the notes away").toBe(0);
  });
});

describe("findProspectRef · the surface addresses a prospect two ways", () => {
  it("resolves a slug", async () => {
    const p = await createProspect(db, org, { name: "Slugged", slug: "slugged" }, { kind: "system" });
    expect(await asPrincipal(db, asSales(), (tx) => findProspectRef(tx, "slugged"))).toBe(p.id);
  });

  it("resolves a row id for a prospect with NO slug — every imported lead is one", async () => {
    expect(await asPrincipal(db, asSales(), (tx) => findProspectRef(tx, prospectRow))).toBe(prospectRow);
  });

  it("answers null for a ref that names nothing", async () => {
    expect(await asPrincipal(db, asSales(), (tx) => findProspectRef(tx, "no-such-prospect"))).toBeNull();
  });
});
