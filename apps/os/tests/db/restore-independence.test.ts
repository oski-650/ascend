// Dependency R1 — THE CURRENT PRODUCTION RECOVERY POINT, RESTORED WITHOUT SUPABASE.
//
// The fixture leg (`restore-fidelity.test.ts`) proves the MECHANISM on the current schema with every
// table populated. This suite proves the ARTIFACT: the actual encrypted backup of production, opened
// with the key it names, restored into an in-process PGlite — a vanilla PostgreSQL with no Supabase
// platform, no network and no path back to production — and held to F1–F18 against the manifest
// production itself produced at dump time.
//
// ─── IT HAS NO EVIDENCE UNTIL R1b ──────────────────────────────────────────────────────────────
//
// The previous version of this suite last ran on 2026-08-28 against schema 004 with zero business
// rows, and was still counted PROVEN. That evidence is not carried forward. This suite is PROVEN only
// when it has run against a CURRENT artifact; until R1b produces one, its entry in the gate manifest
// fails the environment check on purpose.
//
// ─── HOW TO RUN IT ─────────────────────────────────────────────────────────────────────────────
//
//   npm run recovery:verify -- --artifact ~/AscendBackups/ascend-backup-<TS>.ascbk --owner-email <email>
//
// That runner starts from an EMPTY environment, reads only the owner password (never printed), and
// passes nothing that could reach a database. This suite additionally refuses to run if any PG* or
// *DATABASE_URL* variable is visible.
//
// ─── WHAT IT PRINTS ────────────────────────────────────────────────────────────────────────────
//
// Key names, counts and pass/fail. A differing manifest key is reported by NAME. No row, hash, token,
// password or key is printed, logged or written anywhere.
//
// ─── NOT A SAME-VERSION PROOF ──────────────────────────────────────────────────────────────────
//
// PGlite 0.5.8 is PostgreSQL 18.3; production is 17.6. This proves the artifact restores onto a newer
// major version — the ordinary upgrade direction. A 17→17 restore and a server-level boot are R1c,
// which the owner has made REQUIRED before PostgreSQL disaster recovery is called production-proven.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { asPrincipal, loadMigrations, readEvents, type SqlClient } from "@/core/db";
import { verifyPassword } from "@/core/auth/credentials";
import { credentialFor, resolvePrincipal } from "@/core/auth/principal";
import { clearAuthorityResolver, registerAuthorityResolver } from "@/core/auth/authority";
import { adapt } from "@/tests/support/provisioned-partner";
import { applicationProspectCounts, prospectCountMismatches, restoredProspectCounts } from "@/tests/support/recovery-readers";
import { keyForId, open, readHeader, sha256 } from "@/core/recovery/artifact";
import {
  assertIsolatedEnvironment, compareManifests, manifestOf, parseManifest, restoreInto, verifyBehaviour,
  type Manifest, type RestoreReport, type RestoreTarget,
} from "@/core/recovery/restore";

const ARTIFACT = process.env.ASCEND_BACKUP_ARTIFACT;
const KEYRING = process.env.ASCEND_BACKUP_KEYRING;
const OWNER_EMAIL = process.env.ASCEND_RECOVERY_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.ASCEND_RECOVERY_OWNER_PASSWORD;

const available = Boolean(ARTIFACT && KEYRING && OWNER_EMAIL && OWNER_PASSWORD && existsSync(ARTIFACT));
const describeIfArtifact = available ? describe : describe.skip;

