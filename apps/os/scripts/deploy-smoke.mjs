#!/usr/bin/env node
// PRODUCTION DEPLOYMENT SMOKE — 2A.3a: migration 010 plus the promoted 2A.1c–2A.2e Sales stack, onto
// production that is running the D1 build on schema 009. FROZEN BEFORE DEPLOYMENT.
// (First written for D1a/D1b.1; the D1 checks now pass on BOTH builds, and the 2A.3a Sales checks are
// the ones that must fail on the old build — see `newBuild` below.)
//
//   node scripts/deploy-smoke.mjs --unauth-only
//       no login, no database, no file writes: shell + static-asset checks only
//   node scripts/deploy-smoke.mjs --baseline --record <file.json>
//       against the CURRENT (old) build, before deploying. Records the state the post-deploy run is
//       compared with, and proves the D1 checks DISCRIMINATE: on the old build they must FAIL.
//   node scripts/deploy-smoke.mjs --post --since <file.json>
//       after deploying. Every check must pass, and nothing may have changed since the baseline.
//   add --partner to either mode to also sign in as the sales partner. The partner's email and
//       password come ONLY from ASCEND_SMOKE_PARTNER_EMAIL / ASCEND_SMOKE_PARTNER_PASSWORD (set with
//       `read -rs`); they are never printed, logged or placed in argv.
//
// THE SALES CHECKS WRITE NOTHING. Every probe of a Sales command route uses a prospect reference that
// cannot exist, with a well-formed body, so the route authorizes, parses, and is refused at prospect
// resolution (`404 prospect_not_found`) BEFORE any receipt, contact, follow-up or event is written
// (core/db/sales-actions.ts: validate → lockTarget → receipt). Production contacts, follow-ups and
// events are append-only, so a real Save is never part of this script: the first real contact is the
// owner's manual acceptance step in docs/SLICE-2A3A-EXECUTION-CONTRACT.md.
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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BASE = "http://127.0.0.1:3001";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = has("--unauth-only") ? "unauth" : has("--baseline") ? "baseline" : has("--post") ? "post" : null;
if (!MODE) { console.error("usage: --unauth-only | --baseline --record FILE | --post --since FILE  [--partner]"); process.exit(2); }
const PARTNER = has("--partner");
// The ledger head each mode must find: the baseline runs on the D1 build over 009; post runs after 010.
const LEDGER_HEAD = MODE === "post" ? { version: "010_sales_actions.sql", rows: 10 } : { version: "009_prospect_archival.sql", rows: 9 };

// The five selectors Slice 1C added to app/globals.css (git show 6cb91d2).
const SELECTORS_1C = [".ascend-main", ".ascend-public", ".ascend-timer", ".ascend-wipe", ".ascend-wipe-targets"];
const ERROR_LOG = path.join(process.env.HOME, "Library/Logs/ascend-os.error.log");

