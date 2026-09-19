// core/recovery/restore — THE CANONICAL RESTORE, into an isolated target only (Dependency R1a).
//
// ─── ISOLATION IS STRUCTURAL ───────────────────────────────────────────────────────────────────
//
// There is no URL anywhere in this module. A restore target is an OBJECT, of one of two kinds:
//
//   pglite-in-process          an in-process PGlite: no socket, no network client (R1a/R1b)
//   postgres-ephemeral-socket  a real, disposable PostgreSQL server reached ONLY over a Unix socket
//                              inside a private recovery root (R1c, same-version proof)
//
// The second kind takes NO host, NO URL and NO connection string. `openEphemeralSocketTarget` derives
// the socket path from the recovery root it is given, and before handing back a target it proves the
// server it reached is the disposable one: not over TCP, listening on nothing, the exact version
// expected, its data directory inside the root, and the system identifier recorded at `initdb`. A
// production cluster cannot satisfy any one of those. A socket target this module did not construct
// is refused by `restoreInto`, so the object cannot be forged by writing the literal.
//
// And because the old runbook's commands relied on ambient `PG*` variables (so a shell that had just
// taken a backup would have restored ONTO THE PRODUCTION CLUSTER), `assertIsolatedEnvironment` refuses
// to run at all while any `PG*` variable, any `*DATABASE_URL*` variable, or any value naming a
// Supabase host is present in the process. It reports variable NAMES, never values. It fails closed:
// run recovery in a clean environment (`npm run recovery:verify`), not in the one that took the backup.
//
// ─── WHAT A RESTORE IS ─────────────────────────────────────────────────────────────────────────
//
//   1. refuse a non-empty target
//   2. roles: the `ascend_*` roles and their memberships among themselves, parsed out of the
//      artifact's `pg_dumpall --globals-only --no-role-passwords` file. Supabase platform roles are
//      not Ascend's and are not recreated; any the public dump GRANTs to are stubbed NOLOGIN, counted
//      and reported, so their grants apply and mean nothing.
//   3. the portable (`--inserts`) public-schema dump, with exactly two kinds of line removed and
//      counted: psql meta-commands (`\restrict`), and Supabase `ALTER DEFAULT PRIVILEGES FOR ROLE
//      supabase_admin` grants. Anything the target cannot apply is an ERROR, not a skip.
//   4. the SAME `manifest.sql` the backup ran against the source, compared key for key
//   5. behaviour the manifest cannot see: the sequence advances past every event, the event log is
//      still append-only, and RLS/column grants still separate the roles — including that no role but
//      `ascend_auth` can read `users.password_hash`
//
// A RESTORE NEVER EMITS AN EVENT. It reinstates history; it does not author it. (Fitness rule.)
//
// Step 5 CONSUMES a sequence value and runs probes on the target, so it runs after step 4 and only
// against a disposable target — which is the only kind this module accepts.

import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { Client, type ClientConfig } from "pg";

export class RestoreRefused extends Error {}

/** The only kinds of target a restore will run against. Neither takes a URL. */
export type RestoreTarget = {
  readonly kind: "pglite-in-process" | "postgres-ephemeral-socket";
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export const MANIFEST_SQL = readFileSync(new URL("./manifest.sql", import.meta.url), "utf8");

/** The eight tables the manifest names. Tests assert this equals the schema's table set. */
export const MANIFEST_TABLES = [...MANIFEST_SQL.matchAll(/'F3\.rows\.([a-z_]+)'/g)].map((m) => m[1]).sort();

// ─── 0 · the environment ───────────────────────────────────────────────────────────────────────

const SUPABASE_HOST = /supabase\.(co|com)\b/i;

export function assertIsolatedEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const offending = Object.entries(env)
    .filter(([name, value]) =>
      /^PG[A-Z]/.test(name) || /DATABASE_URL/.test(name) || (typeof value === "string" && SUPABASE_HOST.test(value)))
    .map(([name]) => name)
    .sort();
  if (offending.length > 0) {
    throw new RestoreRefused(
      `refusing to restore: this process can see connection configuration (${offending.join(", ")}). ` +
      "A restore must run where no production connection exists — use `npm run recovery:verify`, " +
      "which starts from an empty environment, rather than the shell that took the backup.");
  }
}

