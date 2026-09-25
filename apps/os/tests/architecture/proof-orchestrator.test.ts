import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The owner proof driver is intentionally a standalone Node ESM script.
import { parseLocalEnv, selectArtifact } from '../../scripts/proof-orchestrator.mjs';

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
