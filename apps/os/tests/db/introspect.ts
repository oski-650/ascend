// tests/db/introspect — read the database's ACTUAL shape, for before/after comparison.
//
// Used two ways, and the difference matters:
//
//   1. As a STATE RECORD taken before the migrations, so "what did production look like
//      beforehand" is an artifact rather than a memory.
//   2. As VERIFICATION afterwards, asserting that what the server ended up holding is what the
//      migration files describe — read from `pg_catalog`, not from re-reading the .sql.
//
// Reading the SQL back and diffing it against itself would prove nothing. Every query here asks the
// SERVER what it enforces.

import type { SqlClient } from "@/core/db";

export type DbState = {
  server: string;
  currentUser: string;
  isSuperuser: boolean;
  publicTables: string[];
  ascendRoles: { rolname: string; canlogin: boolean; superuser: boolean; createrole: boolean; inherit: boolean }[];
  roleGrants: { role: string; member: string; admin: boolean; set: boolean; inherit: boolean }[];
  rowCounts: Record<string, number>;
};

const q = async <T>(c: SqlClient, sql: string, p?: readonly (string | number)[]) =>
  (await c.query<T>(sql, p)).rows;

/** Everything about the cluster this system is allowed to care about. */
export async function captureState(c: SqlClient, schema = "public"): Promise<DbState> {
  const [meta] = await q<{ v: string; usr: string; su: boolean }>(
    c,
    `SELECT version() AS v, current_user AS usr,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`
  );

  const tables = await q<{ tablename: string }>(
    c,
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema]
  );

  const roles = await q<{
    rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreaterole: boolean; rolinherit: boolean;
  }>(c, `SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolinherit
         FROM pg_roles WHERE rolname LIKE 'ascend%' ORDER BY rolname`);

  const grants = await q<{ role: string; member: string; admin: boolean; s: boolean; inh: boolean }>(
    c,
    `SELECT r.rolname AS role, m.member::regrole::text AS member,
            m.admin_option AS admin, m.set_option AS s, m.inherit_option AS inh
     FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
     WHERE r.rolname LIKE 'ascend%' ORDER BY 1, 2, 3`
  );

  // Row counts, but only for tables that exist — asking for a missing table is an error, and the
  // whole point of the PRE state is that these tables do not exist yet.
  const rowCounts: Record<string, number> = {};
  for (const t of ["organizations", "users", "memberships", "prospects", "events"]) {
    if (!tables.some((x) => x.tablename === t)) continue;
    const [row] = await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM ${schema}.${t}`);
    rowCounts[t] = Number(row.n);
  }

  return {
    server: meta.v.split(" on ")[0],
    currentUser: meta.usr,
    isSuperuser: meta.su,
    publicTables: tables.map((t) => t.tablename),
    ascendRoles: roles.map((r) => ({
      rolname: r.rolname, canlogin: r.rolcanlogin, superuser: r.rolsuper,
      createrole: r.rolcreaterole, inherit: r.rolinherit,
    })),
    roleGrants: grants.map((g) => ({
      role: g.role, member: g.member, admin: g.admin, set: g.s, inherit: g.inh,
    })),
    rowCounts,
  };
}

// ─── Structural introspection, used to verify the migration landed ─────────────────────────────

export const policies = (c: SqlClient, schema: string) =>
  q<{ tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
    c,
    `SELECT tablename, policyname, cmd, qual, with_check
     FROM pg_policies WHERE schemaname = $1 ORDER BY tablename, policyname`,
    [schema]
  );

export const constraints = (c: SqlClient, schema: string) =>
  q<{ table: string; name: string; type: string; def: string }>(
    c,
    `SELECT rel.relname AS table, con.conname AS name, con.contype AS type,
            pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = $1 ORDER BY 1, 2`,
    [schema]
  );

export const triggers = (c: SqlClient, schema: string) =>
  q<{ table: string; name: string; def: string }>(
    c,
    `SELECT rel.relname AS table, tg.tgname AS name, pg_get_triggerdef(tg.oid) AS def
     FROM pg_trigger tg
     JOIN pg_class rel ON rel.oid = tg.tgrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = $1 AND NOT tg.tgisinternal ORDER BY 1, 2`,
    [schema]
  );

/** RLS enablement — `forced` is the load-bearing half: without it the table owner bypasses policies. */
export const rlsFlags = (c: SqlClient, schema: string) =>
  q<{ table: string; enabled: boolean; forced: boolean }>(
    c,
    `SELECT rel.relname AS table, rel.relrowsecurity AS enabled, rel.relforcerowsecurity AS forced
     FROM pg_class rel JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = $1 AND rel.relkind = 'r' ORDER BY 1`,
    [schema]
  );

/** Column-level grants — how "automation may not write judgment" is actually expressed. */
export const columnGrants = (c: SqlClient, schema: string, table: string) =>
  q<{ grantee: string; column: string; privilege: string }>(
    c,
    `SELECT grantee, column_name AS column, privilege_type AS privilege
     FROM information_schema.column_privileges
     WHERE table_schema = $1 AND table_name = $2 AND grantee LIKE 'ascend%'
     ORDER BY grantee, column_name, privilege_type`,
    [schema, table]
  );

export const tableGrants = (c: SqlClient, schema: string) =>
  q<{ grantee: string; table: string; privilege: string }>(
    c,
    `SELECT grantee, table_name AS table, privilege_type AS privilege
     FROM information_schema.role_table_grants
     WHERE table_schema = $1 AND grantee LIKE 'ascend%'
     ORDER BY grantee, table_name, privilege_type`,
    [schema]
  );

/**
 * These harnesses need an ADMINISTRATIVE connection, and should say so plainly.
 *
 * `pooled-principal` creates and drops a schema; `production-authorization` seeds organizations.
 * Neither is something the application login can do — deliberately, since `ascend_app` holds no
 * privilege of its own. Pointed at the application URL they would fail with a scatter of
 * "permission denied" messages that look like a broken security model rather than a misconfigured
 * test. This turns that into one sentence.
 */
export async function requireAdminConnection(c: SqlClient, suite: string): Promise<void> {
  const [row] = (await c.query<{ usr: string; brls: boolean }>(
    `SELECT current_user AS usr,
            coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS brls`
  )).rows;
  if (!row.brls) {
    throw new Error(
      `${suite} requires an ADMIN database connection and got "${row.usr}", which cannot seed ` +
        "tenancy rows or create schemas. Set ASCEND_TEST_DATABASE_URL to " +
        "ASCEND_DATABASE_URL_ADMIN_POOLED, not to ASCEND_DATABASE_URL (the application login)."
    );
  }
}
