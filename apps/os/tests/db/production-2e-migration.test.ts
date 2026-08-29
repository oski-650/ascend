// Layer A — 2E: THE SIX PROSPECTS ENTER PRODUCTION.
//
// The moment the vault stops being the only place Ascend's commercial history exists. Six prospects
// and forty-one events, carried across without a single fact being invented, softened, or re-dated.
//
// ─── VERIFY BEFORE COMMIT, NOT AFTER ───────────────────────────────────────────────────────────
//
// Everything — tenancy rows, six prospects, forty-one events, and all twelve verification checks —
// runs inside ONE transaction. The checks execute against the written-but-uncommitted state, and a
// single failure throws, which rolls the whole thing back.
//
// The alternative (commit, then verify, then clean up on failure) cannot work here: `events` is
// append-only by trigger and by grant, so a bad migration could not be undone. There would be no
// path back to an empty database except a restore. Verifying inside the transaction means a failed
// migration leaves production exactly as it was, with nothing to undo.
//
// ─── WHAT THIS MUST NOT DO ─────────────────────────────────────────────────────────────────────
//
//   · mint a `prospect_id` — every anchored id is the vault's own
//   · emit ANY event — the 41 inserted are the vault's, with their original ids and timestamps
//   · fabricate a `prospect.created` — Ascend never witnessed any of these businesses being born,
//     and the count of such events must stay at ZERO on both sides
//   · merge, delete, rename, or release the Tapia pair
//   · claim a birth date. `created_at` defaults to now(), and the schema COMMENT states in writing
//     that it is audit metadata and not a business fact; origin comes from the event spine, which
//     for these six says nothing at all.
//
// ─── THE VAULT IS VERIFIED INDEPENDENTLY ───────────────────────────────────────────────────────
//
// The verifier's check 11 ("the vault remains byte-identical") only echoes a digest the caller hands
// it — it proves nothing on its own. So this suite hashes the vault itself, before and after, and
// compares. A claim that important should not rest on a parameter.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  addMembership, adaptPoolClient, connectionConfigFor, createOrganization, createUser,
  type SqlClient,
} from "@/core/db";
import {
  applySubstrateMigration, planSubstrateMigration, renderVerification, validateManifest,
  verifySubstrateMigration, type MigrationManifest, type Verification,
} from "@/substrate-migration";
import type { OrganizationId, UserId } from "@/domain";

const DIRECT = process.env.ASCEND_MIGRATE_PROSPECTS_URL;
const describeIfMigrating = DIRECT ? describe : describe.skip;

const ARTIFACTS = path.join(process.cwd(), "docs", "stage2e");

/** Volatile Obsidian/OS state that changes without anyone editing content. */
const IGNORED = new Set([".obsidian", ".git", ".trash", ".DS_Store", ".stfolder"]);

