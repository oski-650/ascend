#!/usr/bin/env node --experimental-strip-types
// D1b.2 · APPLY MIGRATION 009 TO PRODUCTION — the execution contract, as the thing that executes.
//
// Run with:
//   node --experimental-strip-types scripts/apply-migration-009.mjs --check
//   node --experimental-strip-types scripts/apply-migration-009.mjs --apply-to-production
//
// `--check` is READ-ONLY and is the default: the connection is opened with
// `default_transaction_read_only=on`, so a mistake in this file cannot write. `--apply-to-production`
// must be passed explicitly and is the ONLY path that opens a writable session.
//
// ─── WHY THIS SCRIPT EXISTS AT ALL ─────────────────────────────────────────────────────────────
//
// `applyMigrations` is the right thing to run and the wrong thing to run ALONE. It refuses a file
// already in the ledger, and that is all it checks. It does NOT verify:
//
//   · that the file on disk is the file that was reviewed and frozen (it records whatever it hashes)
//   · that the ledger's PREDECESSOR state is what we believe (it would happily apply 009 to a
//     database at 004)
//   · that the objects the migration creates are absent
//   · that the policy it DROPs is the policy we think it is
//
// Each of those is a way to change production while believing something false about it, so each is
// an explicit precondition below. Nothing here re-implements the migration: the real
// `applyMigrations`, `loadMigrations`, `checksum`, `ledgerStatus` and `verifyChecksums` are imported
// and used, so the ledger row this writes is written by the same code every other migration used.
//
// ─── WHAT IS DELIBERATELY NOT LOADED ───────────────────────────────────────────────────────────
//
// `core/db/migrate.ts` imports only node builtins plus a TYPE-ONLY `SqlClient`, which type-stripping
// erases. So importing it pulls in NO application mutation path — not `core/db/prospects.ts`, not
// `core/crm`, not the route layer, not `pool.ts`. The `SqlClient` below is the minimal adapter this
// script owns. Nothing in this process can archive, promote, or write a business row.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── the frozen identity of what we are applying ───────────────────────────────────────────────
const MIGRATION = "009_prospect_archival.sql";
const FROZEN_SHA256 = "f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d";
const EXPECTED_PREDECESSOR = [
  "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql",
  "004_schema_migrations.sql", "005_user_credentials.sql", "006_invitations.sql",
  "007_invitation_membership.sql", "008_prospect_notes_log.sql",
];
// The policy 009 DROPs. Recreating a policy we mis-read would silently change who may write what.
const EXPECTED_POLICY = {
  qual: "((organization_id = current_org()) AND (identity_state = 'anchored'::text))",
  with_check: "((organization_id = current_org()) AND (identity_state = 'anchored'::text))",
};
const BASELINE_PROSPECTS = 3108;

const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply-to-production");
const ALLOW_COUNT_DRIFT = args.has("--allow-count-drift");

const die = (m) => { console.error(`\n  ABORT: ${m}\n`); process.exit(1); };
const ok = (label, detail = "") => console.log(`  [ok]   ${label.padEnd(52)}${detail}`);
const info = (label, detail) => console.log(`         ${label.padEnd(52)}${detail}`);

// `server-only` is a Next build-time marker with no runtime module. Stub it so the real migration
// module imports cleanly here, exactly as vitest does via its own alias.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(spec, ctx);
  },
});

const pg = (await import(path.join(APP, "node_modules/pg/lib/index.js"))).default;
const { applyMigrations, loadMigrations, ledgerStatus, verifyChecksums } =
  await import(path.join(APP, "core/db/migrate.ts"));

console.log(`\n=== D1b.2 · migration ${MIGRATION} · ${APPLY ? "APPLY TO PRODUCTION" : "CHECK ONLY (read-only)"} ===\n`);

