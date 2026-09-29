#!/usr/bin/env node --experimental-strip-types
// 2A.3a · POST-MIGRATION VERIFICATION — READ-ONLY, and FROZEN BEFORE 010 IS APPLIED.
//
//   node --experimental-strip-types scripts/verify-migration-010.mjs --since <pre.json>
//
// Modelled on the reviewed scripts/verify-migration-009.mjs. The expectations below were derived
// from 010's text and MEASURED on a PostgreSQL 17.6 catalog built from 001–009 and then 010. That
// 001–009 catalog equals production's post-009 verification exactly (8 tables, 78 columns,
// 27 indexes, 45 constraints, 22 policies, 30 column grants on prospects), which is why its deltas
// are trusted here. Business data is compared with the pre-migration record written by
// `apply-migration-010.mjs --check --record` in the same window: 010 must change none of it.
//
// The session is opened with `default_transaction_read_only=on` inside `BEGIN READ ONLY`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_SHA256, CREATES, DATA_KEYS, snapshot } from "./apply-migration-010.mjs";

/** Catalog deltas 010 causes, measured 001–009 → 001–010 on 17.6. */
export const DELTA = {
  cat_tables: 4, cat_columns: 47, cat_prospects_columns: 0, cat_indexes: 12, cat_constraints: 52,
  cat_policies: 9, cat_prospects_policies: 0, cat_functions: 6, cat_triggers: 1, cat_prospects_column_grants: 23,
};
export const EXPECT = {
  ledger_rows: 10,
  indexes: ["prospect_command_receipts_by_prospect", "prospect_command_receipts_pkey", "prospect_contacts_by_author",
    "prospect_contacts_pkey", "prospect_contacts_recent", "prospect_contacts_timeline", "prospect_followups_by_prospect",
    "prospect_followups_one_open", "prospect_followups_pkey", "prospect_followups_queue", "prospect_stage_transitions_pkey",
    "prospect_stage_transitions_timeline"],
  policies: [
    "prospect_command_receipts:prospect_command_receipts_insert:INSERT:ascend_owner,ascend_sales",
    "prospect_command_receipts:prospect_command_receipts_read:SELECT:ascend_owner,ascend_sales",
    "prospect_contacts:prospect_contacts_read:SELECT:ascend_owner,ascend_sales",
    "prospect_followups:prospect_followups_insert_owner:INSERT:ascend_owner",
    "prospect_followups:prospect_followups_insert_sales:INSERT:ascend_sales",
    "prospect_followups:prospect_followups_read:SELECT:ascend_owner,ascend_sales",
    "prospect_followups:prospect_followups_update_owner:UPDATE:ascend_owner",
    "prospect_followups:prospect_followups_update_sales:UPDATE:ascend_sales",
    "prospect_stage_transitions:prospect_stage_transitions_read:SELECT:ascend_owner,ascend_sales",
  ],
  /** name → SECURITY DEFINER? (all six pin search_path to empty) */
  functions: { ascend_assign_prospect: true, ascend_guard_actor: true, ascend_guard_prospect: true,
    ascend_record_contact: true, ascend_status_has_transition: false, ascend_transition_stage: true },
  /** Application roles holding EXECUTE, per function. Guards and the trigger function: none. */
  execute: { ascend_assign_prospect: "ascend_owner,ascend_sales", ascend_record_contact: "ascend_owner,ascend_sales",
    ascend_transition_stage: "ascend_owner,ascend_sales", ascend_guard_actor: "", ascend_guard_prospect: "",
    ascend_status_has_transition: "" },
  table_grants: {
    prospect_command_receipts: "ascend_owner=INSERT,ascend_owner=SELECT,ascend_sales=INSERT,ascend_sales=SELECT",
    prospect_contacts: "ascend_owner=SELECT,ascend_sales=SELECT",
    prospect_followups: "ascend_owner=INSERT,ascend_owner=SELECT,ascend_sales=INSERT,ascend_sales=SELECT",
    prospect_stage_transitions: "ascend_owner=SELECT,ascend_sales=SELECT",
  },
  followup_update_columns: {
    ascend_owner: "action,assignee_user_id,due_at,due_on,note,resolved_at,resolved_by,resolved_by_command,resolved_by_contact,state,superseded_by",
    ascend_sales: "resolved_at,resolved_by,resolved_by_command,resolved_by_contact,state,superseded_by",
  },
  sales_prospect_update_columns: "archived_at,archived_by,assessed_at,assessed_by,business_type,contact_email,contact_name," +
    "contact_phone,decision_maker_access,location,name,niche_alignment,notes,project_urgency,updated_at,website_opportunity",
  owner_prospect_update_columns: 27,
  guarded: ["assigned_to", "first_contact", "last_contact", "status"],
};

