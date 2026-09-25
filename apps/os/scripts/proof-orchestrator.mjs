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
function phase(initial, name, env) {
  sameCandidate(initial);
  if (receiptValid(['verify-phase', name])) {
    console.log(`${name}: ${phaseSuites(name).length} exact-tree receipts already valid`);
    return;
  }
  checkedChild(process.execPath, ['scripts/gate-proof.mjs', name === 'static' ? 'static-only' : name], env, name);
  sameCandidate(initial);
  if (!receiptValid(['verify-phase', name])) throw Error(`${name} receipts invalid after execution`);
  console.log(`${name}: ${phaseSuites(name).length} exact-tree suites proven`);
}
function recovery(initial, suites, args, env, label) {
  sameCandidate(initial);
  if (receiptValid(['verify-recovery', ...suites])) { console.log(`${label}: ${suites.length} exact-tree receipts already valid`); return; }
  checkedChild('bash', ['scripts/recovery-verify.sh', ...args], env, label);
  sameCandidate(initial);
  if (!receiptValid(['verify-recovery', ...suites])) throw Error(`${label} receipts invalid after execution`);
  console.log(`${label}: ${suites.length} exact-tree suites proven`);
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

function ownerEmail() {
  const script = 'read -r -s -p "Owner email (not echoed): " value </dev/tty; printf "\\n" >/dev/tty; printf "%s" "$value"';
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: proofEnvironment('static') });
  if (result.status !== 0 || !result.stdout.trim()) throw Error('OWNER_CHECKPOINT: owner email required');
  return result.stdout.trim();
}

export async function prove({ owner = false } = {}) {
  const initial = candidate();
  console.log(`candidate: ${initial.head} tree ${initial.tree}`);
  phase(initial, 'static', proofEnvironment('static'));
  const urls = parseLocalEnv(readFileSync(localEnvFile(), 'utf8'));
  const pg17Bin = join(home, 'AscendPg17/pg17/bin');
  phase(initial, 'server', proofEnvironment('server', { urls }));
  phase(initial, 'db', proofEnvironment('db', { urls, pg17Bin }));
  await residue(urls);
  recovery(initial, recoveryFixture, [], proofEnvironment('fixture'), 'recovery fixture');
  if (!owner && (!receiptValid(['verify-recovery', ...r1b]) || !receiptValid(['verify-recovery', ...r1c]))) {
    console.log('OWNER_CHECKPOINT: run `env -u ASCEND_AGENT npm run agent -- prove COORD-PROOF-001 --owner` in the owner terminal');
    return { ready: false, head: initial.head, tree: initial.tree };
  }
  if (!receiptValid(['verify-recovery', ...r1b]) || !receiptValid(['verify-recovery', ...r1c])) {
    const artifact = artifactSelection();
    const email = ownerEmail();
    const password = readFileSync(localEnvFile(), 'utf8').split(/\r?\n/)
      .filter(line => line.startsWith('ASCEND_OWNER_PASSWORD='));
    if (password.length !== 1) throw Error('owner password unavailable or ambiguous');
    const ownerPassword = password[0].slice('ASCEND_OWNER_PASSWORD='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!ownerPassword) throw Error('owner password unavailable');
    const recoveryEnv = proofEnvironment('recovery', { recovery: {
      ASCEND_RECOVERY_OWNER_EMAIL: email, ASCEND_RECOVERY_OWNER_PASSWORD: ownerPassword } });
    const baseArgs = ['--artifact', artifact.path, ...(artifact.contract ? ['--legacy-contract', artifact.contract] : [])];
    recovery(initial, r1b, [...baseArgs, '--only-artifact'], recoveryEnv, 'R1b');
    if (!receiptValid(['verify-recovery', ...r1c])) {
      const root = privateR1cRoot();
      try { recovery(initial, r1c, [...baseArgs, '--r1c-root', root], recoveryEnv, 'R1c'); }
      finally {
        stopR1cClusters(root);
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
  sameCandidate(initial);
  checkedChild(process.execPath, ['scripts/gate-proof.mjs', 'aggregate'], proofEnvironment('static'), 'aggregate');
  sameCandidate(initial);
  console.log(`aggregate: ${Object.values(GATE_2G1).filter(row => row.evidence === 'PROVEN').length} PROVEN suites; READY TO FREEZE tree ${initial.tree}`);
  return { ready: true, head: initial.head, tree: initial.tree };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prove({ owner: process.argv.includes('--owner') }).catch(() => {
    console.error('proof orchestration failed; private diagnostic output withheld');
    process.exitCode = 1;
  });
}
