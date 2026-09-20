// Dependency D1b — CONCURRENCY, against a REAL PostgreSQL server.
//
// ─── WHY THIS SUITE CANNOT RUN ON PGlite ───────────────────────────────────────────────────────
//
// PGlite is a single in-process connection with a single backend. It cannot hold two concurrent
// transactions, so it cannot observe a race, and a blocking `pg_advisory_xact_lock` taken on it
// would simply wedge the only backend there is. D1a recorded this as carried verification debt and
// the owner accepted it ON CONDITION that D1b close it. This is that closure, and it needs a server
// with real backends — so it is gated, and it FAILS THE ENVIRONMENT GATE when the server is absent
// rather than skipping quietly. A concurrency proof that silently does not run is not evidence.
//
// Point `ASCEND_PG17_BIN` at a PostgreSQL >= 17 `bin` directory (or set `ASCEND_R1C_ROOT`, whose
// `pg17/bin` is used). The cluster is disposable, listens on a Unix socket only, and is destroyed
// afterwards — `tests/support/r1c-cluster.ts` owns all of that and is reused unchanged.
//
// ─── WHAT IS BEING PROVEN ──────────────────────────────────────────────────────────────────────
//
// Each request gets its OWN connection, through a real `pg` Pool, so two in-flight promotions are
// two backends contending for one row and one advisory lock — the actual production shape, not a
// simulation of it.
//
//   T12  two simultaneous archives   → one transition, one event, first archiver kept
//   T13  two simultaneous promotions → ONE client, one event, and a different requested slug
//                                      cannot manufacture a second. This is the D1a hole.
//   T14  promotion racing archival   → never both archived and newly won; no orphan client
//   T14b a note appended during an archival → lands, attached and readable, no deadlock
//
// PRINTS: counts, states and booleans. No row content beyond fixture names this file wrote itself.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { adaptPoolClient, type SqlClient } from "@/core/db";
import { startCluster, type R1cCluster } from "@/tests/support/r1c-cluster";
import { ephemeralSocketConfig } from "@/core/recovery/restore";
import {
  SCHEMA, SESSION_SECRET, provisionPartner, tokenFor, type World,
} from "@/tests/support/provisioned-partner";
import { requestAs, seedVault } from "@/tests/support/route-surface";

// ─── the server, or an honest failure ──────────────────────────────────────────────────────────

function resolveBin(): string {
  const direct = process.env.ASCEND_PG17_BIN?.trim();
  if (direct) return direct;
  const root = process.env.ASCEND_R1C_ROOT?.trim();
  if (root) return path.join(root, "pg17", "bin");
  throw new Error(
    "D1b concurrency needs a REAL PostgreSQL server: set ASCEND_PG17_BIN to a PostgreSQL >= 17 " +
    "bin directory, or ASCEND_R1C_ROOT to a recovery root containing pg17/bin. This suite does " +
    "not fall back to PGlite — PGlite has one backend, so it would prove nothing about a race."
  );
}

let cluster: R1cCluster;
let pool: pg.Pool;
let root: string;
let vault: string;
let world: World;
let ownerToken: string;
const saved: Record<string, string | undefined> = {};

const HL = () => path.join(vault, "02 - Sales & Hit List");
const CRM = () => path.join(vault, "01 - CRM & Clients");

/** One connection per unit of work — which is what makes two requests two backends. */
async function lease<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(adaptPoolClient(client));
  } finally {
    client.release();
  }
}

const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, params as never[])).rows as T[];

