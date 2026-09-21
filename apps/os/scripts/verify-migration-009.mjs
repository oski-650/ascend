#!/usr/bin/env node --experimental-strip-types
// D1b.2 · POST-MIGRATION VERIFICATION — READ-ONLY, and FROZEN BEFORE 009 IS APPLIED.
//
//   node --experimental-strip-types scripts/verify-migration-009.mjs
//
// Every expected value below was measured on production BEFORE the migration (the D1b.2 pre-flight
// read) and derived from 009's text. Writing it afterwards would let the observed state define
// "correct", which is not a check — it is a description. Frozen first, so it can fail.
//
// The connection is opened with `default_transaction_read_only=on` inside `BEGIN READ ONLY`.
// Nothing here can write.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const pg = (await import(path.join(APP, "node_modules/pg/lib/index.js"))).default;

const FROZEN_SHA256 = "f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d";

// ─── EXPECTED POST-009 STATE. Measured pre-migration; deltas derived from 009's text. ──────────
const EXPECT = {
  ledger_rows: 9,                 // was 8
  ledger_head: "009_prospect_archival.sql",
  prospects_cols: 31,             // was 29  (+archived_at, +archived_by)
  all_cols: 78,                   // was 76
  tables: 8,                      // unchanged — 009 creates no table
  indexes: 27,                    // was 26  (+prospects_org_active_idx)
  // CORRECTED 2026-09-20, post-migration, by owner authorization — a WITNESSED ARITHMETIC ERROR in
  // this matrix, NOT a production-schema correction and NOT a silent expectation change.
  //
  // Frozen originally as 44 (43 + archival_has_provenance). That undercounted: a FOREIGN KEY is also
  // a `pg_constraint` row, so 009 intentionally adds TWO:
  //
  //   1. archival_has_provenance     contype 'c'  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
  //   2. prospects_archived_by_fkey  contype 'f'  FOREIGN KEY (archived_by) REFERENCES users(id)
  //
  // 43 + 2 = 45. Migration 009 is UNCHANGED and its checksum remains frozen; only this expected
  // value moves. The FK's SHAPE was never in doubt and is proven independently: V11 asserts the
  // target is users.id and V12 asserts ON DELETE is 'a' (NO ACTION, not SET NULL) — both passed on
  // the very run that caught this. A read-only inventory of all 16 constraints on `prospects`
  // confirmed exactly these two are attributable to 009 and no unexpected constraint appeared.
  //
  // Recorded here rather than quietly edited, because "the check failed so the check was adjusted"
  // is the move that turns a verification matrix into a description of whatever happened.
  constraints: 45,                // was 43 (+archival_has_provenance, +prospects_archived_by_fkey)
  policies: 22,                   // unchanged — DROP + CREATE of the same name
  prospects_policies: 6,          // unchanged
  prospects_col_grants: 30,       // was 28  (+2 to ascend_sales)
  // Data: NOTHING 009 touches. Any change here means the migration altered business state.
  prospects_total: 3108, anchored: 3106, held: 2, closed_won: 1, closed_lost: 0,
  status_absent: 0, slugged: 6, with_body: 6, notes_total: 0, users_total: 1,
  orgs_total: 1, memberships_total: 1, invitations_total: 0, events_total: 22811,
  archived_total: 0,              // THE migration backfills nothing
};

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
  console.log(`  ${good ? "[ok]  " : "[FAIL]"} ${id.padEnd(6)} ${label.padEnd(50)} ${good ? actual : `got ${actual}, expected ${expected}`}`);
};

