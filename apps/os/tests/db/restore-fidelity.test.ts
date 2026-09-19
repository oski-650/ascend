// Dependency R1a — THE RECOVERY MECHANISM, PROVEN ON THE CURRENT SCHEMA WITH DATA IN EVERY TABLE.
//
// ─── WHY A FIXTURE LEG EXISTS ──────────────────────────────────────────────────────────────────
//
// Production holds ZERO prospect_notes and ZERO invitations (R1 pre-flight inventory). A restore of
// production can therefore only prove those tables came back EMPTY — it cannot prove a note or an
// invitation survives. So this suite builds the source itself: migrations 001–008 applied the way
// production's ledger records them (001–003 backfilled, 004–008 witnessed), `ascend_app` provisioned,
// and then every table given rows, including the awkward cases:
//
//   · notes in both stores — the legacy `prospects.notes` body (unicode, quotes, newlines) and the
//     `prospect_notes` log, written through the application's own `addProspectNote`
//   · invitations — one live and one consumed, minted through the real `createInvitation`
//   · a credential — set through the real `setUserCredential`, so the hash is genuine scrypt
//   · events with deliberate `seq` GAPS, and a sequence advanced past them
//   · a HELD prospect (NULL identity + reason), and empty string beside NULL
//
// ─── WHAT RUNS IS THE CANONICAL PATH ────────────────────────────────────────────────────────────
//
//   source manifest   core/recovery/manifest.sql — the file the backup script runs against production
//   dump              pg_dump --schema=public --inserts (pglite-tools' pg_dump; PostgreSQL 18)
//   seal / open       core/recovery/artifact.ts — AES-256-GCM, a key file outside every artifact
//   restore           core/recovery/restore.ts — into a FRESH in-process PGlite, env guard on
//   verify            the same manifest on the target, key for key; then behaviour; then the app
//
// Two stand-ins, both stated. pglite-tools ships `pg_dump` but not `pg_dumpall`, so the globals
// file here is emitted in `pg_dumpall` 18's line format from the source catalog; the parser's hold on
// the REAL format is proven separately against lines from an actual `pg_dumpall --globals-only
// --no-role-passwords` artifact. And the WASM `pg_dump` emits no `\restrict` lines where libpq's does;
// the restore strips both shapes, and R1b exercises the libpq binary against production.
//
// NOTHING HERE HAS A CONNECTION STRING. Source and target are both in-process PGlite.
//
// ─── ENVIRONMENT ───────────────────────────────────────────────────────────────────────────────
//
// The restore refuses to run while any PG* or *DATABASE_URL* variable is visible. That is the
// guarantee, not an inconvenience: run this with `npm run recovery:verify`, which starts from an
// empty environment. Run from a shell that sourced `.env.production.local`, this suite FAILS — which
// is precisely the property it exists to prove.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import {
  applyMigrations, asPrincipal, backfillLedger, listProspects, loadMigrations, provisionAppLogin, readEvents,
  listProspectNotes, addProspectNote, type SqlClient,
} from "@/core/db";
import { setUserCredential, verifyPassword } from "@/core/auth/credentials";
import { credentialFor, resolvePrincipal } from "@/core/auth/principal";
import { createInvitation } from "@/core/auth/invitations";
import { clearAuthorityResolver, registerAuthorityResolver } from "@/core/auth/authority";
import { adapt } from "@/tests/support/provisioned-partner";
import { generateKey, keyForId, open, readHeader, seal, sha256 } from "@/core/recovery/artifact";
import {
  MANIFEST_TABLES, assertIsolatedEnvironment, ascendRoleStatements, compareManifests, formatManifest, manifestOf,
  parseManifest, restoreInto, sanitizeDump, verifyBehaviour, RestoreRefused, type Manifest, type RestoreTarget,
} from "@/core/recovery/restore";

const OWNER_EMAIL = "owner@fixture.test";
const PARTNER_EMAIL = "partner@fixture.test";
// A fixture credential for a fixture database. It proves the round trip; it opens nothing real.
const FIXTURE_PASSWORD = "fixture-owner-passphrase-r1a";

