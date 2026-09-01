// tests/support/provisioned-partner — A REAL PARTNER, provisioned the way production provisions one
// (STAGE2G §29.3 Ruling 1, slice 2G.4.1).
//
// ─── WHAT "REAL" MEANS HERE ────────────────────────────────────────────────────────────────────
//
// §13 item 5 gates issuing any partner credential on this stage's page matrix being green, which
// makes a PRODUCTION partner self-referential: this stage cannot require one to exist in order to
// prove itself safe before one may. "Real" therefore means local-database-real — a membership row a
// genuine `acceptInvitation` transaction wrote, in PGlite carrying migrations 001-007, reached
// through `resolvePrincipal` exactly as production reaches it. No step is simulated between the
// operational INSERT and the principal a test then measures:
//
//   operational INSERT org+users+memberships → createInvitation() as owner, through asPrincipal
//   → acceptInvitation() (the partner chooses the password; the owner never learns it)
//   → POST /api/auth/login → verifySessionToken → resolvePrincipal(pglite, userId)
//
// Even the OWNER's principal above is obtained by resolving `owner@test`'s own membership through
// `resolvePrincipal` rather than declared — so the mechanism this module hands a test is the same
// one production runs for every human in the system, not a shortcut taken because the owner side
// felt lower-risk to fake.
//
// ─── WHAT THIS MODULE MUST NEVER DO ────────────────────────────────────────────────────────────
//
// Construct a principal from a role name, or hand a test a membership it did not read back off the
// database. `core/auth/principal`'s test-only constructor exists for suites that are not measuring
// authority itself; this module's whole purpose is measuring exactly that, so reaching for it here
// would make every test built on top void. F59 enforces this by scanning this file's own source
// text, alongside the suite that imports it, for that constructor and its two stub-world cousins
// declared in `tests/support/operator-session` — this module imports neither that file nor anything
// from it.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { asPrincipal, MIGRATIONS, type SqlClient, type SqlValue } from "@/core/db";
import { acceptInvitation, createInvitation } from "@/core/auth/invitations";
import { resolvePrincipal, type ResolvedPrincipal } from "@/core/auth/principal";
import { registerAuthorityResolver, type AuthorityAnswer } from "@/core/auth/authority";
import { createSessionToken, readAuthConfig, verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { POST as LOGIN_ROUTE } from "@/app/api/auth/login/route";

// DERIVED from MIGRATIONS, never a hardcoded list — the same discipline `tests/db/invitations.test.ts`
// uses, and for the same reason: a fixture list that must be edited whenever the schema grows is a
// fixture that will eventually be edited wrongly, silently leaving this suite behind the schema.
export const SCHEMA = MIGRATIONS
  .map((f) => readFileSync(path.join(process.cwd(), "core", "db", "schema", f), "utf8"))
  .join("\n");

/** A signing secret this module owns, so a suite never has to invent its own literal. */
export const SESSION_SECRET = "provisioned-partner-secret-do-not-use";

/** Adapt PGlite to the vendor-neutral `SqlClient` production code speaks. */
export function adapt(instance: PGlite): SqlClient {
  let depth = 0;
  const client: SqlClient = {
    async query(sql, params) {
      const res = await instance.query(sql, params ? [...(params as SqlValue[])] : undefined);
      return { rows: (res.rows ?? []) as never[], affected: res.affectedRows ?? 0 };
    },
    async exec(sql) { await instance.exec(sql); },
    async transaction(fn) {
      // DEPTH-AWARE (2G.4.1 adversarial pass, F1). Folds in `tests/db/savepoint-client.ts`'s logic
      // rather than importing it directly: that module deliberately never opens the OUTER
      // transaction (its header: the caller is responsible, "so nothing here can accidentally
      // commit"), whereas `adapt()` is the ONLY thing that owns the outer BEGIN/COMMIT for this
      // suite — so its `transaction` has to cover both the top-level case and the nested one, which
      // `savepointClient` alone does not.
      //
      // A bare BEGIN on re-entry is a no-op (Postgres warns and continues the existing transaction),
      // so the matching COMMIT would end the OUTER transaction — measured: `current_user` fell all
      // the way to `postgres` mid-callback. SAVEPOINT/RELEASE fixes that collapse, but is not by
      // itself enough: `current_user` and `ascend.org_id`/`ascend.user_id` are session GUCs that a
      // RELEASE (unlike a ROLLBACK TO SAVEPOINT) keeps rather than reverts — see
      // `tests/db/savepoint-client.ts`'s own caveat ("a role assumed inside a released savepoint
      // persists into the outer transaction"). Measured here too: nesting a bare `resolvePrincipal`
      // call (which sets `ascend_auth` for its own lookup) inside an `asPrincipal(sales)` block left
      // `current_user` as `ascend_auth`, not `ascend_sales`, once the nested call returned — same
      // shape of leak as F1, smaller blast radius. So a nested call snapshots the caller's role and
      // GUCs before it runs and restores them unconditionally afterward, success or failure, making
      // it a true unit of work from the caller's perspective either way.
      const nested = depth > 0;
      const name = `sp_${depth}`;
      // R5 (2G.4.1 review): `depth++` runs INSIDE the try, not before it. A snapshot SELECT that
      // throws before the increment used to leave `depth` unincremented but the `finally` below
      // still fires and decrements it — dropping it permanently negative, so every later top-level
      // `transaction()` believes it is nested and issues a SAVEPOINT with no enclosing BEGIN.
      let snapshot: { role: string; org_id: string; user_id: string } | null = null;
      const restore = async () => {
        if (!snapshot) return;
        await instance.exec(`SET LOCAL ROLE ${snapshot.role}`);
        await instance.query("SELECT set_config('ascend.org_id', $1, true)", [snapshot.org_id]);
        await instance.query("SELECT set_config('ascend.user_id', $1, true)", [snapshot.user_id]);
      };
      try {
        depth++;
        if (nested) {
          snapshot = (await instance.query<{ role: string; org_id: string; user_id: string }>(
            `SELECT current_user AS role,
                    current_setting('ascend.org_id', true) AS org_id,
                    current_setting('ascend.user_id', true) AS user_id`
          )).rows[0];
        }
        if (nested) await instance.exec(`SAVEPOINT ${name}`); else await instance.exec("BEGIN");
        const out = await fn(client);
        if (nested) await instance.exec(`RELEASE SAVEPOINT ${name}`); else await instance.exec("COMMIT");
        await restore();
        return out;
      } catch (e) {
        if (nested) {
          await instance.exec(`ROLLBACK TO SAVEPOINT ${name}`);
          await instance.exec(`RELEASE SAVEPOINT ${name}`);
          await restore();
        } else {
          await instance.exec("ROLLBACK");
        }
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return client;
}

/** Boot a fresh PGlite carrying the full migration set, and adapt it. */
export async function bootDatabase(): Promise<{ pg: PGlite; db: SqlClient }> {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  return { pg, db: adapt(pg) };
}

export type World = { organizationId: string; ownerId: string; partnerId: string };

/**
 * The operational writes an administrator makes BEFORE any invitation exists: an organization, an
 * owner, and a partner who already holds a `sales` membership. An invitation names a member — it
 * grants no membership itself — so this step is the precondition every chain below depends on.
 */
export async function seedOperationalWorld(
  db: SqlClient,
  opts: { orgSlug: string; ownerEmail: string; partnerEmail: string }
): Promise<World> {
  const org = await db.query<{ id: string }>(
    "INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id",
    [opts.orgSlug, opts.orgSlug]);
  const organizationId = org.rows[0].id;
  const o = await db.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Owner') RETURNING id", [opts.ownerEmail]);
  const ownerId = o.rows[0].id;
  const p = await db.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Partner') RETURNING id", [opts.partnerEmail]);
  const partnerId = p.rows[0].id;
  await db.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner')",
    [ownerId, organizationId]);
  await db.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'sales')",
    [partnerId, organizationId]);
  return { organizationId, ownerId, partnerId };
}

/**
 * Issue an invitation AS THE OWNER. The owner's own principal is not declared — it is resolved from
 * the same `memberships` row the partner's will later be, so the issuing side of the chain rests on
 * the database exactly as the accepting side does.
 */
export async function issueInvitationAsOwner(
  db: SqlClient,
  world: World,
  ttlMs = 3_600_000
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const resolution = await resolvePrincipal(db, world.ownerId);
  if (!resolution.ok) {
    throw new Error(
      `the owner's own membership did not resolve (${resolution.reason}) — an invitation cannot be ` +
      "issued from a principal this harness did not get from the database");
  }
  return asPrincipal(db, resolution.principal, (tx) =>
    createInvitation(tx, {
      organizationId: world.organizationId, userId: world.partnerId,
      createdBy: world.ownerId, ttlMs,
    }));
}

/** A session cookie, parsed out of a real `Set-Cookie` header exactly as a browser would read one. */
function extractSessionToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookieHeader);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Drive the REAL route — `app/api/auth/login/route.ts` — with a plain unauthenticated request. */
export async function loginPartner(
  email: string,
  password: string
): Promise<{ response: Response; sessionToken: string | null }> {
  const request = new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const response = await LOGIN_ROUTE(request);
  return { response, sessionToken: extractSessionToken(response.headers.get("set-cookie")) };
}