describeIfArtifact("RESTORE INDEPENDENCE — the current production artifact, rebuilt on vanilla PostgreSQL", () => {
  let pg: PGlite;
  let target: RestoreTarget;
  let source: Manifest;
  let restored: Manifest;
  let report: RestoreReport;
  let envelope: Buffer;

  beforeAll(async () => {
    assertIsolatedEnvironment();
    envelope = readFileSync(ARTIFACT!);
    const { files } = open(envelope, keyForId(readHeader(envelope).keyId, KEYRING!));
    const member = (n: string) => {
      const f = files.find((x) => x.name === n);
      if (!f) throw new Error(`the artifact has no ${n}`);
      return f.bytes.toString("utf8");
    };
    source = parseManifest(member("source-manifest.tsv"));
    pg = new PGlite();
    target = {
      kind: "pglite-in-process",
      exec: (sql) => pg.exec(sql),
      query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params as never[])).rows }),
    };
    report = await restoreInto(target, { dump: member("ascend-public-portable.sql"), globals: member("globals-nopw.sql") });
    restored = await manifestOf(pg);
  }, 600_000);

  afterAll(async () => { await pg?.close(); });

  it("F18 · the artifact matches its recorded checksum and opened under the key it names", () => {
    const sidecar = `${ARTIFACT}.sha256`;
    expect(existsSync(sidecar), "the .sha256 written beside the artifact is missing").toBe(true);
    expect(readFileSync(sidecar, "utf8").split(/\s+/)[0]).toBe(sha256(envelope));
  });

  it("only the documented lines were stripped, and only platform roles were stubbed", () => {
    expect(report.platformRoleStubs.every((r) => !r.startsWith("ascend_"))).toBe(true);
    expect(report.ascendRoleStatements).toBeGreaterThan(0);
  });

  it("F17 · production's ledger is the repository's, checksum for checksum", () => {
    const ledger = restored.get("F17.ledger")!.split(",").map((l) => l.split(":").slice(0, 2).join(":"));
    expect(ledger).toEqual(loadMigrations().map((m) => `${m.name}:${m.checksum}`));
  });

  it("F1–F17 · every manifest key equals what production reported at dump time", () => {
    const c = compareManifests(source, restored);
    expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected })
      .toEqual({ differing: [], missing: [], unexpected: [] });
  });

  it("F6/F12/F15 · behaviour holds for every restored organization", async () => {
    const orgs = (await pg.query<{ id: string }>("SELECT id FROM organizations ORDER BY id")).rows;
    expect(orgs.length).toBeGreaterThan(0);
    for (const o of orgs) {
      const failed = (await verifyBehaviour(target, o.id)).filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`);
      expect(failed).toEqual([]);
    }
  });

  describe("the application consumes the restore", () => {
    let db: SqlClient;
    beforeAll(() => { db = adapt(pg); });

    it("F9 · the owner's restored credential accepts the real password and refuses a wrong one", async () => {
      const cred = await credentialFor(db, OWNER_EMAIL!);
      expect(cred, "no restored credential for the owner email given").not.toBeNull();
      expect(await verifyPassword(OWNER_PASSWORD!, cred!.passwordHash)).toBe(true);
      expect(await verifyPassword(OWNER_PASSWORD! + "-wrong", cred!.passwordHash)).toBe(false);
    });

    // RT-1 · TOTAL, ACTIVE and ARCHIVED are three numbers, each checked on its own. This used to compare
    // the ACTIVE reader with the TOTAL row count, which is only equal while nothing is archived — the
    // R1a fixture reproduced the failure the moment it held one archived prospect. Notes are counted
    // over EVERY prospect through the audit reader, so archived history is verified, not skipped.
    it("the owner's principal resolves from restored memberships; active, archived and total prospects and every note (archived history included) read back through the application", async () => {
      const cred = await credentialFor(db, OWNER_EMAIL!);
      const r = await resolvePrincipal(db, cred!.userId);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const restored = await restoredProspectCounts(pg, r.principal.organizationId);
      const app = await asPrincipal(db, r.principal, (tx) => applicationProspectCounts(tx));
      expect(prospectCountMismatches(app, restored)).toEqual([]);
      expect(restored.total).toBeGreaterThan(0);
    });

    it("events · the application's own readEvents consumes every restored event, in the reader's contracted order", async () => {
      // The real reader, under the owner's real principal: `readEvents` calls `requireCaller()`, so the
      // caller's authority is resolved from the RESTORED memberships on every call, as the app does.
      // Only counts, digests and booleans are asserted — a failure prints no payload and no event id.
      const cred = await credentialFor(db, OWNER_EMAIL!);
      const r = await resolvePrincipal(db, cred!.userId);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const principal = r.principal;
      registerAuthorityResolver(async () => ({ ok: true, principal }));
      try {
        const envelopes = await asPrincipal(db, principal, (tx) => readEvents(tx));
        const org = principal.organizationId;
        const inOrg = (await pg.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM events WHERE organization_id = $1", [org])).rows[0].n;
        const ids = (sql: string) => pg.query<{ id: string }>(sql, [org]).then((x) => x.rows.map((row) => row.id));
        const digest = (list: string[]) => sha256(list.join(","));

        // Consumed: every restored event of the organization comes back through the reader.
        expect(inOrg, "the restored organization holds no events to read").toBeGreaterThan(0);
        expect(envelopes.length).toBe(inOrg);
        // Consumed AS ENVELOPES — the reader's mapped shape, which raw table rows do not have. A bypass
        // that queried the table directly would return `subject_entity`, not a `subject` object.
        const shaped = envelopes.every((e) => {
          const env = e as unknown as { subject?: { entity?: unknown; entity_id?: unknown }; occurred_at?: unknown; type?: unknown };
          return typeof env.subject?.entity === "string" && typeof env.subject?.entity_id === "string"
            && typeof env.type === "string" && typeof env.occurred_at === "string" && !Number.isNaN(Date.parse(env.occurred_at));
        });
        expect(shaped, "results are not application event envelopes").toBe(true);
        // The same events: the reader's set equals the table's set.
        const readerIds = envelopes.map((e) => String(e.event_id));
        const tableSet = await ids("SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY event_id::text COLLATE \"C\"");
        expect(digest([...readerIds].sort()) === digest(tableSet), "reader set differs from restored table").toBe(true);
        // The reader's contracted order: occurred_at, then seq — the tie-break F6 preserved.
        const contracted = await ids("SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY occurred_at ASC, seq ASC");
        expect(digest(readerIds) === digest(contracted), "reader order differs from occurred_at, seq").toBe(true);
        // And consistent with F6: seq order, taken from the restored rows, is exactly the manifest's.
        const bySeq = (await pg.query<{ s: string; id: string }>(
          "SELECT seq::text AS s, event_id::text AS id FROM events ORDER BY seq")).rows;
        expect(sha256(bySeq.map((x) => `${x.s}|${x.id}`).join(",")) === restored.get("F6.events.order.digest"),
          "restored seq order disagrees with F6").toBe(true);
      } finally {
        clearAuthorityResolver();
      }
    }, 300_000);
  });
});
