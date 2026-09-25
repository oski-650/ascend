import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The owner proof driver is intentionally a standalone Node ESM script.
import { parseLocalEnv, planProof, prove, selectArtifact } from '../../scripts/proof-orchestrator.mjs';

describe('proof orchestrator sanctioned local input', () => {
  const env = [
    'ASCEND_DATABASE_URL=postgres://app:synthetic@pool.test/db',
    'ASCEND_DATABASE_URL_DIRECT=postgres://app:synthetic@direct.test/db',
    'ASCEND_DATABASE_URL_ADMIN_POOLED=postgres://admin:synthetic@pool.test/db',
    'ASCEND_OS_SESSION_SECRET=synthetic-session-secret',
    'ASCEND_OWNER_PASSWORD=synthetic-secret',
    'ASCEND_MIGRATION_PASSWORD=synthetic-secret',
  ].join('\n');
  it('selects only the three sanctioned DB endpoints', () => {
    const parsed = parseLocalEnv(env);
    expect(parsed.app).toContain('app:synthetic');
    expect(parsed.adminPooled).toContain('admin:synthetic');
    expect(parsed.sessionSecret).toBe('synthetic-session-secret');
    expect(JSON.stringify(parsed)).not.toContain('ASCEND_OWNER_PASSWORD');
    expect(JSON.stringify(parsed)).not.toContain('ASCEND_MIGRATION_PASSWORD');
  });
  it('rejects missing, duplicate, or aliased admin identity', () => {
    expect(() => parseLocalEnv(env.replace('ASCEND_DATABASE_URL_DIRECT=', 'REMOVED='))).toThrow();
    expect(() => parseLocalEnv(`${env}\nASCEND_DATABASE_URL=postgres://other:x@pool.test/db`)).toThrow();
    expect(() => parseLocalEnv(env.replace('admin:synthetic', 'app:synthetic'))).toThrow();
  });
});

