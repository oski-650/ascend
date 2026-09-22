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
//   4. the SAME manifest the backup ran against the source, compared key for key — the one the
//      artifact's RECOVERY CONTRACT names (core/recovery/contract.ts, RT-3), never "whatever
//      `manifest.sql` the repository holds today"
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

/**
 * The repository's CURRENT manifest: what the NEXT backup will run and seal (RT-3). It is not the
 * contract of any existing artifact — a restore is verified against `RecoveryContract.manifestSql`.
 */
export const MANIFEST_SQL = readFileSync(new URL("./manifest.sql", import.meta.url), "utf8");

/** What a restore is verified against: the manifest text and the RT-2 exclusions, from ONE contract. */
export type VerificationContract = {
  readonly manifestSql: string;
  readonly coverageExclusions: Readonly<Record<string, string>>;
};

// ─── RT-2 · COVERAGE TOTALITY ──────────────────────────────────────────────────────────────────
//
// THE HOLE THIS CLOSES. F3 counts rows and F4 digests row content, but only for the tables the
// manifest NAMES, and `MANIFEST_TABLES` is derived from that same list. So a table added by a
// migration and not added to the manifest was invisible three ways at once: its rows were never
// counted, its content never verified, and it silently dropped out of every "for each manifest table"
// loop that exists to catch exactly that (the fixture's every-table-has-rows check, R1c's write-refusal
// sweep). F1 listed it, and nothing compared F1 with F3/F4 on a restored artifact. Recovery would go
// green while a whole table went unverified.
//
// THE UNIVERSE IS NOT DERIVED FROM THE LIST BEING CHECKED. It comes from the CATALOG of the database
// being verified, queried directly here — not from `manifest.sql`, and not from F1 either, which is
// itself produced by that file. F3 and F4 are then checked INDEPENDENTLY of each other: a table that is
// counted but never content-digested is a gap too.
//
// This check lives beside the manifest, not in it, and it is run with the manifest of the artifact's
// own recovery contract (RT-3). Until RT-3, editing `manifest.sql` would have broken the verification
// of every existing artifact; now a v3 artifact carries the manifest it was taken with and a v2 artifact
// is given a pinned one, so the repository's file can grow with the schema (migration 010).

/** The schema application tables live in. A table anywhere else is itself a finding (see the tests). */
export const APPLICATION_SCHEMA = "public";

/**
 * Tables deliberately EXCLUDED from row and content verification — each with its reason.
 *
 * EMPTY, and meant to stay that way. Every application table carries business or provenance state
 * (`schema_migrations` included: it is the ledger A5 rests on). An entry here is a claim that a table's
 * contents do not need to survive a restore, and it must say why — narrowly, per table, never by
 * pattern.
 */
export const COVERAGE_EXCLUSIONS: Readonly<Record<string, string>> = Object.freeze({});

/** The tables whose rows `sql` COUNTS (F3) and whose content it DIGESTS (F4), read separately. */
export function manifestCoverage(sql: string): { counted: string[]; digested: string[] } {
  const names = (re: RegExp) => [...new Set([...sql.matchAll(re)].map((m) => m[1]))].sort();
  return {
    counted: names(/'F3\.rows\.([a-z_][a-z0-9_]*)'/g),
    digested: names(/'F4\.digest\.([a-z_][a-z0-9_]*)'/g),
  };
}

/**
 * Every table in the application schema, straight from the catalog of `target`.
 *
 * Ordinary (`r`) and partitioned (`p`) tables; individual partitions are excluded because their rows
 * are verified through their parent. Views, sequences and indexes hold no independent rows.
 */