let pass = 0, fail = 0, info = 0;
const results = [];
const check = (id, label, ok, detail = "", { newBuild = false } = {}) => {
  // In BASELINE mode a 2A.3a check is EXPECTED to fail on the old build — that is the discrimination
  // proof, not a defect. A check that passes on the old build proves nothing about the new one.
  const expectedFail = MODE === "baseline" && newBuild;
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
// The four Sales tables exist only after 010, so only post mode can count them.
const SALES_COUNTS = `SELECT (SELECT count(*) FROM prospect_command_receipts)::int AS receipts,
  (SELECT count(*) FROM prospect_contacts)::int AS contacts, (SELECT count(*) FROM prospect_followups)::int AS followups,
  (SELECT count(*) FROM prospect_stage_transitions)::int AS transitions`;
const salesBefore = MODE === "post" ? await dbRead(async (q) => (await q(SALES_COUNTS))[0]) : null;

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
check("B1", "an active prospect's page loads", detail.status === 200, `HTTP ${detail.status}`);
check("B2", "the archive action is present", />\s*Archive\s*</.test(detail.text) || detail.text.includes("Notes and history are kept"));
check("B3", "no ordinary 'Delete' action remains", !/>\s*Delete\s*</.test(detail.text));

const ghost = `d1-smoke-no-such-prospect-${randomBytes(6).toString("hex")}`;
const del = await req("DELETE", `/api/prospects/${ghost}`);
check("B4", "DELETE is source-correct: Postgres path, refuses, touches nothing",
  del.status === 404 && del.json?.store === "postgres" && del.json?.outcome === "not_found" &&
  del.json?.changed?.prospect === "none" && del.json?.changed?.vault === "none",
  `HTTP ${del.status} store=${del.json?.store ?? "-"} outcome=${del.json?.outcome ?? "-"}`);

if (MODE === "post") {
  // Not run on the OLD build: pre-D1a promotion is the code whose failure modes D1a measured.
  const pr = await req("POST", `/api/prospects/${ghost}/promote`, { client_slug: `${ghost}-client` });
  check("B5", "promotion is source-correct: Postgres path, refuses, writes nothing",
    pr.status === 404 && pr.json?.outcome === "refused" && pr.json?.refusal?.code === "prospect_not_found" &&
    pr.json?.operation?.store === "postgres", `HTTP ${pr.status} outcome=${pr.json?.outcome ?? "-"}`);
}

// ─── SALES · 2A.3a — the promoted Sales stack is what is serving (owner) ───────────────────────
console.log("--- SALES / 2A.3a (owner) ---");
{
  const queue = await req("GET", "/sales");
  check("C1", "/sales is the bounded work queue (Overdue, Due today, Never contacted)",
    queue.status === 200 && ["Overdue", "Due today", "Never contacted"].every((t) => queue.text.includes(t)),
    `HTTP ${queue.status}`, { newBuild: true });
  const list = await req("GET", "/sales/list");
  check("C2", "/sales/list loads", list.status === 200, `HTTP ${list.status}`, { newBuild: true });
  check("C3", "the prospect page offers Record contact", detail.status === 200 && detail.text.includes("Record contact"), "", { newBuild: true });
  check("C4", "the prospect page offers the owner's assignment control", detail.text.includes("Reassign / unassign"), "", { newBuild: true });
  const cid = () => randomUUID();
  const refused = (r) => r.status === 404 && ["prospect_not_found", "followup_not_found"].includes(r.json?.error);
  const save = await req("POST", `/api/prospects/${ghost}/actions`, { commandId: cid(), contact: { outcome: "no_answer", channel: "call" } });
  check("C5", "Save route is live and refuses an unknown prospect before writing", refused(save),
    `HTTP ${save.status} ${save.json?.error ?? "-"}`, { newBuild: true });
  const asg = await req("POST", `/api/prospects/${ghost}/assignment`, { commandId: cid(), mode: "unassign", expectedAssignee: null });
  check("C6", "assignment route is live and refuses an unknown prospect before writing", refused(asg),
    `HTTP ${asg.status} ${asg.json?.error ?? "-"}`, { newBuild: true });
  const fu = await req("PATCH", `/api/prospects/${ghost}/followups/${cid()}`, {
    commandId: cid(), expected: { action: "call", assignee: cid(), dueOn: "2026-01-02", dueAt: null }, changes: { action: "email" } });
  check("C7", "follow-up edit route is live and refuses an unknown prospect before writing", refused(fu),
    `HTTP ${fu.status} ${fu.json?.error ?? "-"}`, { newBuild: true });
}

// ─── SALES · the partner (optional; credentials from the environment only) ─────────────────────
if (PARTNER) {
  console.log("--- SALES / 2A.3a (partner) ---");
  const pe = process.env.ASCEND_SMOKE_PARTNER_EMAIL ?? "", pp = process.env.ASCEND_SMOKE_PARTNER_PASSWORD ?? "";
  if (!pe || !pp) { console.log("\n  ABORT: --partner needs ASCEND_SMOKE_PARTNER_EMAIL and ASCEND_SMOKE_PARTNER_PASSWORD.\n"); process.exit(1); }
  const ownerCookie = cookie; cookie = "";
  const pl = await req("POST", "/api/auth/login", { email: pe, password: pp });
  const ps = /ascend_os_session=[^;]+/.exec(pl.headers.get("set-cookie") ?? "")?.[0];
  check("R1", "partner login succeeds", pl.status === 200 && !!ps, `HTTP ${pl.status}`);
  if (ps) {
    cookie = ps;
    const pq = await req("GET", "/sales");
    check("R2", "partner sees the bounded work queue", pq.status === 200 && pq.text.includes("Due today"), `HTTP ${pq.status}`, { newBuild: true });
    const pd = state.ref ? await req("GET", `/sales/${encodeURIComponent(state.ref)}`) : { status: 0, text: "" };
    check("R3", "partner prospect page has Record contact and NO owner controls",
      pd.status === 200 && pd.text.includes("Record contact") && !pd.text.includes("Reassign / unassign"), `HTTP ${pd.status}`, { newBuild: true });
    const pa = await req("POST", `/api/prospects/${ghost}/assignment`, { commandId: "00000000-0000-4000-8000-000000000000", mode: "unassign", expectedAssignee: null });
    check("R4", "partner is refused owner assignment authority (403)", pa.status === 403, `HTTP ${pa.status}`, { newBuild: true });
    const padm = await req("GET", "/admin");
    // renderOrDenied answers 200 with the denial surface (components/auth/Denied: "Not available").
    check("R5", "partner is denied /admin", padm.status !== 200 || padm.text.includes("Not available"), `HTTP ${padm.status}`);
  }
  cookie = ownerCookie;
}

// ─── AFTER: nothing moved ──────────────────────────────────────────────────────────────────────
const after = await dbRead(async (q) => (await q(`SELECT
    (SELECT count(*)::int FROM prospects) AS prospects,
    (SELECT count(*)::int FROM prospects WHERE archived_at IS NOT NULL) AS archived,
    (SELECT count(*)::int FROM events) AS events,
    (SELECT max(seq)::text FROM events) AS events_max_seq,
    (SELECT count(*)::int FROM prospect_notes) AS notes`))[0]);
console.log("--- NOTHING MOVED ---");
check("D1", `ledger head is ${LEDGER_HEAD.version.slice(0, 3)}`, state.ledger_head === LEDGER_HEAD.version && state.ledger_rows === LEDGER_HEAD.rows, state.ledger_head);
check("D2", "zero prospects archived", after.archived === 0 && state.archived === 0, `${after.archived}`);
check("D3", "active set = all prospects (none archived)", state.active === state.prospects, `${state.active}/${state.prospects}`);
check("D4", "no event appended during the smoke", after.events === state.events && after.events_max_seq === state.events_max_seq,
  `${state.events} → ${after.events}`);
check("D5", "prospects and notes unchanged during the smoke", after.prospects === state.prospects && after.notes === state.notes,
  `${after.prospects} / ${after.notes}`);
check("D6", "vault hit list and CRM folder unchanged", vaultDigest() === vaultBefore);
if (MODE === "post") {
  const salesAfter = await dbRead(async (q) => (await q(SALES_COUNTS))[0]);
  check("D8", "no Sales receipt, contact, follow-up or transition written by the smoke",
    JSON.stringify(salesAfter) === JSON.stringify(salesBefore), Object.values(salesAfter).join("/"));
}
const newLog = errorLogBytes() > logBefore ? (() => { const b = readFileSync(ERROR_LOG); return b.subarray(logBefore).toString("utf8"); })() : "";
check("D7", "no schema/active-set error logged during the smoke",
  !/archived_at|does not exist|column .* of relation|permission denied|needs its transition record/.test(newLog), `${newLog.length} new log bytes`);

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
    !/archived_at|does not exist|column .* of relation|permission denied|needs its transition record|Could not find a production build/.test(since), `${since.length} new log bytes`);
}

console.log(`\n=== ${pass} passed · ${fail} failed${MODE === "baseline" ? ` · ${info} D1 checks failed AS EXPECTED on the old build` : ""} ===\n`);
process.exit(fail ? 1 : 0);
