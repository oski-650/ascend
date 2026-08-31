// core/db/provision — the APPLICATION LOGIN, and why it is not the migration login.
//
// ─── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────────────────────────
//
// Supabase's `postgres` role holds **BYPASSRLS**. Measured, not assumed: a bare `SELECT` on that
// connection returned every organization's rows. So while the application connects as `postgres`,
// row-level security protects nothing on its own — tenant isolation exists ONLY inside
// `asPrincipal`, which switches to a non-bypassing role.
//
// That makes a forgotten wrapper a silent cross-tenant data leak rather than an error. The failure
// mode is the worst kind: the query succeeds, returns more than it should, and nothing complains.
//
// ─── THE MODEL THIS ESTABLISHES ────────────────────────────────────────────────────────────────
//
//   human identity → session → organization/user context → RLS → canonical reader
//
// rather than
//
//   shared superuser-adjacent login → application code remembers to call asPrincipal()
//
// `ascend_app` is a login with NO privileges of its own. It cannot read a single row of any table
// until it assumes one of the `ascend_*` roles. So a query issued outside a principal binding does
// not return the wrong rows — it returns an ERROR. The security boundary stops depending on the
// application remembering anything.
//
// ─── NOINHERIT IS LOAD-BEARING ─────────────────────────────────────────────────────────────────
//
// `ascend_app` is a MEMBER of the three roles but does not INHERIT them. Membership grants the
// ability to `SET ROLE`; inheritance would grant the privileges passively, on every connection,
// which is exactly the ambient authority being removed. Both the role attribute (`NOINHERIT`) and
// the grant option (`WITH INHERIT FALSE`) say so, because either alone can be overridden by the
// other.
//
// ─── PRIVILEGE SEPARATION ──────────────────────────────────────────────────────────────────────
//
//   ascend_app   LOGIN, owns nothing, may only become ascend_owner/sales/automation
//   postgres     migrations and provisioning ONLY — never application traffic
//
// The application cannot run DDL, cannot alter a policy, cannot drop a trigger, and cannot create a
// table, because it owns no objects and holds no schema-level CREATE. Those are all verified
// against the live server rather than asserted here.

import "server-only";
import type { SqlClient } from "./client";

/** The application login. Not a secret — the password is, and never appears in this file. */
export const APP_LOGIN_ROLE = "ascend_app";

/** The roles it may assume. Exactly the four the schema defines; no fifth, no wildcard. */
export const ASSUMABLE_ROLES = [
  "ascend_owner", "ascend_sales", "ascend_automation",
  // Added in 005. Principal resolution must read `memberships` before any organization is known,
  // which every application role's policies make structurally impossible — they key on
  // `current_org()`, the value being resolved. `ascend_auth` holds SELECT on `users` and
  // `memberships` and nothing else: no prospects, no events, no writes anywhere.
  "ascend_auth",
  // Added in 006. The acceptance transaction assumes this to set a password for somebody who is not
  // authenticated; it holds UPDATE on three credential columns and no SELECT of `password_hash`.
  //
  // It is here because 006 first granted it TO `current_user` — copied from 001, whose grant targets
  // the MIGRATING identity, not the application login. Locally everything passed: PGlite runs as a
  // superuser and superusers assume any role unconditionally, which is the exact trap 001's own
  // header documents. In production every invitation acceptance would have answered "permission
  // denied to set role". A role the application must ASSUME belongs in this list, not only in the
  // migration that creates it.
  "ascend_invite",
] as const;

export class ProvisioningError extends Error {}

/**
 * Create or reconcile the application login.
 *
 * Idempotent by construction: `ALTER ROLE` re-states every attribute on each run, so a role that
 * drifted — someone granted it BYPASSRLS by hand — is corrected rather than left alone. Running
 * this is how you assert the login's shape, not merely how you create it.
 *
 * The password is applied every time. That makes rotation the same operation as provisioning.
 */
