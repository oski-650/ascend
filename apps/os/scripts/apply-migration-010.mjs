#!/usr/bin/env node --experimental-strip-types
// 2A.3a · APPLY MIGRATION 010 TO PRODUCTION — the execution contract, as the thing that executes.
//
//   node --experimental-strip-types scripts/apply-migration-010.mjs --check --record <pre.json>
//   node --experimental-strip-types scripts/apply-migration-010.mjs --apply-to-production --service-stopped --since <pre.json>
//
// Modelled on the reviewed scripts/apply-migration-009.mjs (D1b.2). What changed, and why:
//
//   · 009 froze production's row counts into the file because they were measured before the file
//     was written. 2A.3a-1 is written WITHOUT production access, so the counts are captured by the
//     `--check` run itself (`--record`, counts and catalog shape only, mode 0600) and the apply run
//     refuses unless the database still matches that record (`--since`). The record is at most
//     `MAX_RECORD_AGE_MIN` old, so "measured" means "measured in this window".
//   · 010 narrows grants and adds a trigger (see docs/SLICE-2A3A-EXECUTION-CONTRACT.md §2), so the
//     GRANT pre-state it rewrites is asserted exactly, the way 009 asserted the policy it replaced.
//   · The apply refuses while an application session is ACTIVE on the database: 010 and the running
//     D1 build are not compatible (the D1 build's promotion writes `status` directly), so the service
//     must already be stopped.
//
// `--check` is READ-ONLY and is the default: the session is opened with
// `default_transaction_read_only=on`, so a mistake in this file cannot write. `--apply-to-production`
// must be passed explicitly and is the ONLY path that opens a writable session.
//
// This process imports ONLY `core/db/migrate.ts` (node builtins plus a type-only SqlClient). Nothing in
// it can archive, promote, contact, assign, or write a business row.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── the frozen identity of what we are applying ───────────────────────────────────────────────
export const MIGRATION = "010_sales_actions.sql";
/** Equal to L010 in core/recovery/profile-registry.ts (tests/architecture/rollout-010.test.ts). */
export const FROZEN_SHA256 = "5cb6802a5acd4d353bac785a962ed4779ca2dd59a2dd5bff64892c19afa9bbb5";
export const EXPECTED_PREDECESSOR = [
  "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql",
  "004_schema_migrations.sql", "005_user_credentials.sql", "006_invitations.sql",
  "007_invitation_membership.sql", "008_prospect_notes_log.sql", "009_prospect_archival.sql",
];
/** Every object 010 creates. All must be ABSENT before it runs. */
export const CREATES = {
  tables: ["prospect_command_receipts", "prospect_contacts", "prospect_followups", "prospect_stage_transitions"],
  functions: ["ascend_assign_prospect", "ascend_guard_actor", "ascend_guard_prospect",
              "ascend_record_contact", "ascend_status_has_transition", "ascend_transition_stage"],
  trigger: "prospects_status_has_transition",
};
/**
 * The grant state 010 REWRITES on `prospects` (§7 of 010). Measured on a 001–009 PostgreSQL 17.6
 * catalog whose shape equals production's post-009 verification (8 tables, 78 columns, 27 indexes,
 * 45 constraints, 22 policies, 30 column grants). If production differs, 010's REVOKE/GRANT would
 * produce a shape nobody reviewed, so the apply stops.
 */
export const PRE_GRANTS = {
  sales_update_columns: [
    "archived_at", "archived_by", "assessed_at", "assessed_by", "assigned_to", "business_type",
    "contact_email", "contact_name", "contact_phone", "decision_maker_access", "first_contact",
    "last_contact", "location", "name", "niche_alignment", "notes", "project_urgency", "status",
    "updated_at", "website_opportunity",
  ],
  owner_table_update: true,
  owner_update_columns: 0,
};
export const MAX_RECORD_AGE_MIN = 120;

const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

