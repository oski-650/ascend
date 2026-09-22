// core/recovery/profiles — THE APPLICATION VERIFICATION PROFILES, implemented (RT-3B).
//
// Each profile is the business-level half of a recovery contract for ONE exact schema (its ledger in
// core/recovery/profile-registry.ts). It answers, on a restored database, the questions the
// application's acceptance asked — can the owner log in, do they resolve to their organization, do
// they see every prospect, note, event, invitation and member, is another tenant invisible, are the
// role grants intact — WITHOUT calling today's readers, whose SQL may assume columns an older schema
// never had.
//
// ─── WHAT A PROFILE IS, AND IS NOT ─────────────────────────────────────────────────────────────
//
//   · Reviewed repository code: fixed SQL text written for that schema. It reads nothing from the
//     artifact but the database the artifact was restored into; it never executes artifact content.
//   · READ-ONLY. Every query is a SELECT; grants are read from the catalog (`has_*_privilege`) rather
//     than proven by attempting writes, so a profile runs unchanged on R1c's guarded, read-only clone.
//   · Run AS THE APPLICATION: each assertion runs in a transaction bound the way `asPrincipal` binds
//     one (`ascend.org_id`, `ascend.user_id`, `SET LOCAL ROLE`), on the application's own connection,
//     and is compared with ground truth the superuser reads on the same restore.
//   · Imports: Node builtins and the registry. NOT core/db, NOT core/auth — a test enforces it — so a
//     change to a current reader cannot change what a historical profile verifies.

import { randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { profileFitsLedger, profileSpec } from "./profile-registry";

/** One database session. `query` runs one statement; transactions are BEGIN … ROLLBACK on it. */
export type ProfileSession = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

export type ProfileContext = {
  /** Superuser on the restore: the ground truth, read with raw SQL. */
  admin: ProfileSession;
  /** The application's connection (R1b: the in-process database; R1c: the restored `ascend_app` login). */
  app: ProfileSession;
  ownerEmail: string;
  ownerPassword: string;
  /** F6's event-order digest from the artifact's source manifest, compared as a string only. */
  sourceEventOrderDigest?: string;
};

export type ProfileCheck = { id: string; ok: boolean; detail: string };
/** Non-sensitive measurements, for evidence: counts and booleans only. */
export type ProfileResult = { profile: string; checks: ProfileCheck[]; measured: Record<string, unknown> };

export class ProfileRefused extends Error {}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const n = (v: unknown) => Number(v);

/** A transaction on the application connection, bound like `asPrincipal`, always rolled back. */
async function as<T>(s: ProfileSession, role: string, bind: { org?: string; user?: string }, fn: () => Promise<T>): Promise<T> {
  if (!/^ascend_(owner|sales|automation|auth)$/.test(role)) throw new ProfileRefused(`not an application role: ${role}`);
  await s.query("BEGIN");
  try {
    await s.query("SELECT set_config('ascend.org_id', $1, true)", [bind.org ?? ""]);
    await s.query("SELECT set_config('ascend.user_id', $1, true)", [bind.user ?? ""]);
    await s.query(`SET LOCAL ROLE ${role}`);
    return await fn();
  } finally {
    await s.query("ROLLBACK");
  }
}

/** Verify a stored `scrypt$N$r$p$<salt>$<hash>` credential — the profile's own, not today's module. */
export function scryptMatches(password: string, stored: string): boolean {
  const p = stored.split("$");
  if (p.length !== 6 || p[0] !== "scrypt") return false;
  const [N, r, par] = [Number(p[1]), Number(p[2]), Number(p[3])];
  if (![N, r, par].every((x) => Number.isInteger(x) && x > 0)) return false;
  const salt = Buffer.from(p[4], "base64"), want = Buffer.from(p[5], "base64");
  if (want.length === 0) return false;
  const got = scryptSync(password, salt, want.length, { N, r, p: par, maxmem: 256 * N * r + 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

type Common = { userId: string; org: string };

/** Owner credential, principal and membership — identical SQL for every schema from 005 onward. */
async function identity(ctx: ProfileContext, checks: ProfileCheck[], measured: Record<string, unknown>): Promise<Common | null> {
  const cred = await as(ctx.app, "ascend_auth", {}, async () => (await ctx.app.query<{ id: string; password_hash: string | null; disabled_at: unknown }>(
    "SELECT id::text AS id, password_hash, disabled_at FROM users WHERE lower(email) = lower($1)", [ctx.ownerEmail])).rows);
  const one = cred.length === 1 && typeof cred[0].password_hash === "string" && cred[0].disabled_at === null;
  const accepts = one && scryptMatches(ctx.ownerPassword, cred[0].password_hash!);
  const refuses = one && !scryptMatches(ctx.ownerPassword + "-wrong", cred[0].password_hash!);
  checks.push({ id: "APP.credential", ok: accepts && refuses,
    detail: one ? `stored credential ${accepts ? "accepts" : "REFUSES"} the real password, ${refuses ? "refuses" : "ACCEPTS"} a wrong one` : `${cred.length} enabled credential rows for the owner email` });
  if (!one) return null;
  const userId = cred[0].id;

  const m = await as(ctx.app, "ascend_auth", {}, async () => (await ctx.app.query<{ org: string | null; role: string | null }>(
    `SELECT m.organization_id::text AS org, m.role FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.id = $1`, [userId])).rows);
  const truth = (await ctx.admin.query<{ org: string }>(
    "SELECT organization_id::text AS org FROM memberships WHERE user_id = $1", [userId])).rows;
  const resolved = m.length === 1 && m[0].org !== null && m[0].role === "owner" && truth.length === 1 && truth[0].org === m[0].org;
  checks.push({ id: "APP.principal", ok: resolved, detail: resolved ? "resolves to exactly one owner membership, the restored one" : `${m.length} membership rows (role ${m[0]?.role ?? "none"})` });
  measured.principal_role = m[0]?.role ?? null;
  if (!resolved) return null;
  const org = m[0].org!;

  const members = await as(ctx.app, "ascend_owner", { org, user: userId }, async () => n((await ctx.app.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.disabled_at IS NULL")).rows[0].n));
  const membersTruth = n((await ctx.admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.disabled_at IS NULL", [org])).rows[0].n);
  checks.push({ id: "APP.members", ok: members === membersTruth && members > 0, detail: `${members} visible of ${membersTruth} restored` });
  measured.members = { visible: members, restored: membersTruth };
  return { userId, org };
}

/** Events, invitations, isolation and grants — identical for 001–008 and 001–009. */
async function shared(ctx: ProfileContext, c: Common, checks: ProfileCheck[], measured: Record<string, unknown>,
  grants: readonly GrantLine[] = GRANTS_001_009): Promise<void> {
  const { org, userId } = c;
  const owner = <T,>(fn: () => Promise<T>) => as(ctx.app, "ascend_owner", { org, user: userId }, fn);
  const ids = async (s: ProfileSession, sql: string, p: unknown[]) => (await s.query<{ id: string }>(sql, p)).rows.map((r) => r.id);

  const setSql = `SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY event_id::text COLLATE "C"`;
  const orderSql = "SELECT event_id::text AS id FROM events WHERE organization_id = $1 ORDER BY occurred_at ASC, seq ASC";
  const [appSet, appOrder] = await owner(async () => [await ids(ctx.app, setSql, [org]), await ids(ctx.app, orderSql, [org])]);
  const [trueSet, trueOrder] = [await ids(ctx.admin, setSql, [org]), await ids(ctx.admin, orderSql, [org])];
  const bySeq = (await ctx.admin.query<{ s: string; id: string }>("SELECT seq::text AS s, event_id::text AS id FROM events ORDER BY seq")).rows;
  const f6 = ctx.sourceEventOrderDigest === undefined ? null : sha(bySeq.map((x) => `${x.s}|${x.id}`).join(",")) === ctx.sourceEventOrderDigest;
  const ev = { visible: appSet.length, restored: trueSet.length, sameSet: sha(appSet.join(",")) === sha(trueSet.join(",")),
    contractedOrder: sha(appOrder.join(",")) === sha(trueOrder.join(",")), f6 };
  checks.push({ id: "APP.events", ok: ev.visible === ev.restored && ev.restored > 0 && ev.sameSet && ev.contractedOrder && f6 !== false,
    detail: `${ev.visible}/${ev.restored} events, same set ${ev.sameSet}, contracted order ${ev.contractedOrder}, F6 ${f6 ?? "not given"}` });
  measured.events = ev;

  const inv = await owner(async () => n((await ctx.app.query<{ n: number }>("SELECT count(*)::int AS n FROM invitations")).rows[0].n));
  const invTruth = n((await ctx.admin.query<{ n: number }>("SELECT count(*)::int AS n FROM invitations WHERE organization_id = $1", [org])).rows[0].n);
  checks.push({ id: "APP.invitations", ok: inv === invTruth, detail: `${inv} visible of ${invTruth} restored` });
  measured.invitations = { visible: inv, restored: invTruth };

  // Another tenant — an organization id that exists nowhere — sees nothing of this one.
  const stranger = randomUUID();
  const leaked = await as(ctx.app, "ascend_owner", { org: stranger, user: userId }, async () => (await ctx.app.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM prospects)::int AS prospects, (SELECT count(*) FROM events)::int AS events,
            (SELECT count(*) FROM prospect_notes)::int AS notes, (SELECT count(*) FROM invitations)::int AS invitations`)).rows[0]);
  const leakedTotal = Object.values(leaked).reduce((a, b) => a + n(b), 0);
  checks.push({ id: "APP.tenant-isolation", ok: leakedTotal === 0, detail: `another organization sees ${leakedTotal} rows` });

  await grantChecks(ctx, checks, grants);
}

/** A role boundary, read from the catalog: the SQL expression, what it means, and the expected answer. */
type GrantLine = [string, string, boolean];

/** Schema 001–009: the boundaries pre-009-v1 and post-009-v1 were accepted with. Never edited. */
const GRANTS_001_009: readonly GrantLine[] = [
  ["has_column_privilege('ascend_owner', 'users', 'password_hash', 'SELECT')", "owner cannot read credentials", false],
  ["has_column_privilege('ascend_sales', 'users', 'password_hash', 'SELECT')", "sales cannot read credentials", false],
  ["has_column_privilege('ascend_auth', 'users', 'password_hash', 'SELECT')", "auth reads credentials", true],
  ["has_table_privilege('ascend_sales', 'prospects', 'DELETE')", "sales cannot delete prospects", false],
  ["has_column_privilege('ascend_automation', 'prospects', 'website_opportunity', 'UPDATE')", "automation cannot judge a website", false],
  ["has_column_privilege('ascend_sales', 'prospects', 'status', 'UPDATE')", "sales records stage", true],
  ["has_table_privilege('ascend_owner', 'prospect_notes', 'INSERT')", "owner writes notes", true],
];

async function grantChecks(ctx: ProfileContext, checks: ProfileCheck[], grants: readonly GrantLine[]): Promise<void> {
  for (const [expr, what, want] of grants) {
    const got = (await ctx.admin.query<{ v: boolean }>(`SELECT ${expr} AS v`)).rows[0].v === true;
    checks.push({ id: `APP.grant: ${what}`, ok: got === want, detail: `${expr} = ${got}` });
  }
}

/** Schema 001–009 and later: archival exists; total, active and archived are three numbers. */
async function withArchival(ctx: ProfileContext, checks: ProfileCheck[], measured: Record<string, unknown>,
  grants: readonly GrantLine[]): Promise<Common | null> {
    const archival = await hasColumn(ctx.admin, "prospects", "archived_at");
    checks.push({ id: "APP.schema-is-the-profile's", ok: archival, detail: archival ? "prospects.archived_at present, as 001–009" : "no archival columns — not a 001–009 schema" });
    if (!archival) return null;
    const c = await identity(ctx, checks, measured);
    if (!c) return null;
    const owner = <T,>(fn: () => Promise<T>) => as(ctx.app, "ascend_owner", { org: c.org, user: c.userId }, fn);
    const identitySql = `SELECT coalesce(string_agg(id::text || '|' || coalesce(prospect_id::text, '') || '|' || identity_state || '|' || (archived_at IS NOT NULL)::text, ',' ORDER BY id::text COLLATE "C"), '') AS d FROM prospects`;
    const q = `SELECT (SELECT count(*) FROM prospects)::int AS total,
                      (SELECT count(*) FROM prospects WHERE archived_at IS NULL)::int AS active,
                      (SELECT count(*) FROM prospects WHERE archived_at IS NOT NULL)::int AS archived,
                      (SELECT count(*) FROM prospect_notes)::int AS notes,
                      (SELECT count(*) FROM prospect_notes n JOIN prospects p ON p.id = n.prospect WHERE p.archived_at IS NOT NULL)::int AS on_archived,
                      (SELECT count(*) FROM prospects WHERE notes IS NOT NULL AND notes <> '')::int AS legacy`;
    const [app, appIdent] = await owner(async () => [(await ctx.app.query<Record<string, number>>(q)).rows[0], (await ctx.app.query<{ d: string }>(identitySql)).rows[0].d]);
    const t = (await ctx.admin.query<Record<string, number>>(
      `SELECT (SELECT count(*) FROM prospects WHERE organization_id = $1)::int AS total,
              (SELECT count(*) FROM prospects WHERE organization_id = $1 AND archived_at IS NULL)::int AS active,
              (SELECT count(*) FROM prospects WHERE organization_id = $1 AND archived_at IS NOT NULL)::int AS archived,
              (SELECT count(*) FROM prospect_notes n JOIN prospects p ON p.id = n.prospect WHERE p.organization_id = $1)::int AS notes,
              (SELECT count(*) FROM prospect_notes n JOIN prospects p ON p.id = n.prospect WHERE p.organization_id = $1 AND p.archived_at IS NOT NULL)::int AS on_archived,
              (SELECT count(*) FROM prospects WHERE organization_id = $1 AND notes IS NOT NULL AND notes <> '')::int AS legacy`, [c.org])).rows[0];
    const trueIdent = (await ctx.admin.query<{ d: string }>(identitySql.replace("FROM prospects", "FROM prospects WHERE organization_id = $1"), [c.org])).rows[0].d;
    const counts = ["total", "active", "archived"].every((k) => n(app[k]) === n(t[k]));
    checks.push({ id: "APP.prospects", ok: counts && n(t.active) + n(t.archived) === n(t.total) && n(t.total) > 0,
      detail: `total ${app.total}/${t.total}, active ${app.active}/${t.active}, archived ${app.archived}/${t.archived}` });
    checks.push({ id: "APP.prospect-identity", ok: sha(appIdent) === sha(trueIdent), detail: "id, anchor, identity state and archival of every prospect, as the owner sees them" });
    checks.push({ id: "APP.notes", ok: n(app.notes) === n(t.notes) && n(app.on_archived) === n(t.on_archived) && n(app.legacy) === n(t.legacy),
      detail: `log ${app.notes}/${t.notes} (on archived ${app.on_archived}/${t.on_archived}), legacy bodies ${app.legacy}/${t.legacy}` });
    measured.prospects = { total: [n(app.total), n(t.total)], active: [n(app.active), n(t.active)], archived: [n(app.archived), n(t.archived)] };
    measured.notes = { log: [n(app.notes), n(t.notes)], onArchived: [n(app.on_archived), n(t.on_archived)], legacy: [n(app.legacy), n(t.legacy)] };
    const grant = (await ctx.admin.query<{ v: boolean }>("SELECT has_column_privilege('ascend_sales', 'prospects', 'archived_at', 'UPDATE') AS v")).rows[0].v === true;
    checks.push({ id: "APP.grant: sales may archive (009)", ok: grant, detail: `has_column_privilege(ascend_sales, prospects.archived_at, UPDATE) = ${grant}` });
    await shared(ctx, c, checks, measured, grants);
    return c;
}

/** Schema 001–010: the boundary migration 010 drew. Never edited once an artifact depends on it. */
const GRANTS_010: readonly GrantLine[] = [
  ...GRANTS_001_009.filter(([, what]) => what !== "sales records stage"),
  ["has_column_privilege('ascend_sales', 'prospects', 'status', 'UPDATE')", "sales cannot write stage directly", false],
  ["has_column_privilege('ascend_owner', 'prospects', 'status', 'UPDATE')", "owner cannot write stage directly", false],
  ["has_column_privilege('ascend_sales', 'prospects', 'assigned_to', 'UPDATE')", "sales cannot write assignment directly", false],
  ["has_column_privilege('ascend_owner', 'prospects', 'assigned_to', 'UPDATE')", "owner cannot write assignment directly", false],
  ["has_column_privilege('ascend_sales', 'prospects', 'last_contact', 'UPDATE')", "sales cannot write contact dates directly", false],
  ["has_column_privilege('ascend_owner', 'prospects', 'first_contact', 'UPDATE')", "owner cannot write contact dates directly", false],
  ["has_function_privilege('ascend_sales', 'public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean)', 'EXECUTE')", "sales changes stage through the guarded function", true],
  ["has_function_privilege('ascend_automation', 'public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean)', 'EXECUTE')", "automation cannot change stage", false],
  ["has_table_privilege('ascend_sales', 'prospect_contacts', 'UPDATE') OR has_table_privilege('ascend_owner', 'prospect_contacts', 'DELETE')", "contacts are immutable", false],
  ["has_table_privilege('ascend_owner', 'prospect_stage_transitions', 'UPDATE') OR has_table_privilege('ascend_owner', 'prospect_stage_transitions', 'DELETE')", "stage history is immutable", false],
  ["EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prospects_status_has_transition' AND NOT tgisinternal)", "every stage change names its transition", true],
  ["EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'prospect_followups_one_open')", "one open follow-up per prospect", true],
];

/** The four 010 tables, as the owner sees them, and the invariants between them. */
async function salesHistory(ctx: ProfileContext, c: Common, checks: ProfileCheck[], measured: Record<string, unknown>): Promise<void> {
  const q = `SELECT (SELECT count(*) FROM prospect_contacts)::int AS contacts,
                    (SELECT count(*) FROM prospect_stage_transitions)::int AS transitions,
                    (SELECT count(*) FROM prospect_followups)::int AS followups,
                    (SELECT count(*) FROM prospect_followups WHERE state = 'open')::int AS open,
                    (SELECT count(*) FROM prospect_command_receipts)::int AS receipts`;
  const app = await as(ctx.app, "ascend_owner", { org: c.org, user: c.userId }, async () => (await ctx.app.query<Record<string, number>>(q)).rows[0]);
  const t = (await ctx.admin.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM prospect_contacts WHERE organization_id = $1)::int AS contacts,
            (SELECT count(*) FROM prospect_stage_transitions WHERE organization_id = $1)::int AS transitions,
            (SELECT count(*) FROM prospect_followups WHERE organization_id = $1)::int AS followups,
            (SELECT count(*) FROM prospect_followups WHERE organization_id = $1 AND state = 'open')::int AS open,
            (SELECT count(*) FROM prospect_command_receipts WHERE organization_id = $1)::int AS receipts`, [c.org])).rows[0];
  const keys = ["contacts", "transitions", "followups", "open", "receipts"];
  checks.push({ id: "APP.sales-history", ok: keys.every((k) => n(app[k]) === n(t[k])),
    detail: keys.map((k) => `${k} ${app[k]}/${t[k]}`).join(", ") });
  measured.salesHistory = Object.fromEntries(keys.map((k) => [k, [n(app[k]), n(t[k])]]));
  // The invariants the schema promises, re-measured on the restore.
  const inv = (await ctx.admin.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM (SELECT prospect FROM prospect_followups WHERE state = 'open' GROUP BY prospect HAVING count(*) > 1) x)::int AS double_open,
            (SELECT count(*) FROM prospect_stage_transitions WHERE (to_status = 'closed-won') <> (cause = 'promotion'))::int AS won_without_promotion,
            (SELECT count(*) FROM prospects p WHERE p.status IS NOT NULL AND EXISTS (SELECT 1 FROM prospect_stage_transitions t WHERE t.prospect = p.id)
               AND p.status <> (SELECT t.to_status FROM prospect_stage_transitions t WHERE t.prospect = p.id ORDER BY t.recorded_at DESC, t.transition_id DESC LIMIT 1))::int AS stage_disagrees_with_history,
            (SELECT count(*) FROM prospect_contacts c2 JOIN prospects p ON p.id = c2.prospect
              WHERE p.last_contact < (c2.happened_at AT TIME ZONE 'America/Los_Angeles')::date
                 OR p.first_contact > (c2.happened_at AT TIME ZONE 'America/Los_Angeles')::date)::int AS projection_behind_contacts`)).rows[0];
  const bad = Object.entries(inv).filter(([, v]) => n(v) !== 0);
  checks.push({ id: "APP.sales-history-invariants", ok: bad.length === 0,
    detail: bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(", ") : "one open follow-up per prospect; closed-won only by promotion; stage = latest transition; contact dates cover every contact" });
}

type ProfileImpl = (ctx: ProfileContext, checks: ProfileCheck[], measured: Record<string, unknown>) => Promise<void>;

const hasColumn = async (s: ProfileSession, table: string, column: string) => (await s.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = $1 AND a.attname = $2 AND NOT a.attisdropped`, [table, column])).rows[0].n === 1;

const IMPLEMENTATIONS: Readonly<Record<string, ProfileImpl>> = Object.freeze({
  // Schema 001–008: no archival. Every prospect is simply a prospect; nothing is invented about
  // "active" or "archived", which this schema cannot express.
  "pre-009-v1": async (ctx, checks, measured) => {
    const archival = await hasColumn(ctx.admin, "prospects", "archived_at");
    checks.push({ id: "APP.schema-is-the-profile's", ok: !archival, detail: archival ? "prospects.archived_at EXISTS — not a 001–008 schema" : "no archival columns, as 001–008" });
    const c = await identity(ctx, checks, measured);
    if (!c) return;
    const owner = <T,>(fn: () => Promise<T>) => as(ctx.app, "ascend_owner", { org: c.org, user: c.userId }, fn);
    const identitySql = `SELECT coalesce(string_agg(id::text || '|' || coalesce(prospect_id::text, '') || '|' || identity_state, ',' ORDER BY id::text COLLATE "C"), '') AS d FROM prospects`;
    const q = `SELECT (SELECT count(*) FROM prospects)::int AS total,
                      (SELECT count(*) FROM prospect_notes)::int AS notes,
                      (SELECT count(*) FROM prospects WHERE notes IS NOT NULL AND notes <> '')::int AS legacy`;
    const [app, appIdent] = await owner(async () => [(await ctx.app.query<Record<string, number>>(q)).rows[0], (await ctx.app.query<{ d: string }>(identitySql)).rows[0].d]);
    const t = (await ctx.admin.query<Record<string, number>>(
      `SELECT (SELECT count(*) FROM prospects WHERE organization_id = $1)::int AS total,
              (SELECT count(*) FROM prospect_notes n JOIN prospects p ON p.id = n.prospect WHERE p.organization_id = $1)::int AS notes,
              (SELECT count(*) FROM prospects WHERE organization_id = $1 AND notes IS NOT NULL AND notes <> '')::int AS legacy`, [c.org])).rows[0];
    const trueIdent = (await ctx.admin.query<{ d: string }>(identitySql.replace("FROM prospects", "FROM prospects WHERE organization_id = $1"), [c.org])).rows[0].d;
    checks.push({ id: "APP.prospects", ok: n(app.total) === n(t.total) && n(t.total) > 0, detail: `${app.total} visible of ${t.total} restored` });
    checks.push({ id: "APP.prospect-identity", ok: sha(appIdent) === sha(trueIdent), detail: "id, anchor and identity state of every prospect, as the owner sees them" });
    checks.push({ id: "APP.notes", ok: n(app.notes) === n(t.notes) && n(app.legacy) === n(t.legacy), detail: `log ${app.notes}/${t.notes}, legacy bodies ${app.legacy}/${t.legacy}` });
    measured.prospects = { visible: n(app.total), restored: n(t.total) };
    measured.notes = { log: { visible: n(app.notes), restored: n(t.notes) }, legacy: { visible: n(app.legacy), restored: n(t.legacy) } };
    await shared(ctx, c, checks, measured);
  },

  // Schema 001–009: archival. Total, active and archived are three numbers, each checked; notes on
  // archived prospects are their own line (RT-1, 2A.0).
  "post-009-v1": async (ctx, checks, measured) => {
    await withArchival(ctx, checks, measured, GRANTS_001_009);
  },

  // Schema 001–010: sales actions. Everything post-009-v1 verifies, with the post-010 grant boundary
  // (no application role writes stage, assignment or contact dates directly), plus the four
  // history tables read back as the owner and the history invariants the schema promises.
  "post-010-v1": async (ctx, checks, measured) => {
    const c = await withArchival(ctx, checks, measured, GRANTS_010);
    if (!c) return;
    await salesHistory(ctx, c, checks, measured);
  },
});

/** Every registered profile id has exactly one implementation, and vice versa. */
export const IMPLEMENTED_PROFILES = Object.freeze(Object.keys(IMPLEMENTATIONS).sort());

/**
 * Run the application verification profile a contract names. Refuses — never substitutes — when the
 * profile is missing, unknown, unimplemented, or written for a different ledger.
 */
export async function runApplicationProfile(
  contract: { applicationProfile: string; ledger: readonly string[] }, ctx: ProfileContext,
): Promise<ProfileResult> {
  const id = contract.applicationProfile;
  if (typeof id !== "string" || id === "") throw new ProfileRefused("the recovery contract names no application verification profile");
  if (!profileSpec(id)) throw new ProfileRefused(`unknown application verification profile ${id}`);
  if (!profileFitsLedger(id, contract.ledger)) throw new ProfileRefused(`application profile ${id} is not written for this artifact's ledger`);
  const impl = IMPLEMENTATIONS[id];
  if (!impl) throw new ProfileRefused(`application profile ${id} is registered but has no implementation`);
  const checks: ProfileCheck[] = [];
  const measured: Record<string, unknown> = {};
  await impl(ctx, checks, measured);
  if (checks.length === 0) throw new ProfileRefused(`application profile ${id} produced no checks`);
  return { profile: id, checks, measured };
}
