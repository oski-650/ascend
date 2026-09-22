// Dependency D1a — PROSPECT MUTATIONS AGAINST THE STORE THAT OWNS THEM.
//
// Drives the REAL route handlers (`promote`, `DELETE`) through the real admission chain — session
// cookie → `withRequestContext` → membership-resolved principal — against an in-process PGlite
// carrying migrations 001–008 and a throwaway vault. The deployed configuration is
// `ASCEND_PROSPECT_SOURCE=postgres`; the vault arm is exercised separately.
//
// ─── WHAT THIS SUITE IS FOR ────────────────────────────────────────────────────────────────────
//
// Before D1a there was NO behavioural test of promotion or deletion at all: the route matrix asserted
// status codes, and nothing observed which store changed. The pre-flight probe then measured what the
// shipping code actually did, and every finding below is one of those defects, now pinned:
//
//   P1  a Postgres-owned promotion created a PHANTOM vault file and left the row `lead`
//   P2  a retry with a different client slug created a SECOND client
//   P4  deleting a Postgres-owned prospect 404'd, or "deleted" it while the row survived
//   P5  a "successful" deletion removed only the 2E rollback mirror
//   P6  an unreadable vault file was OVERWRITTEN with a stub, destroying its anchor and body
//   P7  two rows sharing a slug were promoted by first match
//
// Each `M#` names the mutation probe in docs/DEPENDENCY-D1-CONTRACT.md §9 it stands for. The suite is
// written so that removing the D1a mechanism it guards turns it red — that is checked by hand at the
// end of the slice, and the results are recorded in the checkpoint.
//
// PRINTS: counts, states and booleans. No row content beyond fixture names this file wrote itself.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { clearAuthorityResolver, registerAuthorityResolver } from "@/core/auth/authority";
import { bindAuthorityResolver } from "@/lib/authority";
import type { SqlClient } from "@/core/db";
import { createClient, createProspect, deleteVaultProspect } from "@/core/crm";
import { resolvePrincipal } from "@/core/auth/principal";
import { VaultProspectWriteRefused } from "@/core/crm/source";
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

const HL = () => path.join(vault, "02 - Sales & Hit List");
const CRM = () => path.join(vault, "01 - CRM & Clients");

// ─── helpers ───────────────────────────────────────────────────────────────────────────────────

type PromoteBody = {
  outcome?: string;
  error?: string;
  client?: { slug: string | null; clientId: string | null; state: string; reason?: string };
  prospect?: { state: string; reason?: string };
  operation?: { prospectId: string | null; correlationId: string; store: string };
  retry?: string;
  project?: { state: string; reason?: string };
  refusal?: { code: string; message: string };
};