/** The canonical portable-dump flags. Asserted equal to the backup script's own invocation below. */
const PORTABLE_DUMP_ARGS = ["--schema=public", "--inserts"];

function targetOf(pg: PGlite): RestoreTarget {
  return {
    kind: "pglite-in-process",
    exec: (sql) => pg.exec(sql),
    query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params as never[])).rows }),
  };
}

/** `pg_dumpall --globals-only --no-role-passwords` line format, for the Ascend roles of `pg`. */
async function globalsInDumpallFormat(pg: PGlite): Promise<string> {
  const roles = (await pg.query<{
    rolname: string; rolinherit: boolean; rolcanlogin: boolean; rolbypassrls: boolean;
  }>("SELECT rolname, rolinherit, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname LIKE 'ascend\\_%' ORDER BY rolname")).rows;
  const lines = ["--", "-- PostgreSQL database cluster dump (stand-in: see header)", "--", "SET standard_conforming_strings = on;",
    "CREATE ROLE anon;", "ALTER ROLE anon WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;"];
  for (const r of roles) {
    lines.push(`CREATE ROLE ${r.rolname};`);
    lines.push(`ALTER ROLE ${r.rolname} WITH NOSUPERUSER ${r.rolinherit ? "INHERIT" : "NOINHERIT"} NOCREATEROLE NOCREATEDB ` +
      `${r.rolcanlogin ? "LOGIN" : "NOLOGIN"} NOREPLICATION ${r.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS"};`);
  }
  const grants = (await pg.query<{ role: string; member: string; admin_option: boolean; inherit_option: boolean; set_option: boolean }>(
    `SELECT r.rolname AS role, m.rolname AS member, a.admin_option, a.inherit_option, a.set_option
       FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
      WHERE r.rolname LIKE 'ascend\\_%' ORDER BY 1, 2`)).rows;
  for (const g of grants) {
    const opts = [g.admin_option ? "ADMIN OPTION" : null, `INHERIT ${g.inherit_option ? "TRUE" : "FALSE"}`, `SET ${g.set_option ? "TRUE" : "FALSE"}`]
      .filter(Boolean).join(", ");
    lines.push(`GRANT ${g.role} TO ${g.member} WITH ${opts} GRANTED BY postgres;`);
  }
  return lines.join("\n") + "\n";
}

