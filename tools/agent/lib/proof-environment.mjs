// Pure proof-environment planning. Values never enter Coordinator state or logs.
const BASE_NAMES = ['PATH', 'HOME', 'TMPDIR'];
const DB_NAMES = ['ASCEND_DATABASE_URL', 'ASCEND_DATABASE_URL_DIRECT', 'ASCEND_TEST_DATABASE_URL', 'ASCEND_PG17_BIN'];
const RECOVERY_NAMES = ['ASCEND_BACKUP_ARTIFACT', 'ASCEND_BACKUP_KEYRING', 'ASCEND_RECOVERY_OWNER_EMAIL',
  'ASCEND_RECOVERY_OWNER_PASSWORD', 'ASCEND_RECOVERY_LEGACY_CONTRACT', 'ASCEND_R1C_ROOT'];

export function baseProofEnvironment(source = process.env) {
  const result = {};
  for (const name of BASE_NAMES) if (source[name]) result[name] = source[name];
  return result;
}

export function proofEnvironment(phase, { source = process.env, urls = {}, pg17Bin, recovery = {} } = {}) {
  const env = baseProofEnvironment(source);
  if (phase === 'static' || phase === 'fixture') return env;
  if (phase === 'server' || phase === 'db') {
    if (!urls.app || !urls.direct || !urls.adminPooled) throw new Error('sanctioned database inputs unavailable');
    env.ASCEND_DATABASE_URL = urls.app;
    env.ASCEND_TEST_DATABASE_URL = urls.adminPooled;
    if (phase === 'server') {
      if (!urls.sessionSecret) throw new Error('sanctioned startup test secret unavailable');
      env.ASCEND_RENDER_TEST = '1';
      env.ASCEND_STARTUP_TEST = '1';
      env.ASCEND_OS_SESSION_SECRET = urls.sessionSecret;
    } else {
      if (!pg17Bin) throw new Error('sanctioned PostgreSQL 17 binary unavailable');
      env.ASCEND_DATABASE_URL_DIRECT = urls.direct;
      env.ASCEND_PG17_BIN = pg17Bin;
    }
  } else if (phase === 'recovery') {
    for (const name of RECOVERY_NAMES) if (recovery[name]) env[name] = recovery[name];
  } else throw new Error('unknown proof phase');
  assertProofIsolation(phase, env);
  return env;
}

export function assertProofIsolation(phase, env) {
  const names = Object.keys(env);
  if (phase === 'recovery' || phase === 'fixture') {
    if (names.some(name => name.startsWith('PG') || name.includes('DATABASE_URL') ||
      name.startsWith('SUPABASE') || name.startsWith('NEXT_PUBLIC_SUPABASE'))) {
      throw new Error('recovery environment contains database or Supabase configuration');
    }
  } else if (names.some(name => name.startsWith('ASCEND_BACKUP_') ||
    name.startsWith('ASCEND_RECOVERY_') || name === 'ASCEND_R1C_ROOT' || name === 'ASCEND_OWNER_PASSWORD')) {
    throw new Error('non-recovery environment contains recovery authority');
  }
  if (phase === 'server' || phase === 'db') {
    if (!env.ASCEND_DATABASE_URL || !env.ASCEND_TEST_DATABASE_URL ||
      env.ASCEND_TEST_DATABASE_URL === env.ASCEND_DATABASE_URL) {
      throw new Error('sanctioned app and admin test identities are required');
    }
  }
  if (names.some(name => /MIGRAT|HARDEN|PROVISION/.test(name))) {
    throw new Error('migration or hardening authority is forbidden in proof environment');
  }
}

export function legacyContractFor({ format, sha256, contracts }) {
  if (format === 'ascend-backup/3') return null;
  if (format !== 'ascend-backup/2' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('unsupported artifact');
  const matches = contracts.filter(entry => entry.artifactFormat === format && entry.artifactSha256 === sha256);
  if (matches.length !== 1 || !/^[a-z0-9-]+$/.test(matches[0].id)) throw new Error('no unique pinned legacy contract');
  return matches[0].id;
}

export const proofEnvironmentNames = Object.freeze({ DB_NAMES, RECOVERY_NAMES });
