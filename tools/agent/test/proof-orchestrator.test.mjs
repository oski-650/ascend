import test from 'node:test';
import assert from 'node:assert/strict';
import { proofEnvironment, assertProofIsolation, legacyContractFor } from '../lib/proof-environment.mjs';
import { safeProofLines, proveTask } from '../lib/proof-orchestrator.mjs';
import { gateCommandForFreeze, runGates, safeGateSummary } from '../lib/gates.mjs';
import { hostname } from 'node:os';
import { sha256 } from '../lib/canon.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const source = { PATH: '/bin', HOME: '/tmp/home', NEXT_PUBLIC_SUPABASE_URL: 'synthetic-secret',
  ASCEND_DATABASE_URL: 'synthetic-db', PGHOST: 'synthetic-host', ASCEND_RECOVERY_OWNER_EMAIL: 'owner@example.test',
  ASCEND_MIGRATION_PASSWORD: 'synthetic-secret' };
const urls = { app: 'postgres://app:secret@host/db', direct: 'postgres://app:secret@direct/db',
  adminPooled: 'postgres://admin:secret@pool/db', sessionSecret: 'synthetic-session-secret' };

test('server and DB proof use distinct sanctioned identities without inherited authority', () => {
  const vaultPath = '/tmp/synthetic-server-vault';
  const server = proofEnvironment('server', { source, urls: {
    app: urls.app, adminPooled: urls.adminPooled, sessionSecret: urls.sessionSecret,
  }, vaultPath });
  const db = proofEnvironment('db', { source, urls, pg17Bin: '/tmp/pg17/bin' });
  assert.equal(server.ASCEND_RENDER_TEST, '1');
  assert.equal(server.ASCEND_STARTUP_TEST, '1');
  assert.equal(server.ASCEND_OS_SESSION_SECRET, urls.sessionSecret);
  assert.equal(server.ASCEND_VAULT_PATH, vaultPath);
  assert.deepEqual(Object.keys(server).sort(), ['ASCEND_DATABASE_URL', 'ASCEND_OS_SESSION_SECRET',
    'ASCEND_RENDER_TEST', 'ASCEND_STARTUP_TEST', 'ASCEND_TEST_DATABASE_URL',
    'ASCEND_VAULT_PATH', 'HOME', 'PATH'].sort());
  assert.equal(server.ASCEND_DATABASE_URL_DIRECT, undefined);
  assert.equal(db.ASCEND_VAULT_PATH, undefined);
  assert.equal(db.ASCEND_TEST_DATABASE_URL, urls.adminPooled);
  assert.equal(db.ASCEND_DATABASE_URL_DIRECT, urls.direct);
  for (const env of [server, db]) {
    assert.equal(env.ASCEND_RECOVERY_OWNER_EMAIL, undefined);
    assert.equal(env.ASCEND_MIGRATION_PASSWORD, undefined);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, undefined);
  }
  assert.throws(() => proofEnvironment('db', { source, urls: { ...urls, adminPooled: urls.app }, pg17Bin: 'bin' }));
  assert.throws(() => proofEnvironment('db', { source, urls }));
  assert.throws(() => proofEnvironment('server', { source, urls }), /vault input unavailable/);
  assert.throws(() => proofEnvironment('server', { source, urls, vaultPath: 'relative' }), /vault input unavailable/);
  for (const name of ['ASCEND_DATABASE_URL_DIRECT', 'ASCEND_PG17_BIN',
    'ASCEND_MIGRATION_PASSWORD', 'ASCEND_BACKUP_KEYRING', 'ASCEND_OWNER_PASSWORD']) {
    assert.throws(() => assertProofIsolation('server', { ...server, [name]: 'synthetic-secret' }));
  }
  assert.throws(() => assertProofIsolation('db', { ...db, ASCEND_VAULT_PATH: vaultPath }), /limited to server/);
});

