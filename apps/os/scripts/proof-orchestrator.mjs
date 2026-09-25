#!/usr/bin/env node
// Local exact-tree proof driver. Nothing from a child process is relayed to Coordinator.
import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, lstatSync, readlinkSync, realpathSync,
  mkdirSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GATE_2G1 } from '../tests/architecture/gate-2g1.ts';
import { LEGACY_CONTRACTS } from '../core/recovery/legacy-contracts.ts';
import { legacyContractFor, proofEnvironment } from '../../../tools/agent/lib/proof-environment.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const home = homedir();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, args, options = {}) => spawnSync(file, args, { cwd: app, encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024, ...options });
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const phaseSuites = phase => Object.entries(GATE_2G1).filter(([, row]) => row.evidence === 'PROVEN' && row.phase === phase).map(([name]) => name);
const recoveryFixture = ['tests/recovery/artifact.test.ts', 'tests/db/restore-fidelity.test.ts', 'tests/db/recovery-profiles.test.ts'];
const r1b = ['tests/db/restore-independence.test.ts'];
const r1c = ['tests/db/restore-same-version.test.ts'];

export function planProof(gates, manifest = GATE_2G1) {
  if (!Array.isArray(gates) || gates.some(name => !['typecheck', 'gate:static', 'gate:server', 'gate:db'].includes(name)))
    throw Error('unknown proof gate');
  const names = [...new Set(gates)];
  const staticProof = names.includes('gate:static');
  const server = names.includes('gate:server');
  const db = names.includes('gate:db');
  const recoveryNames = Object.entries(manifest).filter(([, row]) => row.evidence === 'PROVEN' && row.phase === 'recovery');
  if (db && recoveryNames.some(([suite]) => ![...recoveryFixture, ...r1b, ...r1c].includes(suite)))
    throw Error('unknown recovery suite contract');
  const fixture = db && recoveryNames.some(([, row]) => !(row.requires ?? []).includes('ASCEND_BACKUP_ARTIFACT'));
  const owner = db && recoveryNames.some(([, row]) => (row.requires ?? []).includes('ASCEND_BACKUP_ARTIFACT'));
  if (fixture && recoveryFixture.some(name => !recoveryNames.some(([suite]) => suite === name)))
    throw Error('unknown recovery fixture contract');
  if (owner && [...r1b, ...r1c].some(name => !recoveryNames.some(([suite]) => suite === name)))
    throw Error('unknown owner recovery contract');
  return { static: staticProof, server, db, fixture, owner,
    aggregate: staticProof && server && db && fixture && owner };
}

export function parseLocalEnv(raw) {
  const dbNames = new Set(['ASCEND_DATABASE_URL', 'ASCEND_DATABASE_URL_DIRECT',
    'ASCEND_DATABASE_URL_ADMIN_POOLED']);
  const names = new Set([...dbNames, 'ASCEND_OS_SESSION_SECRET']);
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !names.has(match[1])) continue;
    if (result[match[1]]) throw Error('duplicate sanctioned database input');
    result[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  if ([...names].some(name => !result[name])) throw Error('sanctioned test input unavailable');
  for (const name of dbNames) {
    const url = new URL(result[name]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password)
      throw Error('invalid sanctioned database input');
  }
  if (result.ASCEND_DATABASE_URL === result.ASCEND_DATABASE_URL_ADMIN_POOLED)
    throw Error('app and admin database identities must differ');
  return { app: result.ASCEND_DATABASE_URL, direct: result.ASCEND_DATABASE_URL_DIRECT,
    adminPooled: result.ASCEND_DATABASE_URL_ADMIN_POOLED, sessionSecret: result.ASCEND_OS_SESSION_SECRET };
}

function localEnvFile() {
  const roots = git('worktree', 'list', '--porcelain').split('\n').filter(x => x.startsWith('worktree ')).map(x => x.slice(9));
  const found = roots.map(root => join(root, 'apps/os/.env.production.local')).filter(existsSync);
  if (found.length !== 1) throw Error('sanctioned local environment file is missing or ambiguous');
  if (statSync(found[0]).mode & 0o077) throw Error('sanctioned local environment file must be private');
  return found[0];
}

