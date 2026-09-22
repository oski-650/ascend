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
  listProspectNotes, addProspectNote, archiveProspect, resolveProspectForMutation, type SqlClient,
} from "@/core/db";
import { executeSave } from "@/core/db/sales-actions";
import { setUserCredential, verifyPassword } from "@/core/auth/credentials";
import { credentialFor, resolvePrincipal } from "@/core/auth/principal";
import { createInvitation } from "@/core/auth/invitations";
import { clearAuthorityResolver, registerAuthorityResolver } from "@/core/auth/authority";
import { adapt } from "@/tests/support/provisioned-partner";
import {
  FORMAT_V2, FORMAT_V3, MANIFEST_MEMBER, generateKey, keyForId, open, readHeader, seal, sealEnvelope, sha256,
} from "@/core/recovery/artifact";
import { resolveRecoveryContract, type ContractSelection, type RecoveryContract, type ResolutionSeams } from "@/core/recovery/contract";
import { LEGACY_CONTRACTS, type LegacyContract } from "@/core/recovery/legacy-contracts";
import {
  MANIFEST_SQL, APPLICATION_SCHEMA, COVERAGE_EXCLUSIONS, assertIsolatedEnvironment, ascendRoleStatements,
  catalogTables, compareManifests, coverageGaps, formatManifest, manifestCoverage, manifestOf, noGaps,
  parseManifest, restoreInto, sanitizeDump, verifyBehaviour, RestoreRefused, type Manifest, type RestoreTarget,
} from "@/core/recovery/restore";
import { applicationProspectCounts, prospectCountMismatches, restoredProspectCounts } from "@/tests/support/recovery-readers";
import { globalsInDumpallFormat, sessionOf, targetOf } from "@/tests/support/recovery-fixture";
import { runApplicationProfile } from "@/core/recovery/profiles";

const OWNER_EMAIL = "owner@fixture.test";
const PARTNER_EMAIL = "partner@fixture.test";
// A fixture credential for a fixture database. It proves the round trip; it opens nothing real.
const FIXTURE_PASSWORD = "fixture-owner-passphrase-r1a";

/** The canonical portable-dump flags. Asserted equal to the backup script's own invocation below. */
const PORTABLE_DUMP_ARGS = ["--schema=public", "--inserts"];

/** The fixture artifact's source commit. A fixture is not taken from a commit; this names none. */
const FIXTURE_COMMIT = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";

let workDir: string;
let keyring: string;
let source: PGlite;
let sourceManifest: Manifest;
let dumpSql: string;
let globalsSql: string;
let envelope: Buffer;
/** RT-3 · the fixture artifact's own sealed contract, resolved from the envelope like any artifact's. */
let fixtureContract: RecoveryContract;
let organizationId: string;
let ownerId: string;
/** The prospect the notes LOG was written against (the legacy body sits on a different one). */
let notedProspectId: string;
/** RT-1 · the archived prospect, carrying BOTH kinds of history (a legacy body and a log note). */
let archivedProspectId: string;

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

  // ── RT-1 · an ARCHIVED prospect that still carries history ────────────────────────────────
  // Without this row nothing in any recovery proof could tell "every prospect" from "every ACTIVE
  // prospect", and the notes check could silently stop verifying archived history. It carries a
  // legacy body AND a log note, and is archived through the application's own path — so the
  // restored artifact holds the archival columns, the note and the `prospect.archived` event exactly
  // as production would.
  archivedProspectId = (await source.query<{ id: string }>(
    `INSERT INTO prospects (id, organization_id, prospect_id, identity_state, name, notes, status, created_by)
     VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'anchored', 'Closed Diner', $2, 'closed-lost', $3)
     RETURNING id`,
    [organizationId, "Legacy body kept after archival: \"moved out of state\".", ownerId])).rows[0].id;
  await asPrincipal(db, owner.principal, (tx) =>
    addProspectNote(tx, organizationId as never, { prospect: archivedProspectId, body: "Archived — history must survive.", authorUserId: ownerId as never }));
  await asPrincipal(db, owner.principal, async (tx) => {
    const r = await resolveProspectForMutation(tx, archivedProspectId);
    if (!r.ok) throw new Error(`fixture archival target did not resolve (${r.reason})`);
    const out = await archiveProspect(tx, organizationId as never, {
      target: r.target, actorUserId: ownerId as never, correlationId: "fixture-rt1-archival" });
    if (out.state !== "archived") throw new Error(`fixture archival did not archive (${out.state})`);
  });

  // ── 2A.1b · sales actions, through the real command: a contact, a stage change and a follow-up ──
  // Gives rows to all four 010 tables (receipts, contacts, transitions, follow-ups) — nothing is
  // proven by an empty one — through the same guarded functions production will use.
  const saved = await asPrincipal(db, owner.principal, (tx) => executeSave(tx, owner.principal, {
    commandId: "0190a000-0000-7000-8000-00000000f1a0", prospect: anchored, expectedStage: "contacted",
    contact: { outcome: "spoke", channel: "call", note: "Asked for a quote — ¿mañana?" },
    stage: { to: "proposal" },
    followUp: { schedule: { action: "call", dueOn: "2026-11-01", dueAt: { local: "2026-11-01T01:30", offset: "-07:00" }, note: "the FIRST 01:30" } },
  }));
  if (saved.status !== "applied") throw new Error(`fixture save did not apply (${JSON.stringify(saved)})`);

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
  // The backup runs the manifest it is about to SEAL (RT-3) — here, the repository's, as the script does.
  sourceManifest = await manifestOf(source, MANIFEST_SQL);
  dumpSql = await (await pgDump({ pg: source, args: PORTABLE_DUMP_ARGS })).text();
  // The script's consistency rule: the manifest is taken before AND after, and must not move.
  expect(compareManifests(sourceManifest, await manifestOf(source, MANIFEST_SQL)).differing).toEqual([]);
  globalsSql = await globalsInDumpallFormat(source);

  const key = keyForId(generateKey(keyring).keyId, keyring);
  envelope = seal([
    { name: "ascend-public-portable.sql", bytes: Buffer.from(dumpSql) },
    { name: "globals-nopw.sql", bytes: Buffer.from(globalsSql) },
    { name: MANIFEST_MEMBER, bytes: Buffer.from(MANIFEST_SQL, "utf8") },
    { name: "source-manifest.tsv", bytes: Buffer.from(formatManifest(sourceManifest)) },
  ], key, { sourceCommit: FIXTURE_COMMIT, applicationProfile: "post-010-v1" });
  const opened = open(envelope, key);
  fixtureContract = resolveRecoveryContract({ envelope, ...opened });
}, 120_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(keyring, { recursive: true, force: true });
});

