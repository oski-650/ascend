// 2A.0-C — NOTE IDEMPOTENCY UNDER REAL CONCURRENCY, on PostgreSQL 17.6.
//
// PGlite has one backend: it cannot hold two transactions open, so it cannot show what happens when
// two writes of the same note id genuinely overlap. That is the case idempotency is FOR — a
// double-tap, or a retry fired while the first request is still in flight — so it is proven here, on
// the retained 17.6 build (`ASCEND_PG17_BIN`), with one real backend per request. The suite FAILS the
// environment gate without it; it never falls back to PGlite.
//
// ─── WHAT MUST HOLD ────────────────────────────────────────────────────────────────────────────
//
//   · N simultaneous writes of ONE id → ONE row, ONE event, every caller handed the SAME note
//   · N simultaneous writes of DIFFERENT ids → N notes (idempotency never merges distinct notes)
//   · a retry that arrives while the original is UNCOMMITTED waits on the uniqueness lock, then
//     REPLAYS the committed note — it does not race it into a duplicate
//   · if the original ROLLS BACK, the waiting retry WRITES the note — nothing is lost
//
// PRINTS: counts, statuses and booleans only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { adaptPoolClient, asPrincipal, writeProspectNote, type SqlClient } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { startCluster, type R1cCluster } from "@/tests/support/r1c-cluster";
import { ephemeralSocketConfig } from "@/core/recovery/restore";
import { SCHEMA, SESSION_SECRET, provisionPartner, tokenFor, type World } from "@/tests/support/provisioned-partner";
import { requestAs, seedVault } from "@/tests/support/route-surface";

function resolveBin(): string {
  const direct = process.env.ASCEND_PG17_BIN?.trim();
  if (direct) return direct;
  const root = process.env.ASCEND_R1C_ROOT?.trim();
  if (root) return path.join(root, "pg17", "bin");
  throw new Error(
    "note-idempotency concurrency needs a REAL PostgreSQL server: set ASCEND_PG17_BIN to a PostgreSQL >= 17 " +
    "bin directory. It does not fall back to PGlite, which has one backend and cannot overlap two writes.");
}

let cluster: R1cCluster;
let pool: pg.Pool;
let root: string;
let vault: string;
let world: World;
let ownerToken: string;
let owner: ResolvedPrincipal;
const saved: Record<string, string | undefined> = {};

async function lease<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(adaptPoolClient(client)); } finally { client.release(); }
}
const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, params as never[])).rows as T[];

async function post(ref: string, payload: Record<string, unknown>) {
  const mod = await import("@/app/api/prospects/[slug]/notes/route");
  const res = await mod.POST(
    requestAs(ownerToken, `https://os.test/api/prospects/${ref}/notes`, { method: "POST", body: JSON.stringify(payload) }),
    { params: Promise.resolve({ slug: ref }) });
  return { status: res.status, body: (await res.json()) as { replayed?: boolean; note?: { noteId: string } } };
}