/** Run the whole matrix. `check(id, label, actual, expected)` records each result. */
export async function matrix(q, pre, check) {
  const post = await snapshot(q);

  // A · ledger
  const led = await q(`SELECT version, checksum, applied_at_is_backfilled FROM schema_migrations ORDER BY version`);
  check("V1", "ledger row count", led.length, EXPECT.ledger_rows);
  check("V2", "ledger head", led.at(-1)?.version, "010_sales_actions.sql");
  const r10 = led.find((r) => r.version === "010_sales_actions.sql");
  check("V3", "010 recorded checksum matches frozen value", r10?.checksum, FROZEN_SHA256);
  check("V4", "010 applied_at_is_backfilled", String(r10?.applied_at_is_backfilled), "false");
  check("V5", "001–009 ledger rows unchanged since the check", post.ledger.slice(0, 9).join(","), pre.ledger.join(","));

  // B · tables, RLS, indexes, trigger
  const tables = await q(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname = ANY($1) ORDER BY relname`, [CREATES.tables]);
  check("V6", "the four Sales tables exist", tables.map((t) => t.relname).join(","), CREATES.tables.join(","));
  check("V7", "RLS enabled AND forced on all four",
    tables.every((t) => t.relrowsecurity && t.relforcerowsecurity) && tables.length === 4 ? "yes" : "no", "yes");
  const idx = await q(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY indexname`, [CREATES.tables]);
  check("V8", "exactly the reviewed indexes on the new tables", idx.map((i) => i.indexname).join(","), EXPECT.indexes.join(","));
  const [trg] = await q(`SELECT c.relname, t.tgtype, p.proname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgname = $1 AND NOT t.tgisinternal`, [CREATES.trigger]);
  check("V9", "status trigger on prospects, calling the transition guard",
    trg ? `${trg.relname}:${trg.proname}` : "none", "prospects:ascend_status_has_transition");
  // tgtype bits: 1 ROW, 2 BEFORE, 16 UPDATE → 19
  check("V10", "  and is BEFORE UPDATE FOR EACH ROW", trg ? (trg.tgtype & 19) : "none", 19);

  // C · row-level security policies
  const pol = await q(`SELECT tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') AS p
     FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1`, [CREATES.tables]);
  check("V11", "exactly the reviewed nine policies", pol.map((p) => p.p).join(" | "), EXPECT.policies.join(" | "));

  // D · functions: definer, empty search_path, EXECUTE boundary
  const fns = await q(`SELECT proname, prosecdef, coalesce(array_to_string(proconfig, ';'), '') AS config
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY proname`, [CREATES.functions]);
  check("V12", "the six functions exist", fns.map((f) => f.proname).join(","), CREATES.functions.join(","));
  check("V13", "SECURITY DEFINER exactly where reviewed",
    fns.map((f) => `${f.proname}=${f.prosecdef}`).join(","),
    CREATES.functions.map((n) => `${n}=${EXPECT.functions[n]}`).join(","));
  check("V14", "every function pins search_path to empty",
    fns.every((f) => f.config === 'search_path=""') ? "yes" : fns.map((f) => `${f.proname}:${f.config}`).join(";"), "yes");
  const exe = await q(`SELECT p.proname, coalesce(string_agg(r.rolname, ',' ORDER BY r.rolname)
       FILTER (WHERE r.rolname LIKE 'ascend\\_%'), '') AS roles,
       bool_or(x.grantee = 0) AS public_execute
     FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) AND x.privilege_type = 'EXECUTE'
     GROUP BY p.proname ORDER BY p.proname`, [CREATES.functions]);
  check("V15", "no function is executable by PUBLIC", exe.some((e) => e.public_execute) ? "PUBLIC" : "none", "none");
  check("V16", "EXECUTE granted exactly to the reviewed roles",
    exe.map((e) => `${e.proname}=${e.roles}`).join(" "),
    CREATES.functions.map((n) => `${n}=${EXPECT.execute[n]}`).join(" "));

  // E · grants (least privilege)
  const tg = await q(`SELECT c.relname, string_agg(r.rolname || '=' || x.privilege_type, ',' ORDER BY r.rolname, x.privilege_type) AS g
     FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relname = ANY($1) AND c.relnamespace = 'public'::regnamespace AND r.rolname LIKE 'ascend\\_%'
     GROUP BY c.relname ORDER BY c.relname`, [CREATES.tables]);
  check("V17", "table grants on the new tables are exactly the reviewed set",
    tg.map((t) => `${t.relname}:${t.g}`).join(" "),
    CREATES.tables.map((n) => `${n}:${EXPECT.table_grants[n]}`).join(" "));
  const fu = await q(`SELECT r.rolname, string_agg(a.attname, ',' ORDER BY a.attname) AS cols
     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) x
     JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relname = 'prospect_followups' AND x.privilege_type = 'UPDATE' AND r.rolname LIKE 'ascend\\_%'
     GROUP BY r.rolname ORDER BY r.rolname`);
  check("V18", "follow-up column UPDATE grants per role",
    fu.map((f) => `${f.rolname}:${f.cols}`).join(" "),
    Object.entries(EXPECT.followup_update_columns).map(([k, v]) => `${k}:${v}`).join(" "));
  const colGrants = async (role) => (await q(`SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace AND r.rolname = $1
       AND x.privilege_type = 'UPDATE' ORDER BY a.attname`, [role])).map((r) => r.attname);
  const salesCols = await colGrants("ascend_sales");
  check("V19", "sales UPDATE on prospects: exactly the reviewed 16 columns", salesCols.join(","), EXPECT.sales_prospect_update_columns);
  check("V20", "sales holds UPDATE on NONE of status/assigned_to/first_contact/last_contact",
    EXPECT.guarded.filter((c) => salesCols.includes(c)).join(",") || "none", "none");
  const ownerCols = await colGrants("ascend_owner");
  check("V21", "owner column UPDATE count on prospects", ownerCols.length, EXPECT.owner_prospect_update_columns);
  check("V22", "owner holds column UPDATE on NONE of the guarded four",
    EXPECT.guarded.filter((c) => ownerCols.includes(c)).join(",") || "none", "none");
  const [otu] = await q(`SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     JOIN pg_roles r ON r.oid = x.grantee WHERE c.relname = 'prospects' AND c.relnamespace = 'public'::regnamespace
       AND r.rolname = 'ascend_owner' AND x.privilege_type = 'UPDATE'`);
  check("V23", "owner holds NO table-level UPDATE on prospects", otu.n, 0);
  const [other] = await q(`SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     JOIN pg_roles r ON r.oid = x.grantee WHERE c.relname = ANY($1) AND c.relnamespace = 'public'::regnamespace
       AND r.rolname IN ('ascend_automation', 'ascend_auth', 'ascend_invite')`, [CREATES.tables]);
  check("V24", "automation/auth/invite hold nothing on the new tables", other.n, 0);

  // F · catalog shape: exactly the measured deltas
  let v = 25;
  for (const [k, d] of Object.entries(DELTA)) check(`V${v++}`, `${k} delta`, post[k] - pre[k], d);

  // G · BUSINESS DATA MUST BE UNTOUCHED; the new tables start empty
  for (const k of DATA_KEYS) check(`V${v++}`, `${k} unchanged since the check`, post[k], pre[k]);
  const [empty] = await q(`SELECT (SELECT count(*) FROM prospect_command_receipts)::int + (SELECT count(*) FROM prospect_contacts)::int
     + (SELECT count(*) FROM prospect_followups)::int + (SELECT count(*) FROM prospect_stage_transitions)::int AS n`);
  check(`V${v++}`, "the four new tables are empty (010 backfills nothing)", empty.n, 0);
}