/** A recursive digest of the vault's content — the independent basis for "untouched". */
function hashVault(root: string): { digest: string; files: number } {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (IGNORED.has(name)) continue;
      const abs = path.join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else entries.push(`${path.relative(root, abs)}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
    }
  };
  walk(root);
  return { digest: createHash("sha256").update(entries.join("\n")).digest("hex"), files: entries.length };
}

describeIfMigrating("2E — SIX PROSPECT PRODUCTION MIGRATION (requires ASCEND_MIGRATE_PROSPECTS_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;
  let vaultBefore: { digest: string; files: number };
  let outcome: {
    org: OrganizationId; oscar: UserId; manifest: MigrationManifest; verification: Verification;
    prospectsInserted: number; eventsInserted: number; eventsAuthoredByMigration: number;
  };

  const vaultRoot = () => {
    const p = process.env.ASCEND_VAULT_PATH;
    if (!p) throw new Error("ASCEND_VAULT_PATH is not set");
    return p;
  };

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
    vaultBefore = hashVault(vaultRoot());
    mkdirSync(ARTIFACTS, { recursive: true });
  }, 120_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("PRE: production holds no business rows — this gate refuses a non-empty database", async () => {
    const [row] = (await db.query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM prospects) + (SELECT count(*) FROM events)
             + (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users))::text AS n`
    )).rows;
    // Refusing here is correct: a partially-migrated database must be restored, not topped up.
    expect(Number(row.n), "production is not empty; migrate only from a clean state").toBe(0);
  });

  it("MIGRATES six prospects and 41 events in ONE transaction, verified before commit", async () => {
    outcome = await db.transaction(async (tx) => {
      // Tenancy first, in the SAME transaction: an operator event cannot name a human who does not
      // exist yet, and the CHECK enforces that rather than trusting the writer.
      const org = await createOrganization(tx, "ascend", "Ascend");
      const oscar = await createUser(tx, "oscar@ascend.test", "Oscar Robles");
      await addMembership(tx, oscar, org, "owner");

      const manifest = await planSubstrateMigration(oscar);

      const issues = validateManifest(manifest);
      if (issues.length > 0) {
        throw new Error(`manifest invalid; rolling back:\n${issues.map((i) => `  ${i.subject}: ${i.problem}`).join("\n")}`);
      }
      // The historical boundary, asserted before anything is written.
      if (manifest.summary.birthEventsForProspects !== 0) {
        throw new Error(`manifest contains ${manifest.summary.birthEventsForProspects} birth events; rolling back`);
      }

      const report = await applySubstrateMigration(tx, org, manifest, { confirm: true });

      // All twelve checks against the written-but-uncommitted state.
      const verification = await verifySubstrateMigration(tx, manifest, {
        operatorUserId: oscar, vaultShaBefore: vaultBefore.digest,
      });
      if (!verification.ok) {
        throw new Error(`VERIFICATION FAILED — rolling back:\n${renderVerification(verification)}`);
      }

      return {
        org, oscar, manifest, verification,
        prospectsInserted: report.prospectsInserted,
        eventsInserted: report.eventsInserted,
        eventsAuthoredByMigration: report.eventsAuthoredByMigration,
      };
    });

    expect(outcome.prospectsInserted).toBe(6);
    expect(outcome.eventsInserted).toBe(41);
    expect(outcome.eventsAuthoredByMigration).toBe(0);

    writeFileSync(
      path.join(ARTIFACTS, "migration-verification.txt"),
      renderVerification(outcome.verification)
    );
    console.info("\n" + renderVerification(outcome.verification));
  }, 300_000);

  it("ALL TWELVE verification checks passed", () => {
    const failed = outcome.verification.checks.filter((c) => !c.ok);
    expect(failed.map((c) => `${c.n} ${c.name}: ${c.detail}`)).toEqual([]);
    expect(outcome.verification.checks).toHaveLength(12);
    expect(outcome.verification.ok).toBe(true);
  });

  // ─── Identity ────────────────────────────────────────────────────────────────────────────────

  it("IDENTITY: 4 anchored, 2 held, zero unexplained residue", async () => {
    const rows = (await db.query<{ identity_state: string; n: string }>(
      `SELECT identity_state, count(*)::text AS n FROM prospects GROUP BY 1 ORDER BY 1`
    )).rows;
    expect(rows).toEqual([
      { identity_state: "anchored", n: "4" },
      { identity_state: "held", n: "2" },
    ]);

    // Residue: a row that is neither properly anchored nor properly held. The constraints already
    // forbid it; this asks the data rather than trusting them.
    const [{ n }] = (await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM prospects
       WHERE (identity_state = 'anchored' AND prospect_id IS NULL)
          OR (identity_state = 'held'     AND (prospect_id IS NOT NULL OR hold_reason IS NULL))`
    )).rows;
    expect(Number(n), "unexplained identity residue").toBe(0);
  });

  it("IDENTITY: every anchored prospect_id is the vault's own, not a new one", async () => {
    const dbIds = (await db.query<{ prospect_id: string }>(
      `SELECT prospect_id::text FROM prospects WHERE prospect_id IS NOT NULL ORDER BY 1`
    )).rows.map((r) => r.prospect_id);
    const vaultIds = outcome.manifest.prospects
      .filter((p) => p.prospectId).map((p) => p.prospectId!).sort();
    expect(dbIds).toEqual(vaultIds);
    expect(dbIds).toHaveLength(4);
    // UUIDv7, as Stage 1 minted them — version nibble 7 in position 15.
    for (const id of dbIds) expect(id[14], `${id} is not a UUIDv7`).toBe("7");
  });

  it("IDENTITY: both Tapia records remain HELD, unmerged, unrenamed, hold intact", async () => {
    const held = (await db.query<{ slug: string; hold_reason: string; prospect_id: string | null }>(
      `SELECT slug, hold_reason, prospect_id::text FROM prospects WHERE identity_state = 'held' ORDER BY slug`
    )).rows;
    expect(held).toHaveLength(2);
    expect(held.map((h) => h.slug)).toEqual([
      "tapia-tile-amp-marble-co", "tile-amp-marble-installation-in-bay-area",
    ]);
    for (const h of held) {
      expect(h.prospect_id, `${h.slug} was anchored — the hold was released`).toBeNull();
      expect(h.hold_reason, `${h.slug} lost its hold reason`).toBeTruthy();
    }
  });

  // ─── Events ──────────────────────────────────────────────────────────────────────────────────

  it("EVENTS: exactly 41, all the vault's own, none authored by the migration", async () => {
    const [{ n }] = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM events`)).rows;
    expect(Number(n)).toBe(41);

    const dbIds = (await db.query<{ event_id: string }>(
      `SELECT event_id::text FROM events ORDER BY 1`
    )).rows.map((r) => r.event_id);
    const manifestIds = outcome.manifest.events.map((e) => e.eventId).sort();
    expect(dbIds, "an event exists that the vault did not supply").toEqual(manifestIds);
  });

  it("EVENTS: ZERO prospect.created — an unknown origin stays unknown", async () => {
    // The historical boundary. Ascend never witnessed any of these six businesses being created,
    // and a migration that invented such an event would be manufacturing history.
    const [{ n }] = (await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM events WHERE type = 'prospect.created'`
    )).rows;
    expect(Number(n)).toBe(0);
  });

  it("EVENTS: 10 operator events, each naming its human; 31 system events naming none", async () => {
    const rows = (await db.query<{ actor: string; n: string; named: string }>(
      `SELECT actor, count(*)::text AS n, count(actor_user_id)::text AS named
       FROM events GROUP BY actor ORDER BY actor`
    )).rows;
    const operator = rows.find((r) => r.actor === "operator")!;
    const system = rows.find((r) => r.actor === "system")!;
    expect(operator.n).toBe("10");
    expect(operator.named, "an operator event does not name its human").toBe("10");
    expect(system.n).toBe("31");
    expect(system.named, "a system event claims a human caused it").toBe("0");
  });

  it("EVENTS: ordering is preserved — seq follows the vault's authoritative order", async () => {
    const dbOrder = (await db.query<{ event_id: string }>(
      `SELECT event_id::text FROM events ORDER BY seq`
    )).rows.map((r) => r.event_id);
    expect(dbOrder, "event order differs from the vault's").toEqual(outcome.manifest.events.map((e) => e.eventId));
  });

  // ─── Provenance ──────────────────────────────────────────────────────────────────────────────

  it("PROVENANCE: created_at is audit metadata, and the schema says so in writing", async () => {
    // The migration cannot avoid stamping a row-insert time; what it can avoid is letting that be
    // read as a birth date. The column COMMENT is the durable statement of that distinction, and it
    // travels with the database rather than living only in a document.
    const [{ comment }] = (await db.query<{ comment: string }>(
      `SELECT col_description('prospects'::regclass, ordinal_position) AS comment
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='prospects' AND column_name='created_at'`
    )).rows;
    expect(comment).toMatch(/AUDIT METADATA, NOT A BUSINESS FACT/);
    expect(comment).toMatch(/origin is UNKNOWN/);

    // And no prospect claims a human created it.
    const [{ n }] = (await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM prospects WHERE created_by IS NOT NULL`
    )).rows;
    expect(Number(n), "a migrated prospect claims an author").toBe(0);
  });

  it("THE VAULT IS BYTE-IDENTICAL — verified independently, not by a passed-in digest", async () => {
    const after = hashVault(vaultRoot());
    expect(after.files).toBe(vaultBefore.files);
    expect(after.digest, "the vault changed during the migration").toBe(vaultBefore.digest);
    console.info(`      vault: ${after.files} files, sha256 ${after.digest.slice(0, 16)}…`);
  });
});

describe("2E migration — guard", () => {
  it("announces when the six-prospect migration has NOT run", () => {
    if (!DIRECT) {
      expect(process.env.ASCEND_MIGRATE_PROSPECTS_URL).toBeUndefined();
      console.warn(
        "\n  ℹ️  2E MIGRATION NOT RUN — ASCEND_MIGRATE_PROSPECTS_URL is unset.\n" +
        "      This is the normal state; the variable is set deliberately, once.\n"
      );
    }
    expect(true).toBe(true);
  });
});