let workDir: string;
let keyring: string;
let source: PGlite;
let sourceManifest: Manifest;
let dumpSql: string;
let globalsSql: string;
let envelope: Buffer;
let organizationId: string;
let ownerId: string;
/** The prospect the notes LOG was written against (the legacy body sits on a different one). */
let notedProspectId: string;

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "ascend-r1a-"));
  keyring = mkdtempSync(path.join(tmpdir(), "ascend-r1a-keys-"));

  // ── the source: the current schema, applied as production's ledger says it was ─────────────
  source = new PGlite();
  const db: SqlClient = adapt(source);
  const migrations = loadMigrations();
  for (const m of migrations.slice(0, 3)) await source.exec(m.sql); // before the ledger existed
  await applyMigrations(db, migrations.slice(3));                     // witnessed by the ledger
  await backfillLedger(db, migrations.slice(0, 3).map((m) => ({
    version: m.name, appliedAt: "2026-08-20T00:00:00Z", appliedBy: "postgres",
    note: "fixture: mirrors production, where 001-003 predate the ledger and it did not witness them",
  })));
  await provisionAppLogin(db, "fixture-app-login-password");

  // ── people, credentials, memberships ──────────────────────────────────────────────────────
  organizationId = (await source.query<{ id: string }>(
    "INSERT INTO organizations (slug, name) VALUES ('fixture-org', 'Fixture — Ñandú & Co.') RETURNING id")).rows[0].id;
  ownerId = (await source.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Owner') RETURNING id", [OWNER_EMAIL])).rows[0].id;
  const partnerId = (await source.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, '') RETURNING id", [PARTNER_EMAIL])).rows[0].id;
  await source.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner'), ($3,$2,'sales')",
    [ownerId, organizationId, partnerId]);
  await setUserCredential(db, OWNER_EMAIL, FIXTURE_PASSWORD);

  // ── prospects: anchored with a legacy notes body, held, and empty-string beside NULL ───────
  await source.query(
    `INSERT INTO prospects (id, organization_id, prospect_id, identity_state, hold_reason, name, contact_email, notes, status, created_by)
     VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'anchored', NULL, 'Tacos "El Güero"', '', $2, 'lead', $3),
            (gen_random_uuid(), $1, gen_random_uuid(), 'anchored', NULL, 'Plain Roofing', NULL, NULL, 'contacted', $3),
            (gen_random_uuid(), $1, NULL, 'held', 'no identity yet: two candidate listings', 'Unresolved Bakery', NULL, '', NULL, NULL)`,
    [organizationId, "Called twice — owner said \"not now\".\nTry after 3pm; prefers WhatsApp 📱\n\ttabbed line", ownerId]);
  const anchored = (await source.query<{ id: string }>(
    "SELECT id FROM prospects WHERE identity_state = 'anchored' ORDER BY name LIMIT 1")).rows[0].id;
  notedProspectId = anchored;

  // ── the notes log, through the application's own writer ───────────────────────────────────
  const owner = await resolvePrincipal(db, ownerId);
  if (!owner.ok) throw new Error("fixture owner did not resolve");
  await asPrincipal(db, owner.principal, (tx) =>
    addProspectNote(tx, organizationId as never, { prospect: anchored, body: "First call: interested in a quote. ¿Mañana?", authorUserId: ownerId as never }));
  await asPrincipal(db, owner.principal, (tx) =>
    addProspectNote(tx, organizationId as never, { prospect: anchored, body: "Sent the proposal.\nFollow up Friday.", authorUserId: ownerId as never }));

  // ── invitations, through the real minting path: one live, one consumed ────────────────────
  await asPrincipal(db, owner.principal, (tx) =>
    createInvitation(tx, { organizationId: organizationId as never, userId: partnerId as never, createdBy: ownerId as never, ttlMs: 7 * 86_400_000 }));
  const consumed = await asPrincipal(db, owner.principal, (tx) =>
    createInvitation(tx, { organizationId: organizationId as never, userId: partnerId as never, createdBy: ownerId as never, ttlMs: 86_400_000 }));
  await source.query("UPDATE invitations SET consumed_at = now() WHERE id = $1", [consumed.id]);

  // ── events with deliberate gaps, and the sequence advanced beyond them ────────────────────
  for (const seq of [369, 370, 1024, 31384]) {
    await source.query(
      `INSERT INTO events (seq, event_id, organization_id, type, occurred_at, actor, actor_user_id, subject_entity, subject_entity_id, data)
       VALUES ($1::bigint, gen_random_uuid(), $2, 'prospect.note_added', now() - make_interval(mins => $6::int), 'operator', $3, 'prospect', $4, $5)`,
      [seq, organizationId, ownerId, anchored, JSON.stringify({ seq, nested: { list: [1, null, "ü"] }, empty: "" }), seq]);
  }
  await source.query("SELECT setval('events_seq_seq', 31384)");

  // ── the backup, as the canonical path takes it ────────────────────────────────────────────
  sourceManifest = await manifestOf(source);
  dumpSql = await (await pgDump({ pg: source, args: PORTABLE_DUMP_ARGS })).text();
  // The script's consistency rule: the manifest is taken before AND after, and must not move.
  expect(compareManifests(sourceManifest, await manifestOf(source)).differing).toEqual([]);
  globalsSql = await globalsInDumpallFormat(source);

  const key = keyForId(generateKey(keyring).keyId, keyring);
  envelope = seal([
    { name: "ascend-public-portable.sql", bytes: Buffer.from(dumpSql) },
    { name: "globals-nopw.sql", bytes: Buffer.from(globalsSql) },
    { name: "source-manifest.tsv", bytes: Buffer.from(formatManifest(sourceManifest)) },
  ], key);
}, 120_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(keyring, { recursive: true, force: true });
});

