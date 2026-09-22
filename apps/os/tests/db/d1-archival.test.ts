// Dependency D1b — PROSPECT ARCHIVAL, against the store that owns prospects.
//
// Drives the REAL route handler (`DELETE /api/prospects/[slug]`) through the real admission chain —
// session cookie → `withRequestContext` → membership-resolved principal — against an in-process
// PGlite carrying migrations 001–009 and a throwaway vault. The deployed configuration is
// `ASCEND_PROSPECT_SOURCE=postgres`.
//
// ─── WHAT THIS SUITE IS FOR ────────────────────────────────────────────────────────────────────
//
// D1a refused Postgres-owned deletion with a truthful 409, because the correct operation is ARCHIVE
// and archival needed migration 009. This suite is the proof that the replacement keeps every
// promise the refusal made:
//
//   the notes survive            a hard DELETE would cascade them away (008)
//   the identity survives        an archived business is still that business
//   the history survives         events are append-only and nothing is removed
//   the actor is recorded        an archival that cannot name its human is not recorded at all
//   the matcher still sees it    or the next import creates a duplicate
//   sales never gets DELETE      the capability is bounded to two columns
//
// PRINTS: counts, states and booleans. No row content beyond fixture names this file wrote itself.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import type { SqlClient } from "@/core/db";
import { asPrincipal, listProspects as listDbProspects, findCorroborating, findByProspectId } from "@/core/db";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import type { OrganizationId, ProspectId } from "@/domain";
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
// REAL principals, resolved from `memberships` by the production resolver — never a test-only
// forgery. F59 forbids `__unsafePrincipalForTests` anywhere in the provisioned-partner evidence
// path, and this suite is in it: a suite that proves authorization must not mint its own authority.
let ownerPrincipal: ResolvedPrincipal;
let salesPrincipal: ResolvedPrincipal;
const saved: Record<string, string | undefined> = {};

const HL = () => path.join(vault, "02 - Sales & Hit List");

// ─── helpers ───────────────────────────────────────────────────────────────────────────────────

type ArchiveBody = {
  outcome?: string;
  error?: string;
  store?: string;
  prospect?: { state: string; archivedAt?: string | null; reason?: string };
  changed?: { prospect: string; notes: string; events: string; vault: string };
  operation?: { prospectId: string | null; correlationId: string; store: string };
  refusal?: { code: string; message: string };
};