// ─── 1–3 · the restore ─────────────────────────────────────────────────────────────────────────

export type SanitizedDump = { sql: string; metaLines: number; platformAclLines: number };

export function sanitizeDump(dump: string): SanitizedDump {
  if (/^COPY /m.test(dump)) {
    throw new RestoreRefused("this dump carries COPY blocks; the portable restore needs a --inserts dump");
  }
  if (/^CREATE EXTENSION/m.test(dump)) {
    throw new RestoreRefused("the public dump creates an extension; Ascend's schema must not depend on one (F16)");
  }
  let metaLines = 0, platformAclLines = 0;
  const kept = dump.split("\n").filter((line) => {
    if (/^\\/.test(line)) { metaLines++; return false; }
    if (/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b/.test(line)) { platformAclLines++; return false; }
    return true;
  });
  return { sql: kept.join("\n"), metaLines, platformAclLines };
}

/**
 * The Ascend part of a `pg_dumpall --globals-only` file: `CREATE ROLE ascend_*`, its `ALTER ROLE …
 * WITH` attributes, and `GRANT ascend_x TO ascend_y` memberships (their `GRANTED BY` dropped — the
 * grantor is whoever restores). Platform roles and memberships to platform roles are not Ascend's.
 */
export function ascendRoleStatements(globals: string): string[] {
  const out: string[] = [];
  for (const raw of globals.split("\n")) {
    const line = raw.trim();
    if (/\bPASSWORD\b/i.test(line) && /\bascend_\w+/.test(line)) {
      throw new RestoreRefused("the globals file carries a role password; artifacts are taken with --no-role-passwords");
    }
    if (/^CREATE ROLE ascend_\w+;$/.test(line)) out.push(line);
    else if (/^ALTER ROLE ascend_\w+ WITH [A-Z ]+;$/.test(line)) out.push(line);
    else {
      const g = /^GRANT (ascend_\w+) TO (ascend_\w+)( WITH [A-Z ,]+?)?( GRANTED BY \w+)?;$/.exec(line);
      if (g) out.push(`GRANT ${g[1]} TO ${g[2]}${g[3] ?? ""};`);
    }
  }
  if (!out.some((s) => s.startsWith("CREATE ROLE"))) {
    throw new RestoreRefused("the globals file names no ascend_* role; it is not an Ascend artifact");
  }
  return out;
}

/** Roles the public dump grants to, owns objects as, or names in a policy — so they can be stubbed. */
export function rolesReferencedByDump(sql: string): string[] {
  const names = new Set<string>();
  for (const m of sql.matchAll(/^(?:GRANT|REVOKE) [^;]*? (?:TO|FROM) ([^;]+);/gm)) {
    for (const n of m[1].replace(/ WITH GRANT OPTION| GRANTED BY \w+/g, "").split(",")) names.add(n.trim());
  }
  for (const m of sql.matchAll(/ OWNER TO (\w+);/g)) names.add(m[1]);
  for (const m of sql.matchAll(/^CREATE POLICY [^;]*? TO ([\w, ]+?)(?: USING| WITH CHECK|;|\n)/gm)) {
    for (const n of m[1].split(",")) names.add(n.trim());
  }
  return [...names].filter((n) => /^[a-z_][a-z0-9_]*$/.test(n) && n !== "public").sort();
}

export type RestoreReport = {
  ascendRoleStatements: number;
  platformRoleStubs: string[];
  metaLinesStripped: number;
  platformAclLinesStripped: number;
};

/**
 * Steps 0–1, shared by every restore path: the environment is clean, the target is one this module
 * accepts, and it is empty.
 */