async function restoreFromEnvelope(mutate?: (dump: string) => string): Promise<{ pg: PGlite; manifest: Manifest; source: Manifest }> {
  const { header, files } = open(envelope, keyForId(readHeader(envelope).keyId, keyring));
  expect(header.files.map((f) => f.name)).toContain("source-manifest.tsv");
  const get = (n: string) => files.find((f) => f.name === n)!.bytes.toString("utf8");
  const pg = new PGlite();
  const dump = mutate ? mutate(get("ascend-public-portable.sql")) : get("ascend-public-portable.sql");
  await restoreInto(targetOf(pg), { dump, globals: get("globals-nopw.sql") });
  return { pg, manifest: await manifestOf(pg), source: parseManifest(get("source-manifest.tsv")) };
}

describe("R1a · the restore runs only where production cannot be reached", () => {
  it("this process holds no connection configuration (run via `npm run recovery:verify`)", () => {
    expect(() => assertIsolatedEnvironment()).not.toThrow();
  });

  it("refuses when any PG* variable, *DATABASE_URL* variable, or Supabase host is visible — naming, never echoing", () => {
    const secret = "postgres://postgres:do-not-print@db.example.supabase.co:5432/postgres";
    const poisoned = [{ PGHOST: "db.example.supabase.co" }, { ASCEND_DATABASE_URL_DIRECT: secret }, { SOME_VAR: secret }, { PGPASSWORD: "x" }];
    for (const env of poisoned as unknown as NodeJS.ProcessEnv[]) {
      let message = "";
      try { assertIsolatedEnvironment(env); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/refusing to restore/);
      expect(message).not.toContain("do-not-print");
      expect(message).not.toContain("example.supabase.co");
    }
  });

  it("refuses to restore into a target that already holds relations", async () => {
    const occupied = new PGlite();
    await occupied.exec("CREATE TABLE anything (x int)");
    await expect(restoreInto(targetOf(occupied), { dump: dumpSql, globals: globalsSql })).rejects.toThrow(/already holds relations/);
  });

  it("refuses a restore through any other kind of target", async () => {
    const pg = new PGlite();
    const wrong = { ...targetOf(pg), kind: "postgres-url" } as unknown as RestoreTarget;
    await expect(restoreInto(wrong, { dump: dumpSql, globals: globalsSql })).rejects.toThrow(RestoreRefused);
  });
});

describe("R1a · the manifest cannot fall behind the schema", () => {
  it("names exactly the tables the migrations create", async () => {
    const tables = (await source.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname")).rows.map((r) => r.relname);
    expect(MANIFEST_TABLES).toEqual(tables);
    expect(tables).toHaveLength(8);
  });

  it("the fixture source has rows in every table — nothing is proven by an empty one", () => {
    for (const t of MANIFEST_TABLES) {
      expect(Number(sourceManifest.get(`F3.rows.${t}`)), `${t} is empty in the fixture`).toBeGreaterThan(0);
    }
  });

  it("the test dumps with the backup script's own portable flags", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "backup-production.sh"), "utf8");
    const portable = script.split("\n").find((l) => /pg_dump .*--inserts/.test(l)) ?? "";
    for (const a of PORTABLE_DUMP_ARGS) expect(portable).toContain(a);
  });
});