async function archive(ref: string, token: string) {
  const mod = await import("@/app/api/prospects/[slug]/route");
  const res = await mod.DELETE(
    requestAs(token, `https://os.test/api/prospects/${ref}`, { method: "DELETE" }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as ArchiveBody };
}

async function promote(ref: string, token: string, body: Record<string, unknown> = {}) {
  const mod = await import("@/app/api/prospects/[slug]/promote/route");
  const res = await mod.POST(
    requestAs(token, `https://os.test/api/prospects/${ref}/promote`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A fingerprint of the whole hit list: names AND bytes. The vault-untouched assertion. */
async function hitListHash(): Promise<string> {
  const h = createHash("sha256");
  for (const f of (await fs.readdir(HL()).catch(() => [] as string[])).sort()) {
    h.update(f).update(await fs.readFile(path.join(HL(), f)));
  }
  return h.digest("hex");
}

const rowOf = async (id: string) =>
  (await pg.query<{ archived_at: string | null; archived_by: string | null; status: string | null; notes: string | null }>(
    "SELECT archived_at, archived_by, status, notes FROM prospects WHERE id = $1", [id])).rows[0];

const notesOf = async (rowId: string) =>
  (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM prospect_notes WHERE prospect = $1", [rowId])).rows[0].n;

const eventsFor = async (prospectId: string, type: string) =>
  (await pg.query<{ n: number; actor: string; actor_user_id: string | null; correlation_id: string | null }>(
    `SELECT count(*)::int AS n, max(actor) AS actor, max(actor_user_id::text) AS actor_user_id,
            max(correlation_id) AS correlation_id
       FROM events WHERE type = $1 AND subject_entity = 'prospect' AND subject_entity_id = $2`,
    [type, prospectId])).rows[0];

const allEventsFor = async (prospectId: string) =>
  (await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM events WHERE subject_entity = 'prospect' AND subject_entity_id = $1`,
    [prospectId])).rows[0].n;

let seq = 0;
/** A Postgres prospect. `slug: null` mirrors production, where 3,102 of 3,108 rows have no slug. */
async function seedRow(opts: {
  slug: string | null; held?: boolean; withNote?: boolean; status?: string;
  website?: string | null; archived?: boolean;
}) {
  seq++;
  const anchor = `01910000-0000-7000-8000-0000000${String(seq).padStart(5, "0")}`;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name,
                            status, notes, website)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'call log body',$8) RETURNING id`,
    [world.organizationId, opts.held ? null : anchor, opts.held ? "held" : "anchored",
     opts.held ? "two records, one business" : null, opts.slug, `Biz ${seq}`,
     opts.status ?? "lead", opts.website ?? null]);
  const id = r.rows[0].id;
  if (opts.withNote) {
    await pg.query(
      `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body)
       VALUES (gen_random_uuid(), $1, $2, $3, 'called, interested')`,
      [world.organizationId, id, world.ownerId]);
  }
  if (opts.archived) {
    await pg.query(`UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1`,
      [id, world.ownerId]);
  }
  return { id, anchor: opts.held ? null : anchor, ref: opts.slug ?? id };
}

/** Run as a real database principal, through the same role-switching production uses. */
const as = <T>(role: "owner" | "sales", fn: (tx: SqlClient) => Promise<T>) =>
  asPrincipal(db, role === "owner" ? ownerPrincipal : salesPrincipal, fn);

/** Does this statement fail for this role? Returns the message, or null if it SUCCEEDED. */
async function refusedFor(role: "owner" | "sales", sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await as(role, (tx) => tx.query(sql, params as never));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ─── fixture ───────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  for (const k of ["ASCEND_OS_SESSION_SECRET", "ASCEND_VAULT_PATH", "ASCEND_PROSPECT_SOURCE"]) saved[k] = process.env[k];
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  vault = await seedVault();
  process.env.ASCEND_VAULT_PATH = vault;
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  ({ pg, db } = await bootDatabase());
  registerAppDb((fn) => fn(db));
  const partner = await provisionPartner(db, {
    orgSlug: "d1b-org", ownerEmail: "d1b-owner@test", partnerEmail: "d1b-sales@test",
    password: "a-sufficiently-long-d1b-suite-password",
  });
  world = partner.world;
  salesToken = partner.login.sessionToken!;
  ownerToken = await tokenFor(world.ownerId);
  salesPrincipal = partner.principal;
  const owner = await resolvePrincipal(db, world.ownerId);
  if (!owner.ok) throw new Error(`resolvePrincipal refused the owner (${owner.reason})`);
  ownerPrincipal = owner.principal;
  await fs.mkdir(HL(), { recursive: true });
  for (const f of await fs.readdir(HL())) await fs.rm(path.join(HL(), f));
}, 60_000);

afterAll(async () => {
  await pg.close();
  await fs.rm(vault, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  registerAppDb((fn) => fn(db));
  bindAuthorityResolver();
});
afterEach(() => { clearAppDb(); clearAuthorityResolver(); });

// ─── 1 · the operation ─────────────────────────────────────────────────────────────────────────

describe("D1b · archival, per principal", () => {
  it("T1 · the OWNER archives: row, event and attribution, in one transaction", async () => {
    const p = await seedRow({ slug: "owner-archives", withNote: true });
    const before = await hitListHash();

    const { status, body } = await archive(p.ref, ownerToken);

    expect(status).toBe(200);
    expect(body.outcome).toBe("archived");
    expect(body.store).toBe("postgres");
    expect(body.changed).toMatchObject({ prospect: "archived", notes: "none", vault: "none" });
    // Identity written down is the ANCHOR, never the slug.
    expect(body.operation!.prospectId).toBe(p.anchor);

    const row = await rowOf(p.id);
    expect(row.archived_at).not.toBeNull();
    expect(row.archived_by).toBe(world.ownerId);

    const ev = await eventsFor(p.anchor!, "prospect.archived");
    expect(ev.n).toBe(1);
    expect(ev.actor).toBe("operator");
    expect(ev.actor_user_id).toBe(world.ownerId);
    expect(ev.correlation_id).toBe(body.operation!.correlationId);

    expect(await hitListHash()).toBe(before);
  });

  it("T2 · SALES archives, and the attribution is SALES — not the owner's", async () => {
    const p = await seedRow({ slug: "sales-archives", withNote: true });

    const { status, body } = await archive(p.ref, salesToken);

    expect(status).toBe(200);
    expect(body.outcome).toBe("archived");
    const row = await rowOf(p.id);
    expect(row.archived_by).toBe(world.partnerId);
    expect(row.archived_by).not.toBe(world.ownerId);

    const ev = await eventsFor(p.anchor!, "prospect.archived");
    expect(ev.n).toBe(1);
    expect(ev.actor_user_id).toBe(world.partnerId);
  });

  it("T3 · already archived is an idempotent 200 — one event, first archiver kept", async () => {
    const p = await seedRow({ slug: "archive-twice", withNote: true });

    const first = await archive(p.ref, ownerToken);
    expect(first.body.outcome).toBe("archived");
    const firstAt = (await rowOf(p.id)).archived_at;

    // THE OWNER RETRIES FIRST, and that ordering is load-bearing.
    //
    // Found by mutation probe M1: removing `AND archived_at IS NULL` from the compare-and-set left
    // this test GREEN, because the only retry it made was as SALES — and after 009 the sales UPDATE
    // policy's USING predicate already excludes archived rows, so RLS was silently doing the work
    // the assertion claimed to attribute to the CAS. The owner holds `FOR ALL` with no archival
    // predicate, so an owner retry is refused by the compare-and-set and by NOTHING ELSE. That is
    // what makes this discriminating. (D1a hit the same class of weakness at M6b.)
    const second = await archive(p.ref, ownerToken);
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("already_archived");
    expect(second.body.changed).toMatchObject({ prospect: "none", events: "none" });

    // And a different principal retrying converges the same way — belt and braces, but no longer
    // the only evidence.
    const third = await archive(p.ref, salesToken);
    expect(third.status).toBe(200);
    expect(third.body.outcome).toBe("already_archived");

    const row = await rowOf(p.id);
    // Attribution is NOT overwritten by the second caller, and the instant does not move.
    expect(row.archived_by).toBe(world.ownerId);
    expect(row.archived_at).toEqual(firstAt);
    // And exactly ONE event exists. This is the compare-and-set doing its job.
    expect((await eventsFor(p.anchor!, "prospect.archived")).n).toBe(1);
  });

  it("T7 · attribution comes from the resolved principal, not from anything the caller sends", async () => {
    const p = await seedRow({ slug: "forged-actor", withNote: true });
    const mod = await import("@/app/api/prospects/[slug]/route");
    // A body naming the owner, sent by sales. The route reads no actor from the request at all.
    const res = await mod.DELETE(
      requestAs(salesToken, `https://os.test/api/prospects/${p.ref}`, {
        method: "DELETE",
        body: JSON.stringify({ archived_by: world.ownerId, actor_user_id: world.ownerId }),
      }),
      { params: Promise.resolve({ slug: p.ref }) }
    );
    expect(res.status).toBe(200);
    expect((await rowOf(p.id)).archived_by).toBe(world.partnerId);
  });
});

// ─── 2 · refusals, each stating the truth ──────────────────────────────────────────────────────

describe("D1b · refusals never masquerade as success", () => {
  it("T4 · a HELD prospect is refused for SALES with 409 held — never already_archived, never 404", async () => {
    const p = await seedRow({ slug: "held-biz", held: true, withNote: true });

    const { status, body } = await archive(p.ref, salesToken);

    expect(status).toBe(409);
    expect(body.outcome).toBe("refused");
    expect(body.refusal!.code).toBe("held_prospect");
    expect(body.changed).toMatchObject({ prospect: "none", notes: "none", events: "none", vault: "none" });
    // The row is untouched and STILL ON THE LIST. Telling the operator otherwise is the untruth.
    expect((await rowOf(p.id)).archived_at).toBeNull();
    expect(await notesOf(p.id)).toBe(1);
  });

  it("T4b · owner/admin behaviour on a held row is the SAME refusal — the resolver refuses first", async () => {
    // Owner decision 2 protects held prospects from the ordinary sales workflow. The existing
    // policy is preserved rather than a new one invented: `resolveProspectForMutation` refuses a
    // held row for EVERY principal, because a held row has no anchor to key an event on.
    const p = await seedRow({ slug: "held-biz-owner", held: true, withNote: true });
    const { status, body } = await archive(p.ref, ownerToken);
    expect(status).toBe(409);
    expect(body.refusal!.code).toBe("held_prospect");
    expect((await rowOf(p.id)).archived_at).toBeNull();
  });

  it("T11 · not found is 404, ambiguous is 409 with a COUNT, and neither writes", async () => {
    const missing = await archive("nothing-answers-to-this", ownerToken);
    expect(missing.status).toBe(404);
    expect(missing.body.outcome).toBe("not_found");
    expect(missing.body.changed).toMatchObject({ prospect: "none" });

    // Two rows sharing one slug: the resolver refuses rather than taking a first match (P7).
    await seedRow({ slug: "twinned" });
    const second = await seedRow({ slug: "twinned" });
    const ambiguous = await archive("twinned", ownerToken);
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.refusal!.code).toBe("ambiguous_prospect");
    expect(ambiguous.body.refusal!.message).toMatch(/2 prospects/);
    expect((await rowOf(second.id)).archived_at).toBeNull();
  });
});

// ─── 3 · readers: active vs audit ──────────────────────────────────────────────────────────────

describe("D1b · the active set and the audit set are different sets", () => {
  it("T8 · archived rows leave the active reader and stay in the explicit one", async () => {
    const p = await seedRow({ slug: "leaves-the-list", withNote: true });
    await archive(p.ref, ownerToken);

    const active = await as("owner", (tx) => listDbProspects(tx));
    const all = await as("owner", (tx) => listDbProspects(tx, { includeArchived: true }));

    expect(active.map((r) => r.id)).not.toContain(p.id);
    expect(all.map((r) => r.id)).toContain(p.id);
    expect(all.find((r) => r.id === p.id)!.archivedAt).not.toBeNull();
  });

  it("T8 · THE IMPORT MATCHER STILL SEES IT — an archived business is not `new`", async () => {
    // The regression owner decision 4 demands, with an archived fixture. If the matcher's universe
    // were the ACTIVE set, this row would corroborate nothing, be classified `new`, and create a
    // SECOND record of a business already on file — the "third Tapia record" failure arriving
    // through a default parameter.
    const site = "https://archived-but-real.example";
    const p = await seedRow({ slug: "archived-identity", website: site, withNote: true });
    await archive(p.ref, ownerToken);
    expect((await rowOf(p.id)).archived_at).not.toBeNull();

    // THE REAL IMPORTER, not a hand-built universe.
    //
    // Found by mutation probe M3: an earlier version of this test asserted `findCorroborating` and
    // a universe it constructed itself, so pointing `core/intake/import.ts` at the ACTIVE-only
    // reader — the exact defect owner decision 4 exists to prevent — left it GREEN. A test that
    // reimplements the caller does not pin the caller. This runs `importSheet` and reads the
    // outcome the importer itself produced.
    const { importSheet } = await import("@/core/intake/import");
    const before = (await as("owner", (tx) => listDbProspects(tx, { includeArchived: true }))).length;

    const result = await as("owner", (tx) => importSheet(tx, world.organizationId as OrganizationId, {
      csv: `Business,Site\nArchived But Real,${site}\n`,
      label: "archived-identity-probe", sourceKind: "csv_paste", sourceName: "probe",
      columnMap: { name: "Business", website: "Site" },
      createdBy: world.ownerId as never,
    }));

    // `matched`, naming the archived row — NOT `projected`, which would be a duplicate business.
    const [outcome] = result.outcomes;
    expect(outcome.kind, "the importer CREATED a prospect for a business already on file").toBe("recorded");
    if (outcome.kind !== "recorded") throw new Error("unreachable");
    expect(outcome.reason).toBe("matched");
    expect(outcome.refs).toEqual([p.id]);

    // Nothing was created.
    const after = (await as("owner", (tx) => listDbProspects(tx, { includeArchived: true }))).length;
    expect(after).toBe(before);

    // The corroboration view sees it, and the ACTIVE reader — which the matcher must NOT use —
    // does not. That contrast is the point: the two readers disagree, and the matcher is on the
    // correct side of the disagreement.
    const hits = await as("owner", (tx) => findCorroborating(tx, { website: site }));
    expect(hits.map((r) => r.id)).toContain(p.id);
    expect((await as("owner", (tx) => listDbProspects(tx))).some((r) => r.website === site)).toBe(false);
  });

  it("T9 · audit lookups by ANCHOR still resolve an archived prospect", async () => {
    const p = await seedRow({ slug: "audit-me", withNote: true });
    await archive(p.ref, ownerToken);
    // `findByProspectId` is what promotion reads back through and what the incomplete-promotion
    // reconciliation derives from. It carries no active-set filter, deliberately.
    const found = await as("owner", (tx) => findByProspectId(tx, p.anchor! as ProspectId));
    expect(found).not.toBeNull();
    expect(found!.archivedAt).not.toBeNull();
  });

  it("T10 · the prospect page still resolves it, and says it is archived", async () => {
    const p = await seedRow({ slug: "still-viewable", withNote: true });
    await archive(p.ref, ownerToken);
    const { getProspect, listProspects } = await import("@/core/crm");
    const { runInRequestContext } = await import("@/core/auth/context");
    const ctx = { db, principal: ownerPrincipal };

    const direct = await runInRequestContext(ctx, () => getProspect(p.ref));
    expect(direct).not.toBeNull();
    expect(direct!.archivedAt).not.toBeNull();

    // …and it is gone from the list the operator works from.
    const listed = await runInRequestContext(ctx, listProspects);
    expect(listed.map((x) => x.slug)).not.toContain(p.ref);
  });
});

// ─── 4 · notes and history continuity ──────────────────────────────────────────────────────────

describe("D1b · archival destroys nothing", () => {
  it("T5/T6 · notes, body, identity and the whole event trail survive", async () => {
    const p = await seedRow({ slug: "keeps-everything", withNote: true });
    // Give it a history worth losing.
    await promote(p.ref, ownerToken, { client_slug: "keeps-everything-client" });
    const eventsBefore = await allEventsFor(p.anchor!);
    const notesBefore = await notesOf(p.id);
    expect(notesBefore).toBe(1);
    expect(eventsBefore).toBeGreaterThan(0);

    const { status } = await archive(p.ref, ownerToken);
    expect(status).toBe(200);

    const row = await rowOf(p.id);
    // The row is still here — a hard DELETE would have taken it and, by cascade, its notes.
    expect(row).toBeDefined();
    expect(row.notes).toBe("call log body");
    // Notes: unchanged in count and still reachable from the prospect.
    expect(await notesOf(p.id)).toBe(notesBefore);
    const { listProspectNotes } = await import("@/core/db");
    expect(await as("owner", (tx) => listProspectNotes(tx, p.id))).toHaveLength(1);
    // History: nothing removed, exactly one thing added.
    expect(await allEventsFor(p.anchor!)).toBe(eventsBefore + 1);
    // Identity: the anchor is untouched, so the client's back-reference still resolves.
    const still = await as("owner", (tx) => findByProspectId(tx, p.anchor! as ProspectId));
    expect(still!.prospectId).toBe(p.anchor);
  });

  it("T15 · an archived prospect cannot be promoted, and NO client is created for it", async () => {
    const p = await seedRow({ slug: "archived-then-promoted", withNote: true });
    await archive(p.ref, ownerToken);

    const { status, body } = await promote(p.ref, ownerToken, { client_slug: "should-not-exist" });

    expect(status).toBe(409);
    expect(body.outcome).toBe("refused");
    expect((body.refusal as { code: string }).code).toBe("archived_prospect");
    // The refusal happens UNDER THE LOCK and BEFORE the client is created, so there is no orphan.
    const crm = path.join(vault, "01 - CRM & Clients");
    expect(await fs.readdir(crm).catch(() => [] as string[])).not.toContain("should-not-exist");
    expect((await eventsFor(p.anchor!, "prospect.promoted")).n).toBe(0);
  });
});

// ─── 5 · least privilege, proven against the database ──────────────────────────────────────────

describe("D1b · sales archives through the bounded operation, and holds nothing more", () => {
  it("A1 · sales has NO raw DELETE on prospects — the notes cascade is unreachable", async () => {
    const p = await seedRow({ slug: "no-delete-for-sales", withNote: true });
    const msg = await refusedFor("sales", `DELETE FROM prospects WHERE id = $1`, [p.id]);
    expect(msg).toMatch(/permission denied/i);
    // The row and its note are both still there.
    expect(await rowOf(p.id)).toBeDefined();
    expect(await notesOf(p.id)).toBe(1);
  });

  it("A2 · the sales grant is EXACTLY the two archive columns — everything else still refused", async () => {
    const p = await seedRow({ slug: "bounded-grant" });
    // Allowed: the bounded operation.
    expect(await refusedFor("sales",
      `UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1`, [p.id, world.partnerId]))
      .toBeNull();

    // Refused: research findings and identity, which 009 must not have widened.
    for (const sql of [
      `UPDATE prospects SET website_quality = 'modern' WHERE id = $1`,
      `UPDATE prospects SET source = 'invented' WHERE id = $1`,
      `UPDATE prospects SET website = 'https://x.example' WHERE id = $1`,
      `UPDATE prospects SET identity_state = 'held' WHERE id = $1`,
      `UPDATE prospects SET prospect_id = gen_random_uuid() WHERE id = $1`,
      `UPDATE prospects SET hold_reason = 'because' WHERE id = $1`,
    ]) {
      expect(await refusedFor("sales", sql, [p.id]), `sales could run: ${sql}`).toMatch(/permission denied/i);
    }
  });

  it("A3 · AUTOMATION cannot archive: it holds no grant on either column", async () => {
    const p = await seedRow({ slug: "automation-cannot-archive" });
    const msg = await (async () => {
      try {
        await asPrincipal(db,
          { role: "automation", organizationId: world.organizationId as OrganizationId, userId: null },
          (tx) => tx.query(`UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1`,
            [p.id, world.ownerId] as never));
        return null;
      } catch (e) { return (e as Error).message; }
    })();
    expect(msg).toMatch(/permission denied/i);
    expect((await rowOf(p.id)).archived_at).toBeNull();
  });

  it("A4 · after archival, SALES can no longer write the row — the USING predicate holds", async () => {
    const p = await seedRow({ slug: "frozen-for-sales", withNote: true });
    await archive(p.ref, ownerToken);

    // Not an error: RLS filters the row out, so the UPDATE matches nothing. Silence is the point —
    // sales cannot revive or re-note an archived prospect. (Since 010 the probe column is `notes`:
    // `status` is no longer directly writable by ANY application role — the guarded
    // `ascend_transition_stage` refuses archived rows itself — so it cannot probe this policy.)
    const affected = await as("sales", async (tx) =>
      (await tx.query(`UPDATE prospects SET notes = 'revived?' WHERE id = $1`, [p.id] as never)).affected);
    expect(affected).toBe(0);
    expect((await rowOf(p.id)).status).toBe("lead");

    // The OWNER is unchanged: FOR ALL, so a correction remains possible without a new grant.
    const byOwner = await as("owner", async (tx) =>
      (await tx.query(`UPDATE prospects SET notes = 'owner correction' WHERE id = $1`, [p.id] as never)).affected);
    expect(byOwner).toBe(1);
  });

  it("A6 · the grant shape is exactly what 009 declared, and nothing more", async () => {
    const { rows } = await pg.query<{ column_name: string; grantee: string }>(
      `SELECT a.attname AS column_name, r.rolname AS grantee
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         CROSS JOIN LATERAL aclexplode(a.attacl) x
         JOIN pg_roles r ON r.oid = x.grantee
        WHERE c.relname = 'prospects' AND a.attname IN ('archived_at','archived_by')
          AND x.privilege_type = 'UPDATE'
        ORDER BY r.rolname, a.attname`);
    // 010 (2A.1b) replaced the owner's TABLE-level UPDATE with column grants on every column except
    // the four it guards, so the owner's (unchanged) right to write the archival columns now appears
    // here as column grants. Sales is exactly what 009 declared.
    expect(rows.map((r) => `${r.grantee}:${r.column_name}`)).toEqual([
      "ascend_owner:archived_at", "ascend_owner:archived_by",
      "ascend_sales:archived_at", "ascend_sales:archived_by",
    ]);
  });

  it("A5 · archival is organization-scoped: another org's prospect is invisible and untouchable", async () => {
    const otherOrg = (await pg.query<{ id: string }>(
      `INSERT INTO organizations (slug, name) VALUES ('d1b-other','Other') RETURNING id`)).rows[0].id;
    const foreign = (await pg.query<{ id: string }>(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, slug, name, status)
       VALUES ($1, gen_random_uuid(), 'anchored', 'foreign-biz', 'Foreign', 'lead') RETURNING id`,
      [otherOrg])).rows[0].id;

    const { status } = await archive("foreign-biz", ownerToken);
    expect(status).toBe(404);
    expect((await rowOf(foreign)).archived_at).toBeNull();
  });
});

// ─── 6 · the constraint, and the vault arm ─────────────────────────────────────────────────────

describe("D1b · the schema refuses an archival with no author", () => {
  it("M10 · archival_has_provenance rejects a half-stated archival, in both directions", async () => {
    const p = await seedRow({ slug: "no-anonymous-archival" });
    // The owner holds table-level UPDATE, so this is refused by the CONSTRAINT, not by a grant.
    const onlyAt = await refusedFor("owner", `UPDATE prospects SET archived_at = now() WHERE id = $1`, [p.id]);
    expect(onlyAt).toMatch(/archival_has_provenance/);
    const onlyBy = await refusedFor("owner",
      `UPDATE prospects SET archived_by = $2 WHERE id = $1`, [p.id, world.ownerId]);
    expect(onlyBy).toMatch(/archival_has_provenance/);
    expect((await rowOf(p.id)).archived_at).toBeNull();
  });
});

describe("D1b · the vault arm is unchanged", () => {
  beforeEach(() => { process.env.ASCEND_PROSPECT_SOURCE = "vault"; });

  it("T16 · vault mode still DELETES the file and emits prospect.deleted — a different fact", async () => {
    await fs.writeFile(path.join(HL(), "vault-goner.md"),
      `---\nprospect_id: 01910000-0000-7000-8000-0000000fffff\nname: Vault Goner\nstatus: lead\n---\n\nbody\n`);
    const { status, body } = await archive("vault-goner", ownerToken);
    expect(status).toBe(200);
    expect(body.outcome).toBe("deleted");
    expect(body.store).toBe("vault");
    expect(await fs.readdir(HL())).not.toContain("vault-goner.md");
  });

  it("a missing vault prospect is 404, not a silent success", async () => {
    const { status, body } = await archive("never-existed", ownerToken);
    expect(status).toBe(404);
    expect(body.outcome).toBe("not_found");
  });
});