export async function assertRestorableTarget(target: RestoreTarget, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertIsolatedEnvironment(env);
  if (target.kind === "postgres-ephemeral-socket") {
    if (!VERIFIED_SOCKET_TARGETS.has(target)) {
      throw new RestoreRefused("a socket target is accepted only as constructed by openEphemeralSocketTarget");
    }
  } else if (target.kind !== "pglite-in-process") {
    throw new RestoreRefused("a restore runs only into an in-process PGlite or a verified ephemeral socket server");
  }
  const occupied = await target.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S','v','m')");
  if (occupied.rows[0].n !== 0) throw new RestoreRefused("the target already holds relations in public; restore only into an empty database");
}

/**
 * Step 2, shared by every restore path: the `ascend_*` roles from the globals file, then a NOLOGIN
 * stub for every other role `schemaSql` references. `schemaSql` is whatever SQL the path will apply
 * — the portable dump, or `pg_restore`'s script rendering of the custom dump.
 */
export async function createRestoreRoles(
  target: RestoreTarget, globals: string, schemaSql: string
): Promise<{ ascendRoleStatements: number; platformRoleStubs: string[] }> {
  const roles = ascendRoleStatements(globals);
  for (const statement of roles) await target.exec(statement);

  const existing = new Set((await target.query<{ rolname: string }>("SELECT rolname FROM pg_roles")).rows.map((r) => r.rolname));
  const stubs = rolesReferencedByDump(schemaSql).filter((r) => !existing.has(r));
  for (const r of stubs) {
    if (r.startsWith("ascend_")) {
      throw new RestoreRefused(`the dump grants to ${r}, which the globals file does not define`);
    }
    await target.exec(`CREATE ROLE ${r} NOLOGIN`);
  }
  return { ascendRoleStatements: roles.length, platformRoleStubs: stubs };
}