describe("R1a · F1–F17: the restored database equals the source, key for key", () => {
  let restored: Awaited<ReturnType<typeof restoreFromEnvelope>>;
  beforeAll(async () => { restored = await restoreFromEnvelope(); }, 120_000);

  it("the manifest sealed into the artifact is the one taken from the source", () => {
    expect(compareManifests(sourceManifest, restored.source).differing).toEqual([]);
  });

  it("every manifest key matches — none differing, none missing, none unexpected", () => {
    const c = compareManifests(restored.source, restored.manifest);
    expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected }).toEqual({ differing: [], missing: [], unexpected: [] });
    // Every F-group of the contract is represented, so a vacuous manifest cannot pass.
    for (const f of ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F13", "F14", "F15", "F16", "F17"]) {
      expect(c.matched.some((k) => k.startsWith(`${f}.`)), `${f} has no matched key`).toBe(true);
    }
  });

  it("F6 · the gaps in seq survive, and the sequence stands where it stood", async () => {
    // The application's own writers (the note log) appended events too, so the log starts at 1; the
    // four explicit values with gaps between them are the ones that prove renumbering did not happen.
    const seqs = (await restored.pg.query<{ seq: string }>("SELECT seq::text FROM events ORDER BY seq")).rows.map((r) => r.seq);
    expect(seqs).toEqual(expect.arrayContaining(["369", "370", "1024", "31384"]));
    expect(restored.manifest.get("F6.events.seq.max")).toBe("31384");
    expect(restored.manifest.get("F6.events.seq.distinct")).toBe(restored.manifest.get("F3.rows.events"));
    expect(restored.manifest.get("F6.sequences")).toBe("events_seq_seq=31384");
  });

  it("F13 · the application roles can still reach the schema (PUBLIC USAGE survived)", () => {
    expect(restored.manifest.get("F13.grants.schema")!.split(",")).toEqual(expect.arrayContaining(["PUBLIC:USAGE"]));
  });

  it("F7/F8/F10 · notes in both stores and both invitations came back", () => {
    expect(restored.manifest.get("F7.notes.legacy.count")).toBe("1");
    expect(restored.manifest.get("F3.rows.prospect_notes")).toBe("2");
    expect(restored.manifest.get("F3.rows.invitations")).toBe("2");
    expect(restored.manifest.get("F4.held.count")).toBe("1");
  });

  it("F11/F14/F15/F16/F17 · security objects and provenance, stated rather than only digested", () => {
    const m = restored.manifest;
    expect(m.get("F11.rls")!.split(",").every((x) => x.endsWith(":true/true"))).toBe(true);
    expect(m.get("F11.rls")!.split(",")).toHaveLength(8);
    expect(m.get("F11.policies.count")).toBe("22");
    expect(m.get("F14.roles")).toContain("ascend_invite:");
    expect(m.get("F14.roles")!.split(";")).toHaveLength(6);
    expect(m.get("F14.memberships")!.split(",")).toHaveLength(5); // ascend_app > each assumable role
    expect(m.get("F15.functions")).toBe("current_org,current_user_id,events_are_append_only");
    expect(m.get("F15.triggers")).toBe("events_no_delete@events,events_no_update@events");
    expect(m.get("F16.extension_dependencies")).toBe("0");
    const ledger = m.get("F17.ledger")!.split(",");
    expect(ledger.map((l) => l.split(":")[0])).toEqual(loadMigrations().map((x) => x.name));
    expect(ledger.filter((l) => l.endsWith(":backfilled")).map((l) => l.split(":")[0]))
      .toEqual(loadMigrations().slice(0, 3).map((x) => x.name));
    // Checksums in the ledger equal the files in the repository — the restored schema is the one git describes.
    for (const [i, mig] of loadMigrations().entries()) expect(ledger[i].split(":")[1]).toBe(mig.checksum);
  });

  it("F6/F12/F15 · behaviour: sequence advances, events stay append-only, RLS and column grants hold", async () => {
    const checks = await verifyBehaviour(targetOf(restored.pg), organizationId);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual(expect.arrayContaining([
      "F6.next-seq-beyond-history", "F15.events-refuse-update", "F15.events-refuse-delete",
      "F12.owner-reads-own-org", "F12.no-org-sees-nothing", "F12.sales-cannot-delete-prospects",
      "F12.owner-cannot-read-credentials", "F12.sales-cannot-read-credentials", "F12.auth-reads-credentials",
    ]));
  });
});