function candidate() {
  if (git('status', '--porcelain')) throw Error('proof requires a clean candidate tree');
  return { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
}
function sameCandidate(initial) {
  const now = candidate();
  if (now.head !== initial.head || now.tree !== initial.tree) throw Error('candidate changed during proof');
}
function checkedChild(file, args, env, label) {
  const result = run(file, args, { env });
  if (result.error || result.status !== 0) throw Error(`${label} failed; private child output withheld`);
  return result.stdout;
}
function receiptValid(args) {
  return run(process.execPath, ['scripts/gate-proof.mjs', ...args],
    { env: proofEnvironment('static') }).status === 0;
}
function phase(initial, name, env, d) {
  d.sameCandidate(initial);
  if (d.receiptValid(['verify-phase', name])) {
    d.sameCandidate(initial);
    d.log(`${name}: ${phaseSuites(name).length} exact-tree receipts already valid`);
    return;
  }
  d.checkedChild(process.execPath, ['scripts/gate-proof.mjs', name === 'static' ? 'static-only' : name], env, name);
  d.sameCandidate(initial);
  if (!d.receiptValid(['verify-phase', name])) throw Error(`${name} receipts invalid after execution`);
  d.log(`${name}: ${phaseSuites(name).length} exact-tree suites proven`);
}
function recovery(initial, suites, args, env, label, d) {
  d.sameCandidate(initial);
  if (d.receiptValid(['verify-recovery', ...suites])) {
    d.sameCandidate(initial);
    d.log(`${label}: ${suites.length} exact-tree receipts already valid`);
    return;
  }
  d.checkedChild('bash', ['scripts/recovery-verify.sh', ...args], env, label);
  d.sameCandidate(initial);
  if (!d.receiptValid(['verify-recovery', ...suites])) throw Error(`${label} receipts invalid after execution`);
  d.log(`${label}: ${suites.length} exact-tree suites proven`);
}
export function selectArtifact(root, contracts) {
  const canonicalRoot = realpathSync(root);
  const entries = contracts.filter(c => c.acceptedIn.includes('CURRENT recovery point'));
  if (entries.length !== 1) throw Error('current pinned recovery point is ambiguous');
  if (entries[0].artifact !== basename(entries[0].artifact) ||
    !/^ascend-backup-\d{8}T\d{6}Z(?:-[a-z0-9-]+)?\.ascbk$/.test(entries[0].artifact))
    throw Error('pinned artifact name invalid');
  const path = join(canonicalRoot, entries[0].artifact);
  if (dirname(realpathSync(path)) !== canonicalRoot || !statSync(path).isFile()) throw Error('pinned artifact unavailable');
  const bytes = readFileSync(path);
  const format = bytes.subarray(0, 8).toString() === 'ASCBKUP2' ? 'ascend-backup/2' :
    bytes.subarray(0, 8).toString() === 'ASCBKUP3' ? 'ascend-backup/3' : null;
  if (!format || bytes.length < 13) throw Error('unsupported artifact envelope');
  const headerLength = bytes.readUInt32BE(8);
  if (!headerLength || headerLength > 1024 * 1024 || bytes.length < 12 + headerLength) throw Error('invalid artifact header');
  JSON.parse(bytes.subarray(12, 12 + headerLength).toString());
  if (sha256(bytes) !== entries[0].artifactSha256) throw Error('artifact differs from pinned acceptance evidence');
  const contract = legacyContractFor({ format, sha256: sha256(bytes), contracts });
  return { path, contract };
}
function artifactSelection() { return selectArtifact(realpathSync(join(home, 'AscendBackups')), LEGACY_CONTRACTS); }

function inventory(root) {
  const result = [];
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const path = join(dir, name), info = lstatSync(path);
      if (info.isDirectory()) walk(path, rel);
      else if (info.isFile()) result.push(`${rel}\0${info.mode & 0o777}\0${sha256(readFileSync(path))}`);
      else if (info.isSymbolicLink()) result.push(`${rel}\0link\0${readlinkSync(path)}`);
      else throw Error('unsupported PostgreSQL build entry');
    }
  }
  walk(root);
  return result;
}
function privateR1cRoot() {
  const source = join(home, 'AscendPg17/pg17');
  if (!statSync(source).isDirectory()) throw Error('retained PostgreSQL 17 build unavailable');
  for (const name of ['postgres', 'initdb', 'pg_restore']) {
    const check = run(join(source, 'bin', name), ['--version']);
    if (check.status !== 0 || !/17\.6\b/.test(check.stdout)) throw Error('retained PostgreSQL build version invalid');
  }
  const parent = join(home, '.ascend-r1c');
  mkdirSync(parent, { mode: 0o700, recursive: true });
  if (statSync(parent).mode & 0o077) throw Error('R1c parent must be private');
  const root = mkdtempSync(join(parent, 'proof-'));
  try {
    cpSync(source, join(root, 'pg17'), { recursive: true, preserveTimestamps: true });
    const before = inventory(source), after = inventory(join(root, 'pg17'));
    if (before.length !== 1879 || before.length !== after.length || before.some((x, i) => x !== after[i]))
      throw Error('PostgreSQL copy verification failed');
    return root;
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}

function stopR1cClusters(root) {
  const bin = join(root, 'pg17/bin/pg_ctl');
  for (const name of ['leg1', 'leg2']) {
    const data = join(root, name, 'data');
    if (!existsSync(join(data, 'postmaster.pid'))) continue;
    const stopped = run(bin, ['-D', data, '-m', 'fast', '-w', '-t', '60', 'stop'],
      { env: { PATH: '/usr/bin:/bin', HOME: root, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' } });
    if (stopped.status !== 0) throw Error('disposable PostgreSQL cluster could not be stopped');
  }
}

async function residue(urls) {
  const { Client } = await import('pg');
  const tls = readFileSync(join(app, 'core/db/tls.ts'), 'utf8');
  const pem = tls.match(/export const SUPABASE_ROOT_2021_CA = `([\s\S]*?)`;/)?.[1];
  const fingerprint = tls.match(/export const SUPABASE_ROOT_2021_CA_SHA256 =\s*"([A-F0-9:]+)"/)?.[1];
  if (!pem || new X509Certificate(pem).fingerprint256 !== fingerprint) throw Error('database trust anchor invalid');
  const endpoint = new URL(urls.adminPooled);
  const client = new Client({ host: endpoint.hostname, port: endpoint.port ? Number(endpoint.port) : 5432,
    user: decodeURIComponent(endpoint.username), password: decodeURIComponent(endpoint.password),
    database: decodeURIComponent(endpoint.pathname.slice(1)),
    ssl: { ca: pem, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    options: '-c default_transaction_read_only=on', statement_timeout: 60_000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT current_setting('transaction_read_only') AS read_only,
      (SELECT count(*)::int FROM organizations WHERE slug LIKE 'applogin-%') AS organizations,
      (SELECT count(*)::int FROM users WHERE email LIKE 'applogin%') AS users,
      (SELECT count(*)::int FROM prospects WHERE slug LIKE 'applogin-%') AS prospects,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname IN ('ascend_pool_test','ascend_request_test')) AS schemas`);
    await client.query('ROLLBACK');
    const row = result.rows[0];
    if (row.read_only !== 'on' || row.organizations !== 0 || row.users !== 0 || row.prospects !== 0 || row.schemas !== 0)
      throw Error('production test residue or read-only guard failed');
    console.log('residue: read-only on; applogin organizations 0; users 0; scratch schemas 0');
  } finally { await client.end().catch(() => {}); }
}

export function ownerEmail() {
  const script = 'read -r -s -p "Owner email (not echoed): " value </dev/tty 2>/dev/tty; printf "\\n" >/dev/tty; printf "%s" "$value"';
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: proofEnvironment('static') });
  if (result.status !== 0 || !result.stdout.trim()) throw Error('OWNER_CHECKPOINT: owner email required');
  return result.stdout.trim();
}

function ownerPassword() {
  const password = readFileSync(localEnvFile(), 'utf8').split(/\r?\n/)
    .filter(line => line.startsWith('ASCEND_OWNER_PASSWORD='));
  if (password.length !== 1) throw Error('owner password unavailable or ambiguous');
  const value = password[0].slice('ASCEND_OWNER_PASSWORD='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!value) throw Error('owner password unavailable');
  return value;
}

export async function prove({ owner = false, taskId, gates = [], deps = {} } = {}) {
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(taskId)) throw Error('invalid task id');
  const plan = planProof(gates);
  const d = { candidate, sameCandidate, checkedChild, receiptValid, residue,
    readUrls: () => parseLocalEnv(readFileSync(localEnvFile(), 'utf8')),
    artifactSelection, ownerEmail, ownerPassword, privateR1cRoot, stopR1cClusters,
    removeR1cRoot: root => rmSync(root, { recursive: true, force: true }),
    log: line => console.log(line), ...deps };
  const initial = d.candidate();
  d.log(`candidate: ${initial.head} tree ${initial.tree}`);
  if (plan.static) phase(initial, 'static', proofEnvironment('static'), d);
  const urls = plan.server || plan.db ? d.readUrls() : null;
  const pg17Bin = join(home, 'AscendPg17/pg17/bin');
  if (plan.server) phase(initial, 'server', proofEnvironment('server', { urls }), d);
  if (plan.db) {
    phase(initial, 'db', proofEnvironment('db', { urls, pg17Bin }), d);
    await d.residue(urls);
    d.sameCandidate(initial);
  }
  if (plan.fixture) recovery(initial, recoveryFixture, [], proofEnvironment('fixture'), 'recovery fixture', d);
  if (plan.owner && !owner && (!d.receiptValid(['verify-recovery', ...r1b]) || !d.receiptValid(['verify-recovery', ...r1c]))) {
    d.sameCandidate(initial);
    d.log(`OWNER_CHECKPOINT: run \`env -u ASCEND_AGENT npm run agent -- prove ${taskId} --owner\` in the owner terminal`);
    return { ready: false, head: initial.head, tree: initial.tree };
  }
  if (plan.owner && (!d.receiptValid(['verify-recovery', ...r1b]) || !d.receiptValid(['verify-recovery', ...r1c]))) {
    const artifact = d.artifactSelection();
    const email = d.ownerEmail();
    const recoveryEnv = proofEnvironment('recovery', { recovery: {
      ASCEND_RECOVERY_OWNER_EMAIL: email, ASCEND_RECOVERY_OWNER_PASSWORD: d.ownerPassword() } });
    const baseArgs = ['--artifact', artifact.path, ...(artifact.contract ? ['--legacy-contract', artifact.contract] : [])];
    recovery(initial, r1b, [...baseArgs, '--only-artifact'], recoveryEnv, 'R1b', d);
    if (!d.receiptValid(['verify-recovery', ...r1c])) {
      const root = d.privateR1cRoot();
      try { recovery(initial, r1c, [...baseArgs, '--r1c-root', root], recoveryEnv, 'R1c', d); }
      finally {
        d.stopR1cClusters(root);
        d.removeR1cRoot(root);
      }
    }
  }
  d.sameCandidate(initial);
  if (plan.aggregate) {
    d.checkedChild(process.execPath, ['scripts/gate-proof.mjs', 'aggregate'], proofEnvironment('static'), 'aggregate');
    d.sameCandidate(initial);
    d.log(`aggregate: ${Object.values(GATE_2G1).filter(row => row.evidence === 'PROVEN').length} PROVEN suites; READY TO FREEZE tree ${initial.tree}`);
  } else d.log(`selected proof: valid for tree ${initial.tree}`);
  return { ready: true, head: initial.head, tree: initial.tree };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), taskId = args[args.indexOf('--task-id') + 1];
  const gates = args.flatMap((arg, index) => arg === '--gate' ? [args[index + 1]] : []);
  prove({ owner: args.includes('--owner'), taskId, gates }).catch(() => {
    console.error('proof orchestration failed; private diagnostic output withheld');
    process.exitCode = 1;
  });
}
