import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateCommandForFreeze, runGates } from '../lib/gates.mjs';
import { makeReceipt, selectedProofStatus } from '../../../apps/os/scripts/gate-proof.mjs';

const hash40 = 'a'.repeat(40);
const hash64 = 'b'.repeat(64);
const key = Buffer.alloc(32, 7);
const suites = ['tests/db/first.test.ts', 'tests/db/second.test.ts'];
const manifest = Object.fromEntries(suites.map(suite => [suite, {
  evidence: 'PROVEN', phase: 'db', requires: ['ASCEND_TEST_DATABASE_URL'],
}]));
const context = { tree: hash40, manifestHash: hash64, testHash: () => 'c'.repeat(64) };
const receipt = suite => makeReceipt({ tree: context.tree, manifestHash: context.manifestHash,
  suite, testHash: context.testHash(suite), phase: 'db', environmentClass: 'production-database',
  runId: '00000000-0000-4000-8000-000000000001', passed: 1 }, key);

test('DB receipt verification rejects missing, wrong-tree, and tampered suite evidence', () => {
  const valid = Object.fromEntries(suites.map(suite => [suite, receipt(suite)]));
  assert.deepEqual(selectedProofStatus('db', null, manifest, valid, context, key), { count: 2, missing: [] });
  assert.equal(selectedProofStatus('db', null, manifest, { [suites[0]]: valid[suites[0]] }, context, key).missing.length, 1);
  assert.equal(selectedProofStatus('db', null, manifest, { ...valid,
    [suites[1]]: { ...valid[suites[1]], tree: 'd'.repeat(40) } }, context, key).missing.length, 1);
  assert.equal(selectedProofStatus('db', null, manifest, { ...valid,
    [suites[1]]: { ...valid[suites[1]], passed: 2 } }, context, key).missing.length, 1);
});

test('freeze maps only the canonical DB registry command to exact-tree verification', () => {
  const gate = { cwd: 'apps/os', cmd: ['npm', 'run', 'gate:db'] };
  assert.deepEqual(gateCommandForFreeze('gate:db', gate).slice(1),
    ['scripts/gate-proof.mjs', 'verify-phase', 'db']);
  assert.throws(() => gateCommandForFreeze('gate:db', { ...gate, cwd: '.' }));
  assert.throws(() => gateCommandForFreeze('gate:db', { ...gate, cmd: ['npm', 'run', 'other'] }));
  assert.deepEqual(gateCommandForFreeze('typecheck', { cwd: 'apps/os', cmd: ['npm', 'run', 'typecheck'] }),
    ['npm', 'run', 'typecheck']);
});

test('freeze verifies DB evidence without database credentials or a network command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-db-'));
  const saved = new Map();
  try {
    const scriptDir = join(dir, 'apps/os/scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'gate-proof.mjs'), `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const forbidden = Object.keys(process.env).filter(name => name.startsWith('ASCEND_DATABASE_URL') ||
  name === 'ASCEND_TEST_DATABASE_URL' || name.startsWith('PG') || name.startsWith('SUPABASE'));
if (forbidden.length || process.argv.slice(2).join(' ') !== 'verify-phase db' ||
    !existsSync(resolve(process.cwd(), '../../.git/db.receipt'))) process.exit(1);
`);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Proof Fixture');
    git('config', 'user.email', 'proof@example.test');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const registry = { entries: { 'gate:db': {
      cwd: 'apps/os', cmd: ['npm', 'run', 'gate:db'], timeout_s: 10,
    } }, blobSha: 'e'.repeat(40) };
    for (const [name, value] of Object.entries(process.env)) {
      if (name.startsWith('ASCEND_DATABASE_URL') || name === 'ASCEND_TEST_DATABASE_URL' ||
          name.startsWith('PG') || name.startsWith('SUPABASE')) {
        saved.set(name, value);
        delete process.env[name];
      }
    }
    await assert.rejects(runGates(['gate:db'], { sha, cwd: dir, registry }), /gate:db exited 1/);
    writeFileSync(join(dir, '.git/db.receipt'), 'synthetic evidence');
    const evidence = await runGates(['gate:db'], { sha, cwd: dir, registry });
    assert.equal(evidence[0].exit_code, 0);
    assert.deepEqual(evidence[0].command.slice(-2), ['verify-phase', 'db']);
    assert.equal(evidence[0].ran_on.sha, sha);
    assert.equal(evidence[0].ran_on.clean_after, true);
  } finally {
    for (const [name, value] of saved) process.env[name] = value;
    rmSync(dir, { recursive: true, force: true });
  }
});