export async function catalogTables(target: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }): Promise<string[]> {
  const { rows } = await target.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname COLLATE "C"`, [APPLICATION_SCHEMA]);
  return rows.map((r) => r.relname);
}

export type CoverageGaps = {
  /** in the catalog, not excluded, but its rows are never counted (no F3 key) */
  uncounted: string[];
  /** in the catalog, not excluded, but its content is never verified (no F4 key) */
  undigested: string[];
  /** covered by the manifest but absent from the catalog — the manifest describes a table that isn't there */
  phantom: string[];
  /** excluded, yet absent from the catalog — a stale exclusion hides nothing and must be removed */
  staleExclusions: string[];
};

/** Pure: compare an independent table universe with what a manifest covers. */
export function coverageGaps(
  tables: readonly string[],
  coverage: { counted: readonly string[]; digested: readonly string[] },
  exclusions: Readonly<Record<string, string>> = COVERAGE_EXCLUSIONS,
): CoverageGaps {
  const inCatalog = new Set(tables);
  const excluded = new Set(Object.keys(exclusions));
  const mustCover = tables.filter((t) => !excluded.has(t));
  return {
    uncounted: mustCover.filter((t) => !coverage.counted.includes(t)),
    undigested: mustCover.filter((t) => !coverage.digested.includes(t)),
    phantom: [...new Set([...coverage.counted, ...coverage.digested])].filter((t) => !inCatalog.has(t)).sort(),
    staleExclusions: [...excluded].filter((t) => !inCatalog.has(t)).sort(),
  };
}

export const noGaps = (g: CoverageGaps): boolean =>
  g.uncounted.length + g.undigested.length + g.phantom.length + g.staleExclusions.length === 0;

export const describeGaps = (g: CoverageGaps): string =>
  noGaps(g) ? "every application table is counted and digested"
    : Object.entries(g).filter(([, v]) => (v as string[]).length).map(([k, v]) => `${k}: ${(v as string[]).join(",")}`).join("; ");

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

// ─── BOUNDED MANIFEST EXECUTION (RT-3) ─────────────────────────────────────────────────────────
//
// A v3 artifact's manifest comes out of the artifact, so it is executed under rules that do not
// depend on trusting it (it is authenticated, but "authenticated" means "sealed by a key holder", not
// "harmless"). Every manifest — embedded, pinned legacy, or the repository's own — runs the same way:
//
//   1. SHAPE, checked before execution: only session-local `SET`s of the six determinism settings,
//      then exactly ONE statement of the form `WITH m(k, v) AS (…) SELECT …` — no transaction control,
//      no DDL/DML, no psql meta-commands, no dollar quoting, none of the functions that reach outside a
//      query. Literals and comments are removed before words are examined, so a keyword inside a
//      string is not mistaken for one, and one outside cannot hide in a comment.
//   2. A READ ONLY TRANSACTION, rolled back: anything that writes — `nextval` included — is refused
//      by the server, and the settings it made are undone.
//   3. Only against a restore target (an in-process PGlite or a verified ephemeral socket), as before.
//   4. It must produce `meta.format = ascend-recovery-manifest/1`.

const MANIFEST_SETTINGS = ["timezone", "datestyle", "intervalstyle", "extra_float_digits", "bytea_output", "search_path"];
const MANIFEST_FORBIDDEN = new RegExp("\\b(" + [
  "insert", "update", "delete", "merge", "create", "drop", "alter", "grant", "revoke", "truncate", "copy", "call",
  "do", "commit", "rollback", "begin", "savepoint", "release", "prepare", "execute", "deallocate",
  "lock", "listen", "notify", "unlisten", "vacuum", "analyze", "cluster", "reindex", "refresh", "checkpoint",
  "set", "reset", "discard", "load", "import", "security", "comment",
  "set_config", "nextval", "setval", "pg_sleep", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import", "lo_export", "dblink",
  "pg_advisory_lock", "pg_advisory_xact_lock", "pg_notify", "txid_current", "pg_current_xact_id",
].join("|") + ")\\b", "i");

/** The manifest as CODE: comments dropped, every literal and quoted identifier blanked. Throws on `$`-quoting and psql meta-commands. */
function manifestCode(sql: string): string {
  let out = "";
  let i = 0;
  let lineStart = true;
  while (i < sql.length) {
    const c = sql[i], d = sql[i + 1];
    if (lineStart && c === "\\") throw new RestoreRefused("manifest refused: it contains a psql meta-command");
    if (c === "-" && d === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      let depth = 1; i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; } else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; } else i++;
      }
      if (depth > 0) throw new RestoreRefused("manifest refused: an unterminated comment");
      out += " "; continue;
    }
    if (c === "$") throw new RestoreRefused("manifest refused: dollar quoting or positional parameters");
    if (c === "'" || c === '"') {
      const escaped = c === "'" && /[eE]/.test(out.slice(-1)) && !/[A-Za-z0-9_]/.test(out.slice(-2, -1));
      i++;
      for (;;) {
        if (i >= sql.length) throw new RestoreRefused("manifest refused: an unterminated literal");
        if (escaped && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue; } i++; break; }
        i++;
      }
      out += c === "'" ? "'_'" : '"_"';
      lineStart = false;
      continue;
    }
    out += c;
    lineStart = c === "\n" ? true : (lineStart && (c === " " || c === "\t"));
    i++;
  }
  return out;
}

/**
 * Refuse any manifest that is not EXACTLY a recovery manifest: determinism `SET`s, then one
 * `WITH m(k, v) AS (…) SELECT …`. Exported so a contract is checked when it is resolved, before any
 * restore begins, as well as at execution.
 */
export function assertManifestShape(sql: string): void {
  if (typeof sql !== "string" || sql.includes("\u0000")) throw new RestoreRefused("manifest refused: not text");
  const statements = manifestCode(sql).split(";").map((x) => x.trim());
  if (statements[statements.length - 1] !== "") throw new RestoreRefused("manifest refused: text after the final statement");
  statements.pop();
  if (statements.some((x) => x === "")) throw new RestoreRefused("manifest refused: an empty statement");
  const query = statements.pop();
  if (!query || !/^WITH\s+m\s*\(\s*k\s*,\s*v\s*\)\s+AS\s*\(/i.test(query)) {
    throw new RestoreRefused("manifest refused: the final statement is not WITH m(k, v) AS (…)");
  }
  for (const setting of statements) {
    const m = /^SET\s+([a-z_]+)\s*(?:=|\bTO\b)\s*([^;]*)$/i.exec(setting);
    if (!m || !MANIFEST_SETTINGS.includes(m[1].toLowerCase()) || MANIFEST_FORBIDDEN.test(m[2])) {
      throw new RestoreRefused(`manifest refused: only SET of ${MANIFEST_SETTINGS.join(", ")} may precede the query`);
    }
  }
  const bad = MANIFEST_FORBIDDEN.exec(query);
  if (bad) throw new RestoreRefused(`manifest refused: the query uses ${bad[1].toUpperCase()}`);
}

/**
 * The manifest of `target`, computed by `sql` — which the caller takes from ONE place: a restore
 * from its artifact's recovery contract, a source (the fixture's, or production's in the backup
 * script) from the manifest being sealed. There is no default: a silent default is how an artifact
 * came to be verified against a manifest it was never taken with.
 */
export async function manifestOf(target: { exec(sql: string): Promise<unknown> }, sql: string): Promise<Manifest> {
  assertManifestShape(sql);
  await target.exec("BEGIN TRANSACTION READ ONLY");
  let results: { rows: { k: string; v: string }[] }[];
  try {
    results = (await target.exec(sql)) as { rows: { k: string; v: string }[] }[];
  } finally {
    await target.exec("ROLLBACK");
  }
  const rows = results[results.length - 1]?.rows ?? [];
  const m: Manifest = new Map(rows.map((r) => [r.k, r.v]));
  if (m.get("meta.format") !== "ascend-recovery-manifest/1") throw new RestoreRefused("the manifest did not produce an ascend-recovery-manifest/1");
  return m;
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
export async function verifyBehaviour(
  target: RestoreTarget, organizationId: string,
  /** The artifact's recovery contract: its manifest's F3/F4 coverage and its RT-2 exclusions. Required. */
  contract: VerificationContract,
): Promise<BehaviourCheck[]> {
  const org = organizationId.replace(/'/g, "");
  const as = (role: string, withOrg = true) => [
    ...(withOrg ? [`SELECT set_config('ascend.org_id', '${org}', true)`] : []),
    `SET LOCAL ROLE ${role}`,
  ];
  const checks: BehaviourCheck[] = [];

  // RT-2 FIRST, and on every leg: the restored database's own catalog against what the manifest
  // counts and digests. It needs no organization and consumes nothing, so it runs before anything that
  // could fail for an unrelated reason and hide it.
  const gaps = coverageGaps(await catalogTables(target), manifestCoverage(contract.manifestSql), contract.coverageExclusions);
  checks.push({ id: "RT2.coverage-totality", ok: noGaps(gaps), detail: describeGaps(gaps) });

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