describe("R1a · the application consumes the restore (core layer, read-only)", () => {
  let db: SqlClient;
  beforeAll(async () => {
    db = adapt((await restoreFromEnvelope()).pg);
    // The caller's authority comes from the RESTORED memberships — resolved on every call exactly as
    // the application does — so a restore that lost or altered a membership would be refused here.
    registerAuthorityResolver(async () => {
      const r = await resolvePrincipal(db, ownerId);
      return r.ok ? { ok: true, principal: r.principal } : { ok: false, kind: "refused", reason: r.reason };
    });
  }, 120_000);
  afterAll(() => clearAuthorityResolver());

  it("F9 · the restored credential logs in with the right password and refuses a wrong one — nothing printed", async () => {
    const cred = await credentialFor(db, OWNER_EMAIL);
    expect(cred).not.toBeNull();
    expect(await verifyPassword(FIXTURE_PASSWORD, cred!.passwordHash!)).toBe(true);
    expect(await verifyPassword(FIXTURE_PASSWORD + "x", cred!.passwordHash!)).toBe(false);
  });

  it("principal resolution, prospects, notes and events read back through the application's own readers", async () => {
    const r = await resolvePrincipal(db, ownerId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.principal.role).toBe("owner");
    const prospects = await asPrincipal(db, r.principal, (tx) => listProspects(tx));
    expect(prospects).toHaveLength(3);
    const notes = await asPrincipal(db, r.principal, (tx) => listProspectNotes(tx, notedProspectId as never));
    expect(notes.map((n) => n.body).sort()).toEqual(["First call: interested in a quote. ¿Mañana?", "Sent the proposal.\nFollow up Friday."].sort());
    // Every restored event reads back through the application's event reader — the four explicit
    // ones and the two the note log appended — not merely exists as a row.
    const events = await asPrincipal(db, r.principal, (tx) => readEvents(tx));
    const rows = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM events")).rows[0].n;
    expect(events).toHaveLength(rows);
    expect(rows).toBe(6);
  });
});

describe("R1a · the checks can fail — each corruption is caught by the key that owns it", () => {
  const differs = async (mutate: (d: string) => string) => {
    const r = await restoreFromEnvelope(mutate);
    return compareManifests(r.source, r.manifest).differing;
  };

  it("renumbering an event (the bigserial failure) is caught by F6 and F4", async () => {
    const d = await differs((s) => s.replace(/VALUES \(1024, /, "VALUES (1025, "));
    expect(d).toEqual(expect.arrayContaining(["F6.events.seq.digest", "F4.digest.events"]));
  }, 60_000);

  it("a lost policy is caught by F11", async () => {
    const d = await differs((s) => s.replace(/^CREATE POLICY prospect_notes_read[\s\S]*?;\n/m, ""));
    expect(d).toEqual(expect.arrayContaining(["F11.policies.count", "F11.policies.digest"]));
  }, 60_000);

  it("a credential that lost its hash is caught by F9", async () => {
    const d = await differs((s) => s.replace(/'scrypt\$[^']*', '([^']*)', '([^']*)'/, (_m) => _m.replace(/'scrypt\$[^']*'/, "'scrypt$0$0$0'")));
    expect(d).toEqual(expect.arrayContaining(["F9.credentials.digest"]));
  }, 60_000);

  it("the 2D runbook's `DROP SCHEMA public` restore is caught — the defect R1a found", async () => {
    const { files } = open(envelope, keyForId(readHeader(envelope).keyId, keyring));
    const get = (n: string) => files.find((f) => f.name === n)!.bytes.toString("utf8");
    // The restore module never drops `public`, so the old procedure is reproduced by hand, step for
    // step as the 2D RESTORE.md gave it: drop public, roles, then the dump.
    const old = new PGlite();
    await old.exec("DROP SCHEMA public CASCADE");
    for (const s of ascendRoleStatements(get("globals-nopw.sql"))) await old.exec(s);
    await old.exec("CREATE ROLE anon NOLOGIN");
    await old.exec(sanitizeDump(get("ascend-public-portable.sql")).sql);
    await old.exec("RESET ALL");
    const m = await manifestOf(old);
    expect(compareManifests(parseManifest(get("source-manifest.tsv")), m).differing).toContain("F13.grants.schema");
    const checks = await verifyBehaviour(targetOf(old), organizationId);
    expect(checks.find((c) => c.id === "F12.owner-reads-own-org")!.ok).toBe(false);
  }, 60_000);

  it("a note body altered in transit is caught by F4", async () => {
    const d = await differs((s) => s.replace("Sent the proposal.", "Sent the proposa1."));
    expect(d).toEqual(expect.arrayContaining(["F4.digest.prospect_notes"]));
  }, 60_000);
});