// ─── 1 · the file is the file that was reviewed ────────────────────────────────────────────────
const sql = readFileSync(path.join(APP, "core/db/schema", MIGRATION), "utf8");
const sha = createHash("sha256").update(sql).digest("hex");
if (sha !== FROZEN_SHA256) {
  die(`${MIGRATION} does not match the frozen checksum.\n    on disk : ${sha}\n    frozen  : ${FROZEN_SHA256}\n` +
      `    The file changed after review. Re-review it; do not apply it.`);
}
ok("009 matches the frozen checksum", sha.slice(0, 16) + "…");

const all = loadMigrations();
const only = all.filter((m) => m.name === MIGRATION);
if (only.length !== 1) die(`expected exactly one ${MIGRATION} in MIGRATIONS, found ${only.length}`);
if (only[0].checksum !== FROZEN_SHA256) die("loadMigrations computed a different checksum — refusing");
ok("exactly one migration will be applied", MIGRATION);

// ─── 2 · the connection: DIRECT endpoint, pinned CA, verify-full ───────────────────────────────
const env = {};
for (const line of readFileSync(path.join(APP, ".env.production.local"), "utf8").split("\n")) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const raw = env.ASCEND_DATABASE_URL_DIRECT;
if (!raw) die("ASCEND_DATABASE_URL_DIRECT is not present — DDL must not run through the transaction pooler");
const u = new URL(raw);
for (const p of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "sslnegotiation"]) {
  if (u.searchParams.has(p)) die(`the direct URL carries ${p}; core/db/pool.ts refuses these rather than merging them`);
}
const pem = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/
  .exec(readFileSync(path.join(APP, "core/db/tls.ts"), "utf8"))?.[1];
if (!pem) die("could not read the pinned CA from core/db/tls.ts");

const client = new pg.Client({
  host: u.hostname, port: u.port ? Number(u.port) : 5432,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: { ca: pem, rejectUnauthorized: true, minVersion: "TLSv1.2" },
  // READ-ONLY unless we are applying. DDL cannot run in a read-only transaction, so `--check` is
  // incapable of migrating even if every other guard were removed.
  ...(APPLY ? {} : { options: "-c default_transaction_read_only=on" }),
  statement_timeout: 120_000,
});
await client.connect();
ok("connected to the DIRECT endpoint over verified TLS", APPLY ? "read-write" : "read-only");

const q = async (s, p = []) => (await client.query(s, p)).rows;

