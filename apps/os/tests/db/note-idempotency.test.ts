// 2A.0-C — NOTE WRITES ARE IDEMPOTENT, through the real route and the real admission chain.
//
// Drives `POST /api/prospects/[slug]/notes` — session cookie → `withRequestContext` →
// membership-resolved principal — against PGlite carrying 001–009.
//
// ─── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
//
// The server minted each note's id. A request that SUCCEEDED but whose response was lost — the
// commit happened, the phone never heard — left the client unable to say "that was me": the retry
// was a new request, got a new id, and the note was written twice. The only guard was the button's
// `busy` state, which is gone the moment the response is.
//
// ─── WHAT IS PROVEN HERE (sequential) AND IN note-idempotency-concurrency (real 17.6) ───────────
//
//   · a retry with the same id converges: ONE row, ONE event, the SAME note returned
//   · a lost response followed by a retry converges identically
//   · different ids are different notes — idempotency does not block a genuine second note
//   · the same id with a different body, prospect or author is REFUSED and reveals nothing
//   · the id is required and validated; authority and authorship are unchanged
//
// PRINTS: counts, statuses and booleans only.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import type { SqlClient } from "@/core/db";
import {
  SESSION_SECRET, bootDatabase, provisionPartner, tokenFor, type World,
} from "@/tests/support/provisioned-partner";
import { requestAs, seedVault } from "@/tests/support/route-surface";

let pg: PGlite;
let db: SqlClient;
let vault: string;
let world: World;
let ownerToken: string;
let salesToken: string;
const saved: Record<string, string | undefined> = {};

type NoteBody = { ok?: boolean; replayed?: boolean; error?: string; note?: { noteId: string; body: string; authorUserId?: string } };

async function post(ref: string, token: string | null, payload: Record<string, unknown>) {
  const mod = await import("@/app/api/prospects/[slug]/notes/route");
  const req = token
    ? requestAs(token, `https://os.test/api/prospects/${ref}/notes`, { method: "POST", body: JSON.stringify(payload) })
    : new Request(`https://os.test/api/prospects/${ref}/notes`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const res = await mod.POST(req, { params: Promise.resolve({ slug: ref }) });
  return { status: res.status, body: (await res.json()) as NoteBody };
}

const rowsFor = async (prospectId: string) =>
  (await pg.query<{ note_id: string; author_user_id: string; body: string }>(
    "SELECT note_id::text, author_user_id::text, body FROM prospect_notes WHERE prospect = $1 ORDER BY created_at, note_id",
    [prospectId])).rows;
const noteEvents = async (noteId: string) =>
  (await pg.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE type = 'prospect.note_added' AND data->>'note_id' = $1", [noteId])).rows[0].n;
const eventsTotal = async () => (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM events")).rows[0].n;

let seq = 0;
async function seedProspect() {
  seq++;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, status)
     VALUES ($1, gen_random_uuid(), 'anchored', $2, $3, 'lead') RETURNING id`,
    [world.organizationId, `note-idem-${seq}`, `Note Biz ${seq}`]);
  return { id: r.rows[0].id, ref: `note-idem-${seq}` };
}

beforeAll(async () => {
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  ({ pg, db } = await bootDatabase());
  registerAppDb((fn) => fn(db));
  const partner = await provisionPartner(db, {
    orgSlug: "note-idem-org", ownerEmail: "note-owner@test", partnerEmail: "note-sales@test",
    password: "a-sufficiently-long-note-idempotency-password",
  });
  world = partner.world;
  salesToken = partner.login.sessionToken!;
  ownerToken = await tokenFor(world.ownerId);
}, 60_000);

afterAll(async () => {
  await pg.close();
  const { rm } = await import("node:fs/promises");
  await rm(vault, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => { process.env.ASCEND_PROSPECT_SOURCE = "postgres"; registerAppDb((fn) => fn(db)); bindAuthorityResolver(); });
afterEach(() => { clearAppDb(); clearAuthorityResolver(); });

describe("2A.0-C · a retry converges on the note it already wrote", () => {
  it("SEQUENTIAL RETRY · same id twice → 201 then 200 replayed, the SAME note, ONE row, ONE event", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const first = await post(p.ref, ownerToken, { body: "Called — asked for a quote.", noteId });
    const retry = await post(p.ref, ownerToken, { body: "Called — asked for a quote.", noteId });

    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.note!.noteId).toBe(first.body.note!.noteId);
    expect(retry.body.note!.noteId).toBe(noteId);
    expect(await rowsFor(p.id)).toHaveLength(1);
    expect(await noteEvents(noteId)).toBe(1);
    const [ev] = (await pg.query<{ correlation_id: string }>(
      "SELECT correlation_id FROM events WHERE type = 'prospect.note_added' AND data->>'note_id' = $1", [noteId])).rows;
    expect(ev.correlation_id).toBe(noteId);
  });

  it("LOST RESPONSE · the first request commits but its response is never read; the retry converges", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const mod = await import("@/app/api/prospects/[slug]/notes/route");
    // The response object is discarded unread — from the client's side, the request "failed".
    await mod.POST(requestAs(ownerToken, `https://os.test/api/prospects/${p.ref}/notes`,
      { method: "POST", body: JSON.stringify({ body: "Left voicemail.", noteId }) }), { params: Promise.resolve({ slug: p.ref }) });
    const before = await eventsTotal();

    const retry = await post(p.ref, ownerToken, { body: "Left voicemail.", noteId });
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(await rowsFor(p.id)).toHaveLength(1);
    expect(await eventsTotal()).toBe(before);   // the retry appended nothing
  });

  it("five retries of the same note are still one note and one event", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(p.ref, salesToken, { body: "Spoke to owner.", noteId })).status);
    expect(statuses).toEqual([201, 200, 200, 200, 200]);
    expect(await rowsFor(p.id)).toHaveLength(1);
    expect(await noteEvents(noteId)).toBe(1);
  });

  it("a trailing-space retry is the same note — the server trims before comparing, as it does before storing", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    expect((await post(p.ref, ownerToken, { body: "Same text", noteId })).status).toBe(201);
    expect((await post(p.ref, ownerToken, { body: "  Same text  ", noteId })).status).toBe(200);
    expect(await rowsFor(p.id)).toHaveLength(1);
  });

  it("an upper-case retry of the same UUID converges — ids are compared case-insensitively", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    expect((await post(p.ref, ownerToken, { body: "Case", noteId: noteId.toUpperCase() })).status).toBe(201);
    expect((await post(p.ref, ownerToken, { body: "Case", noteId })).status).toBe(200);
    expect(await rowsFor(p.id)).toHaveLength(1);
  });
});