describe('owner artifact selection', () => {
  it('requires unique pinned bytes and resolves only v2 to the named legacy contract', () => {
    const root = mkdtempSync(join(tmpdir(), 'proof-artifact-'));
    const name = 'ascend-backup-20260920T104952Z-post-009.ascbk';
    try {
      const artifact = Buffer.concat([Buffer.from('ASCBKUP2'), Buffer.from([0, 0, 0, 2]), Buffer.from('{}'), Buffer.from('fixture')]);
      writeFileSync(join(root, name), artifact);
      const hash = createHash('sha256').update(artifact).digest('hex');
      const entry = { artifact: name, artifactSha256: hash, artifactFormat: 'ascend-backup/2', id: 'post-009', acceptedIn: 'CURRENT recovery point' };
      expect(selectArtifact(root, [entry]).contract).toBe('post-009');
      expect(() => selectArtifact(root, [{ ...entry, artifactSha256: '0'.repeat(64) }])).toThrow();
      expect(() => selectArtifact(root, [entry, entry])).toThrow();
      const v3 = Buffer.concat([Buffer.from('ASCBKUP3'), Buffer.from([0, 0, 0, 2]), Buffer.from('{}'), Buffer.from('fixture')]);
      writeFileSync(join(root, name), v3);
      const v3Entry = { ...entry, artifactFormat: 'ascend-backup/3', artifactSha256: createHash('sha256').update(v3).digest('hex') };
      expect(selectArtifact(root, [v3Entry]).contract).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

const tree = 'a'.repeat(40), head = 'b'.repeat(40);
const allGates = ['typecheck', 'gate:static', 'gate:server', 'gate:db'];
function harness() {
  const receipts = new Set<string>(), calls: string[] = [], lines: string[] = [];
  let current = { head, tree }, fail = '', prompts = 0;
  const urls = { app: 'postgres://app:secret@pool.test/db', direct: 'postgres://app:secret@direct.test/db',
    adminPooled: 'postgres://admin:secret@pool.test/db', sessionSecret: 'synthetic-session' };
  const key = (args: string[]) => args.join('|');
  const deps = {
    candidate: () => ({ ...current }),
    sameCandidate: (original: { head: string; tree: string }) => {
      if (current.head !== original.head || current.tree !== original.tree) throw Error('candidate changed during proof');
    },
    receiptValid: (args: string[]) => receipts.has(key(args)),
    checkedChild: (_file: string, _args: string[], _env: object, label: string) => {
      calls.push(label);
      if (label === fail) throw Error(`${label} failed`);
      const phase = ['static', 'server', 'db'].includes(label) ? ['verify-phase', label] :
        label === 'recovery fixture' ? ['verify-recovery', 'tests/recovery/artifact.test.ts',
          'tests/db/restore-fidelity.test.ts', 'tests/db/recovery-profiles.test.ts'] :
        label === 'R1b' ? ['verify-recovery', 'tests/db/restore-independence.test.ts'] :
        label === 'R1c' ? ['verify-recovery', 'tests/db/restore-same-version.test.ts'] : null;
      if (phase) receipts.add(key(phase));
      return '';
    },
    readUrls: () => urls,
    residue: async () => { calls.push('residue'); if (fail === 'residue') throw Error('residue failed'); },
    artifactSelection: () => ({ path: '/tmp/synthetic.ascbk', contract: 'post-009' }),
    ownerEmail: () => { prompts++; return 'owner@example.test'; },
    ownerPassword: () => 'synthetic-secret',
    privateR1cRoot: () => '/tmp/synthetic-r1c',
    stopR1cClusters: () => { calls.push('stop R1c'); if (fail === 'stop R1c') throw Error('stop failed'); },
    removeR1cRoot: () => { calls.push('remove R1c'); },
    log: (line: string) => { lines.push(line); },
  };
  return { deps, receipts, calls, lines, setFail: (value: string) => { fail = value; },
    changeTree: () => { current = { head: 'c'.repeat(40), tree: 'd'.repeat(40) }; },
    get prompts() { return prompts; } };
}

describe('selected proof state machine with synthetic authorities', () => {
  it('maps a second task id and only selected gates; refuses unknown gates', async () => {
    expect(planProof(['typecheck', 'gate:static'])).toMatchObject({ static: true, server: false, db: false, owner: false });
    expect(() => planProof(['gate:unknown'])).toThrow('unknown proof gate');
    const h = harness();
    await expect(prove({ taskId: '2A.2e', gates: ['typecheck', 'gate:static'], deps: h.deps })).resolves.toMatchObject({ ready: true });
    expect(h.calls).toEqual(['static']);
    expect(h.lines.at(-1)).toBe(`selected proof: valid for tree ${tree}`);
  });

  it('refuses a changed tree before accepting the phase receipt', async () => {
    const h = harness();
    const prior = h.deps.checkedChild;
    h.deps.checkedChild = (...args: Parameters<typeof prior>) => { prior(...args); h.changeTree(); return ''; };
    await expect(prove({ taskId: 'TEST-1', gates: ['gate:static'], deps: h.deps })).rejects.toThrow('candidate changed');
    expect(h.lines.some(line => line.includes('READY TO FREEZE'))).toBe(false);
  });

  it('re-runs missing phase evidence and refuses a runner that records no receipt', async () => {
    const h = harness();
    h.deps.receiptValid = () => false;
    await expect(prove({ taskId: 'TEST-2', gates: ['gate:static'], deps: h.deps })).rejects.toThrow('receipts invalid');
    expect(h.calls).toEqual(['static']);
  });

  it('blocks READY on DB, residue, recovery, and R1c cleanup failures', async () => {
    for (const failed of ['db', 'residue', 'recovery fixture', 'stop R1c']) {
      const h = harness();
      h.setFail(failed);
      await expect(prove({ owner: true, taskId: 'TEST-3', gates: allGates, deps: h.deps })).rejects.toThrow();
      expect(h.lines.some(line => line.includes('READY TO FREEZE'))).toBe(false);
    }
  });

  it('presents one task-specific owner action, resumes once, and reuses exact-tree receipts', async () => {
    const h = harness();
    const first = await prove({ taskId: '2A.2e', gates: allGates, deps: h.deps });
    expect(first.ready).toBe(false);
    expect(h.lines.at(-1)).toContain('prove 2A.2e --owner');
    expect(h.prompts).toBe(0);
    const second = await prove({ owner: true, taskId: '2A.2e', gates: allGates, deps: h.deps });
    expect(second.ready).toBe(true);
    expect(h.prompts).toBe(1);
    const phaseRuns = h.calls.filter(x => !['aggregate', 'residue', 'stop R1c', 'remove R1c'].includes(x)).length;
    await prove({ taskId: '2A.2e', gates: allGates, deps: h.deps });
    expect(h.calls.filter(x => !['aggregate', 'residue', 'stop R1c', 'remove R1c'].includes(x))).toHaveLength(phaseRuns);
    expect(h.prompts).toBe(1);
    expect(h.lines.at(-1)).toContain('READY TO FREEZE');
  });
});