/**
 * Open an artifact, resolve its ONE recovery contract, restore it, and compute the restored manifest
 * with the contract's manifest — the path R1b and R1c take (tests/support/recovery-artifact.ts).
 */
async function restoreFromEnvelope(
  mutate?: (dump: string) => string,
  env: Buffer = envelope, selection: ContractSelection = {}, seams: ResolutionSeams = {},
): Promise<{ pg: PGlite; manifest: Manifest; source: Manifest; contract: RecoveryContract }> {
  const { header, files } = open(env, keyForId(readHeader(env).keyId, keyring));
  expect(header.files.map((f) => f.name)).toContain("source-manifest.tsv");
  const contract = resolveRecoveryContract({ envelope: env, header, files }, selection, seams);
  const get = (n: string) => files.find((f) => f.name === n)!.bytes.toString("utf8");
  const pg = new PGlite();
  const dump = mutate ? mutate(get("ascend-public-portable.sql")) : get("ascend-public-portable.sql");
  await restoreInto(targetOf(pg), { dump, globals: get("globals-nopw.sql") });
  return { pg, manifest: await manifestOf(pg, contract.manifestSql), source: parseManifest(get("source-manifest.tsv")), contract };
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

describe("R1a · the manifest cannot fall behind the schema (RT-2)", () => {
  // RT-2 · This used to compare the catalog with the F3 list only, and pin the count at 8 — which
  // invites "just bump the number", never checked F4 at all, and ran on the fixture only. The universe
  // is now the catalog of the MIGRATED database, and F3 (rows counted) and F4 (content digested) are
  // each held to it independently. No count is hard-coded: adding a table is caught by content, and
  // fixed by covering it, not by editing a number.
  it("every application table the migrations create is both COUNTED (F3) and DIGESTED (F4) — the universe comes from the catalog", async () => {
    const tables = await catalogTables(targetOf(source));
    const gaps = coverageGaps(tables, manifestCoverage(MANIFEST_SQL));
    expect(gaps).toEqual({ uncounted: [], undigested: [], phantom: [], staleExclusions: [] });
    expect(tables.length).toBeGreaterThan(0);
  });

  it("no migration puts an application table outside the application schema, where the manifest cannot see it", async () => {
    const outside = (await source.query<{ t: string }>(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p') AND n.nspname <> $1
          AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_%'`,
      [APPLICATION_SCHEMA])).rows.map((r) => r.t);
    expect(outside).toEqual([]);
  });

  it("the exclusion registry is empty — and any entry must state a reason", () => {
    for (const [table, reason] of Object.entries(COVERAGE_EXCLUSIONS)) {
      expect(reason.trim().length, `exclusion of ${table} gives no reason`).toBeGreaterThan(20);
    }
    expect(Object.keys(COVERAGE_EXCLUSIONS)).toEqual([]);
  });

  it("the fixture source has rows in every table — nothing is proven by an empty one", () => {
    for (const t of manifestCoverage(MANIFEST_SQL).counted) {
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
    // RT-1: the archived prospect contributes one legacy body and one log note.
    expect(restored.manifest.get("F7.notes.legacy.count")).toBe("2");
    expect(restored.manifest.get("F3.rows.prospect_notes")).toBe("3");
    expect(restored.manifest.get("F3.rows.invitations")).toBe("2");
    expect(restored.manifest.get("F4.held.count")).toBe("1");
  });

  it("F11/F14/F15/F16/F17 · security objects and provenance, stated rather than only digested", () => {
    const m = restored.manifest;
    expect(m.get("F11.rls")!.split(",").every((x) => x.endsWith(":true/true"))).toBe(true);
    expect(m.get("F11.rls")!.split(",")).toHaveLength(12);   // +4 with 010 (2A.1b)
    expect(m.get("F11.policies.count")).toBe("31");            // +9 with 010: receipts 2, contacts 1, transitions 1, follow-ups 5
    expect(m.get("F14.roles")).toContain("ascend_invite:");
    expect(m.get("F14.roles")!.split(";")).toHaveLength(6);
    expect(m.get("F14.memberships")!.split(",")).toHaveLength(5); // ascend_app > each assumable role
    expect(m.get("F15.functions")).toBe("ascend_assign_prospect,ascend_guard_actor,ascend_guard_prospect,ascend_record_contact," +
      "ascend_status_has_transition,ascend_transition_stage,current_org,current_user_id,events_are_append_only");
    expect(m.get("F15.triggers")).toBe("events_no_delete@events,events_no_update@events,prospects_status_has_transition@prospects");
    expect(m.get("F16.extension_dependencies")).toBe("0");
    const ledger = m.get("F17.ledger")!.split(",");
    expect(ledger.map((l) => l.split(":")[0])).toEqual(loadMigrations().map((x) => x.name));
    expect(ledger.filter((l) => l.endsWith(":backfilled")).map((l) => l.split(":")[0]))
      .toEqual(loadMigrations().slice(0, 3).map((x) => x.name));
    // Checksums in the ledger equal the files in the repository — the restored schema is the one git describes.
    for (const [i, mig] of loadMigrations().entries()) expect(ledger[i].split(":")[1]).toBe(mig.checksum);
  });

  it("F6/F12/F15 · behaviour: sequence advances, events stay append-only, RLS and column grants hold", async () => {
    const checks = await verifyBehaviour(targetOf(restored.pg), organizationId, restored.contract);
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
    // RT-1 · total, active and archived separately, and every note over the AUDIT reader — the same
    // helper R1b and R1c run against production, proven here on a fixture that can make it fail.
    const restoredCounts = await restoredProspectCounts(db, organizationId);
    const appCounts = await asPrincipal(db, r.principal, (tx) => applicationProspectCounts(tx));
    expect(prospectCountMismatches(appCounts, restoredCounts)).toEqual([]);
    expect(restoredCounts).toEqual({ total: 4, active: 3, archived: 1, notes: 3, notesOnArchived: 1 });
    const active = await asPrincipal(db, r.principal, (tx) => listProspects(tx));
    expect(active.map((p) => p.id)).not.toContain(archivedProspectId);
    const notes = await asPrincipal(db, r.principal, (tx) => listProspectNotes(tx, notedProspectId as never));
    expect(notes.map((n) => n.body).sort()).toEqual(["First call: interested in a quote. ¿Mañana?", "Sent the proposal.\nFollow up Friday."].sort());
    // Archived history reads back too — the archived prospect is gone from the operator's list, not
    // from the record.
    const archivedNotes = await asPrincipal(db, r.principal, (tx) => listProspectNotes(tx, archivedProspectId as never));
    expect(archivedNotes.map((n) => n.body)).toEqual(["Archived — history must survive."]);
    // Every restored event reads back through the application's event reader — the four explicit
    // ones, the three the note log appended, the archival, and the three the 2A.1b Save appended
    // (contacted, status_changed, followup_scheduled) — not merely exists as a row.
    const events = await asPrincipal(db, r.principal, (tx) => readEvents(tx));
    const rows = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM events")).rows[0].n;
    expect(events).toHaveLength(rows);
    expect(rows).toBe(11);
    expect(events.filter((e) => e.correlation_id === "0190a000-0000-7000-8000-00000000f1a0").map((e) => e.type).sort())
      .toEqual(["prospect.contacted", "prospect.followup_scheduled", "prospect.status_changed"]);
    expect(events.filter((e) => e.type === "prospect.archived")).toHaveLength(1);
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
    const m = await manifestOf(old, fixtureContract.manifestSql);
    expect(compareManifests(parseManifest(get("source-manifest.tsv")), m).differing).toContain("F13.grants.schema");
    const checks = await verifyBehaviour(targetOf(old), organizationId, fixtureContract);
    expect(checks.find((c) => c.id === "F12.owner-reads-own-org")!.ok).toBe(false);
  }, 60_000);

  it("a note body altered in transit is caught by F4", async () => {
    const d = await differs((s) => s.replace("Sent the proposal.", "Sent the proposa1."));
    expect(d).toEqual(expect.arrayContaining(["F4.digest.prospect_notes"]));
  }, 60_000);
});

describe("RT-2 · an application table left out of the manifest FAILS the recovery suite", () => {
  // The acceptance test for RT-2, run on a REAL restore of the fixture artifact: a table the manifest
  // does not cover must turn the recovery suite red, and covering it — with F3/F4 keys the manifest
  // actually COMPUTES, not names merely listed — must turn it green again.
  const PROBE = "rt2_probe_uncovered";
  const lineOf = (sql: string, key: string) =>
    sql.split("\n").find((l) => l.startsWith(`  UNION ALL SELECT '${key}'`)) ?? "";
  /** THE manifest, with `table` genuinely covered: real UNION ALL lines beside `users`' own. */
  const covering = (sql: string, table: string, { f3 = true, f4 = true } = {}) => {
    const f3Users = lineOf(sql, "F3.rows.users");
    const f4Users = lineOf(sql, "F4.digest.users");
    expect(f3Users && f4Users, "the manifest's users lines moved — update this test's anchors").toBeTruthy();
    let out = sql;
    if (f3) out = out.replace(f3Users, `${f3Users}\n  UNION ALL SELECT 'F3.rows.${table}', count(*)::text FROM ${table}`);
    if (f4) out = out.replace(f4Users, `${f4Users}\n  UNION ALL SELECT 'F4.digest.${table}', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM ${table} t`);
    return out;
  };
  // Found by mutation probe: removing the RT-2 check from `verifyBehaviour` first made this suite's
  // SETUP throw, and vitest reported the five tests as "skipped" — the exact shape of false evidence
  // the gate ledger exists to refuse. The check is now looked up INSIDE each test and a missing one is
  // a named assertion failure, so its removal is a red test, not a quiet skip.
  const rt2 = (checks: { id: string; ok: boolean; detail: string }[]) => {
    const c = checks.find((x) => x.id === "RT2.coverage-totality");
    expect(c, "verifyBehaviour no longer runs the RT-2 coverage check — every restore leg has stopped enforcing it").toBeDefined();
    return c!;
  };

  let probe: PGlite;
  let before: { id: string; ok: boolean; detail: string }[];
  beforeAll(async () => {
    probe = (await restoreFromEnvelope()).pg;
    before = await verifyBehaviour(targetOf(probe), organizationId, fixtureContract);   // captured, asserted in a test
    await probe.exec(`CREATE TABLE ${PROBE} (id int PRIMARY KEY, v text); INSERT INTO ${PROBE} VALUES (1, 'unverified')`);
  }, 120_000);
  afterAll(async () => { await probe?.close(); });

  it("BEFORE the probe table exists the restore is fully covered — so every failure below is caused by it", () => {
    expect(rt2(before).ok).toBe(true);
  });

  it("UNCOVERED: the recovery suite's behaviour checks fail, naming the table as both uncounted and undigested", async () => {
    const checks = await verifyBehaviour(targetOf(probe), organizationId, fixtureContract);
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toContain("RT2.coverage-totality");
    expect(rt2(checks).detail).toContain(`uncounted: ${PROBE}`);
    expect(rt2(checks).detail).toContain(`undigested: ${PROBE}`);
  });

  it("COUNTED but not DIGESTED still fails — F4 is held to the catalog on its own", async () => {
    const sql = covering(MANIFEST_SQL, PROBE, { f4: false });
    const gaps = coverageGaps(await catalogTables(targetOf(probe)), manifestCoverage(sql));
    expect(gaps.uncounted).toEqual([]);
    expect(gaps.undigested).toEqual([PROBE]);
    expect(rt2(await verifyBehaviour(targetOf(probe), organizationId, { ...fixtureContract, manifestSql: sql })).ok).toBe(false);
  });

  it("COVERED — F3 and F4 keys actually computed by the manifest — the suite passes again", async () => {
    const sql = covering(MANIFEST_SQL, PROBE);
    const m = await manifestOf(probe, sql);
    expect(m.get(`F3.rows.${PROBE}`)).toBe("1");
    expect(m.get(`F4.digest.${PROBE}`)).toMatch(/^[0-9a-f]{64}$/);
    const checks = await verifyBehaviour(targetOf(probe), organizationId, { ...fixtureContract, manifestSql: sql });
    expect(rt2(checks)).toMatchObject({ ok: true });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("the universe is NOT the manifest: dropping an existing table's lines from the manifest is caught too", async () => {
    const sql = MANIFEST_SQL.replace(lineOf(MANIFEST_SQL, "F3.rows.users") + "\n", "");
    expect(manifestCoverage(sql).counted).not.toContain("users");
    const gaps = coverageGaps(await catalogTables(targetOf(probe)), manifestCoverage(sql));
    expect(gaps.uncounted).toEqual(expect.arrayContaining(["users", PROBE]));
  });

  it("a manifest naming a table the database lacks is a PHANTOM, and an exclusion for a missing table is STALE", () => {
    expect(coverageGaps(["a"], { counted: ["a", "ghost"], digested: ["a", "ghost"] }).phantom).toEqual(["ghost"]);
    expect(coverageGaps(["a"], { counted: ["a"], digested: ["a"] }, { gone: "a reason long enough to be real" }).staleExclusions)
      .toEqual(["gone"]);
    expect(noGaps(coverageGaps(["a"], { counted: ["a"], digested: ["a"] }))).toBe(true);
  });
});

describe("R1b · F5 is cross-version-stable, and F2 keeps NOT NULL", () => {
  // Found in R1b: production (PostgreSQL 17.6) reported 43 constraints and the isolated restore (18.3)
  // 85 — the same 43 plus one `contype = 'n'` row per NOT NULL column, which 18 records in pg_constraint
  // and 17 does not. F5 now counts and digests relational constraints only; nullability stays F2's to
  // prove. Both halves are pinned here, on PostgreSQL 18, where the type-n rows actually exist.
  async function migrated(): Promise<PGlite> {
    const pg = new PGlite();
    for (const m of loadMigrations()) await pg.exec(m.sql);
    return pg;
  }
  const count = async (pg: PGlite, where: string) => (await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE c.relnamespace = 'public'::regnamespace ${where}`)).rows[0].n;

  it("F5 counts relational constraints only — never PostgreSQL 18's type-n NOT NULL rows", async () => {
    const pg = await migrated();
    const all = await count(pg, "");
    const typeN = await count(pg, "AND k.contype = 'n'");
    const notNullColumns = (await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0
          AND NOT a.attisdropped AND a.attnotnull`)).rows[0].n;
    // Not vacuous: this server DOES record them, one per NOT NULL column.
    expect(typeN).toBeGreaterThan(0);
    expect(typeN).toBe(notNullColumns);
    expect(Number((await manifestOf(pg, MANIFEST_SQL)).get("F5.constraints.count"))).toBe(all - typeN);
  }, 60_000);

  it("dropping a NOT NULL changes F2 and leaves both F5 keys unchanged — nullability is F2's to prove", async () => {
    const a = await migrated();
    const b = await migrated();
    await b.exec("ALTER TABLE prospects ALTER COLUMN organization_id DROP NOT NULL");
    const [ma, mb] = [await manifestOf(a, MANIFEST_SQL), await manifestOf(b, MANIFEST_SQL)];
    expect(mb.get("F2.columns.digest"), "F2 must see a lost NOT NULL").not.toBe(ma.get("F2.columns.digest"));
    expect(mb.get("F5.constraints.count")).toBe(ma.get("F5.constraints.count"));
    expect(mb.get("F5.constraints.digest")).toBe(ma.get("F5.constraints.digest"));
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
    // Name the failing tests, not just the tally: a red rehearsal must say WHICH production-leg check
    // broke, or the next person is left re-running the runner by hand to find out.
    const failing = out.split("\n").filter((l) => /^\s*(×|FAIL)\s/.test(l)).map((l) => l.trim()).join(" | ");
    expect(run.status, `${tests}${failing ? ` — ${failing}` : ""}`).toBe(0);
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

// ─── RT-3 · every artifact is verified against ITS OWN contract, never the repository's HEAD ────
//
// The defect: recovery ran the repository's CURRENT `manifest.sql` (and compared the ledger with the
// repository's CURRENT migrations) against every artifact. Migration 010 must extend the manifest, so
// the moment it lands the accepted post-009 artifact would stop being provable. These tests hold the
// fix on real restores of the fixture artifact:
//
//   · a v3 artifact verifies with the manifest SEALED in it, and a change to the repository's manifest
//     after sealing changes nothing about how it verifies
//   · a v2 artifact verifies only with a legacy contract the operator NAMES, pinned to its hash
//   · every other combination — no contract, the wrong one, forged bytes, both at once — fails closed

describe("RT-3 · recovery contracts are bound to the artifact, not to the repository", () => {
  /** The repository's manifest with one extra computed key: a manifest that genuinely differs. */
  const MARKED = MANIFEST_SQL.replace(
    "  SELECT 'meta.format', 'ascend-recovery-manifest/1'\n",
    "  SELECT 'meta.format', 'ascend-recovery-manifest/1'\n  UNION ALL SELECT 'RT3.sealed-contract-marker', 'present'\n");
  /** What the repository's manifest will look like once 010 lands: it names tables these restores lack. */
  const FUTURE_HEAD = MANIFEST_SQL.replace(
    "  UNION ALL SELECT 'F3.rows.users',",
    "  UNION ALL SELECT 'F3.rows.prospect_future_table', count(*)::text FROM prospect_future_table\n  UNION ALL SELECT 'F3.rows.users',");
  let key: Buffer;
  let members: { name: string; bytes: Buffer }[];
  let marked: Buffer;
  let legacy: Buffer;
  /** A registry entry pinning the fixture's OWN v2 artifact, built exactly like the real entries. */
  let fixtureEntry: LegacyContract;

  beforeAll(async () => {
    expect(MARKED).not.toBe(MANIFEST_SQL);
    expect(FUTURE_HEAD).not.toBe(MANIFEST_SQL);
    key = keyForId(readHeader(envelope).keyId, keyring);
    members = open(envelope, key).files.filter((f) => f.name !== "PROVENANCE.json");
    // A v3 artifact whose sealed manifest is MARKED — so the manifest it verifies with is observably not
    // the repository's. Its source manifest is what MARKED reports on the source, as a backup would take.
    const markedSource = await manifestOf(source, MARKED);
    marked = seal(members.map((f) =>
      f.name === MANIFEST_MEMBER ? { name: f.name, bytes: Buffer.from(MARKED) }
        : f.name === "source-manifest.tsv" ? { name: f.name, bytes: Buffer.from(formatManifest(markedSource)) } : f),
      key, { sourceCommit: FIXTURE_COMMIT, applicationProfile: "post-010-v1" });
    // The same fixture in the LEGACY format: no embedded manifest, no provenance.
    legacy = sealEnvelope(members.filter((f) => f.name !== MANIFEST_MEMBER), key, { format: FORMAT_V2 });
    // Shaped exactly like a real entry, but for the fixture's CURRENT schema: its ledger, the current
    // profile, and the manifest the fixture was taken with (supplied through the test seam below).
    const post009 = LEGACY_CONTRACTS.find((c) => c.id === "post-009-20260920")!;
    fixtureEntry = { ...post009, id: "fixture-v2", artifact: "fixture", artifactSha256: sha256(legacy), keyId: readHeader(legacy).keyId,
      ledger: loadMigrations().map((m) => `${m.name}:${m.checksum}`), applicationProfile: "post-010-v1",
      manifestSha256: sha256(Buffer.from(MANIFEST_SQL, "utf8")) };
  }, 120_000);

  it("2 · a NEW-FORMAT artifact verifies with its EMBEDDED manifest: contract sealed, every key matches, RT-2 holds", async () => {
    const r = await restoreFromEnvelope(undefined, marked);
    try {
      expect(readHeader(marked).format).toBe(FORMAT_V3);
      expect(r.contract).toMatchObject({ kind: "sealed", sourceCommit: FIXTURE_COMMIT, manifestSha256: sha256(Buffer.from(MARKED)) });
      expect(r.contract.manifestSql).toBe(MARKED);
      expect(r.manifest.get("RT3.sealed-contract-marker")).toBe("present");
      const c = compareManifests(r.source, r.manifest);
      expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected }).toEqual({ differing: [], missing: [], unexpected: [] });
      expect(r.manifest.get("F17.ledger")!.split(",").map((l) => l.split(":").slice(0, 2).join(":"))).toEqual(r.contract.ledger);
      // 9 · RT-2 coverage totality, with the sealed manifest and the sealed exclusions.
      const checks = await verifyBehaviour(targetOf(r.pg), organizationId, r.contract);
      expect(checks.find((x) => x.id === "RT2.coverage-totality")).toMatchObject({ ok: true });
      expect(checks.filter((x) => !x.ok)).toEqual([]);
    } finally { await r.pg.close(); }
  }, 120_000);

  it("3 · the repository's manifest changing AFTER sealing changes nothing: HEAD would fail, the sealed contract does not", async () => {
    const r = await restoreFromEnvelope(undefined, marked);
    try {
      // Verified the way it must be: green.
      expect(compareManifests(r.source, r.manifest).missing).toEqual([]);
      // Verified against the repository's manifest instead: the artifact's own key goes MISSING —
      // the check the old path would have run is a different contract, and it shows.
      expect(compareManifests(r.source, await manifestOf(r.pg, MANIFEST_SQL)).missing).toEqual(["RT3.sealed-contract-marker"]);
      // And once 010 lands, the repository's manifest cannot even run on this restore.
      await expect(manifestOf(r.pg, FUTURE_HEAD)).rejects.toThrow(/prospect_future_table/);
      // Resolution consults nothing the repository holds: the contract is the sealed text, not HEAD's.
      expect(r.contract.manifestSql).not.toBe(MANIFEST_SQL);
    } finally { await r.pg.close(); }
  }, 120_000);

  it("1 · a LEGACY artifact verifies end to end through its explicitly pinned contract (the fixture's own entry)", async () => {
    const r = await restoreFromEnvelope(undefined, legacy, { legacyContract: "fixture-v2" }, { registry: [fixtureEntry], loadLegacyManifest: () => Buffer.from(MANIFEST_SQL, "utf8") });
    try {
      expect(r.contract).toMatchObject({ kind: "legacy-pinned", id: "fixture-v2", manifestSha256: fixtureEntry.manifestSha256 });
      const c = compareManifests(r.source, r.manifest);
      expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected }).toEqual({ differing: [], missing: [], unexpected: [] });
      expect(r.manifest.get("F17.ledger")!.split(",").map((l) => l.split(":").slice(0, 2).join(":"))).toEqual([...fixtureEntry.ledger]);
      expect((await verifyBehaviour(targetOf(r.pg), organizationId, r.contract)).filter((x) => !x.ok)).toEqual([]);
    } finally { await r.pg.close(); }
  }, 120_000);

  const resolveOnly = (env: Buffer, selection: ContractSelection = {}, seams: ResolutionSeams = {}) => {
    const { header, files } = open(env, key);
    return () => resolveRecoveryContract({ envelope: env, header, files }, selection, seams);
  };

  it("7 · a legacy artifact WITHOUT a named contract fails closed — the repository's manifest is never substituted", () => {
    expect(resolveOnly(legacy)).toThrow(/no embedded recovery contract.*never substituted/s);
    expect(resolveOnly(legacy, { legacyContract: "" })).toThrow(/no embedded recovery contract/);
  });

  it("8 · the WRONG historical contract is refused: another artifact's, an unknown one, forged bytes, a wrong ledger", () => {
    // The real post-009 contract names a different artifact.
    expect(resolveOnly(legacy, { legacyContract: "post-009-20260920" })).toThrow(/pins ascend-backup-20260920T104952Z-post-009.ascbk.*the wrong contract/s);
    expect(resolveOnly(legacy, { legacyContract: "no-such-contract" })).toThrow(/no legacy contract named no-such-contract/);
    // The right entry, but the historical manifest on disk has been altered.
    const forged = () => Buffer.from(MANIFEST_SQL.replace("F5 · keys", "F5 · keyz"));
    expect(resolveOnly(legacy, { legacyContract: "fixture-v2" }, { registry: [fixtureEntry], loadLegacyManifest: forged }))
      .toThrow(/does not hash to/);
    // The right bytes, but the entry records a ledger the artifact's own source did not report.
    const current = () => Buffer.from(MANIFEST_SQL, "utf8");
    const wrongLedger = { ...fixtureEntry, ledger: fixtureEntry.ledger.slice(0, -1) };
    expect(resolveOnly(legacy, { legacyContract: "fixture-v2" }, { registry: [wrongLedger], loadLegacyManifest: current })).toThrow(/not the ledger legacy contract/);
    const wrongKey = { ...fixtureEntry, keyId: "0000000000000000" };
    expect(resolveOnly(legacy, { legacyContract: "fixture-v2" }, { registry: [wrongKey], loadLegacyManifest: current })).toThrow(/records key/);
  });

  it("provenance claims conflict: naming a legacy contract for a self-describing artifact is refused", () => {
    expect(resolveOnly(marked, { legacyContract: "post-009-20260920" })).toThrow(/carries its own recovery contract/);
  });

  it("4/5/6 · a v3 artifact whose embedded manifest, provenance or members disagree is refused before anything runs", () => {
    const opened = open(marked, key);
    const p = opened.header.provenance!;
    const reseal = (files: typeof opened.files, provenance = p) => sealEnvelope(files, key, { format: FORMAT_V3, provenance });
    const swap = (name: string, bytes: Buffer) => opened.files.map((f) => (f.name === name ? { name, bytes } : f));
    // 4 · the embedded manifest replaced by the repository's (a valid manifest, the wrong bytes)
    expect(resolveOnly(reseal(swap(MANIFEST_MEMBER, Buffer.from(MANIFEST_SQL))))).toThrow(/provenance was refused.*manifestSha256/s);
    // 5 · the header's hash re-pointed at the substituted manifest, PROVENANCE.json left alone
    const repointed = { ...p, manifestSha256: sha256(Buffer.from(MANIFEST_SQL)) };
    expect(resolveOnly(reseal(swap(MANIFEST_MEMBER, Buffer.from(MANIFEST_SQL)), repointed))).toThrow(/disagrees with the header/);
    // 6 · no provenance record, and no embedded manifest
    expect(resolveOnly(reseal(opened.files.filter((f) => f.name !== "PROVENANCE.json")))).toThrow(/has no PROVENANCE.json/);
    expect(resolveOnly(reseal(opened.files.filter((f) => f.name !== MANIFEST_MEMBER)))).toThrow(/has no recovery-manifest.sql/);
  });

  it("a sealed manifest that is not a recovery manifest is refused even when every hash agrees (bounded execution)", () => {
    const opened = open(marked, key);
    // Shaped exactly like a manifest — the WITH m(k, v) comes first — with a data-modifying CTE after it.
    const hostile = MARKED.replace("\n)\nSELECT k, coalesce(v, '') AS v FROM m", "\n), gone AS (DELETE FROM events RETURNING 1)\nSELECT k, coalesce(v, '') AS v FROM m");
    expect(hostile).not.toBe(MARKED);
    const files = opened.files.filter((f) => f.name !== "PROVENANCE.json")
      .map((f) => (f.name === MANIFEST_MEMBER ? { name: f.name, bytes: Buffer.from(hostile) } : f));
    const resealed = seal(files, key, { sourceCommit: FIXTURE_COMMIT, applicationProfile: "post-010-v1" });   // a key holder, sealing honestly-derived provenance
    expect(resolveOnly(resealed)).toThrow(/manifest refused: the query uses DELETE/);
  });
});

describe("RT-3 · the manifest runs bounded: its shape is checked, and it runs read-only and is rolled back", () => {
  const head = MANIFEST_SQL.slice(0, MANIFEST_SQL.indexOf("WITH m(k, v) AS ("));
  const body = MANIFEST_SQL.slice(MANIFEST_SQL.indexOf("WITH m(k, v) AS ("));
  let pg: PGlite;
  beforeAll(async () => { pg = (await restoreFromEnvelope()).pg; }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it.each([
    ["a data-modifying CTE", body.replace("WITH m(k, v) AS (", "WITH x AS (INSERT INTO organizations (slug, name) VALUES ('x', 'x') RETURNING 1), m(k, v) AS (")],
    ["transaction control", `COMMIT;\n${MANIFEST_SQL}`],
    ["a SET beyond the determinism settings", `SET default_transaction_read_only = off;\n${MANIFEST_SQL}`],
    ["a psql meta-command", `\\! touch /tmp/x\n${MANIFEST_SQL}`],
    ["dollar quoting", `${head}WITH m(k, v) AS (SELECT $$meta.format$$, 'ascend-recovery-manifest/1') SELECT k, v FROM m;\n`],
    ["a second query after the manifest", `${MANIFEST_SQL}SELECT 1;\n`],
    ["set_config inside the query", body.replace("SELECT 'meta.format', 'ascend-recovery-manifest/1'", "SELECT 'meta.format', set_config('search_path', 'x', true)")],
  ])("refuses %s before executing anything", async (_label, sql) => {
    await expect(manifestOf(pg, sql)).rejects.toThrow(/manifest refused/);
  });

  it("a keyword inside a string literal is not mistaken for a statement (the real manifest's own literals pass)", async () => {
    const withLiteral = MANIFEST_SQL.replace("'meta.format', 'ascend-recovery-manifest/1'",
      () => "'meta.format', 'ascend-recovery-manifest/1'\n  UNION ALL SELECT 'X.literal', 'DELETE; COMMIT; $$'");
    expect((await manifestOf(pg, withLiteral)).get("X.literal")).toBe("DELETE; COMMIT; $$");
  });

  it("anything that still reaches a write is refused by the READ ONLY transaction (lo_create here), and nothing moved", async () => {
    const count = async () => (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_largeobject_metadata")).rows[0].n;
    const before = await count();
    // Not in the lexer's word list on purpose: this proves the transaction layer, not the lexer.
    const writes = MANIFEST_SQL.replace("'meta.format', 'ascend-recovery-manifest/1'",
      "'meta.format', 'ascend-recovery-manifest/1'\n  UNION ALL SELECT 'X.w', lo_create(0)::text");
    await expect(manifestOf(pg, writes)).rejects.toThrow(/read-only transaction/);
    expect(await count()).toBe(before);
    // The session is left as it was: out of the transaction, and the manifest's SETs rolled back with it.
    expect((await pg.query<{ v: string }>("SELECT current_setting('transaction_read_only') AS v")).rows[0].v).toBe("off");
    await pg.exec("SET TimeZone = 'America/Los_Angeles'");
    await manifestOf(pg, MANIFEST_SQL);                     // which SETs TimeZone = 'UTC' — inside its transaction
    expect((await pg.query<{ v: string }>("SELECT current_setting('TimeZone') AS v")).rows[0].v).toBe("America/Los_Angeles");
    await pg.exec("RESET TimeZone");
  });
});

describe("RT-3 · the legacy registry, and the paths that use it", () => {
  it("every pinned legacy manifest is the frozen copy its hash names, and is a well-formed recovery manifest", () => {
    const ids = LEGACY_CONTRACTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of LEGACY_CONTRACTS) {
      const bytes = readFileSync(path.join(process.cwd(), "core", "recovery", "contracts", c.manifestFile));
      expect(sha256(bytes), c.id).toBe(c.manifestSha256);
      expect(c.artifactFormat).toBe(FORMAT_V2);
      expect(c.ledger.length).toBeGreaterThan(0);
      expect(c.provenanceNote.length).toBeGreaterThan(40);
    }
    expect(ids).toEqual(["pre-009-20260919", "post-009-20260920"]);
  });

  it("10 · R1b and R1c open and resolve through the ONE shared path, and neither reaches for the repository's manifest or ledger", () => {
    for (const suite of ["restore-independence.test.ts", "restore-same-version.test.ts"]) {
      const src = readFileSync(path.join(process.cwd(), "tests", "db", suite), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src, suite).toMatch(/openRecoveryArtifact\(ARTIFACT!, KEYRING!, LEGACY_CONTRACT\)/);
      expect(src, suite).toMatch(/process\.env\.ASCEND_RECOVERY_LEGACY_CONTRACT/);
      for (const banned of ["MANIFEST_SQL", "MANIFEST_TABLES", "loadMigrations", "keyForId(", "parseManifest("]) {
        expect(src.includes(banned), `${suite} uses ${banned}`).toBe(false);
      }
      for (const m of src.matchAll(/manifestOf\(([^)]*)\)/g)) expect(m[1], suite).toMatch(/contract\.manifestSql$/);
      for (const m of src.matchAll(/verifyBehaviour\(([^)]*)\)/g)) expect(m[1], suite).toMatch(/contract$/);
    }
  });

  it("10 · the shared helper resolves the contract from the artifact itself, with only the operator's named contract as input", () => {
    const src = readFileSync(path.join(process.cwd(), "tests", "support", "recovery-artifact.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/const contract = resolveRecoveryContract\(\{ envelope, header, files \}, \{ legacyContract: legacyContract \|\| undefined \}\);/);
    for (const banned of ["MANIFEST_SQL", "manifest.sql", "loadMigrations", "readFileSync(\"", "registry", "loadLegacyManifest"]) {
      expect(src.includes(banned), `recovery-artifact.ts uses ${banned}`).toBe(false);
    }
  });

  it("the runner passes the named legacy contract into the empty environment, and nothing else new", () => {
    const sh = readFileSync(path.join(process.cwd(), "scripts", "recovery-verify.sh"), "utf8");
    expect(sh).toMatch(/--legacy-contract\) LEGACY_CONTRACT="\$2"/);
    expect(sh).toMatch(/PASS\+=\(ASCEND_RECOVERY_LEGACY_CONTRACT\)/);
    // The isolation guard is unchanged: PATH and HOME plus the named variables survive, nothing else.
    expect(sh).toContain(`KEEP=" PATH HOME \${PASS[*]+\${PASS[*]}} "`);
  });

  it("the backup seals the manifest it RAN: copied from a clean HEAD, run from the work directory, sealed with the commit", () => {
    const sh = readFileSync(path.join(process.cwd(), "scripts", "backup-production.sh"), "utf8");
    expect(sh).toMatch(/git status --porcelain -- core\/recovery\/manifest\.sql core\/db\/schema/);
    expect(sh).toMatch(/git show "HEAD:\.\/core\/recovery\/manifest\.sql" > "\$WORK\/recovery-manifest\.sql"/);
    expect(sh).toMatch(/-f "\$WORK\/recovery-manifest\.sql"/);
    expect(sh).not.toMatch(/-f "\$APP_DIR\/core\/recovery\/manifest\.sql"/);
    expect(sh).toMatch(/seal --work "\$WORK" --out "\$OUT" --key-file "\$KEY_FILE" --source-commit "\$SOURCE_COMMIT"/);
  });
});

describe("RT-3B · post-010-v1 verifies the 010 history and is not vacuous", () => {
  it("passes on the restored fixture, and fails when a projection falls behind its contacts or a history table is hidden", async () => {
    const r = await restoreFromEnvelope();
    try {
      expect(r.contract.applicationProfile).toBe("post-010-v1");
      const s = sessionOf(r.pg);
      const run = () => runApplicationProfile(r.contract, { admin: s, app: s, ownerEmail: OWNER_EMAIL, ownerPassword: FIXTURE_PASSWORD });
      const good = await run();
      expect(good.checks.filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`)).toEqual([]);
      expect(good.measured.salesHistory).toEqual({ contacts: [1, 1], transitions: [1, 1], followups: [1, 1], open: [1, 1], receipts: [1, 1] });
      // A contact-date projection that no longer covers its contacts (a column 010 guards; set here by
      // the restore's superuser, which is exactly the kind of damage a restore could carry).
      await r.pg.exec("UPDATE prospects SET last_contact = '2000-01-01' WHERE last_contact IS NOT NULL");
      expect((await run()).checks.find((c) => c.id === "APP.sales-history-invariants")!.ok).toBe(false);
      // A history table the owner can no longer see.
      await r.pg.exec("DROP POLICY prospect_contacts_read ON prospect_contacts");
      expect((await run()).checks.find((c) => c.id === "APP.sales-history")!.ok).toBe(false);
    } finally { await r.pg.close(); }
  }, 120_000);
});
