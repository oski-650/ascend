#!/usr/bin/env node
// PRODUCTION DEPLOYMENT SMOKE — D1a/D1b.1 onto the live schema 009. FROZEN BEFORE DEPLOYMENT.
//
//   node scripts/deploy-smoke.mjs --unauth-only
//       no login, no database, no file writes: shell + static-asset checks only
//   node scripts/deploy-smoke.mjs --baseline --record <file.json>
//       against the CURRENT (old) build, before deploying. Records the state the post-deploy run is
//       compared with, and proves the D1 checks DISCRIMINATE: on the old build they must FAIL.
//   node scripts/deploy-smoke.mjs --post --since <file.json>
//       after deploying. Every check must pass, and nothing may have changed since the baseline.
//
// THE OWNER EMAIL is taken from ASCEND_SMOKE_OWNER_EMAIL, or typed at a silent prompt; it is never
// printed, logged or placed in argv. The password is ASCEND_OWNER_PASSWORD from .env.production.local,
// parsed without printing — the same handling scripts/recovery-verify.sh uses.
//
// ─── WHAT THIS SCRIPT WILL NOT DO ──────────────────────────────────────────────────────────────
//
// It archives nothing, promotes nothing, deletes nothing and imports nothing. The two mutation routes
// are probed ONLY with a reference that cannot exist, so the resolver refuses before any write — in
// the old build AND the new one. The response SHAPE still tells the two apart: that is what makes the
// probe discriminating without touching a single business row.
//
// It never calls /api/prospects/from-url. That route fetches the operator's URL and may call
// PageSpeed BEFORE refusing, and on the OLD build it would write a phantom vault file in Postgres
// mode — the very defect D1a removed. Its refusal is evidenced by D1a's M11 test (createProspect
// refuses while Postgres owns prospects) and by the bundle, not by a live call.
//
// It avoids pages that reconcile on read (the parameterised client/production pages). Every page it
// loads was checked for write calls and has none.
//
// Every database read is inside BEGIN READ ONLY with default_transaction_read_only=on.

import { readFileSync, writeFileSync, readdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BASE = "http://127.0.0.1:3001";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = has("--unauth-only") ? "unauth" : has("--baseline") ? "baseline" : has("--post") ? "post" : null;
if (!MODE) { console.error("usage: --unauth-only | --baseline --record FILE | --post --since FILE"); process.exit(2); }

// The five selectors Slice 1C added to app/globals.css (git show 6cb91d2).
const SELECTORS_1C = [".ascend-main", ".ascend-public", ".ascend-timer", ".ascend-wipe", ".ascend-wipe-targets"];
const ERROR_LOG = path.join(process.env.HOME, "Library/Logs/ascend-os.error.log");

let pass = 0, fail = 0, info = 0;
const results = [];
const check = (id, label, ok, detail = "", { d1 = false } = {}) => {
  // In BASELINE mode a D1 check is EXPECTED to fail — that is the discrimination proof, not a defect.
  const expectedFail = MODE === "baseline" && d1;
  const verdict = ok ? (expectedFail ? "UNEXPECTED-PASS" : "ok") : (expectedFail ? "fails (expected on old build)" : "FAIL");
  if (verdict === "ok") pass++; else if (verdict.startsWith("fails")) info++; else fail++;
  results.push({ id, ok, verdict });
  console.log(`  [${verdict === "ok" ? "ok  " : verdict === "FAIL" || verdict === "UNEXPECTED-PASS" ? "FAIL" : "base"}] ${id.padEnd(4)} ${label.padEnd(58)} ${detail}`);
};

// ─── env, parsed without printing ──────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(path.join(APP, ".env.production.local"), "utf8").split("\n")) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ─── small HTTP helpers ────────────────────────────────────────────────────────────────────────
let cookie = "";
const req = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method, redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, text, json, headers: r.headers };
};

