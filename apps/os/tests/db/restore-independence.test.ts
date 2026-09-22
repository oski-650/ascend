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
import { runApplicationProfile, type ProfileResult, type ProfileSession } from "@/core/recovery/profiles";
import { ledgerOf, openRecoveryArtifact, type RecoveryArtifact } from "@/tests/support/recovery-artifact";
import { sha256 } from "@/core/recovery/artifact";
import {
  assertIsolatedEnvironment, compareManifests, manifestOf, restoreInto, verifyBehaviour,
  type Manifest, type RestoreReport, type RestoreTarget,
} from "@/core/recovery/restore";

const ARTIFACT = process.env.ASCEND_BACKUP_ARTIFACT;
const KEYRING = process.env.ASCEND_BACKUP_KEYRING;
const OWNER_EMAIL = process.env.ASCEND_RECOVERY_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.ASCEND_RECOVERY_OWNER_PASSWORD;
/** RT-3: the pinned contract a LEGACY (v2) artifact is verified against, named by the operator. */
const LEGACY_CONTRACT = process.env.ASCEND_RECOVERY_LEGACY_CONTRACT;

const available = Boolean(ARTIFACT && KEYRING && OWNER_EMAIL && OWNER_PASSWORD && existsSync(ARTIFACT));
const describeIfArtifact = available ? describe : describe.skip;

describeIfArtifact("RESTORE INDEPENDENCE — the current production artifact, rebuilt on vanilla PostgreSQL", () => {
  let pg: PGlite;
  let target: RestoreTarget;
  let source: Manifest;
  let restored: Manifest;
  let report: RestoreReport;
  let envelope: Buffer;
  let artifact: RecoveryArtifact;

  beforeAll(async () => {
    assertIsolatedEnvironment();
    // RT-3: open, authenticate, and resolve the ONE contract this artifact is verified against.
    artifact = openRecoveryArtifact(ARTIFACT!, KEYRING!, LEGACY_CONTRACT);
    envelope = artifact.envelope;
    const member = (n: string) => artifact.member(n).toString("utf8");
    source = artifact.source;
    pg = new PGlite();
    target = {
      kind: "pglite-in-process",
      exec: (sql) => pg.exec(sql),
      query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params as never[])).rows }),
    };
    report = await restoreInto(target, { dump: member("ascend-public-portable.sql"), globals: member("globals-nopw.sql") });
    restored = await manifestOf(pg, artifact.contract.manifestSql);
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

  it("RT-3 · the artifact resolved exactly one recovery contract, and it is the one it was taken or accepted under", () => {
    const c = artifact.contract;
    console.log(`recovery contract: ${c.kind} ${c.id} · ${c.artifactFormat} · manifest sha256 ${c.manifestSha256} · ledger head ${c.ledgerHead}`);
    expect(c.kind).toBe(artifact.header.format === "ascend-backup/3" ? "sealed" : "legacy-pinned");
    expect(sha256(Buffer.from(c.manifestSql, "utf8"))).toBe(c.manifestSha256);
  });

  it("F17 · the restored ledger is the CONTRACT's ledger, checksum for checksum (never the repository's HEAD)", () => {
    expect(ledgerOf(restored)).toEqual([...artifact.contract.ledger]);
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
      const failed = (await verifyBehaviour(target, o.id, artifact.contract)).filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`);
      expect(failed).toEqual([]);
    }
  });

  // RT-3B · the application half of the proof is the CONTRACT's application verification profile,
  // run as the application roles — never today's readers, whose SQL may assume a newer schema than
  // this artifact's ledger. The same resolution and the same profile code R1c runs on both its legs.
  describe("the application consumes the restore — through the contract's application verification profile", () => {
    let result: ProfileResult;
    beforeAll(async () => {
      const session: ProfileSession = { query: async <R,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<R>(sql, params as never[])).rows }) };
      result = await runApplicationProfile(artifact.contract, {
        admin: session, app: session, ownerEmail: OWNER_EMAIL!, ownerPassword: OWNER_PASSWORD!,
        sourceEventOrderDigest: source.get("F6.events.order.digest"),
      });
      // Counts and booleans only — never a row, an id, an email or a hash.
      console.log(`APPLICATION-PROFILE ${result.profile} ${JSON.stringify({ checks: result.checks.length, measured: result.measured })}`);
    }, 300_000);

    it("the profile that ran is the one the contract names", () => {
      expect(result.profile).toBe(artifact.contract.applicationProfile);
      expect(result.checks.length).toBeGreaterThan(10);
    });

    it("every profile check passes: credential, principal, members, prospects, identity, notes, events, invitations, isolation, grants", () => {
      expect(result.checks.filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`)).toEqual([]);
      for (const id of ["APP.credential", "APP.principal", "APP.members", "APP.prospects", "APP.prospect-identity", "APP.notes",
        "APP.events", "APP.invitations", "APP.tenant-isolation"]) {
        expect(result.checks.map((c) => c.id), id).toContain(id);
      }
    });
  });
});