describe("R1a · roles are read from the REAL pg_dumpall format", () => {
  // Lines of this exact shape from an actual `pg_dumpall --globals-only --no-role-passwords`
  // artifact (2026-08-31): Ascend roles, their attributes, and memberships to Ascend AND to platform
  // roles. Role DDL only — the artifact was taken without passwords and carries none.
  const REAL = [
    "\\restrict AAAA",
    "CREATE ROLE ascend_app;",
    "ALTER ROLE ascend_app WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;",
    "CREATE ROLE ascend_owner;",
    "ALTER ROLE ascend_owner WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;",
    "GRANT ascend_owner TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;",
    "GRANT ascend_owner TO ascend_app WITH INHERIT FALSE GRANTED BY postgres;",
    "GRANT authenticated TO authenticator GRANTED BY supabase_admin;",
    "\\unrestrict AAAA",
  ].join("\n");

  it("keeps Ascend's roles and Ascend-to-Ascend memberships, and nothing of the platform", () => {
    expect(ascendRoleStatements(REAL)).toEqual([
      "CREATE ROLE ascend_app;",
      "ALTER ROLE ascend_app WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;",
      "CREATE ROLE ascend_owner;",
      "ALTER ROLE ascend_owner WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;",
      "GRANT ascend_owner TO ascend_app WITH INHERIT FALSE;",
    ]);
  });

  it("refuses a globals file that carries a role password", () => {
    expect(() => ascendRoleStatements(REAL + "\nALTER ROLE ascend_app WITH LOGIN PASSWORD 'SCRAM-SHA-256$4096:x';"))
      .toThrow(/role password/);
  });

  it("strips libpq's \\restrict guard and Supabase's default-ACL lines, and refuses COPY dumps", () => {
    const s = sanitizeDump("\\restrict X\nALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;\nSELECT 1;\n\\unrestrict X");
    expect(s).toMatchObject({ metaLines: 2, platformAclLines: 1 });
    expect(() => sanitizeDump("COPY public.users (id) FROM stdin;")).toThrow(/--inserts/);
  });
});

describe("R1a · REHEARSAL of the R1b procedure, against a fixture artifact", () => {
  it("the production-leg suite passes end to end through the real runner — no test skipped", () => {
    // Exactly what R1b will do with the production artifact, done with this suite's fixture instead:
    // the sealed envelope on disk beside its .sha256, the key in a keyring by id, and
    // `scripts/recovery-verify.sh --artifact … --owner-email …` restoring it in an emptied
    // environment. The password travels in the environment, as the runner documents.
    const artifact = path.join(workDir, "ascend-backup-fixture.ascbk");
    writeFileSync(artifact, envelope, { mode: 0o600 });
    writeFileSync(`${artifact}.sha256`, `${sha256(envelope)}  ascend-backup-fixture.ascbk\n`);
    const run = spawnSync("bash", ["scripts/recovery-verify.sh", "--only-artifact",
      "--artifact", artifact, "--keyring", keyring, "--owner-email", OWNER_EMAIL], {
      cwd: process.cwd(), encoding: "utf8", timeout: 170_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ASCEND_RECOVERY_OWNER_PASSWORD: FIXTURE_PASSWORD } as unknown as NodeJS.ProcessEnv,
    });
    const out = (run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, "");
    expect(out, "the fixture password must never appear in the runner's output").not.toContain(FIXTURE_PASSWORD);
    const tests = /Tests\s+(.*)/.exec(out)?.[1] ?? out.slice(-400);
    expect(run.status, tests).toBe(0);
    expect(tests).toMatch(/^\d+ passed/);
    expect(tests).not.toMatch(/skipped|failed/);
  }, 180_000);
});

describe("R1a · the artifact never carries its key", () => {
  it("no encoding of the key appears anywhere in the sealed artifact", () => {
    const key = keyForId(readHeader(envelope).keyId, keyring);
    for (const form of [key, Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex"))]) {
      expect(envelope.includes(form)).toBe(false);
    }
    expect(sha256(envelope)).toMatch(/^[0-9a-f]{64}$/);
  });
});