test('gate evidence summaries never include raw child output', () => {
  const syntheticSecret = 'postgres://app:synthetic-secret@host/db';
  const summary = safeGateSummary('gate:db', 1);
  assert.equal(summary, 'gate:db: failed (exit 1)\n');
  assert.ok(!summary.includes(syntheticSecret));
});

test('freeze checks selected exact-tree phase receipts and refuses either missing phase', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-freeze-'));
  try {
    const scriptDir = join(dir, 'apps/os/scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'gate-proof.mjs'), `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const [command, phase] = process.argv.slice(2);
if (command !== 'verify-phase' || !['static', 'server'].includes(phase) ||
  !existsSync(resolve(process.cwd(), '../../.git', phase + '.receipt'))) process.exit(1);
`);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Proof Fixture');
    git('config', 'user.email', 'proof@example.test');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const entries = Object.fromEntries(['gate:static', 'gate:server'].map(name =>
      [name, { cmd: ['npm', 'run', name], cwd: 'apps/os', timeout_s: 10 }]));
    const registry = { entries, blobSha: 'a'.repeat(40) };
    assert.deepEqual(gateCommandForFreeze('gate:static', entries['gate:static']).slice(1),
      ['scripts/gate-proof.mjs', 'verify-phase', 'static']);
    assert.throws(() => gateCommandForFreeze('gate:server', { ...entries['gate:server'], cwd: '.' }));
    await assert.rejects(runGates(['gate:static', 'gate:server'], { sha, cwd: dir, registry }), /gate:static exited 1/);
    writeFileSync(join(dir, '.git/static.receipt'), 'valid');
    await assert.rejects(runGates(['gate:static', 'gate:server'], { sha, cwd: dir, registry }), /gate:server exited 1/);
    writeFileSync(join(dir, '.git/server.receipt'), 'valid');
    const evidence = await runGates(['gate:static', 'gate:server'], { sha, cwd: dir, registry });
    assert.deepEqual(evidence.map(x => x.exit_code), [0, 0]);
    assert.deepEqual(evidence.map(x => x.command.slice(-2)),
      [['verify-phase', 'static'], ['verify-phase', 'server']]);
    assert.ok(evidence.every(x => x.ran_on.sha === sha && x.ran_on.clean_after));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fixture and recovery environments are sterile even with inherited Supabase and PG values', () => {
  const fixture = proofEnvironment('fixture', { source });
  const recovery = proofEnvironment('recovery', { source, recovery: { ASCEND_RECOVERY_OWNER_EMAIL: 'synthetic-owner' } });
  assert.deepEqual(fixture, { PATH: '/bin', HOME: '/tmp/home' });
  assert.deepEqual(Object.keys(recovery).sort(), ['ASCEND_RECOVERY_OWNER_EMAIL', 'HOME', 'PATH']);
  assert.throws(() => assertProofIsolation('recovery', { ...recovery, NEXT_PUBLIC_SUPABASE_URL: 'inherited' }));
  assert.throws(() => assertProofIsolation('recovery', { ...recovery, PGHOST: 'inherited' }));
  assert.throws(() => assertProofIsolation('db', { ...recovery, ...proofEnvironment('db', { source, urls, pg17Bin: 'bin' }) }));
});

test('legacy v2 contract requires one pinned artifact hash; v3 carries its own', () => {
  const hash = 'a'.repeat(64), contracts = [{ artifactFormat: 'ascend-backup/2', artifactSha256: hash, id: 'post-009' }];
  assert.equal(legacyContractFor({ format: 'ascend-backup/2', sha256: hash, contracts }), 'post-009');
  assert.equal(legacyContractFor({ format: 'ascend-backup/3', sha256: hash, contracts }), null);
  assert.throws(() => legacyContractFor({ format: 'ascend-backup/2', sha256: 'b'.repeat(64), contracts }));
  assert.throws(() => legacyContractFor({ format: 'ascend-backup/2', sha256: hash, contracts: [...contracts, ...contracts] }));
});

test('Coordinator proof output refuses synthetic secrets and arbitrary child output', () => {
  const candidate = `candidate: ${'a'.repeat(40)} tree ${'b'.repeat(40)}`;
  assert.deepEqual(safeProofLines(`${candidate}\nstatic: 34 exact-tree suites proven\naggregate: 76 PROVEN suites; READY TO FREEZE tree ${'b'.repeat(40)}\n`),
    [candidate, 'static: 34 exact-tree suites proven', `aggregate: 76 PROVEN suites; READY TO FREEZE tree ${'b'.repeat(40)}`]);
  const checkpoint = 'OWNER_CHECKPOINT: run `env -u ASCEND_AGENT npm run agent -- prove 2A.2e --owner` in the owner terminal';
  assert.deepEqual(safeProofLines(`${candidate}\n${checkpoint}\n`), [candidate, checkpoint]);
  assert.throws(() => safeProofLines(`${candidate}\n`));
  assert.throws(() => safeProofLines('postgres://app:synthetic-secret@host/db\n'));
  assert.throws(() => safeProofLines('OWNER_CHECKPOINT: owner@example.test\n'));
  assert.throws(() => safeProofLines('aggregate: ready with password synthetic-secret\n'));
});

test('blocked and unclaimed tasks cannot enter proof or impersonate owner', async () => {
  const task = { id: 'COORD-PROOF-001', state: 'BLOCKED', builder: 'codex', claim: { agent: 'codex', worktree_id: 'fixture' } };
  await assert.rejects(proveTask({ cwd: '/tmp/fixture', task, id: task.id, owner: true, actor: 'owner' }), /not claimed/);
  await assert.rejects(proveTask({ cwd: '/tmp/fixture', task: { ...task, state: 'IMPLEMENTING',
    claim: { agent: 'codex', worktree_id: sha256(hostname() + '/tmp/fixture') } }, id: task.id,
    owner: true, actor: 'codex' }), /actor invalid/);
});

test('the two-level captured process chain shows a silent owner prompt on the terminal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-owner-pty-'));
  try {
    const child = join(dir, 'child.mjs'), parent = join(dir, 'parent.cjs');
    const moduleUrl = pathToFileURL(resolve('apps/os/scripts/proof-orchestrator.mjs')).href;
    writeFileSync(child, `import { ownerEmail } from ${JSON.stringify(moduleUrl)};\nconst value = ownerEmail();\nprocess.stdout.write('email length: ' + value.length + '\\n');\n`);
    writeFileSync(parent, `const { execFile } = require('node:child_process');\nexecFile(process.execPath, [${JSON.stringify(child)}], (error, stdout, stderr) => { if (error) { process.exitCode = 1; process.stderr.write(stderr); } process.stdout.write(stdout); });\n`);
    const secret = 'owner.synthetic@example.test';
    const ptyDriver = `import os, pty, subprocess, select, sys, time, fcntl, termios
master, slave = pty.openpty()
def attach():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
proc = subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, preexec_fn=attach)
os.close(slave)
seen = b''
sent = False
deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    ready, _, _ = select.select([master], [], [], 0.1)
    if ready:
        try: chunk = os.read(master, 4096)
        except OSError: break
        if not chunk: break
        seen += chunk
        if not sent and b'Owner email (not echoed): ' in seen:
            os.write(master, sys.argv[3].encode() + b'\\n')
            sent = True
    if proc.poll() is not None and not ready: break
if proc.poll() is None: proc.kill()
proc.wait()
sys.stdout.buffer.write(seen)
sys.exit(0 if sent and proc.returncode == 0 else 1)
`;
    let transcript;
    try { transcript = execFileSync('python3', ['-c', ptyDriver, process.execPath, parent, secret],
      { encoding: 'utf8', timeout: 12_000 }); }
    catch (error) { throw Error(`pty failed: ${error.stdout || ''}`); }
    assert.match(transcript, /Owner email \(not echoed\): /);
    assert.match(transcript, new RegExp(`email length: ${secret.length}`));
    assert.ok(!transcript.includes(secret));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
