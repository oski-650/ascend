// tests/support/recovery-fixture — shared pieces for fixture-built recovery artifacts (R1a, RT-3B).

import type { PGlite } from "@electric-sql/pglite";
import type { RestoreTarget } from "@/core/recovery/restore";
import type { ProfileSession } from "@/core/recovery/profiles";

export function targetOf(pg: PGlite): RestoreTarget {
  return {
    kind: "pglite-in-process",
    exec: (sql) => pg.exec(sql),
    query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params as never[])).rows }),
  };
}

export function sessionOf(pg: PGlite): ProfileSession {
  return { query: async <T,>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params as never[])).rows }) };
}

/** `pg_dumpall --globals-only --no-role-passwords` line format, for the Ascend roles of `pg`. */
export async function globalsInDumpallFormat(pg: PGlite): Promise<string> {
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