// ─── the read-only facts every run records and every apply re-compares ─────────────────────────
/** Counts and catalog shape only: no names, ids, emails or row contents. */
export async function snapshot(q) {
  const [s] = await q(`SELECT
    (SELECT count(*) FROM prospects)::int AS prospects,
    (SELECT count(*) FROM prospects WHERE identity_state = 'anchored')::int AS anchored,
    (SELECT count(*) FROM prospects WHERE identity_state = 'held')::int AS held,
    (SELECT count(*) FROM prospects WHERE status = 'closed-won')::int AS closed_won,
    (SELECT count(*) FROM prospects WHERE status = 'closed-lost')::int AS closed_lost,
    (SELECT count(*) FROM prospects WHERE status IS NULL)::int AS status_absent,
    (SELECT count(*) FROM prospects WHERE archived_at IS NOT NULL)::int AS archived,
    (SELECT count(*) FROM prospects WHERE assigned_to IS NOT NULL)::int AS assigned,
    (SELECT count(*) FROM prospects WHERE slug IS NOT NULL)::int AS slugged,
    (SELECT count(*) FROM prospect_notes)::int AS notes,
    (SELECT count(*) FROM users)::int AS users,
    (SELECT count(*) FROM organizations)::int AS orgs,
    (SELECT count(*) FROM memberships)::int AS memberships,
    (SELECT count(*) FROM invitations)::int AS invitations,
    (SELECT count(*) FROM events)::int AS events,
    (SELECT coalesce(max(seq), 0)::text FROM events) AS events_max_seq,
    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r')::int AS cat_tables,
    (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped)::int AS cat_columns,
    (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped)::int AS cat_prospects_columns,
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::int AS cat_indexes,
    (SELECT count(*) FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
       WHERE c.relnamespace = 'public'::regnamespace AND co.contype <> 'n')::int AS cat_constraints,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::int AS cat_policies,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prospects')::int AS cat_prospects_policies,
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)::int AS cat_functions,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal)::int AS cat_triggers,
    (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
       WHERE c.relname = 'prospects' AND r.rolname LIKE 'ascend\\_%')::int AS cat_prospects_column_grants`);
  const ledger = await q(`SELECT version, checksum FROM schema_migrations ORDER BY version`);
  return { ...s, ledger: ledger.map((r) => `${r.version}:${r.checksum}`) };
}

/** The data half of a snapshot: the facts 010 must not change. */
export const DATA_KEYS = ["prospects", "anchored", "held", "closed_won", "closed_lost", "status_absent", "archived",
  "assigned", "slugged", "notes", "users", "orgs", "memberships", "invitations", "events", "events_max_seq"];

/** Every precondition that needs the database. Throws a message naming the first one that fails. */
export async function preconditions(q, { migrations, verifyChecksums, ledgerStatus, tx }) {
  const out = [];
  const [{ v }] = await q("SELECT current_setting('server_version') AS v");
  if (!v.startsWith("17.")) throw Error(`production reports PostgreSQL ${v}; the recovery proofs are pinned to 17.x`);
  out.push(["server version", v]);

  const versions = (await ledgerStatus(tx)).map((r) => r.version);
  if (versions.length !== EXPECTED_PREDECESSOR.length || versions.some((x, i) => x !== EXPECTED_PREDECESSOR[i]))
    throw Error(`the ledger is not exactly 001–009 (found: ${versions.join(", ") || "empty"})`);
  out.push(["ledger is exactly 001–009", `head ${versions.at(-1)}`]);

  const drift = await verifyChecksums(tx, migrations);
  if (drift.length) throw Error(`recorded checksums disagree with core/db/schema for: ${drift.map((d) => d.version).join(", ")}`);
  out.push(["zero checksum drift across the applied ledger", `${versions.length} files`]);

  const [pre] = await q(`SELECT
    (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1))::int AS tables,
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($2))::int AS functions,
    (SELECT count(*) FROM pg_trigger WHERE tgname = $3)::int AS triggers`,
    [CREATES.tables, CREATES.functions, CREATES.trigger]);
  if (pre.tables || pre.functions || pre.triggers)
    throw Error(`objects 010 creates already exist (tables=${pre.tables} functions=${pre.functions} trigger=${pre.triggers}); ` +
      `something applied part of 010 outside the ledger`);
  out.push(["every table, function and trigger 010 creates is absent", "0 / 0 / 0"]);

  const sales = (await q(`SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace
       AND r.rolname = 'ascend_sales' AND x.privilege_type = 'UPDATE' ORDER BY a.attname`)).map((r) => r.attname);
  if (sales.join(",") !== PRE_GRANTS.sales_update_columns.join(","))
    throw Error(`sales column UPDATE grants on prospects are not the reviewed pre-010 set (found ${sales.length}: ${sales.join(",")})`);
  const [own] = await q(`SELECT
      (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
        WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace
          AND r.rolname = 'ascend_owner' AND x.privilege_type = 'UPDATE')::int AS table_update,
      (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
        WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace
          AND r.rolname = 'ascend_owner' AND x.privilege_type = 'UPDATE')::int AS column_update`);
  if ((own.table_update === 1) !== PRE_GRANTS.owner_table_update || own.column_update !== PRE_GRANTS.owner_update_columns)
    throw Error(`owner UPDATE grants on prospects are not the reviewed pre-010 shape (table=${own.table_update} columns=${own.column_update})`);
  out.push(["prospects grants match the reviewed pre-010 shape", `sales ${sales.length} columns; owner table UPDATE`]);
  return out;
}