// ─── read-only database handle ─────────────────────────────────────────────────────────────────
async function dbRead(fn) {
  const pg = (await import(path.join(APP, "node_modules/pg/lib/index.js"))).default;
  const u = new URL(env.ASCEND_DATABASE_URL_DIRECT);
  const pem = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/
    .exec(readFileSync(path.join(APP, "core/db/tls.ts"), "utf8"))[1];
  const c = new pg.Client({
    host: u.hostname, port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { ca: pem, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    options: "-c default_transaction_read_only=on", statement_timeout: 30000,
  });
  await c.connect();
  try { await c.query("BEGIN READ ONLY"); const out = await fn((s, p) => c.query(s, p).then((r) => r.rows)); await c.query("COMMIT"); return out; }
  finally { await c.end(); }
}

// ─── vault guard: names AND bytes of the hit list, names+sizes of the CRM folder ────────────────
function vaultDigest() {
  const root = env.ASCEND_VAULT_PATH;
  const h = createHash("sha256");
  const hl = path.join(root, "02 - Sales & Hit List");
  for (const f of (existsSync(hl) ? readdirSync(hl) : []).sort()) h.update("HL:" + f).update(readFileSync(path.join(hl, f)));
  const crm = path.join(root, "01 - CRM & Clients");
  for (const d of (existsSync(crm) ? readdirSync(crm) : []).sort()) h.update("CRM:" + d);
  return h.digest("hex");
}
const errorLogBytes = () => (existsSync(ERROR_LOG) ? readFileSync(ERROR_LOG).length : 0);

console.log(`\n=== DEPLOYMENT SMOKE · mode ${MODE} ===\n--- SHELL (unauthenticated) ---`);

// S1–S3 · the shell is up, and redirects the unauthenticated
const login = await req("GET", "/login");
check("S1", "/login loads", login.status === 200, `HTTP ${login.status}`);
const root = await req("GET", "/");
check("S2", "/ redirects the unauthenticated to /login",
  root.status === 307 && (root.headers.get("location") ?? "").includes("/login"), `HTTP ${root.status}`);

// S3 · 1C · the CSS the page actually links carries every 1C selector
const cssHrefs = [...login.text.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
let css = "";
for (const h of cssHrefs) css += (await req("GET", h)).text;
const missing1c = SELECTORS_1C.filter((s) => !css.includes(s));
check("S3", "1C · linked CSS carries all five 1C selectors", cssHrefs.length > 0 && missing1c.length === 0,
  `${cssHrefs.length} stylesheet(s); missing: ${missing1c.join(" ") || "none"}`);

if (MODE === "unauth") {
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
}

// ─── state recorded BEFORE any authenticated request, so the smoke itself is covered ─────────
const state = await dbRead(async (q) => {
  const [r] = await q(`SELECT
    (SELECT max(version) FROM schema_migrations) AS ledger_head,
    (SELECT count(*)::int FROM schema_migrations) AS ledger_rows,
    (SELECT count(*)::int FROM prospects) AS prospects,
    (SELECT count(*)::int FROM prospects WHERE archived_at IS NULL) AS active,
    (SELECT count(*)::int FROM prospects WHERE archived_at IS NOT NULL) AS archived,
    (SELECT count(*)::int FROM events) AS events,
    (SELECT max(seq)::text FROM events) AS events_max_seq,
    (SELECT count(*)::int FROM prospect_notes) AS notes,
    (SELECT count(*)::int FROM users) AS users`);
  // An ACTIVE, anchored prospect to render — held in memory, never printed.
  const [p] = await q(`SELECT coalesce(slug, id::text) AS ref FROM prospects
     WHERE archived_at IS NULL AND identity_state = 'anchored' ORDER BY id LIMIT 1`);
  return { ...r, ref: p?.ref ?? null };
});
const vaultBefore = vaultDigest();
const logBefore = errorLogBytes();

// ─── login ─────────────────────────────────────────────────────────────────────────────────────
let email = process.env.ASCEND_SMOKE_OWNER_EMAIL ?? "";
if (!email) {
  process.stderr.write("Owner email (not echoed): ");
  const fd = openSync("/dev/tty", "r"); const buf = Buffer.alloc(256);
  const { execSync } = await import("node:child_process");
  execSync("stty -echo < /dev/tty"); const n = readSync(fd, buf, 0, 256, null); execSync("stty echo < /dev/tty"); closeSync(fd);
  email = buf.subarray(0, n).toString("utf8").trim(); process.stderr.write("\n");
}
console.log("--- AUTH ---");
const li = await req("POST", "/api/auth/login", { email, password: env.ASCEND_OWNER_PASSWORD });
email = "";
const sc = li.headers.get("set-cookie") ?? "";
const sess = /ascend_os_session=[^;]+/.exec(sc)?.[0];
check("A1", "login succeeds and issues a session cookie", li.status === 200 && li.json?.ok === true && !!sess, `HTTP ${li.status}`);
if (!sess) { console.log("\n  ABORT: no session — nothing further can be checked.\n"); process.exit(1); }
cookie = sess;

const owner = await req("GET", "/admin");
check("A2", "owner principal resolves (/admin demands admin:*)", owner.status === 200, `HTTP ${owner.status}`);
for (const [i, p] of ["/", "/galaxy", "/sales", "/partner", "/crm", "/tasks", "/signals"].entries()) {
  const r = await req("GET", p);
  check(`A${3 + i}`, `${p} loads authenticated`, r.status === 200, `HTTP ${r.status}`);
}
// ─── CORRECTED 2026-09-21, owner-authorized — WITNESSED SMOKE-SPECIFICATION DEFECT ──────────────
//
// As frozen, A10 expected `/search` → 200. The pre-deploy baseline on the old build returned 307,
// and that is CORRECT: `/search` is a deliberate permanent redirect to `/console`
// (app/search/page.tsx, since 4c21aaa, 2026-08-14), kept "so any bookmark still resolves". Neither
// `app/search` nor `app/console` changed in the undeployed range, so the new build redirects the
// same way. Left as frozen, A10 would have failed AFTER deployment and met the rollback trigger for a
// route working exactly as designed.
//
// A10 now asserts the redirect itself. A11 is one bounded coverage addition: the redirect's real
// destination, which owns command invocation and the mutation confirm gate and was otherwise
// unchecked. No other expectation in this matrix was changed.
{
  const r = await req("GET", "/search");
  const loc = r.headers.get("location") ?? "";
  const dest = loc ? new URL(loc, BASE).pathname : "";
  check("A10", "/search is the permanent redirect to /console", r.status === 307 && dest === "/console",
    `HTTP ${r.status} → ${dest || "(no location)"}`);
  const c = await req("GET", "/console");
  check("A11", "/console loads authenticated", c.status === 200, `HTTP ${c.status}`);
}

// ─── SALES ─────────────────────────────────────────────────────────────────────────────────────
console.log("--- SALES / D1 ---");
const detail = state.ref ? await req("GET", `/sales/${encodeURIComponent(state.ref)}`) : { status: 0, text: "" };
check("B1", "an active prospect's page loads under schema 009", detail.status === 200, `HTTP ${detail.status}`);
check("B2", "the archive action is present", />\s*Archive\s*</.test(detail.text) || detail.text.includes("Notes and history are kept"),
  "", { d1: true });
check("B3", "no ordinary 'Delete' action remains", !/>\s*Delete\s*</.test(detail.text), "", { d1: true });

const ghost = `d1-smoke-no-such-prospect-${randomBytes(6).toString("hex")}`;
const del = await req("DELETE", `/api/prospects/${ghost}`);
check("B4", "DELETE is source-correct: Postgres path, refuses, touches nothing",
  del.status === 404 && del.json?.store === "postgres" && del.json?.outcome === "not_found" &&
  del.json?.changed?.prospect === "none" && del.json?.changed?.vault === "none",
  `HTTP ${del.status} store=${del.json?.store ?? "-"} outcome=${del.json?.outcome ?? "-"}`, { d1: true });

if (MODE === "post") {
  // Not run on the OLD build: pre-D1a promotion is the code whose failure modes D1a measured.
  const pr = await req("POST", `/api/prospects/${ghost}/promote`, { client_slug: `${ghost}-client` });
  check("B5", "promotion is source-correct: Postgres path, refuses, writes nothing",
    pr.status === 404 && pr.json?.outcome === "refused" && pr.json?.refusal?.code === "prospect_not_found" &&
    pr.json?.operation?.store === "postgres", `HTTP ${pr.status} outcome=${pr.json?.outcome ?? "-"}`);
}

// ─── AFTER: nothing moved ──────────────────────────────────────────────────────────────────────
const after = await dbRead(async (q) => (await q(`SELECT
    (SELECT count(*)::int FROM prospects) AS prospects,
    (SELECT count(*)::int FROM prospects WHERE archived_at IS NOT NULL) AS archived,
    (SELECT count(*)::int FROM events) AS events,
    (SELECT max(seq)::text FROM events) AS events_max_seq,
    (SELECT count(*)::int FROM prospect_notes) AS notes`))[0]);
console.log("--- NOTHING MOVED ---");
check("D1", "ledger head is 009", state.ledger_head === "009_prospect_archival.sql" && state.ledger_rows === 9, state.ledger_head);
check("D2", "zero prospects archived", after.archived === 0 && state.archived === 0, `${after.archived}`);
check("D3", "active set = all prospects (none archived)", state.active === state.prospects, `${state.active}/${state.prospects}`);
check("D4", "no event appended during the smoke", after.events === state.events && after.events_max_seq === state.events_max_seq,
  `${state.events} → ${after.events}`);
check("D5", "prospects and notes unchanged during the smoke", after.prospects === state.prospects && after.notes === state.notes,
  `${after.prospects} / ${after.notes}`);
check("D6", "vault hit list and CRM folder unchanged", vaultDigest() === vaultBefore);
const newLog = errorLogBytes() > logBefore ? (() => { const b = readFileSync(ERROR_LOG); return b.subarray(logBefore).toString("utf8"); })() : "";
check("D7", "no schema/active-set error logged during the smoke",
  !/archived_at|does not exist|column .* of relation/.test(newLog), `${newLog.length} new log bytes`);

if (MODE === "baseline") {
  const rec = { recorded_at: new Date().toISOString(), ...state, ref: undefined, vault: vaultBefore, error_log_bytes: logBefore };
  delete rec.ref;
  writeFileSync(arg("--record"), JSON.stringify(rec, null, 2), { mode: 0o600 });
  console.log(`\n  baseline recorded → ${arg("--record")} (counts and digests only; no names, no refs)`);
}
if (MODE === "post") {
  const base = JSON.parse(readFileSync(arg("--since"), "utf8"));
  console.log("--- SINCE THE PRE-DEPLOY BASELINE ---");
  check("P1", "no event appended across the deployment", state.events === base.events && state.events_max_seq === base.events_max_seq,
    `${base.events} → ${state.events}`);
  check("P2", "prospects / notes / users unchanged across the deployment",
    state.prospects === base.prospects && state.notes === base.notes && state.users === base.users,
    `${base.prospects}→${state.prospects} ${base.notes}→${state.notes} ${base.users}→${state.users}`);
  check("P3", "vault unchanged across the deployment", vaultBefore === base.vault);
  const since = errorLogBytes() > base.error_log_bytes ? readFileSync(ERROR_LOG).subarray(base.error_log_bytes).toString("utf8") : "";
  check("P4", "no schema/active-set error logged since the baseline",
    !/archived_at|does not exist|column .* of relation|Could not find a production build/.test(since), `${since.length} new log bytes`);
}

console.log(`\n=== ${pass} passed · ${fail} failed${MODE === "baseline" ? ` · ${info} D1 checks failed AS EXPECTED on the old build` : ""} ===\n`);
process.exit(fail ? 1 : 0);