async function promote(ref: string, token: string, body: Record<string, unknown> = {}) {
  const mod = await import("@/app/api/prospects/[slug]/promote/route");
  const res = await mod.POST(
    requestAs(token, `https://os.test/api/prospects/${ref}/promote`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as PromoteBody };
}

async function del(ref: string, token: string) {
  const mod = await import("@/app/api/prospects/[slug]/route");
  const res = await mod.DELETE(
    requestAs(token, `https://os.test/api/prospects/${ref}`, { method: "DELETE" }),
    { params: Promise.resolve({ slug: ref }) }
  );
  return { status: res.status, body: (await res.json()) as { outcome?: string; error?: string } };
}

/** A fingerprint of the whole hit list: names AND bytes. The vault-untouched assertion (M1). */
async function hitListHash(): Promise<string> {
  const h = createHash("sha256");
  for (const f of (await fs.readdir(HL()).catch(() => [] as string[])).sort()) {
    h.update(f).update(await fs.readFile(path.join(HL(), f)));
  }
  return h.digest("hex");
}

const clientDirs = async () => (await fs.readdir(CRM()).catch(() => [] as string[])).filter((d) => !d.startsWith("."));
const allEntries = async () => (await fs.readdir(CRM()).catch(() => [] as string[]));

const rowOf = async (ref: string) =>
  (await pg.query<{ status: string | null; id: string }>(
    "SELECT status, id FROM prospects WHERE slug = $1 OR id::text = $1", [ref])).rows[0];

const eventsFor = async (prospectId: string, type = "prospect.promoted") =>
  (await pg.query<{ n: number; actor: string; actor_user_id: string | null; correlation_id: string | null }>(
    `SELECT count(*)::int AS n, max(actor) AS actor, max(actor_user_id::text) AS actor_user_id,
            max(correlation_id) AS correlation_id
       FROM events WHERE type = $1 AND subject_entity = 'prospect' AND subject_entity_id = $2`,
    [type, prospectId])).rows[0];

const notesOf = async (rowId: string) =>
  (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM prospect_notes WHERE prospect = $1", [rowId])).rows[0].n;

const metaOf = async (slug: string) =>
  JSON.parse(await fs.readFile(path.join(CRM(), slug, "structural_meta.json"), "utf8")) as Record<string, unknown>;

let seq = 0;
/** A Postgres prospect. `slug: null` mirrors production, where 3,102 of 3,108 rows have no slug. */
async function seedRow(opts: { slug: string | null; held?: boolean; withNote?: boolean; status?: string }) {
  seq++;
  const anchor = `01900000-0000-7000-8000-0000000${String(seq).padStart(5, "0")}`;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'call log body') RETURNING id`,
    [world.organizationId, opts.held ? null : anchor, opts.held ? "held" : "anchored",
     opts.held ? "two records, one business" : null, opts.slug, `Biz ${seq}`, opts.status ?? "lead"]);
  const id = r.rows[0].id;
  if (opts.withNote) {
    await pg.query(
      `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body)
       VALUES (gen_random_uuid(), $1, $2, $3, 'called, interested')`,
      [world.organizationId, id, world.ownerId]);
  }
  // The reference a route receives is the reader's own addressing: `slug ?? id`.
  return { id, anchor: opts.held ? null : anchor, ref: opts.slug ?? id };
}

async function seedVaultProspect(slug: string, anchor: string) {
  await fs.writeFile(path.join(HL(), `${slug}.md`),
    `---\nprospect_id: ${anchor}\nname: Vault ${slug}\nstatus: lead\n---\n\nvault sales history\n`);
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
    orgSlug: "d1-org", ownerEmail: "d1-owner@test", partnerEmail: "d1-sales@test",
    password: "a-sufficiently-long-d1-suite-password",
  });
  world = partner.world;
  salesToken = partner.login.sessionToken!;
  ownerToken = await tokenFor(world.ownerId);
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

// ─── the deployed configuration: Postgres owns prospects ───────────────────────────────────────

describe("D1a · Postgres-owned promotion", () => {
  it("M1 · marks the ROW, records the event on the Postgres spine, and leaves the vault untouched", async () => {
    const p = await seedRow({ slug: null, withNote: true });
    const before = await hitListHash();

    const { status, body } = await promote(p.ref, ownerToken, { client_slug: "acme-co" });

    expect(status).toBe(200);
    expect(body.outcome).toBe("promoted");
    expect(body.prospect).toMatchObject({ state: "marked" });
    expect(body.client).toMatchObject({ slug: "acme-co", state: "created" });
    // The row — the thing every reader actually reads.
    expect((await rowOf(p.ref)).status).toBe("closed-won");
    // The event, on the store that owns prospects, attributed to the human who asked (M10).
    const ev = await eventsFor(p.anchor!);
    expect(ev.n).toBe(1);
    expect(ev.actor).toBe("operator");
    expect(ev.actor_user_id).toBe(world.ownerId);
    expect(ev.correlation_id).toBe(body.operation!.correlationId);
    // Identity is the ANCHOR, not the slug or the surrogate id.
    expect(body.operation!.prospectId).toBe(p.anchor);
    expect(await metaOf("acme-co")).toMatchObject({ promoted_from_prospect_id: p.anchor });
    // THE VAULT IS NOT TOUCHED. Pre-D1a this created a phantom hit-list file (P1).
    expect(await hitListHash()).toBe(before);
    // Notes are retained, on the prospect, untouched by promotion.
    expect(await notesOf(p.id)).toBe(1);
  });

  it("M2 · a retry — with any client slug — reuses the same client and appends no second event", async () => {
    const p = await seedRow({ slug: "retry-target", withNote: true });
    const first = await promote(p.ref, ownerToken, { client_slug: "retry-client" });
    expect(first.body.outcome).toBe("promoted");

    const same = await promote(p.ref, ownerToken, { client_slug: "retry-client" });
    const different = await promote(p.ref, ownerToken, { client_slug: "a-completely-different-slug" });

    // Pre-D1a: 409 for the first (though it had succeeded), and a SECOND CLIENT for the second (P2).
    expect(same.status).toBe(200);
    expect(same.body.outcome).toBe("already_promoted");
    expect(different.status).toBe(200);
    expect(different.body.outcome).toBe("already_promoted");
    expect(different.body.client).toMatchObject({ slug: "retry-client", state: "existing" });
    expect((await clientDirs()).filter((d) => d.includes("different"))).toEqual([]);
    expect((await eventsFor(p.anchor!)).n).toBe(1);
    expect(await notesOf(p.id)).toBe(1);
  });

  it("M5 · the status change and its event are ONE transaction — a failing event rolls the mark back", async () => {
    const p = await seedRow({ slug: null });
    // A trigger that refuses this event. The status UPDATE has already run in the same transaction.
    await pg.exec(`CREATE FUNCTION refuse_promo_event() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN RAISE EXCEPTION 'injected: event append failed'; END $$;
                   CREATE TRIGGER refuse_promo_event BEFORE INSERT ON events
                     FOR EACH ROW WHEN (NEW.type = 'prospect.promoted') EXECUTE FUNCTION refuse_promo_event();`);
    let after;
    try {
      const { status, body } = await promote(p.ref, ownerToken, { client_slug: "atomic-co" });
      expect(status).toBe(202);
      expect(body.outcome).toBe("incomplete");
      expect(body.prospect!.state).toBe("not_marked");
      expect(body.retry).toBe("safe");
      after = await rowOf(p.ref);
    } finally {
      await pg.exec("DROP TRIGGER refuse_promo_event ON events; DROP FUNCTION refuse_promo_event();");
    }
    // NOT marked: the event's failure took the status with it.
    expect(after!.status).toBe("lead");
    expect((await eventsFor(p.anchor!)).n).toBe(0);
    // And the retry converges on the client that already exists.
    const retry = await promote(p.ref, ownerToken, { client_slug: "atomic-co" });
    expect(retry.body.outcome).toBe("promoted");
    expect(retry.body.client).toMatchObject({ slug: "atomic-co", state: "existing" });
    expect((await rowOf(p.ref)).status).toBe("closed-won");
    expect((await eventsFor(p.anchor!)).n).toBe(1);
  });

  it("M4 · a failure of the status write after the client is created reports INCOMPLETE, and the retry finishes it", async () => {
    const p = await seedRow({ slug: null });
    // INJECTED AT THE CLIENT, not at the lease: inside a route handler `withProspectDb` reuses the
    // connection the request already holds, so there is no second lease to fail. This fails exactly
    // the prospect UPDATE — the shape of a mid-promotion database failure — and nothing else. After
    // 010 (2A.1b) the stage is written only inside `ascend_transition_stage`, so that call is the
    // status write; the injection matches both shapes.
    const failing: SqlClient = {
      query: (sql, params) => /UPDATE prospects|ascend_transition_stage/.test(sql)
        ? Promise.reject(new Error("injected: the status write failed"))
        : db.query(sql, params),
      exec: (sql) => db.exec(sql),
      transaction: (fn) => db.transaction((tx) => fn({
        query: (sql, params) => /UPDATE prospects|ascend_transition_stage/.test(sql)
          ? Promise.reject(new Error("injected: the status write failed"))
          : tx.query(sql, params),
        exec: tx.exec.bind(tx),
        transaction: tx.transaction.bind(tx),
      })),
    };
    registerAppDb((fn) => fn(failing));
    const { status, body } = await promote(p.ref, ownerToken, { client_slug: "incomplete-co" });
    expect(status).toBe(202);
    expect(body.outcome).toBe("incomplete");
    expect(body.client).toMatchObject({ slug: "incomplete-co", state: "created" });
    expect(body.prospect!.state).toBe("not_marked");
    expect(body.retry).toBe("safe");

    registerAppDb((fn) => fn(db));
    const retry = await promote(p.ref, ownerToken, { client_slug: "incomplete-co" });
    expect(retry.body.outcome).toBe("promoted");
    expect(retry.body.client!.state).toBe("existing");
    expect((await clientDirs()).filter((d) => d === "incomplete-co")).toHaveLength(1);
    expect((await eventsFor(p.anchor!)).n).toBe(1);
  });

  it("M6 · a failure during the client write leaves NO visible client, and the retry succeeds", async () => {
    const p = await seedRow({ slug: null });
    await fs.chmod(CRM(), 0o500); // read-only: the staged write cannot be created
    let failed = false;
    try {
      const { status } = await promote(p.ref, ownerToken, { client_slug: "staged-co" });
      failed = status >= 500;
    } finally {
      await fs.chmod(CRM(), 0o755);
    }
    expect(failed, "the client write did not fail as intended").toBe(true);
    // No half-written client, and nothing staged left visible.
    expect(await clientDirs()).not.toContain("staged-co");
    expect((await allEntries()).filter((d) => d.startsWith(".staging-"))).toEqual([]);
    expect((await rowOf(p.ref)).status).toBe("lead");

    const retry = await promote(p.ref, ownerToken, { client_slug: "staged-co" });
    expect(retry.body.outcome).toBe("promoted");
    expect(await clientDirs()).toContain("staged-co");
  });

  it("M6b · a failure PARTWAY THROUGH the client write leaves nothing visible and nothing staged", async () => {
    // M6 above fails before the first byte is written, so it cannot tell a staged write from an
    // in-place one — measured: replacing the staging directory with the live client directory left
    // it green. This one fails on the FOURTH file, after three are already on disk, which is exactly
    // the state that used to produce a permanently un-retryable `client_exists` folder.
    //
    // It calls `createClient` directly so the correlation id — and therefore the staging path — is
    // known in advance; the obstacle is a DIRECTORY where the meta file must go.
    const resolution = await resolvePrincipal(db, world.ownerId);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    registerAuthorityResolver(async () => ({ ok: true, principal: resolution.principal }));
    const correlationId = "m6b-correlation";
    const staging = path.join(CRM(), `.staging-partial-co-${correlationId}`);
    await fs.mkdir(path.join(staging, "structural_meta.json"), { recursive: true });
    try {
      const file = { frontmatter: { name: "Partial" }, body: "body" };
      await expect(createClient(
        { slug: "partial-co", business: file, brand: file, scope: file, meta: { client_id: "partial-co" } },
        { correlationId }
      )).rejects.toBeTruthy();
    } finally {
      clearAuthorityResolver();
      await fs.rm(staging, { recursive: true, force: true });
    }
    // Nothing visible, nothing left staged, and no event claiming a client that does not exist.
    expect(await clientDirs()).not.toContain("partial-co");
    expect((await allEntries()).filter((d) => d.startsWith(".staging-"))).toEqual([]);
    const log = await fs.readFile(path.join(vault, ".ascend-os", "crm.events.jsonl"), "utf8").catch(() => "");
    expect(log).not.toContain("partial-co");
  });

  it("M7 · an ambiguous reference is refused, and nothing is written anywhere", async () => {
    await seedRow({ slug: "twin" });
    const second = await seedRow({ slug: "twin" });
    const clientsBefore = (await clientDirs()).length;
    const vaultBefore = await hitListHash();

    const { status, body } = await promote("twin", ownerToken, { client_slug: "twin-client" });

    expect(status).toBe(409);
    expect(body.outcome).toBe("refused");
    expect(body.refusal!.code).toBe("ambiguous_prospect");
    expect((await clientDirs()).length).toBe(clientsBefore);
    expect(await hitListHash()).toBe(vaultBefore);
    expect((await rowOf(second.id)).status).toBe("lead");
  });

  it("M8 · a HELD prospect is refused — it has no anchor to key a promotion on", async () => {
    const held = await seedRow({ slug: "held-biz", held: true });
    const clientsBefore = (await clientDirs()).length;
    for (const token of [ownerToken, salesToken]) {
      const { status, body } = await promote(held.ref, token, { client_slug: "held-client" });
      expect(status).toBe(409);
      expect(body.refusal!.code).toBe("held_prospect");
    }
    expect((await clientDirs()).length).toBe(clientsBefore);
    expect((await rowOf("held-biz")).status).toBe("lead");
  });

  it("refuses an unknown reference with 404 and writes nothing", async () => {
    const before = await clientDirs();
    const { status, body } = await promote("no-such-prospect", ownerToken);
    expect(status).toBe(404);
    expect(body.refusal!.code).toBe("prospect_not_found");
    expect(await clientDirs()).toEqual(before);
  });

  it("M10 · a SALES principal promotes through the same path, attributed to the sales user", async () => {
    const p = await seedRow({ slug: null, withNote: true });
    const { status, body } = await promote(p.ref, salesToken, { client_slug: "sales-promoted-co" });
    expect(status).toBe(200);
    expect(body.outcome).toBe("promoted");
    const ev = await eventsFor(p.anchor!);
    expect(ev.n).toBe(1);
    expect(ev.actor_user_id).toBe(world.partnerId);
    expect((await rowOf(p.ref)).status).toBe("closed-won");
    expect(await notesOf(p.id)).toBe(1);
  });

  it("a failed project scaffold is reported, not swallowed — and the promotion still stands", async () => {
    const p = await seedRow({ slug: null });
    const { status, body } = await promote(p.ref, ownerToken, { client_slug: "no-template-co" });
    expect(status).toBe(200);
    expect(body.outcome).toBe("promoted");
    // The seeded vault has no production template, so scaffolding fails and says so.
    expect(body.project!.state).toBe("failed");
    expect(body.project!.reason).toBeTruthy();
  });
});

describe("D1b · Postgres-owned removal ARCHIVES — the D1a refusal is gone", () => {
  // D1a answered 409 `unsupported` here on purpose, naming this dependency: archival needed
  // migration 009, and a hard DELETE would have cascade-deleted the prospect's notes. 009 exists, so
  // the refusal is replaced by the operation it was standing in for. The assertions that mattered
  // are UNCHANGED in substance — the notes survive and the vault is not touched — which is the
  // point: what changed is that the prospect now actually leaves the hit list.
  it("M9 · archives for owner AND sales; notes survive, vault untouched, repeat is idempotent", async () => {
    const vaultBefore = await hitListHash();

    const forOwner = await seedRow({ slug: "archive-me-owner", withNote: true });
    const first = await del(forOwner.ref, ownerToken);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("archived");
    // The note is still there. A hard DELETE would have taken it via ON DELETE CASCADE (008).
    expect(await notesOf(forOwner.id)).toBe(1);

    // Idempotent: the compare-and-set keys on the state, so a repeat converges rather than
    // appending a second event or overwriting the first archiver.
    const repeat = await del(forOwner.ref, ownerToken);
    expect(repeat.status).toBe(200);
    expect(repeat.body.outcome).toBe("already_archived");

    // Sales holds prospects:identity AND, after 009, column UPDATE on the two archive columns.
    const forSales = await seedRow({ slug: "archive-me-sales", withNote: true });
    const bySales = await del(forSales.ref, salesToken);
    expect(bySales.status).toBe(200);
    expect(bySales.body.outcome).toBe("archived");
    expect(await notesOf(forSales.id)).toBe(1);

    expect(await hitListHash()).toBe(vaultBefore);
  });

  it("M9 · archiving a Postgres-owned prospect does not touch the 2E vault mirror", async () => {
    const p = await seedRow({ slug: "mirrored", withNote: true });
    await seedVaultProspect("mirrored", p.anchor!);
    const { status, body } = await del("mirrored", ownerToken);
    expect(status).toBe(200);
    expect(body.outcome).toBe("archived");
    // Pre-D1a this removed the rollback copy and reported success (P5). The mirror is not ours to
    // unlink, and archival never falls back to the vault.
    expect(await fs.access(path.join(HL(), "mirrored.md")).then(() => true, () => false)).toBe(true);
    await fs.rm(path.join(HL(), "mirrored.md"));
  });
});

describe("D1a · the writer-side guard", () => {
  it("M11 · every vault prospect writer refuses while Postgres owns prospects", async () => {
    await expect(createProspect("guarded", "---\nname: Guarded\n---\n\nbody\n"))
      .rejects.toBeInstanceOf(VaultProspectWriteRefused);
    await expect(deleteVaultProspect("guarded")).rejects.toBeInstanceOf(VaultProspectWriteRefused);
    // Nothing reached the vault: the refusal precedes every write.
    expect(await fs.readdir(HL())).not.toContain("guarded.md");
  });
});

// ─── the vault arm: still correct, and no longer destructive ───────────────────────────────────

describe("D1a · vault-owned prospects (ASCEND_PROSPECT_SOURCE=vault)", () => {
  beforeEach(() => { process.env.ASCEND_PROSPECT_SOURCE = "vault"; });

  it("promotes the file it owns, and records it on the vault spine", async () => {
    await seedVaultProspect("vault-biz", "01900000-0000-7000-8000-00000000aaaa");
    const { status, body } = await promote("vault-biz", ownerToken, { client_slug: "vault-client" });
    expect(status).toBe(200);
    expect(body.outcome).toBe("promoted");
    expect(body.operation!.store).toBe("vault");
    const md = await fs.readFile(path.join(HL(), "vault-biz.md"), "utf8");
    expect(md).toMatch(/status: closed-won/);
    expect(md).toContain("01900000-0000-7000-8000-00000000aaaa"); // the anchor survives the rewrite
  });

  it("M12 · an UNREADABLE prospect file is never overwritten — the pre-D1a stub-write is gone", async () => {
    await seedVaultProspect("fragile", "01900000-0000-7000-8000-00000000bbbb");
    const file = path.join(HL(), "fragile.md");
    const before = await fs.readFile(file, "utf8");
    await fs.chmod(file, 0o000);
    let body: PromoteBody;
    try {
      ({ body } = await promote("fragile", ownerToken, { client_slug: "fragile-client" }));
    } finally {
      await fs.chmod(file, 0o644);
    }
    // REFUSED, and that is the honest answer: the file could not be read, so nothing was written at
    // all — no client, no mark, and above all no rewrite of the file itself.
    expect(body!.outcome).toBe("refused");
    expect(body!.refusal!.code).toBe("prospect_unreadable");
    expect(await clientDirs()).not.toContain("fragile-client");
    // The file still holds everything it held: anchor, name and body (P6 destroyed all three).
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("never CREATES a hit-list file for a prospect that has none", async () => {
    // The vault reader answers 404 first, so nothing is written and no client is made.
    const before = await hitListHash();
    const { status, body } = await promote("not-in-the-vault", ownerToken, { client_slug: "phantom-client" });
    expect(status).toBe(404);
    expect(body.refusal!.code).toBe("prospect_not_found");
    expect(await hitListHash()).toBe(before);
  });

  it("deletes the file it owns AND emits prospect.deleted", async () => {
    await seedVaultProspect("deletable", "01900000-0000-7000-8000-00000000cccc");
    const { status, body } = await del("deletable", ownerToken);
    expect(status).toBe(200);
    expect(body.outcome).toBe("deleted");
    expect(await fs.readdir(HL())).not.toContain("deletable.md");
    const log = await fs.readFile(path.join(vault, ".ascend-os", "crm.events.jsonl"), "utf8");
    const deleted = log.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { type: string; subject: { entity_id: string } })
      .filter((e) => e.type === "prospect.deleted" && e.subject.entity_id === "deletable");
    expect(deleted).toHaveLength(1);
  });

  it("a missing file is a 404, and emits nothing", async () => {
    const { status, body } = await del("never-existed", ownerToken);
    expect(status).toBe(404);
    expect(body.outcome).toBe("not_found");
  });
});