/**
 * Sessions of the application login, split into those visibly doing work and those whose state this
 * role cannot see (pg_stat_activity hides another role's state without pg_read_all_stats). Idle
 * pooled server connections are neither: they hold no transaction.
 */
export async function applicationSessions(q) {
  const [r] = await q(`SELECT
      count(*) FILTER (WHERE state IN ('active', 'idle in transaction', 'idle in transaction (aborted)'))::int AS active,
      count(*) FILTER (WHERE state IS NULL)::int AS unknown
    FROM pg_stat_activity
   WHERE pid <> pg_backend_pid() AND datname = current_database() AND usename LIKE 'ascend\\_app%'`);
  return r;
}

/** Compare the live data half with a recorded snapshot. Returns the keys that moved. */
export function movedSince(recorded, live) {
  return DATA_KEYS.filter((k) => String(recorded[k]) !== String(live[k]));
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const APPLY = has("--apply-to-production");
  const ALLOW_COUNT_DRIFT = has("--allow-count-drift");
  const die = (m) => { console.error(`\n  ABORT: ${m}\n`); process.exit(1); };
  const ok = (label, detail = "") => console.log(`  [ok]   ${label.padEnd(56)}${detail}`);
  if (APPLY && !arg("--since")) die("--apply-to-production requires --since <pre.json> from a --check run in this window");
  if (!APPLY && !arg("--record")) die("--check requires --record <pre.json> (counts and catalog shape only, written mode 0600)");

  registerHooks({ resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(spec, ctx);
  } });
  const pg = (await import(path.join(APP, "node_modules/pg/lib/index.js"))).default;
  const { applyMigrations, loadMigrations, ledgerStatus, verifyChecksums } = await import(path.join(APP, "core/db/migrate.ts"));

  console.log(`\n=== 2A.3a · migration ${MIGRATION} · ${APPLY ? "APPLY TO PRODUCTION" : "CHECK ONLY (read-only)"} ===\n`);

  // 1 · the file is the file that was reviewed
  const sql = readFileSync(path.join(APP, "core/db/schema", MIGRATION), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  if (sha !== FROZEN_SHA256) die(`${MIGRATION} does not match the frozen checksum (on disk ${sha}). Re-review it; do not apply it.`);
  ok("010 matches the frozen checksum", sha.slice(0, 16) + "…");
  const all = loadMigrations();
  const only = all.filter((m) => m.name === MIGRATION);
  if (only.length !== 1 || only[0].checksum !== FROZEN_SHA256) die(`expected exactly one ${MIGRATION} with the frozen checksum in MIGRATIONS`);
  if (all.some((m) => m.name > MIGRATION)) die("the repository holds a migration after 010; this script applies 010 alone");
  ok("exactly one migration will be applied", MIGRATION);

  // 2 · DIRECT endpoint, pinned CA, verify-full; values parsed, never printed
  const env = {};
  for (const line of readFileSync(path.join(APP, ".env.production.local"), "utf8").split("\n")) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const raw = env.ASCEND_DATABASE_URL_DIRECT;
  if (!raw) die("ASCEND_DATABASE_URL_DIRECT is not present — DDL must not run through the transaction pooler");
  const u = new URL(raw);
  for (const p of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslnegotiation"])
    if (u.searchParams.has(p)) die(`the direct URL carries ${p}; core/db/pool.ts refuses these rather than merging them`);
  const pem = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/
    .exec(readFileSync(path.join(APP, "core/db/tls.ts"), "utf8"))?.[1];
  if (!pem) die("could not read the pinned CA from core/db/tls.ts");
  const client = new pg.Client({
    host: u.hostname, port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { ca: pem, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    // READ-ONLY unless applying. DDL cannot run in a read-only transaction.
    ...(APPLY ? {} : { options: "-c default_transaction_read_only=on" }),
    statement_timeout: 120_000,
  });
  await client.connect();
  ok("connected to the DIRECT endpoint over verified TLS", APPLY ? "read-write" : "read-only");
  const q = async (s, p = []) => (await client.query(s, p)).rows;
  const tx = {
    query: async (s, p) => { const r = await client.query(s, p ? [...p] : undefined); return { rows: r.rows ?? [], affected: r.rowCount ?? 0 }; },
    exec: async (s) => { await client.query(s); },
    async transaction(fn) {
      await client.query("BEGIN");
      try { const out = await fn(tx); await client.query("COMMIT"); return out; }
      catch (e) { await client.query("ROLLBACK"); throw e; }
    },
  };

  try {
    // 3 · every database precondition
    try { for (const [l, d] of await preconditions(q, { migrations: all, verifyChecksums, ledgerStatus, tx })) ok(l, d); }
    catch (e) { die(e.message); }

    const live = await snapshot(q);
    console.log(`         prospects / notes / users / events                      ${live.prospects} / ${live.notes} / ${live.users} / ${live.events}`);
    const sessions = await applicationSessions(q);

    if (!APPLY) {
      writeFileSync(arg("--record"), JSON.stringify({ recorded_at: new Date().toISOString(), migration: MIGRATION, ...live }, null, 2), { mode: 0o600 });
      ok("pre-migration snapshot recorded (counts and catalog only)", arg("--record"));
      console.log(`         application sessions: active ${sessions.active}, state not visible ${sessions.unknown} (both must be 0 at apply time)`);
      console.log("\n  CHECK ONLY. Every precondition passed and NOTHING was written.\n");
      return;
    }

    // 4 · the window: service stopped, database unchanged since the check
    if (!has("--service-stopped")) die("pass --service-stopped to attest that com.ascend.os has been booted out for this window");
    if (sessions.active !== 0) die(`${sessions.active} application session(s) are active. Stop the service (launchctl bootout) before applying 010`);
    if (sessions.unknown !== 0) die(`${sessions.unknown} application session(s) have a state this role cannot see; confirm the service is stopped and the pooler drained`);
    ok("no active application session; service stop attested", "0 active, 0 unknown");
    const recorded = JSON.parse(readFileSync(arg("--since"), "utf8"));
    if (recorded.migration !== MIGRATION) die("the --since record is not a 010 pre-migration record");
    if ((statSync(arg("--since")).mode & 0o077) !== 0) die("the --since record must be private (mode 0600)");
    const ageMin = (Date.now() - Date.parse(recorded.recorded_at)) / 60_000;
    if (!(ageMin >= 0 && ageMin <= MAX_RECORD_AGE_MIN)) die(`the --since record is ${Math.round(ageMin)} min old; re-run --check in this window`);
    const moved = movedSince(recorded, live);
    if (moved.length && !ALLOW_COUNT_DRIFT) die(`the database changed since the check: ${moved.join(", ")}. Re-run --check, or pass --allow-count-drift if understood`);
    if (recorded.ledger.join(",") !== live.ledger.join(",")) die("the ledger changed since the check");
    ok("database matches the pre-migration record", `${Math.round(ageMin)} min old`);

    // 5 · apply: one migration, one transaction, the real applyMigrations
    console.log("\n  Applying — one migration, one transaction, via the real applyMigrations…\n");
    const started = Date.now();
    const applied = await applyMigrations(tx, only);
    ok("APPLIED", `${applied.map((a) => `${a.name} (${a.ms} ms)`).join(", ")} · wall ${Date.now() - started} ms`);

    // 6 · the commit proved, from the ledger the migration itself wrote
    const after = await ledgerStatus(tx);
    const row = after.find((r) => r.version === MIGRATION);
    if (!row) die("010 applied but is ABSENT from the ledger — stop and investigate before anything else");
    if (row.checksum !== FROZEN_SHA256) die(`the ledger recorded checksum ${row.checksum}, expected ${FROZEN_SHA256}`);
    if (row.applied_at_is_backfilled) die("the ledger marked this backfilled — it was applied live and must say so");
    ok("ledger row written", `${after.length} rows, head ${after.at(-1).version}`);
    console.log("\n  010 COMMITTED. Keep the service stopped and run the post-migration verification next:");
    console.log(`  node --experimental-strip-types scripts/verify-migration-010.mjs --since ${arg("--since")}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n  ABORT: ${e?.message ?? e}\n`); process.exit(1); });
}