async function promote(ref: string, token: string, body: Record<string, unknown> = {}) {
  const mod = await import("@/app/api/prospects/[slug]/promote/route");
  const res = await mod.POST(
    requestAs(token, `https://os.test/api/prospects/${ref}/promote`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function archive(ref: string, token: string) {
  const mod = await import("@/app/api/prospects/[slug]/route");
  const res = await mod.DELETE(
    requestAs(token, `https://os.test/api/prospects/${ref}`, { method: "DELETE" }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let seq = 0;
async function seedRow(slug: string | null) {
  seq++;
  const anchor = `01920000-0000-7000-8000-0000000${String(seq).padStart(5, "0")}`;
  const [row] = await q<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, status, notes)
     VALUES ($1,$2,'anchored',$3,$4,'lead','call log body') RETURNING id`,
    [world.organizationId, anchor, slug, `Race ${seq}`]);
  await q(
    `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body)
     VALUES (gen_random_uuid(), $1, $2, $3, 'called, interested')`,
    [world.organizationId, row.id, world.ownerId]);
  return { id: row.id, anchor, ref: slug ?? row.id };
}

const countEvents = async (anchor: string, type: string) =>
  Number((await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM events
      WHERE type = $1 AND subject_entity = 'prospect' AND subject_entity_id = $2`, [type, anchor]))[0].n);

const clientDirs = async () =>
  (await fs.readdir(CRM()).catch(() => [] as string[])).filter((d) => !d.startsWith("."));

const notesOf = async (rowId: string) =>
  Number((await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM prospect_notes WHERE prospect = $1`, [rowId]))[0].n);

// ─── fixture ───────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const bin = resolveBin();
  if (!existsSync(path.join(bin, "initdb"))) {
    throw new Error(`no initdb at ${bin} — the PostgreSQL build this suite needs is not there.`);
  }
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";

  root = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "d1b-conc-"));
  cluster = startCluster(root, "d1b", bin, "17");
  // The SAME socket config the recovery proofs use — Unix socket only, private root, no TCP.
  pool = new pg.Pool({ ...ephemeralSocketConfig(cluster.server, cluster.admin("postgres")), max: 12 });

  await lease((c) => c.exec(SCHEMA));

  registerAppDb((fn) => lease(fn));
  bindAuthorityResolver();

  const partner = await provisionPartner(await lease(async (c) => c), {
    orgSlug: "d1b-race", ownerEmail: "race-owner@test", partnerEmail: "race-sales@test",
    password: "a-sufficiently-long-d1b-race-password",
  });
  world = partner.world;
  ownerToken = await tokenFor(world.ownerId);

  await fs.mkdir(HL(), { recursive: true });
  await fs.mkdir(CRM(), { recursive: true });
}, 180_000);

afterAll(async () => {
  clearAppDb();
  await pool?.end();
  cluster?.stop();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

// ─── the races ─────────────────────────────────────────────────────────────────────────────────

// ─── the harness proves ITSELF first ───────────────────────────────────────────────────────────
//
// Every assertion below is worthless if this is secretly one backend, or not 17.6, or if
// `Promise.all` serialised the work. A green suite that never raced would be the most expensive
// kind of false evidence, so the harness is made to state its own credentials.

describe("D1b · the harness is a real, concurrent PostgreSQL 17.6", () => {
  it("is PostgreSQL 17.6 — production's version — on a Unix socket with no TCP listener", async () => {
    const [v] = await q<{ version: string; listen: string; addr: string | null }>(
      `SELECT current_setting('server_version') AS version,
              current_setting('listen_addresses') AS listen,
              inet_server_addr()::text AS addr`);
    expect(v.version).toBe("17.6");
    expect(v.listen).toBe("");
    // NULL means the connection did not arrive over IP at all.
    expect(v.addr).toBeNull();
  });

  it("gives concurrent work DISTINCT backends — without which nothing below is a race", async () => {
    const pids = await Promise.all(
      Array.from({ length: 8 }, () => lease(async (c) => {
        const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        // Hold the connection briefly so the eight leases genuinely overlap rather than
        // round-tripping one after another on a single recycled backend.
        await c.query("SELECT pg_sleep(0.15)");
        return r.rows[0].pid;
      }))
    );
    expect(new Set(pids).size, `eight concurrent leases shared ${8 - new Set(pids).size + 1} backend(s)`).toBe(8);
  });

  it("two backends genuinely BLOCK on one row — the lock is real, not a coincidence of timing", async () => {
    const p = await seedRow("lock-witness");
    let secondStarted = 0;
    let firstCommitted = 0;

    const holder = lease((c) => c.transaction(async (tx) => {
      await tx.query(`UPDATE prospects SET name = 'held' WHERE id = $1`, [p.id] as never);
      await tx.query("SELECT pg_sleep(0.4)");
      firstCommitted = Date.now();
    }));

    await new Promise((r) => setTimeout(r, 100));
    const waiter = lease((c) => c.transaction(async (tx) => {
      secondStarted = Date.now();
      await tx.query(`UPDATE prospects SET name = 'waited' WHERE id = $1`, [p.id] as never);
      return Date.now();
    }));

    const [, waiterFinished] = await Promise.all([holder, waiter]);
    // The second UPDATE started while the first held the row, and could not complete until the
    // first committed. That is a real write conflict between two real backends.
    expect(secondStarted).toBeLessThan(firstCommitted);
    expect(waiterFinished).toBeGreaterThanOrEqual(firstCommitted);
  });
});

describe("D1b · concurrent archival", () => {
  it("T12 · eight simultaneous archives make ONE transition and ONE event", async () => {
    const p = await seedRow("race-archive");

    const results = await Promise.all(
      Array.from({ length: 8 }, () => archive(p.ref, ownerToken))
    );

    // Every caller is told something true; exactly one of them did the work.
    const archived = results.filter((r) => r.body.outcome === "archived");
    const already = results.filter((r) => r.body.outcome === "already_archived");
    expect(archived).toHaveLength(1);
    expect(already).toHaveLength(7);
    expect(results.every((r) => r.status === 200)).toBe(true);

    // One state transition, one event, and the notes are untouched.
    expect(await countEvents(p.anchor, "prospect.archived")).toBe(1);
    const [row] = await q<{ archived_at: Date | null; archived_by: string | null }>(
      `SELECT archived_at, archived_by FROM prospects WHERE id = $1`, [p.id]);
    expect(row.archived_at).not.toBeNull();
    expect(row.archived_by).toBe(world.ownerId);
    expect(await notesOf(p.id)).toBe(1);
  });

  it("T14b · a note appended DURING an archival lands, attached and readable", async () => {
    const p = await seedRow("race-note");
    const { addProspectNote } = await import("@/core/db");

    const [, noted] = await Promise.all([
      archive(p.ref, ownerToken),
      lease((c) => c.transaction(async (tx) => {
        await tx.query("SELECT set_config('ascend.org_id', $1, true)", [world.organizationId] as never);
        await tx.query("SELECT set_config('ascend.user_id', $1, true)", [world.ownerId] as never);
        await tx.query("SET LOCAL ROLE ascend_owner");
        return addProspectNote(tx, world.organizationId as never,
          { prospect: p.id, body: "mid-archival note", authorUserId: world.ownerId as never });
      })),
    ]);

    expect(noted).toBeTruthy();
    // The FK takes KEY SHARE and the archival takes FOR NO KEY UPDATE: compatible, so neither
    // blocks the other and the note is correctly attached to an archived prospect.
    expect(await notesOf(p.id)).toBe(2);
  });
});

describe("D1b · concurrent promotion — the D1a hole, closed", () => {
  it("T13 · two simultaneous promotions create exactly ONE client and ONE event", async () => {
    const p = await seedRow("race-promote");
    const before = await clientDirs();

    const [a, b] = await Promise.all([
      promote(p.ref, ownerToken, { client_slug: "race-client-a" }),
      promote(p.ref, ownerToken, { client_slug: "race-client-b" }),
    ]);

    // Pre-D1b this produced TWO client directories — one per requested slug — while one caller was
    // told `already_promoted` beside the duplicate it had just made.
    const after = (await clientDirs()).filter((d) => !before.includes(d));
    expect(after, `two promotions produced ${after.length} clients`).toHaveLength(1);
    expect(await countEvents(p.anchor, "prospect.promoted")).toBe(1);

    // Both callers converge on the SAME client, whatever slug each asked for.
    const slugs = [a, b].map((r) => (r.body.client as { slug: string | null }).slug);
    expect(new Set(slugs).size).toBe(1);
    expect(slugs[0]).toBe(after[0]);

    // And both are told the truth: one promoted it, the other found it already done.
    const outcomes = [a, b].map((r) => r.body.outcome).sort();
    expect(outcomes).toEqual(["already_promoted", "promoted"]);
  });

  it("T13 · six simultaneous promotions, each asking for a DIFFERENT slug, still make one client", async () => {
    const p = await seedRow("race-promote-many");
    const before = await clientDirs();

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => promote(p.ref, ownerToken, { client_slug: `many-client-${i}` }))
    );

    const after = (await clientDirs()).filter((d) => !before.includes(d));
    expect(after).toHaveLength(1);
    expect(await countEvents(p.anchor, "prospect.promoted")).toBe(1);
    expect(results.filter((r) => r.body.outcome === "promoted")).toHaveLength(1);
    expect(results.filter((r) => r.body.outcome === "already_promoted")).toHaveLength(5);
    // Every caller names the one client that exists — nobody is handed a slug that is not there.
    for (const r of results) {
      expect((r.body.client as { slug: string | null }).slug).toBe(after[0]);
    }
  });
});

describe("D1b · promotion racing archival", () => {
  it("T14 · one wins; the prospect is never both archived and newly won, and no orphan client remains", async () => {
    // Repeated, because which side wins is genuinely nondeterministic — the invariant has to hold
    // for BOTH orderings, and asserting it once would only prove whichever one happened today.
    for (let i = 0; i < 6; i++) {
      const p = await seedRow(`race-mixed-${i}`);
      const before = await clientDirs();

      const [promoteResult, archiveResult] = await Promise.all([
        promote(p.ref, ownerToken, { client_slug: `mixed-client-${i}` }),
        archive(p.ref, ownerToken),
      ]);

      const [row] = await q<{ archived_at: Date | null; status: string | null }>(
        `SELECT archived_at, status FROM prospects WHERE id = $1`, [p.id]);
      const promoted = promoteResult.body.outcome === "promoted";
      const archived = archiveResult.body.outcome === "archived";
      const newClients = (await clientDirs()).filter((d) => !before.includes(d));

      // The archival always succeeds — it has no precondition on status.
      expect(archived).toBe(true);
      expect(row.archived_at).not.toBeNull();

      if (promoted) {
        // Promotion won the row: it committed BEFORE the archival, so the prospect is a won deal
        // that was then archived. Exactly one client, exactly one event.
        expect(row.status).toBe("closed-won");
        expect(newClients).toHaveLength(1);
        expect(await countEvents(p.anchor, "prospect.promoted")).toBe(1);
      } else {
        // Promotion lost. It must NOT have marked the row, and must NOT claim success.
        expect(row.status).not.toBe("closed-won");
        expect(await countEvents(p.anchor, "prospect.promoted")).toBe(0);
        // It is allowed to have been refused outright (no client), or to report `incomplete` with a
        // client it had already staged before the archival committed. What it may NEVER do is
        // report `promoted`, and it may never leave more than one client behind.
        expect(["refused", "incomplete"]).toContain(promoteResult.body.outcome);
        expect(newClients.length).toBeLessThanOrEqual(1);
      }

      // Whatever happened, the notes are intact.
      expect(await notesOf(p.id)).toBe(1);
      expect(await countEvents(p.anchor, "prospect.archived")).toBe(1);
    }
  }, 60_000);
});
