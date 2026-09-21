// Dependency R1c — THE PRODUCTION RECOVERY POINT, RESTORED ONTO THE SAME MAJOR VERSION, ON A REAL SERVER.
//
// R1b restored the production artifact into PGlite 18.3. Production runs 17.6. This suite restores the
// SAME artifact into a real PostgreSQL 17.6 server — built from the official source into a private,
// disposable recovery root — twice, over the two paths a disaster recovery could take:
//
//   LEG 1  the canonical portable-SQL restore (`restoreInto`, unchanged from R1a/R1b)
//   LEG 2  the runbook's custom-dump path: roles, then `pg_restore -L` with EXACTLY the documented
//          entries skipped (the `public` schema entry, and Supabase `DEFAULT ACL` entries)
//
// Each leg gets its own fresh cluster, is held to F1–F18 against the manifest production produced at
// dump time, and passes the behaviour checks. Then the application consumes it through the real `pg`
// driver as the restored `ascend_app` login — a non-superuser that can reach data only by becoming
// `ascend_auth`/`ascend_owner` — which R1b's in-process superuser could not show.
//
// ─── ISOLATION ─────────────────────────────────────────────────────────────────────────────────
//
//   · the servers have NO TCP listener (`listen_addresses = ''`); their only socket is inside the root
//   · targets are built by `openEphemeralSocketTarget`, which accepts no host, and every connection
//     proves: Unix socket, empty listen_addresses, version 17.6, data directory in the root, the
//     system identifier recorded at initdb (application connections: the same postmaster instead)
//   · this process refuses any PG* / *DATABASE_URL* / Supabase-host variable
//   · a network guard makes every TCP connect in this process throw for the whole suite
//
// ─── WRITE SAFETY (the application proof is read-only by construction) ─────────────────────────
//
//   1. the application runs against a CLONE (`r1c_smoke`), never the verified restore
//   2. the clone has a statement-level write-refusal trigger on all eight tables
//   3. `ascend_app` has `default_transaction_read_only = on` in the clone, and every transaction the
//      harness opens is `BEGIN READ ONLY`
//   4. only reader functions are imported and called
//   5. a deliberate write is attempted on every path and must be refused
//   6. table mutation statistics stay zero and the clone's manifest is unchanged afterwards
//
// ─── HOW TO RUN IT ─────────────────────────────────────────────────────────────────────────────
//
//   ./scripts/recovery-verify.sh --artifact ~/AscendBackups/<artifact>.ascbk --r1c-root <root>
//   (the owner email is read from ASCEND_RECOVERY_OWNER_EMAIL, never from argv)
//
// ─── WHAT IT PRINTS ────────────────────────────────────────────────────────────────────────────
//
// Versions, key names, counts, digests' equality, SQLSTATEs, TOC entry descriptors, and pass/fail.
// No row, hash, token, password, email or key.
//
// ─── NOT COVERED ───────────────────────────────────────────────────────────────────────────────
//
// A same-version HTTP boot (`next start`). `core/db/tls.ts` trusts only the Supabase root CA, by
// design, and R1c does not add another trust path. The application is exercised through its own
// modules and the real driver instead.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool, type PoolClient } from "pg";
import {
  asPrincipal, loadMigrations, readEvents, type SqlClient,
} from "@/core/db";
import { adaptPoolClient } from "@/core/db/pool";
import { provisionAppLogin } from "@/core/db/provision";
import { verifyPassword } from "@/core/auth/credentials";
import { credentialFor, resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { clearAuthorityResolver, registerAuthorityResolver } from "@/core/auth/authority";
import { clearAppDb, registerAppDb } from "@/core/auth/connection";
import { listOrganizationMembers } from "@/core/auth/directory";
import { keyForId, open, readHeader, sha256 } from "@/core/recovery/artifact";
import {
  MANIFEST_TABLES, assertEphemeralServer, assertIsolatedEnvironment, assertRestorableTarget, compareManifests,
  createRestoreRoles, ephemeralSocketConfig, manifestOf, openEphemeralSocketTarget, parseManifest, restoreInto,
  verifyBehaviour, type EphemeralServer, type Manifest, type RestoreTarget,
} from "@/core/recovery/restore";
import { runPgRestore, startCluster, type R1cCluster } from "@/tests/support/r1c-cluster";
import { applicationProspectCounts, restoredProspectCounts, type ProspectCounts } from "@/tests/support/recovery-readers";

const ARTIFACT = process.env.ASCEND_BACKUP_ARTIFACT;
const KEYRING = process.env.ASCEND_BACKUP_KEYRING;
const OWNER_EMAIL = process.env.ASCEND_RECOVERY_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.ASCEND_RECOVERY_OWNER_PASSWORD;
const ROOT = process.env.ASCEND_R1C_ROOT;

const EXPECTED_VERSION = "17.6";
const FALLBACK_PG_RESTORE = "/opt/homebrew/opt/libpq/bin/pg_restore"; // 18.6, the client that wrote the dump

const available = Boolean(ARTIFACT && KEYRING && OWNER_EMAIL && OWNER_PASSWORD && ROOT && existsSync(ARTIFACT));
const describeIfR1c = available ? describe : describe.skip;

// ─── the network guard ─────────────────────────────────────────────────────────────────────────
//
// `pg` opens a Unix socket as `socket.connect("<dir>/.s.PGSQL.<port>")`; anything with a port is TCP.
// For the duration of the suite every TCP connect in this process throws — so a stray connection
// fails loudly instead of reaching anything.

const originalConnect = net.Socket.prototype.connect;
let tcpRefusals = 0;
function installNetworkGuard(): void {
  net.Socket.prototype.connect = function guarded(this: net.Socket, ...args: unknown[]) {
    let first = args[0];
    if (Array.isArray(first)) first = first[0]; // Node's internal normalized-args form
    const isUnixPath = (typeof first === "string" && first.startsWith("/"))
      || (typeof first === "object" && first !== null && typeof (first as { path?: unknown }).path === "string"
        && (first as { port?: unknown }).port === undefined);
    if (!isUnixPath) {
      tcpRefusals++;
      throw new Error("R1C network guard: TCP connections are refused during the same-version proof");
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
function removeNetworkGuard(): void { net.Socket.prototype.connect = originalConnect; }

// ─── evidence (non-sensitive) ──────────────────────────────────────────────────────────────────

const evidence: Record<string, unknown> = {};
const note = (k: string, v: unknown) => { evidence[k] = v; };

/** Keep the first error line of a pg_restore failure, with quoted values removed. */
const safeStderr = (s: string) => s.split("\n").filter((l) => /error:/.test(l)).slice(0, 3)
  .map((l) => l.replace(/"[^"]*"/g, '"…"').slice(0, 200)).join(" | ");

// ─── the read-only application connection ──────────────────────────────────────────────────────

/** Every transaction is `BEGIN READ ONLY`. Nesting is refused: the smoke has no reason to nest. */
function readOnly(c: PoolClient): SqlClient {
  let open = false;
  const client: SqlClient = {
    async query(sql, params) {
      const r = await c.query(sql, params ? [...(params as unknown[])] : undefined);
      return { rows: (r.rows ?? []) as never[], affected: r.rowCount ?? 0 };
    },
    async exec(sql) { await c.query(sql); },
    async transaction(fn) {
      if (open) throw new Error("R1c smoke: nested transaction");
      open = true;
      await c.query("BEGIN READ ONLY");
      try {
        const out = await fn(client);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        open = false;
      }
    },
  };
  return client;
}

type StatRow = { relname: string; ins: string; upd: string; del: string; scans: string };
async function tableStats(admin: Client): Promise<StatRow[]> {
  await admin.query("SELECT pg_stat_clear_snapshot()");
  return (await admin.query<StatRow>(
    `SELECT relname, n_tup_ins::text AS ins, n_tup_upd::text AS upd, n_tup_del::text AS del,
            (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::text AS scans
       FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname`)).rows;
}
const sumOf = (rows: StatRow[], k: keyof Omit<StatRow, "relname">) => rows.reduce((n, r) => n + Number(r[k]), 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── one leg ───────────────────────────────────────────────────────────────────────────────────

type Artifact = { dump: string; customDump: Buffer; globals: string; source: Manifest };
let artifact: Artifact;
let pgRestoreBinary = "";

function leg(name: "leg1" | "leg2", restore: (cluster: R1cCluster, target: RestoreTarget) => Promise<void>) {
  describe(`${name === "leg1" ? "LEG 1 · portable SQL" : "LEG 2 · pg_restore of the custom dump"} on PostgreSQL ${EXPECTED_VERSION}`, () => {
    let cluster: R1cCluster;
    let restored: Manifest;
    let adminRestore: Awaited<ReturnType<typeof openEphemeralSocketTarget>>;

    beforeAll(async () => {
      cluster = startCluster(ROOT!, name, join(ROOT!, "pg17", "bin"), EXPECTED_VERSION);
      const boot = await openEphemeralSocketTarget(cluster.server, cluster.admin("postgres"));
      await boot.client.query("CREATE DATABASE r1c_restore");
      await boot.close();
      adminRestore = await openEphemeralSocketTarget(cluster.server, cluster.admin("r1c_restore"));
      note(`${name}.server_version`, (await adminRestore.client.query("SHOW server_version")).rows[0].server_version);
      const t0 = Date.now();
      await restore(cluster, adminRestore.target);
      note(`${name}.restore_ms`, Date.now() - t0);
      restored = await manifestOf(adminRestore.target);
    }, 600_000);

    afterAll(async () => {
      await adminRestore?.close().catch(() => {});
      cluster?.stop();
    });

    it("AC1 · the restore completed on a server reporting exactly 17.6", () => {
      expect(evidence[`${name}.server_version`]).toBe(EXPECTED_VERSION);
    });

    it("F17 · production's ledger is the repository's, checksum for checksum", () => {
      const ledger = restored.get("F17.ledger")!.split(",").map((l) => l.split(":").slice(0, 2).join(":"));
      expect(ledger).toEqual(loadMigrations().map((m) => `${m.name}:${m.checksum}`));
    });

    it("AC2 · F1–F17 · every manifest key equals what production reported at dump time", () => {
      const c = compareManifests(artifact.source, restored);
      note(`${name}.manifest`, { matched: c.matched.length, differing: c.differing, missing: c.missing, unexpected: c.unexpected });
      expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected })
        .toEqual({ differing: [], missing: [], unexpected: [] });
    });

    it("F6/F12/F15 · behaviour holds for every restored organization", async () => {
      const orgs = (await adminRestore.target.query<{ id: string }>("SELECT id FROM organizations ORDER BY id")).rows;
      expect(orgs.length).toBeGreaterThan(0);
      const failed: string[] = [];
      let checks = 0;
      for (const o of orgs) {
        const results = await verifyBehaviour(adminRestore.target, o.id);
        checks += results.length;
        failed.push(...results.filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`));
      }
      note(`${name}.behaviour`, { checks, failed: failed.length });
      expect(failed).toEqual([]);
    });

    describe("the application consumes it — read-only, as the restored ascend_app login, on a guarded clone", () => {
      let appPool: Pool;
      let smokeAdmin: Awaited<ReturnType<typeof openEphemeralSocketTarget>>;
      let server: EphemeralServer;
      let appPassword: string;
      let principal: ResolvedPrincipal;
      let org: string;
      let manifestBefore: Manifest;
      let statsBefore: StatRow[];
      let leases = 0;
      // Every expected value is read by the superuser BEFORE the statistics baseline, so that between
      // the baseline and the positive control only the application's own backends touch a table.
      let exp: {
        org: string; prospects: number; events: number; eventSet: string; eventOrder: string; f6: boolean;
        notes: number; invitations: number; members: number;
        counts: ProspectCounts;
      };

      const lease = async <T,>(fn: (db: SqlClient) => Promise<T>): Promise<T> => {
        const c = await appPool.connect();
        try {
          await assertEphemeralServer(c, server, { privileged: false, postmasterStart: smokeAdmin.postmasterStart, database: "r1c_smoke" });
          const who = (await c.query("SELECT current_user AS u, current_setting('default_transaction_read_only') AS ro")).rows[0];
          if (who.u !== "ascend_app" || who.ro !== "on") throw new Error("the smoke connection is not a read-only ascend_app session");
          leases++;
          return await fn(readOnly(c));
        } finally {
          c.release();
        }
      };

      beforeAll(async () => {
        server = cluster.server;
        // Runbook: re-key ascend_app (role passwords are never in an artifact). Done on the verified
        // restore AFTER its manifest was compared — a role password is cluster-wide, not data.
        appPassword = (await import("node:crypto")).randomBytes(32).toString("hex");
        await provisionAppLogin(adaptPoolClient(adminRestore.client as unknown as PoolClient), appPassword);
        await adminRestore.close();

        // 1 · the clone. The verified restore is never connected to again.
        const boot = await openEphemeralSocketTarget(server, cluster.admin("postgres"));
        await boot.client.query("CREATE DATABASE r1c_smoke TEMPLATE r1c_restore");
        await boot.close();
        smokeAdmin = await openEphemeralSocketTarget(server, cluster.admin("r1c_smoke"));
        const a = smokeAdmin.client;

        // 2 · write-refusal triggers on all eight tables.
        await a.query("CREATE SCHEMA r1c_guard");
        await a.query(`CREATE FUNCTION r1c_guard.refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$
                         BEGIN RAISE EXCEPTION 'R1C guard: % refused on %', TG_OP, TG_TABLE_NAME; END $$`);
        for (const t of MANIFEST_TABLES) {
          await a.query(`CREATE TRIGGER r1c_refuse_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.${t}
                           FOR EACH STATEMENT EXECUTE FUNCTION r1c_guard.refuse_write()`);
        }
        note(`${name}.guard_triggers`, (await a.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'r1c_refuse_write'")).rows[0].n);
        // 3 · read-only by default for the application login in the clone.
        await a.query("ALTER ROLE ascend_app IN DATABASE r1c_smoke SET default_transaction_read_only = on");

        manifestBefore = await manifestOf(smokeAdmin.target);

        const one = async (sql: string, params: unknown[]) => (await a.query<{ n: number }>(sql, params)).rows[0].n;
        const expOrg = (await a.query<{ o: string }>(
          `SELECT m.organization_id::text AS o FROM users u JOIN memberships m ON m.user_id = u.id
            WHERE lower(u.email) = lower($1)`, [OWNER_EMAIL!])).rows;
        if (expOrg.length !== 1) throw new Error("the owner email does not resolve to exactly one restored membership");
        const o = expOrg[0].o;
        const ids = async (sql: string) => (await a.query<{ id: string }>(sql, [o])).rows.map((r) => r.id);
        const bySeq = (await a.query<{ s: string; id: string }>("SELECT seq::text AS s, event_id::text AS id FROM events ORDER BY seq")).rows;
        exp = {
          org: o,
          prospects: await one("SELECT count(*)::int AS n FROM prospects WHERE organization_id = $1", [o]),
          events: await one("SELECT count(*)::int AS n FROM events WHERE organization_id = $1", [o]),
          eventSet: sha256((await ids("SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY event_id::text COLLATE \"C\"")).join(",")),
          eventOrder: sha256((await ids("SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY occurred_at ASC, seq ASC")).join(",")),
          f6: sha256(bySeq.map((x) => `${x.s}|${x.id}`).join(",")) === artifact.source.get("F6.events.order.digest"),
          notes: await one("SELECT count(*)::int AS n FROM prospect_notes n JOIN prospects p ON p.id = n.prospect WHERE p.organization_id = $1", [o]),
          // RT-1 · total, active and archived separately, and archived history — measured on the
          // restored database with raw SQL, never through the reader being checked.
          counts: await restoredProspectCounts(a, o),
          invitations: await one("SELECT count(*)::int AS n FROM invitations WHERE organization_id = $1", [o]),
          members: await one(`SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id
                               WHERE m.organization_id = $1 AND u.disabled_at IS NULL`, [o]),
        };

        await a.query("SELECT pg_stat_force_next_flush()");
        await sleep(1_500);
        statsBefore = await tableStats(a);

        appPool = new Pool({ ...ephemeralSocketConfig(server, { user: "ascend_app", password: appPassword, database: "r1c_smoke" }), max: 2 });
        registerAppDb(lease);
      }, 600_000);

      afterAll(async () => {
        clearAuthorityResolver();
        clearAppDb();
        await appPool?.end().catch(() => {});
        await smokeAdmin?.close().catch(() => {});
      });

      it("AC3 · ascend_app authenticates over the socket and every connection proves the isolated server", async () => {
        const n = await lease(async (db) => (await db.query<{ n: number }>("SELECT 1 AS n")).rows[0].n);
        expect(n).toBe(1);
      });

      it("AC4 · F9 · credentialFor + verifyPassword: the real password is accepted, a wrong one refused", async () => {
        await lease(async (db) => {
          const cred = await credentialFor(db, OWNER_EMAIL!);
          expect(cred, "no restored credential for the owner email given").not.toBeNull();
          expect(await verifyPassword(OWNER_PASSWORD!, cred!.passwordHash)).toBe(true);
          expect(await verifyPassword(OWNER_PASSWORD! + "-wrong", cred!.passwordHash)).toBe(false);
        });
      });

      it("AC4 · resolvePrincipal: the owner resolves from restored memberships", async () => {
        await lease(async (db) => {
          const cred = await credentialFor(db, OWNER_EMAIL!);
          const r = await resolvePrincipal(db, cred!.userId);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          principal = r.principal;
          org = principal.organizationId;
          note(`${name}.principal_role`, principal.role);
          expect(principal.role).toBe("owner");
          expect(org === exp.org, "the principal's organization is not the owner's restored membership").toBe(true);
        });
        registerAuthorityResolver(async () => ({ ok: true, principal }));
      });

      // RT-1 · this compared the ACTIVE reader with the TOTAL row count, which holds only while nothing
      // is archived. Total, active and archived are now three independent numbers.
      it("AC4 · the active reader returns exactly the ACTIVE prospects, the audit reader every prospect, and active + archived = total", async () => {
        const want: ProspectCounts = exp.counts;
        const got = await lease((db) => asPrincipal(db, principal, (tx) => applicationProspectCounts(tx)));
        note(`${name}.prospects`, {
          reader: { total: got.total, active: got.active, archived: got.archived },
          restored: { total: want.total, active: want.active, archived: want.archived },
        });
        expect(want.total).toBeGreaterThan(0);
        expect(want.active + want.archived).toBe(want.total);
        expect({ total: got.total, active: got.active, archived: got.archived })
          .toEqual({ total: want.total, active: want.active, archived: want.archived });
      }, 300_000);

      it("AC4 · readEvents returns every restored event, as envelopes, in its contracted order, consistent with F6", async () => {
        const envelopes = await lease((db) => asPrincipal(db, principal, (tx) => readEvents(tx)));
        const inOrg = exp.events;
        const shaped = envelopes.every((e) => {
          const env = e as unknown as { subject?: { entity?: unknown; entity_id?: unknown }; occurred_at?: unknown; type?: unknown };
          return typeof env.subject?.entity === "string" && typeof env.subject?.entity_id === "string"
            && typeof env.type === "string" && typeof env.occurred_at === "string" && !Number.isNaN(Date.parse(env.occurred_at));
        });
        const readerIds = envelopes.map((e) => String(e.event_id));
        const result = {
          reader: envelopes.length, restored: inOrg, envelopes: shaped,
          sameSet: sha256([...readerIds].sort().join(",")) === exp.eventSet,
          contractedOrder: sha256(readerIds.join(",")) === exp.eventOrder, f6: exp.f6,
        };
        note(`${name}.events`, result);
        expect(inOrg).toBeGreaterThan(0);
        expect(result).toEqual({ reader: inOrg, restored: inOrg, envelopes: true, sameSet: true, contractedOrder: true, f6: true });
      }, 300_000);

      // RT-1 · this walked the ACTIVE reader, so notes on archived prospects were silently skipped and
      // archived history was never verified. It now walks the audit reader and checks archived history
      // on its own line.
      it("AC4 · listProspectNotes, over EVERY prospect (archived included), returns exactly the restored notes", async () => {
        const want: ProspectCounts = exp.counts;
        const got = await lease((db) => asPrincipal(db, principal, (tx) => applicationProspectCounts(tx)));
        note(`${name}.notes`, {
          reader: { all: got.notes, onArchived: got.notesOnArchived },
          restored: { all: want.notes, onArchived: want.notesOnArchived },
        });
        expect(want.notes).toBe(exp.notes);   // the two independent restored-side measurements agree
        expect({ all: got.notes, onArchived: got.notesOnArchived })
          .toEqual({ all: want.notes, onArchived: want.notesOnArchived });
      }, 300_000);

      it("AC4 · invitations: under the owner principal, RLS shows exactly the organization's restored invitations", async () => {
        // No application READER of invitations exists (only create/accept, which write). This is the
        // same read the accept path makes, through the application's own principal binding.
        const expected = exp.invitations;
        const seen = await lease((db) => asPrincipal(db, principal, async (tx) =>
          (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM invitations")).rows[0].n));
        note(`${name}.invitations`, { visible: seen, restored: expected });
        expect(seen).toBe(expected);
      });

      it("AC4 · listOrganizationMembers, through requireAppDb and requireCapability, lists the organization", async () => {
        const expected = exp.members;
        const before = leases;
        const members = await listOrganizationMembers();
        note(`${name}.members`, { reader: members.length, restored: expected, leased: leases - before });
        expect(leases - before, "the reader did not use the registered read-only lease").toBe(1);
        expect(members).toHaveLength(expected);
      });

      it("the application's reads reached the server and were flushed to statistics (positive control)", async () => {
        await appPool.end();
        let after = statsBefore;
        for (let i = 0; i < 20 && sumOf(after, "scans") <= sumOf(statsBefore, "scans"); i++) {
          await sleep(1_000);
          after = await tableStats(smokeAdmin.client);
        }
        note(`${name}.app_scans`, sumOf(after, "scans") - sumOf(statsBefore, "scans"));
        expect(sumOf(after, "scans")).toBeGreaterThan(sumOf(statsBefore, "scans"));
        expect({ ins: sumOf(after, "ins"), upd: sumOf(after, "upd"), del: sumOf(after, "del") })
          .toEqual({ ins: sumOf(statsBefore, "ins"), upd: sumOf(statsBefore, "upd"), del: sumOf(statsBefore, "del") });
      }, 60_000);

      it("AC5 · a deliberate write is refused on every path", async () => {
        const codeOf = async (c: Client | PoolClient, setup: string[], probe: string) => {
          await c.query("BEGIN");
          try {
            for (const s of setup) await c.query(s);
            await c.query(probe);
            return "SUCCEEDED";
          } catch (e) {
            const err = e as { code?: string; message?: string };
            return `${err.code ?? "?"}${/R1C guard/.test(err.message ?? "") ? ":guard" : ""}`;
          } finally {
            await c.query("ROLLBACK");
          }
        };
        const outcomes: Record<string, string> = {};

        // (a) the application login, as the application runs: read-only session, owner principal.
        const probePool = new Pool({ ...ephemeralSocketConfig(server, { user: "ascend_app", password: appPassword, database: "r1c_smoke" }), max: 1 });
        const pc = await probePool.connect();
        try {
          await assertEphemeralServer(pc, server, { privileged: false, postmasterStart: smokeAdmin.postmasterStart, database: "r1c_smoke" });
          outcomes["app.read-only.insert-organizations"] = await codeOf(pc,
            [`SELECT set_config('ascend.org_id', '${org}', true)`, "SET LOCAL ROLE ascend_owner"],
            "INSERT INTO organizations DEFAULT VALUES");
          // (b) the application login deliberately escaping read-only: the triggers still refuse.
          outcomes["app.read-write.insert-prospects"] = await codeOf(pc,
            ["SET TRANSACTION READ WRITE", `SELECT set_config('ascend.org_id', '${org}', true)`, "SET LOCAL ROLE ascend_owner"],
            "INSERT INTO prospects DEFAULT VALUES");
        } finally {
          pc.release();
          await probePool.end();
        }
        // (c) the cluster superuser, read-write, on every table and every write operation.
        const a = smokeAdmin.client;
        for (const t of MANIFEST_TABLES) {
          const col = (await a.query<{ c: string }>(
            "SELECT attname AS c FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 1",
            [`public.${t}`])).rows[0].c;
          outcomes[`superuser.${t}.insert`] = await codeOf(a, ["SET TRANSACTION READ WRITE"], `INSERT INTO public.${t} DEFAULT VALUES`);
          outcomes[`superuser.${t}.update`] = await codeOf(a, ["SET TRANSACTION READ WRITE"], `UPDATE public.${t} SET "${col}" = "${col}" WHERE false`);
          outcomes[`superuser.${t}.delete`] = await codeOf(a, ["SET TRANSACTION READ WRITE"], `DELETE FROM public.${t} WHERE false`);
          outcomes[`superuser.${t}.truncate`] = await codeOf(a, ["SET TRANSACTION READ WRITE"], `TRUNCATE public.${t} CASCADE`);
        }
        note(`${name}.write_probes`, outcomes);
        expect(Object.entries(outcomes).filter(([, v]) => v === "SUCCEEDED").map(([k]) => k), "a write SUCCEEDED").toEqual([]);
        expect(outcomes["app.read-only.insert-organizations"]).toBe("25006"); // read_only_sql_transaction
        expect(outcomes["app.read-write.insert-prospects"]).toMatch(/^(P0001:guard|42501)$/);
        for (const t of MANIFEST_TABLES) expect(outcomes[`superuser.${t}.insert`], t).toBe("P0001:guard");
      }, 120_000);

      it("AC5 · nothing changed: no tuple was written and the clone's manifest is identical", async () => {
        await smokeAdmin.client.query("SELECT pg_stat_force_next_flush()");
        await sleep(1_500);
        const after = await tableStats(smokeAdmin.client);
        const delta = { ins: sumOf(after, "ins") - sumOf(statsBefore, "ins"), upd: sumOf(after, "upd") - sumOf(statsBefore, "upd"), del: sumOf(after, "del") - sumOf(statsBefore, "del") };
        const c = compareManifests(manifestBefore, await manifestOf(smokeAdmin.target));
        note(`${name}.post_smoke`, { tupleDelta: delta, manifestDiffering: c.differing, manifestMatched: c.matched.length });
        expect(delta).toEqual({ ins: 0, upd: 0, del: 0 });
        expect({ differing: c.differing, missing: c.missing, unexpected: c.unexpected }).toEqual({ differing: [], missing: [], unexpected: [] });
      }, 60_000);
    });
  });
}

// ─── the suite ─────────────────────────────────────────────────────────────────────────────────

describeIfR1c("R1c · the production artifact on a real PostgreSQL 17.6 server", () => {
  let envelope: Buffer;

  beforeAll(async () => {
    assertIsolatedEnvironment();
    installNetworkGuard();
    // The guard is live: a TCP connect throws before any packet.
    expect(() => net.connect(9, "127.0.0.1")).toThrow(/R1C network guard/);

    envelope = readFileSync(ARTIFACT!);
    const header = readHeader(envelope);
    const keyFile = join(KEYRING!, `${header.keyId}.key`);
    expect((statSync(keyFile).mode & 0o777).toString(8), "key file mode").toBe("600");
    const { files } = open(envelope, keyForId(header.keyId, KEYRING!));
    const member = (n: string) => {
      const f = files.find((x) => x.name === n);
      if (!f) throw new Error(`the artifact has no ${n}`);
      return f.bytes;
    };
    artifact = {
      dump: member("ascend-public-portable.sql").toString("utf8"),
      customDump: member("ascend-public.dump"),
      globals: member("globals-nopw.sql").toString("utf8"),
      source: parseManifest(member("source-manifest.tsv").toString("utf8")),
    };
    note("artifact.key_id", header.keyId);

    // Which pg_restore reads an archive written by pg_dump 18.6? Try 17.6 first; fall back to 18.6.
    const own = join(ROOT!, "pg17", "bin", "pg_restore");
    try {
      await runPgRestore(own, ROOT!, ["-l"], artifact.customDump);
      pgRestoreBinary = own;
      note("pg_restore", "17.6 (the server's own build)");
    } catch (e) {
      note("pg_restore.17.6_refused", safeStderr((e as { stderr?: string }).stderr ?? ""));
      await runPgRestore(FALLBACK_PG_RESTORE, ROOT!, ["-l"], artifact.customDump);
      pgRestoreBinary = FALLBACK_PG_RESTORE;
      note("pg_restore", "18.6 (documented fallback) against the 17.6 server");
    }
  }, 120_000);

  afterAll(() => {
    removeNetworkGuard();
    note("network_guard.tcp_refusals", tcpRefusals);
    console.info(`R1C-EVIDENCE ${JSON.stringify(evidence)}`);
  });

  it("F18 · the artifact matches its recorded checksum and opened under the key it names", () => {
    expect(readFileSync(`${ARTIFACT}.sha256`, "utf8").split(/\s+/)[0]).toBe(sha256(envelope));
  });

  leg("leg1", async (_cluster, target) => {
    const report = await restoreInto(target, { dump: artifact.dump, globals: artifact.globals });
    note("leg1.restore", report);
    expect(report.platformRoleStubs.every((r) => !r.startsWith("ascend_"))).toBe(true);
  });

  leg("leg2", async (cluster, target) => {
    await assertRestorableTarget(target);
    // Roles: the ascend_* roles, then stubs for every other role the dump's SCHEMA references
    // (`-s`: the rendering carries no row data).
    const schema = (await runPgRestore(pgRestoreBinary, ROOT!, ["-s", "-f", "-"], artifact.customDump)).stdout;
    const roles = await createRestoreRoles(target, artifact.globals, schema);

    // The filtered list — exactly the runbook's two skips, nothing else.
    const list = (await runPgRestore(pgRestoreBinary, ROOT!, ["-l"], artifact.customDump)).stdout.split("\n");
    const skipped: string[] = [];
    const filtered = list.map((line) => {
      const entry = /^\d+; \d+ \d+ (.+)$/.exec(line)?.[1];
      if (!entry) return line;
      const isPublicSchema = /^SCHEMA - public \S+$/.test(entry);
      const isSupabaseDefaultAcl = /^DEFAULT ACL /.test(entry) && /\bsupabase_admin$/.test(entry);
      if (isPublicSchema || isSupabaseDefaultAcl) { skipped.push(entry); return `;${line}`; }
      return line;
    });
    const entries = list.filter((l) => /^\d+; /.test(l)).length;
    const listFile = join(cluster.server.cluster, "restore.list");
    writeFileSync(listFile, filtered.join("\n"), { mode: 0o600 }); // TOC descriptors only, no rows

    const cfg = ephemeralSocketConfig(cluster.server, cluster.admin("r1c_restore"));
    const conninfo = `host=${cfg.host} port=${cfg.port} dbname=r1c_restore user=${cfg.user} passfile=${cluster.passfile} sslmode=disable application_name=ascend-r1c-pg_restore`;
    try {
      await runPgRestore(pgRestoreBinary, ROOT!, ["--dbname", conninfo, "-L", listFile, "--exit-on-error", "--single-transaction"], artifact.customDump);
    } catch (e) {
      throw new Error(`pg_restore failed: ${safeStderr((e as { stderr?: string }).stderr ?? "")}`);
    }
    note("leg2.restore", { tocEntries: entries, restoredEntries: entries - skipped.length, skipped, ...roles });
    expect(skipped.filter((s) => s.startsWith("SCHEMA"))).toHaveLength(1);
  });
});
