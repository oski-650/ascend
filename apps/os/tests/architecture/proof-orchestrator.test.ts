import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The owner proof driver is intentionally a standalone Node ESM script.
import { localVaultPath, parseLocalEnv, parseVaultLocalEnv, planProof, prove, selectArtifact } from '../../scripts/proof-orchestrator.mjs';
import { LEGACY_CONTRACTS } from '../../core/recovery/legacy-contracts';
import { RECOVERY_POINTS } from '../../core/recovery/recovery-points';
import { profileSpec } from '../../core/recovery/profile-registry';

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
  it('server parsing excludes the direct DB identity and ignores unrelated secrets', () => {
    const parsed = parseLocalEnv(env, { phase: 'server' });
    expect(parsed).not.toHaveProperty('direct');
    expect(JSON.stringify(parsed)).not.toContain('ASCEND_OWNER_PASSWORD');
    expect(JSON.stringify(parsed)).not.toContain('ASCEND_MIGRATION_PASSWORD');
    expect(() => parseLocalEnv(env.replace('ASCEND_DATABASE_URL_ADMIN_POOLED=', 'REMOVED='), { phase: 'server' })).toThrow();
  });
  it('accepts only one absolute private vault input without exposing its value on failure', () => {
    const value = '/tmp/synthetic-server-vault';
    expect(parseVaultLocalEnv(`ASCEND_VAULT_PATH=${value}\n`)).toBe(value);
    for (const raw of ['', 'ASCEND_VAULT_PATH=relative',
      `ASCEND_VAULT_PATH=${value}\nASCEND_VAULT_PATH=${value}`,
      `ASCEND_VAULT_PATH=${value}\nASCEND_OWNER_PASSWORD=synthetic-secret`]) {
      expect(() => parseVaultLocalEnv(raw)).toThrow();
      try { parseVaultLocalEnv(raw); } catch (error) {
        expect(String(error)).not.toContain(value);
        expect(String(error)).not.toContain('synthetic-secret');
      }
    }
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
      // RECOVERY-CURRENT-001: the pin's format must match the envelope, and no CURRENT is refused.
      expect(() => selectArtifact(root, [{ ...v3Entry, artifactFormat: 'ascend-backup/2' }])).toThrow('artifact format differs from its pin');
      expect(() => selectArtifact(root, [{ ...v3Entry, acceptedIn: 'HISTORICAL since test' }])).toThrow('ambiguous');
      // One v2 legacy contract and one v3 point, both CURRENT, is ambiguous across the two registries.
      expect(() => selectArtifact(root, [entry, v3Entry])).toThrow('ambiguous');
      // A HISTORICAL v2 contract beside a CURRENT v3 point selects the v3 point, with no legacy contract.
      expect(selectArtifact(root, [{ ...entry, acceptedIn: 'HISTORICAL since test' }, v3Entry]).contract).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('the shipped registries name exactly one CURRENT recovery point: the post-010 v3 artifact', () => {
    const pins = [...LEGACY_CONTRACTS, ...RECOVERY_POINTS];
    const current = pins.filter(pin => pin.acceptedIn.includes('CURRENT recovery point'));
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      artifact: 'ascend-backup-20260930T030242Z-post-010.ascbk',
      artifactSha256: '3fddddcf37cb6b6abe97e6f848311d4c463f52287547b2df97fb5691d1b1a70f',
      artifactFormat: 'ascend-backup/3', keyId: '3b44ac35c74f2ff0', applicationProfile: 'post-010-v1',
    });
    expect(LEGACY_CONTRACTS.every(contract => contract.acceptedIn.includes('HISTORICAL'))).toBe(true);
    // The pinned profile exists and fits the sealed ledger head.
    const profile = profileSpec(RECOVERY_POINTS[0].applicationProfile);
    expect(profile?.ledger.at(-1)?.startsWith(`${RECOVERY_POINTS[0].ledgerHead}:`)).toBe(true);
  });

  it('marking post-009 historical changed its acceptedIn and nothing else', () => {
    const post009 = LEGACY_CONTRACTS.find(contract => contract.id === 'post-009-20260920');
    expect(post009).toMatchObject({
      artifact: 'ascend-backup-20260920T104952Z-post-009.ascbk',
      artifactSha256: '5958f3fcbde0e0e6f942017bf68e1cbc261ee11042489af70e8526e5302e314f',
      artifactFormat: 'ascend-backup/2', keyId: '3b44ac35c74f2ff0',
      manifestFile: 'manifest-4f20059f.sql',
      manifestSha256: '4f20059f61e0f8e55d0a1c33dac7358a454a0d321da1849ca967afc1ff3457a2',
      manifestCommit: 'dd46b957d3af87faca1b37cbb06a9a14ee1e99b1',
      applicationProfile: 'post-009-v1', coverageExclusions: {},
      acceptedIn: 'docs/DEPENDENCY-D1B2-CHECKPOINT.md (D1b.2, 2026-09-20); HISTORICAL since 2A.3a-2 (2026-09-30)',
    });
    expect(post009?.ledger).toHaveLength(9);
    expect(post009?.ledger.at(-1)).toBe('009_prospect_archival.sql:f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d');
    expect(LEGACY_CONTRACTS.map(contract => contract.id)).toEqual(['pre-009-20260919', 'post-009-20260920']);
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
    readVaultPath: () => '/tmp/synthetic-server-vault',
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

  it('refuses the server phase before execution when the private vault input is absent', async () => {
    const h = harness();
    h.deps.readVaultPath = () => { throw Error('sanctioned server vault input unavailable'); };
    await expect(prove({ taskId: 'TEST-SERVER', gates: ['gate:server'], deps: h.deps }))
      .rejects.toThrow('sanctioned server vault input unavailable');
    expect(h.calls).toEqual([]);
    expect(h.lines.some(line => line.includes('READY TO FREEZE'))).toBe(false);
  });

  it('passes the same checked private vault input into db proof and fails closed on absent or readable input', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proof-db-vault-'));
    const vault = join(root, 'empty-vault'), file = join(root, '.env.local');
    try {
      mkdirSync(vault);
      writeFileSync(file, `ASCEND_VAULT_PATH=${vault}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
      const h = harness(), child = h.deps.checkedChild;
      let dbVaultReceived = false;
      h.deps.readVaultPath = () => localVaultPath(file);
      h.deps.checkedChild = (...args: Parameters<typeof child>) => {
        if (args[3] === 'db') {
          const env = args[2] as Record<string, string>;
          dbVaultReceived = env.ASCEND_VAULT_PATH === vault;
          expect(Object.keys(env).filter(name => name.startsWith('ASCEND_BACKUP_') ||
            name.startsWith('ASCEND_RECOVERY_') || name === 'ASCEND_R1C_ROOT')).toEqual([]);
        }
        return child(...args);
      };
      await expect(prove({ taskId: 'TEST-DB-VAULT', gates: ['gate:db'], deps: h.deps }))
        .resolves.toMatchObject({ ready: false });
      expect(dbVaultReceived).toBe(true);

      const absent = harness();
      absent.deps.readVaultPath = () => localVaultPath(join(root, 'missing.env.local'));
      await expect(prove({ taskId: 'TEST-DB-ABSENT', gates: ['gate:db'], deps: absent.deps }))
        .rejects.toThrow('sanctioned local vault input unavailable or invalid');
      expect(absent.calls).toEqual([]);
      expect(absent.lines.some(line => line.includes('READY TO FREEZE'))).toBe(false);

      chmodSync(file, 0o640);
      const readable = harness();
      readable.deps.readVaultPath = () => localVaultPath(file);
      await expect(prove({ taskId: 'TEST-DB-READABLE', gates: ['gate:db'], deps: readable.deps }))
        .rejects.toThrow('sanctioned local vault input unavailable or invalid');
      expect(readable.calls).toEqual([]);
      expect(readable.lines.some(line => line.includes('READY TO FREEZE'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
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