try {
  await client.query("BEGIN READ ONLY");
  console.log("\n=== D1b.2 · POST-MIGRATION VERIFICATION (read-only) ===\n--- A · ledger ---");

  const led = await q(`SELECT version, checksum, applied_at_is_backfilled FROM schema_migrations ORDER BY version`);
  check("V1", "ledger row count", led.length, EXPECT.ledger_rows);
  check("V2", "ledger head", led[led.length - 1]?.version, EXPECT.ledger_head);
  const r9 = led.find((r) => r.version === "009_prospect_archival.sql");
  check("V3", "009 recorded checksum matches frozen value", r9?.checksum, FROZEN_SHA256);
  check("V4", "009 applied_at_is_backfilled", String(r9?.applied_at_is_backfilled), "false");

  console.log("--- B · columns ---");
  const cols = await q(`SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' AND table_name='prospects'
       AND column_name IN ('archived_at','archived_by') ORDER BY column_name`);
  const at = cols.find((c) => c.column_name === "archived_at");
  const by = cols.find((c) => c.column_name === "archived_by");
  check("V5", "archived_at type", at?.data_type, "timestamp with time zone");
  check("V6", "archived_at nullable", at?.is_nullable, "YES");
  check("V7", "archived_at has NO default", at?.column_default ?? "none", "none");
  check("V8", "archived_by type", by?.data_type, "uuid");
  check("V9", "archived_by nullable", by?.is_nullable, "YES");
  check("V10", "archived_by has NO default", by?.column_default ?? "none", "none");

  console.log("--- C · foreign key and constraint ---");
  const [fk] = await q(`SELECT c.conname, c.confdeltype, cf.relname AS reftable, af.attname AS refcol
     FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
     JOIN pg_class cf ON cf.oid=c.confrelid
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
     JOIN pg_attribute af ON af.attrelid=c.confrelid AND af.attnum=c.confkey[1]
     WHERE t.relname='prospects' AND c.contype='f' AND a.attname='archived_by'`);
  check("V11", "archived_by FK target", fk ? `${fk.reftable}.${fk.refcol}` : "none", "users.id");
  // 'a' = NO ACTION. 'n' would be SET NULL, which would erase attribution on a surviving fact.
  check("V12", "archived_by ON DELETE behaviour", fk?.confdeltype, "a");
  const [chk] = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname='archival_has_provenance'`);
  check("V13", "archival_has_provenance exists", chk ? "yes" : "no", "yes");
  check("V14", "  and is the intended predicate",
    /archived_at IS NULL[\s\S]*=[\s\S]*archived_by IS NULL/.test(chk?.def ?? "") ? "yes" : "no", "yes");

  console.log("--- D · index ---");
  const [idx] = await q(`SELECT indexdef FROM pg_indexes
     WHERE schemaname='public' AND indexname='prospects_org_active_idx'`);
  check("V15", "prospects_org_active_idx exists", idx ? "yes" : "no", "yes");
  check("V16", "  is PARTIAL on archived_at IS NULL",
    /WHERE \(archived_at IS NULL\)/.test(idx?.indexdef ?? "") ? "yes" : "no", "yes");
  check("V17", "  is NOT unique", /UNIQUE/.test(idx?.indexdef ?? "") ? "unique" : "non-unique", "non-unique");

  console.log("--- E · row-level security ---");
  const [pol] = await q(`SELECT qual, with_check FROM pg_policies
     WHERE schemaname='public' AND tablename='prospects' AND policyname='prospects_update_sales'`);
  check("V18", "sales UPDATE policy exists", pol ? "yes" : "no", "yes");
  check("V19", "  USING carries archived_at IS NULL",
    /archived_at IS NULL/.test(pol?.qual ?? "") ? "yes" : "no", "yes");
  // THE TRAP. If this is "yes", sales can never archive anything.
  check("V20", "  WITH CHECK does NOT carry archived_at IS NULL",
    /archived_at IS NULL/.test(pol?.with_check ?? "") ? "yes" : "no", "no");
  check("V21", "  USING still anchored-only",
    /identity_state = 'anchored'/.test(pol?.qual ?? "") ? "yes" : "no", "yes");
  const [owner] = await q(`SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='prospects' AND policyname='prospects_write_owner'`);
  check("V22", "owner policy unchanged (no archival predicate)",
    /archived_at/.test(owner?.qual ?? "") ? "changed" : "unchanged", "unchanged");
  const [rls] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relname='prospects' AND relnamespace='public'::regnamespace`);
  check("V23", "RLS enabled AND forced on prospects",
    `${rls?.relrowsecurity}/${rls?.relforcerowsecurity}`, "true/true");

  console.log("--- F · grants (least privilege) ---");
  const sales = await q(`SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid=x.grantee
     WHERE c.relname='prospects' AND r.rolname='ascend_sales' AND x.privilege_type='UPDATE'
       AND a.attname IN ('archived_at','archived_by') ORDER BY a.attname`);
  check("V24", "sales holds UPDATE on exactly the 2 archival columns",
    sales.map((s) => s.attname).join(","), "archived_at,archived_by");
  const tbl = await q(`SELECT x.privilege_type FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid=x.grantee
     WHERE c.relname='prospects' AND r.rolname='ascend_sales' ORDER BY 1`);
  check("V25", "sales TABLE grants are still only SELECT,INSERT",
    tbl.map((t) => t.privilege_type).join(","), "INSERT,SELECT");
  check("V26", "sales has NO DELETE on prospects",
    tbl.some((t) => t.privilege_type === "DELETE") ? "HAS DELETE" : "none", "none");
  check("V27", "sales has NO table-level UPDATE",
    tbl.some((t) => t.privilege_type === "UPDATE") ? "HAS UPDATE" : "none", "none");
  const auto = await q(`SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid=x.grantee
     WHERE c.relname='prospects' AND r.rolname='ascend_automation'
       AND a.attname IN ('archived_at','archived_by')`);
  check("V28", "automation holds NOTHING on the archival columns", auto.length, 0);
  const [cg] = await q(`SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid=x.grantee
     WHERE c.relname='prospects' AND r.rolname LIKE 'ascend\\_%'`);
  check("V29", "total column grants on prospects", cg.n, EXPECT.prospects_col_grants);

  console.log("--- G · catalog shape ---");
  const [h] = await q(`SELECT
      (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        WHERE c.relname='prospects' AND a.attnum>0 AND NOT a.attisdropped)::int AS prospects_cols,
      (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped)::int AS all_cols,
      (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r')::int AS tables,
      (SELECT count(*) FROM pg_indexes WHERE schemaname='public')::int AS indexes,
      (SELECT count(*) FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
        WHERE c.relnamespace='public'::regnamespace AND co.contype<>'n')::int AS constraints,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public')::int AS policies,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='prospects')::int AS pp`);
  check("V30", "prospects column count", h.prospects_cols, EXPECT.prospects_cols);
  check("V31", "public column count", h.all_cols, EXPECT.all_cols);
  check("V32", "table count (009 creates none)", h.tables, EXPECT.tables);
  check("V33", "index count", h.indexes, EXPECT.indexes);
  check("V34", "constraint count", h.constraints, EXPECT.constraints);
  check("V35", "policy count (drop+create nets zero)", h.policies, EXPECT.policies);
  check("V36", "policies on prospects", h.pp, EXPECT.prospects_policies);

  console.log("--- H · BUSINESS DATA MUST BE UNTOUCHED ---");
  // `archived_at` is referenced here, so this section cannot run before 009. Rather than crashing
  // with a raw driver error, the pre-migration case is reported as the failure it is — a check that
  // dies halfway leaves the operator without the rest of the matrix.
  let g;
  try {
    [g] = await q(`SELECT
      (SELECT count(*) FROM prospects)::int AS prospects_total,
      (SELECT count(*) FROM prospects WHERE identity_state='anchored')::int AS anchored,
      (SELECT count(*) FROM prospects WHERE identity_state='held')::int AS held,
      (SELECT count(*) FROM prospects WHERE status='closed-won')::int AS closed_won,
      (SELECT count(*) FROM prospects WHERE status='closed-lost')::int AS closed_lost,
      (SELECT count(*) FROM prospects WHERE status IS NULL)::int AS status_absent,
      (SELECT count(*) FROM prospects WHERE slug IS NOT NULL)::int AS slugged,
      (SELECT count(*) FROM prospects WHERE notes IS NOT NULL AND btrim(notes) <> '')::int AS with_body,
      (SELECT count(*) FROM prospects WHERE archived_at IS NOT NULL)::int AS archived_total,
      (SELECT count(*) FROM prospect_notes)::int AS notes_total,
      (SELECT count(*) FROM users)::int AS users_total,
      (SELECT count(*) FROM organizations)::int AS orgs_total,
      (SELECT count(*) FROM memberships)::int AS memberships_total,
      (SELECT count(*) FROM invitations)::int AS invitations_total,
      (SELECT count(*) FROM events)::int AS events_total`);
  } catch (e) {
    if (!/column "archived_at" does not exist/.test(String(e))) throw e;
    fail++;
    console.log(`  [FAIL] H      archival columns absent — 009 has NOT been applied`.padEnd(64));
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    console.log("\n  VERIFICATION FAILED — 009 is not applied. Nothing was written.\n");
    await client.query("COMMIT");
    process.exit(1);
  }
  check("V37", "ZERO prospects archived by the migration", g.archived_total, EXPECT.archived_total);
  for (const [i, k] of ["prospects_total","anchored","held","closed_won","closed_lost","status_absent",
                        "slugged","with_body","notes_total","users_total","orgs_total",
                        "memberships_total","invitations_total","events_total"].entries()) {
    check(`V${38 + i}`, k + " unchanged", g[k], EXPECT[k]);
  }

  await client.query("COMMIT");
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(fail === 0
    ? "\n  009 VERIFIED. Nothing was written by this check.\n"
    : "\n  VERIFICATION FAILED — STOP. Do not proceed to the backup or deploy anything.\n");
  process.exit(fail === 0 ? 0 : 1);
} finally { await client.end(); }