try {
  // ─── 3 · the server is the one we proved against ─────────────────────────────────────────────
  const [{ v }] = await q("SELECT current_setting('server_version') AS v");
  if (!v.startsWith("17.")) die(`production reports PostgreSQL ${v}; the recovery proofs are pinned to 17.x`);
  ok("server version", v);

  // ─── 4 · the ledger is EXACTLY the expected predecessor ──────────────────────────────────────
  const tx = {
    query: async (s, p) => { const r = await client.query(s, p ? [...p] : undefined);
                             return { rows: r.rows ?? [], affected: r.rowCount ?? 0 }; },
    exec: async (s) => { await client.query(s); },
    async transaction(fn) {
      await client.query("BEGIN");
      try { const out = await fn(tx); await client.query("COMMIT"); return out; }
      catch (e) { await client.query("ROLLBACK"); throw e; }
    },
  };

  const ledger = await ledgerStatus(tx);
  const versions = ledger.map((r) => r.version);
  if (versions.length !== EXPECTED_PREDECESSOR.length ||
      versions.some((x, i) => x !== EXPECTED_PREDECESSOR[i])) {
    die(`the ledger is not the expected predecessor.\n    expected: ${EXPECTED_PREDECESSOR.join(", ")}\n` +
        `    found   : ${versions.join(", ") || "(empty)"}`);
  }
  ok("ledger is exactly 001–008", `head ${versions[versions.length - 1]}`);

  const drift = await verifyChecksums(tx, all);
  if (drift.length > 0) {
    die(`recorded checksums disagree with core/db/schema for: ${drift.map((d) => d.version).join(", ")}. ` +
        `The schema git describes is not the schema production is running.`);
  }
  ok("zero checksum drift across the applied ledger", `${versions.length} files`);

  // ─── 5 · nothing 009 creates already exists ──────────────────────────────────────────────────
  const [pre] = await q(`SELECT
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
       AND table_name='prospects' AND column_name IN ('archived_at','archived_by'))::int AS cols,
    (SELECT count(*) FROM pg_constraint WHERE conname='archival_has_provenance')::int AS chk,
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='prospects_org_active_idx')::int AS idx`);
  if (pre.cols || pre.chk || pre.idx) {
    die(`objects 009 creates already exist (cols=${pre.cols} check=${pre.chk} index=${pre.idx}). ` +
        `Something applied part of this migration outside the ledger.`);
  }
  ok("archival columns, constraint and index are all absent", "cols=0 check=0 index=0");

  // ─── 6 · the policy 009 replaces is the policy we read ───────────────────────────────────────
  const [pol] = await q(`SELECT qual, with_check FROM pg_policies
     WHERE schemaname='public' AND tablename='prospects' AND policyname='prospects_update_sales'`);
  if (!pol) die("prospects_update_sales does not exist — 009's DROP POLICY would fail");
  if (pol.qual !== EXPECTED_POLICY.qual || pol.with_check !== EXPECTED_POLICY.with_check) {
    die(`prospects_update_sales is not the policy 009 was written against.\n` +
        `    USING      expected ${EXPECTED_POLICY.qual}\n               found    ${pol.qual}\n` +
        `    WITH CHECK expected ${EXPECTED_POLICY.with_check}\n               found    ${pol.with_check}`);
  }
  ok("prospects_update_sales matches 001 exactly", "drop/recreate is predictable");

  // ─── 7 · the database is the one we measured ─────────────────────────────────────────────────
  const [n] = await q(`SELECT (SELECT count(*) FROM prospects)::int AS prospects,
                              (SELECT count(*) FROM prospect_notes)::int AS notes,
                              (SELECT count(*) FROM users)::int AS users,
                              (SELECT count(*) FROM events)::int AS events`);
  info("prospects / notes / users / events", `${n.prospects} / ${n.notes} / ${n.users} / ${n.events}`);
  if (n.prospects !== BASELINE_PROSPECTS && !ALLOW_COUNT_DRIFT) {
    die(`prospects count is ${n.prospects}, baseline was ${BASELINE_PROSPECTS}. The database changed ` +
        `since the contract was frozen. Re-read and re-freeze, or pass --allow-count-drift if the ` +
        `change is understood and expected.`);
  }
  ok("row counts consistent with the frozen baseline", `${n.prospects} prospects`);

  // ─── 8 · apply, or stop ──────────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log("\n  CHECK ONLY. Every precondition passed and NOTHING was written.");
    console.log("  To apply:  node --experimental-strip-types scripts/apply-migration-009.mjs --apply-to-production\n");
    process.exit(0);
  }

  console.log("\n  Applying — one migration, one transaction, via the real applyMigrations…\n");
  const started = Date.now();
  const applied = await applyMigrations(tx, only);
  ok("APPLIED", `${applied.map((a) => `${a.name} (${a.ms} ms)`).join(", ")} · wall ${Date.now() - started} ms`);

  // ─── 9 · the commit proved, from the ledger the migration itself wrote ───────────────────────
  const after = await ledgerStatus(tx);
  const row = after.find((r) => r.version === MIGRATION);
  if (!row) die("009 applied but is ABSENT from the ledger — stop and investigate before anything else");
  if (row.checksum !== FROZEN_SHA256) die(`the ledger recorded checksum ${row.checksum}, expected ${FROZEN_SHA256}`);
  if (row.applied_at_is_backfilled) die("the ledger marked this backfilled — it was applied live and must say so");
  ok("ledger row written", `${after.length} rows, head ${after[after.length - 1].version}`);
  ok("recorded checksum matches the frozen value", row.checksum.slice(0, 16) + "…");
  ok("applied_at_is_backfilled", "false (witnessed, not reconstructed)");
  console.log("\n  009 COMMITTED. Run the post-migration verification next:");
  console.log("  node --experimental-strip-types scripts/verify-migration-009.mjs\n");
} finally {
  await client.end();
}