let seq = 0;
async function seedProspect() {
  seq++;
  const [r] = await q<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, status)
     VALUES ($1, gen_random_uuid(), 'anchored', $2, $3, 'lead') RETURNING id`,
    [world.organizationId, `note-race-${seq}`, `Note Race ${seq}`]);
  return { id: r.id, ref: `note-race-${seq}` };
}
const noteRows = async (prospect: string) =>
  Number((await q<{ n: string }>("SELECT count(*)::text AS n FROM prospect_notes WHERE prospect = $1", [prospect]))[0].n);
const noteEvents = async (noteId: string) =>
  Number((await q<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE type = 'prospect.note_added' AND data->>'note_id' = $1", [noteId]))[0].n);

beforeAll(async () => {
  const bin = resolveBin();
  if (!existsSync(path.join(bin, "initdb"))) throw new Error(`no initdb at ${bin}`);
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  root = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "note-idem-"));
  cluster = startCluster(root, "notes", bin, "17");
  pool = new pg.Pool({ ...ephemeralSocketConfig(cluster.server, cluster.admin("postgres")), max: 14 });
  await lease((c) => c.exec(SCHEMA));
  registerAppDb((fn) => lease(fn));
  bindAuthorityResolver();
  const partner = await provisionPartner(await lease(async (c) => c), {
    orgSlug: "note-race", ownerEmail: "note-race-owner@test", partnerEmail: "note-race-sales@test",
    password: "a-sufficiently-long-note-race-password",
  });
  world = partner.world;
  ownerToken = await tokenFor(world.ownerId);
  const r = await lease((c) => resolvePrincipal(c, world.ownerId));
  if (!r.ok) throw new Error(`owner did not resolve (${r.reason})`);
  owner = r.principal;
}, 180_000);

afterAll(async () => {
  clearAppDb();
  await pool?.end();
  cluster?.stop();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("the harness is a real, concurrent PostgreSQL 17.6", () => {
  it("is 17.6, socket-only, and gives concurrent requests DISTINCT backends", async () => {
    const [v] = await q<{ version: string; addr: string | null }>(
      "SELECT current_setting('server_version') AS version, inet_server_addr()::text AS addr");
    expect(v.version).toBe("17.6");
    expect(v.addr).toBeNull();
    const pids = await Promise.all(Array.from({ length: 8 }, () => lease(async (c) => {
      const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await c.query("SELECT pg_sleep(0.15)");
      return r.rows[0].pid;
    })));
    expect(new Set(pids).size).toBe(8);
  });
});

describe("2A.0-C · concurrent writes of one note converge", () => {
  it("EIGHT simultaneous writes of ONE id → ONE row, ONE event, one 201, seven replays, one note for everyone", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => post(p.ref, { body: "Double-tapped.", noteId })));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200 && r.body.replayed === true)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.note?.noteId))).toEqual(new Set([noteId]));
    expect(await noteRows(p.id)).toBe(1);
    expect(await noteEvents(noteId)).toBe(1);
  });

  it("EIGHT simultaneous writes of DIFFERENT ids → EIGHT notes — distinct notes are never merged", async () => {
    const p = await seedProspect();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(p.ref, { body: `Note ${i}`, noteId: randomUUID() })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await noteRows(p.id)).toBe(8);
  });

  it("one id, two DIFFERENT bodies racing → exactly ONE note; the losing body is refused 409, never stored", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      post(p.ref, { body: i % 2 ? "Body B" : "Body A", noteId })));
    const [row] = await q<{ body: string }>("SELECT body FROM prospect_notes WHERE prospect = $1", [p.id]);
    expect(await noteRows(p.id)).toBe(1);
    expect(await noteEvents(noteId)).toBe(1);
    // Every request carrying the winning body converged on it; every one carrying the other was refused.
    results.forEach((r, i) => {
      const mine = i % 2 ? "Body B" : "Body A";
      expect(r.status, `request ${i} (${mine})`).toBe(mine === row.body ? (r.body.replayed ? 200 : 201) : 409);
    });
  });
});

describe("2A.0-C · a retry that overlaps the original — deterministically", () => {
  it("the original is UNCOMMITTED when the retry arrives: the retry WAITS, then replays the committed note", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();
    let originalCommitted = 0;

    const original = lease((c) => asPrincipal(c, owner, async (tx) => {
      await writeProspectNote(tx, owner.organizationId, { noteId, prospect: p.id, body: "In flight.", authorUserId: owner.userId });
      await tx.query("SELECT pg_sleep(0.6)");   // hold the uncommitted row — and its uniqueness lock
      originalCommitted = Date.now();
    }));
    await new Promise((r) => setTimeout(r, 150));
    const retryStarted = Date.now();
    const retry = await post(p.ref, { body: "In flight.", noteId });
    const retryFinished = Date.now();
    await original;

    expect(retryStarted).toBeLessThan(originalCommitted);        // it really overlapped
    expect(retryFinished).toBeGreaterThanOrEqual(originalCommitted); // and could not finish first
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(await noteRows(p.id)).toBe(1);
    expect(await noteEvents(noteId)).toBe(1);
  });

  it("the original ROLLS BACK while the retry waits: the retry WRITES the note — nothing is lost", async () => {
    const p = await seedProspect();
    const noteId = randomUUID();

    const original = lease((c) => asPrincipal(c, owner, async (tx) => {
      await writeProspectNote(tx, owner.organizationId, { noteId, prospect: p.id, body: "Will be retried.", authorUserId: owner.userId });
      await tx.query("SELECT pg_sleep(0.6)");
      throw new Error("simulated failure after the insert — the transaction rolls back");
    })).catch((e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 150));
    const retry = await post(p.ref, { body: "Will be retried.", noteId });

    expect(await original).toMatch(/simulated failure/);
    expect(retry.status).toBe(201);
    expect(retry.body.replayed).toBe(false);
    expect(await noteRows(p.id)).toBe(1);
    expect(await noteEvents(noteId)).toBe(1);
  });
});