/**
 * Register the data-access boundary's resolver, exactly as `lib/authority.ts`'s `bindAuthorityResolver`
 * does for a real request — except the identity is verified here, out of the SESSION TOKEN itself,
 * standing in for the request-scoped carrier a route or page would normally supply.
 *
 * THE TOKEN IS THE INPUT (F6, adversarial pass): earlier this took a `userId` handed in by the
 * caller, verified in a separate statement and only ever compared back to that same seed value — no
 * code path took the token and produced the refusal, so a row built on it measured less than its
 * title claimed. Here the token is verified on every call, exactly where `resolvePrincipal` needs a
 * `userId` from, so a forged or unsigned token is refused by the same path a real one succeeds
 * through, not by a comparison this function invents for itself.
 *
 * RUNS PER CALL, not once at bind time: every invocation re-verifies the token AND re-reads
 * `memberships` and `users.disabled_at` through `resolvePrincipal`, so a revocation applied after
 * binding is observed on the very next call — the property production depends on, and the one row 7
 * measures.
 */
export function bindPartnerAuthority(db: SqlClient, sessionToken: string): void {
  registerAuthorityResolver(async (): Promise<AuthorityAnswer> => {
    const identity = await verifySessionToken(sessionToken, readAuthConfig());
    if (!identity) return { ok: false, reason: "invalid-session" };
    const resolution = await resolvePrincipal(db, identity.userId);
    if (!resolution.ok) return { ok: false, reason: resolution.reason };
    return { ok: true, principal: resolution.principal };
  });
}

