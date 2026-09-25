import test from 'node:test';
import assert from 'node:assert/strict';
import { proofEnvironment, assertProofIsolation, legacyContractFor } from '../lib/proof-environment.mjs';
import { safeProofLines, proveTask } from '../lib/proof-orchestrator.mjs';
import { safeGateSummary } from '../lib/gates.mjs';
import { hostname } from 'node:os';
import { sha256 } from '../lib/canon.mjs';

const source = { PATH: '/bin', HOME: '/tmp/home', NEXT_PUBLIC_SUPABASE_URL: 'synthetic-secret',
  ASCEND_DATABASE_URL: 'synthetic-db', PGHOST: 'synthetic-host', ASCEND_RECOVERY_OWNER_EMAIL: 'owner@example.test',
  ASCEND_MIGRATION_PASSWORD: 'synthetic-secret' };
const urls = { app: 'postgres://app:secret@host/db', direct: 'postgres://app:secret@direct/db',
  adminPooled: 'postgres://admin:secret@pool/db', sessionSecret: 'synthetic-session-secret' };

test('server and DB proof use distinct sanctioned identities without inherited authority', () => {
  const server = proofEnvironment('server', { source, urls });
  const db = proofEnvironment('db', { source, urls, pg17Bin: '/tmp/pg17/bin' });
  assert.equal(server.ASCEND_RENDER_TEST, '1');
  assert.equal(server.ASCEND_STARTUP_TEST, '1');
  assert.equal(server.ASCEND_OS_SESSION_SECRET, urls.sessionSecret);
  assert.equal(db.ASCEND_TEST_DATABASE_URL, urls.adminPooled);
  assert.equal(db.ASCEND_DATABASE_URL_DIRECT, urls.direct);
  for (const env of [server, db]) {
    assert.equal(env.ASCEND_RECOVERY_OWNER_EMAIL, undefined);
    assert.equal(env.ASCEND_MIGRATION_PASSWORD, undefined);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, undefined);
  }
  assert.throws(() => proofEnvironment('db', { source, urls: { ...urls, adminPooled: urls.app }, pg17Bin: 'bin' }));
  assert.throws(() => proofEnvironment('db', { source, urls }));
});

test('gate evidence summaries never include raw child output', () => {
  const syntheticSecret = 'postgres://app:synthetic-secret@host/db';
  const summary = safeGateSummary('gate:db', 1);
  assert.equal(summary, 'gate:db: failed (exit 1)\n');
  assert.ok(!summary.includes(syntheticSecret));
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