describe("2A.0-C · idempotency does not merge different notes", () => {
  it("DIFFERENT IDS · the same text twice with two ids is two notes — a genuine second note is never blocked", async () => {
    const p = await seedProspect();
    const a = await post(p.ref, ownerToken, { body: "No answer.", noteId: randomUUID() });
    const b = await post(p.ref, ownerToken, { body: "No answer.", noteId: randomUUID() });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await rowsFor(p.id)).toHaveLength(2);
  });

  it("SAME ID, DIFFERENT BODY · refused 409, the original untouched, nothing appended", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    await post(p.ref, ownerToken, { body: "Original wording.", noteId });
    const before = await eventsTotal();
    const clash = await post(p.ref, ownerToken, { body: "Edited wording.", noteId });
    expect(clash.status).toBe(409);
    expect((await rowsFor(p.id)).map((r) => r.body)).toEqual(["Original wording."]);
    expect(await eventsTotal()).toBe(before);
  });

  it("SAME ID, DIFFERENT PROSPECT · refused 409", async () => {
    const p1 = await seedProspect();
    const p2 = await seedProspect();
    const noteId = randomUUID();
    await post(p1.ref, ownerToken, { body: "Belongs to one.", noteId });
    const clash = await post(p2.ref, ownerToken, { body: "Belongs to one.", noteId });
    expect(clash.status).toBe(409);
    expect(await rowsFor(p2.id)).toHaveLength(0);
  });

  it("SAME ID, DIFFERENT AUTHOR · refused 409 and the response reveals nothing of the other person's note", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    await post(p.ref, ownerToken, { body: "Owner's private read on this lead.", noteId });
    const clash = await post(p.ref, salesToken, { body: "Owner's private read on this lead.", noteId });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).not.toContain("private read");
    expect(clash.body.note).toBeUndefined();
    const rows = await rowsFor(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].author_user_id).toBe(world.ownerId);
  });
});

describe("2A.0-C · the contract is enforced, and authority is unchanged", () => {
  it("the note id is REQUIRED and must be a UUID — nothing is written without one", async () => {
    const p = await seedProspect();
    for (const noteId of [undefined, "", "not-a-uuid", 42, "12345678-1234-1234-1234-12345678901"]) {
      const r = await post(p.ref, ownerToken, { body: "Should not land.", ...(noteId === undefined ? {} : { noteId }) });
      expect(r.status, `noteId=${String(noteId)}`).toBe(400);
    }
    expect(await rowsFor(p.id)).toHaveLength(0);
  });

  it("an unauthenticated request is refused before anything else", async () => {
    const p = await seedProspect();
    const r = await post(p.ref, null, { body: "anon", noteId: randomUUID() });
    expect(r.status).toBe(401);
    expect(await rowsFor(p.id)).toHaveLength(0);
  });

  it("SALES writes as ITSELF — an author named in the request is ignored", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const r = await post(p.ref, salesToken, { body: "Partner's note.", noteId, authorUserId: world.ownerId, author_user_id: world.ownerId });
    expect(r.status).toBe(201);
    const [row] = await rowsFor(p.id);
    expect(row.author_user_id).toBe(world.partnerId);
  });

  it("a note on a prospect that does not exist is still 404, and writes nothing", async () => {
    const before = await eventsTotal();
    const r = await post("no-such-prospect-for-notes", ownerToken, { body: "orphan", noteId: randomUUID() });
    expect(r.status).toBe(404);
    expect(await eventsTotal()).toBe(before);
  });
});