export type ProvisionedPartner = {
  world: World;
  invitation: { token: string; id: string; expiresAt: Date };
  acceptance: { userId: string };
  login: { response: Response; sessionToken: string | null };
  principal: ResolvedPrincipal;
};

/**
 * THE WHOLE CHAIN, run once, no step simulated. Callers that need to bind the authority resolver
 * afterwards do so themselves with `bindPartnerAuthority` — this function only proves the chain up
 * to a resolved principal, which is as far as provisioning itself goes.
 */
export async function provisionPartner(
  db: SqlClient,
  opts: { orgSlug: string; ownerEmail: string; partnerEmail: string; password: string }
): Promise<ProvisionedPartner> {
  const world = await seedOperationalWorld(db, opts);
  const invitation = await issueInvitationAsOwner(db, world);
  const acceptance = await acceptInvitation(db, invitation.token, opts.password);
  const login = await loginPartner(opts.partnerEmail, opts.password);
  if (!login.sessionToken) {
    throw new Error("the login route set no session cookie — the chain broke before a principal existed");
  }
  const identity = await verifySessionToken(login.sessionToken, readAuthConfig());
  if (!identity) {
    throw new Error("the freshly minted session did not verify — the chain broke before a principal existed");
  }
  const resolution = await resolvePrincipal(db, identity.userId);
  if (!resolution.ok) {
    throw new Error(`resolvePrincipal refused the freshly provisioned partner (${resolution.reason})`);
  }
  return { world, invitation, acceptance, login, principal: resolution.principal };
}

/** Only present so a caller can mint an owner session the same real way, if a test ever needs one. */
export async function tokenFor(userId: string): Promise<string> {
  const token = await createSessionToken(readAuthConfig(), userId);
  if (!token) throw new Error("could not mint a session token — is ASCEND_OS_SESSION_SECRET set?");
  return token;
}

export type LogCapture = { texts: string[]; restore: () => void };

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/**
 * Captures both `console.*` and any direct stdout/stderr write while active.
 *
 * MEASURED while writing this suite: under Vitest's runner, `console.*` does NOT reliably funnel
 * through `process.stdout.write`/`process.stderr.write` looked up dynamically — the runner installs
 * its own console handling, so a capture that patched only the two stream methods missed every
 * `console.log` call outright. Both are patched here, independently, so nothing depends on which
 * channel a given write happens to use.
 *
 * OBJECT-SHAPED ARGUMENTS ARE FORMATTED WITH `util.inspect` (F2, adversarial pass), not `String()`.
 * `String({ password })` yields the literally useless `"[object Object]"` — the plaintext would be
 * lost to the capture even though the REAL `console.log` prints it in full via the same `util.inspect`
 * machinery Node uses internally. Object-shaped logging (`console.log("body", { password })`) is the
 * most plausible leak shape in real code, and a capture that cannot see it proves nothing about it.
 */
export function captureLogs(): LogCapture {
  const texts: string[] = [];
  const record = (text: string) => { texts.push(text); };
  const format = (a: unknown) => (typeof a === "string" ? a : inspect(a, { depth: 5 }));

  const originalConsole = {} as Record<(typeof CONSOLE_METHODS)[number], (...args: unknown[]) => void>;
  for (const method of CONSOLE_METHODS) {
    originalConsole[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      record(args.map(format).join(" "));
      originalConsole[method](...args);
    };
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const recording = (original: typeof originalStdoutWrite) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      record(typeof chunk === "string" ? chunk : String(chunk));
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
  process.stdout.write = recording(originalStdoutWrite);
  process.stderr.write = recording(originalStderrWrite);

  return {
    texts,
    restore: () => {
      for (const method of CONSOLE_METHODS) console[method] = originalConsole[method];
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}