export async function provisionAppLogin(client: SqlClient, password: string): Promise<void> {
  if (!password || password.length < 20) {
    throw new ProvisioningError(
      "The application login password must be at least 20 characters. This credential is the " +
        "outer boundary of the system; it is not a place to economise."
    );
  }
  if (/['\\]/.test(password)) {
    // Not because the DDL below is unsafe — it binds the password and quotes it server-side with
    // `format(%L)`. The real constraint is downstream: this same credential is embedded in a
    // `postgres://` connection URL, where quoting and percent-encoding are a second escaping
    // problem with its own mistakes. Excluding two characters costs nothing and removes it.
    throw new ProvisioningError(
      "The application login password must not contain a single quote or backslash."
    );
  }

  await client.transaction(async (tx) => {
    // A SESSION-TEMP FUNCTION, not a `DO` block. `DO` accepts no bind parameters — an earlier
    // version passed `$1`/`$2` to one and they were never substituted — so the only way to keep the
    // password BOUND rather than concatenated into SQL by this process is a function that takes it
    // as an argument. `pg_temp` scopes it to this connection and drops it with the session.
    //
    // `format(%L)` then does the quoting inside the server, where it is the server's own escaping
    // rules doing the work rather than string handling in Node.
    //
    // THE ATTRIBUTE LIST OMITS EXACTLY ONE THING: `NOSUPERUSER`.
    //
    // Measured against the live server rather than assumed. A CREATEROLE administrator may set an
    // attribute on a role it administers only if it HOLDS that attribute itself, so with an admin
    // that has BYPASSRLS and REPLICATION, `NOBYPASSRLS` and `NOREPLICATION` are both accepted — and
    // `NOSUPERUSER` is refused with "permission denied to alter role", because the admin is not a
    // superuser. Including it takes the whole reconciliation down with it.
    //
    // So SUPERUSER is the one attribute this function cannot clear, and it is VERIFIED below
    // instead. Everything else is actively reconciled, which matters most for BYPASSRLS: the point
    // of this login is that it cannot bypass row-level security, and that is now enforced on every
    // run rather than merely set once at creation.
    await tx.exec(`
      CREATE OR REPLACE FUNCTION pg_temp.provision_login(p_role text, p_pw text) RETURNS void AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role) THEN
          EXECUTE format('ALTER ROLE %I WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT '
                         || 'NOBYPASSRLS NOREPLICATION PASSWORD %L', p_role, p_pw);
        ELSE
          EXECUTE format('CREATE ROLE %I WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT '
                         || 'NOBYPASSRLS NOREPLICATION PASSWORD %L', p_role, p_pw);
        END IF;
      END $fn$ LANGUAGE plpgsql`);
    await tx.query(`SELECT pg_temp.provision_login($1, $2)`, [APP_LOGIN_ROLE, password]);

    // Membership WITHOUT inheritance: the ability to BECOME these roles, never their privileges
    // passively. `SET TRUE` is required on PostgreSQL 16+, where membership alone no longer implies
    // it — the same defect that made the schema inert on managed Postgres.
    //
    // Interpolated directly because every value here is a compile-time constant in this module.
    // Neither the role list nor the login name is user input, so there is nothing to inject.
    const [{ modern }] = (await tx.query<{ modern: boolean }>(
      `SELECT current_setting('server_version_num')::int >= 160000 AS modern`
    )).rows;
    await tx.query(
      `GRANT ${ASSUMABLE_ROLES.join(", ")} TO ${APP_LOGIN_ROLE}` +
        (modern ? " WITH INHERIT FALSE, SET TRUE" : "")
    );

    // RECONCILE, don't merely create. Any privilege granted to this login by hand is taken back, so
    // running provisioning is how you ASSERT the login's shape rather than how you first make it.
    // Without this, "ascend_app holds no privileges of its own" would be true only until somebody
    // typed one GRANT.
    await tx.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${APP_LOGIN_ROLE}`);
    await tx.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${APP_LOGIN_ROLE}`);
    await tx.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${APP_LOGIN_ROLE}`);

    // Schema visibility only. NOT create: the application may not add objects to the schema it
    // reads. In PostgreSQL 15+ CREATE on `public` is already revoked from PUBLIC by default; this
    // states it rather than relying on the default surviving a future restore.
    await tx.query(`GRANT USAGE ON SCHEMA public TO ${APP_LOGIN_ROLE}`);
    await tx.query(`REVOKE CREATE ON SCHEMA public FROM ${APP_LOGIN_ROLE}`);
  });

  // VERIFY WHAT WAS RECONCILED, and refuse to report success on anything still dangerous.
  //
  // BYPASSRLS and REPLICATION were just cleared above, so finding them set here would mean the
  // reconciliation silently did not take. SUPERUSER cannot be cleared by this connection at all, so
  // for that one the only honest options are to check or to stay quiet — and staying quiet would
  // let provisioning "succeed" against a login that defeats every policy in the database, which is
  // the exact condition this module exists to remove.
  const attrs = await describeAppLogin(client);
  const dangerous = [
    attrs.bypassRls ? "BYPASSRLS" : null,
    attrs.superuser ? "SUPERUSER" : null,
    attrs.replication ? "REPLICATION" : null,
  ].filter(Boolean);
  if (dangerous.length > 0) {
    throw new ProvisioningError(
      `${APP_LOGIN_ROLE} holds ${dangerous.join(", ")}, which would defeat row-level security. ` +
        `SUPERUSER cannot be cleared without a superuser: run ALTER ROLE ${APP_LOGIN_ROLE} ` +
        "NOSUPERUSER NOBYPASSRLS NOREPLICATION as one."
    );
  }
}

export type AppLoginAttributes = {
  exists: boolean;
  canLogin: boolean;
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDb: boolean;
  replication: boolean;
  inherits: boolean;
  assumable: string[];
  directTableGrants: string[];
};

/** Read the login's ACTUAL shape from `pg_catalog`, for the gate to assert against. */
export async function describeAppLogin(client: SqlClient): Promise<AppLoginAttributes> {
  const roles = (await client.query<{
    rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean;
    rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolinherit: boolean;
  }>(
    `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
     FROM pg_roles WHERE rolname = $1`,
    [APP_LOGIN_ROLE]
  )).rows;

  if (roles.length === 0) {
    return {
      exists: false, canLogin: false, superuser: false, bypassRls: false, createRole: false,
      createDb: false, replication: false, inherits: false, assumable: [], directTableGrants: [],
    };
  }
  const r = roles[0];

  const assumable = (await client.query<{ role: string }>(
    `SELECT g.rolname AS role
     FROM pg_auth_members m
     JOIN pg_roles g ON g.oid = m.roleid
     JOIN pg_roles c ON c.oid = m.member
     WHERE c.rolname = $1 AND m.set_option
     ORDER BY 1`,
    [APP_LOGIN_ROLE]
  )).rows.map((x) => x.role);

  // Privileges held DIRECTLY, i.e. without assuming a role. Must be empty.
  const directTableGrants = (await client.query<{ g: string }>(
    `SELECT DISTINCT table_name || ':' || privilege_type AS g
     FROM information_schema.role_table_grants
     WHERE grantee = $1 AND table_schema = 'public'
     ORDER BY 1`,
    [APP_LOGIN_ROLE]
  )).rows.map((x) => x.g);

  return {
    exists: true,
    canLogin: r.rolcanlogin,
    superuser: r.rolsuper,
    bypassRls: r.rolbypassrls,
    createRole: r.rolcreaterole,
    createDb: r.rolcreatedb,
    replication: r.rolreplication,
    inherits: r.rolinherit,
    assumable,
    directTableGrants,
  };
}