export async function restoreInto(
  target: RestoreTarget,
  artifact: { dump: string; globals: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<RestoreReport> {
  await assertRestorableTarget(target, env);

  const dump = sanitizeDump(artifact.dump);
  const { ascendRoleStatements: roleCount, platformRoleStubs: stubs } = await createRestoreRoles(target, artifact.globals, dump.sql);

  // KEEP the target's own `public`; never drop it. `pg_dump --schema=public` emits `CREATE SCHEMA
  // public` plus only the NON-default schema grants — the default USAGE for PUBLIC is assumed to exist
  // already. The 2D runbook's `DROP SCHEMA public CASCADE` therefore produced a database whose schema
  // had lost PUBLIC's USAGE, so `ascend_owner`, `ascend_sales` and `ascend_automation` — which hold no
  // schema grant of their own — could no longer see a single table. It looked complete and was unusable
  // by the application. Found by this module's behaviour checks (R1a); `F13.grants.schema` now carries
  // the PUBLIC grant so the manifest catches it too.
  const sql = dump.sql.replace(/^CREATE SCHEMA public;$/m, "-- CREATE SCHEMA public; (the target's own public is kept)");
  await target.exec(sql);
  // The dump sets `search_path = ''` and `row_security = off` for its own session. Leave the target as
  // a fresh client would find it — with RLS applying — before anything is measured against it.
  await target.exec("RESET ALL");

  return {
    ascendRoleStatements: roleCount,
    platformRoleStubs: stubs,
    metaLinesStripped: dump.metaLines,
    platformAclLinesStripped: dump.platformAclLines,
  };
}

// ─── 4 · the manifest ──────────────────────────────────────────────────────────────────────────

export type Manifest = Map<string, string>;

/** `psql -At -F<TAB>` output, as the backup script writes it. */
export function parseManifest(tsv: string): Manifest {
  const m: Manifest = new Map();
  for (const line of tsv.split("\n")) {
    if (line.trim() === "") continue;
    const i = line.indexOf("\t");
    if (i < 0) throw new RestoreRefused(`malformed manifest line: ${line.slice(0, 40)}`);
    m.set(line.slice(0, i), line.slice(i + 1));
  }
  if (m.get("meta.format") !== "ascend-recovery-manifest/1") throw new RestoreRefused("not an Ascend recovery manifest");
  return m;
}

export function formatManifest(m: Manifest): string {
  return [...m.entries()].map(([k, v]) => `${k}\t${v}`).join("\n") + "\n";
}

export async function manifestOf(target: { exec(sql: string): Promise<unknown> }): Promise<Manifest> {
  const results = (await target.exec(MANIFEST_SQL)) as { rows: { k: string; v: string }[] }[];
  const rows = results[results.length - 1].rows;
  return new Map(rows.map((r) => [r.k, r.v]));
}

export type ManifestComparison = { matched: string[]; differing: string[]; missing: string[]; unexpected: string[] };

/** Key names only. A differing key is reported by NAME; its values are digests or counts. */
export function compareManifests(source: Manifest, restored: Manifest): ManifestComparison {
  const matched: string[] = [], differing: string[] = [], missing: string[] = [];
  for (const [k, v] of source) {
    if (!restored.has(k)) missing.push(k);
    else if (restored.get(k) === v) matched.push(k);
    else differing.push(k);
  }
  const unexpected = [...restored.keys()].filter((k) => !source.has(k));
  return { matched, differing, missing, unexpected };
}

// ─── 5 · behaviour ─────────────────────────────────────────────────────────────────────────────

export type BehaviourCheck = { id: string; ok: boolean; detail: string };

async function refused(target: RestoreTarget, setup: string[], probe: string): Promise<boolean> {
  await target.exec("BEGIN");
  try {
    for (const s of setup) await target.exec(s);
    await target.exec(probe);
    return false;
  } catch {
    return true;
  } finally {
    await target.exec("ROLLBACK");
  }
}

/** A probe that should answer. An error is reported as a failed check, never thrown past the verifier. */
async function scalar(target: RestoreTarget, setup: string[], probe: string): Promise<number | string> {
  await target.exec("BEGIN");
  try {
    for (const s of setup) await target.exec(s);
    const r = await target.query<{ n: number }>(probe);
    return Number(r.rows[0].n);
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    await target.exec("ROLLBACK");
  }
}

/**
 * Runs AFTER the manifest comparison: it consumes one sequence value on the (disposable) target.
 * `organizationId` must be an organization present in the restored data.
 */
export async function verifyBehaviour(target: RestoreTarget, organizationId: string): Promise<BehaviourCheck[]> {
  const org = organizationId.replace(/'/g, "");
  const as = (role: string, withOrg = true) => [
    ...(withOrg ? [`SELECT set_config('ascend.org_id', '${org}', true)`] : []),
    `SET LOCAL ROLE ${role}`,
  ];
  const checks: BehaviourCheck[] = [];

  const maxSeq = Number((await target.query<{ n: string | null }>("SELECT max(seq)::text AS n FROM events")).rows[0].n ?? 0);
  const next = Number((await target.query<{ n: string }>("SELECT nextval('events_seq_seq')::text AS n")).rows[0].n);
  checks.push({ id: "F6.next-seq-beyond-history", ok: next > maxSeq, detail: `next ${next} vs max ${maxSeq}` });

  const anyEvent = (await target.query<{ n: number }>("SELECT count(*)::int AS n FROM events")).rows[0].n > 0;
  checks.push({
    id: "F15.events-refuse-update", ok: anyEvent && await refused(target, [], "UPDATE events SET type = type"),
    detail: anyEvent ? "UPDATE on a restored event" : "no events to probe",
  });
  checks.push({
    id: "F15.events-refuse-delete", ok: anyEvent && await refused(target, [], "DELETE FROM events"),
    detail: anyEvent ? "DELETE on a restored event" : "no events to probe",
  });

  const total = (await target.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM prospects WHERE organization_id = $1", [organizationId])).rows[0].n;
  const ownerSees = await scalar(target, as("ascend_owner"), "SELECT count(*)::int AS n FROM prospects");
  checks.push({ id: "F12.owner-reads-own-org", ok: ownerSees === total, detail: `${ownerSees} of ${total}` });
  const blind = await scalar(target, as("ascend_owner", false), "SELECT count(*)::int AS n FROM prospects");
  checks.push({ id: "F12.no-org-sees-nothing", ok: blind === 0, detail: `${blind} rows without an organization` });
  checks.push({
    id: "F12.sales-cannot-delete-prospects",
    ok: await refused(target, as("ascend_sales"), "DELETE FROM prospects"), detail: "DELETE as ascend_sales",
  });
  checks.push({
    id: "F12.owner-cannot-read-credentials",
    ok: await refused(target, as("ascend_owner"), "SELECT password_hash FROM users"), detail: "as ascend_owner",
  });
  checks.push({
    id: "F12.sales-cannot-read-credentials",
    ok: await refused(target, as("ascend_sales"), "SELECT password_hash FROM users"), detail: "as ascend_sales",
  });
  checks.push({
    id: "F12.auth-reads-credentials",
    ok: !(await refused(target, as("ascend_auth"), "SELECT count(password_hash) FROM users")), detail: "as ascend_auth",
  });
  return checks;
}

// ─── the ephemeral socket target (R1c) ─────────────────────────────────────────────────────────
//
// A real PostgreSQL server, created for one proof and destroyed after it. Its whole existence is a
// directory: `<root>/<cluster>/data` and `<root>/<cluster>/sock`. It is started with
// `listen_addresses = ''`, so it has no TCP listener at all, and its only socket lives in that
// private directory.
//
// NOTHING HERE ACCEPTS A HOST. The socket path is derived from the root and the cluster directory,
// both of which must be real (non-symlinked) directories owned by this user and closed to everyone
// else. Then, on every connection, the server is interrogated before anything is sent to it.

/** Where a disposable server lives, and what it proved about itself when it was created. */
export type EphemeralServer = {
  /** The recovery root: absolute, real, owned by this user, mode 0700. */
  readonly root: string;
  /** This server's directory, directly or indirectly inside `root`. Holds `data/` and `sock/`. */
  readonly cluster: string;
  readonly port: number;
  /** `server_version`, exactly — e.g. "17.6". */
  readonly version: string;
  /** From `pg_controldata` at `initdb`: the identity of THIS cluster and no other. */
  readonly systemIdentifier: string;
};

export type EphemeralLogin = { readonly user: string; readonly password: string; readonly database: string };

const VERIFIED_SOCKET_TARGETS = new WeakSet<RestoreTarget>();

function privateDirectory(dir: string, what: string): string {
  if (!isAbsolute(dir)) throw new RestoreRefused(`the ${what} must be an absolute path`);
  let real: string;
  try { real = realpathSync(dir); } catch { throw new RestoreRefused(`the ${what} does not exist`); }
  if (real !== dir) throw new RestoreRefused(`the ${what} must not pass through a symbolic link`);
  const st = statSync(real);
  if (!st.isDirectory()) throw new RestoreRefused(`the ${what} is not a directory`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
    throw new RestoreRefused(`the ${what} is not owned by this user`);
  }
  if ((st.mode & 0o077) !== 0) throw new RestoreRefused(`the ${what} is open to other users (mode must be 0700)`);
  return real;
}

/**
 * The ONLY way a connection to an ephemeral server is configured. There is no host parameter: the
 * socket directory is `<cluster>/sock`, and it must exist, be private, and hold this port's socket.
 */
export function ephemeralSocketConfig(server: EphemeralServer, login: EphemeralLogin): ClientConfig {
  const root = privateDirectory(server.root, "recovery root");
  const cluster = privateDirectory(server.cluster, "cluster directory");
  if (!cluster.startsWith(root + sep)) throw new RestoreRefused("the cluster directory is outside the recovery root");
  if (!Number.isInteger(server.port) || server.port < 1024 || server.port > 65535) {
    throw new RestoreRefused("the port must be an integer in 1024–65535");
  }
  const sock = privateDirectory(join(cluster, "sock"), "socket directory");
  let isSocket = false;
  try { isSocket = lstatSync(join(sock, `.s.PGSQL.${server.port}`)).isSocket(); } catch { /* reported below */ }
  if (!isSocket) throw new RestoreRefused("no server socket for that port in the socket directory");
  return {
    host: sock,
    port: server.port,
    user: login.user,
    password: login.password,
    database: login.database,
    ssl: false,
    application_name: "ascend-r1c",
    connectionTimeoutMillis: 10_000,
  };
}

type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Prove a connection reached the disposable server. `privileged` connections (the cluster's own
 * superuser) additionally prove the data directory and system identifier; an application login
 * cannot read those, so it proves instead that it reached the SAME postmaster the privileged
 * connection verified — by its start time — over the same socket.
 */
export async function assertEphemeralServer(
  client: Queryable, server: EphemeralServer,
  check: { privileged: true } | { privileged: false; postmasterStart: string; database: string }
): Promise<{ postmasterStart: string }> {
  const fail = (what: string) => { throw new RestoreRefused(`isolation assertion failed: ${what}`); };
  const r = (await client.query(
    `SELECT inet_server_addr() IS NULL AS unix_socket,
            current_setting('listen_addresses') AS listen,
            current_setting('server_version') AS version,
            pg_postmaster_start_time()::text AS started,
            current_database() AS db`)).rows[0];
  if (r.unix_socket !== true) fail("inet_server_addr() IS NOT NULL — the session is not on a Unix socket");
  if (r.listen !== "") fail("listen_addresses is not empty — the server has a TCP listener");
  if (r.version !== server.version) fail(`server_version is ${String(r.version)}, expected ${server.version}`);
  if (check.privileged) {
    const p = (await client.query(
      `SELECT current_setting('data_directory') AS dir,
              (SELECT system_identifier::text FROM pg_control_system()) AS sysid`)).rows[0];
    const expectedData = join(realpathSync(server.cluster), "data");
    if (p.dir !== expectedData || !String(p.dir).startsWith(realpathSync(server.root) + sep)) {
      fail("data_directory is not this cluster's directory inside the recovery root");
    }
    if (p.sysid !== server.systemIdentifier) fail("system_identifier differs from the one recorded at initdb");
  } else {
    if (r.started !== check.postmasterStart) fail("this is not the postmaster the privileged connection verified");
    if (r.db !== check.database) fail(`connected to ${String(r.db)}, expected ${check.database}`);
  }
  return { postmasterStart: String(r.started) };
}

/**
 * Connect to a disposable server as its superuser, prove what it is, and return a restore target.
 * The returned `client` is the same session the target uses; `close()` ends it.
 */
export async function openEphemeralSocketTarget(server: EphemeralServer, login: EphemeralLogin, env: NodeJS.ProcessEnv = process.env): Promise<{
  target: RestoreTarget; client: Client; postmasterStart: string; close(): Promise<void>;
}> {
  assertIsolatedEnvironment(env);
  const client = new Client(ephemeralSocketConfig(server, login));
  await client.connect();
  let postmasterStart: string;
  try {
    ({ postmasterStart } = await assertEphemeralServer(client, server, { privileged: true }));
  } catch (e) {
    await client.end();
    throw e;
  }
  const target: RestoreTarget = {
    kind: "postgres-ephemeral-socket",
    // A multi-statement string returns one result per statement; `manifestOf` reads the last.
    exec: async (sql) => { const res = await client.query(sql); return Array.isArray(res) ? res : [res]; },
    query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
  };
  VERIFIED_SOCKET_TARGETS.add(target);
  return { target, client, postmasterStart, close: () => client.end() };
}