async function main() {
  const argv = process.argv.slice(2);
  const since = argv[argv.indexOf("--since") + 1];
  if (!argv.includes("--since") || !since) { console.error("usage: verify-migration-010.mjs --since <pre.json>"); process.exit(2); }
  const pre = JSON.parse(readFileSync(since, "utf8"));
  if (pre.migration !== "010_sales_actions.sql") { console.error("  ABORT: --since is not a 010 pre-migration record"); process.exit(2); }

  const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const pg = (await import(path.join(APP, "node_modules/pg/lib/index.js"))).default;
  const env = {};
  for (const line of readFileSync(path.join(APP, ".env.production.local"), "utf8").split("\n")) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const u = new URL(env.ASCEND_DATABASE_URL_DIRECT);
  const pem = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/
    .exec(readFileSync(path.join(APP, "core/db/tls.ts"), "utf8"))[1];
  const client = new pg.Client({
    host: u.hostname, port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { ca: pem, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    options: "-c default_transaction_read_only=on", statement_timeout: 60_000,
  });
  await client.connect();
  const q = async (s, p = []) => (await client.query(s, p)).rows;
  let pass = 0, fail = 0;
  const check = (id, label, actual, expected) => {
    const good = String(actual) === String(expected);
    good ? pass++ : fail++;
    console.log(`  ${good ? "[ok]  " : "[FAIL]"} ${id.padEnd(5)} ${label.padEnd(58)} ${good ? actual : `got ${actual}, expected ${expected}`}`);
  };
  try {
    await client.query("BEGIN READ ONLY");
    console.log("\n=== 2A.3a · 010 POST-MIGRATION VERIFICATION (read-only) ===\n");
    await matrix(q, pre, check);
    await client.query("COMMIT");
  } finally { await client.end(); }
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(fail === 0
    ? "\n  010 VERIFIED. Nothing was written by this check. Next: build the pinned SHA and bootstrap.\n"
    : "\n  VERIFICATION FAILED — STOP. Keep the service stopped; do not build or deploy. See the contract §6.\n");
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n  ABORT: ${e?.message ?? e}\n`); process.exit(1); });
}
